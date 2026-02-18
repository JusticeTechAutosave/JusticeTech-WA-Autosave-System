// plugins/googlebackup.js — JusticeTech Autosave Bot v1.1.1 JT
// ─────────────────────────────────────────────────────────────────────────────
// Manual backup command. Delivers to ALL configured destinations:
//   1. Server home dir  → ~/JusticeTech_Autosave_Backup.json  (auto-restores on startup)
//   2. User's WA DM     → .json document (downloadable to phone file manager)
//   3. User's email     → Gmail API with .json attachment (preferred email or linked Google)
//
// USAGE:
//   .googlebackup             — backup this bot's data
//   .googlebackup email x@y.z — one-time backup to a specific email (no config change)
//
// Config: .backupconfig (set permanent email, toggle WA/server/email destinations)
// ─────────────────────────────────────────────────────────────────────────────

"use strict";

const fs   = require("fs");
const path = require("path");
const os   = require("os");
const zlib = require("zlib");
const { google } = require("googleapis");

const {
  TOKENS_FILE,
  HOME_BACKUP_FILE,
  getUserAccounts,
  getAuthedClientForUser,
  normalizeNumber,
} = require("../library/googleTenantAuth");

const DEV_NUMBERS    = new Set(["2349032578690", "2348166337692"]);

const BOT_ROOT     = path.join(__dirname, "..");
const DATA_DIR     = path.join(BOT_ROOT, "data");
const DB_DIR       = path.join(BOT_ROOT, "database");
const SETTINGS_DIR = path.join(BOT_ROOT, "settings");

function jidFromCtx(m) {
  return m?.sender || m?.key?.participant || m?.key?.remoteJid || "";
}

// ── Get all active premium user JIDs (for backup notification) ───────────────
const DEV_NUMS_BACKUP = DEV_NUMBERS;

function getActivePremiumJids() {
  try {
    const { isActive, invalidateCache, SUB_FILE } = require("../library/subscriptionDb");
    // Always invalidate so we see freshly approved subscriptions
    try { invalidateCache(); } catch {}
    if (!fs.existsSync(SUB_FILE)) return [];
    const db = JSON.parse(fs.readFileSync(SUB_FILE, "utf8"));
    const jids = [];
    for (const [num, sub] of Object.entries(db.users || {})) {
      const digits = String(num).replace(/\D/g, "");
      if (!digits || DEV_NUMS_BACKUP.has(digits)) continue; // never include devs
      if (isActive(sub)) jids.push(`${digits}@s.whatsapp.net`);
    }
    return jids;
  } catch { return []; }
}



// ── Collect all JSON files from data/, database/, settings/ ──────────────────
function collectBotData() {
  const bundle = {
    _meta: {
      version:   2,
      createdAt: new Date().toISOString(),
      hostname:  os.hostname(),
    },
    data:     {},
    database: {},
    settings: {},
  };

  function loadDir(dir, target) {
    if (!fs.existsSync(dir)) return;
    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith(".json")) continue;
      try { target[file] = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8")); } catch {}
    }
  }

  loadDir(DATA_DIR,      bundle.data);
  loadDir(DB_DIR,        bundle.database);
  loadDir(SETTINGS_DIR,  bundle.settings);
  return bundle;
}

// ── Compact restore code — only essential auth data, NOT entire bundle ──────────
// Full bundle goes as the .txt file attachment.
// Restore code only needs: google_tokens.json + oauth_config.json (tiny)
function makeRestoreCode(bundle) {
  const essential = {
    _v: 3,
    _at: new Date().toISOString(),
    data: {},
  };
  // Only include auth files (tokens + oauth config) — these are all restore needs
  const authFiles = ["google_tokens.json", "oauth_config.json", "google_auth.json"];
  for (const f of authFiles) {
    if (bundle.data?.[f]) essential.data[f] = bundle.data[f];
  }
  const compressed = zlib.gzipSync(Buffer.from(JSON.stringify(essential), "utf8"));
  return compressed.toString("base64");
}

// ── Full bundle encode (for file attachment — not used as a chat code) ──────────
function encodeBundle(obj) {
  const compressed = zlib.gzipSync(Buffer.from(JSON.stringify(obj), "utf8"));
  return compressed.toString("base64");
}

// ── 1. Server backup ──────────────────────────────────────────────────────────
function doServerBackup(tokensJson) {
  try {
    fs.writeFileSync(HOME_BACKUP_FILE, tokensJson);
    return { ok: true, path: HOME_BACKUP_FILE };
  } catch (e) {
    console.warn("[backup] server backup failed:", e.message);
    return { ok: false, error: e.message };
  }
}

