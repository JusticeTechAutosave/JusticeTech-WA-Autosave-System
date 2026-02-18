const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");
const CONTACTS_FILE = path.join(DATA_DIR, "contacts.json");

function ensure() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(CONTACTS_FILE)) {
    fs.writeFileSync(CONTACTS_FILE, JSON.stringify({ contacts: {} }, null, 2));
  }
}

function read() {
  ensure();
  try {
    return JSON.parse(fs.readFileSync(CONTACTS_FILE, "utf8"));
  } catch {
    return { contacts: {} };
  }
}

function write(d) {
  ensure();
  fs.writeFileSync(CONTACTS_FILE, JSON.stringify(d, null, 2));
}

function normalizeNumber(input) {
  var n = String(input || "").replace(/[^0-9]/g, "");

  if (n.length === 11 && n[0] === "0") n = "234" + n.slice(1);
  if (n.indexOf("2340") === 0) n = "234" + n.slice(4);

  return n;
}

module.exports = {
  name: "Delete Contact",
  command: ["delcontact", "rmcontact", "deletecontact"],
  category: "autosave",
  desc: "Delete a saved contact by number (owner/premium)",
  premiumOnly: true,

  run: async function ({ reply, args, isOwner, isDev, isPremium }) {
    if (!isDev && !isOwner && !isPremium) {
      return reply("🔒 This feature requires an active premium subscription.");
    }

    if (!args[0]) return reply("Usage: .delcontact +234xxxxxxxxxx\nExample: .delcontact 09012345678");

    const num = normalizeNumber(args[0]);
    if (!num) return reply("❌ Invalid number.");

    const db = read();
    if (!db.contacts) db.contacts = {};

    const found = db.contacts[num];
    if (!found) return reply(`❌ Not found: +${num}`);

    delete db.contacts[num];
    write(db);

    return reply(`✅ Deleted contact\nName: ${found.name || "N/A"}\nNumber: +${num}`);
  },
};