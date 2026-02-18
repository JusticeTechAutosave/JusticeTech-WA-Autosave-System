// plugins/sessionbackup.js — JusticeTech Autosave Bot v1.1.1 JT
// ─────────────────────────────────────────────────────────────────────────────
// Session = WhatsApp auth credentials (sessions/ folder).
// Losing these = bot needs to re-scan QR and re-link WA.
//
// COMMANDS (owner/premium):
//   .sessionbackup          — backup session to WA DM as .txt + to server
//   .sessionrestore <code>  — restore session from backup code
//   .sessioninfo            — show session status and last backup date
//
// Session backup is SEPARATE from data backup (.googlebackup = data/database files).
// This backs up: sessions/creds.json and related auth files.
// ─────────────────────────────────────────────────────────────────────────────

"use strict";

const fs   = require("fs");
const path = require("path");
const os   = require("os");
const zlib = require("zlib");

const BOT_ROOT       = path.join(__dirname, "..");
const SESSIONS_DIR   = path.join(BOT_ROOT, "sessions");
const DB_DIR         = path.join(BOT_ROOT, "database");
const SESSION_BACKUP = path.join(os.homedir(), "JusticeTech_Session_Backup.txt");

const DEV_NUMBERS = ["2349032578690", "2348166337692"];

function normalizeNumber(input) {
  if (!input) return "";
  let s = String(input).trim();
  if (s.includes("@")) s = s.split("@")[0];
  if (s.includes(":")) s = s.split(":")[0];
  s = s.replace(/\D/g, "");
  if (s.length < 8 || s.length > 15) return "";
  return s;
}

function jidFromCtx(m) {
  return m?.sender || m?.key?.participant || m?.key?.remoteJid || "";
}

// ── Collect session files ──────────────────────────────────────────────────────
function collectSession() {
  const bundle = {
    _meta: {
      type:      "session",
      version:   1,
      createdAt: new Date().toISOString(),
      hostname:  os.hostname(),
    },
    files: {},
  };

  if (!fs.existsSync(SESSIONS_DIR)) return bundle;

  const files = fs.readdirSync(SESSIONS_DIR);
  for (const file of files) {
    const full = path.join(SESSIONS_DIR, file);
    try {
      const stat = fs.statSync(full);
      if (stat.isFile()) {
        bundle.files[file] = fs.readFileSync(full, "utf8");
      }
    } catch {}
  }
  return bundle;
}

function encodeSession(bundle) {
  const compressed = zlib.gzipSync(Buffer.from(JSON.stringify(bundle), "utf8"));
  return compressed.toString("base64");
}

function decodeSession(code) {
  const cleaned = code.replace(/\s+/g, "");
  const buf     = Buffer.from(cleaned, "base64");
  if (buf[0] === 0x1f && buf[1] === 0x8b) {
    return JSON.parse(zlib.gunzipSync(buf).toString("utf8"));
  }
  return JSON.parse(buf.toString("utf8"));
}

// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  name: "SessionBackup",
  category: "core",
  desc: "Backup and restore WhatsApp session (auth credentials)",
  command: ["sessionbackup", "sessionrestore", "sessioninfo"],
  ownerOnly: true,

  run: async ({ reply, sock, m, args, command, prefix, isOwner, isDev, isPremium, botNumber, botJid }) => {
    if (!isOwner && !isDev && !isPremium) return reply("🔒 Owner/premium feature.");

    const pfx     = prefix || ".";
    const cmd     = String(command || "").toLowerCase();
    const ownerJid = jidFromCtx(m) || m?.chat || m?.key?.remoteJid;
    const now       = new Date();
  const pad       = n => String(n).padStart(2, "0");
  const datestamp = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
  const filestamp = `${now.getFullYear()}${pad(now.getMonth()+1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}`;

    // ── .sessioninfo ──────────────────────────────────────────────────────────
    if (cmd === "sessioninfo") {
      const exists    = fs.existsSync(SESSIONS_DIR);
      const files     = exists ? fs.readdirSync(SESSIONS_DIR) : [];
      const credsFile = path.join(SESSIONS_DIR, "creds.json");
      let credsInfo   = "Not found";
      try {
        const creds  = JSON.parse(fs.readFileSync(credsFile, "utf8"));
        const me     = creds?.me?.id || creds?.me || "unknown";
        credsInfo    = `Linked: ${me}`;
      } catch {}

      let lastBackup = "Never";
      try {
        const stat   = fs.statSync(SESSION_BACKUP);
        lastBackup   = new Date(stat.mtimeMs).toLocaleString();
      } catch {}

      return reply(
        `📱 *Session Info*\n\n` +
        `Session folder: ${exists ? "✅ Exists" : "❌ Missing"}\n` +
        `Auth files: ${files.length}\n` +
        `Credentials: ${credsInfo}\n\n` +
        `Last backup: ${lastBackup}\n\n` +
        `${pfx}sessionbackup — backup now\n` +
        `${pfx}sessionrestore <code> — restore from backup`
      );
    }

    // ── .sessionbackup ────────────────────────────────────────────────────────
    if (cmd === "sessionbackup") {
      const bundle   = collectSession();
      const fileCount = Object.keys(bundle.files).length;

      if (!fileCount) {
        return reply("❌ No session files found. Is the bot properly linked to WhatsApp?");
      }

      const code = encodeSession(bundle);

      // Save to server
      let serverOk = false;
      try {
        fs.writeFileSync(SESSION_BACKUP, code);
        serverOk = true;
      } catch {}

      // Send to WA DM as .txt document
      let waOk = false;
      const txtName = `JusticeTech_Session_Backup_${filestamp}.txt`;
      try {
        await sock.sendMessage(ownerJid, {
          document: Buffer.from(code, "utf8"),
          mimetype: "text/plain",
          fileName: txtName,
          caption:  [
            `🔐 *WhatsApp Session Backup — ${datestamp}*`,
            ``,
            `This file contains your bot's WhatsApp auth credentials.`,
            `⚠️ Keep it safe — anyone with this can link as your bot.`,
            ``,
            `📱 *Finding on Android:*`,
            `  Files app → Internal Storage → WhatsApp → Media → WhatsApp Documents`,
            ``,
            `🔄 To restore: ${pfx}sessionrestore <paste code from this file>`,
          ].join("\n"),
        });
        waOk = true;

        // Send the code as text too for easy copy-paste
        await sock.sendMessage(ownerJid, {
          text: `🔑 *Session Restore Code* — do NOT share:\n\n${code}`,
        });
      } catch (e) {
        console.warn("[sessionbackup] WA send failed:", e.message);
      }

      return reply(
        `✅ *Session Backup Complete — ${datestamp}*\n\n` +
        `Auth files: ${fileCount}\n\n` +
        `🖥️ Server: ${serverOk ? `✅ ~/JusticeTech_Session_Backup.txt` : "❌ Failed"}\n` +
        `📱 WA DM: ${waOk ? "✅ Sent as .txt + restore code" : "❌ Failed"}\n\n` +
        `⚠️ Session backup ≠ data backup.\n` +
        `For contacts/tokens: ${pfx}googlebackup`
      );
    }

    // ── .sessionrestore <code> ────────────────────────────────────────────────
    if (cmd === "sessionrestore") {
      const code = (args.join("") || "").trim();
      if (!code) {
        // Try to restore from server backup
        if (fs.existsSync(SESSION_BACKUP)) {
          return reply(
            `📋 Server backup found (${new Date(fs.statSync(SESSION_BACKUP).mtimeMs).toLocaleString()})\n\n` +
            `To restore from it:\n${pfx}sessionrestore auto\n\n` +
            `Or paste a backup code:\n${pfx}sessionrestore <code>`
          );
        }
        return reply(
          `Usage: ${pfx}sessionrestore <code>\n\n` +
          `Get the code from:\n` +
          `• The .txt file sent to your DM\n` +
          `• The restore code message sent with backup\n\n` +
          `⚠️ This will overwrite current session. Bot will need to restart.`
        );
      }

      let bundle;
      try {
        if (code === "auto") {
          if (!fs.existsSync(SESSION_BACKUP)) return reply("❌ No server backup found.");
          bundle = decodeSession(fs.readFileSync(SESSION_BACKUP, "utf8"));
        } else {
          bundle = decodeSession(code);
        }
      } catch (e) {
        return reply(`❌ Invalid backup code: ${e.message}`);
      }

      if (!bundle?.files || typeof bundle.files !== "object") {
        return reply("❌ Invalid session bundle — no files found.");
      }

      // Write session files
      if (!fs.existsSync(SESSIONS_DIR)) fs.mkdirSync(SESSIONS_DIR, { recursive: true });

      let restored = 0;
      for (const [filename, content] of Object.entries(bundle.files)) {
        try {
          fs.writeFileSync(path.join(SESSIONS_DIR, filename), String(content), "utf8");
          restored++;
        } catch {}
      }

      return reply(
        `✅ *Session Restored!*\n\n` +
        `Files written: ${restored}\n` +
        `Backup date: ${bundle._meta?.createdAt || "unknown"}\n\n` +
        `⚠️ *Restart the bot now* for the restored session to take effect.\n` +
        `Use: ${pfx}restart`
      );
    }

    return reply(`Usage:\n${pfx}sessionbackup\n${pfx}sessionrestore <code>\n${pfx}sessioninfo`);
  },
};
