// plugins/owner.js
const fs = require("fs");
const path = require("path");

const DB_DIR = path.join(__dirname, "..", "database");
const OWNER_FILE = path.join(DB_DIR, "owner.json");

function ensure() {
  if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });
  if (!fs.existsSync(OWNER_FILE)) fs.writeFileSync(OWNER_FILE, JSON.stringify({ name: "JusticeTech" }, null, 2));
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
  name: "OwnerName",
  category: "core",
  desc: "Set owner name used in autosave replies",
  command: ["owner"],
  ownerOnly: true,

  run: async ({ reply, args, prefix }) => {
    ensure();
    const p = prefix || ".";
    const sub = String(args?.[0] || "").toLowerCase();
    const rest = args.join(" ").trim();

    if (!sub || sub === "show") {
      const cur = readJson(OWNER_FILE, { name: "JusticeTech" });
      return reply(`✅ Owner Name: *${String(cur?.name || "JusticeTech").trim()}*\n\nSet:\n${p}owner JusticeTech`);
    }

    const name = rest.trim();
    if (name.length < 2 || name.length > 50) {
      return reply("❌ Owner name must be 2 to 50 characters.");
    }

    writeJson(OWNER_FILE, { name });
    return reply(`✅ Owner name updated to: *${name}*`);
  },
};