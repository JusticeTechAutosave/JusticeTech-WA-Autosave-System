// plugins/addtag.js
const fs = require("fs");
const path = require("path");

const DB_DIR = path.join(__dirname, "..", "database");
const TAGS_FILE = path.join(DB_DIR, "tags.json");

function ensure() {
  if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });
  if (!fs.existsSync(TAGS_FILE)) fs.writeFileSync(TAGS_FILE, JSON.stringify({ new: "", old: "" }, null, 2));
}

function readTags() {
  ensure();
  try {
    const t = JSON.parse(fs.readFileSync(TAGS_FILE, "utf8"));
    return t && typeof t === "object" ? { new: String(t.new || ""), old: String(t.old || "") } : { new: "", old: "" };
  } catch {
    return { new: "", old: "" };
  }
}

function writeTags(t) {
  ensure();
  fs.writeFileSync(TAGS_FILE, JSON.stringify({ new: String(t.new || ""), old: String(t.old || "") }, null, 2));
}

function tagsText(prefix, t) {
  const p = prefix || ".";
  return (
    `🏷️ Tags\n\n` +
    `NEW: ${t.new ? t.new : "(none)"}\n` +
    `OLD: ${t.old ? t.old : "(none)"}\n\n` +
    `Usage:\n` +
    `${p}addtag new FB\n` +
    `${p}addtag old 🇳🇬\n` +
    `${p}addtag new (to clear)\n` +
    `${p}addtag old (to clear)\n` +
    `${p}tags`
  );
}

module.exports = {
  name: "AddTag",
  category: "autosave",
  desc: "Set autosave tag for NEW or OLD saves",
  command: ["addtag", "tags"],
  premiumOnly: true,

  run: async ({ m, args, prefix, command, reply, isOwner, isPremium, isDev: callerIsDev }) => {
    try {
      ensure();
      if (!callerIsDev && !isOwner && !isPremium) return reply("🔒 This feature requires an active subscription.\n\nSee: " + (prefix || ".") + "sub plans");
      const p = prefix || ".";
      const cmd = String(command || "").toLowerCase();

      // .tags
      if (cmd === "tags") {
        const t = readTags();
        return reply(tagsText(p, t));
      }

      // .addtag
      const scope = String(args?.[0] || "").toLowerCase();
      if (!["new", "old"].includes(scope)) {
        const t = readTags();
        return reply(`Usage:\n${p}addtag new <tag>\n${p}addtag old <tag>\n\n` + tagsText(p, t));
      }

      // allow emojis, flags, spaces
      const tag = (args || []).slice(1).join(" ").trim(); // empty = clear
      const t = readTags();
      t[scope] = tag;
      writeTags(t);

      return reply(`✅ Tag updated\n${scope.toUpperCase()} tag: ${tag ? tag : "(cleared)"}`);
    } catch (e) {
      return reply(`❌ addtag error: ${e?.message || String(e)}`);
    }
  },
};