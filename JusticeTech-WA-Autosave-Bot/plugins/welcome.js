// plugins/welcome.js — JusticeTech Autosave Bot (DM-only)
"use strict";

const fs   = require("fs");
const path = require("path");

const DB_DIR      = path.join(__dirname, "..", "database");
const WELCOME_FILE = path.join(DB_DIR, "welcome.json");

function ensure() {
  if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });
  if (!fs.existsSync(WELCOME_FILE)) fs.writeFileSync(WELCOME_FILE, JSON.stringify({ dmText: "" }, null, 2));
}

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}

function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

module.exports = {
  name: "Welcome",
  category: "autosave",
  desc: "Set the DM welcome message sent to new users on autosave",
  command: ["welcome"],
  ownerOnly: true,

  run: async ({ reply, args, prefix }) => {
    ensure();
    const p    = prefix || ".";
    const mode = String(args?.[0] || "").toLowerCase();
    const text = args.slice(1).join(" ").trim();
    const db   = readJson(WELCOME_FILE, { dmText: "" });

    // backward-compat: migrate old `text` field
    if (typeof db?.text === "string" && !db.dmText) db.dmText = db.text;

    if (!mode || mode === "help") {
      return reply(
        `*Welcome Message — DM only*\n\n` +
        `${p}welcome show        — View current message\n` +
        `${p}welcome set <msg>   — Set DM welcome message\n` +
        `${p}welcome off         — Clear welcome message`
      );
    }

    if (mode === "show") {
      const dm = String(db.dmText || "").trim() || "(not set — using default)";
      return reply(`✅ *DM Welcome Message:*\n\n${dm}`);
    }

    if (mode === "off") {
      db.dmText = "";
      writeJson(WELCOME_FILE, db);
      return reply("✅ Welcome message cleared.");
    }

    if (mode === "set" || mode === "dm") {
      if (!text || text.length < 3) return reply("❌ Please provide a message after the command.");
      db.dmText = text;
      writeJson(WELCOME_FILE, db);
      return reply(`✅ DM welcome message updated:\n\n${text}`);
    }

    return reply(`Usage:\n${p}welcome show\n${p}welcome set <message>\n${p}welcome off`);
  },
};
