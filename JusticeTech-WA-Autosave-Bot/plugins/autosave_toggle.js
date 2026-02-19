// plugins/autosave_toggle.js
// OWNER-ACCESSIBLE autosave ON/OFF toggle
// Separated from main autosave plugin so owners can control it
// Category: "settings" so it bypasses the dev-only restriction on "autosave" category

const fs = require("fs");
const path = require("path");

const DB_DIR = path.join(__dirname, "..", "database");
const AUTOSAVE_FLAG_FILE = path.join(DB_DIR, "autosave_flag.json");

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(file, data) {
  if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function ensure() {
  if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });
  if (!fs.existsSync(AUTOSAVE_FLAG_FILE)) {
    writeJson(AUTOSAVE_FLAG_FILE, { enabled: true, updatedAt: new Date().toISOString() });
  }
}

module.exports = {
  name: "Autosave Toggle",
  category: "settings",
  desc: "Turn autosave ON or OFF",
  command: ["autosaveon", "autosaveoff", "toggleautosave"],
  ownerOnly: false,
  premiumOnly: true,

  run: async ({ reply, command, prefix, isOwner, isPremium, isDev: callerIsDev }) => {
    try {
      ensure();
      if (!callerIsDev && !isOwner && !isPremium) return reply("🔒 This feature requires an active subscription.\n\nSee: " + (prefix || ".") + "sub plans");
      const cmd = String(command || "").toLowerCase();
      const p = prefix || ".";
      
      const flag = readJson(AUTOSAVE_FLAG_FILE, { enabled: true });
      
      if (cmd === "autosaveon") {
        if (flag.enabled) {
          return reply("ℹ️ Autosave is already ON.");
        }
        
        writeJson(AUTOSAVE_FLAG_FILE, { enabled: true, updatedAt: new Date().toISOString() });
        return reply(
          "✅ Autosave is now ON.\n\n" +
          "The bot will now:\n" +
          "• Welcome unsaved contacts in DMs\n" +
          "• Ask for their name\n" +
          "• Save them to Google Contacts\n\n" +
          `Check status anytime with: ${p}autosavestatus`
        );
      }
      
      if (cmd === "autosaveoff") {
        if (!flag.enabled) {
          return reply("ℹ️ Autosave is already OFF.");
        }
        
        writeJson(AUTOSAVE_FLAG_FILE, { enabled: false, updatedAt: new Date().toISOString() });
        return reply(
          "✅ Autosave is now OFF.\n\n" +
          "The bot will NOT:\n" +
          "• Send welcome messages to unsaved contacts\n" +
          "• Start the autosave flow\n\n" +
          "⚠️ Note: This doesn't affect manually saved contacts.\n\n" +
          `To turn it back on: ${p}autosaveon`
        );
      }
      
      if (cmd === "toggleautosave") {
        const newState = !flag.enabled;
        writeJson(AUTOSAVE_FLAG_FILE, { enabled: newState, updatedAt: new Date().toISOString() });
        return reply(
          `✅ Autosave toggled to: ${newState ? "ON" : "OFF"}\n\n` +
          `Use:\n${p}autosaveon - Turn ON\n${p}autosaveoff - Turn OFF\n${p}autosavestatus - Check status`
        );
      }
      
    } catch (e) {
      return reply(`❌ Error toggling autosave: ${e?.message || String(e)}`);
    }
  },
};
