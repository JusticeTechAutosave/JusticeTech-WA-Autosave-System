// plugins/maintenance.js — JusticeTech Autosave Bot
// ─────────────────────────────────────────────────────────────────────────────
// Dev-only maintenance mode system.
//
// COMMANDS:
//   .maintenance on <message> --start <time> --end <time>
//       — Enable maintenance mode and broadcast to all premium users
//
//   .maintenance off
//       — Disable maintenance mode and notify users it's back
//
//   .maintenance status
//       — Check current maintenance state
//
//   .maintenance broadcast <message>
//       — Send a one-time message to all active premium users (no mode change)
//
// EXAMPLES:
//   .maintenance on Server upgrade --start 2:00AM --end 4:00AM
//   .maintenance on Database migration. --start 10:00PM --end 11:30PM WAT
//   .maintenance off
//   .maintenance broadcast We fixed the autosave bug. Please restart your bot.
//
// When maintenance is ON:
//   — Every command from any user returns the maintenance message
//   — Autosave passive flows are silently suppressed
// ─────────────────────────────────────────────────────────────────────────────

"use strict";

const fs   = require("fs");
const path = require("path");

const DB_DIR   = path.join(__dirname, "..", "database");
const MAINT_FILE = path.join(DB_DIR, "maintenance.json");

const DEV_NUMBERS = new Set(["2349032578690", "2348166337692"]);

function normalizeNumber(input) {
  if (!input) return "";
  let s = String(input).trim();
  if (s.includes("@")) s = s.split("@")[0];
  if (s.includes(":")) s = s.split(":")[0];
  s = s.replace(/\D/g, "");
  if (s.length < 8 || s.length > 15) return "";
  return s;
}

function isDev(num) {
  return DEV_NUMBERS.has(normalizeNumber(num));
}

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}

