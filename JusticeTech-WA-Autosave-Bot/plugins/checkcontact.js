// plugins/checkcontact.js
// DEV command: check exactly why a specific number shows as saved or unsaved.
// Usage: .checkcontact +2348XXXXXXXXX
//
// Shows:
//  1. Whether the number is in the bot's local DB
//  2. Whether it's in Google Contacts (and under which bucket)
//  3. Whether it's in the phone address book (store.contacts.name)
//  4. What the profile/push name is

const fs = require("fs");
const path = require("path");
const {
  buildContactsMapForOwner,
  coreDigits,
  isGoogleLinked,
} = require("../library/googleContacts");

const DB_DIR = path.join(__dirname, "..", "database");
const CONTACTS_FILE = path.join(DB_DIR, "autosaved_contacts.json");

const DEV_NUMBERS = ["2349032578690", "2348166337692"];

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}

function jidToPhoneDigits(jidOrPn) {
  let s = String(jidOrPn || "").trim();
  if (s.includes("@")) s = s.split("@")[0];
  if (s.includes(":")) s = s.split(":")[0];
  const d = s.replace(/[^0-9]/g, "");
  if (!d || d.length < 8 || d.length > 15) return null;
  return d;
}

function jidFromCtx(m) {
  return m?.sender || m?.key?.participant || m?.key?.remoteJid || "";
}

function isDev(m) {
  const digits = jidToPhoneDigits(jidFromCtx(m));
  return !!digits && DEV_NUMBERS.includes(digits);
}

module.exports = {
  name: "CheckContact",
  category: "autosave",
  desc: "Debug: check exactly why a number shows as saved or unsaved (DEV ONLY)",
  command: ["checkcontact", "checknum", "debug"],
  devOnly: true,

  run: async ({ reply, m, args, store, botNumber, botJid, sock }) => {
    if (!isDev(m)) return reply("🔒 Developer-only feature.");

    const rawNum = (args?.[0] || "").replace(/[^0-9]/g, "");
    if (!rawNum || rawNum.length < 8 || rawNum.length > 15) {
      return reply(`Usage: .checkcontact +2348XXXXXXXXX\n\nProvide the full international number.`);
    }

    const ownerNumber = jidToPhoneDigits(botJid || botNumber || sock?.user?.id);
    if (!ownerNumber) return reply("❌ Could not resolve owner number.");

    const db = readJson(CONTACTS_FILE, { contacts: {} });
    const ownerBook = db?.contacts?.[ownerNumber] || {};

    const numCore = coreDigits(rawNum);

    let report = `🔍 Contact Check: +${rawNum}\n`;
    report += `━━━━━━━━━━━━━━━━━━━━━━\n`;
    report += `coreDigits key: "${numCore}" (length: ${numCore.length})\n\n`;

    // --- Check 1: Bot local DB ---
    const inLocalDb = !!ownerBook[rawNum];
    report += `1️⃣ Bot local DB: ${inLocalDb ? "✅ FOUND" : "❌ not found"}\n`;

    // --- Check 2: Google Contacts ---
    if (!isGoogleLinked(ownerNumber)) {
      report += `2️⃣ Google Contacts: ⚠️ Google not linked (.linkgoogle to fix)\n`;
    } else {
      try {
        const result = await buildContactsMapForOwner(ownerNumber);
        if (!result.map) {
          report += `2️⃣ Google Contacts: ❌ Error loading map: ${result.error}\n`;
        } else {
          const match = result.map.get(numCore);
          if (match) {
            report += `2️⃣ Google Contacts: ✅ FOUND\n`;
            report += `   Name: ${match.name || "(no name)"}\n`;
            report += `   Bucket: ${match.bucket} (${match.bucket === "contacts" ? "main address book" : "auto-collected by Google"})\n`;
            report += `   Resource: ${match.resourceName}\n`;
          } else {
            report += `2️⃣ Google Contacts: ❌ NOT FOUND in Google\n`;
            report += `   Map has ${result.map.size} entries. Key "${numCore}" not present.\n`;

            // Try to find near-misses (numbers with similar endings)
            const partialMatches = [];
            for (const [key, entry] of result.map.entries()) {
              // If last 7 digits match, it might be a format variant
              if (key.length >= 7 && numCore.length >= 7 && key.slice(-7) === numCore.slice(-7) && key !== numCore) {
                partialMatches.push({ key, entry });
              }
            }
            if (partialMatches.length > 0) {
              report += `   ⚠️ Possible near-misses (same last 7 digits, different format):\n`;
              for (const { key, entry } of partialMatches.slice(0, 3)) {
                report += `     key="${key}" → ${entry.name || "(no name)"}\n`;
              }
            }
          }
        }
      } catch (e) {
        report += `2️⃣ Google Contacts: ❌ Error: ${e?.message}\n`;
      }
    }

    // --- Check 3: Phone address book via store ---
    const jid = `${rawNum}@s.whatsapp.net`;
    const storeEntry = store?.contacts?.get?.(jid);
    const phoneBookName = storeEntry?.name ? String(storeEntry.name).trim() : null;
    const pushName = storeEntry?.notify ? String(storeEntry.notify).trim() : null;
    const verifiedName = storeEntry?.verifiedName ? String(storeEntry.verifiedName).trim() : null;

    report += `3️⃣ Phone address book: ${phoneBookName ? `✅ FOUND — "${phoneBookName}"` : "❌ not in phone contacts"}\n`;
    report += `   WhatsApp push name: ${pushName || "(none)"}\n`;
    report += `   Verified name: ${verifiedName || "(none)"}\n`;
    report += `   In store.contacts: ${storeEntry ? "yes" : "no"}\n\n`;

    // --- Summary ---
    const isSaved = inLocalDb || (!!(storeEntry?.name));
    const isGoogleSaved = !!((() => { try { return null; } catch { return null; } })());

    report += `━━━━━━━━━━━━━━━━━━━━━━\n`;
    if (inLocalDb) {
      report += `✅ VERDICT: Saved (bot local DB)`;
    } else if (phoneBookName) {
      report += `✅ VERDICT: Saved in phone address book\n`;
      report += `ℹ️ Note: This contact is saved locally on your phone but may not be in Google Contacts.`;
    } else {
      report += `❌ VERDICT: Genuinely unsaved\n`;
      report += `This number is not in:\n`;
      report += `  • Bot DB\n`;
      report += `  • Google Contacts\n`;
      report += `  • Phone address book (as seen by WhatsApp)\n\n`;
      report += `Possible reasons:\n`;
      report += `  • Saved on SIM card only (SIM contacts don't sync to Google)\n`;
      report += `  • Recently saved but WhatsApp hasn't refreshed yet\n`;
      report += `  • Saved under a different number than WhatsApp shows`;
    }

    return reply(report);
  },
};
