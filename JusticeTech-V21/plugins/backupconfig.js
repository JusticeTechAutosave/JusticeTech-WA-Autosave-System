// plugins/backupconfig.js
// ─────────────────────────────────────────────────────────────────────────────
// Lets each bot owner configure where their backups are saved.
//
// USAGE (owner/premium):
//   .backupconfig                          — show current config
//   .backupconfig email your@email.com     — set preferred backup email
//   .backupconfig email off                — disable email backup
//   .backupconfig wa on/off                — enable/disable WA DM document backup
//   .backupconfig server on/off            — enable/disable server home-dir backup
//   .backupconfig reset                    — reset to defaults
//
// Config stored per bot-number in database/backup_config.json
// ─────────────────────────────────────────────────────────────────────────────

"use strict";

const fs   = require("fs");
const path = require("path");

const DB_DIR         = path.join(__dirname, "..", "database");
const CONFIG_FILE    = path.join(DB_DIR, "backup_config.json");

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

function isDevJid(m) {
  const d = normalizeNumber(jidFromCtx(m));
  return !!d && DEV_NUMBERS.includes(d);
}

function isEmailValid(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || "").trim());
}

function readConfig() {
  if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });
  try {
    const raw = fs.readFileSync(CONFIG_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeConfig(data) {
  if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(data, null, 2));
}

function getOwnerConfig(botNum) {
  const all = readConfig();
  return all[botNum] || {
    email:          "",      // preferred backup email (empty = use linked Google)
    waBackup:       true,    // send backup document to WA DM
    serverBackup:   true,    // save to ~/JusticeTech_Autosave_Backup.json
    emailBackup:    true,    // send email backup
  };
}

function saveOwnerConfig(botNum, cfg) {
  const all = readConfig();
  all[botNum] = { ...getOwnerConfig(botNum), ...cfg, updatedAt: new Date().toISOString() };
  writeConfig(all);
  return all[botNum];
}

// Exported so other plugins can read backup config for a given bot
function getBackupConfig(botNum) {
  return getOwnerConfig(normalizeNumber(botNum));
}

module.exports = {
  name: "BackupConfig",
  category: "core",
  desc: "Configure backup destinations: email, WA DM, server",
  command: ["backupconfig", "bkconfig"],
  ownerOnly: true,

  getBackupConfig,  // exported for use by googlebackup.js

  run: async ({ reply, m, args, prefix, isOwner, isDev, isPremium, botNumber, botJid, sock }) => {
    if (!isOwner && !isDev && !isPremium) return reply("🔒 Owner/premium feature.");

    const botNum = normalizeNumber(
      botNumber || (botJid ? String(botJid).split("@")[0] : "") ||
      (sock?.user?.id ? String(sock.user.id).split(":")[0].split("@")[0] : "")
    );

    if (!botNum) return reply("❌ Could not resolve bot number.");

    const p   = prefix || ".";
    const sub = String(args?.[0] || "").toLowerCase().trim();
    const val = args.slice(1).join(" ").trim();

    const cfg = getOwnerConfig(botNum);

    // ── Show current config ───────────────────────────────────────────────────
    if (!sub || sub === "show" || sub === "status") {
      return reply(
        `⚙️ *Backup Configuration*\n` +
        `Bot: +${botNum}\n\n` +
        `📧 Email:    ${cfg.email || "(use linked Google account)"}\n` +
        `   Email backup:  ${cfg.emailBackup  ? "✅ ON" : "❌ OFF"}\n\n` +
        `📱 WA DM:    ${cfg.waBackup     ? "✅ ON" : "❌ OFF"}\n` +
        `🖥️ Server:   ${cfg.serverBackup ? "✅ ON" : "❌ OFF"}\n\n` +
        `─────────────────────────\n` +
        `${p}backupconfig email your@gmail.com   — set backup email\n` +
        `${p}backupconfig email off              — disable email backup\n` +
        `${p}backupconfig wa on/off              — toggle WA DM backup\n` +
        `${p}backupconfig server on/off          — toggle server backup\n` +
        `${p}backupconfig reset                  — reset to defaults`
      );
    }

    // ── Set email ─────────────────────────────────────────────────────────────
    if (sub === "email") {
      if (!val) {
        return reply(
          `Usage: ${p}backupconfig email your@gmail.com\n` +
          `Or:    ${p}backupconfig email off\n\n` +
          `Current: ${cfg.email || "(uses linked Google account email)"}`
        );
      }

      if (val.toLowerCase() === "off") {
        saveOwnerConfig(botNum, { emailBackup: false });
        return reply("✅ Email backup disabled.");
      }

      if (!isEmailValid(val)) {
        return reply(`❌ "${val}" is not a valid email address.`);
      }

      saveOwnerConfig(botNum, { email: val.toLowerCase(), emailBackup: true });
      return reply(`✅ Backup email set to: *${val.toLowerCase()}*\nEmail backup: ON`);
    }

    // ── Toggle WA backup ──────────────────────────────────────────────────────
    if (sub === "wa" || sub === "whatsapp") {
      const on = val === "on" || val === "1" || val === "true";
      const off = val === "off" || val === "0" || val === "false";
      if (!on && !off) return reply(`Usage: ${p}backupconfig wa on\n       ${p}backupconfig wa off`);
      saveOwnerConfig(botNum, { waBackup: on });
      return reply(`✅ WhatsApp DM backup: ${on ? "ON ✅" : "OFF ❌"}`);
    }

    // ── Toggle server backup ──────────────────────────────────────────────────
    if (sub === "server") {
      const on = val === "on" || val === "1" || val === "true";
      const off = val === "off" || val === "0" || val === "false";
      if (!on && !off) return reply(`Usage: ${p}backupconfig server on\n       ${p}backupconfig server off`);
      saveOwnerConfig(botNum, { serverBackup: on });
      return reply(`✅ Server backup: ${on ? "ON ✅" : "OFF ❌"}`);
    }

    // ── Reset ──────────────────────────────────────────────────────────────────
    if (sub === "reset") {
      saveOwnerConfig(botNum, { email: "", waBackup: true, serverBackup: true, emailBackup: true });
      return reply("✅ Backup config reset to defaults.\n\n• Email: linked Google account\n• WA DM: ON\n• Server: ON");
    }

    return reply(
      `❓ Unknown option: *${sub}*\n\n` +
      `${p}backupconfig show\n` +
      `${p}backupconfig email your@email.com\n` +
      `${p}backupconfig wa on/off\n` +
      `${p}backupconfig server on/off\n` +
      `${p}backupconfig reset`
    );
  },
};
