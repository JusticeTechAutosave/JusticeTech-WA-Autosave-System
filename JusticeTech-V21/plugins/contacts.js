// plugins/contacts.js
// Shows saved contacts from local DB + total count from Google Contacts API

const fs = require("fs");
const path = require("path");
const { getAuthedClientForUser, normalizeNumber } = require("../library/googleTenantAuth");
const { google } = require("googleapis");

const DB_DIR = path.join(__dirname, "..", "database");
const CONTACTS_FILE = path.join(DB_DIR, "autosaved_contacts.json");

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

function toTime(val) {
  if (!val) return "-";
  try { return new Date(val).toLocaleString(); } catch { return "-"; }
}

async function getGoogleTotal(ownerNumber) {
  try {
    const auth = getAuthedClientForUser(ownerNumber);
    if (!auth) return null;
    const people = google.people({ version: "v1", auth });
    const resp = await people.people.connections.list({
      resourceName: "people/me",
      personFields: "names",
      pageSize: 1,
    });
    return resp.data?.totalPeople ?? null;
  } catch {
    return null;
  }
}

module.exports = {
  name: "Contacts",
  command: ["contacts"],
  category: "autosave",
  desc: "List saved contacts + Google Contacts total count",
  ownerOnly: true,

  run: async function ({ reply, args, botNumber, botJid, sock }) {
    const ownerNumber = jidToPhoneDigits(botJid || botNumber || sock?.user?.id);

    // Load local DB
    const db = readJson(CONTACTS_FILE, { contacts: {} });
    const ownerBook = ownerNumber ? (db?.contacts?.[ownerNumber] || {}) : {};
    const entries = Object.values(ownerBook).filter(Boolean);

    // Fetch Google total (non-blocking)
    let googleTotal = null;
    if (ownerNumber) {
      googleTotal = await getGoogleTotal(ownerNumber);
    }

    const limit = Math.min(Math.max(parseInt(args?.[0] || "50", 10) || 50, 1), 200);
    entries.sort((a, b) => {
      const ta = a.savedAt ? new Date(a.savedAt).getTime() : 0;
      const tb = b.savedAt ? new Date(b.savedAt).getTime() : 0;
      return tb - ta;
    });

    const sliced = entries.slice(0, limit);

    let msg = `📒 Contacts Report\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━━━\n`;
    msg += `☁️ Google Contacts total: ${googleTotal !== null ? googleTotal : "(not linked)"}\n`;
    msg += `💾 Bot-tracked (local DB): ${entries.length}\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━━━\n\n`;

    if (!sliced.length) {
      msg += "No contacts in local database yet.\n\n";
      msg += "Run .saveoldprofile or .saveold to bulk-save old DM contacts.";
      return reply(msg);
    }

    msg += `Showing ${sliced.length} of ${entries.length} (most recent first):\n\n`;

    const lines = sliced.map((c, i) => {
      const num = c.number ? `+${c.number}` : "N/A";
      const name = c.name || "No name";
      const when = toTime(c.savedAt);
      return `${String(i + 1).padStart(2, " ")}. ${name}\n    ${num}\n    ${when}`;
    });

    msg += lines.join("\n\n");
    msg += `\n\nTip: .delcontact +234xxxxxxxxxx to remove`;

    return reply(msg);
  },
};
