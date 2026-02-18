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
} = require("../library/subscriptionDb");
const { registerOwner } = require("../library/ownerRegistryDb");

// ─── Constants ────────────────────────────────────────────────────────────────
const DEV_NUMBERS     = ["2349032578690", "2348166337692"];
const REF_REGEX       = /\b((?:JT|TRIAL)-[A-Z0-9]+-[A-Z0-9]+)\b/i;
const ACTIVATE_MARKER = "\u200BJTA:"; // zero-width space prefix makes it unique + invisible in chat
const REVOKE_MARKER   = "\u200BJTR:"; // zero-width space prefix — revoke payload
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

function buildRevokePayload(user, revokedBy) {
  return REVOKE_MARKER + JSON.stringify({ user, revokedBy, sig: signRevoke(user, revokedBy) });
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
  command: ["sub", "subscription", "approvepay", "rejectpay", "substatus", "trial", "givesub"],
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

          // Notify the owner via their own DM
          const ownerJid = data.user + "@s.whatsapp.net";
          await sock.sendMessage(ownerJid, {
            text: [
              "✅ *Payment Approved!*", "",
              "Your subscription is now ACTIVE.", "",
              "📦 Plan    : " + planLabel(data.plan),
              "📅 Expires : " + fmtDate(sub.expiresAtMs),
              "🔖 Ref     : " + data.ref, "",
              "Thank you for subscribing! 🎉",
              "Type " + pfx + "menu to see your status.",
            ].join("\n"),
          }).catch(() => {});
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
          setSub(rdata.user, { expiresAtMs: 1, expiresAt: new Date(1).toISOString(), revokedAt: new Date().toISOString(), revokedBy: rdata.revokedBy });
          const targetJid = rdata.user + "@s.whatsapp.net";
          await sock.sendMessage(targetJid, {
            text: "❌ *Subscription Revoked*\n\nYour subscription has been removed by the developer.\nContact us if you believe this is a mistake.",
          }).catch(() => {});
          console.log("[JTR] ✅ revoked for:", rdata.user);
        } catch (e) { console.error("[JTR] revoke err:", e && e.message); }
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
        // Premium user restores lost subscription using their original ref code
        // Dev's bot resends the JTA activation payload to the user's bot
        const ref = String(args[1] || "").trim().toUpperCase();
        if (!ref) {
          return reply(
            "Usage: " + pfx + "sub restore <ref>\n\n" +
            "Example: " + pfx + "sub restore JT-XXXX-YYYY\n\n" +
            "Your ref code was given when your payment was approved.\n" +
            "Check your old messages or contact the developer."
          );
        }
        // Verify the ref belongs to this user
        const pend = getPending(ref);
        if (!pend) return reply("❌ Ref *" + ref + "* not found.\n\nMake sure you copied the full ref code correctly.");
        if (pend.user !== myNum && !callerIsDev) return reply("❌ This ref does not belong to your number.");
        if (pend.status !== "approved") return reply("❌ Ref *" + ref + "* has not been approved yet.\n\nStatus: " + pend.status + "\n\nContact the developer if you believe this is an error.");

        const plan = PLANS[pend.plan];
        if (!plan) return reply("❌ Plan not found: " + pend.plan);

        // Check if already active — no need to restore
        invalidateCache();
        const currentSub = getSub(myNum);
        if (currentSub && isActive(currentSub)) {
          return reply(
            "✅ *Your subscription is already active!*\n\n" +
            "Plan    : " + planLabel(currentSub.plan) + "\n" +
            "Expires : " + fmtDate(currentSub.expiresAtMs) + "\n\n" +
            "No restore needed."
          );
        }

        // Resend the JTA activation payload to restore the subscription
        const payload = buildPayload(ref, pend.user, pend.plan, plan.days, pend.amount || 0);
        try {
          // Send to the user's own bot number — this bot IS the user's bot
          await sock.sendMessage(pend.user + "@s.whatsapp.net", { text: payload });
          return reply(
            "✅ *Restoration in progress!*\n\n" +
            "Ref  : " + ref + "\n" +
            "Plan : " + plan.label + "\n\n" +
            "Your subscription is being restored.\n" +
            "Check your status in a moment: " + pfx + "sub status"
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

      // .sub revoke <number>
      if (a0 === "revoke") {
        const target = normalizeNumber(String(args[1] || "").trim());
        if (!target) return reply("Usage: " + pfx + "sub revoke <number>");
        invalidateCache();
        const existing = getSub(target);
        const isOnThisBot = botNumber && normalizeNumber(botNumber) === normalizeNumber(target);

        if (existing) {
          // Sub is stored locally — revoke directly
          setSub(target, { expiresAtMs: 1, expiresAt: new Date(1).toISOString(), revokedAt: new Date().toISOString(), revokedBy: myNum });
          sock.sendMessage(target + "@s.whatsapp.net", {
            text: "❌ *Subscription Revoked*\n\nYour subscription has been removed by the developer.\nContact us if you believe this is a mistake.",
          }).catch(() => {});
          return reply("✅ Subscription revoked for *+" + target + "*. Access removed immediately.");
        } else if (!isOnThisBot) {
          // Sub is likely on the user's own bot — send JTR revoke payload
          const revokePayload = buildRevokePayload(target, myNum);
          try {
            await sock.sendMessage(target + "@s.whatsapp.net", { text: revokePayload });
            return reply(
              "✅ *Revoke signal sent!*\n\n" +
              "User   : +" + target + "\n" +
              "Status : Revoke delivered to their bot — takes effect immediately. ❌\n\n" +
              "ℹ️ Note: Subscription was granted to their own bot instance, so revoke was sent as a signal."
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
          const { SUB_FILE } = require("../library/subscriptionDb");
          const fsLocal = require("fs");
          if (!fsLocal.existsSync(SUB_FILE)) return reply("📋 No subscriptions recorded yet.");
          const db      = JSON.parse(fsLocal.readFileSync(SUB_FILE, "utf8"));
          const entries = Object.entries(db.users || {});
          if (!entries.length) return reply("📋 No subscriptions recorded yet.");
          const active  = entries.filter(([, s]) => isActive(s));
          const expired = entries.filter(([, s]) => !isActive(s));
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

        // Notify owner
        await sock.sendMessage(p.user + "@s.whatsapp.net", {
          text: [
            "✅ *Payment Approved!*", "",
            "Your subscription is now ACTIVE!", "",
            "📦 Plan    : " + plan.label,
            "📅 Expires : " + fmtDate(sub.expiresAtMs),
            "🔖 Ref     : " + ref, "",
            "Thank you for subscribing to JusticeTech! 🎉",
            "Type " + pfx + "menu to see your new status.",
          ].join("\n"),
        }).catch(() => {});

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
        await sock.sendMessage(target + "@s.whatsapp.net", {
          text: [
            "🎁 *Subscription Granted!*", "",
            "The developer has gifted you a subscription.", "",
            "📦 Plan    : " + plan.label,
            "📅 Expires : " + fmtDate(sub.expiresAtMs),
            "🔖 Ref     : " + ref, "",
            "Type " + pfx + "menu to see your new status. 🎉",
          ].join("\n"),
        }).catch(() => {});
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

    // Fallback for any unknown dev command
    return reply("❓ Unknown command. Try: " + pfx + "sub help");
  },
};
