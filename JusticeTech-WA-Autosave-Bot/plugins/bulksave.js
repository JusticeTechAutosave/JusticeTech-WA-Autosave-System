// plugins/bulksave.js
// saveold     → save all unsaved old DM contacts using the configured GENERIC name
// saveoldprofile → save all unsaved old DM contacts using their WhatsApp profile (push) name
//
// FIXES:
// ✅ Checks Google Contacts API (not just local DB) before marking a contact as "unsaved"
// ✅ Relaxed name validation for saveoldprofile (real profile names can contain numbers, dots etc.)
// ✅ Writes DB progressively — progress not lost on crash
// ✅ Invalidates contacts cache after bulk save
// ✅ Clearer skip reasons in progress output

const fs = require("fs");
const path = require("path");
const { upsertContactForOwner, searchContactByPhone, invalidateContactsCache } = require("../library/googleContacts");

const DB_DIR = path.join(__dirname, "..", "database");
const CONTACTS_FILE = path.join(DB_DIR, "autosaved_contacts.json");
const TAGS_FILE = path.join(DB_DIR, "tags.json");
const GENERIC_FILE = path.join(DB_DIR, "generic.json");
const BLACKLIST_FILE = path.join(DB_DIR, "blacklist.json");
const SCAN_CACHE_FILE = path.join(DB_DIR, "scan_cache.json");

const DEV_NUMBERS = ["2349032578690", "2348166337692"];

/* ── core db helpers ── */

function ensure() {
  if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });
  if (!fs.existsSync(CONTACTS_FILE)) fs.writeFileSync(CONTACTS_FILE, JSON.stringify({ contacts: {} }, null, 2));
  if (!fs.existsSync(TAGS_FILE)) fs.writeFileSync(TAGS_FILE, JSON.stringify({ new: "", old: "" }, null, 2));
  if (!fs.existsSync(GENERIC_FILE)) fs.writeFileSync(GENERIC_FILE, JSON.stringify({ name: "" }, null, 2));
  if (!fs.existsSync(BLACKLIST_FILE)) fs.writeFileSync(BLACKLIST_FILE, JSON.stringify({ numbers: [] }, null, 2));
  if (!fs.existsSync(SCAN_CACHE_FILE)) fs.writeFileSync(SCAN_CACHE_FILE, JSON.stringify({ dmJids: [] }, null, 2));
}

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}
function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}
function readDb() {
  ensure();
  return readJson(CONTACTS_FILE, { contacts: {} }) || { contacts: {} };
}
function writeDb(db) {
  ensure();
  writeJson(CONTACTS_FILE, db);
}

function sanitizeText(input) {
  return String(input || "").replace(/\s+/g, " ").trim();
}
function jidToPhoneDigits(jidOrPn) {
  let s = String(jidOrPn || "").trim();
  if (!s) return null;
  if (s.includes("@")) s = s.split("@")[0];
  if (s.includes(":")) s = s.split(":")[0];
  const d = s.replace(/[^0-9]/g, "");
  if (!d || d.length < 8 || d.length > 15) return null;
  return d;
}
function isDmJid(jid) {
  return String(jid || "").endsWith("@s.whatsapp.net");
}
function unique(arr) {
  return [...new Set(arr)];
}

/* ── DEV-only ── */

function jidFromCtx(m) {
  return m?.sender || m?.key?.participant || m?.key?.remoteJid || "";
}
function isDev(m) {
  const digits = jidToPhoneDigits(jidFromCtx(m));
  return !!digits && DEV_NUMBERS.includes(digits);
}

/* ── tags / generic / blacklist ── */

function readGeneric() {
  ensure();
  const g = readJson(GENERIC_FILE, { name: "" });
  return String(g?.name || "").trim();
}
function getOldTag() {
  ensure();
  const t = readJson(TAGS_FILE, { new: "", old: "" });
  return String(t?.old || "").trim();
}
function applyTagAtEnd(name, tag) {
  const n = String(name || "").trim();
  const t = String(tag || "").trim();
  return t ? `${n} ${t}`.trim() : n;
}
function getBlacklistSet() {
  ensure();
  const b = readJson(BLACKLIST_FILE, { numbers: [] });
  const nums = Array.isArray(b?.numbers) ? b.numbers : [];
  return new Set(nums.map((x) => String(x || "").replace(/\D/g, "")).filter(Boolean));
}