function writeJson(file, data) {
  if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function readMaint() {
  return readJson(MAINT_FILE, { active: false, message: "", startTime: "", endTime: "", setAt: null, setBy: null });
}

function writeMaint(data) {
  writeJson(MAINT_FILE, data);
  // Expose globally so other plugins (autosave_google, message.js) can read it
  global.__JT_MAINTENANCE = data;
}

// Load into global on startup
global.__JT_MAINTENANCE = global.__JT_MAINTENANCE || readMaint();

// ── Get all active premium user JIDs ─────────────────────────────────────────
// Reads from the central owner registry (approved_owners.json) which lives on
// the dev's bot and is written every time a subscription is approved or granted.
// Falls back to the local subscription.json for any locally-known users.
function getActivePremiumJids() {
  const now  = Date.now();
  const seen = new Set();
  const jids = [];

  // ── Primary: central owner registry (dev's bot) ───────────────────────────
  try {
    const regPath = path.join(__dirname, "..", "database", "approved_owners.json");
    if (fs.existsSync(regPath)) {
      const reg = JSON.parse(fs.readFileSync(regPath, "utf8"));
      for (const [num, entry] of Object.entries(reg.owners || {})) {
        const digits = String(num).replace(/\D/g, "");
        if (!digits || DEV_NUMBERS.has(digits)) continue;
        if (seen.has(digits)) continue;
        if (Number(entry.expiresAtMs || 0) > now) {
          seen.add(digits);
          jids.push(`${digits}@s.whatsapp.net`);
        }
      }
    }
  } catch (e) {
    console.log("[maintenance] registry read err:", e && e.message);
  }

  // ── Fallback: local subscription.json ────────────────────────────────────
  try {
    const { isActive, invalidateCache, SUB_FILE } = require("../library/subscriptionDb");
    try { invalidateCache(); } catch {}
    if (fs.existsSync(SUB_FILE)) {
      const db = JSON.parse(fs.readFileSync(SUB_FILE, "utf8"));
      for (const [num, sub] of Object.entries(db.users || {})) {
        const digits = String(num).replace(/\D/g, "");
        if (!digits || DEV_NUMBERS.has(digits) || seen.has(digits)) continue;
        if (isActive(sub)) {
          seen.add(digits);
          jids.push(`${digits}@s.whatsapp.net`);
        }
      }
    }
  } catch {}

  return jids;
}

// ── Broadcast to all premium users ───────────────────────────────────────────
async function broadcastToAll(sock, text, excludeJid) {
  const jids = getActivePremiumJids();
  let sent = 0, failed = 0;

  for (const jid of jids) {
    if (excludeJid && jid === excludeJid) continue;
    try {
      await sock.sendMessage(jid, { text });
      sent++;
      // Small delay to avoid rate limiting
      await new Promise(r => setTimeout(r, 400));
    } catch { failed++; }
  }
  return { sent, failed, total: jids.length };
}

// ── Parse --start and --end flags from args ────────────────────────────────
function parseFlags(argStr) {
  const startMatch = argStr.match(/--start\s+([^\-]+?)(?=\s*--|$)/i);
  const endMatch   = argStr.match(/--end\s+([^\-]+?)(?=\s*--|$)/i);
  const startTime  = startMatch ? startMatch[1].trim() : "";
  const endTime    = endMatch   ? endMatch[1].trim()   : "";
  // Remove flags from the message body
  const message = argStr
    .replace(/--start\s+[^\-]+?(?=\s*--|$)/gi, "")
    .replace(/--end\s+[^\-]+?(?=\s*--|$)/gi, "")
    .trim();
  return { message, startTime, endTime };
}

function fmtTime(isoStr) {
  if (!isoStr) return "—";
  try {
    const d = new Date(isoStr);
    const pad = n => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } catch { return isoStr; }
}

// ── Build the maintenance message shown to users ──────────────────────────
function buildUserMessage(maint) {
  const userMsg = maint.message || "The bot is currently undergoing scheduled maintenance.";
  const lines = [];

  lines.push("🔧 *Bot Maintenance In Progress*");
  lines.push("");
  lines.push("*" + userMsg + "*");
  lines.push("");

  // Timing block — only render if at least one time is set
  if (maint.startTime || maint.endTime) {
    lines.push("─────────────────────");
    if (maint.startTime) lines.push("🕐 *Start Time :* " + maint.startTime);
    if (maint.endTime)   lines.push("🕑 *End Time   :* " + maint.endTime);
    lines.push("─────────────────────");
    lines.push("");
  }

  lines.push("⏳ All bot features are temporarily unavailable.");
  lines.push("✅ You will be notified automatically when we're back online.");
  lines.push("");
  lines.push("We apologize for the inconvenience. — *JusticeTech Team*");

  return lines.join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
module.exports = {
  name: "Maintenance",
  category: "system",
  desc: "Dev-only: enable/disable maintenance mode and broadcast to all premium users",
  command: ["maintenance", "maint"],
  devOnly: true,

  // Export so message.js / index.js can check it
  isMaintenance: () => {
    const m = global.__JT_MAINTENANCE || readMaint();
    return !!m.active;
  },
  getMaintenanceMessage: () => {
    const m = global.__JT_MAINTENANCE || readMaint();
    return buildUserMessage(m);
  },

  run: async ({ reply, args, sock, m, isDev: callerIsDev, senderNumber, prefix }) => {
    if (!callerIsDev) {
      return reply("🔒 This command is for developers only.");
    }

    const pfx = prefix || ".";
    const sub = String(args?.[0] || "").toLowerCase();
    const senderJid = m?.sender || m?.key?.remoteJid || "";

    // ── .maintenance status ───────────────────────────────────────────────────
    if (!sub || sub === "status") {
      const maint = readMaint();
      const premiumCount = getActivePremiumJids().length;

      return reply(
        `🔧 *Maintenance Status*\n\n` +
        `Active   : ${maint.active ? "🔧 YES — bot is in maintenance mode" : "✅ NO — bot is fully LIVE"}\n` +
        `Set at   : ${fmtTime(maint.setAt)}\n` +
        (maint.startTime ? `Start    : ${maint.startTime}\n` : "") +
        (maint.endTime   ? `End      : ${maint.endTime}\n`   : "") +
        (maint.message   ? `\nMessage:\n${maint.message}\n`  : "") +
        `\n📊 Premium users to notify: ${premiumCount}\n\n` +
        `Commands:\n` +
        `${pfx}maintenance on <msg> --start <time> --end <time>\n` +
        `${pfx}maintenance off\n` +
        `${pfx}maintenance broadcast <message>\n` +
        `${pfx}maintenance status`
      );
    }

    // ── .maintenance on <message> --start <time> --end <time> ────────────────
    if (sub === "on") {
      const rawArgs = (args || []).slice(1).join(" ").trim();

      if (!rawArgs) {
        return reply(
          `Usage: ${pfx}maintenance on <message> --start <time> --end <time>\n\n` +
          `Example:\n` +
          `${pfx}maintenance on Server upgrade in progress. --start 2:00AM --end 4:00AM WAT\n\n` +
          `• --start and --end are optional but recommended\n` +
          `• The message is shown to all users during maintenance`
        );
      }

      const { message, startTime, endTime } = parseFlags(rawArgs);

      if (!message) {
        return reply(`❌ Please include a maintenance message.\n\nExample:\n${pfx}maintenance on We are upgrading our servers. --start 10PM --end 11PM`);
      }

      const maint = {
        active:    true,
        message,
        startTime,
        endTime,
        setAt:     new Date().toISOString(),
        setBy:     normalizeNumber(senderNumber || senderJid),
      };

      writeMaint(maint);

      await reply(
        `✅ *Maintenance mode ENABLED.*\n\n` +
        `Message : ${message}\n` +
        (startTime ? `Start   : ${startTime}\n` : "") +
        (endTime   ? `End     : ${endTime}\n`   : "") +
        `\n📢 Broadcasting to all premium users...`
      );

      // Broadcast to all premium users
      const broadcastText = buildUserMessage(maint);
      const result = await broadcastToAll(sock, broadcastText, senderJid);

      return reply(
        `📢 *Broadcast complete.*\n\n` +
        `✅ Sent    : ${result.sent}\n` +
        `❌ Failed  : ${result.failed}\n` +
        `👥 Total   : ${result.total}\n\n` +
        `All bot commands will now return the maintenance message until you run:\n` +
        `${pfx}maintenance off`
      );
    }

    // ── .maintenance off ──────────────────────────────────────────────────────
    if (sub === "off") {
      const prev = readMaint();
      if (!prev.active) {
        return reply("ℹ️ Maintenance mode is already OFF. Bot is live.");
      }

      writeMaint({
        active:    false,
        message:   "",
        startTime: "",
        endTime:   "",
        setAt:     new Date().toISOString(),
        setBy:     normalizeNumber(senderNumber || senderJid),
      });

      await reply(
        `✅ *Maintenance mode DISABLED.*\n\n` +
        `The bot is now LIVE again.\n\n` +
        `📢 Notifying all premium users...`
      );

      // Notify all premium users that maintenance is over
      const backOnlineText =
        `✅ *Bot is Back Online!*\n\n` +
        `Maintenance has been completed successfully.\n` +
        `All features are now fully restored.\n\n` +
        `Thank you for your patience! 🎉\n` +
        `— *JusticeTech Team*`;

      const result = await broadcastToAll(sock, backOnlineText, senderJid);

      return reply(
        `📢 *Back-online notification sent.*\n\n` +
        `✅ Sent   : ${result.sent}\n` +
        `❌ Failed : ${result.failed}\n` +
        `👥 Total  : ${result.total}`
      );
    }

    // ── .maintenance broadcast <message> ──────────────────────────────────────
    if (sub === "broadcast") {
      const message = (args || []).slice(1).join(" ").trim();

      if (!message) {
        return reply(`Usage: ${pfx}maintenance broadcast <message>\n\nExample:\n${pfx}maintenance broadcast We just fixed the autosave bug. Please restart your bot.`);
      }

      await reply(`📢 Broadcasting to all premium users...\n\nMessage:\n${message}`);

      const result = await broadcastToAll(sock, message, senderJid);

      return reply(
        `📢 *Broadcast complete.*\n\n` +
        `✅ Sent   : ${result.sent}\n` +
        `❌ Failed : ${result.failed}\n` +
        `👥 Total  : ${result.total}`
      );
    }

    return reply(
      `*Maintenance Commands:*\n\n` +
      `${pfx}maintenance status\n` +
      `   — Check current maintenance state\n\n` +
      `${pfx}maintenance on <message> --start <time> --end <time>\n` +
      `   — Enable maintenance + broadcast to all users\n\n` +
      `${pfx}maintenance off\n` +
      `   — Disable maintenance + notify users bot is back\n\n` +
      `${pfx}maintenance broadcast <message>\n` +
      `   — Send a one-time message to all premium users`
    );
  },
};
