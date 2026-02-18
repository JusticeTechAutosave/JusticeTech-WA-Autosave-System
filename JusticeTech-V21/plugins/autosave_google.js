// plugins/autosave_google.js
// Option C (FULL UPDATED)
// ✅ Autosave COMMANDS are DEV-only (settings/tools locked)
// ✅ Passive autosave replies to UNSAVED leads in DM (public-facing) when Autosave is ON
// ✅ Adds autosave ON/OFF switch (persistent) + status command
// ✅ Adds bulk-save from scan_cache.json (history scan) using WhatsApp registered names when available
// ✅ Auto-upgrades contacts previously saved with GENERIC name when real WhatsApp name becomes available
// ✅ Keeps your existing admin tools: tags/addtag/tagtemplate/generic/save/rename/undo/blacklist/scanstatus/googlestatus

const fs = require("fs");
const path = require("path");
const { isApproved } = require("../library/approvalDb");
const { upsertContactForOwner, searchContactByPhone, invalidateContactsCache } = require("../library/googleContacts");

// ✅ DEV numbers (digits only)
const DEV_NUMBERS = ["2349032578690", "2348166337692"];

const DB_DIR = path.join(__dirname, "..", "database");

const CONTACTS_FILE = path.join(DB_DIR, "autosaved_contacts.json");
const WELCOME_FILE = path.join(DB_DIR, "welcome.json");
const OWNER_FILE = path.join(DB_DIR, "owner.json");
const DELAY_FILE = path.join(DB_DIR, "reply_delay.json");
const TAGS_FILE = path.join(DB_DIR, "tags.json");
const GENERIC_FILE = path.join(DB_DIR, "generic.json");

const BLACKLIST_FILE = path.join(DB_DIR, "blacklist.json");
const SCAN_CACHE_FILE = path.join(DB_DIR, "scan_cache.json");
const GOOGLE_STATUS_FILE = path.join(DB_DIR, "google_status.json");
const LAST_SAVE_FILE = path.join(DB_DIR, "last_save.json");
const TAG_TEMPLATES_FILE = path.join(DB_DIR, "tag_templates.json");

// ✅ autosave master flag
const AUTOSAVE_FLAG_FILE = path.join(DB_DIR, "autosave_flag.json");

/* ---------------- core helpers ---------------- */

function ensure() {
  if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });

  if (!fs.existsSync(CONTACTS_FILE)) fs.writeFileSync(CONTACTS_FILE, JSON.stringify({ contacts: {} }, null, 2));
  if (!fs.existsSync(WELCOME_FILE)) fs.writeFileSync(WELCOME_FILE, JSON.stringify({ dmText: "", groupText: "" }, null, 2));
  if (!fs.existsSync(OWNER_FILE)) fs.writeFileSync(OWNER_FILE, JSON.stringify({ name: "" }, null, 2));
  if (!fs.existsSync(DELAY_FILE)) fs.writeFileSync(DELAY_FILE, JSON.stringify({ maxSeconds: 0 }, null, 2));
  if (!fs.existsSync(TAGS_FILE)) fs.writeFileSync(TAGS_FILE, JSON.stringify({ new: "", old: "" }, null, 2));
  if (!fs.existsSync(GENERIC_FILE)) fs.writeFileSync(GENERIC_FILE, JSON.stringify({ name: "" }, null, 2));

  if (!fs.existsSync(BLACKLIST_FILE)) fs.writeFileSync(BLACKLIST_FILE, JSON.stringify({ numbers: [] }, null, 2));
  if (!fs.existsSync(SCAN_CACHE_FILE)) {
    fs.writeFileSync(
      SCAN_CACHE_FILE,
      JSON.stringify(
        { startedAt: null, updatedAt: null, isLatest: false, chatsCount: 0, contactsCount: 0, messagesCount: 0, dmJids: [] },
        null,
        2
      )
    );
  }
  if (!fs.existsSync(GOOGLE_STATUS_FILE)) {
    fs.writeFileSync(
      GOOGLE_STATUS_FILE,
      JSON.stringify({ lastSuccessAt: null, lastFailAt: null, successCount: 0, failCount: 0, lastError: "" }, null, 2)
    );
  }
  if (!fs.existsSync(LAST_SAVE_FILE)) fs.writeFileSync(LAST_SAVE_FILE, JSON.stringify({ byOwner: {} }, null, 2));

  if (!fs.existsSync(TAG_TEMPLATES_FILE)) {
    fs.writeFileSync(
      TAG_TEMPLATES_FILE,
      JSON.stringify(
        {
          templates: {
            lead: "🧾 LEAD",
            client: "✅ CLIENT",
            vendor: "🏷️ VENDOR",
            friend: "🤝 FRIEND",
            vip: "⭐ VIP",
          },
        },
        null,
        2
      )
    );
  }

  // autosave flag default ON
  if (!fs.existsSync(AUTOSAVE_FLAG_FILE)) {
    fs.writeFileSync(AUTOSAVE_FLAG_FILE, JSON.stringify({ enabled: true, updatedAt: new Date().toISOString() }, null, 2));
  }
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function readDb() {
  ensure();
  return readJson(CONTACTS_FILE, { contacts: {} }) || { contacts: {} };
}

function writeDb(db) {
  ensure();
  writeJson(CONTACTS_FILE, db);
}

function sanitizeText(input) {
  return String(input || "").replace(/\s+/g, " ").trim();
}

function isSwhatsapp(jid) {
  return String(jid || "").endsWith("@s.whatsapp.net");
}

function jidToPhoneDigits(jidOrPn) {
  let s = String(jidOrPn || "").trim();
  if (!s) return null;
  if (s.includes("@")) s = s.split("@")[0];
  if (s.includes(":")) s = s.split(":")[0];
  const d = s.replace(/[^0-9]/g, "");
  if (!d) return null;
  if (d.length < 8 || d.length > 15) return null;
  return d;
}

function jidFromCtx(m) {
  return m?.sender || m?.key?.participant || m?.key?.remoteJid || "";
}

function isDeveloperJid(userJid) {
  const digits = jidToPhoneDigits(userJid);
  return !!digits && DEV_NUMBERS.includes(digits);
}

function devOnlyBlockText(prefix) {
  const p = prefix || ".";
  return "🔒 Developer-only feature.\n\nAutosave settings/tools are locked to the developer.\n\nTip: " + p + "menu";
}

// ✅ Baileys-safe text extractor
function getMessageText(m) {
  try {
    return (
      (typeof m?.text === "string" && m.text) ||
      m?.message?.conversation ||
      m?.message?.extendedTextMessage?.text ||
      m?.message?.imageMessage?.caption ||
      m?.message?.videoMessage?.caption ||
      ""
    );
  } catch {
    return "";
  }
}

/* ---------------- autosave flag ---------------- */