// ── 2. WA document (goes to user's phone file manager when downloaded) ─────────
async function doWABackup(sock, targetJid, filename, bundle, datestamp) {
  try {
    const jsonContent = JSON.stringify(bundle, null, 2);
    // Send as .txt — appears in ALL Android file managers and can be viewed in any text app
    // WhatsApp saves documents to: Phone Storage/WhatsApp/Media/WhatsApp Documents/
    const txtFilename = filename;  // already .txt
    await sock.sendMessage(targetJid, {
      document: Buffer.from(jsonContent, "utf8"),
      mimetype: "text/plain",
      fileName: txtFilename,
      caption: [
        `📦 *JusticeTech Bot Backup — ${datestamp}*`,
        ``,
        `📱 *Finding this file on Android:*`,
        `  1. Open your Files / My Files app`,
        `  2. Go to Internal Storage → WhatsApp → Media → WhatsApp Documents`,
        `  3. File: *${txtFilename}*`,
        ``,
        `💡 Tap the file above to download it directly to your phone.`,
        `🔄 To restore: .googlerestore <code in next message>`,
      ].join("\n"),
    });
    return { ok: true };
  } catch (e) {
    console.warn("[backup] WA backup failed:", e.message);
    return { ok: false, error: e.message };
  }
}

// ── 3. Email backup via Gmail API ─────────────────────────────────────────────
async function doEmailBackup(ownerNumber, recipientEmail, filename, bundle) {
  const auth = getAuthedClientForUser(ownerNumber);
  if (!auth) throw new Error("No linked Google account. Run .linkgoogle first.");

  const gmail    = google.gmail({ version: "v1", auth });
  const subject  = `JusticeTech Bot Backup — ${new Date().toISOString().split("T")[0]}`;
  const bodyText = [
    "JusticeTech Autosave Bot — Full Backup",
    "",
    `Backup Date : ${new Date().toUTCString()}`,
    `Server Host : ${os.hostname()}`,
    "",
    "This email was sent automatically by JusticeTech Autosave Bot.",
    "",
    "RESTORING:",
    "  Same server: tokens auto-restore on startup.",
    "  New server : .googlerestore <code from WA DM>",
    "  Manual     : extract the attached JSON into data/ and database/ folders.",
    "",
    "⚠️ Keep this file safe — it contains your Google OAuth tokens.",
  ].join("\n");

  const b64File  = Buffer.from(JSON.stringify(bundle, null, 2)).toString("base64");
  const boundary = "----=_JTBackup_Boundary";

  const mime = [
    "MIME-Version: 1.0",
    "From: me",
    `To: ${recipientEmail}`,
    `Subject: ${subject}`,
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "",
    bodyText,
    "",
    `--${boundary}`,
    `Content-Type: application/json; name="${filename}"`,
    `Content-Disposition: attachment; filename="${filename}"`,
    "Content-Transfer-Encoding: base64",
    "",
    b64File,
    "",
    `--${boundary}--`,
  ].join("\n");

  await gmail.users.messages.send({
    userId:      "me",
    requestBody: { raw: Buffer.from(mime).toString("base64url") },
  });
  return true;
}

// ── Core backup runner — used by both command and auto-backup ─────────────────
// Returns a result object so callers can report status.
// ownerJid: JID of whoever triggered the backup (for manual command)
//           For auto-backup, pass null — function will resolve owner from owner.json
async function runBackup(sock, ownerJid, botNum, overrideEmail) {
  const bundle    = collectBotData();
  const now        = new Date();
  const pad        = n => String(n).padStart(2, "0");
  const datestamp  = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
  const filestamp  = `${now.getFullYear()}${pad(now.getMonth()+1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}`;
  const filename  = `JusticeTech_Autosave_Backup_${filestamp}.txt`;
  const tokensJson = JSON.stringify(bundle.data["google_tokens.json"] || {}, null, 2);
  const code       = makeRestoreCode(bundle);  // short code — tokens only
  const accounts   = botNum ? getUserAccounts(botNum) : [];
  const linkedEmail = accounts?.[0]?.email || "";

  // ── Resolve owner JID — use botNum from config, NOT dev's sender JID ──────
  // Priority:
  //   1. ownerJid passed in (only trust if it's not a dev number)
  //   2. botNum itself — the bot number IS effectively the owner's identifier
  //   3. config.js ownerNumbers
  const recipientJids = new Set();

  // Helper: add JID if not a dev number
  function addIfNotDev(numOrJid) {
    if (!numOrJid) return;
    const num = String(numOrJid).split("@")[0].replace(/\D/g, "");
    if (!num || num.length < 8 || DEV_NUMBERS.has(num)) return;
    recipientJids.add(`${num}@s.whatsapp.net`);
  }

  // 1. Explicit ownerJid passed in (from manual .googlebackup command — sender is the owner)
  //    Only use it if it's NOT a dev number
  if (ownerJid) addIfNotDev(ownerJid);

  // 2. If botNum is known, owners from config are the real owners
  try {
    const cfg = require("../settings/config");
    const one  = cfg?.ownerNumber;
    const many = Array.isArray(cfg?.ownerNumbers) ? cfg.ownerNumbers : [];
    if (one) addIfNotDev(one);
    for (const n of many) addIfNotDev(n);
  } catch {}

  // 3. Active premium users also receive backup notification
  for (const premJid of getActivePremiumJids()) {
    addIfNotDev(premJid);
  }

  // If still empty (all devs, no config owners), fall back to ownerJid raw
  if (recipientJids.size === 0 && ownerJid) {
    const num = String(ownerJid).split("@")[0].replace(/\D/g, "");
    if (num && num.length >= 8) recipientJids.add(`${num}@s.whatsapp.net`);
  }

  // Read per-owner backup config
  let bkCfg = { waBackup: true, serverBackup: true, emailBackup: true, email: "" };
  try {
    const { getBackupConfig } = require("./backupconfig");
    bkCfg = { ...bkCfg, ...getBackupConfig(botNum) };
  } catch {}

  const recipientEmail = overrideEmail || bkCfg.email || linkedEmail;
  const fileCount = Object.keys(bundle.data).length + Object.keys(bundle.database).length + Object.keys(bundle.settings).length;

  const results = {};

  // 1. Server
  if (bkCfg.serverBackup) {
    results.server = doServerBackup(tokensJson);
  } else {
    results.server = { ok: false, skipped: true };
  }

  // 2. WA DM — send to owner + all premium users
  if (bkCfg.waBackup && sock && recipientJids.size > 0) {
    let waOk = false;
    let waErr = null;
    for (const jid of recipientJids) {
      try {
        await doWABackup(sock, jid, filename, bundle, datestamp);
        // Send restore code as separate message (so it can be copy-pasted)
        await sock.sendMessage(jid, {
          text: `🔑 *Restore Code* — keep this safe:\n\n${code}\n\n⚠️ Do NOT share with anyone.`,
        });
        waOk = true;
      } catch (e) {
        waErr = e.message;
        console.warn(`[backup] WA DM to ${jid} failed:`, e.message);
      }
    }
    results.wa = waOk ? { ok: true } : { ok: false, error: waErr || "All DMs failed" };
  } else {
    results.wa = { ok: false, skipped: !bkCfg.waBackup };
  }

  // 3. Email
  if (bkCfg.emailBackup && recipientEmail && botNum) {
    try {
      await doEmailBackup(botNum, recipientEmail, filename, bundle);
      results.email = { ok: true, to: recipientEmail };
    } catch (e) {
      results.email = { ok: false, error: e.message };
    }
  } else {
    results.email = { ok: false, skipped: !bkCfg.emailBackup || !recipientEmail, noEmail: !recipientEmail };
  }

  return { results, fileCount, datestamp, accounts, filename, linkedEmail };
}

