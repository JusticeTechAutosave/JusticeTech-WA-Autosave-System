// plugins/subscription.js — JusticeTech Autosave Bot
// ─────────────────────────────────────────────────────────────────────────────
// DEPLOYMENT: Pterodactyl — each owner has their OWN bot instance.
// Each bot has its own database/ folder on disk.
//
// ─── HOW PAYMENT APPROVAL WORKS ─────────────────────────────────────────────
//
//  1. Owner types .sub buy <plan> on their own bot
//     → Pending record created in owner's database/subscription_pending.json
//
//  2. Owner sends payment screenshot with JT-XXXX as caption to their own bot
//     → Owner's bot downloads the image, pushes it to ALL dev numbers' DMs
//     → Dev notification says: "Reply with .approvepay JT-XXXX"
//
//  3. Dev does ONE of these:
//     OPTION A (preferred): Dev messages the OWNER'S BOT NUMBER directly on WA
//                           and types .approvepay JT-XXXX
//                           → Runs inside owner's bot process
//                           → Writes to owner's database/subscription.json ✅
//
//     OPTION B (fallback):  Dev types .approvepay JT-XXXX on their own bot
//                           → Dev bot builds a signed JT-ACTIVATE payload
//                           → Sends it to owner's WhatsApp number
//                           → Owner's bot receives it as incoming msg (fromMe=false)
//                           → Validates signature, writes to its own database/ ✅
//
//  4. Owner checks .menu → Sub: Active ✅
//
// ─── AUTOSAVE PROTECTION ────────────────────────────────────────────────────
//  Payment screenshots & activate payloads are IMMEDIATELY flagged in
//  global.AUTOSAVE_PROCESSED BEFORE any async work. REF pattern in caption
//  is also blocked at the autosave level.
// ─────────────────────────────────────────────────────────────────────────────

"use strict";

const BANK  = require("../settings/bank");
const PLANS = require("../settings/plans");
const {
  normalizeNumber,
  isActive,
  activateSub,
  activateTrialHours,
  createPending,
  getPending,
  setPendingStatus,
  getSub,
  setSub,
  invalidateCache,
  getSubByRef,
  markRefUsed,
} = require("../library/subscriptionDb");
const { registerOwner, getRegisteredOwner } = require("../library/ownerRegistryDb");

const _fs   = require("fs");
const _path = require("path");
const _THUMB_PATH = _path.join(__dirname, "..", "thumbnail", "image.jpg");
function getThumb() {
  try { return _fs.existsSync(_THUMB_PATH) ? _fs.readFileSync(_THUMB_PATH) : null; } catch { return null; }
}

// ─── Constants ────────────────────────────────────────────────────────────────
const DEV_NUMBERS     = ["2349032578690", "2348166337692"];
const REF_REGEX       = /\b((?:JT|TRIAL)-[A-Z0-9]+-[A-Z0-9]+)\b/i;
const ACTIVATE_MARKER = "\u200BJTA:"; // zero-width space prefix makes it unique + invisible in chat
const REVOKE_MARKER   = "\u200BJTR:"; // zero-width space prefix — revoke payload
const RESTORE_MARKER  = "\u200BJTSR:"; // zero-width space — restore request from owner's bot to dev
const ACTIVATE_SECRET = "JT_2025_XKSECRET";

// ─── Activation payload (signed JSON) ────────────────────────────────────────
function sign(ref, user, plan, days) {
  const raw = [ref, user, plan, String(days), ACTIVATE_SECRET].join("|");
  let h = 5381;
  for (let i = 0; i < raw.length; i++) h = (((h << 5) + h) ^ raw.charCodeAt(i)) >>> 0;
  return h.toString(36).toUpperCase();
}

function buildPayload(ref, user, plan, days, amount) {
  return ACTIVATE_MARKER + JSON.stringify({ ref, user, plan, days: Number(days), amount: Number(amount || 0), sig: sign(ref, user, plan, days) });
}

function signRevoke(user, revokedBy) {
  const raw = [user, revokedBy, ACTIVATE_SECRET, "REVOKE"].join("|");
  let h = 5381;
  for (let i = 0; i < raw.length; i++) h = (((h << 5) + h) ^ raw.charCodeAt(i)) >>> 0;
  return h.toString(36).toUpperCase();
}

function buildRevokePayload(user, revokedBy, reason) {
  return REVOKE_MARKER + JSON.stringify({ user, revokedBy, reason: reason || "Revoked by developer.", sig: signRevoke(user, revokedBy) });
}

function parseRevokePayload(text) {
  try {
    if (!text || !text.startsWith(REVOKE_MARKER)) return null;
    const d = JSON.parse(text.slice(REVOKE_MARKER.length));
    if (!d.user || !d.revokedBy) return null;
    if (d.sig !== signRevoke(d.user, d.revokedBy)) { console.log("[JTR] bad sig"); return null; }
    return d;
  } catch { return null; }
}

function parsePayload(text) {
  try {
    if (!text || !text.startsWith(ACTIVATE_MARKER)) return null;
    const d = JSON.parse(text.slice(ACTIVATE_MARKER.length));
    if (!d.ref || !d.user || !d.plan || !d.days) return null;
    if (d.sig !== sign(d.ref, d.user, d.plan, d.days)) { console.log("[JTA] bad sig"); return null; }
    return d;
  } catch { return null; }
}

// ─── Restore-Request Signal (JTSR) ────────────────────────────────────────────
// Sent by the OWNER's bot to ALL dev numbers when .sub restore can't find a ref locally.
// Dev's bot passive handler picks it up, checks the owner registry, and re-fires JTA.
function signRestore(ref, requester) {
  const raw = [ref, requester, ACTIVATE_SECRET, "RESTORE_REQ"].join("|");
  let h = 5381;
  for (let i = 0; i < raw.length; i++) h = (((h << 5) + h) ^ raw.charCodeAt(i)) >>> 0;
  return h.toString(36).toUpperCase();
}

function buildRestoreRequest(ref, requester, botNum) {
  return RESTORE_MARKER + JSON.stringify({
    ref,
    requester,  // the user's number requesting restore
    botNum,     // the bot's own number (= owner's number on their instance)
    sig: signRestore(ref, requester),
    ts: Date.now(),
  });
}

