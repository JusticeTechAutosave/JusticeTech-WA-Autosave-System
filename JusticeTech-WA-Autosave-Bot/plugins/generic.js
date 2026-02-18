// plugins/generic.js (FIXED: use flags:"owner")
const fs = require("fs");
const path = require("path");

const DB_DIR = path.join(__dirname, "..", "database");
const GENERIC_FILE = path.join(DB_DIR, "generic.json");

function ensure() {
  if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });
  if (!fs.existsSync(GENERIC_FILE)) fs.writeFileSync(GENERIC_FILE, JSON.stringify({ name: "" }, null, 2));
}

function readGeneric() {
  ensure();
  try {
    return JSON.parse(fs.readFileSync(GENERIC_FILE, "utf8")) || { name: "" };
  } catch {
    return { name: "" };
  }
}

function writeGeneric(g) {
  ensure();
  fs.writeFileSync(GENERIC_FILE, JSON.stringify(g, null, 2));
}

module.exports = {
  name: "Generic",
  category: "autosave",
  desc: "Set generic name for bulk-saving old DM contacts",
  command: ["generic"],
  flags: "owner",

  run: async ({ reply, args, prefix }) => {
    ensure();

    const p = prefix || ".";
    const name = (args || []).join(" ").trim();

    if (!name) {
      const g = readGeneric();
      return reply(
        `🧾 Generic name\n` +
          `Current: ${g.name ? `*${g.name}*` : "(not set)"}\n\n` +
          `Usage:\n${p}generic <name>\n` +
          `Example:\n${p}generic jlfamous TV`
      );
    }

    const g = readGeneric();
    g.name = name;
    writeGeneric(g);

    return reply(`✅ Generic name set to: *${name}*`);
  },
};