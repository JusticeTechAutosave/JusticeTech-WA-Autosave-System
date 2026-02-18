// plugins/googleaccounts.js — JusticeTech Autosave Bot v1.1.1 JT
// Manage all linked Google accounts for the bot.
// Available to owner and premium users.
//
// .googleaccounts                        — list all linked accounts
// .googleaccounts remove email@gmail.com — unlink one account

const {
  getUserAccounts,
  removeUserAccount,
  normalizeNumber,
} = require("../library/googleTenantAuth");
const { invalidateContactsCache } = require("../library/googleContacts");

function jidFromCtx(m) {
  return m?.sender || m?.key?.participant || m?.key?.remoteJid || "";
}

function fmtDate(ts) {
  if (!ts) return "unknown";
  try { return new Date(ts).toLocaleString(); } catch { return String(ts); }
}

module.exports = {
  name: "GoogleAccounts",
  category: "autosave",
  desc: "List or remove linked Google accounts (owner/premium)",
  command: ["googleaccounts", "gaccounts"],
  premiumOnly: true,

  run: async ({ reply, m, args, botNumber, botJid, sock, isOwner, isDev, isPremium }) => {
    if (!isDev && !isOwner && !isPremium) {
      return reply("🔒 This feature requires an active premium subscription.");
    }

    const botJ   = botJid || (sock?.user?.id ? String(sock.user.id) : "");
    const botNum = normalizeNumber(botNumber || (botJ ? String(botJ).split("@")[0] : ""));
    if (!botNum) return reply("❌ Could not resolve bot number.");

    const sub = String(args?.[0] || "").toLowerCase();

    // ── Remove one account ──────────────────────────────────────────────────
    if (sub === "remove" || sub === "unlink" || sub === "delete") {
      const email = String(args?.[1] || "").trim().toLowerCase();
      if (!email || !email.includes("@")) {
        return reply(`Usage: .googleaccounts remove email@gmail.com`);
      }

      const removed = removeUserAccount(botNum, email);
      if (!removed) {
        return reply(`❌ Account "${email}" not found in linked accounts.`);
      }

      try { invalidateContactsCache(botNum); } catch {}

      const remaining  = getUserAccounts(botNum);
      const list = remaining.length
        ? remaining.map((a, i) => `  ${i + 1}. ${a.email}`).join("\n")
        : "  (none — bot has no linked Google accounts)";

      return reply(
        `✅ Removed: ${email}\n\n` +
        `Remaining linked accounts (${remaining.length}):\n${list}\n\n` +
        (remaining.length === 0
          ? `⚠️ No accounts left! Run .linkgoogle to add one.`
          : `Run .fetchchats to rescan with the updated account list.`)
      );
    }

    // ── List accounts (default) ─────────────────────────────────────────────
    const accounts = getUserAccounts(botNum);

    if (!accounts.length) {
      return reply(
        `❌ No Google accounts linked to this bot.\n\n` +
        `To link your Gmail:\n` +
        `1. Run .linkgoogle [email@gmail.com]\n` +
        `2. Open the link → authorize the account\n` +
        `3. Send the code using .oauth CODE\n` +
        `4. Repeat for each Gmail account\n\n` +
        `The bot will check ALL linked accounts when scanning contacts.`
      );
    }

    let msg = `📋 *Linked Google Accounts (${accounts.length})*\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━━━\n`;
    msg += `Bot: +${botNum}\n\n`;

    accounts.forEach((a, i) => {
      msg += `${i + 1}. ${a.email}\n`;
      msg += `   Linked:        ${fmtDate(a.linkedAt)}\n`;
      msg += `   Access token:  ${a.access_token  ? "✅" : "❌ missing"}\n`;
      msg += `   Refresh token: ${a.refresh_token ? "✅" : "⚠️ missing"}\n`;
      if (i < accounts.length - 1) msg += "\n";
    });

    msg += `\n━━━━━━━━━━━━━━━━━━━━━━\n`;
    msg += `To add another Gmail:\n  .linkgoogle → authorize → .oauth CODE\n\n`;
    msg += `To remove an account:\n  .googleaccounts remove email@gmail.com\n\n`;
    msg += `All accounts are checked when you run .fetchchats.\n`;
    msg += `A number found in ANY account counts as saved.`;

    return reply(msg);
  },
};