function parseRestoreRequest(text) {
  try {
    if (!text || !text.startsWith(RESTORE_MARKER)) return null;
    const d = JSON.parse(text.slice(RESTORE_MARKER.length));
    if (!d.ref || !d.requester) return null;
    if (d.sig !== signRestore(d.ref, d.requester)) { console.log("[JTSR] bad sig"); return null; }
    return d;
  } catch { return null; }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function makeRef(pfx) {
  return (pfx || "JT") + "-" + Date.now().toString(36).toUpperCase() + "-" + Math.random().toString(36).slice(2,6).toUpperCase();
}

function numFrom(m, ctxNum) {
  // ctxNum is already normalised by message.js — always prefer it
  const n = normalizeNumber(ctxNum || "");
  if (n) return n;
  // fallback: read raw sender from serialized message
  return normalizeNumber(m && (m.sender || (m.key && (m.key.participant || m.key.remoteJid))) || "");
}

function isDev(num) { const d = normalizeNumber(num); return !!d && DEV_NUMBERS.includes(d); }

function planLabel(key) {
  const k = String(key || "").toLowerCase();
  const p = PLANS[k];
  if (p) return p.label;
  const t = k.match(/^trial_(\d+)h$/);
  if (t) return "Trial " + t[1] + "h";
  return key || "Unknown";
}

function fmtDate(val) {
  if (!val) return "—";
  const d = new Date(typeof val === "number" ? val : val);
  if (!isFinite(+d)) return String(val);
  const z = n => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + z(d.getMonth()+1) + "-" + z(d.getDate()) + " " + z(d.getHours()) + ":" + z(d.getMinutes());
}

function blockAS(m) {
  global.AUTOSAVE_PROCESSED = global.AUTOSAVE_PROCESSED || {};
  if (m && m.key && m.key.id) global.AUTOSAVE_PROCESSED[m.key.id] = Date.now();
}

function getMsgText(m) {
  return (
    m.text || m.body ||
    (m.msg && m.msg.caption) ||
    (m.message && (
      m.message.conversation ||
      (m.message.extendedTextMessage && m.message.extendedTextMessage.text) ||
      (m.message.imageMessage && m.message.imageMessage.caption) ||
      (m.message.videoMessage && m.message.videoMessage.caption)
    )) || ""
  );
}

async function downloadMedia(sock, m) {
  try {
    const mtype = m.mtype;
    if (!["imageMessage","videoMessage","documentMessage"].includes(mtype)) return null;
    const inner = m.msg;
    if (!inner) return null;
    const buf = await sock.downloadMediaMessage(inner);
    if (!buf || !buf.length) return null;
    return { buf, mtype, mime: inner.mimetype || (mtype === "imageMessage" ? "image/jpeg" : "video/mp4"), name: inner.fileName || "proof" };
  } catch (e) { console.log("[proof] dl err:", e && e.message); return null; }
}

async function pushToDev(sock, media, text) {
  let ok = false;
  for (const n of DEV_NUMBERS) {
    const jid = n + "@s.whatsapp.net";
    try {
      if (media) {
        const p = media.mtype === "imageMessage"   ? { image:    media.buf, caption: text, mimetype: media.mime }
                : media.mtype === "videoMessage"   ? { video:    media.buf, caption: text, mimetype: media.mime }
                :                                    { document: media.buf, caption: text, mimetype: media.mime, fileName: media.name };
        await sock.sendMessage(jid, p);
      } else {
        await sock.sendMessage(jid, { text });
      }
      ok = true;
    } catch (e) { console.log("[proof] push dev err", n, e && e.message); }
  }
  return ok;
}

function recoverPending(ref, txt) {
  const m = txt && txt.match(/DATA:user=([^|]+)\|plan=([^|]+)\|amount=([^|]+)\|ref=([^\s)]+)/i);
  if (!m) return null;
  try {
    const [, user, plan, amt, storedRef] = m;
    if (storedRef.trim().toUpperCase() !== ref) return null;
    createPending(user.trim(), plan.trim(), Number(amt.trim()) || 0, ref);
    setPendingStatus(ref, "proof_received", "recovered");
    return getPending(ref);
  } catch { return null; }
}

