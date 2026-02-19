// plugins/historysync.js — JusticeTech Autosave Bot v1.2.0 JT
// Enable/disable full WhatsApp history scan — needed for bulk save (owner/premium).
// Enhanced: shows live progress from scan cache, reset support, and better UX.

const fs   = require("fs");
const path = require("path");

const DB_DIR     = path.join(__dirname, "..", "database");
const FLAG_FILE  = path.join(DB_DIR, "history_sync_flag.json");
const SCAN_CACHE = path.join(DB_DIR, "scan_cache.json");

function ensure() {
  if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });
  if (!fs.existsSync(FLAG_FILE)) fs.writeFileSync(FLAG_FILE, JSON.stringify({ enabled: false }, null, 2));
}

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}

function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function fmtTime(isoStr) {
  if (!isoStr) return "—";
  try {
    const d = new Date(isoStr);
    const pad = n => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } catch { return isoStr; }
}

function getScanStatus() {
  const cache = readJson(SCAN_CACHE, null);
  if (!cache) return null;
  return {
    dmCount:       cache.dmJids?.length || 0,
    chatsCount:    cache.chatsCount || 0,
    contactsCount: cache.contactsCount || 0,
    messagesCount: cache.messagesCount || 0,
    isComplete:    !!cache.isComplete,
    updatedAt:     cache.updatedAt || null,
    completedAt:   cache.completedAt || null,
  };
}

module.exports = {
  name: "HistorySync",
  category: "autosave",
  desc: "Enable/disable full WhatsApp history scan — needed for bulk save (owner/premium)",
  command: ["historysync", "synchistory"],
  premiumOnly: true,

  run: async ({ reply, args, prefix, isOwner, isDev, isPremium }) => {
    ensure();

    if (!isDev && !isOwner && !isPremium) {
      return reply("🔒 This feature requires an active premium subscription.");
    }

    const p   = prefix || ".";
    const sub = String(args?.[0] || "").toLowerCase();

    // ── STATUS ──────────────────────────────────────────────────────────────
    if (!sub || sub === "status") {
      const f    = readJson(FLAG_FILE, { enabled: false, updatedAt: null });
      const scan = getScanStatus();

      let msg = `🧾 *History Sync*\n\n`;
      msg += `Flag:    ${f.enabled ? "✅ ON (activates on next restart)" : "❌ OFF"}\n`;
      msg += `Updated: ${fmtTime(f.updatedAt)}\n\n`;

      if (scan) {
        msg += `📊 *Last Scan Results:*\n`;
        msg += `━━━━━━━━━━━━━━━━━━\n`;
        msg += `DMs found:     ${scan.dmCount.toLocaleString()}\n`;
        msg += `Chats scanned: ${scan.chatsCount.toLocaleString()}\n`;
        msg += `Contacts:      ${scan.contactsCount.toLocaleString()}\n`;
        msg += `Messages idx:  ${scan.messagesCount.toLocaleString()}\n`;
        msg += `Status:        ${scan.isComplete ? "✅ Complete" : "⏳ In progress / partial"}\n`;
        if (scan.completedAt) msg += `Completed:     ${fmtTime(scan.completedAt)}\n`;
        else if (scan.updatedAt) msg += `Last batch:    ${fmtTime(scan.updatedAt)}\n`;
        msg += `━━━━━━━━━━━━━━━━━━\n\n`;

        if (scan.isComplete) {
          msg += `✅ Cache is ready! You can now use:\n`;
          msg += `• ${p}fetchchats — view unsaved contacts\n`;
          msg += `• ${p}bulksave — save all to Google\n\n`;
        } else if (f.enabled) {
          msg += `⏳ Sync enabled. Restart bot to begin scanning.\n\n`;
        } else {
          msg += `💡 Run ${p}historysync on → restart to rebuild cache.\n\n`;
        }
      } else {
        msg += `📊 No scan data yet.\n`;
        msg += `Run ${p}historysync on and restart the bot.\n\n`;
      }

      msg += `*Commands:*\n`;
      msg += `${p}historysync on     — enable (restart required)\n`;
      msg += `${p}historysync off    — disable\n`;
      msg += `${p}historysync reset  — clear old cache for fresh scan\n`;
      msg += `${p}historysync status — this panel`;
      return reply(msg);
    }

    // ── ON ───────────────────────────────────────────────────────────────────
    if (sub === "on") {
      writeJson(FLAG_FILE, { enabled: true, updatedAt: new Date().toISOString() });
      const scan = getScanStatus();

      let msg = `✅ *History sync ENABLED.*\n\n`;
      if (scan?.isComplete) {
        msg += `⚡ *Previous scan found:*\n`;
        msg += `• DMs cached: ${scan.dmCount.toLocaleString()}\n`;
        msg += `• Completed: ${fmtTime(scan.completedAt)}\n\n`;
        msg += `You already have scan data.\n`;
        msg += `Use ${p}bulksave or ${p}fetchchats right away.\n\n`;
        msg += `Only restart if you need a *fresh* full rescan.\n`;
        msg += `(run ${p}historysync reset first to clear old data)\n\n`;
      } else {
        msg += `🔄 *Next step: restart your bot.*\n\n`;
        msg += `During restart, WhatsApp will stream your full chat history.\n`;
        msg += `This takes 1–5 minutes depending on your chat volume.\n\n`;
        msg += `You'll receive:\n`;
        msg += `• 📥 A progress update per batch received\n`;
        msg += `• ✅ A COMPLETE notification when the scan finishes\n\n`;
      }
      msg += `📌 *After scan you can:*\n`;
      msg += `• ${p}fetchchats — view unsaved contacts\n`;
      msg += `• ${p}bulksave  — auto-save all contacts to Google\n`;
      msg += `\nHistory sync auto-disables after scan completes.`;
      return reply(msg);
    }

    // ── OFF ──────────────────────────────────────────────────────────────────
    if (sub === "off") {
      writeJson(FLAG_FILE, { enabled: false, updatedAt: new Date().toISOString() });
      return reply("✅ History sync disabled.\nFull history will NOT be requested on next restart.");
    }

    // ── RESET ────────────────────────────────────────────────────────────────
    if (sub === "reset") {
      try {
        if (fs.existsSync(SCAN_CACHE)) {
          fs.writeFileSync(SCAN_CACHE, JSON.stringify({
            dmJids: [], chatsCount: 0, contactsCount: 0, messagesCount: 0,
            isComplete: false, resetAt: new Date().toISOString(),
          }, null, 2));
        }
        // Also reset the flag to OFF so user intentionally re-enables
        writeJson(FLAG_FILE, { enabled: false, updatedAt: new Date().toISOString() });
        return reply(
          `🗑️ *Scan cache cleared.*\n\n` +
          `The old scan data has been wiped.\n\n` +
          `To run a fresh scan:\n` +
          `1. ${p}historysync on\n` +
          `2. Restart your bot`
        );
      } catch (e) {
        return reply(`❌ Reset failed: ${e.message}`);
      }
    }

    return reply(
      `*History Sync Commands:*\n` +
      `${p}historysync status  — status & scan results\n` +
      `${p}historysync on      — enable (restart required)\n` +
      `${p}historysync off     — disable\n` +
      `${p}historysync reset   — clear cache for fresh scan`
    );
  },
};

