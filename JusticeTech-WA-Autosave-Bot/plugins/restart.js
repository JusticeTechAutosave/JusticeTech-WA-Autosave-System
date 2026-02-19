// plugins/restart.js
// Professional restart UX:
// - Sends ONE loading message
// - Edits the same message to update %
// - On boot, message.js deletes the loading message + sends "✅ Restart complete."
// - Auto-backs up Google tokens before exit so they survive updates

const fs = require("fs");
const path = require("path");
const os = require("os");

const DATA_DIR = path.join(__dirname, "..", "data");
const RESTART_PENDING_FILE = path.join(DATA_DIR, "restart_pending.json");
const TOKENS_FILE = path.join(DATA_DIR, "google_tokens.json");
const HOME_BACKUP_FILE = path.join(os.homedir(), "JusticeTech_Autosave_Backup.json");

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Silently back up Google tokens to home dir before exiting
function backupGoogleTokens() {
  try {
    if (!fs.existsSync(TOKENS_FILE)) return;
    const raw = fs.readFileSync(TOKENS_FILE, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed?.users && Object.keys(parsed.users).length > 0) {
      fs.writeFileSync(HOME_BACKUP_FILE, raw);
      console.log("[restart] ✅ Google tokens backed up to", HOME_BACKUP_FILE);
    }
  } catch (e) {
    console.warn("[restart] Could not backup Google tokens:", e.message);
  }
}

function bar(pct) {
  const width = 18;
  const filled = Math.max(0, Math.min(width, Math.round((pct / 100) * width)));
  const empty = width - filled;
  return `[${"█".repeat(filled)}${"░".repeat(empty)}] ${pct}%`;
}

function viewText(pct, phase) {
  return (
    `♻️ Restarting bot...\n` +
    `${bar(pct)}\n\n` +
    `${phase}\n` +
    `Please wait...`
  );
}

// Baileys message edit helper (works on newer Baileys)
async function editMessage(sock, jid, key, text) {
  // Most recent Baileys versions support this:
  // sock.sendMessage(jid, { text, edit: key })
  return sock.sendMessage(jid, { text, edit: key });
}

module.exports = {
  name: "Restart",
  category: "core",
  desc: "Restart your bot (owners and premium users)",
  command: ["restart", "reboot"],

  run: async ({ sock, m, reply, isOwner, isDev, isPremium }) => {
    if (!isOwner && !isDev && !isPremium) {
      return reply("🔒 This command requires an active premium subscription or owner access.");
    }
    try {
      ensureDataDir();

      const chatJid = m?.chat || m?.key?.remoteJid;
      if (!chatJid) return reply("❌ Cannot detect chat.");

      // 1) Send ONE initial message
      let currentMsg = await sock.sendMessage(chatJid, { text: viewText(5, "Stopping services...") }, { quoted: m });
      let currentKey = currentMsg?.key || m?.key;

      if (!currentKey?.id) {
        // fallback: at least restart, but we won't have clean deletion
        await reply("♻️ Restarting bot now...");
        backupGoogleTokens();
        setTimeout(() => process.exit(1), 800);
        return;
      }

      // 2) Update progress by editing the same message (keeps history visible)
      const steps = [
        { pct: 15, phase: "Saving state..." },
        { pct: 30, phase: "Closing connections..." },
        { pct: 45, phase: "Preparing restart..." },
        { pct: 60, phase: "Restarting services..." },
        { pct: 80, phase: "Booting..." },
        { pct: 100, phase: "Finishing..." },
      ];

      for (const s of steps) {
        await new Promise((r) => setTimeout(r, 450));
        try {
          // Edit the existing message instead of deleting and re-sending
          await sock.sendMessage(chatJid, { text: viewText(s.pct, s.phase), edit: currentKey });
        } catch (editErr) {
          // Fallback: if edit fails, try delete and re-send (old behavior)
          try {
            await sock.sendMessage(chatJid, { delete: currentKey });
            currentMsg = await sock.sendMessage(chatJid, { text: viewText(s.pct, s.phase) });
            currentKey = currentMsg?.key || currentKey;
          } catch {
            // If both methods fail, continue anyway
          }
        }
      }

      // 3) Write pending file so message.js can send completion message after reboot
      // Note: We keep the progress message visible and just add a completion message
      try {
        fs.writeFileSync(
          RESTART_PENDING_FILE,
          JSON.stringify(
            {
              chatJid,
              progressKey: currentKey,
              at: Date.now(),
              keepProgress: true, // Don't delete the progress message
            },
            null,
            2
          )
        );
      } catch {}

      // 4) Back up Google tokens + exit so panel/pm2 restarts
      backupGoogleTokens();
      setTimeout(() => {
        try {
          process.kill(process.pid, "SIGTERM");
        } catch {}
        setTimeout(() => process.exit(1), 500);
      }, 400);
    } catch {
      backupGoogleTokens();
      setTimeout(() => process.exit(1), 500);
    }
  },
};