// ─────────────────────────────────────────────────────────────────────────────
module.exports = {
  name: "Subscription", category: "billing", desc: "Subscription + payment system",
  command: ["sub", "subscription", "approvepay", "rejectpay", "substatus", "trial", "givesub", "unrevoke", "editplan", "subresend"],
  passive: true, premiumOnly: false, devOnly: false, ownerOnly: false,

  run: async function(ctx) {
    const { m, reply, args, command, sock, isDev: callerIsDev, prefix, senderNumber: ctxNum, botNumber } = ctx;
    const isCmd  = !!command;
    const pfx    = prefix || ".";
    const myNum  = numFrom(m, ctxNum); // the number talking to the bot right now

    // ══════════════════════════════════════════════════════════════════════
    // PASSIVE MODE — no command prefix
    // ══════════════════════════════════════════════════════════════════════
    if (!isCmd) {
      const text = getMsgText(m);

      // ── OPTION B: Receive JT-ACTIVATE payload from dev's bot ─────────────
      // This arrives as an incoming message from a dev number to the owner's bot.
      // m.key.fromMe will be FALSE here because the DEV's bot sent it to the
      // owner's number — it arrives as a normal incoming DM.
      if (text && text.startsWith(ACTIVATE_MARKER)) {
        blockAS(m);

        // The sender must be a dev number
        // myNum = number of whoever sent this message
        // For a message sent by dev's bot to owner's number:
        //   m.key.remoteJid = owner's number (the conversation)
        //   m.sender = dev's number (who sent it) — BUT if fromMe=true it = bot's own number
        // We accept activation from any dev number OR if fromMe and bot is a dev number
        const senderNum = normalizeNumber(
          m.key.fromMe
            ? (sock.user && sock.user.id ? sock.user.id.split(":")[0] : "")
            : (m.sender || (m.key && (m.key.participant || m.key.remoteJid)) || "")
        );

        if (!isDev(senderNum) && !isDev(myNum)) {
          console.log("[JTA] rejected: sender", senderNum, "is not dev");
          return;
        }

        const data = parsePayload(text);
        if (!data) { console.log("[JTA] invalid payload"); return; }

        console.log("[JTA] activating:", data.user, "plan:", data.plan, "days:", data.days);
        try {
          invalidateCache();
          const sub = activateSub(data.user, data.plan, data.days, data.ref, "dev");
          try { setPendingStatus(data.ref, "approved", "activated via JTA"); } catch {}

          // Notify the owner via their own DM — with bot thumbnail
          const ownerJid  = data.user + "@s.whatsapp.net";
          const jtaThumb  = getThumb();
          const jtaText   = [
            "✅ *Payment Approved!*", "",
            "Your subscription is now ACTIVE.", "",
            "📦 Plan    : " + planLabel(data.plan),
            "📅 Expires : " + fmtDate(sub.expiresAtMs),
            "🔖 Ref     : " + data.ref, "",
            "Thank you for subscribing! 🎉",
            "Type " + pfx + "menu to see your status.",
          ].join("\n");
          if (jtaThumb) {
            sock.sendMessage(ownerJid, { image: jtaThumb, caption: jtaText }).catch(() =>
              sock.sendMessage(ownerJid, { text: jtaText }).catch(() => {})
            );
          } else {
            sock.sendMessage(ownerJid, { text: jtaText }).catch(() => {});
          }
          console.log("[JTA] ✅ done for:", data.user);
        } catch (e) { console.error("[JTA] activation err:", e && e.message); }
        return;
      }

      // ── REVOKE payload: JTR — from dev's bot, revokes subscription ────────
      if (text && text.startsWith(REVOKE_MARKER)) {
        blockAS(m);
        const senderNum = normalizeNumber(
          m.key.fromMe
            ? (sock.user && sock.user.id ? sock.user.id.split(":")[0] : "")
            : (m.sender || (m.key && (m.key.participant || m.key.remoteJid)) || "")
        );
        if (!isDev(senderNum) && !isDev(myNum)) {
          console.log("[JTR] rejected: sender", senderNum, "is not dev");
          return;
        }
        const rdata = parseRevokePayload(text);
        if (!rdata) { console.log("[JTR] invalid payload"); return; }
        console.log("[JTR] revoking:", rdata.user);
        try {
          invalidateCache();
          setSub(rdata.user, { expiresAtMs: 1, expiresAt: new Date(1).toISOString(), revokedAt: new Date().toISOString(), revokedBy: rdata.revokedBy, revokeReason: rdata.reason || "Revoked by developer." });
          const targetJid = rdata.user + "@s.whatsapp.net";
          await sock.sendMessage(targetJid, {
            text: "❌ *Subscription Revoked*\n\nYour subscription has been removed by the developer.\n\n📌 *Reason:* " + (rdata.reason || "Revoked by developer.") + "\n\nIf you believe this is a mistake, contact us:\n📲 wa.me/2349032578690",
          }).catch(() => {});
          console.log("[JTR] ✅ revoked for:", rdata.user);
        } catch (e) { console.error("[JTR] revoke err:", e && e.message); }
        return;
      }

      // ── RESTORE REQUEST (JTSR): owner's bot lost its DB — re-activate sub ─
      // Arrives on DEV's bot from the owner's bot after a redeploy wipes the DB.
      // Validates via owner registry and re-fires JTA activation to owner's bot.
      if (text && text.startsWith(RESTORE_MARKER)) {
        blockAS(m);

        // Only process on a dev's bot instance
        const myBotNum = normalizeNumber(sock.user?.id?.split(":")?.[0] || "");
        if (!isDev(myBotNum) && !DEV_NUMBERS.some(d => isDev(d))) {
          // Not a dev bot — silently ignore
          return;
        }

        // Sender must be a non-dev number (the owner's bot)
        const senderNum = normalizeNumber(
          m.key.fromMe
            ? myBotNum
            : (m.sender || m.key?.participant || m.key?.remoteJid || "")
        );

        const rreq = parseRestoreRequest(text);
        if (!rreq) { console.log("[JTSR] invalid payload or bad sig"); return; }

        const { ref: rrRef, requester: rrRequester, botNum: rrBotNum } = rreq;
        console.log("[JTSR] restore request — ref:", rrRef, "requester:", rrRequester, "botNum:", rrBotNum);

        // Look up in owner registry
        let regEntry = null;
        try {
          const { getRegisteredOwner } = require("../library/ownerRegistryDb");
          // Try by botNum (= owner's number) first, then by requester
          regEntry = getRegisteredOwner(rrBotNum || rrRequester) || getRegisteredOwner(rrRequester);
        } catch (e) { console.log("[JTSR] registry lookup err:", e && e.message); }

        if (!regEntry) {
          console.log("[JTSR] ❌ no registry entry for botNum:", rrBotNum, "requester:", rrRequester);
          // Notify dev that we couldn't auto-restore
          const devNotice = "[JTSR] ⚠️ Restore request from +" + (rrBotNum || rrRequester) +
            " for ref " + rrRef + " — NOT found in registry. Manual action needed.";
          for (const devNum of DEV_NUMBERS) {
            sock.sendMessage(devNum + "@s.whatsapp.net", { text: devNotice }).catch(() => {});
          }
          // Tell the owner's bot we couldn't auto-restore
          const ownerBotJid = (rrBotNum || rrRequester) + "@s.whatsapp.net";
          sock.sendMessage(ownerBotJid, {
            text: "⚠️ Auto-restore could not find your ref *" + rrRef + "* in the registry.\n\n" +
              "Please contact the developer to manually reactivate your subscription:\n📲 wa.me/2349032578690",
          }).catch(() => {});
          return;
        }

        // Validate: ref must match what's in the registry
        const registryRef = String(regEntry.ref || "").toUpperCase();
        const requestRef  = String(rrRef || "").toUpperCase();
        if (registryRef && registryRef !== requestRef) {
          console.log("[JTSR] ❌ ref mismatch — registry has:", registryRef, "requested:", requestRef);
          const ownerBotJid = (rrBotNum || rrRequester) + "@s.whatsapp.net";
          sock.sendMessage(ownerBotJid, {
            text: "❌ Restore ref *" + rrRef + "* does not match the ref on record for your number.\n\n" +
              "Please contact the developer:\n📲 wa.me/2349032578690",
          }).catch(() => {});
          return;
        }

        // All good — re-fire JTA activation to the owner's bot
        const { PLANS } = (() => { try { return { PLANS: require("../settings/plans") }; } catch { return { PLANS: {} }; } })();
        const planKey = regEntry.plan;
        const plan = PLANS[planKey];
        const days = plan ? plan.days : Math.ceil((Number(regEntry.expiresAtMs || 0) - Date.now()) / 86400000);
        const daysToUse = Math.max(days || 30, 1);
        const targetNum = rrBotNum || rrRequester;

        const payload = buildPayload(requestRef, targetNum, planKey, daysToUse, 0);
        const targetJid = targetNum + "@s.whatsapp.net";

        try {
          await sock.sendMessage(targetJid, { text: payload });
          console.log("[JTSR] ✅ re-fired JTA to:", targetNum, "plan:", planKey, "days:", daysToUse);

          // Notify dev of auto-restore
          const devNote = "✅ [JTSR] Auto-restored +" + targetNum + " — ref: " + requestRef + " — plan: " + planKey;
          for (const devNum of DEV_NUMBERS) {
            if (normalizeNumber(devNum) !== normalizeNumber(myBotNum)) {
              sock.sendMessage(devNum + "@s.whatsapp.net", { text: devNote }).catch(() => {});
            }
          }
        } catch (e) {
          console.error("[JTSR] failed to send JTA:", e && e.message);
        }
        return;
      }

      // ── Payment proof screenshot ──────────────────────────────────────────
      const mtype = m && m.mtype;
      if (!["imageMessage","videoMessage","documentMessage"].includes(mtype)) return;

      const caption = (m.msg && m.msg.caption) || m.body || "";

      const hit = caption && caption.match(REF_REGEX);
      if (!hit) return;

      const ref    = hit[1].toUpperCase();
      const sender = myNum;
      if (!sender) return;

      // Block autosave BEFORE any await
      blockAS(m);

      const pend = getPending(ref);
      if (!pend) return;
      if (pend.status === "approved" || pend.status === "rejected") return;
      if (pend.user !== sender) return;

      try {
        const media = await downloadMedia(sock, m);

        const note = [
          "💳 *New Payment Proof*", "",
          "👤 From   : +" + sender,
          "🔖 Ref    : " + ref,
          "📦 Plan   : " + planLabel(pend.plan),
          "💰 Amount : ₦" + Number(pend.amount || 0).toLocaleString(), "",
          "─────────────────────",
          "HOW TO APPROVE:", "",
          "OPTION A — Message the owner's bot directly:",
          "  DM this number on WhatsApp: +" + pend.user,
          "  Then type: *" + pfx + "approvepay " + ref + "*", "",
          "OPTION B — Use your own bot:",
          "  *" + pfx + "approvepay " + ref + "*",
          "  (will send an activation message to owner)", "",
          "To reject: *" + pfx + "rejectpay " + ref + " <reason>*",
          "─────────────────────",
          "(DATA:user=" + pend.user + "|plan=" + pend.plan + "|amount=" + pend.amount + "|ref=" + ref + ")",
        ].join("\n");

        const sent = await pushToDev(sock, media, note);
        if (!sent) await pushToDev(sock, null, note);

        setPendingStatus(ref, "proof_received", "forwarded to dev");

        await reply(
          "✅ *Payment Proof Received!*\n\n" +
          "Your screenshot has been forwarded to the developer.\n\n" +
          "📋 Ref    : " + ref + "\n" +
          "📦 Plan   : " + planLabel(pend.plan) + "\n" +
          "💰 Amount : ₦" + Number(pend.amount || 0).toLocaleString() + "\n\n" +
          "⏳ You'll be notified once your payment is confirmed.\n" +
          "Check status: " + pfx + "substatus " + ref
        );
      } catch (e) { console.log("[proof] err:", e && e.message); }
      return;
    }

    // ══════════════════════════════════════════════════════════════════════
    // COMMAND MODE
    // ══════════════════════════════════════════════════════════════════════
    if (!myNum) return reply("❌ Could not detect your number.");

    const a0 = String(args[0] || "").toLowerCase().trim();

    // ── .sub ─────────────────────────────────────────────────────────────
    if (command === "sub" || command === "subscription") {

      if (!a0 || a0 === "help") {
        return reply(
          "💳 *Subscription Menu*\n\n" +
          pfx + "sub plans             — view available plans\n" +
          pfx + "sub status            — check your subscription\n" +
          pfx + "sub buy <plan>        — generate payment reference\n" +
          pfx + "sub restore <ref>     — restore lost subscription\n" +
          pfx + "substatus <ref>       — track a reference\n\n" +
          "📸 After paying, send your screenshot here with the *ref code as caption*.\n\n" +
          (callerIsDev
            ? "🛠 *Dev:* " + pfx + "trial <Nh> [num]  |  " + pfx + "givesub <num> <plan>  |  " + pfx + "approvepay  |  " + pfx + "rejectpay\n" +
              "         " + pfx + "sub extend <num> <days>  |  " + pfx + "sub revoke <num>  |  " + pfx + "sub info <num>  |  " + pfx + "sub list"
            : "")
        );
      }

      if (a0 === "plans") {
        return reply(
          "📦 *Available Plans*\n\n" +
          Object.entries(PLANS).map(([k,v]) =>
            "• *" + k + "* — " + v.label + " (" + v.days + " days) — ₦" + v.price.toLocaleString()
          ).join("\n")
        );
      }

      if (a0 === "status") {
        invalidateCache();
        const rec = getSub(myNum);
        if (!rec || !isActive(rec)) {
          return reply("📋 *Subscription Status*\n\nStatus : INACTIVE ❌\n\nNo active subscription.\nSee: " + pfx + "sub plans\n\nIf you already paid, use: " + pfx + "sub restore <ref>");
        }
        return reply(
          "📋 *Subscription Status*\n\n" +
          "Status  : ACTIVE ✅\n" +
          "Plan    : " + planLabel(rec.plan) + "\n" +
          "Expires : " + fmtDate(rec.expiresAtMs)
        );
      }

      if (a0 === "restore") {
        // Premium user restores lost subscription using their original ref code.
        // Looks up ref in BOTH pending DB and subscription.json (covers givesub refs).
        const ref = String(args[1] || "").trim().toUpperCase();
        if (!ref) {
          return reply(
            "Usage: " + pfx + "sub restore <ref>\n\n" +
            "Example: " + pfx + "sub restore JT-XXXX-YYYY\n\n" +
            "Your ref code was provided when your payment was approved.\n" +
            "Check your old messages or contact the developer."
          );
        }

        invalidateCache();

        // ── Step 1: Try pending DB ──────────────────────────────────────────
        let pend = getPending(ref);
        let planKey  = pend?.plan;
        let refUser  = pend?.user;
        let refStatus = pend?.status;
        let usedAt   = pend?.usedAt;

        // ── Step 2: Fallback — look up ref in subscription.json ────────────
        // This handles refs from .givesub which don't create pending records
        if (!pend) {
          const subMatch = getSubByRef(ref);
          if (subMatch) {
            refUser   = subMatch.user;
            planKey   = subMatch.sub.plan;
            refStatus = "approved"; // if it's in sub DB it was approved
            usedAt    = subMatch.sub.refUsedAt;
          }
        }

        // ── Step 3: Not found locally — send restore-request to dev's bot ──
        // This happens after a redeploy wipes the owner's database/ folder.
        // Dev's bot has the central owner registry and will re-fire the JTA payload.
        if (!refUser) {
          // Send signed JTSR signal to all dev numbers
          const botNum = normalizeNumber(botNumber || "");
          const requester = myNum;
          let signalSent = false;
          try {
            const restoreSignal = buildRestoreRequest(ref, requester, botNum);
            for (const devNum of DEV_NUMBERS) {
              try {
                await sock.sendMessage(devNum + "@s.whatsapp.net", { text: restoreSignal });
                signalSent = true;
              } catch {}
            }
          } catch {}

          if (signalSent) {
            return reply(
              "⏳ *Restore Request Sent*\n\n" +
              "Ref *" + ref + "* was not found in the local database.\n\n" +
              "This usually happens after a bot redeploy wipes the database folder.\n\n" +
              "✅ A restore request has been sent to the developer's bot.\n" +
              "Your subscription will be re-activated automatically within a few seconds.\n\n" +
              "If it doesn't activate, contact the developer:\n📲 wa.me/2349032578690"
            );
          }

          return reply(
            "❌ Ref *" + ref + "* not found.\n\n" +
            "Possible reasons:\n" +
            "• The ref code was mistyped — check carefully\n" +
            "• The ref belongs to a different bot\n" +
            "• The ref was never approved\n\n" +
            "Contact the developer if you need help:\n📲 wa.me/2349032578690"
          );
        }

        // ── Ref belongs to a different number ─────────────────────────────
        if (refUser !== myNum && !callerIsDev) {
          return reply("❌ This ref does not belong to your number.\n\nEach ref is unique to the subscriber who paid for it.");
        }

        // ── Ref not yet approved ───────────────────────────────────────────
        if (pend && refStatus !== "approved") {
          return reply(
            "❌ Ref *" + ref + "* has not been approved yet.\n\n" +
            "Status: " + refStatus + "\n\n" +
            "Contact the developer to approve your payment:\n📲 wa.me/2349032578690"
          );
        }

        // ── User is currently revoked — block restore + show reason ────────
        const currentSub = getSub(myNum);
        if (currentSub && currentSub.revokedAt) {
          const revokeReason = currentSub.revokeReason || "Subscription was revoked by the developer.";
          return reply(
            "🚫 *Subscription Restore Blocked*\n\n" +
            "Your subscription has been revoked and cannot be restored.\n\n" +
            "📌 *Reason:* " + revokeReason + "\n\n" +
            "If you believe this is a mistake, contact the developer:\n" +
            "📲 wa.me/2349032578690\n" +
            "📧 justicetechautosave@gmail.com"
          );
        }

        // ── Ref already used AND subscription is still active ─────────────
        if (usedAt && !callerIsDev) {
          // Allow re-restore if the subscription has since expired
          const currentSub2 = getSub(myNum);
          if (currentSub2 && isActive(currentSub2) && !currentSub2.revokedAt) {
            return reply(
              "✅ *Your subscription is already active!*\n\n" +
              "Plan    : " + planLabel(currentSub2.plan) + "\n" +
              "Expires : " + fmtDate(currentSub2.expiresAtMs) + "\n\n" +
              "No restore needed."
            );
          }
          // Sub expired — allow restore even if ref was previously used
          // (fall through to restore logic below)
        }

        // ── Already active — no restore needed ────────────────────────────
        if (currentSub && isActive(currentSub) && !currentSub.revokedAt) {
          return reply(
            "✅ *Your subscription is already active!*\n\n" +
            "Plan    : " + planLabel(currentSub.plan) + "\n" +
            "Expires : " + fmtDate(currentSub.expiresAtMs) + "\n\n" +
            "No restore needed."
          );
        }

        // ── All checks passed — restore subscription ───────────────────────
        const plan = PLANS[planKey];
        if (!plan) return reply("❌ Plan *" + planKey + "* not recognized. Contact the developer.");

        try {
          // Activate for the person running the command (myNum)
          // refUser === myNum for non-devs (enforced above), so this is safe
          const restoreFor = callerIsDev ? (refUser || myNum) : myNum;
          const sub = activateSub(restoreFor, planKey, plan.days, ref, "restore");
          // Mark ref as used so it cannot be abused (but expiry allows re-restore)
          markRefUsed(ref, myNum);

          const restoreThumb = getThumb();
          const restoreText =
            "✅ *Subscription Restored!*\n\n" +
            "Your subscription has been successfully restored.\n\n" +
            "📦 Plan    : " + plan.label + "\n" +
            "📅 Expires : " + fmtDate(sub.expiresAtMs) + "\n" +
            "🔖 Ref     : " + ref + "\n\n" +
            "Type " + pfx + "menu to see your status. 🎉";

          if (restoreThumb) {
            sock.sendMessage(restoreFor + "@s.whatsapp.net", { image: restoreThumb, caption: restoreText }).catch(() =>
              sock.sendMessage(restoreFor + "@s.whatsapp.net", { text: restoreText }).catch(() => {})
            );
          } else {
            sock.sendMessage(restoreFor + "@s.whatsapp.net", { text: restoreText }).catch(() => {});
          }

          return reply(
            "✅ *Subscription Restored!*\n\n" +
            "Plan    : " + plan.label + "\n" +
            "Expires : " + fmtDate(sub.expiresAtMs) + "\n" +
            "Ref     : " + ref + "\n\n" +
            "✅ Subscription is now active."
          );
        } catch (e) {
          return reply("❌ Restore failed: " + (e && e.message) + "\n\nContact the developer for manual restoration.");
        }
      }

      if (a0 === "buy") {
        const pk = String(args[1] || "").toLowerCase().trim();
        const pl = PLANS[pk];
        if (!pl) return reply("❌ Unknown plan. Options: *" + Object.keys(PLANS).join(", ") + "*\n\nSee: " + pfx + "sub plans");
        const ref = makeRef("JT");
        createPending(myNum, pk, pl.price, ref);
        return reply(
          "✅ *Payment Reference Created*\n\n" +
          "Plan   : " + pl.label + "\n" +
          "Amount : ₦" + pl.price.toLocaleString() + "\n\n" +
          "💳 *Pay To:*\n" +
          "Bank    : " + BANK.bankName + "\n" +
          "Account : " + BANK.accountNumber + "\n" +
          "Name    : " + BANK.accountName + "\n\n" +
          "📌 *Narration/Description:*\n" + ref + "\n\n" +
          "📸 *After paying:*\n" +
          "Send your payment screenshot HERE with *" + ref + "* as the caption.\n\n" +
          "Check status: " + pfx + "substatus " + ref
        );
      }

      // ─── DEV-ONLY sub sub-commands ─────────────────────────────────────────
      if (!isDev(myNum)) return reply("❓ Unknown. Try: " + pfx + "sub help");

      // .sub extend <number> <days>
      if (a0 === "extend") {
        const target = normalizeNumber(String(args[1] || "").trim());
        const days   = parseInt(args[2], 10);
        if (!target || isNaN(days) || days < 1) {
          return reply("Usage: " + pfx + "sub extend <number> <days>\nExample: " + pfx + "sub extend 2348012345678 30");
        }
        invalidateCache();
        const existing = getSub(target);
        if (!existing) return reply("❌ +" + target + " has no subscription. Use " + pfx + "givesub to grant one.");
        const base      = Math.max(Number(existing.expiresAtMs || 0), Date.now());
        const newExpiry = base + days * 24 * 60 * 60 * 1000;
        setSub(target, { expiresAtMs: newExpiry, expiresAt: new Date(newExpiry).toISOString() });
        const extRef    = makeRef("JT");
        const payload   = buildPayload(extRef, target, existing.plan || "monthly", days, 0);
        sock.sendMessage(target + "@s.whatsapp.net", { text: payload }).catch(() => {});
        sock.sendMessage(target + "@s.whatsapp.net", {
          text: "✅ *Subscription Extended!*\n\nPlan    : " + planLabel(existing.plan) + "\nExpires : " + fmtDate(newExpiry) + "\n\nThe developer extended your subscription by " + days + " day(s). 🎉",
        }).catch(() => {});
        return reply("✅ Extended *+" + target + "* by *" + days + " day(s)*.\nNew expiry: " + fmtDate(newExpiry));
      }

      // .sub revoke <number> [reason]
      if (a0 === "revoke") {
        const target = normalizeNumber(String(args[1] || "").trim());
        if (!target) return reply("Usage: " + pfx + "sub revoke <number> [reason]\n\nExample:\n" + pfx + "sub revoke 2348012345678 Chargeback detected");
        const reason = args.slice(2).join(" ").trim() || "Subscription revoked by developer.";
        invalidateCache();
        const existing = getSub(target);
        const isOnThisBot = botNumber && normalizeNumber(botNumber) === normalizeNumber(target);

        const revokeMsg =
          "❌ *Subscription Revoked*\n\n" +
          "Your subscription has been removed by the developer.\n\n" +
          "📌 *Reason:* " + reason + "\n\n" +
          "If you believe this is a mistake, contact us:\n" +
          "📲 wa.me/2349032578690";

        if (existing) {
          setSub(target, { expiresAtMs: 1, expiresAt: new Date(1).toISOString(), revokedAt: new Date().toISOString(), revokedBy: myNum, revokeReason: reason });
          sock.sendMessage(target + "@s.whatsapp.net", { text: revokeMsg }).catch(() => {});
          return reply("✅ Subscription revoked for *+" + target + "*.\n📌 Reason: " + reason + "\nAccess removed immediately.");
        } else if (!isOnThisBot) {
          const revokePayload = buildRevokePayload(target, myNum, reason);
          try {
            await sock.sendMessage(target + "@s.whatsapp.net", { text: revokePayload });
            return reply(
              "✅ *Revoke signal sent!*\n\n" +
              "User   : +" + target + "\n" +
              "Reason : " + reason + "\n" +
              "Status : Revoke delivered to their bot. ❌"
            );
          } catch (e) {
            return reply("❌ Could not send revoke signal to +" + target + ": " + (e && e.message));
          }
        } else {
          return reply("ℹ️ +" + target + " has no subscription on record.");
        }
      }

      // .sub info <number>
      if (a0 === "info") {
        const target = normalizeNumber(String(args[1] || "").trim());
        if (!target) return reply("Usage: " + pfx + "sub info <number>");
        invalidateCache();
        const rec = getSub(target);
        let banLine = "\nBan Status : ✅ Clear";
        try {
          const { getBanEntry } = require("../library/banDb");
          const be = getBanEntry(target);
          if (be) banLine = "\nBan Status : " + (be.type === "suspend" ? "🔶 SUSPENDED" : "🚫 BANNED") + "\nBan Reason : " + be.reason;
        } catch {}
        if (!rec) return reply("📋 *Sub Info: +" + target + "*\n\nSubscription : NONE" + banLine);
        return reply(
          "📋 *Sub Info: +" + target + "*\n\n" +
          "Plan     : " + planLabel(rec.plan) + "\n" +
          "Status   : " + (isActive(rec) ? "✅ ACTIVE" : "❌ EXPIRED") + "\n" +
          "Started  : " + fmtDate(rec.startedAtMs) + "\n" +
          "Expires  : " + fmtDate(rec.expiresAtMs) + "\n" +
          "Ref      : " + (rec.ref || "—") + "\n" +
          "Approved : " + (rec.approvedBy || "—") +
          banLine
        );
      }

      // .sub list
      if (a0 === "list") {
        invalidateCache();
        try {
          const fsLocal = require("fs");
          const pathLocal = require("path");

          // ── Primary: central owner registry (dev's cross-instance truth) ──
          const REG_FILE = pathLocal.join(__dirname, "..", "database", "approved_owners.json");
          const SUB_FILE_LOCAL = require("../library/subscriptionDb").SUB_FILE;

          let entries = [];

          if (fsLocal.existsSync(REG_FILE)) {
            const reg = JSON.parse(fsLocal.readFileSync(REG_FILE, "utf8"));
            for (const [num, entry] of Object.entries(reg.owners || {})) {
              const activeReg = Number(entry.expiresAtMs || 0) > Date.now();
              entries.push([num, {
                plan:        entry.plan || "unknown",
                expiresAtMs: entry.expiresAtMs || 0,
                ref:         entry.ref || "—",
                _active:     activeReg,
                _source:     "registry",
              }]);
            }
          }

          // Also merge local subscription.json (catches locally-granted subs)
          if (fsLocal.existsSync(SUB_FILE_LOCAL)) {
            const db = JSON.parse(fsLocal.readFileSync(SUB_FILE_LOCAL, "utf8"));
            const regNums = new Set(entries.map(([n]) => n));
            for (const [num, sub] of Object.entries(db.users || {})) {
              if (!regNums.has(num)) {
                entries.push([num, {
                  ...sub,
                  _active:  isActive(sub),
                  _source:  "local",
                }]);
              }
            }
          }

          if (!entries.length) return reply("📋 No subscriptions recorded yet.");

          const active  = entries.filter(([, s]) => s._active);
          const expired = entries.filter(([, s]) => !s._active);
          const lines   = [
            ...active.map(([n, s])  => "✅ +" + n + " — " + planLabel(s.plan) + " (expires " + fmtDate(s.expiresAtMs) + ")"),
            ...expired.map(([n, s]) => "❌ +" + n + " — " + planLabel(s.plan) + " (expired)"),
          ].join("\n");
          return reply("📋 *Subscriptions* (" + entries.length + " total, " + active.length + " active)\n\n" + lines);
        } catch (e) {
          return reply("❌ Could not read subscriptions: " + e.message);
        }
      }

      return reply("❓ Unknown. Try: " + pfx + "sub help");
    }

    // ── .substatus ────────────────────────────────────────────────────────
    if (command === "substatus") {
      const ref = String(args[0] || "").trim().toUpperCase();
      if (!ref) return reply("Usage: " + pfx + "substatus JT-XXXX");
      const p = getPending(ref);
      if (!p) return reply("❌ Ref not found.");
      if (!callerIsDev && p.user !== myNum) return reply("❌ This ref doesn't belong to your number.");
      const icons = { pending:"⏳", proof_received:"📩", awaiting_proof:"📋", approved:"✅", rejected:"❌" };
      return reply(
        "📋 *Reference Status*\n\n" +
        "Ref    : " + p.ref + "\n" +
        "Plan   : " + planLabel(p.plan) + "\n" +
        "Amount : ₦" + Number(p.amount||0).toLocaleString() + "\n" +
        "Status : " + (icons[p.status]||"❓") + " " + p.status.replace(/_/g," ").toUpperCase() +
        (p.note ? "\nNote   : " + p.note : "")
      );
    }

    // ── DEV ONLY ──────────────────────────────────────────────────────────
    if (!isDev(myNum)) return reply("🔒 Dev only.");

    // ── .approvepay ───────────────────────────────────────────────────────
    if (command === "approvepay") {
      const ref = String(args[0] || "").trim().toUpperCase();
      if (!ref) return reply("Usage: " + pfx + "approvepay JT-XXXX");

      let p = getPending(ref);

      // Recovery from quoted notification
      if (!p) {
        const qt = m.quoted && (m.quoted.text || m.quoted.body || "");
        if (qt) p = recoverPending(ref, qt);
      }

      if (!p) return reply(
        "❌ Ref not found: *" + ref + "*\n\n" +
        "If bot restarted, reply to the original screenshot notification and run again."
      );
      if (p.status === "approved") return reply("✅ Already approved.");
      if (p.status === "rejected") return reply("❌ Already rejected.");

      const plan = PLANS[p.plan];
      if (!plan) return reply("❌ Plan \"" + p.plan + "\" missing from settings/plans.js");

      // ── Detect WHERE this command is running ──────────────────────────
      // If dev is messaging the OWNER's bot directly (Option A):
      //   botNumber = owner's number
      //   p.user    = owner's number  → they match → write locally ✅
      //
      // If dev is messaging their OWN bot (Option B):
      //   botNumber = dev's number
      //   p.user    = owner's number  → they DON'T match → send JTA payload

      const isRunningOnOwnerBot = (botNumber && normalizeNumber(botNumber) === normalizeNumber(p.user));

      if (isRunningOnOwnerBot) {
        // ── OPTION A: Writing directly to owner bot's database ────────────
        console.log("[approvepay] OPTION A — writing to owner's local database");
        invalidateCache();
        const sub = activateSub(p.user, p.plan, plan.days, ref, myNum);
        setPendingStatus(ref, "approved", "approved by dev (direct)");

        // ── Write to central owner registry (dev's bot) ───────────────────
        try { registerOwner(p.user, p.plan, ref, myNum, sub.expiresAtMs); } catch {}

        // Notify owner with bot thumbnail
        const approveThumb = getThumb();
        const approveText = [
          "✅ *Payment Approved!*", "",
          "Your subscription is now ACTIVE!", "",
          "📦 Plan    : " + plan.label,
          "📅 Expires : " + fmtDate(sub.expiresAtMs),
          "🔖 Ref     : " + ref, "",
          "Thank you for subscribing to JusticeTech! 🎉",
          "Type " + pfx + "menu to see your new status.",
        ].join("\n");
        if (approveThumb) {
          sock.sendMessage(p.user + "@s.whatsapp.net", { image: approveThumb, caption: approveText }).catch(() =>
            sock.sendMessage(p.user + "@s.whatsapp.net", { text: approveText }).catch(() => {})
          );
        } else {
          sock.sendMessage(p.user + "@s.whatsapp.net", { text: approveText }).catch(() => {});
        }

        return reply("✅ Approved *" + ref + "* — " + plan.label + " activated for +" + p.user);
      } else {
        // ── OPTION B: Send JTA activation payload to owner's number ──────
        console.log("[approvepay] OPTION B — sending JTA payload to owner's number:", p.user);
        const payload = buildPayload(ref, p.user, p.plan, plan.days, p.amount);
        try {
          await sock.sendMessage(p.user + "@s.whatsapp.net", { text: payload });
          setPendingStatus(ref, "approved", "JTA payload sent");

          // ── Write to central owner registry on dev's bot ─────────────────
          const expiresAtMs = Date.now() + plan.days * 24 * 60 * 60 * 1000;
          try { registerOwner(p.user, p.plan, ref, myNum, expiresAtMs); } catch {}

          return reply(
            "✅ Approved *" + ref + "*\n" +
            "Plan : " + plan.label + "\n" +
            "User : +" + p.user + "\n\n" +
            "Activation message sent to owner's bot. ✅\n" +
            "Their status will show ACTIVE immediately."
          );
        } catch (e) {
          return reply(
            "❌ Could not send activation to +" + p.user + "\n" +
            "Error: " + (e && e.message) + "\n\n" +
            "Alternative: Message the owner's bot (+  " + p.user + ") directly on WA\n" +
            "and type: " + pfx + "approvepay " + ref
          );
        }
      }
    }

    // ── .rejectpay ────────────────────────────────────────────────────────
    if (command === "rejectpay") {
      const ref  = String(args[0] || "").trim().toUpperCase();
      const note = args.slice(1).join(" ").trim() || "rejected by dev";
      if (!ref) return reply("Usage: " + pfx + "rejectpay JT-XXXX [reason]");
      const p = getPending(ref);
      if (!p) return reply("❌ Ref not found.");
      if (p.status === "rejected") return reply("❌ Already rejected.");
      setPendingStatus(ref, "rejected", note);
      await sock.sendMessage(p.user + "@s.whatsapp.net", {
        text: "❌ *Payment Rejected*\n\nRef    : " + ref + "\nReason : " + note + "\n\nContact dev if you think this is wrong.",
      }).catch(() => {});
      return reply("❌ Rejected *" + ref + "* for +" + p.user);
    }

    // ── .trial ────────────────────────────────────────────────────────────
    if (command === "trial") {
      const t = String(args[0] || "").toLowerCase().trim();
      if (!t) return reply("Usage: " + pfx + "trial <Nh> [number]  e.g. .trial 2h 2348012345678");
      const hrs = parseInt(t.replace(/[^0-9]/g, ""), 10);
      if (!hrs || hrs < 1 || hrs > 72) return reply("❌ Hours must be 1–72.");
      const target = normalizeNumber(args[1] || "") || myNum;
      const ref    = makeRef("TRIAL");

      // Same dual-option logic as approvepay
      const isOnTargetBot = botNumber && normalizeNumber(botNumber) === normalizeNumber(target);

      if (isOnTargetBot) {
        // Running on target's own bot — write directly
        invalidateCache();
        const sub = activateTrialHours(target, hrs, ref, myNum);
        await sock.sendMessage(target + "@s.whatsapp.net", {
          text: "🎁 *Trial Activated!*\n\nPlan    : " + planLabel(sub.plan) + "\nExpires : " + fmtDate(sub.expiresAtMs) + "\nRef     : " + ref,
        }).catch(() => {});
        return reply("✅ Trial granted to *+" + target + "* — " + hrs + "h");
      } else {
        // Send JTA payload to target's bot
        const payload = buildPayload(ref, target, "trial_" + hrs + "h", hrs / 24, 0);
        try {
          await sock.sendMessage(target + "@s.whatsapp.net", { text: payload });
          return reply("✅ Trial activation sent to *+" + target + "*\n" + hrs + "h — activates automatically.");
        } catch (e) {
          return reply("❌ Could not send trial to +" + target + ": " + (e && e.message));
        }
      }
    }

    // ── .givesub ──────────────────────────────────────────────────────────
    // Dev directly grants any plan to any number without needing a payment ref
    if (command === "givesub") {
      const targetRaw = String(args[0] || "").trim();
      const planKey   = String(args[1] || "").toLowerCase().trim();

      if (!targetRaw || !planKey) {
        return reply(
          "Usage: " + pfx + "givesub <number> <plan>\n\n" +
          "Example: " + pfx + "givesub 2348012345678 monthly\n\n" +
          "Plans: " + Object.keys(PLANS).join(", ")
        );
      }

      const target = normalizeNumber(targetRaw);
      if (!target) return reply("❌ Invalid number: " + targetRaw);

      const plan = PLANS[planKey];
      if (!plan) return reply("❌ Unknown plan: *" + planKey + "*\n\nPlans: " + Object.keys(PLANS).join(", "));

      const ref = makeRef("JT");
      const isOnTargetBot = botNumber && normalizeNumber(botNumber) === normalizeNumber(target);
      const expiresAtMs = Date.now() + plan.days * 24 * 60 * 60 * 1000;

      if (isOnTargetBot) {
        // Running on target's own bot — write directly
        invalidateCache();
        const sub = activateSub(target, planKey, plan.days, ref, myNum);
        const giveThumb = getThumb();
        const giveText  = [
          "🎁 *Subscription Granted!*", "",
          "The developer has gifted you a subscription.", "",
          "📦 Plan    : " + plan.label,
          "📅 Expires : " + fmtDate(sub.expiresAtMs),
          "🔖 Ref     : " + ref, "",
          "Type " + pfx + "menu to see your new status. 🎉",
        ].join("\n");
        if (giveThumb) {
          sock.sendMessage(target + "@s.whatsapp.net", { image: giveThumb, caption: giveText }).catch(() =>
            sock.sendMessage(target + "@s.whatsapp.net", { text: giveText }).catch(() => {})
          );
        } else {
          sock.sendMessage(target + "@s.whatsapp.net", { text: giveText }).catch(() => {});
        }
        // Always register in central registry
        try { registerOwner(target, planKey, ref, myNum, sub.expiresAtMs); } catch {}
        return reply("✅ *Subscription granted!*\n\nUser : +" + target + "\nPlan : " + plan.label + "\nRef  : " + ref + "\nExpires: " + fmtDate(expiresAtMs));
      } else {
        // Send JTA payload to target's bot
        const payload = buildPayload(ref, target, planKey, plan.days, 0);
        try {
          await sock.sendMessage(target + "@s.whatsapp.net", { text: payload });
          // Register in central registry (dev's bot is authoritative)
          try { registerOwner(target, planKey, ref, myNum, expiresAtMs); } catch {}
          return reply(
            "✅ *Subscription granted!*\n\n" +
            "User    : +" + target + "\n" +
            "Plan    : " + plan.label + "\n" +
            "Ref     : " + ref + "\n" +
            "Expires : " + fmtDate(expiresAtMs) + "\n\n" +
            "Activation sent to their bot — activates automatically. ✅"
          );
        } catch (e) {
          return reply("❌ Could not send activation to +" + target + ": " + (e && e.message));
        }
      }
    }

    // ── .unrevoke <number> [plan] ─────────────────────────────────────────────
    if (command === "unrevoke") {
      if (!callerIsDev) return reply("🔒 Developer-only command.");
      const target  = normalizeNumber(String(args[0] || "").trim());
      const planArg = String(args[1] || "").toLowerCase().trim();
      if (!target) return reply(
        "Usage: " + pfx + "unrevoke <number> [plan]\n\n" +
        "Examples:\n" +
        pfx + "unrevoke 2348012345678\n" +
        pfx + "unrevoke 2348012345678 monthly   ← use when no DB record found"
      );

      invalidateCache();
      const rec    = getSub(target);
      const regRec = !rec ? getRegisteredOwner(target) : null;

      // Determine plan from DB, registry, or manual arg override
      const planKey = planArg || rec?.plan || regRec?.plan;
      const ref     = rec?.ref || regRec?.ref;
      const plan    = PLANS[planKey];

      // No record at all and no plan arg provided
      if (!rec && !regRec && !planArg) {
        return reply(
          "❌ No record found for *+" + target + "*\n\n" +
          "This happens when the sub was cross-instance (on their own bot) or predates the registry.\n\n" +
          "Fix: specify the plan to restore:\n" +
          pfx + "unrevoke " + target + " monthly\n" +
          pfx + "unrevoke " + target + " m3\n" +
          pfx + "unrevoke " + target + " m6\n" +
          pfx + "unrevoke " + target + " yearly\n\n" +
          "Or: " + pfx + "givesub " + target + " <plan>"
        );
      }

      if (!plan) {
        return reply(
          "❌ Plan *" + (planKey || "unknown") + "* not in plans config.\n\n" +
          "Available: " + Object.keys(PLANS).join(", ")
        );
      }

      const newExpiry = Date.now() + plan.days * 24 * 60 * 60 * 1000;
      const thumb     = getThumb();
      const notifText =
        "✅ *Subscription Reinstated*\n\n" +
        "Your subscription has been restored by the developer.\n\n" +
        "📦 Plan    : " + planLabel(planKey) + "\n" +
        "📅 Expires : " + fmtDate(newExpiry) + "\n\n" +
        "Welcome back! Type " + pfx + "menu to see your status. 🎉";

      async function sendNotif(jid) {
        if (thumb) {
          try { return await sock.sendMessage(jid, { image: thumb, caption: notifText }); } catch {}
        }
        return sock.sendMessage(jid, { text: notifText }).catch(() => {});
      }

      if (rec) {
        // Sub is local — patch directly
        if (!rec.revokedAt && isActive(rec)) {
          return reply("ℹ️ *+" + target + "* is not revoked and is already active.");
        }
        setSub(target, {
          expiresAtMs:  newExpiry,
          expiresAt:    new Date(newExpiry).toISOString(),
          revokedAt:    null,
          revokedBy:    null,
          revokeReason: null,
          unrevokedAt:  new Date().toISOString(),
          unrevokedBy:  myNum,
        });
        await sendNotif(target + "@s.whatsapp.net");
        return reply(
          "✅ *Unrevoked (local)*\n\nUser    : +" + target + "\nPlan    : " + planLabel(planKey) + "\nExpires : " + fmtDate(newExpiry) + "\nUser notified. ✅"
        );
      } else {
        // Sub is cross-bot — send fresh JTA activation (same mechanism as .givesub)
        const freshRef = makeRef("JT");
        const payload  = buildPayload(freshRef, target, planKey, plan.days, 0);
        try {
          await sock.sendMessage(target + "@s.whatsapp.net", { text: payload });
          try { registerOwner(target, planKey, freshRef, myNum, newExpiry); } catch {}
          setTimeout(() => sendNotif(target + "@s.whatsapp.net"), 2000);
          return reply(
            "✅ *Unrevoke activation sent!*\n\nUser    : +" + target + "\nPlan    : " + planLabel(planKey) + "\nExpires : " + fmtDate(newExpiry) + "\nRef     : " + freshRef + "\n\nReactivates automatically on their bot. ✅"
          );
        } catch (e) {
          return reply("❌ Failed: " + (e && e.message) + "\n\nTry: " + pfx + "givesub " + target + " " + planKey);
        }
      }
    }

    // ── .editplan <plan> <price> [days] ───────────────────────────────────────
    // Dev edits plan price and optionally days in settings/plans.js
    if (command === "editplan") {
      if (!callerIsDev) return reply("🔒 Developer-only command.");

      const fs   = require("fs");
      const path = require("path");
      const PLANS_FILE = path.join(__dirname, "..", "settings", "plans.js");

      // .editplan — list current plans
      if (!args[0]) {
        const planList = Object.entries(PLANS)
          .map(([k, v]) => `• *${k}* — ${v.label} | ${v.days} days | ₦${Number(v.price).toLocaleString()}`)
          .join("\n");
        return reply(
          "💳 *Current Plans*\n\n" +
          planList + "\n\n" +
          "To edit:\n" +
          pfx + "editplan <key> price <amount>\n" +
          pfx + "editplan <key> days <number>\n" +
          pfx + "editplan <key> label <name>\n\n" +
          "Example:\n" +
          pfx + "editplan monthly price 2500\n" +
          pfx + "editplan m6 days 185\n" +
          pfx + "editplan yearly label Annual"
        );
      }

      const planKey = String(args[0] || "").toLowerCase().trim();
      const field   = String(args[1] || "").toLowerCase().trim();
      const value   = args.slice(2).join(" ").trim();

      if (!PLANS[planKey]) {
        return reply("❌ Plan *" + planKey + "* not found.\n\nAvailable plans: " + Object.keys(PLANS).join(", "));
      }
      if (!field || !value) {
        return reply(
          "Usage: " + pfx + "editplan <key> <field> <value>\n\n" +
          "Fields: price | days | label\n\n" +
          "Example:\n" +
          pfx + "editplan monthly price 2500\n" +
          pfx + "editplan m6 days 185"
        );
      }
      if (!["price", "days", "label"].includes(field)) {
        return reply("❌ Invalid field: *" + field + "*\n\nAllowed fields: price, days, label");
      }

      // Read the current plans.js content
      let plansContent;
      try { plansContent = fs.readFileSync(PLANS_FILE, "utf8"); } catch (e) {
        return reply("❌ Could not read plans.js: " + e.message);
      }

      // Build updated plans object
      const updatedPlans = { ...PLANS };
      if (field === "price") {
        const num = Number(value.replace(/[₦,\s]/g, ""));
        if (!Number.isFinite(num) || num <= 0) return reply("❌ Invalid price: " + value + "\n\nEnter a number e.g. 2500");
        updatedPlans[planKey] = { ...updatedPlans[planKey], price: num };
      } else if (field === "days") {
        const num = Math.floor(Number(value));
        if (!Number.isFinite(num) || num <= 0) return reply("❌ Invalid days: " + value + "\n\nEnter a number e.g. 30");
        updatedPlans[planKey] = { ...updatedPlans[planKey], days: num };
      } else if (field === "label") {
        if (!value) return reply("❌ Label cannot be empty.");
        updatedPlans[planKey] = { ...updatedPlans[planKey], label: value };
      }

      // Write back to plans.js
      const newContent =
        "// settings/plans.js\n" +
        "module.exports = {\n" +
        Object.entries(updatedPlans)
          .map(([k, v]) =>
            `  ${k.padEnd(9)}: { label: ${JSON.stringify(v.label)}, days: ${v.days}, price: ${v.price} },`
          )
          .join("\n") +
        "\n};\n";

      try {
        fs.writeFileSync(PLANS_FILE, newContent, "utf8");
        // Bust the require cache so next command reads fresh
        delete require.cache[require.resolve("../settings/plans")];
      } catch (e) {
        return reply("❌ Could not write plans.js: " + e.message);
      }

      const old = PLANS[planKey];
      return reply(
        "✅ *Plan Updated*\n\n" +
        "Plan   : *" + planKey + "* (" + updatedPlans[planKey].label + ")\n" +
        "Field  : " + field + "\n" +
        "Before : " + (field === "price" ? "₦" + Number(old[field]).toLocaleString() : old[field]) + "\n" +
        "After  : " + (field === "price" ? "₦" + Number(updatedPlans[planKey][field]).toLocaleString() : updatedPlans[planKey][field]) + "\n\n" +
        "⚠️ Note: Existing subscriptions are NOT affected. Changes apply to new purchases only.\n\n" +
        "Run " + pfx + "editplan to see all current plans."
      );
    }

    // ── .subresend <number> — re-fire JTA activation from owner registry ──────
    // Dev-only: manually re-send the activation payload to an owner who lost their DB.
    if (command === "subresend") {
      if (!isDev(myNum)) return reply("🔒 Developer-only command.");

      const targetRaw = String(args[0] || "").trim();
      if (!targetRaw) {
        return reply(
          "Usage: " + pfx + "subresend <number>\n\n" +
          "Re-sends the JTA activation payload to an owner whose database was wiped.\n\n" +
          "Example:\n" + pfx + "subresend 2348012345678"
        );
      }

      const target = normalizeNumber(targetRaw);
      if (!target) return reply("❌ Invalid number: " + targetRaw);

      let regEntry = null;
      try {
        const { getRegisteredOwner } = require("../library/ownerRegistryDb");
        regEntry = getRegisteredOwner(target);
      } catch (e) {
        return reply("❌ Could not read owner registry: " + (e && e.message));
      }

      if (!regEntry) {
        return reply(
          "❌ No registry entry found for *+" + target + "*\n\n" +
          "This number has never been approved on this bot.\n" +
          "Use " + pfx + "givesub " + target + " <plan> to grant a fresh subscription."
        );
      }

      const PLANS_LOCAL = (() => { try { return require("../settings/plans"); } catch { return {}; } })();
      const planKey = regEntry.plan;
      const plan    = PLANS_LOCAL[planKey];
      const storedDays = plan ? plan.days : 30;
      // Use remaining days from registry, floor to at least 1
      const remainMs   = Math.max(Number(regEntry.expiresAtMs || 0) - Date.now(), 0);
      const remainDays = Math.max(Math.ceil(remainMs / 86400000), 1);
      const daysToUse  = remainMs > 0 ? remainDays : storedDays;

      const resendRef = String(regEntry.ref || makeRef("JT"));
      const payload   = buildPayload(resendRef, target, planKey, daysToUse, 0);

      try {
        await sock.sendMessage(target + "@s.whatsapp.net", { text: payload });

        const expiresAtMs = Date.now() + daysToUse * 24 * 60 * 60 * 1000;
        return reply(
          "✅ *Activation Re-Sent!*\n\n" +
          "User    : +" + target + "\n" +
          "Plan    : " + planLabel(planKey) + "\n" +
          "Days    : " + daysToUse + "\n" +
          "Ref     : " + resendRef + "\n" +
          "Expires : " + fmtDate(expiresAtMs) + "\n\n" +
          "The owner's bot will activate automatically on receipt. ✅"
        );
      } catch (e) {
        return reply(
          "❌ Failed to send activation to +" + target + "\n" +
          "Error: " + (e && e.message) + "\n\n" +
          "Make sure the owner's bot is online."
        );
      }
    }

    // Fallback for any unknown dev command
    return reply("❓ Unknown command. Try: " + pfx + "sub help");
  },
};
