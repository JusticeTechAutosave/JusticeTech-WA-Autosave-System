// plugins/mode.js (FIXED: applies immediately + persists)
const fs = require("fs");
const path = require("path");

const CFG_PATH = path.join(__dirname, "..", "settings", "config.js");

function setPublicInConfigJs(content, isPublic) {
  // Replace inside status block: public: true/false
  const re = /(status\s*:\s*{[\s\S]*?public\s*:\s*)(true|false)/m;
  if (re.test(content)) return content.replace(re, `$1${isPublic ? "true" : "false"}`);

  // If missing, insert into status block
  const reStatusOpen = /(status\s*:\s*{)/m;
  if (reStatusOpen.test(content)) {
    return content.replace(reStatusOpen, `$1\n        public: ${isPublic ? "true" : "false"},`);
  }

  throw new Error("Could not find status block to update public mode.");
}

module.exports = {
  name: "Mode",
  category: "core",
  desc: "Set bot mode to public or private (applies immediately)",
  command: ["mode"],
  ownerOnly: true,

  run: async ({ reply, args, prefix, sock }) => {
    const p = prefix || ".";
    const choice = String(args?.[0] || "").toLowerCase();

    if (!choice || !["public", "private"].includes(choice)) {
      return reply(`Usage:\n${p}mode public\n${p}mode private`);
    }

    const wantPublic = choice === "public";

    // ✅ APPLY IMMEDIATELY (this is the missing part)
    sock.public = wantPublic;

    // ✅ Persist to config.js
    try {
      if (!fs.existsSync(CFG_PATH)) {
        return reply(`✅ Mode set to ${wantPublic ? "PUBLIC" : "PRIVATE"} (runtime)\n⚠️ Could not find settings/config.js to persist.`);
      }

      const raw = fs.readFileSync(CFG_PATH, "utf8");
      const updated = setPublicInConfigJs(raw, wantPublic);
      fs.writeFileSync(CFG_PATH, updated);

      return reply(`✅ Mode set to ${wantPublic ? "PUBLIC" : "PRIVATE"} (applied now).`);
    } catch (e) {
      return reply(`✅ Mode set to ${wantPublic ? "PUBLIC" : "PRIVATE"} (applied now).\n⚠️ Persist failed:\n${e?.message || String(e)}`);
    }
  },
};