// plugins/delay.js
const fs = require("fs");
const path = require("path");

const DB_DIR = path.join(__dirname, "..", "database");
const DELAY_FILE = path.join(DB_DIR, "reply_delay.json");

function ensure() {
  if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });
  if (!fs.existsSync(DELAY_FILE)) fs.writeFileSync(DELAY_FILE, JSON.stringify({ maxSeconds: 0 }, null, 2));
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
  name: "ReplyDelay",
  category: "core",
  desc: "Set max random reply delay in seconds (0 = off)",
  command: ["delay"],
  ownerOnly: true,

  run: async ({ reply, args, prefix }) => {
    ensure();
    const p = prefix || ".";
    const v = args?.[0];

    if (!v || String(v).toLowerCase() === "show") {
      const cur = readJson(DELAY_FILE, { maxSeconds: 0 });
      return reply(`✅ Current max reply delay: *${Number(cur?.maxSeconds || 0)}s*\n\nSet:\n${p}delay 3\nOff:\n${p}delay 0`);
    }

    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) return reply("❌ Invalid number.");

    const maxSeconds = Math.min(30, Math.floor(n)); // cap 30s
    writeJson(DELAY_FILE, { maxSeconds });

    return reply(`✅ Max reply delay set to: *${maxSeconds}s*`);
  },
};