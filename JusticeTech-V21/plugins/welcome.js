// plugins/welcome.js (DM autosave welcome + Group welcome)
const fs = require("fs");
const path = require("path");

const DB_DIR = path.join(__dirname, "..", "database");
const WELCOME_FILE = path.join(DB_DIR, "welcome.json");

function ensure() {
  if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });
  if (!fs.existsSync(WELCOME_FILE)) fs.writeFileSync(WELCOME_FILE, JSON.stringify({ dmText: "", groupText: "" }, null, 2));
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

module.exports = {
  name: "Welcome",
  category: "autosave",
  desc: "Set welcome message for autosave DM and group chats",
  command: ["welcome"],
  ownerOnly: true,

  run: async ({ reply, args, prefix }) => {
    ensure();
    const p = prefix || ".";

    const mode = String(args?.[0] || "").toLowerCase(); // dm | group | show | off
    const text = args.slice(1).join(" ").trim();

    const db = readJson(WELCOME_FILE, { dmText: "", groupText: "" });

    // backward compatible migration
    if (typeof db?.text === "string" && !db.dmText) db.dmText = db.text;

    if (!mode || mode === "help") {
      return reply(
        `Usage:\n` +
        `${p}welcome show\n` +
        `${p}welcome dm your message here\n` +
        `${p}welcome group your message here\n` +
        `${p}welcome off dm\n` +
        `${p}welcome off group`
      );
    }

    if (mode === "show") {
      const dm = String(db.dmText || "").trim() || "(default)";
      const group = String(db.groupText || "").trim() || "(empty)";
      return reply(`✅ Welcome Messages\n\nDM (Autosave):\n${dm}\n\nGroup:\n${group}`);
    }

    if (mode === "off") {
      const which = String(args?.[1] || "").toLowerCase();
      if (!["dm", "group"].includes(which)) {
        return reply(`Usage:\n${p}welcome off dm\n${p}welcome off group`);
      }
      if (which === "dm") db.dmText = "";
      if (which === "group") db.groupText = "";
      writeJson(WELCOME_FILE, db);
      return reply(`✅ Welcome ${which.toUpperCase()} cleared.`);
    }

    if (!["dm", "group"].includes(mode)) {
      return reply(`Usage:\n${p}welcome dm ...\n${p}welcome group ...\n${p}welcome show`);
    }

    if (!text || text.length < 5) {
      return reply("❌ Please provide a longer message.");
    }

    if (mode === "dm") db.dmText = text;
    if (mode === "group") db.groupText = text;

    writeJson(WELCOME_FILE, db);
    return reply(`✅ Welcome ${mode.toUpperCase()} updated.`);
  },
};