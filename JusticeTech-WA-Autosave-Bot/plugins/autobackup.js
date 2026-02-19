// plugins/autobackup.js — JusticeTech Autosave Bot v1.1.1 JT
// ─────────────────────────────────────────────────────────────────────────────
// Auto-backup engine — per-owner configurable interval.
//
// PERMISSIONS:
//   Owner / Premium — toggle their own auto-backup independently
//   Dev             — all owner commands + global controls
//
// COMMANDS (Owner/Premium):
//   .autobackup              — show your auto-backup status
//   .autobackup on           — enable your auto-backup
//   .autobackup off          — disable your auto-backup
//   .autobackup interval 10  — set your interval (1–60 minutes)
//   .autobackup now          — run a backup immediately
//
// DEV EXTRAS:
//   .autobackup all          — show all owner configs
//   .autobackup force <num>  — force backup for specific owner
//   .autobackup global on/off — enable/disable for ALL owners
//
// State stored per-owner in: database/autobackup_config.json
// ─────────────────────────────────────────────────────────────────────────────

"use strict";

const fs   = require("fs");
const path = require("path");

const DB_DIR      = path.join(__dirname, "..", "database");
const AB_CFG_FILE = path.join(DB_DIR, "autobackup_config.json");

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

function jidFromCtx(m) {
  return m?.sender || m?.key?.participant || m?.key?.remoteJid || "";
}

function isDevNum(num) { return DEV_NUMBERS.has(normalizeNumber(num)); }

// ── Per-owner config ──────────────────────────────────────────────────────────

function readAllCfg() {
  if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });
  try {
    const d = JSON.parse(fs.readFileSync(AB_CFG_FILE, "utf8"));
    // migrate legacy flat format
    if (typeof d.enabled === "boolean" && !d.owners) {
      return { owners: { _default: d } };
    }
    if (!d.owners) d.owners = {};
    return d;
  } catch { return { owners: {} }; }
}

function writeAllCfg(data) {
  if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });
  fs.writeFileSync(AB_CFG_FILE, JSON.stringify(data, null, 2));
}

function getOwnerCfg(botNum) {
  const db  = readAllCfg();
  const key = botNum || "_default";
  return db.owners[key] || { enabled: true, intervalMinutes: 5, lastBackupAt: null };
}

function setOwnerCfg(botNum, patch) {
  const db  = readAllCfg();
  const key = botNum || "_default";
  db.owners[key] = { ...(db.owners[key] || { enabled: true, intervalMinutes: 5 }), ...patch };
  writeAllCfg(db);
}

// ── Timer state (process-level per-owner) ─────────────────────────────────────

global.__AB_TIMERS  = global.__AB_TIMERS  || {};
global.__AB_SOCK    = global.__AB_SOCK    || null;
global.__AB_BOTNUM  = global.__AB_BOTNUM  || null;
global.__AB_OWNJID  = global.__AB_OWNJID  || null;
global.__AB_STARTED = global.__AB_STARTED || false;

async function doBackupRun(botNum, ownerJid, sock, manual = false) {
  const cfg = getOwnerCfg(botNum);
  if (!cfg.enabled || !sock || !botNum) return;
  try {
    const { runBackup } = require("./googlebackup");
    // silent=true on scheduled runs — no WA DM spam. Only server + email backup.
    // manual=true (from .autobackup now) sends the full WA DM with restore code.
    await runBackup(sock, ownerJid, botNum, null, !manual);
    setOwnerCfg(botNum, { lastBackupAt: new Date().toISOString() });
    console.log(`[autobackup] ✅ Done for ${botNum} (${manual ? "manual" : "scheduled"})`);
  } catch (e) {
    console.warn(`[autobackup] ❌ Failed for ${botNum}: ${e.message}`);
  }
}

function startOwnerTimer(botNum, ownerJid, sock, intervalMinutes) {
  stopOwnerTimer(botNum);
  const ms = Math.max(1, Math.min(60, Number(intervalMinutes || 5))) * 60 * 1000;
  global.__AB_TIMERS[botNum] = setInterval(() => doBackupRun(botNum, ownerJid, sock, false), ms);
  console.log(`[autobackup] ✅ Timer started for ${botNum} — every ${intervalMinutes || 5}min`);
}

function stopOwnerTimer(botNum) {
  if (global.__AB_TIMERS[botNum]) {
    clearInterval(global.__AB_TIMERS[botNum]);
    delete global.__AB_TIMERS[botNum];
  }
}

// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  name: "AutoBackup",
  category: "autosave",
  desc: "Auto-backup — owner/premium can toggle independently",
  command: ["autobackup", "abk"],
  premiumOnly: true,
  passive: true,

  run: async (ctx) => {
    const { sock, m, args, reply, isOwner, isPremium, botNumber, botJid, prefix, command } = ctx;
    const p = prefix || ".";

    const senderNum   = normalizeNumber(jidFromCtx(m));
    const callerIsDev = isDevNum(senderNum);

    const botNum = normalizeNumber(
      botNumber || (botJid ? String(botJid).split("@")[0] : "") ||
      (sock?.user?.id ? String(sock.user.id).split(":")[0].split("@")[0] : "")
    );
    const ownerJid = jidFromCtx(m) || m?.chat || m?.key?.remoteJid;

    // ── Passive: register sock + start timer ──────────────────────────────────
    if (!command || !String(m?.text || "").startsWith(p)) {
      if (sock)     global.__AB_SOCK   = sock;
      if (botNum)   global.__AB_BOTNUM = botNum;
      if (ownerJid) global.__AB_OWNJID = ownerJid;

      if (!global.__AB_STARTED && botNum) {
        global.__AB_STARTED = true;
        const cfg = getOwnerCfg(botNum);
        if (cfg.enabled) startOwnerTimer(botNum, ownerJid, sock, cfg.intervalMinutes || 5);
      }
      return;
    }

    // ── Command guard ─────────────────────────────────────────────────────────
    if (!isOwner && !isPremium && !callerIsDev) {
      return reply("🔒 Owner or premium subscription required.");
    }

    const sub = String(args?.[0] || "").toLowerCase().trim();
    const cfg = getOwnerCfg(botNum);

    // ── DEV-ONLY EXTRAS ───────────────────────────────────────────────────────

    if (callerIsDev && sub === "all") {
      const db = readAllCfg();
      const entries = Object.entries(db.owners || {});
      if (!entries.length) return reply("📋 No auto-backup configs yet.");
      const lines = entries.map(([k, v]) =>
        `+${k}: ${v.enabled ? "✅ ON" : "❌ OFF"} | ${v.intervalMinutes || 5}min | Last: ${v.lastBackupAt ? v.lastBackupAt.split("T")[0] : "Never"}`
      ).join("\n");
      return reply(`⏰ *All Auto-Backup Configs*\n\n${lines}`);
    }

    if (callerIsDev && sub === "force") {
      const targetNum = normalizeNumber(args[1] || "");
      if (!targetNum) return reply(`Usage: ${p}autobackup force <number>`);
      await reply(`⏳ Forcing backup for +${targetNum}...`);
      await doBackupRun(targetNum, `${targetNum}@s.whatsapp.net`, sock, true);
      return reply(`✅ Backup forced for +${targetNum}.`);
    }

    if (callerIsDev && sub === "global") {
      const toggle = String(args[1] || "").toLowerCase();
      if (toggle !== "on" && toggle !== "off") return reply(`Usage: ${p}autobackup global on|off`);
      const enabled = toggle === "on";
      const db = readAllCfg();
      for (const k of Object.keys(db.owners || {})) db.owners[k].enabled = enabled;
      writeAllCfg(db);
      if (enabled) {
        for (const [k, v] of Object.entries(db.owners)) {
          startOwnerTimer(k, `${k}@s.whatsapp.net`, sock, v.intervalMinutes || 5);
        }
      } else {
        for (const k of Object.keys(db.owners || {})) stopOwnerTimer(k);
      }
      return reply(`✅ Global auto-backup ${enabled ? "ENABLED" : "DISABLED"} for all owners.`);
    }

    // ── OWNER / PREMIUM COMMANDS ───────────────────────────────────────────────

    if (!sub || sub === "status" || sub === "show") {
      const timerOn = !!global.__AB_TIMERS[botNum];
      const lastAt  = cfg.lastBackupAt ? new Date(cfg.lastBackupAt).toLocaleString() : "Never";
      return reply(
        `⏰ *Your Auto-Backup Status*\n\n` +
        `Enabled  : ${cfg.enabled ? "✅ YES" : "❌ NO"}\n` +
        `Timer    : ${timerOn ? "🟢 Running" : "🔴 Stopped"}\n` +
        `Interval : Every *${cfg.intervalMinutes || 5} minute(s)*\n` +
        `Last run : ${lastAt}\n\n` +
        `ℹ️ Scheduled backups save silently to server + email only.\n` +
        `   No WA messages are sent unless you run ${p}autobackup now\n\n` +
        `${p}autobackup on|off           — toggle\n` +
        `${p}autobackup interval <min>   — set frequency\n` +
        `${p}autobackup now              — run now + deliver to WA DM`
      );
    }

    if (sub === "on" || sub === "enable") {
      setOwnerCfg(botNum, { enabled: true });
      startOwnerTimer(botNum, ownerJid, sock, cfg.intervalMinutes || 5);
      return reply(`✅ Your auto-backup is now *ENABLED*.\n⏱️ Runs every ${cfg.intervalMinutes || 5} minute(s).`);
    }

    if (sub === "off" || sub === "disable") {
      setOwnerCfg(botNum, { enabled: false });
      stopOwnerTimer(botNum);
      return reply("⛔ Your auto-backup is *DISABLED*.\nRun `.autobackup on` to re-enable anytime.");
    }

    if (sub === "interval") {
      const mins = parseInt(args[1], 10);
      if (isNaN(mins) || mins < 1 || mins > 60) {
        return reply(`❌ Interval must be 1–60 minutes.\nExample: ${p}autobackup interval 10`);
      }
      setOwnerCfg(botNum, { intervalMinutes: mins });
      if (cfg.enabled) {
        startOwnerTimer(botNum, ownerJid, sock, mins);
        return reply(`✅ Interval set to *${mins} minute(s)*. Timer restarted.`);
      }
      return reply(`✅ Interval set to *${mins} minute(s)*.\n(Auto-backup is OFF — use ${p}autobackup on to start.)`);
    }

    if (sub === "now") {
      if (!sock || !botNum) return reply("❌ Bot not ready. Try again in a moment.");
      await reply("⏳ Running backup now...");
      await doBackupRun(botNum, ownerJid, sock, true); // manual=true → sends WA DM + restore code
      return reply("✅ Backup done. Check your DM for the restore code and backup file.");
    }

    return reply(
      `Usage:\n` +
      `${p}autobackup on/off\n` +
      `${p}autobackup interval <minutes>\n` +
      `${p}autobackup now\n` +
      `${p}autobackup status`
    );
  },
};
