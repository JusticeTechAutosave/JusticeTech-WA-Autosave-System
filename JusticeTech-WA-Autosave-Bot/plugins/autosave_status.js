// plugins/autosave_status.js
// Merged: public status check + dev deep-check (was in checkautosave.js)
//
//   .autosavestatus          — public: shows ON/OFF status
//   .autosavestatus check <number>  — dev: full DB + Google API check for a number

"use strict";

const fs   = require("fs");
const path = require("path");
const { searchContactByPhone } = require("../library/googleContacts");

const DB_DIR              = path.join(__dirname, "..", "database");
const AUTOSAVE_FLAG_FILE  = path.join(DB_DIR, "autosave_flag.json");
const CONTACTS_FILE       = path.join(DB_DIR, "autosaved_contacts.json");

const DEV_NUMBERS = ["2349032578690", "2348166337692"];

function normalizeNumber(input) {
  if (!input) return null;
  let s = String(input).trim();
  if (s.includes("@")) s = s.split("@")[0];
  if (s.includes(":")) s = s.split(":")[0];
  const d = s.replace(/[^0-9]/g, "");
  if (!d || d.length < 8 || d.length > 15) return null;
  return d;
}

function jidFromCtx(m) {
  return m?.sender || m?.key?.participant || m?.key?.remoteJid || "";
}

function isDevJid(m) {
  const d = normalizeNumber(jidFromCtx(m));
  return !!d && DEV_NUMBERS.includes(d);
}

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}

function ensure() {
  if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });
  if (!fs.existsSync(AUTOSAVE_FLAG_FILE)) {
    fs.writeFileSync(AUTOSAVE_FLAG_FILE, JSON.stringify({ enabled: true, updatedAt: new Date().toISOString() }, null, 2));
  }
}

module.exports = {
  name: "Autosave Status",
  category: "info",
  desc: "Check autosave status. Dev: .autosavestatus check <number> for deep inspection",
  command: ["autosavestatus", "autosavecheck"],
  passive: false,

  run: async ({ reply, args, m, botNumber, botJid, sock }) => {
    ensure();

    // ── .autosavestatus check <number> — dev deep-check ───────────────────────
    if (String(args?.[0] || "").toLowerCase() === "check") {
      if (!isDevJid(m)) return reply("🔒 Developer-only subcommand.");

      const ownerNumber = normalizeNumber(botJid || botNumber || sock?.user?.id);
      if (!ownerNumber) return reply("❌ Could not resolve owner number.");

      const numberToCheck = normalizeNumber(args?.[1]);
      if (!numberToCheck) {
        return reply(
          "Usage: .autosavestatus check <phone_number>\n\n" +
          "Example: .autosavestatus check 2348012345678\n\n" +
          "Checks both local DB and Google Contacts API."
        );
      }

      const db        = readJson(CONTACTS_FILE, { contacts: {} });
      const ownerBook = db?.contacts?.[ownerNumber] || {};
      const existing  = ownerBook[numberToCheck];

      let output = `🔍 Autosave Deep Check\n━━━━━━━━━━━━━━━━━━━━━━\n\nContact: ${numberToCheck}\nOwner: ${ownerNumber}\n\n`;
      output += `📁 Local Database:\n`;

      if (!existing) {
        output += `❌ NOT in local DB\n\n`;
      } else {
        output += `✅ Found in local DB\n`;
        const fields = [
          ["google.resourceName", existing.google?.resourceName],
          ["savedAt",             existing.savedAt],
          ["name",                existing.name],
          ["number",              existing.number],
          ["source",              existing.source],
        ];
        let localSaved = false;
        let localReason = "";
        for (const [label, val] of fields) {
          if (val) {
            if (!localSaved) { localSaved = true; localReason = label; }
            output += `  ✅ ${label}: ${val}\n`;
          } else {
            output += `  ❌ ${label}: none\n`;
          }
        }
        if (localSaved) {
          output += `\n✅ LOCAL VERDICT: SAVED (${localReason})\nDecision: Will BLOCK autosave\n\n`;
          output += `Full entry:\n${JSON.stringify(existing, null, 2)}`;
          return reply(output);
        }
        output += `\n❌ Incomplete entry — no saved indicators\n\n`;
      }

      output += `☁️ Google Contacts API:\n`;
      let googleResult = null;
      let googleError  = null;
      try {
        googleResult = await searchContactByPhone(ownerNumber, numberToCheck);
      } catch (e) {
        googleError = e?.message || "Unknown error";
      }

      if (googleError) {
        output += `⚠️ API check failed: ${googleError}\n\n`;
        output += `━━━━━━━━━━━━━━━━━━━━━━\n⚠️ FINAL VERDICT: INCONCLUSIVE`;
      } else if (googleResult) {
        output += `✅ FOUND in Google Contacts\n  Name: ${googleResult.name || "(none)"}\n  Resource: ${googleResult.resourceName}\n\n`;
        output += `━━━━━━━━━━━━━━━━━━━━━━\n✅ FINAL VERDICT: SAVED (Google)\nAction: Will BLOCK autosave`;
      } else {
        output += `❌ NOT in Google Contacts\n\n`;
        output += `━━━━━━━━━━━━━━━━━━━━━━\n❌ FINAL VERDICT: GENUINELY NOT SAVED\nAction: Will trigger autosave flow`;
      }

      return reply(output);
    }

    // ── Public status check ───────────────────────────────────────────────────
    const flag      = readJson(AUTOSAVE_FLAG_FILE, { enabled: true, updatedAt: null });
    const status    = flag.enabled ? "✅ ON" : "❌ OFF";
    const updated   = flag.updatedAt ? new Date(flag.updatedAt).toLocaleString() : "Unknown";

    return reply(
      `⚙️ *Autosave Status*\n\n` +
      `Status: ${status}\n` +
      `Last Updated: ${updated}\n\n` +
      `${flag.enabled
        ? "The bot will automatically save new contacts when they message you."
        : "⚠️ Autosave is disabled. New contacts will not be prompted."}\n\n` +
      `To change settings, contact the developer.`
    );
  },
};
