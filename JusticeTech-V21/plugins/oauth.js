// plugins/oauth.js — JusticeTech Autosave Bot v1.1.1 JT
// Completes Google OAuth. Supports multiple accounts — each .oauth call ADDS
// a new account rather than replacing the existing one.
// Available to owner and premium users.

const {
  exchangeCodeForTokens,
  saveUserAccount,
  getUserAccounts,
  fetchGoogleEmail,
  normalizeNumber,
} = require("../library/googleTenantAuth");
const { invalidateContactsCache } = require("../library/googleContacts");

function jidFromCtx(m) {
  return m?.sender || m?.key?.participant || m?.key?.remoteJid || "";
}

module.exports = {
  name: "OAuth",
  category: "autosave",
  desc: "Complete Google OAuth by submitting the authorization code (owner/premium)",
  command: ["oauth"],
  premiumOnly: true,

  run: async ({ reply, m, args, botNumber, botJid, sock, isOwner, isDev, isPremium }) => {
    if (!isDev && !isOwner && !isPremium) {
      return reply("🔒 This feature requires an active premium subscription.");
    }

    const botJ   = botJid || (sock?.user?.id ? String(sock.user.id) : "");
    const botNum = normalizeNumber(botNumber || (botJ ? String(botJ).split("@")[0] : ""));
    if (!botNum) return reply("❌ Could not resolve bot number.");

    const code = (args || []).join(" ").trim();
    if (!code) return reply(`Usage: .oauth CODE\n\nPaste the code you got from the Google auth link.`);

    await reply("⏳ Exchanging code for tokens...");

    let tokens;
    try {
      tokens = await exchangeCodeForTokens(code);
    } catch (e) {
      const errText = e?.response?.data ? JSON.stringify(e.response.data) : (e?.message || String(e));
      return reply(`❌ OAuth failed:\n${errText}\n\nMake sure you used the code immediately — it expires fast.`);
    }

    await reply("🔍 Detecting which Google account was just linked...");
    let email = null;
    try { email = await fetchGoogleEmail(tokens.access_token); } catch {}
    email = email || "unknown@gmail.com";

    // Save as a NEW account (does not remove existing accounts)
    saveUserAccount(botNum, tokens, email);

    // Invalidate contacts cache so next .fetchchats uses fresh merged data
    try { invalidateContactsCache(botNum); } catch {}

    const allAccounts = getUserAccounts(botNum);
    const accountList = allAccounts.map((a, i) =>
      `  ${i + 1}. ${a.email}${a.access_token ? " ✅" : " ⚠️ no token"}`
    ).join("\n");

    return reply(
      `✅ *Google account linked successfully!*\n\n` +
      `📧 Account added: ${email}\n` +
      `🔑 Access token:  ${tokens.access_token  ? "✅ Saved" : "❌ Missing"}\n` +
      `🔄 Refresh token: ${tokens.refresh_token ? "✅ Saved" : "⚠️ Missing (re-link if needed)"}\n\n` +
      `📋 *All linked accounts (${allAccounts.length}):*\n${accountList}\n\n` +
      `To add another Gmail: run .linkgoogle and authorize a different account.\n` +
      `To see all accounts: .googleaccounts\n` +
      `To remove an account: .googleaccounts remove email@gmail.com`
    );
  },
};
