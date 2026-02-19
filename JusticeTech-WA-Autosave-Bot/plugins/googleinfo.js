// plugins/googleinfo.js — JusticeTech Autosave Bot v1.1.1 JT
// Google link status — available to owner and premium users.
// Commands: .googleinfo | .ginfo

const { getUserAccounts, normalizeNumber } = require("../library/googleTenantAuth");
const { isGoogleLinked } = require("../library/googleContacts");

function jidFromCtx(m) {
  return m?.sender || m?.key?.participant || m?.key?.remoteJid || "";
}

function fmtDate(ts) {
  if (!ts) return "unknown";
  try { return new Date(ts).toLocaleString(); } catch { return String(ts); }
}

module.exports = {
  name: "GoogleInfo",
  category: "autosave",
  desc: "Shows Google link status for this bot (owner/premium)",
  command: ["googleinfo", "ginfo"],
  premiumOnly: true,

  run: async ({ reply, m, botNumber, botJid, sock, isOwner, isDev, isPremium }) => {
    if (!isDev && !isOwner && !isPremium) {
      return reply("🔒 This feature requires an active premium subscription.");
    }

    const botJ = botJid || (sock?.user?.id ? String(sock.user.id) : "");
    const botNum = normalizeNumber(botNumber || (botJ ? String(botJ).split("@")[0] : ""));
    if (!botNum) return reply("❌ Could not resolve bot number.");

    const accounts = getUserAccounts(botNum);
    const linked = accounts.length > 0;

    let out = `📌 *Google Autosave Status*\n\n`;
    out += `• Bot number: +${botNum}\n`;
    out += `• Google Linked: ${linked ? `✅ Yes (${accounts.length} account${accounts.length > 1 ? "s" : ""})` : "❌ No"}\n\n`;

    if (linked) {
      out += `📋 *Linked Accounts:*\n`;
      accounts.forEach((a, i) => {
        out += `${i + 1}. ${a.email}\n`;
        out += `   Access token:  ${a.access_token  ? "✅ Present" : "❌ Missing"}\n`;
        out += `   Refresh token: ${a.refresh_token ? "✅ Present" : "⚠️ Missing"}\n`;
        out += `   Linked: ${fmtDate(a.linkedAt || a.savedAt)}\n`;
        if (i < accounts.length - 1) out += "\n";
      });

      const anyMissingRefresh = accounts.some(a => !a.refresh_token);
      if (anyMissingRefresh) {
        out += `\n⚠️ One or more accounts missing refresh token.\n`;
        out += `Autosave may stop after token expiry.\n`;
        out += `Run .linkgoogle again to re-authorize if needed.\n`;
      }
    } else {
      out += `❌ No Google accounts linked.\n\n`;
      out += `To link your Gmail:\n`;
      out += `1. Ask your dev to run .linkgoogle\n`;
      out += `2. Open the link → authorize your account\n`;
      out += `3. Send the code using .oauth CODE\n`;
    }

    return reply(out);
  },
};