function getAutosaveEnabled() {
  ensure();
  const f = readJson(AUTOSAVE_FLAG_FILE, { enabled: true });
  return !!f.enabled;
}

function setAutosaveEnabled(enabled) {
  ensure();
  writeJson(AUTOSAVE_FLAG_FILE, { enabled: !!enabled, updatedAt: new Date().toISOString() });
  return !!enabled;
}

/* ---------------- delay sending ---------------- */

function getMaxDelaySeconds() {
  ensure();
  const d = readJson(DELAY_FILE, { maxSeconds: 0 });
  const s = Number(d?.maxSeconds || 0);
  if (!Number.isFinite(s) || s < 0) return 0;
  return Math.min(30, Math.floor(s));
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function sendWithDelay(sock, jid, content, opts = {}) {
  const maxS = getMaxDelaySeconds();
  if (maxS > 0) {
    const waitMs = Math.floor(Math.random() * (maxS * 1000 + 1));
    if (waitMs > 0) await sleep(waitMs);
  }
  return sock.sendMessage(jid, content, opts);
}

async function safeReply({ sock, m, reply }, text) {
  if (typeof reply === "function") return reply(text);
  const chat = m?.chat || m?.key?.remoteJid;
  if (!chat) return;
  return sock.sendMessage(chat, { text }, { quoted: m });
}

/* ---------------- tags / templates / blacklist ---------------- */

function getTag(scope) {
  ensure();
  const t = readJson(TAGS_FILE, { new: "", old: "" });
  return String(t?.[scope] || "").trim();
}

function setTag(scope, value) {
  ensure();
  const t = readJson(TAGS_FILE, { new: "", old: "" });
  t[scope] = String(value || "").trim();
  writeJson(TAGS_FILE, t);
  return t;
}

function applyTag(name, tag) {
  const n = String(name || "").trim();
  const t = String(tag || "").trim();
  if (!t) return n;
  return `${n} ${t}`.trim();
}

function getGenericName() {
  ensure();
  const g = readJson(GENERIC_FILE, { name: "" });
  return String(g?.name || "").trim();
}

function setGenericName(name) {
  ensure();
  writeJson(GENERIC_FILE, { name: String(name || "").trim() });
}

function getBlacklistSet() {
  ensure();
  const b = readJson(BLACKLIST_FILE, { numbers: [] });
  const nums = Array.isArray(b?.numbers) ? b.numbers : [];
  return new Set(nums.map((x) => String(x || "").replace(/\D/g, "")).filter(Boolean));
}

function writeBlacklistFromSet(set) {
  ensure();
  writeJson(BLACKLIST_FILE, { numbers: Array.from(set) });
}

function getTemplates() {
  ensure();
  const t = readJson(TAG_TEMPLATES_FILE, { templates: {} });
  return t?.templates || {};
}

function setTemplate(name, value) {
  ensure();
  const all = readJson(TAG_TEMPLATES_FILE, { templates: {} });
  all.templates = all.templates || {};
  all.templates[String(name || "").toLowerCase()] = String(value || "").trim();
  writeJson(TAG_TEMPLATES_FILE, all);
  return all.templates;
}

/* ---------------- WhatsApp name helpers ---------------- */

function looksLikeJustNumber(s) {
  const t = String(s || "").trim().replace(/\s+/g, "");
  return /^\+?\d{7,15}$/.test(t);
}

// ── FIXED: Only "name" (local phonebook entry) proves device-save ─────────────
// "notify" = WhatsApp push name set by the contact themselves — NOT proof of being saved
// "verifiedName" = WhatsApp Business verified name — NOT proof of device save  
// "name" = your local phone address book entry — THE ONLY real proof of device-save
// "pushName" = their WA display name — same as notify, NOT proof of save

function bestWaNameFromContact(contactObj) {
  // ONLY use local phonebook name as proof of device-save
  const name = String(contactObj?.name || "").trim();
  if (!name || looksLikeJustNumber(name)) return "";
  return name;
}

function waNameForJid(store, jid) {
  try {
    const c = store?.contacts?.get?.(jid);
    return bestWaNameFromContact(c);
  } catch {
    return "";
  }
}

// Returns WA push name (notify) for display only — NOT used for save detection
function waDisplayNameForJid(store, jid) {
  try {
    const c = store?.contacts?.get?.(jid);
    const candidates = [c?.verifiedName, c?.notify, c?.name, c?.pushName]
      .map(x => String(x || "").trim()).filter(Boolean);
    const best = candidates[0] || "";
    if (looksLikeJustNumber(best)) return "";
    return best;
  } catch {
    return "";
  }
}

/* ---------------- validation (STRICT) ---------------- */

function isValidCharsOnly(name) {
  const re = /^[A-Za-zÀ-ÖØ-öø-ÿ]+([ '-][A-Za-zÀ-ÖØ-öø-ÿ]+)*$/;
  return re.test(String(name || "").trim());
}

function words(name) {
  return String(name || "").trim().split(/\s+/).filter(Boolean);
}

function letterCountOnly(fullName) {
  return String(fullName || "").replace(/[^A-Za-zÀ-ÖØ-öø-ÿ]/g, "").length;
}

function firstWordTooShort(name) {
  const parts = words(name);
  if (!parts.length) return true;
  const firstLetters = String(parts[0]).replace(/[^A-Za-zÀ-ÖØ-öø-ÿ]/g, "").length;
  return firstLetters < 3;
}

function looksLikeSentence(name) {
  const s = String(name || "").trim().toLowerCase();
  const badPhrases = [
    "my name is",
    "my names",
    "i am",
    "i'm",
    "im ",
    "i have",
    "i bought",
    "i buy",
    "i want",
    "i need",
    "i will",
    "i would",
    "i was",
    "i just",
    "am buying",
    "i am buying",
    "i'm buying",
    "im buying",
    "i paid",
    "i sent",
    "this is",
    "it's",
    "its ",
    "hello",
    "hi ",
    "hey ",
    "good morning",
    "good afternoon",
    "good evening",
  ];
  for (const p of badPhrases) {
    if (s === p) return true;
    if (s.startsWith(p + " ")) return true;
    if (s.includes(p + " ")) return true;
  }
  return false;
}

function isLikelyJunk(name) {
  return /^(hi|hello|hey|yo|sup|bro|ok|okay|kk|k|yes|no|test|testing|hmm|lol)$/i.test(String(name || "").trim());
}

function validateUserName(nameRaw) {
  const name = sanitizeText(nameRaw);
  if (!name) return { ok: false, msg: "❌ Please send your name only (1 or 2 words)." };

  const wc = words(name).length;
  if (wc > 12) return { ok: false, msg: "❌ Name rejected.\nToo many words." };

  if (wc < 1 || wc > 2) {
    return {
      ok: false,
      msg: "❌ Name rejected.\nSend 1 or 2 words only.\nExamples: Justice / Maxwell / Justice Tech",
    };
  }

  if (!isValidCharsOnly(name)) {
    return { ok: false, msg: "❌ Name rejected.\nUse letters only.\nAllowed: space, hyphen (-), apostrophe (')" };
  }

  if (isLikelyJunk(name) || firstWordTooShort(name)) {
    return { ok: false, msg: "❌ Name rejected.\nUse a real name or nickname (first word must be at least 3 letters)." };
  }

  if (looksLikeSentence(name)) {
    return { ok: false, msg: "❌ Name rejected.\nThat looks like a sentence.\nSend only your name." };
  }

  const letters = letterCountOnly(name);
  if (letters > 12) {
    return { ok: false, msg: `❌ Name rejected.\nMax 12 letters total.\nYou sent: ${letters} letters.` };
  }

  return { ok: true, clean: name };
}

/* ---------------- utc time ---------------- */

function formatUtcTime(date) {
  const d = date instanceof Date ? date : new Date(date);
  const pad = (n) => String(n).padStart(2, "0");
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} UTC`
  );
}

/* ---------------- google status + last save ---------------- */

function noteGoogleSuccess(ownerNumber) {
  ensure();
  const s = readJson(GOOGLE_STATUS_FILE, { lastSuccessAt: null, lastFailAt: null, successCount: 0, failCount: 0, lastError: "" });
  s.lastSuccessAt = new Date().toISOString();
  s.successCount = Number(s.successCount || 0) + 1;
  writeJson(GOOGLE_STATUS_FILE, s);
  // Invalidate contacts cache so next lookup reflects the newly saved contact
  if (ownerNumber) invalidateContactsCache(ownerNumber);
}

function noteGoogleFail(err) {
  ensure();
  const s = readJson(GOOGLE_STATUS_FILE, { lastSuccessAt: null, lastFailAt: null, successCount: 0, failCount: 0, lastError: "" });
  s.lastFailAt = new Date().toISOString();
  s.failCount = Number(s.failCount || 0) + 1;
  s.lastError = String(err?.message || err || "");
  writeJson(GOOGLE_STATUS_FILE, s);
}

function recordLastSave(ownerNumber, payload) {
  ensure();
  const all = readJson(LAST_SAVE_FILE, { byOwner: {} });
  all.byOwner = all.byOwner || {};
  all.byOwner[String(ownerNumber)] = { ...payload, at: new Date().toISOString() };
  writeJson(LAST_SAVE_FILE, all);
}

function getLastSave(ownerNumber) {
  ensure();
  const all = readJson(LAST_SAVE_FILE, { byOwner: {} });
  return all?.byOwner?.[String(ownerNumber)] || null;
}

async function tryUndo({ ownerNumber, number, resourceName }) {
  const db = readDb();
  db.contacts = db.contacts || {};
  db.contacts[ownerNumber] = db.contacts[ownerNumber] || {};
  const ownerBook = db.contacts[ownerNumber];

  if (!ownerBook[number]) return { ok: false, msg: "That number is not in your local autosave DB." };

  delete ownerBook[number];
  db.contacts[ownerNumber] = ownerBook;
  writeDb(db);

  try {
    const mod = require("../library/googleContacts");
    const del = mod?.deleteContactForOwner;
    if (typeof del === "function" && resourceName) {
      await del({ ownerNumber, resourceName });
      return { ok: true, msg: "✅ Undone.\nRemoved locally and deleted from Google Contacts." };
    }
  } catch {}

  return { ok: true, msg: "✅ Undone locally.\nNote: Google delete is not available in this bot build." };
}

/* ---------------- yes/no templates ---------------- */

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function normalizeYesNo(txt) {
  const t = String(txt || "").trim().toLowerCase();
  if (["yes", "y", "yeah", "yep", "yup"].includes(t)) return "yes";
  if (["no", "n", "nope", "nah"].includes(t)) return "no";
  return "";
}

function confirmTemplates(name) {
  const shown = `*${name}*`;
  return [
    `Confirm your name: ${shown}\nReply YES or NO`,
    `Is your name ${shown}?\nReply *YES* or *NO*`,
    `Please confirm: ${shown}\nReply *YES* or *NO*`,
  ];
}

function noTemplates() {
  return [
    "Okay. Please send your name again (1 or 2 words only).",
    "No problem. Send your name again (1 or 2 words).",
    "Alright. Reply with your name only (1 or 2 words).",
  ];
}

const DEFAULT_WELCOME = "Welcome. Please *REPLY WITH JUST YOUR NAME* (1 or 2 words) so your contact can be saved automatically.";
const NAME_INSTRUCTION = "Send only your real name or nickname. Examples: Justice / Maxwell / Justice Tech";

/* ---------------- resolve PN + owner ---------------- */

async function resolvePNFromLID(sock, store, remoteJid) {
  if (isSwhatsapp(remoteJid)) return jidToPhoneDigits(remoteJid);

  try {
    const c = store?.contacts?.get?.(remoteJid);
    if (c?.phoneNumber) return jidToPhoneDigits(c.phoneNumber);
  } catch {}

  try {
    const targetKey = String(remoteJid || "");
    const targetDigits = targetKey.replace(/[^0-9]/g, "");
    if (store?.contacts && typeof store.contacts.values === "function") {
      for (const c of store.contacts.values()) {
        const lid = String(c?.lid || "");
        const lidDigits = lid.replace(/[^0-9]/g, "");
        if (c?.phoneNumber && (lid === targetKey || lidDigits === targetDigits)) {
          return jidToPhoneDigits(c.phoneNumber);
        }
      }
    }
  } catch {}

  if (typeof sock?.getPNForLID === "function") {
    const rawDigits = String(remoteJid || "").replace(/[^0-9]/g, "");

    const lidCandidates = [];
    lidCandidates.push(remoteJid);
    if (rawDigits) lidCandidates.push(`${rawDigits}@lid`);

    if (remoteJid.includes("@")) {
      const left = remoteJid.split("@")[0];
      const leftDigits = left.replace(/[^0-9]/g, "");
      if (leftDigits) lidCandidates.push(`${leftDigits}@lid`);
    }

    for (const lid of lidCandidates) {
      try {
        const pn = await sock.getPNForLID(lid);
        const fixed = jidToPhoneDigits(pn);
        if (fixed) return fixed;
      } catch {}
    }
  }

  return null;
}

async function resolveOwnerNumber(sock, botJid, botNumber) {
  const source = botJid || botNumber || sock?.user?.id || "";
  return jidToPhoneDigits(source);
}

/* ---------------- owner + welcome ---------------- */

function readWelcomeDM() {
  ensure();
  const w = readJson(WELCOME_FILE, { dmText: "", groupText: "" });
  if (typeof w?.text === "string" && !w.dmText) return String(w.text || "").trim();
  return String(w?.dmText || "").trim();
}

function getOwnerName(sock) {
  ensure();
  const o = readJson(OWNER_FILE, { name: "" });
  const setName = String(o?.name || "").trim();
  if (setName) return setName;
  const profileName = String(sock?.user?.name || "").trim();
  return profileName || "JusticeTech";
}

/* ---------------- bulk save ---------------- */

async function bulkSaveFromScanCache({ sock, store, ownerNumber, prefix, reply }) {
  ensure();

  if (!getAutosaveEnabled()) {
    return reply(`❌ Autosave is OFF.\nTurn it ON using:\n${prefix || "."}autosave on`);
  }

  const cache = readJson(SCAN_CACHE_FILE, null);
  if (!cache?.dmJids || !Array.isArray(cache.dmJids) || cache.dmJids.length === 0) {
    return reply(
      `❌ No DM cache found.\nRun history scan first:\n${prefix || "."}historysync on\nThen restart.`
    );
  }

  if (!cache.isLatest) {
    return reply("⚠️ History scan is not complete yet.\nWait for the scan complete message, then run .bulksave again.");
  }

  if (!ownerNumber) return reply("❌ Could not resolve owner number.");
  if (!isApproved(ownerNumber)) return reply("❌ Owner is not approved for autosave.");

  const db = readDb();
  db.contacts = db.contacts || {};
  db.contacts[ownerNumber] = db.contacts[ownerNumber] || {};
  const ownerBook = db.contacts[ownerNumber];

  const blacklist = getBlacklistSet();
  const generic = getGenericName();

  let total = 0;
  let saved = 0;
  let upgraded = 0;
  let skippedAlready = 0;
  let skippedBad = 0;
  let failed = 0;

  const CONCURRENCY = 3;
  const queue = [...cache.dmJids];

  async function worker() {
    while (queue.length) {
      const jid = queue.shift();
      total++;

      const pn = await resolvePNFromLID(sock, store, jid);
      if (!pn) {
        skippedBad++;
        continue;
      }
      if (blacklist.has(pn)) {
        skippedBad++;
        continue;
      }

      const existing = ownerBook[pn];
      const waName = waDisplayNameForJid(store, jid);

      // if already saved, consider upgrade from generic -> real wa name
      if (existing?.google?.resourceName) {
        const wasGeneric = !!existing?.wasGeneric || (!!generic && existing?.rawName === generic);
        if (wasGeneric && waName && waName !== existing.rawName) {
          const upgradedName = applyTag(waName, getTag("old") || "");
          try {
            const res = await upsertContactForOwner({
              ownerNumber,
              contactName: upgradedName,
              contactNumber: pn,
              resourceName: existing.google.resourceName,
            });

            ownerBook[pn] = {
              ...existing,
              name: upgradedName,
              rawName: waName,
              wasGeneric: false,
              savedAt: new Date().toISOString(),
              google: { resourceName: res.resourceName, etag: res.etag, mode: res.mode },
            };

            upgraded++;
            noteGoogleSuccess(ownerNumber);
          } catch (e) {
            failed++;
            noteGoogleFail(e);
          }
        } else {
          skippedAlready++;
        }
        continue;
      }

      const baseName = waName || generic || "Contact";
      const taggedName = applyTag(baseName, getTag("new") || "");

      try {
        const savedAt = new Date();
        const res = await upsertContactForOwner({
          ownerNumber,
          contactName: taggedName,
          contactNumber: pn,
          resourceName: null,
        });

        ownerBook[pn] = {
          name: taggedName,
          rawName: baseName,
          wasGeneric: !waName && !!generic,
          number: pn,
          jid: `${pn}@s.whatsapp.net`,
          savedAt: savedAt.toISOString(),
          google: { resourceName: res.resourceName, etag: res.etag, mode: res.mode },
        };

        saved++;
        noteGoogleSuccess(ownerNumber);
        recordLastSave(ownerNumber, { number: pn, resourceName: res.resourceName, name: taggedName });
      } catch (e) {
        failed++;
        noteGoogleFail(e);
      }

      await sleep(200);
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }).map(() => worker()));

  db.contacts[ownerNumber] = ownerBook;
  writeDb(db);

  // ✅ Invalidate cache after bulk save so all contacts appear in Google Contacts app
  if (saved > 0 || upgraded > 0) {
    invalidateContactsCache(ownerNumber);
    console.log(`[BULKSAVE] Google Contacts cache invalidated for ${ownerNumber}`);
  }

  return reply(
    `✅ Bulk Save Complete\n\n` +
      `Total DM JIDs: ${total}\n` +
      `Saved new: ${saved}\n` +
      `Upgraded generic → real name: ${upgraded}\n` +
      `Already saved (no upgrade): ${skippedAlready}\n` +
      `Skipped (no number / blacklisted): ${skippedBad}\n` +
      `Failed: ${failed}`
  );
}

/* ---------------- plugin ---------------- */

module.exports = {
  name: "AutoSaveGoogle",
  category: "autosave",
  desc: "Autosave + admin tools",
  passive: true,
  hidden: true,

  command: [
    "autosave",   // ✅ toggle on/off
    "bulksave",   // ✅ bulk save from scan cache
    "addtag",
    "tags",
    "generic",
    "save",
    "rename",
    "blacklist",
    "scanstatus",
    "googlestatus",
    "undo",
    "tagtemplate",
  ],

  run: async ({ sock, m, botNumber, botJid, store, args, command, prefix, reply, isOwner, isPremium }) => {
    try {
      ensure();

      const cmd = String(command || "").toLowerCase();
      const pfx = prefix || ".";
      const userJid = jidFromCtx(m);

      // Expose ctx flags under local names for the permission gate below
      const ctx_isOwner   = !!isOwner;
      const ctx_isPremium = !!isPremium;

      // ✅ PERMISSION GATE: autosave commands require dev OR owner/premium
      // Pure dev admin commands (that touch other bots / global settings) stay dev-only.
      // Owner/premium commands are the day-to-day autosave tools.
      const DEV_ONLY_CMDS   = new Set(["autosave"]); // on/off toggle stays dev-only
      const OWNER_PREM_CMDS = new Set([
        "bulksave","save","rename","undo","tags","addtag","tagtemplate",
        "generic","blacklist","scanstatus","googlestatus",
      ]);
      if (cmd) {
        const callerIsDev  = isDeveloperJid(userJid);
        const callerNumber = jidToPhoneDigits(userJid);
        // isPremium / isOwner come from ctx — passed in via message.js
        // We read them from the ctx destructure at the top of run()
        const callerIsOwner   = ctx_isOwner;
        const callerIsPremium = ctx_isPremium;
        if (DEV_ONLY_CMDS.has(cmd) && !callerIsDev) {
          return safeReply({ sock, m, reply }, "🔒 Developer-only command.");
        }
        if (OWNER_PREM_CMDS.has(cmd) && !callerIsDev && !callerIsOwner && !callerIsPremium) {
          return safeReply({ sock, m, reply }, "🔒 This feature requires an active subscription.\n\nSee: " + pfx + "sub plans");
        }
        // Any other unlisted command: dev-only
        if (!DEV_ONLY_CMDS.has(cmd) && !OWNER_PREM_CMDS.has(cmd) && !callerIsDev) {
          return safeReply({ sock, m, reply }, devOnlyBlockText(pfx));
        }
      }

      const ownerNumber = await resolveOwnerNumber(sock, botJid, botNumber);

      /* ---------------- COMMANDS (DEV ONLY) ---------------- */

      if (cmd === "autosave") {
        const sub = String(args?.[0] || "").toLowerCase();

        if (!sub || sub === "status") {
          const f = readJson(AUTOSAVE_FLAG_FILE, { enabled: true, updatedAt: null });
          return safeReply(
            { sock, m, reply },
            `⚙️ Autosave\n\nEnabled: ${f.enabled ? "✅ YES" : "❌ NO"}\nUpdated: ${f.updatedAt || "-"}\n\nUse:\n${pfx}autosave on\n${pfx}autosave off`
          );
        }

        if (sub === "on") {
          setAutosaveEnabled(true);
          return safeReply({ sock, m, reply }, "✅ Autosave is now ON.");
        }

        if (sub === "off") {
          setAutosaveEnabled(false);
          return safeReply({ sock, m, reply }, "✅ Autosave is now OFF.");
        }

        return safeReply({ sock, m, reply }, `Use:\n${pfx}autosave status\n${pfx}autosave on\n${pfx}autosave off`);
      }

      if (cmd === "bulksave") {
        return bulkSaveFromScanCache({ sock, store, ownerNumber, prefix: pfx, reply });
      }

      if (cmd === "tags") {
        const t = readJson(TAGS_FILE, { new: "", old: "" });
        return safeReply(
          { sock, m, reply },
          `🏷️ Tags\n\nNEW: ${t.new ? t.new : "(none)"}\nOLD: ${t.old ? t.old : "(none)"}\n\n` +
            `Usage:\n${pfx}addtag new FB VIP\n${pfx}addtag old 🇳🇬 CLIENT\n${pfx}addtag new (clears)\n${pfx}addtag old (clears)`
        );
      }

      if (cmd === "addtag") {
        const scope = String(args?.[0] || "").toLowerCase();
        if (!["new", "old"].includes(scope)) {
          return safeReply({ sock, m, reply }, `Usage:\n${pfx}addtag new <tag...>\n${pfx}addtag old <tag...>\n${pfx}tags`);
        }
        const tag = (args || []).slice(1).join(" ").trim();
        const t = setTag(scope, tag);
        return safeReply({ sock, m, reply }, `✅ Tag updated\n${scope.toUpperCase()} tag: ${t[scope] ? t[scope] : "(cleared)"}`);
      }

      if (cmd === "tagtemplate") {
        const sub = String(args?.[0] || "").toLowerCase();

        if (!sub || sub === "list") {
          const templates = getTemplates();
          const lines = Object.keys(templates)
            .sort()
            .map((k) => `• ${k}: ${templates[k]}`)
            .join("\n");
          return safeReply(
            { sock, m, reply },
            `🏷️ Tag templates\n\n${lines || "(none)"}\n\n` +
              `Use:\n` +
              `${pfx}tagtemplate new <templateName>\n` +
              `${pfx}tagtemplate old <templateName>\n` +
              `${pfx}tagtemplate set <templateName> <tag text>`
          );
        }

        if (sub === "set") {
          const name = String(args?.[1] || "").toLowerCase();
          const val = (args || []).slice(2).join(" ").trim();
          if (!name || !val) return safeReply({ sock, m, reply }, `Usage:\n${pfx}tagtemplate set <name> <tag text>`);
          setTemplate(name, val);
          return safeReply({ sock, m, reply }, `✅ Template set\n${name}: ${val}`);
        }

        if (sub === "new" || sub === "old") {
          const tplName = String(args?.[1] || "").toLowerCase();
          const templates = getTemplates();
          const val = templates[tplName];
          if (!val) return safeReply({ sock, m, reply }, `❌ Template not found.\nUse: ${pfx}tagtemplate list`);
          setTag(sub, val);
          return safeReply({ sock, m, reply }, `✅ ${sub.toUpperCase()} tag set from template\n${val}`);
        }

        return safeReply({ sock, m, reply }, `Use: ${pfx}tagtemplate list`);
      }

      if (cmd === "generic") {
        const nameRaw = (args || []).join(" ").trim();
        if (!nameRaw) {
          const current = getGenericName();
          return safeReply({ sock, m, reply }, `🧾 Generic name\nCurrent: ${current ? `*${current}*` : "(not set)"}\n\nUsage:\n${pfx}generic <name>`);
        }

        const v = validateUserName(nameRaw);
        if (!v.ok) return safeReply({ sock, m, reply }, v.msg);

        setGenericName(v.clean);
        return safeReply({ sock, m, reply }, `✅ Generic name set to: *${v.clean}*`);
      }

      if (cmd === "blacklist") {
        const sub = String(args?.[0] || "").toLowerCase();
        const set = getBlacklistSet();

        if (!sub || sub === "list") {
          const items = Array.from(set);
          const body = items.length ? items.map((n, i) => `${i + 1}. ${n}`).join("\n") : "(empty)";
          return safeReply({ sock, m, reply }, `🚫 Blacklist\n\n${body}\n\nUse:\n${pfx}blacklist add <number>\n${pfx}blacklist del <number>\n${pfx}blacklist list`);
        }

        if (sub === "add") {
          const num = jidToPhoneDigits(args?.[1]);
          if (!num) return safeReply({ sock, m, reply }, `Usage: ${pfx}blacklist add <number>`);
          set.add(num);
          writeBlacklistFromSet(set);
          return safeReply({ sock, m, reply }, `✅ Added to blacklist: ${num}`);
        }

        if (sub === "del") {
          const num = jidToPhoneDigits(args?.[1]);
          if (!num) return safeReply({ sock, m, reply }, `Usage: ${pfx}blacklist del <number>`);
          set.delete(num);
          writeBlacklistFromSet(set);
          return safeReply({ sock, m, reply }, `✅ Removed from blacklist: ${num}`);
        }

        return safeReply({ sock, m, reply }, `Use: ${pfx}blacklist list`);
      }

      if (cmd === "scanstatus") {
        const c = readJson(SCAN_CACHE_FILE, {
          startedAt: null,
          updatedAt: null,
          isLatest: false,
          chatsCount: 0,
          contactsCount: 0,
          messagesCount: 0,
          dmJids: [],
        });
        return safeReply(
          { sock, m, reply },
          `📡 Scan status\n\n` +
            `Started: ${c.startedAt || "(unknown)"}\n` +
            `Updated: ${c.updatedAt || "(unknown)"}\n` +
            `Complete: ${c.isLatest ? "YES" : "NO"}\n` +
            `DMs: ${c.dmJids?.length || 0}\n` +
            `Chats: ${c.chatsCount || 0}\nContacts: ${c.contactsCount || 0}\nMessages: ${c.messagesCount || 0}`
        );
      }

      if (cmd === "googlestatus") {
        const s = readJson(GOOGLE_STATUS_FILE, { lastSuccessAt: null, lastFailAt: null, successCount: 0, failCount: 0, lastError: "" });
        return safeReply(
          { sock, m, reply },
          `☁️ Google sync status\n\n` +
            `Last success: ${s.lastSuccessAt || "(never)"}\n` +
            `Last fail: ${s.lastFailAt || "(never)"}\n` +
            `Success count: ${s.successCount || 0}\n` +
            `Fail count: ${s.failCount || 0}\n` +
            `Last error: ${s.lastError ? s.lastError : "(none)"}`
        );
      }

      if (cmd === "save") {
        if (!ownerNumber) return safeReply({ sock, m, reply }, "❌ Could not resolve owner number.");
        if (!isApproved(ownerNumber)) return safeReply({ sock, m, reply }, "❌ Owner is not approved for autosave.");

        const num = jidToPhoneDigits(args?.[0]);
        const nameRaw = (args || []).slice(1).join(" ").trim();
        if (!num || !nameRaw) return safeReply({ sock, m, reply }, `Usage:\n${pfx}save <number> <name>`);

        const v = validateUserName(nameRaw);
        if (!v.ok) return safeReply({ sock, m, reply }, v.msg);

        const blacklist = getBlacklistSet();
        if (blacklist.has(num)) return safeReply({ sock, m, reply }, "🚫 That number is blacklisted.");

        const db = readDb();
        db.contacts = db.contacts || {};
        db.contacts[ownerNumber] = db.contacts[ownerNumber] || {};
        const ownerBook = db.contacts[ownerNumber];

        if (ownerBook[num]?.google?.resourceName) return safeReply({ sock, m, reply }, "✅ Already saved in DB/Google.");

        try {
          const savedAt = new Date();
          const res = await upsertContactForOwner({
            ownerNumber,
            contactName: v.clean,
            contactNumber: num,
            resourceName: ownerBook[num]?.google?.resourceName || null,
          });

          ownerBook[num] = {
            name: v.clean,
            rawName: v.clean,
            wasGeneric: false,
            number: num,
            jid: `${num}@s.whatsapp.net`,
            savedAt: savedAt.toISOString(),
            google: { resourceName: res.resourceName, etag: res.etag, mode: res.mode },
          };

          db.contacts[ownerNumber] = ownerBook;
          writeDb(db);

          // ✅ Invalidate cache so contact appears immediately in Google Contacts app
          invalidateContactsCache(ownerNumber);

          noteGoogleSuccess(ownerNumber);
          recordLastSave(ownerNumber, { number: num, resourceName: res.resourceName, name: v.clean });

          return safeReply({ sock, m, reply }, `✅ Saved\nName: *${v.clean}*\nNumber: ${num}\nSaved on: ${formatUtcTime(savedAt)}`);
        } catch (e) {
          noteGoogleFail(e);
          return safeReply({ sock, m, reply }, `❌ Manual save failed: ${e?.message || String(e)}`);
        }
      }

      if (cmd === "rename") {
        if (!ownerNumber) return safeReply({ sock, m, reply }, "❌ Could not resolve owner number.");
        if (!isApproved(ownerNumber)) return safeReply({ sock, m, reply }, "❌ Owner is not approved for autosave.");

        const num = jidToPhoneDigits(args?.[0]);
        const nameRaw = (args || []).slice(1).join(" ").trim();
        if (!num || !nameRaw) return safeReply({ sock, m, reply }, `Usage:\n${pfx}rename <number> <new name>`);

        const v = validateUserName(nameRaw);
        if (!v.ok) return safeReply({ sock, m, reply }, v.msg);

        const db = readDb();
        db.contacts = db.contacts || {};
        db.contacts[ownerNumber] = db.contacts[ownerNumber] || {};
        const ownerBook = db.contacts[ownerNumber];

        const existing = ownerBook[num];
        const resourceName = existing?.google?.resourceName || null;

        if (!resourceName) return safeReply({ sock, m, reply }, "❌ That number is not saved yet.");

        try {
          const res = await upsertContactForOwner({
            ownerNumber,
            contactName: v.clean,
            contactNumber: num,
            resourceName,
          });

          ownerBook[num] = {
            ...existing,
            name: v.clean,
            rawName: v.clean,
            wasGeneric: false,
            savedAt: new Date().toISOString(),
            google: { resourceName: res.resourceName, etag: res.etag, mode: res.mode },
          };

          db.contacts[ownerNumber] = ownerBook;
          writeDb(db);

          // ✅ Invalidate cache so renamed contact appears immediately in Google Contacts app
          invalidateContactsCache(ownerNumber);

          noteGoogleSuccess(ownerNumber);
          recordLastSave(ownerNumber, { number: num, resourceName: res.resourceName, name: v.clean });

          return safeReply({ sock, m, reply }, `✅ Updated\nNumber: ${num}\nNew name: *${v.clean}*`);
        } catch (e) {
          noteGoogleFail(e);
          return safeReply({ sock, m, reply }, `❌ Rename failed: ${e?.message || String(e)}`);
        }
      }

      if (cmd === "undo") {
        if (!ownerNumber) return safeReply({ sock, m, reply }, "❌ Could not resolve owner number.");
        if (!isApproved(ownerNumber)) return safeReply({ sock, m, reply }, "❌ Owner is not approved for autosave.");

        const last = getLastSave(ownerNumber);
        if (!last?.number) return safeReply({ sock, m, reply }, "❌ No last saved record found.");

        const out = await tryUndo({ ownerNumber, number: last.number, resourceName: last.resourceName });
        return safeReply({ sock, m, reply }, out.msg);
      }

      /* ---------------- PASSIVE AUTOSAVE (DM ONLY) ---------------- */

      if (!getAutosaveEnabled()) return;

      const remote = m?.chat || m?.key?.remoteJid || "";
      if (!remote || remote.endsWith("@g.us")) return; // no groups
      if (m?.key?.fromMe) return; // ignore our own messages

      if (!ownerNumber) return;
      if (!isApproved(ownerNumber)) return; // owner must be approved

      // ✅ Block payment proof messages — set BEFORE any async work
      // subscription.js sets AUTOSAVE_PROCESSED synchronously before its own awaits
      const _msgId = m?.key?.id || "";
      if (_msgId && global.AUTOSAVE_PROCESSED?.[_msgId]) {
        console.log(`[AUTOSAVE] Skipping flagged message ${_msgId}`);
        return;
      }

      // ✅ Block any message whose text/caption contains a payment ref or activation marker
      const _rawCaption =
        m?.message?.imageMessage?.caption ||
        m?.message?.videoMessage?.caption ||
        m?.message?.documentMessage?.caption ||
        m?.message?.conversation ||
        m?.text || m?.body || "";
      if (_rawCaption) {
        const _isPaymentMsg = (
          /\b((?:JT|TRIAL)-[A-Z0-9]+-[A-Z0-9]+)\b/i.test(_rawCaption) ||
          _rawCaption.startsWith("\u200BJTA:")
        );
        if (_isPaymentMsg) {
          console.log(`[AUTOSAVE] Skipping payment/activation message ${_msgId}`);
          global.AUTOSAVE_PROCESSED = global.AUTOSAVE_PROCESSED || {};
          if (_msgId) global.AUTOSAVE_PROCESSED[_msgId] = Date.now();
          return;
        }
      }

      const msg = sanitizeText(getMessageText(m));
      if (!msg) return;

      const contactNumber = await resolvePNFromLID(sock, store, remote);
      if (!contactNumber) return;
      if (contactNumber === ownerNumber) return;

      const blacklist = getBlacklistSet();
      if (blacklist.has(contactNumber)) return;

      // ✅ CRITICAL: Prevent duplicate processing of same message
      const messageId = m?.key?.id || "";
      if (!messageId) return;
      
      global.AUTOSAVE_PROCESSED = global.AUTOSAVE_PROCESSED || {};
      if (global.AUTOSAVE_PROCESSED[messageId]) {
        console.log(`[AUTOSAVE] Skipping duplicate message ${messageId}`);
        return;
      }
      global.AUTOSAVE_PROCESSED[messageId] = Date.now();
      
      // Clean up old processed messages (keep last 1000)
      const processedIds = Object.keys(global.AUTOSAVE_PROCESSED);
      if (processedIds.length > 1000) {
        processedIds.sort((a, b) => global.AUTOSAVE_PROCESSED[a] - global.AUTOSAVE_PROCESSED[b]);
        for (let i = 0; i < 500; i++) {
          delete global.AUTOSAVE_PROCESSED[processedIds[i]];
        }
      }

      const db = readDb();
      db.contacts = db.contacts || {};
      db.contacts[ownerNumber] = db.contacts[ownerNumber] || {};
      const ownerBook = db.contacts[ownerNumber];

      const existing = ownerBook[contactNumber];

      // ✅ DEBUG: Log what we found for this contact
      console.log(`[AUTOSAVE DEBUG] Contact ${contactNumber}:`, {
        exists: !!existing,
        hasResourceName: !!existing?.google?.resourceName,
        hasSavedAt: !!existing?.savedAt,
        hasName: !!existing?.name,
        hasNumber: !!existing?.number,
        existingKeys: existing ? Object.keys(existing).join(', ') : 'null'
      });

      // ✅ ULTRA-CRITICAL: Multi-level saved contact detection
      // A contact is DEFINITELY saved if ANY of these are true:
      let isSaved = false;
      let saveReason = "";

      if (existing) {
        if (existing.google?.resourceName) {
          isSaved = true;
          saveReason = "has Google resourceName";
        } else if (existing.savedAt) {
          isSaved = true;
          saveReason = "has savedAt timestamp";
        } else if (existing.name) {
          isSaved = true;
          saveReason = "has name field";
        } else if (existing.number) {
          isSaved = true;
          saveReason = "has number field";
        } else if (existing.jid) {
          isSaved = true;
          saveReason = "has jid field";
        } else if (existing.rawName) {
          isSaved = true;
          saveReason = "has rawName field";
        }
      }

      if (isSaved) {
        console.log(`[AUTOSAVE] ✋ BLOCKING autosave for SAVED contact ${contactNumber} - Reason: ${saveReason}`);
        
        // Optional: Try to upgrade generic names to real WhatsApp names
        const waName = waDisplayNameForJid(store, remote);
        const generic = getGenericName();
        const wasGeneric = !!existing?.wasGeneric || (!!generic && existing?.rawName === generic);

        if (wasGeneric && waName && waName !== existing.rawName) {
          console.log(`[AUTOSAVE] Attempting to upgrade ${contactNumber} from generic to real name`);
          const upgradedName = applyTag(waName, getTag("old") || "");
          try {
            const res = await upsertContactForOwner({
              ownerNumber,
              contactName: upgradedName,
              contactNumber,
              resourceName: existing.google.resourceName,
            });

            ownerBook[contactNumber] = {
              ...existing,
              name: upgradedName,
              rawName: waName,
              wasGeneric: false,
              savedAt: new Date().toISOString(),
              google: { resourceName: res.resourceName, etag: res.etag, mode: res.mode },
            };

            db.contacts[ownerNumber] = ownerBook;
            writeDb(db);

            // ✅ Invalidate cache so upgraded contact name appears immediately in Google Contacts app
            invalidateContactsCache(ownerNumber);

            noteGoogleSuccess(ownerNumber);
            console.log(`[AUTOSAVE] Successfully upgraded ${contactNumber} to real name`);
          } catch (e) {
            noteGoogleFail(e);
            console.log(`[AUTOSAVE] Failed to upgrade ${contactNumber}:`, e?.message);
          }
        }

        // ✅ ABSOLUTE CRITICAL: NEVER EVER continue past this point for saved contacts
        console.log(`[AUTOSAVE] ⛔ FINAL BLOCK - Exiting autosave flow for saved contact ${contactNumber}`);
        return;
      }

      console.log(`[AUTOSAVE] ✅ Contact ${contactNumber} is NOT in local DB - checking device contacts first...`);

      // ✅ DEVICE CONTACT CHECK: If Baileys store has a real name for this JID,
      // the person IS saved in the device phonebook — do NOT prompt them.
      // This fixes the bug where phone-saved contacts show as "unsaved" just
      // because they aren't found in a linked Google account.
      // DEVICE CHECK: Only local phonebook name (store.contacts[].name) counts as device-saved
      // WA push names (notify/verifiedName) are NOT proof of being saved in phonebook
      const deviceName = waNameForJid(store, remote);
      if (deviceName) {
        console.log(`[AUTOSAVE] ✋ Contact ${contactNumber} has device name "${deviceName}" — skipping autosave prompt.`);
        // Cache locally so future messages skip all checks instantly (no re-scanning)
        ownerBook[contactNumber] = {
          number: contactNumber,
          name: deviceName,
          rawName: deviceName,
          savedAt: new Date().toISOString(),
          wasGeneric: false,
          source: "device_contact",
        };
        db.contacts[ownerNumber] = ownerBook;
        writeDb(db);
        console.log(`[AUTOSAVE] ⛔ FINAL BLOCK — device-saved contact, autosave skipped.`);
        return;
      }

      console.log(`[AUTOSAVE] ✅ No device name found — verifying against Google Contacts...`);

      // ✅ CRITICAL FIX: Check Google Contacts API for pre-existing contacts
      // This catches numbers already saved in Google Contacts BEFORE the bot tracked them.
      // The local DB only knows what the bot itself saved — it has no knowledge of contacts
      // that existed beforehand. Without this check, those show as "unsaved" forever.
      try {
        const googleMatch = await searchContactByPhone(ownerNumber, contactNumber);
        if (googleMatch) {
          console.log(`[AUTOSAVE] ✋ Contact ${contactNumber} ALREADY EXISTS in Google Contacts (resourceName: ${googleMatch.resourceName}) - caching and blocking autosave`);

          // Cache the contact in local DB so future lookups are instant (no API call needed)
          ownerBook[contactNumber] = {
            number: contactNumber,
            name: googleMatch.name || contactNumber,
            rawName: googleMatch.name || null,
            savedAt: new Date().toISOString(),
            google: {
              resourceName: googleMatch.resourceName,
              etag: googleMatch.etag || null,
              mode: "existing",
            },
            wasGeneric: false,
            source: "google_verified", // marks this was found via API lookup, not bot-saved
          };
          db.contacts[ownerNumber] = ownerBook;
          writeDb(db);

          console.log(`[AUTOSAVE] ⛔ FINAL BLOCK - ${contactNumber} is already saved in Google Contacts. Autosave skipped.`);
          return;
        }
        console.log(`[AUTOSAVE] ✅ Confirmed: ${contactNumber} is NOT in Google Contacts - proceeding with autosave flow`);
      } catch (googleCheckErr) {
        // If the API check fails (no auth, network, etc.), fall through and continue as normal.
        // Better to occasionally prompt an already-saved contact than to silently fail.
        console.log(`[AUTOSAVE] ⚠️ Google Contacts API check failed for ${contactNumber}: ${googleCheckErr?.message} - continuing with autosave flow`);
      }

      // ✅ Contact is NOT saved yet: run the name-confirm flow
      // But FIRST check if they're already in the pending flow to avoid re-triggering
      global.AUTOSAVE_PENDING = global.AUTOSAVE_PENDING || {};
      global.AUTOSAVE_PENDING[ownerNumber] = global.AUTOSAVE_PENDING[ownerNumber] || {};
      const pending = global.AUTOSAVE_PENDING[ownerNumber][contactNumber];

      if (pending?.stage === "awaitingConfirm") {
        const yn = normalizeYesNo(msg);
        if (!yn) return;

        if (yn === "no") {
          global.AUTOSAVE_PENDING[ownerNumber][contactNumber] = { stage: "awaitingName", askedAt: Date.now() };
          await sendWithDelay(sock, remote, { text: pick(noTemplates()) }, { quoted: m });
          return;
        }

        const rawName = sanitizeText(pending?.name || "");
        const v = validateUserName(rawName);
        if (!v.ok) {
          global.AUTOSAVE_PENDING[ownerNumber][contactNumber] = { stage: "awaitingName", askedAt: Date.now() };
          await sendWithDelay(sock, remote, { text: v.msg + "\n\nSend your name again." }, { quoted: m });
          return;
        }

        const taggedName = applyTag(v.clean, getTag("new") || "");

        try {
          const savedAt = new Date();
          const res = await upsertContactForOwner({
            ownerNumber,
            contactName: taggedName,
            contactNumber,
            resourceName: null,
          });

          ownerBook[contactNumber] = {
            name: taggedName,
            rawName: v.clean,
            wasGeneric: false,
            number: contactNumber,
            jid: `${contactNumber}@s.whatsapp.net`,
            savedAt: savedAt.toISOString(),
            google: { resourceName: res.resourceName, etag: res.etag, mode: res.mode },
          };

          db.contacts[ownerNumber] = ownerBook;
          writeDb(db);

          console.log(`[AUTOSAVE] ✅ Successfully saved contact ${contactNumber} with name: ${taggedName}`);
          console.log(`[AUTOSAVE] Saved data:`, JSON.stringify(ownerBook[contactNumber]));

          // ✅ CRITICAL: Invalidate Google Contacts cache so new contact appears immediately in Google Contacts app
          invalidateContactsCache(ownerNumber);
          console.log(`[AUTOSAVE] Google Contacts cache invalidated for ${ownerNumber}`);

          noteGoogleSuccess(ownerNumber);
          recordLastSave(ownerNumber, { number: contactNumber, resourceName: res.resourceName, name: taggedName });

          delete global.AUTOSAVE_PENDING[ownerNumber][contactNumber];

          const ownerName = getOwnerName(sock);
          const savedTimeText = formatUtcTime(savedAt);

          const finalText =
            `Your contact has been saved as\n` +
            `Name: *${taggedName}*\n` +
            `Saved on: ${savedTimeText}\n\n` +
            `Kindly save mine as *${ownerName}* so you don't miss out valuable information that I post on my WhatsApp status.`;

          await sendWithDelay(sock, remote, { text: finalText }, { quoted: m });
        } catch (e) {
          noteGoogleFail(e);
          await sendWithDelay(sock, remote, { text: `❌ Autosave failed: ${e?.message || String(e)}` }, { quoted: m });
        }
        return;
      }

      if (pending?.stage === "awaitingName") {
        const v = validateUserName(msg);
        if (!v.ok) {
          await sendWithDelay(sock, remote, { text: v.msg }, { quoted: m });
          return;
        }

        global.AUTOSAVE_PENDING[ownerNumber][contactNumber] = { stage: "awaitingConfirm", name: v.clean, askedAt: Date.now() };
        await sendWithDelay(sock, remote, { text: pick(confirmTemplates(v.clean)) }, { quoted: m });
        return;
      }

      // ✅ Only initiate autosave flow if contact is truly unsaved AND not already pending
      if (!pending) {
        global.AUTOSAVE_PENDING[ownerNumber][contactNumber] = { stage: "awaitingName", askedAt: Date.now() };

        const welcomeCustom = readWelcomeDM();
        const welcomeText = welcomeCustom || DEFAULT_WELCOME;

        await sendWithDelay(sock, remote, { text: welcomeText }, { quoted: m });
        await sendWithDelay(sock, remote, { text: NAME_INSTRUCTION }, { quoted: m });
      }
    } catch {
      // silent
    }
  },
};