/* ── store helpers ── */

function lookupProfileName(store, jid) {
  try {
    const c = store?.contacts?.get?.(jid);
    // notify = push name (what they set on their phone), verifiedName = business name
    const n = c?.notify || c?.verifiedName || c?.name || "";
    return String(n || "").trim();
  } catch {
    return "";
  }
}

function collectDmJidsFromStore(store) {
  const out = [];
  try {
    if (store?.messages && typeof store.messages.keys === "function") {
      for (const k of store.messages.keys()) {
        const jid = String(k).split(":")[0];
        if (isDmJid(jid)) out.push(jid);
      }
    }
  } catch {}
  try {
    if (store?.contacts && typeof store.contacts.keys === "function") {
      for (const jid of store.contacts.keys()) {
        if (isDmJid(jid)) out.push(String(jid));
      }
    }
  } catch {}
  return unique(out);
}

function collectDmJidsFromScanCache() {
  ensure();
  const cache = readJson(SCAN_CACHE_FILE, { dmJids: [] });
  const list = Array.isArray(cache?.dmJids) ? cache.dmJids : [];
  return unique(list.map(String)).filter(isDmJid);
}

/* ── Name validation ── */

// Strict validation for GENERIC names (user-set, must be clean)
function words(name) {
  return String(name || "").trim().split(/\s+/).filter(Boolean);
}
function letterCountOnly(fullName) {
  return String(fullName || "").replace(/[^A-Za-zÀ-ÖØ-öø-ÿ]/g, "").length;
}
function isValidCharsOnly(name) {
  const re = /^[A-Za-zÀ-ÖØ-öø-ÿ]+([ '-][A-Za-zÀ-ÖØ-öø-ÿ]+)*$/;
  return re.test(String(name || "").trim());
}
function firstWordTooShort(name) {
  const parts = words(name);
  if (!parts.length) return true;
  return String(parts[0]).replace(/[^A-Za-zÀ-ÖØ-öø-ÿ]/g, "").length < 3;
}
function looksLikeSentence(name) {
  const s = String(name || "").trim().toLowerCase();
  const badPhrases = ["my name is","my names","i am","i'm","im ","i have","i bought","i buy","i want","i need","i will","i would","i was","i just","am buying","i paid","i sent","this is","it's","its ","hello","hi ","hey ","good morning","good afternoon","good evening"];
  for (const p of badPhrases) {
    if (s === p || s.startsWith(p + " ") || s.includes(p + " ")) return true;
  }
  return false;
}
function isLikelyJunk(name) {
  return /^(hi|hello|hey|yo|sup|bro|ok|okay|kk|k|yes|no|test|testing|hmm|lol)$/i.test(String(name || "").trim());
}
function validateGenericName(nameRaw) {
  const name = sanitizeText(nameRaw);
  if (!name) return { ok: false };
  const wc = words(name).length;
  if (wc < 1 || wc > 2) return { ok: false };
  if (!isValidCharsOnly(name)) return { ok: false };
  if (isLikelyJunk(name) || firstWordTooShort(name)) return { ok: false };
  if (looksLikeSentence(name)) return { ok: false };
  const letters = letterCountOnly(name);
  if (letters <= 0 || letters > 12) return { ok: false };
  return { ok: true, clean: name };
}

// ✅ RELAXED validation for PROFILE names — WhatsApp names can contain
// numbers, dots, dashes, emoji, mixed case, etc. We only reject clear junk.
function validateProfileName(nameRaw) {
  const name = sanitizeText(nameRaw);
  if (!name || name.length < 2) return { ok: false, reason: "too short" };
  if (name.length > 50) return { ok: false, reason: "too long" };

  // Must have at least 2 actual letters (not just symbols/digits/emoji)
  const letterCount = (name.match(/[A-Za-zÀ-ÖØ-öø-ÿ]/g) || []).length;
  if (letterCount < 2) return { ok: false, reason: "no letters" };

  // Reject pure phone numbers
  if (/^\+?[\d\s\-()]+$/.test(name)) return { ok: false, reason: "looks like a phone number" };

  // Reject obvious junk phrases
  if (isLikelyJunk(name)) return { ok: false, reason: "junk word" };
  if (looksLikeSentence(name)) return { ok: false, reason: "sentence" };

  return { ok: true, clean: name };
}

/* ── progress ── */

function progressBar(done, total, width = 10) {
  const t = total > 0 ? total : 1;
  const filled = Math.round(Math.max(0, Math.min(1, done / t)) * width);
  return `[${"\u2588".repeat(filled)}${"\u2591".repeat(width - filled)}] ${done}/${total}`;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ── Build target list (checks local DB + Google Contacts) ── */

async function buildUnsavedTargets({ store, ownerBook, blacklistSet, ownerNumber }) {
  const a = collectDmJidsFromStore(store);
  const b = collectDmJidsFromScanCache();
  const dmJids = unique([...a, ...b]);

  const targets = [];
  const alreadySavedInGoogle = [];

  for (const jid of dmJids) {
    const digits = jidToPhoneDigits(jid);
    if (!digits) continue;
    if (blacklistSet.has(digits)) continue;

    // Step 1: Already in local DB?
    if (ownerBook[digits]) continue;

    // Step 2: Already in Google Contacts? (catches pre-existing contacts)
    try {
      const googleMatch = await searchContactByPhone(ownerNumber, digits);
      if (googleMatch) {
        // Cache it locally so autosave flow won't prompt them either
        ownerBook[digits] = {
          number: digits,
          name: googleMatch.name || digits,
          rawName: googleMatch.name || null,
          savedAt: new Date().toISOString(),
          google: {
            resourceName: googleMatch.resourceName,
            etag: googleMatch.etag || null,
            mode: "existing",
          },
          source: "google_verified",
        };
        alreadySavedInGoogle.push(digits);
        continue;
      }
    } catch {
      // API check failed — still include contact so it gets saved
    }

    targets.push({ jid, digits });
  }

  return { targets, alreadySavedInGoogle };
}

/* ── Plugin ── */

module.exports = {
  name: "BulkSave",
  category: "autosave",
  desc: "Bulk-save all unsaved DM contacts to Google Contacts",
  command: ["saveold", "saveoldprofile"],
  ownerOnly: false,
  premiumOnly: true,

  run: async ({ sock, reply, command, botNumber, botJid, store, args, m, prefix, isOwner, isPremium, isDev: callerIsDev }) => {
    try {
      ensure();

      if (!callerIsDev && !isOwner && !isPremium) return reply("🔒 This feature requires an active subscription.\n\nSee: " + (prefix || ".") + "sub plans");

      const ownerNumber = jidToPhoneDigits(botJid || botNumber || sock?.user?.id);
      if (!ownerNumber) return reply("❌ Could not resolve owner number.");

      const db = readDb();
      db.contacts = db.contacts || {};
      db.contacts[ownerNumber] = db.contacts[ownerNumber] || {};
      const ownerBook = db.contacts[ownerNumber];

      const blacklistSet = getBlacklistSet();
      const usingProfile = String(command).toLowerCase() === "saveoldprofile";
      const dryRun = String(args?.[0] || "").toLowerCase() === "dry";

      const genericName = readGeneric();

      // For saveold, generic name must be valid
      if (!usingProfile) {
        const v = validateGenericName(genericName);
        if (!v.ok) {
          return reply("⚠️ Generic name is invalid.\nUse: .generic <name>\nRules: 1-2 words, first word 3+ letters, max 12 letters total.");
        }
      }

      const oldTag = getOldTag();

      await reply(`⏳ Scanning for unsaved contacts...\nThis checks your local DB and Google Contacts.`);

      const { targets, alreadySavedInGoogle } = await buildUnsavedTargets({
        store, ownerBook, blacklistSet, ownerNumber,
      });

      // Persist any new Google-verified entries we discovered during scan
      if (alreadySavedInGoogle.length > 0) {
        db.contacts[ownerNumber] = ownerBook;
        writeDb(db);
      }

      if (!targets.length) {
        let msg = `✅ Scan complete. No unsaved DM numbers found.`;
        if (alreadySavedInGoogle.length > 0) {
          msg += `\n\n✅ ${alreadySavedInGoogle.length} contacts found in Google Contacts (already saved — cached locally now).`;
        }
        return reply(msg);
      }

      await reply(
        `⏳ Scan complete.\n` +
        `Unsaved targets: ${targets.length}\n` +
        (alreadySavedInGoogle.length ? `Already in Google (cached): ${alreadySavedInGoogle.length}\n` : "") +
        `Mode: ${usingProfile ? "WhatsApp profile names" : `Generic: ${genericName}`}\n` +
        `Tag (OLD): ${oldTag || "(none)"}`
      );

      if (dryRun) {
        const sample = targets.slice(0, 10).map((t, i) => `${i + 1}. ${t.digits}`).join("\n");
        return reply(`🧪 Dry-run only.\nWould attempt: ${targets.length}\n\nFirst 10:\n${sample}${targets.length > 10 ? "\n..." : ""}`);
      }

      let saved = 0;
      let skippedNoName = 0;
      let failed = 0;
      const total = targets.length;
      let processed = 0;
      const progressEvery = 25;
      const dbWriteEvery = 10; // write DB every 10 saves (fast + safe)

      await reply(`🚀 Bulk save started...\n${progressBar(0, total)}`);

      for (const t of targets) {
        processed++;
        const contactNumber = t.digits;
        const jid = t.jid;

        // Safety re-check (in case it was saved mid-run)
        if (ownerBook[contactNumber]) {
          continue;
        }

        let baseName = "";

        if (usingProfile) {
          // ── saveoldprofile: use WhatsApp push name ──
          const profileName = lookupProfileName(store, jid);
          const pv = validateProfileName(profileName);

          if (pv.ok) {
            baseName = pv.clean;
          } else {
            // No valid profile name — skip this contact (don't fall back to generic)
            skippedNoName++;
            if (processed % progressEvery === 0 || processed === total) {
              await reply(`📌 Progress\n${progressBar(processed, total)}\nSaved: ${saved} | Skipped (no name): ${skippedNoName} | Failed: ${failed}`);
            }
            await sleep(80);
            continue;
          }
        } else {
          // ── saveold: use generic name ──
          baseName = genericName;
        }

        const finalName = applyTagAtEnd(baseName, oldTag);

        try {
          const res = await upsertContactForOwner({
            ownerNumber,
            contactName: finalName,
            contactNumber,
            resourceName: null,
          });

          ownerBook[contactNumber] = {
            name: finalName,
            rawName: baseName,
            number: contactNumber,
            jid: `${contactNumber}@s.whatsapp.net`,
            savedAt: new Date().toISOString(),
            google: { resourceName: res.resourceName, etag: res.etag, mode: res.mode },
          };

          saved++;

          // Write DB every 10 saves to preserve progress without constant disk hits
          if (saved % dbWriteEvery === 0) {
            db.contacts[ownerNumber] = ownerBook;
            writeDb(db);
          }
        } catch (e) {
          console.log(`[BULKSAVE] Failed to save ${contactNumber}: ${e?.message}`);
          failed++;
        }

        if (processed % progressEvery === 0 || processed === total) {
          await reply(`📌 Progress\n${progressBar(processed, total)}\nSaved: ${saved} | Skipped (no name): ${skippedNoName} | Failed: ${failed}`);
        }

        await sleep(80);
      }

      // Final DB flush (captures any remaining saves not caught by batch write)
      db.contacts[ownerNumber] = ownerBook;
      writeDb(db);

      // Invalidate cache so autosave flow reflects newly saved contacts
      invalidateContactsCache(ownerNumber);

      let summary = `✅ Bulk save complete.\n\nSaved: ${saved}\nFailed: ${failed}\nTotal targeted: ${total}`;
      if (skippedNoName > 0) {
        summary += `\nSkipped (no profile name): ${skippedNoName}`;
        if (usingProfile) {
          summary += `\n\nTip: Run .saveold to save the remaining ${skippedNoName} with a generic name.`;
        }
      }
      if (alreadySavedInGoogle.length > 0) {
        summary += `\n\nAlso found ${alreadySavedInGoogle.length} contacts already saved in Google (cached locally).`;
      }

      return reply(summary);
    } catch (e) {
      return reply(`❌ Bulk save error: ${e?.message || String(e)}`);
    }
  },
};
