// plugins/devrestart.js
// ─────────────────────────────────────────────────────────────────────────────
// DEV-ONLY commands to remotely restart bot instances.
//
//   .devrestart             — restart this bot instance
//   .devrestart all         — broadcast restart signal to ALL bots on this server
//                             (they check ~/JusticeTech_Restart_All.json on next message)
//   .devrestart +234xxxx    — send a restart command to a specific bot owner's DM
//   .devrestart list        — show all known bot instances (from global registry)
//   .devrestart status      — show global restart signal status
// ─────────────────────────────────────────────────────────────────────────────

"use strict";

const fs   = require("fs");
const path = require("path");
const os   = require("os");

const DATA_DIR           = path.join(__dirname, "..", "data");
const RESTART_PENDING_FILE = path.join(DATA_DIR, "restart_pending.json");
const TOKENS_FILE        = path.join(DATA_DIR, "google_tokens.json");
const HOME_BACKUP_FILE   = path.join(os.homedir(), "JusticeTech_Autosave_Backup.json");
const GLOBAL_RESTART_FILE = path.join(os.homedir(), "JusticeTech_Restart_All.json");
const BOT_REGISTRY_FILE  = path.join(os.homedir(), "JusticeTech_Bot_Registry.json");

const DEV_NUMBERS = ["2349032578690", "2348166337692"];

// ── Helpers ───────────────────────────────────────────────────────────────────

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

function backupTokens() {
  try {
    if (!fs.existsSync(TOKENS_FILE)) return;
    const raw    = fs.readFileSync(TOKENS_FILE, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed?.users && Object.keys(parsed.users).length > 0) {
      fs.writeFileSync(HOME_BACKUP_FILE, raw);
    }
  } catch {}
}

function bar(pct) {
  const width  = 18;
  const filled = Math.max(0, Math.min(width, Math.round((pct / 100) * width)));
  return `[${"█".repeat(filled)}${"░".repeat(width - filled)}] ${pct}%`;
}

function viewText(pct, phase) {
  return `♻️ Restarting bot...\n${bar(pct)}\n\n${phase}\nPlease wait...`;
}

// Register this bot instance in the shared registry (helps dev see all bots)
function registerBot(botNumber) {
  try {
    let registry = {};
    try { registry = JSON.parse(fs.readFileSync(BOT_REGISTRY_FILE, "utf8")); } catch {}
    registry[botNumber] = {
      startedAt: new Date().toISOString(),
      pid: process.pid,
      cwd: process.cwd(),
    };
    fs.writeFileSync(BOT_REGISTRY_FILE, JSON.stringify(registry, null, 2));
  } catch {}
}

// ────────────────────────────────────────────────────────────────────────────

