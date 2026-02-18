// plugins/setprefix.js
"use strict";

const fs   = require("fs");
const path = require("path");

const DB_DIR     = path.join(__dirname, "..", "database");
const PREFIX_FILE = path.join(DB_DIR, "prefix.json");

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

function getCurrentPrefix() {
  try {
    return JSON.parse(fs.readFileSync(PREFIX_FILE, "utf8"))?.prefix || ".";
  } catch {
    return ".";
  }
}

module.exports = {
  name: "SetPrefix",
  category: "core",
  desc: "Change the bot command prefix",
  command: ["setprefix", "prefix"],
  ownerOnly: true,

  run: async ({ reply, args, m, isOwner, isDev }) => {
    if (!isOwner && !isDev) return reply("🔒 Owner only.");

    const current = getCurrentPrefix();

    if (!args[0]) {
      return reply(
        `⚙️ *Bot Prefix*\n\n` +
        `Current prefix: *${current}*\n\n` +
        `Change it:\n.setprefix !\n.setprefix /\n.setprefix #\n\n` +
        `Must be exactly 1 character.`
      );
    }

    const newPrefix = args[0].trim();
    if (newPrefix.length !== 1) {
      return reply("❌ Prefix must be exactly 1 character.\n\nExamples: . ! / # $ @");
    }

    // Block alphanumeric (would break command parsing)
    if (/[a-zA-Z0-9]/.test(newPrefix)) {
      return reply("❌ Prefix cannot be a letter or number.\n\nValid examples: . ! / # $ @ *");
    }

    if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });
    fs.writeFileSync(PREFIX_FILE, JSON.stringify({ prefix: newPrefix, updatedAt: new Date().toISOString() }, null, 2));

    // Bust the in-memory cache so next message picks up the new prefix
    if (typeof global.resetPrefixCache === "function") global.resetPrefixCache();

    return reply(
      `✅ Prefix updated!\n\n` +
      `Old prefix: *${current}*\n` +
      `New prefix: *${newPrefix}*\n\n` +
      `All commands now use *${newPrefix}* (e.g. ${newPrefix}menu, ${newPrefix}restart)`
    );
  },
};
