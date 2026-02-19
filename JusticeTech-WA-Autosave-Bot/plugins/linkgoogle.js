// plugins/linkgoogle.js — JusticeTech Autosave Bot v1.1.1 JT
// ─────────────────────────────────────────────────────────────────────────────
// Sends a Google OAuth link so a user can authorize the bot to access contacts.
//
// DEV usage:   .linkgoogle 234xxxxxxxxxx user@gmail.com
//              (sends link to any target number)
//
// Owner/Premium: .linkgoogle [email@gmail.com]
//              (sends link to themselves, email is optional)
//
// Uses makeAuthUrl() from googleTenantAuth.js — scopes always correct:
//   contacts  +  contacts.other.readonly
// ─────────────────────────────────────────────────────────────────────────────

const fs   = require("fs");
const path = require("path");

const { makeAuthUrl, normalizeNumber: normNum, OAUTH_CFG } = require("../library/googleTenantAuth");
const { invalidateContactsCache: invalidateGoogleCache } = require("../library/googleContacts");

const DEV_NUMBERS = ["2349032578690", "2348166337692"];

const DATA_DIR   = path.join(__dirname, "..", "data");
const USERS_FILE = path.join(DATA_DIR, "autosave_users.json");

function ensureData() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, JSON.stringify({ users: {} }, null, 2));
}

function readJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}

function writeJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || "").trim());
}

function toWaJid(digits) {
  const d = normNum(digits);
  if (!d) return "";
  return `${d}@s.whatsapp.net`;
}

function jidFromCtx(m) {
  return m?.sender || m?.key?.participant || m?.key?.remoteJid || "";
}

function isDevJid(m) {
  const d = normNum(jidFromCtx(m));
  return !!d && DEV_NUMBERS.includes(d);
}

module.exports = {
  name: "LinkGoogle",
  category: "autosave",
  desc: "Send Google auth link to authorize contacts access (owner/premium)",
  command: ["linkgoogle"],
  premiumOnly: true,

  run: async ({ reply, args, sock, prefix, m, isOwner, isDev, isPremium, botNumber, botJid }) => {
    ensureData();

    if (!isDev && !isOwner && !isPremium) {
      return reply("🔒 This feature requires an active premium subscription.");
    }

    const p = prefix || ".";
    const senderJid = jidFromCtx(m);
    const senderNum = normNum(senderJid);

    let targetDigits, email;

    if (isDev) {
      // Dev mode: can target any number
      const numRaw = args?.[0];
      if (!numRaw) {
        return reply(
          `*Dev usage:*\n${p}linkgoogle 234xxxxxxxxxx user@gmail.com\n\n` +
          `*Owner/Premium usage:*\n${p}linkgoogle [email@gmail.com]\n` +
          `(sends link to yourself)`
        );
      }
      // If first arg looks like an email, dev is sending to themselves too
      if (isValidEmail(numRaw)) {
        targetDigits = senderNum;
        email = numRaw;
      } else {
        targetDigits = normNum(numRaw);
        email = args?.[1] || null;
      }
    } else {
      // Owner/Premium: send link to themselves
      targetDigits = senderNum;
      // First arg may be optional email
      email = args?.[0] && isValidEmail(args[0]) ? args[0] : null;
    }

    if (!targetDigits) return reply("❌ Could not resolve your number. Please try again.");
    if (email && !isValidEmail(email)) return reply("❌ Invalid email format.");

    // Store target email
    const db = readJSON(USERS_FILE, { users: {} });
    if (!db.users) db.users = {};
    db.users[targetDigits] = {
      ...(db.users[targetDigits] || {}),
      email: email || db.users[targetDigits]?.email || null,
      lastLinkSentAt: Date.now(),
    };
    writeJSON(USERS_FILE, db);

    let url;
    try {
      url = makeAuthUrl(targetDigits);
    } catch (e) {
      return reply(`❌ Cannot build auth URL: ${e?.message || String(e)}\n\nMake sure data/google_oauth.json has client_id, client_secret, redirect_uri.`);
    }

    // Invalidate cached contacts so next fetch uses fresh token
    try { invalidateGoogleCache(targetDigits); } catch {}

    const targetJid = toWaJid(targetDigits);

    // Read redirect_uri for display
    let redirectUri = "(see data/google_oauth.json)";
    try {
      const cfg = JSON.parse(fs.readFileSync(OAUTH_CFG, "utf8"));
      redirectUri = cfg.redirect_uri || redirectUri;
    } catch {}

    const msgText =
      `🔐 *Google Autosave Setup*\n\n` +
      `1) Open this link:\n${url}\n\n` +
      `2) Choose your Google account${email ? ` (${email})` : ""}\n` +
      `3) Allow ALL permissions (contacts + other contacts)\n` +
      `4) Copy the CODE from the page\n` +
      `5) Send it back using:\n${p}oauth CODE\n\n` +
      `Redirect URI expected:\n${redirectUri}\n\n` +
      `⚠️ The CODE expires quickly — use it immediately.\n`;

    // If sending to self (owner/premium), reply directly. Otherwise DM the target.
    if (targetDigits === senderNum) {
      return reply(msgText);
    }

    try {
      await sock.sendMessage(targetJid, { text: msgText });
      return reply(`✅ Sent Google auth link to +${targetDigits}${email ? ` (${email})` : ""}`);
    } catch (e) {
      return reply(
        `✅ Link generated but could not DM +${targetDigits}.\nError: ${e?.message || String(e)}\n\nLink:\n${url}`
      );
    }
  },
};