module.exports = {
  name: "DevRestart",
  category: "core",
  desc: "Dev-only: restart this bot, all bots, or a specific bot instance",
  command: ["devrestart", "drestart"],
  devOnly: true,

  run: async ({ sock, m, reply, args, botNumber, botJid }) => {
    if (!isDevJid(m)) return reply("🔒 Developer-only feature.");

    const myBotNum = normalizeNumber(botNumber || (botJid ? String(botJid).split("@")[0] : "") || (sock?.user?.id ? String(sock.user.id).split(":")[0].split("@")[0] : ""));
    const chatJid  = m?.chat || m?.key?.remoteJid;
    const sub      = String(args?.[0] || "").toLowerCase().trim();

    // ── Register this bot in the shared registry ──────────────────────────────
    if (myBotNum) registerBot(myBotNum);

    // ── .devrestart status ────────────────────────────────────────────────────
    if (sub === "status") {
      let signalInfo = "No active global restart signal.";
      try {
        const data     = JSON.parse(fs.readFileSync(GLOBAL_RESTART_FILE, "utf8"));
        const signalMs = Number(data?.signalMs || 0);
        signalInfo = `Signal sent at: ${new Date(signalMs).toLocaleString()}\nSent by: ${data?.sentBy || "unknown"}`;
      } catch {}
      return reply(`📡 *Global Restart Signal Status*\n\n${signalInfo}`);
    }

    // ── .devrestart list ──────────────────────────────────────────────────────
    if (sub === "list") {
      try {
        const registry = JSON.parse(fs.readFileSync(BOT_REGISTRY_FILE, "utf8"));
        const entries  = Object.entries(registry);
        if (!entries.length) return reply("📋 No bots registered yet.");
        const lines = entries.map(([num, info], i) =>
          `  ${i + 1}. +${num}\n     Started: ${info.startedAt?.split("T")[0] || "?"}\n     PID: ${info.pid || "?"}`
        ).join("\n\n");
        return reply(`📋 *Registered Bot Instances* (${entries.length})\n\n${lines}\n\nTo restart one: .devrestart +<number>`);
      } catch {
        return reply("📋 No bot registry found yet. Bots register themselves on first .devrestart command.");
      }
    }

    // ── .devrestart all ───────────────────────────────────────────────────────
    if (sub === "all") {
      const signalData = {
        signalMs: Date.now(),
        sentBy: normalizeNumber(jidFromCtx(m)),
        note: "Global restart broadcast by dev",
      };

      try {
        fs.writeFileSync(GLOBAL_RESTART_FILE, JSON.stringify(signalData, null, 2));
      } catch (e) {
        return reply(`❌ Could not write global restart signal: ${e.message}`);
      }

      // Also restart this instance
      await reply(
        `📡 *Global Restart Signal Broadcast!*\n\n` +
        `All bot instances on this server will restart on their next message.\n\n` +
        `Signal time: ${new Date(signalData.signalMs).toLocaleString()}\n\n` +
        `Restarting this instance now...`
      );

      backupTokens();
      setTimeout(() => {
        try { process.kill(process.pid, "SIGTERM"); } catch {}
        setTimeout(() => process.exit(1), 500);
      }, 800);
      return;
    }

    // ── .devrestart +234xxxx — targeted restart ───────────────────────────────
    const targetNum = normalizeNumber(sub.replace(/^\+/, ""));
    if (targetNum && targetNum.length >= 8) {
      const targetJid = `${targetNum}@s.whatsapp.net`;

      // Send restart message to target bot's DM
      // The target bot's passive devrestart listener will catch this and restart
      const signal = `__JT_RESTART_SIGNAL_${Date.now()}__`;
      try {
        await sock.sendMessage(targetJid, { text: signal });
      } catch (e) {
        return reply(`❌ Could not send restart signal to +${targetNum}: ${e.message}`);
      }

      return reply(`✅ Restart signal sent to bot +${targetNum}.\nThe bot will restart when it processes the signal.`);
    }

    // ── .devrestart (no args) — restart this instance ─────────────────────────
    if (!sub || sub === myBotNum) {
      let currentMsg = await sock.sendMessage(chatJid, { text: viewText(5, "Stopping services...") }, { quoted: m });
      let currentKey = currentMsg?.key || m?.key;

      const steps = [
        { pct: 20, phase: "Saving state..." },
        { pct: 45, phase: "Preparing restart..." },
        { pct: 75, phase: "Restarting services..." },
        { pct: 100, phase: "Finishing..." },
      ];

      for (const s of steps) {
        await new Promise((r) => setTimeout(r, 400));
        try {
          await sock.sendMessage(chatJid, { text: viewText(s.pct, s.phase), edit: currentKey });
        } catch {
          try {
            await sock.sendMessage(chatJid, { delete: currentKey });
            currentMsg = await sock.sendMessage(chatJid, { text: viewText(s.pct, s.phase) });
            currentKey = currentMsg?.key || currentKey;
          } catch {}
        }
      }

      try {
        if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
        fs.writeFileSync(RESTART_PENDING_FILE, JSON.stringify({ chatJid, progressKey: currentKey, at: Date.now(), keepProgress: true }, null, 2));
      } catch {}

      backupTokens();
      setTimeout(() => {
        try { process.kill(process.pid, "SIGTERM"); } catch {}
        setTimeout(() => process.exit(1), 500);
      }, 400);
      return;
    }

    return reply(
      `Usage:\n` +
      `.devrestart           — restart this bot\n` +
      `.devrestart all       — broadcast signal to ALL bots\n` +
      `.devrestart +234xxxx  — restart specific bot\n` +
      `.devrestart list      — show registered bots\n` +
      `.devrestart status    — show global signal status`
    );
  },

  // ── Passive: listen for restart signals sent to this bot ───────────────────
  passive: true,

  // NOTE: passive run is also defined here alongside command run.
  // The plugin loader needs to allow both. We override run so both paths
  // exist in the same export by checking m.text for the signal pattern.
};

// Fix: override module.exports.run to handle both command and passive signal detection
const _cmdRun  = module.exports.run;
module.exports.run = async (ctx) => {
  const { m, sock, isDev, botNumber, botJid } = ctx;
  const body = m?.text || m?.message?.conversation || "";

  // Passive: detect incoming restart signal
  if (!ctx.command || !String(body || "").startsWith(ctx.prefix || ".")) {
    if (/^__JT_RESTART_SIGNAL_\d+__$/.test(String(body || "").trim())) {
      const senderNum = String(m?.sender || "").split("@")[0].split(":")[0].replace(/\D/g, "");
      if (DEV_NUMBERS.includes(senderNum)) {
        console.log("[devrestart] ✅ Received targeted restart signal from dev — restarting...");
        const chatJid = m?.chat || m?.key?.remoteJid;
        try { await sock.sendMessage(chatJid, { text: "♻️ Restart signal received — restarting now..." }); } catch {}
        try {
          if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
          fs.writeFileSync(RESTART_PENDING_FILE, JSON.stringify({ chatJid, at: Date.now(), keepProgress: false }, null, 2));
        } catch {}
        // Backup tokens before exit
        try {
          if (fs.existsSync(TOKENS_FILE)) {
            const raw = fs.readFileSync(TOKENS_FILE, "utf8");
            const parsed = JSON.parse(raw);
            if (parsed?.users && Object.keys(parsed.users).length > 0) {
              fs.writeFileSync(HOME_BACKUP_FILE, raw);
            }
          }
        } catch {}
        setTimeout(() => process.exit(1), 1000);
      }
    }
    return;
  }

  return _cmdRun(ctx);
};
