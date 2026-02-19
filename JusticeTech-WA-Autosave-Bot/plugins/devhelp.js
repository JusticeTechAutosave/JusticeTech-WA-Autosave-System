// plugins/devhelp.js — JusticeTech Autosave Bot
// ─────────────────────────────────────────────────────────────────────────────
// Dev-only: lists all developer commands grouped by category, with bot thumbnail.
// ─────────────────────────────────────────────────────────────────────────────

"use strict";

const fs   = require("fs");
const path = require("path");

const THUMB_PATH = path.join(__dirname, "..", "thumbnail", "image.jpg");

function getThumb() {
  try { return fs.existsSync(THUMB_PATH) ? fs.readFileSync(THUMB_PATH) : null; } catch { return null; }
}

module.exports = {
  name: "DevHelp",
  category: "system",
  desc: "Dev-only: list all developer commands grouped by category",
  command: ["dev"],
  devOnly: true,
  hidden: false,

  run: async ({ reply, args, sock, m, isDev: callerIsDev, prefix }) => {
    if (!callerIsDev) {
      return reply("🔒 This command is for developers only.");
    }

    const pfx = prefix || ".";
    const sub = String(args?.[0] || "").toLowerCase().trim();

    if (sub && sub !== "help") {
      return reply(`❓ Unknown sub-command.\n\nUsage: ${pfx}dev help`);
    }

    const helpText = [
      `╔══════════════════════════╗`,
      `║  🛠 *JusticeTech Dev Panel*  ║`,
      `╚══════════════════════════╝`,
      ``,
      `┏▣ ◈ *SUBSCRIPTION* ◈`,
      `│➽ ${pfx}approvepay <ref>              — Approve a payment`,
      `│➽ ${pfx}rejectpay <ref> [reason]      — Reject a payment`,
      `│➽ ${pfx}givesub <num> <plan>          — Grant sub directly`,
      `│➽ ${pfx}trial <Nh> [num]              — Grant trial (e.g. 2h, 24h)`,
      `│➽ ${pfx}sub list                      — List all subscribers`,
      `│➽ ${pfx}sub info <num>                — Full sub info for a number`,
      `│➽ ${pfx}sub extend <num> <days>       — Extend subscription`,
      `│➽ ${pfx}sub revoke <num> [reason]     — Revoke subscription`,
      `│➽ ${pfx}subresend <num>               — Re-send activation after redeploy`,
      `│➽ ${pfx}unrevoke <num> [plan]         — Reinstate revoked sub`,
      `│➽ ${pfx}editplan [key field val]      — Edit plan price/days/label`,
      `┗▣`,
      ``,
      `┏▣ ◈ *MAINTENANCE* ◈`,
      `│➽ ${pfx}maintenance status`,
      `│   → Check current maintenance state`,
      `│➽ ${pfx}maintenance on <msg> [--start <time>] [--end <time>]`,
      `│   → Enable maintenance + broadcast to all premium users`,
      `│➽ ${pfx}maintenance off`,
      `│   → Disable maintenance + notify all users bot is back`,
      `│➽ ${pfx}maintenance broadcast <msg>`,
      `│   → Send one-time message to all premium users`,
      `┗▣`,
      ``,
      `┏▣ ◈ *RESTART & RELOAD* ◈`,
      `│➽ ${pfx}devrestart                    — Restart this bot instance`,
      `│➽ ${pfx}devrestart all                — Broadcast restart to ALL bots on server`,
      `│➽ ${pfx}devrestart +<number>          — Restart a specific owner's bot`,
      `│➽ ${pfx}devrestart list               — List all registered bot instances`,
      `│➽ ${pfx}devrestart status             — Check global restart signal status`,
      `│➽ ${pfx}drestart                      — Alias for devrestart`,
      `│➽ ${pfx}restart                       — Owner-facing restart (premium/owner)`,
      `│➽ ${pfx}reboot                        — Alias for restart`,
      `│➽ ${pfx}rplugins                      — Hot-reload all plugins (no restart)`,
      `│➽ ${pfx}rplug                         — Alias for rplugins`,
      `│➽ ${pfx}update                        — Pull latest update from GitHub + restart`,
      `┗▣`,
      ``,
      `┏▣ ◈ *BACKUP & SESSION* ◈`,
      `│➽ ${pfx}devbackup                     — Trigger manual dev backup`,
      `│➽ ${pfx}devbackup +<number>           — Send backup cmd to specific bot`,
      `│➽ ${pfx}dbackup                       — Alias for devbackup`,
      `│➽ ${pfx}sessionbackup                 — Backup WhatsApp session files`,
      `│➽ ${pfx}sessionrestore                — Restore session from backup`,
      `│➽ ${pfx}sessioninfo                   — Show session backup status`,
      `┗▣`,
      ``,
      `┏▣ ◈ *USER MANAGEMENT* ◈`,
      `│➽ ${pfx}ban <num> [reason]            — Ban a user`,
      `│➽ ${pfx}unban <num>                   — Unban a user`,
      `│➽ ${pfx}broadcast <msg>               — Broadcast to all users`,
      `│➽ ${pfx}owners                        — List all bot owners`,
      `│➽ ${pfx}testuser <num>                — Simulate user context`,
      `┗▣`,
      ``,
      `┏▣ ◈ *GOOGLE / AUTOSAVE* ◈`,
      `│➽ ${pfx}googleaccounts                — List linked Google accounts`,
      `│➽ ${pfx}googleinfo                    — Show Google OAuth info`,
      `│➽ ${pfx}googleconsole                 — Dev console for Google`,
      `│➽ ${pfx}autosave_status               — Check autosave status`,
      `│➽ ${pfx}fetchchats                    — Fetch & index chats`,
      `│➽ ${pfx}historysync                   — Trigger history sync`,
      `┗▣`,
      ``,
      `┏▣ ◈ *MISC* ◈`,
      `│➽ ${pfx}mode public/private           — Toggle bot mode`,
      `│➽ ${pfx}setprefix <char>              — Change command prefix`,
      `│➽ ${pfx}delay <seconds>               — Set reply delay`,
      `│➽ ${pfx}ping                          — Check bot latency`,
      `│➽ ${pfx}runtime                       — Runtime/memory stats`,
      `│➽ ${pfx}features                      — Toggle bot features`,
      `│➽ ${pfx}dev help                      — Show this panel`,
      `┗▣`,
      ``,
      `🔴 *All commands above are developer-only.*`,
    ].join("\n");

    const thumb = getThumb();
    if (thumb) {
      return sock.sendMessage(m.chat, { image: thumb, caption: helpText }, { quoted: m });
    }
    return sock.sendMessage(m.chat, { text: helpText }, { quoted: m });
  },
};
