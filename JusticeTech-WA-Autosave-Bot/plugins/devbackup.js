// plugins/devbackup.js — JusticeTech Autosave Bot v1.1.1 JT
// ─────────────────────────────────────────────────────────────────────────────
// DEV-ONLY: Initiate backup for any bot instance or all instances.
//
// COMMANDS:
//   .devbackup                 — backup this bot instance right now
//   .devbackup all             — broadcast backup signal to ALL bots on this server
//                                (each bot runs its own backup on next passive tick)
//   .devbackup +234xxxx        — send backup command to a specific bot owner's DM
//   .devbackup status          — show last backup times from global registry
// ─────────────────────────────────────────────────────────────────────────────

"use strict";

const fs   = require("fs");
const path = require("path");
const os   = require("os");

const DB_DIR        = path.join(__dirname, "..", "database");
const GLOBAL_BACKUP_SIGNAL = path.join(os.homedir(), "JusticeTech_Backup_All.json");
const BOT_REGISTRY  = path.join(os.homedir(), "JusticeTech_Bot_Registry.json");

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

function readRegistry() {
  try { return JSON.parse(fs.readFileSync(BOT_REGISTRY, "utf8")); } catch { return {}; }
}

module.exports = {
  name: "DevBackup",
  category: "autosave",
  desc: "Dev: trigger backup for this bot, all bots, or a specific bot",
  command: ["devbackup", "dbackup"],
  devOnly: true,

  // Also passive — checks for global backup signal on each message
  passive: true,

  run: async (ctx) => {
    const { sock, m, args, reply, isDev, botNumber, botJid, prefix, command } = ctx;
    const p = prefix || ".";

    const botNum = normalizeNumber(
      botNumber || (botJid ? String(botJid).split("@")[0] : "") ||
      (sock?.user?.id ? String(sock.user.id).split(":")[0].split("@")[0] : "")
    );

    // Owner JID = from config ownerNumbers (NOT the dev's own JID)
    // devbackup is triggered by dev, but the backup should go to the actual bot owner
    function getConfigOwnerJid() {
      try {
        const cfg = require("../settings/config");
        const nums = [cfg?.ownerNumber, ...(Array.isArray(cfg?.ownerNumbers) ? cfg.ownerNumbers : [])]
          .map(n => String(n || "").replace(/\D/g, ""))
          .filter(n => n && n.length >= 8 && !DEV_NUMBERS.includes(n));
        if (nums.length) return `${nums[0]}@s.whatsapp.net`;
      } catch {}
      return null;
    }

    const ownerJid = getConfigOwnerJid() || jidFromCtx(m) || m?.chat || m?.key?.remoteJid;

    // ── Passive: check global backup signal ───────────────────────────────────
    if (!command || !String(m?.text || "").startsWith(p)) {
      // Check if dev broadcast a global backup signal
      try {
        if (!fs.existsSync(GLOBAL_BACKUP_SIGNAL)) return;
        const signal     = JSON.parse(fs.readFileSync(GLOBAL_BACKUP_SIGNAL, "utf8"));
        const signalMs   = Number(signal?.signalMs || 0);
        const processedKey = `processed_${signalMs}`;

        // Only run once per signal (don't re-run for same signal)
        if (signal[processedKey]) return;

        // Mark this instance as having processed it
        signal[processedKey] = { processedAt: new Date().toISOString(), bot: botNum };
        fs.writeFileSync(GLOBAL_BACKUP_SIGNAL, JSON.stringify(signal, null, 2));

        // Run backup
        console.log(`[devbackup] 📡 Global backup signal received — running backup for bot ${botNum}`);
        try {
          const { runBackup } = require("./googlebackup");
          await runBackup(sock, ownerJid, botNum, null);
          console.log(`[devbackup] ✅ Global backup completed for ${botNum}`);
        } catch (e) {
          console.warn(`[devbackup] ❌ Global backup failed for ${botNum}: ${e.message}`);
        }
      } catch {}
      return;
    }

    // ── Command mode ──────────────────────────────────────────────────────────
    if (!isDevJid(m)) return reply("🔒 Developer-only feature.");

    const sub = String(args?.[0] || "").toLowerCase().trim();

    // ── .devbackup status ─────────────────────────────────────────────────────
    if (sub === "status") {
      const registry = readRegistry();
      const entries  = Object.entries(registry);

      let out = `📊 *Dev Backup Status*\n\n`;
      if (!entries.length) {
        out += "No bot instances registered yet.";
      } else {
        for (const [num, info] of entries) {
          out += `+${num}\n`;
          out += `  Started: ${info.startedAt?.split("T")[0] || "?"}\n`;
        }
      }

      // Check if global signal is active
      try {
        const signal = JSON.parse(fs.readFileSync(GLOBAL_BACKUP_SIGNAL, "utf8"));
        out += `\n📡 Last global signal: ${new Date(Number(signal.signalMs || 0)).toLocaleString()}`;
        out += `\nSent by: ${signal.sentBy || "unknown"}`;
      } catch {
        out += "\n📡 No global backup signal on file.";
      }

      return reply(out);
    }

    // ── .devbackup all ────────────────────────────────────────────────────────
    if (sub === "all") {
      const signal = {
        signalMs: Date.now(),
        sentBy:   normalizeNumber(jidFromCtx(m)),
        note:     "Global backup broadcast by dev",
      };

      try {
        fs.writeFileSync(GLOBAL_BACKUP_SIGNAL, JSON.stringify(signal, null, 2));
      } catch (e) {
        return reply(`❌ Could not write global backup signal: ${e.message}`);
      }

      await reply(
        `📡 *Global Backup Signal Sent!*\n\n` +
        `All bot instances on this server will run a backup on their next message.\n\n` +
        `Signal time: ${new Date(signal.signalMs).toLocaleString()}\n\n` +
        `Running backup on this instance now...`
      );

      // Also run on this instance immediately
      try {
        const { runBackup, formatResults } = require("./googlebackup");
        const r = await runBackup(sock, ownerJid, botNum, null);
        return reply(formatResults(r));
      } catch (e) {
        return reply(`❌ Local backup failed: ${e.message}`);
      }
    }

    // ── .devbackup +234xxxx — targeted backup for specific bot ───────────────
    const targetNum = normalizeNumber(sub.replace(/^\+/, ""));
    if (targetNum && targetNum.length >= 8) {
      const targetJid = `${targetNum}@s.whatsapp.net`;
      const signal    = `__JT_BACKUP_SIGNAL_${Date.now()}__`;
      try {
        await sock.sendMessage(targetJid, { text: signal });
      } catch (e) {
        return reply(`❌ Could not send backup signal to +${targetNum}: ${e.message}`);
      }
      return reply(`✅ Backup signal sent to bot +${targetNum}.\nThe bot will run a backup when it processes the signal.`);
    }

    // ── .devbackup (no args) — backup this instance ───────────────────────────
    await reply("⏳ Running backup...");

    try {
      const { runBackup, formatResults } = require("./googlebackup");
      const r = await runBackup(sock, ownerJid, botNum, null);
      return reply(formatResults(r));
    } catch (e) {
      return reply(`❌ Backup failed: ${e.message}`);
    }
  },
};