// ── Format a concise result summary ──────────────────────────────────────────
function formatResults({ results, fileCount, datestamp, accounts, linkedEmail }) {
  const r      = results;
  const accList = accounts.length ? accounts.map((a, i) => `  ${i + 1}. ${a.email}`).join("\n") : "  (none)";

  const serverLine = r.server?.skipped ? "⏭️ Skipped (disabled)"
    : r.server?.ok ? `✅ Server: ~/JusticeTech_Autosave_Backup.json`
    : `❌ Failed: ${r.server?.error || "unknown"}`;

  const waLine = r.wa?.skipped ? "⏭️ Skipped (disabled)"
    : r.wa?.ok ? "✅ Sent as .txt document (see DM) + restore code"
    : `❌ Failed: ${r.wa?.error || "unknown"}`;

  const emailLine = r.email?.skipped && r.email?.noEmail ? "⚠️ No email configured (run .backupconfig email your@email.com)"
    : r.email?.skipped ? "⏭️ Skipped (disabled)"
    : r.email?.ok ? `✅ Sent to ${r.email?.to}`
    : `❌ Failed: ${r.email?.error || "unknown"}`;

  return [
    `✅ *Backup Complete*`,
    ``,
    `📋 *Google Accounts:*`,
    accList,
    ``,
    `📁 Files: ${fileCount} JSON files`,
    ``,
    `🖥️ Server:    ${serverLine}`,
    `📱 WA DM:     ${waLine}`,
    `📧 Email:     ${emailLine}`,
    ``,
    `💡 Configure destinations: .backupconfig`,
  ].join("\n");
}

// Export runBackup for use by autobackup.js and devbackup.js
module.exports = {
  name: "GoogleBackup",
  category: "autosave",
  desc: "Backup bot data to server, WA DM and email (owner/premium)",
  command: ["googlebackup", "backupgoogle", "backup"],
  premiumOnly: true,

  runBackup,
  formatResults,

  run: async ({ reply, sock, m, args, botNumber, botJid, isOwner, isDev, isPremium }) => {
    if (!isOwner && !isDev && !isPremium) return reply("🔒 Owner or premium feature.");

    const botNum = normalizeNumber(
      botNumber || (botJid ? String(botJid).split("@")[0] : "") ||
      (sock?.user?.id ? String(sock.user.id).split(":")[0].split("@")[0] : "")
    );

    const overrideEmail = args?.[0]?.toLowerCase() === "email" ? args[1] : null;

    await reply("⏳ Collecting and sending backup...");

    const senderJid = jidFromCtx(m);
    const ownerJid  = senderJid || m?.chat || m?.key?.remoteJid;

    const r = await runBackup(sock, ownerJid, botNum, overrideEmail);
    return reply(formatResults(r));
  },
};
