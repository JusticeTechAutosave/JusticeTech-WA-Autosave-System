// plugins/save.js
// Manual contact save: .save +2349032578690 JusticeTech
// Also: .save 2349032578690 JusticeTech (+ is optional)

const fs = require("fs");
const path = require("path");
const { google } = require("googleapis");
const { upsertContactForOwner, searchContactByPhone, invalidateContactsCache } = require("../library/googleContacts");
const { getAuthedClientForUser, normalizeNumber } = require("../library/googleTenantAuth");

const DB_DIR = path.join(__dirname, "..", "database");
const CONTACTS_FILE = path.join(DB_DIR, "autosaved_contacts.json");
const TAGS_FILE = path.join(DB_DIR, "tags.json");

const DEV_NUMBERS = ["2349032578690", "2348166337692"];

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}
function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}
function readDb() {
  if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });
  return readJson(CONTACTS_FILE, { contacts: {} }) || { contacts: {} };
}
function writeDb(db) {
  if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });
  writeJson(CONTACTS_FILE, db);
}

function jidToPhoneDigits(jidOrPn) {
  let s = String(jidOrPn || "").trim().replace(/^\+/, "");
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

function getOldTag() {
  const t = readJson(TAGS_FILE, { new: "", old: "" });
  return String(t?.old || "").trim();
}

// Search Google Contacts by exact display name
async function searchByName(ownerNumber, nameToFind) {
  try {
    const auth = getAuthedClientForUser(ownerNumber);
    if (!auth) return null;
    const people = google.people({ version: "v1", auth });
    const res = await people.people.searchContacts({
      query: nameToFind,
      readMask: "names,phoneNumbers",
      sources: ["READ_SOURCE_TYPE_CONTACT"],
    });
    const results = res.data?.results || [];
    for (const r of results) {
      const names = r.person?.names || [];
      for (const n of names) {
        if (String(n.displayName || "").toLowerCase() === nameToFind.toLowerCase()) {
          return {
            resourceName: r.person.resourceName,
            name: n.displayName,
            phones: (r.person.phoneNumbers || []).map(p => p.value),
          };
        }
      }
    }
    return null;
  } catch {
    return null;
  }
}

module.exports = {
  name: "SaveContact",
  category: "autosave",
  desc: "Manually save a contact to Google Contacts (.save +number Name)",
  command: ["save"],
  premiumOnly: true,

  run: async ({ reply, args, m, botNumber, botJid, sock, isOwner, isPremium, isDev: callerIsDev }) => {
    if (!callerIsDev && !isOwner && !isPremium) return reply("🔒 This feature requires an active subscription.\n\nSee: .sub plans");

    const ownerNumber = jidToPhoneDigits(botJid || botNumber || sock?.user?.id);
    if (!ownerNumber) return reply("❌ Could not resolve owner number.");

    if (!args || args.length < 2) {
      return reply(
        "Usage: .save <number> <name>\n\n" +
        "Examples:\n" +
        "  .save +2349032578690 JusticeTech\n" +
        "  .save 2348012345678 Emeka Okafor\n\n" +
        "Notes:\n" +
        "• The OLD tag (if set) is appended automatically\n" +
        "• If number or name already exists, you'll be told"
      );
    }

    const contactNumber = jidToPhoneDigits(args[0]);
    if (!contactNumber) {
      return reply(`❌ Invalid phone number: "${args[0]}"\nUse international format, e.g. +2349032578690`);
    }

    const contactName = args.slice(1).join(" ").trim();
    if (!contactName || contactName.length < 2) {
      return reply("❌ Contact name must be at least 2 characters.");
    }
    if (contactName.length > 50) {
      return reply("❌ Contact name too long (max 50 characters).");
    }

    const auth = getAuthedClientForUser(ownerNumber);
    if (!auth) return reply("❌ Google not linked. Run .linkgoogle first.");

    const db = readDb();
    db.contacts = db.contacts || {};
    db.contacts[ownerNumber] = db.contacts[ownerNumber] || {};
    const ownerBook = db.contacts[ownerNumber];

    // ── Check 1: Number already in local DB ──────────────────────────────────
    if (ownerBook[contactNumber]) {
      const existing = ownerBook[contactNumber];
      return reply(
        `⚠️ This NUMBER is already saved in local DB.\n\n` +
        `Number: +${contactNumber}\n` +
        `Saved as: "${existing.name || "(unnamed)"}"\n` +
        `Saved at: ${existing.savedAt || "-"}\n\n` +
        `➡️ Use a different number, or use .delcontact +${contactNumber} first to remove it.`
      );
    }

    // ── Check 2: Number already in Google Contacts ───────────────────────────
    await reply(`⏳ Checking if number and name already exist in Google Contacts...`);

    const gByNumber = await searchContactByPhone(ownerNumber, contactNumber);
    if (gByNumber) {
      // Cache it locally
      ownerBook[contactNumber] = {
        number: contactNumber,
        name: gByNumber.name || contactName,
        rawName: gByNumber.name || contactName,
        savedAt: new Date().toISOString(),
        google: { resourceName: gByNumber.resourceName, etag: gByNumber.etag || null, mode: "existing" },
        source: "google_verified",
      };
      db.contacts[ownerNumber] = ownerBook;
      writeDb(db);
      return reply(
        `⚠️ This NUMBER already exists in Google Contacts.\n\n` +
        `Number: +${contactNumber}\n` +
        `Saved as: "${gByNumber.name || "(unnamed)"}"\n\n` +
        `➡️ Try a different number.\n` +
        `   If you want to update the name for this contact, use the rename command.`
      );
    }

    // ── Check 3: Name already in Google Contacts ─────────────────────────────
    const gByName = await searchByName(ownerNumber, contactName);
    if (gByName) {
      return reply(
        `⚠️ This NAME already exists in Google Contacts.\n\n` +
        `Name: "${gByName.name}"\n` +
        `Phone(s): ${gByName.phones.join(", ") || "(none)"}\n\n` +
        `➡️ Try a different name to avoid duplicates.\n` +
        `   Example: .save +${contactNumber} ${contactName} 2`
      );
    }

    // ── All clear — save the contact ─────────────────────────────────────────
    const oldTag = getOldTag();
    const finalName = oldTag ? `${contactName} ${oldTag}` : contactName;

    await reply(`⏳ Saving +${contactNumber} as "${finalName}"...`);

    try {
      const res = await upsertContactForOwner({
        ownerNumber,
        contactName: finalName,
        contactNumber,
        resourceName: null,
      });

      ownerBook[contactNumber] = {
        number: contactNumber,
        name: finalName,
        rawName: contactName,
        jid: `${contactNumber}@s.whatsapp.net`,
        savedAt: new Date().toISOString(),
        google: { resourceName: res.resourceName, etag: res.etag, mode: res.mode },
      };

      db.contacts[ownerNumber] = ownerBook;
      writeDb(db);
      invalidateContactsCache(ownerNumber);

      return reply(
        `✅ Contact saved successfully!\n\n` +
        `Number: +${contactNumber}\n` +
        `Name: ${finalName}\n` +
        `Google resource: ${res.resourceName}`
      );
    } catch (e) {
      const msg = e?.message || String(e);

      // Google will throw 409 for duplicate phone numbers
      if (msg.includes("409") || msg.toLowerCase().includes("already exists") || msg.toLowerCase().includes("duplicate")) {
        return reply(
          `⚠️ Google Contacts rejected this — number may already exist\n` +
          `under a slightly different format in your account.\n\n` +
          `Try:\n` +
          `1. Go to contacts.google.com and search +${contactNumber}\n` +
          `2. If found, delete it there first\n` +
          `3. Then run .save again`
        );
      }

      return reply(`❌ Failed to save contact: ${msg}`);
    }
  },
};