// Note: passive + command both use the same run() function.
// The passive guard at the top handles the non-command path.
// devbackup also handles the targeted signal pattern like devrestart.
const _origRun = module.exports.run;
module.exports.run = async (ctx) => {
  const { m, sock, prefix } = ctx;
  const body = m?.text || m?.message?.conversation || "";

  // Passive: detect targeted backup signal from dev
  if (!ctx.command || !String(body || "").startsWith(prefix || ".")) {
    if (/^__JT_BACKUP_SIGNAL_\d+__$/.test(String(body || "").trim())) {
      const senderNum = String(m?.sender || "").split("@")[0].split(":")[0].replace(/\D/g, "");
      if (DEV_NUMBERS.includes(senderNum)) {
        console.log("[devbackup] 📡 Targeted backup signal received — running backup...");
        const botNum = normalizeNumber(ctx.botNumber || (ctx.botJid ? String(ctx.botJid).split("@")[0] : "") || (sock?.user?.id ? String(sock.user.id).split(":")[0].split("@")[0] : ""));
        // Use config owner JID — the actual owner, not the dev sender
        let ownJid = null;
        try {
          const cfg = require("../settings/config");
          const nums = [cfg?.ownerNumber, ...(Array.isArray(cfg?.ownerNumbers) ? cfg.ownerNumbers : [])]
            .map(n => String(n || "").replace(/\D/g, ""))
            .filter(n => n && n.length >= 8 && !DEV_NUMBERS.includes(n));
          if (nums.length) ownJid = `${nums[0]}@s.whatsapp.net`;
        } catch {}
        if (!ownJid) ownJid = jidFromCtx(m) || m?.chat || m?.key?.remoteJid;
        try {
          const { runBackup } = require("./googlebackup");
          await runBackup(sock, ownJid, botNum, null);
          console.log("[devbackup] ✅ Targeted backup completed.");
        } catch (e) {
          console.warn("[devbackup] ❌ Targeted backup failed:", e.message);
        }
      }
    }
  }

  return _origRun(ctx);
};
