// plugins/fetchchats.js
// Lists unsaved DM contacts — cross-checks BOTH local DB and Google Contacts API.
// Fetches the full Google contacts map ONCE, then does all lookups locally (no per-contact API calls).

const fs = require("fs");
const path = require("path");
const {
  buildContactsMapForOwner,
  coreDigits,
  isGoogleLinked,
} = require("../library/googleContacts");

const DB_DIR = path.join(__dirname, "..", "database");
const CONTACTS_FILE = path.join(DB_DIR, "autosaved_contacts.json");
const SCAN_CACHE_FILE = path.join(DB_DIR, "scan_cache.json");

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

function isDmJid(jid) {
  return String(jid || "").endsWith("@s.whatsapp.net");
}

function jidFromCtx(m) {
  return m?.sender || m?.key?.participant || m?.key?.remoteJid || "";
}

function isDev(m) {
  const digits = jidToPhoneDigits(jidFromCtx(m));
  return !!digits && DEV_NUMBERS.includes(digits);
}

function unique(arr) {
  return [...new Set(arr)];
}

function lookupProfileName(store, jid) {
  try {
    const c = store?.contacts?.get?.(jid);
    return String(c?.notify || c?.verifiedName || c?.name || "").trim();
  } catch { return ""; }
}

// Collect ALL DM JIDs from every available source
function collectAllDmJids(store) {
  const out = [];
  let storeContactCount = 0;
  let storeMessageCount = 0;
  let cacheCount = 0;

  try {
    if (store?.contacts && typeof store.contacts.keys === "function") {
      for (const jid of store.contacts.keys()) {
        if (isDmJid(jid)) { out.push(String(jid)); storeContactCount++; }
      }
    }
  } catch {}

  try {
    if (store?.messages && typeof store.messages.keys === "function") {
      for (const k of store.messages.keys()) {
        const jid = String(k).split(":")[0];
        if (isDmJid(jid)) { out.push(jid); storeMessageCount++; }
      }
    }
  } catch {}

  try {
    const cache = readJson(SCAN_CACHE_FILE, { dmJids: [] });
    for (const jid of (cache?.dmJids || [])) {
      if (isDmJid(jid)) { out.push(String(jid)); cacheCount++; }
    }
  } catch {}

  return {
    jids: unique(out),
    sources: { storeContacts: storeContactCount, storeMessages: storeMessageCount, cache: cacheCount },
  };
}

module.exports = {
  name: "FetchChats",
  category: "autosave",
  desc: "List unsaved DM contacts — checks local DB AND Google Contacts (owner/premium)",
  command: ["fetchchats"],
  premiumOnly: true,

  run: async ({ reply, m, store, botNumber, botJid, sock, isOwner, isDev, isPremium }) => {
    if (!isDev && !isOwner && !isPremium) {
      return reply("🔒 This feature requires an active premium subscription.");
    }

    const ownerNumber = jidToPhoneDigits(botJid || botNumber || sock?.user?.id);
    if (!ownerNumber) return reply("❌ Could not resolve owner number.");

    const chatJid = m?.chat || m?.key?.remoteJid;
    if (!chatJid) return reply("❌ Cannot detect chat.");

    // Helper function for progress bar
    function progressBar(pct) {
      const width = 10;
      const filled = Math.max(0, Math.min(width, Math.round((pct / 100) * width)));
      const empty = width - filled;
      return `[${"█".repeat(filled)}${"░".repeat(empty)}] ${pct}%`;
    }

    // Helper function to edit message
    async function updateProgress(key, text) {
      try {
        await sock.sendMessage(chatJid, { text, edit: key });
      } catch (e) {
        // Fallback: send new message if edit fails
        const newMsg = await sock.sendMessage(chatJid, { text });
        return newMsg?.key || key;
      }
      return key;
    }

    // Send initial progress message
    let progressText = `🔍 Scanning DM sources...\n${progressBar(10)}\n\n` +
      `• Scanning store.contacts...\n` +
      `• Scanning store.messages...\n` +
      `• Loading cache...\n`;
    
    const initialMsg = await sock.sendMessage(chatJid, { text: progressText }, { quoted: m });
    let progressKey = initialMsg?.key;

    if (!progressKey?.id) {
      // Fallback to old method if we can't track the message
      await reply("⏳ Scanning all DM sources...");
    }

    const db = readJson(CONTACTS_FILE, { contacts: {} });
    const ownerBook = db?.contacts?.[ownerNumber] || {};

    const { jids: allJids, sources } = collectAllDmJids(store);

    // Update progress
    progressText = `🔍 Scanning DM sources...\n${progressBar(30)}\n\n` +
      `✅ Found ${allJids.length} DM contacts\n` +
      `• store.contacts: ${sources.storeContacts}\n` +
      `• store.messages: ${sources.storeMessages}\n` +
      `• cache: ${sources.cache}\n`;
    
    if (progressKey?.id) {
      progressKey = await updateProgress(progressKey, progressText);
    }

    // ── Diagnostic output if very few DMs found ──────────────────────────────
    if (allJids.length <= 5) {
      let diag = `⚠️ Very few DMs found (${allJids.length} total).\n\n`;
      diag += `📊 Sources breakdown:\n`;
      diag += `  • store.contacts: ${sources.storeContacts}\n`;
      diag += `  • store.messages: ${sources.storeMessages}\n`;
      diag += `  • scan_cache.json: ${sources.cache}\n\n`;

      if (!fs.existsSync(SCAN_CACHE_FILE)) {
        diag += `❌ scan_cache.json does not exist yet.\n\n`;
      } else {
        const raw = readJson(SCAN_CACHE_FILE, {});
        diag += `📄 scan_cache.json exists:\n`;
        diag += `  • dmJids count: ${raw?.dmJids?.length || 0}\n`;
        diag += `  • isLatest: ${raw?.isLatest}\n`;
        diag += `  • updatedAt: ${raw?.updatedAt || "never"}\n`;
        diag += `  • chatsCount: ${raw?.chatsCount || 0}\n\n`;
      }

      if (sources.storeContacts === 0 && sources.storeMessages <= 1 && sources.cache === 0) {
        diag += `🔧 Root cause: Store is empty — history sync has not run yet.\n\n`;
        diag += `✅ Fix:\n`;
        diag += `1. .historysync on\n`;
        diag += `2. Restart the bot\n`;
        diag += `3. Wait for "History scan complete"\n`;
        diag += `4. Run .fetchchats again\n`;
      } else if (sources.storeContacts === 0 && sources.cache > 5) {
        diag += `⚠️ scan_cache has ${sources.cache} JIDs but store.contacts is empty.\n`;
        diag += `Restart the bot so contacts.set populates the store properly.`;
      }

      // Update progress message with diagnostic info
      if (progressKey?.id) {
        await updateProgress(progressKey, diag);
      } else {
        await reply(diag);
      }
      return;
    }

    // ── Warn if DM count is suspiciously low but not empty ───────────────────
    let warningNote = "";
    if (allJids.length < 50) {
      warningNote = `\n⚠️ Only ${allJids.length} DMs found — incomplete scan.\n` +
        `Run: .historysync on, then restart bot.\n`;
    }

    // ── Step 1: Fetch the FULL Google Contacts map in ONE API call ────────────
    const googleLinked = isGoogleLinked(ownerNumber);

    let googleMap = null;
    let googleError = null;
    let googleStats = { main: 0, other: 0, otherFailed: false, accounts: [] };

    if (!googleLinked) {
      googleError = "Google not linked";
    } else {
      // Update progress: Loading Google Contacts
      progressText = `🔍 Scanning DM sources...\n${progressBar(50)}\n\n` +
        `✅ Found ${allJids.length} DM contacts${warningNote}\n\n` +
        `📱 Loading Google Contacts...\n` +
        `(fetching full contact list — please wait)`;
      
      if (progressKey?.id) {
        progressKey = await updateProgress(progressKey, progressText);
      }

      const result = await buildContactsMapForOwner(ownerNumber);

      if (result.error || !result.map) {
        googleError = result.error || "Unknown Google API error";
      } else {
        googleMap = result.map;
        googleStats.accounts = result.accounts || [];

        // Build per-account summary
        const totalMain = googleStats.accounts.reduce((s, a) => s + (a.mainCount || 0), 0);
        const totalOther = googleStats.accounts.reduce((s, a) => s + (a.otherCount || 0), 0);
        googleStats.main = totalMain;
        googleStats.other = totalOther;
        googleStats.otherFailed = googleStats.accounts.some(a => a.otherFailed);

        // Update progress: Google Contacts loaded
        let accountsSummary = "";
        for (const a of googleStats.accounts) {
          if (a.error) {
            accountsSummary += `  ⚠️ ${a.email}: error\n`;
          } else {
            accountsSummary += `  📧 ${a.email}: ${(a.mainCount || 0) + (a.otherCount || 0)} contacts\n`;
          }
        }

        progressText = `🔍 Scanning DM sources...\n${progressBar(70)}\n\n` +
          `✅ Found ${allJids.length} DM contacts${warningNote}\n` +
          `✅ Google Contacts: ${googleMap.size} unique numbers\n` +
          accountsSummary +
          (googleStats.otherFailed ? `⚠️ Re-run .linkgoogle for full access\n` : "") +
          `\n🔍 Checking DMs against contacts...`;
        
        if (progressKey?.id) {
          progressKey = await updateProgress(progressKey, progressText);
        }
      }
    }

    if (!googleMap) {
      let errMsg = `❌ Cannot check Google Contacts: ${googleError}\n\n`;

      if (!isGoogleLinked(ownerNumber)) {
        errMsg += `📋 No Google accounts are linked to this bot.\n\n`;
        errMsg += `✅ Fix:\n`;
        errMsg += `1. Run: .linkgoogle\n`;
        errMsg += `2. Open the link → choose your Google account → allow all permissions\n`;
        errMsg += `3. Copy the CODE and run: .oauth CODE\n`;
        errMsg += `4. Repeat for each Gmail account you want the bot to check\n\n`;
        errMsg += `ℹ️ Without Google linked, every DM contact would appear unsaved.`;
      } else {
        errMsg += `📋 Google API returned an error.\n\n`;
        errMsg += `✅ Try:\n`;
        errMsg += `1. .linkgoogle (re-link to refresh the token)\n`;
        errMsg += `2. Wait a minute and retry .fetchchats\n`;
        errMsg += `3. .googleaccounts (to see all linked account statuses)`;
      }

      // Update progress message with error
      if (progressKey?.id) {
        await updateProgress(progressKey, errMsg);
      } else {
        await reply(errMsg);
      }
      return;
    }

    // ── Step 3: Classify each DM contact ─────────────────────────────────────
    const LIMIT = 50;
    const unsaved = [];
    let checkedCount = 0;
    let savedLocalCount = 0;   // saved by bot in its own DB
    let savedGoogleCount = 0;  // saved in Google Contacts
    let savedPhoneCount = 0;   // saved in phone address book (local/SIM, not in Google)

    for (const jid of allJids) {
      const digits = jidToPhoneDigits(jid);
      if (!digits || digits === ownerNumber) continue;
      checkedCount++;

      // Check 1: Already tracked by bot in local DB
      if (ownerBook[digits]) {
        savedLocalCount++;
        continue;
      }

      // Check 2: In Google Contacts — direct map lookup (no extra API call)
      const core = coreDigits(digits);
      if (core && core.length >= 7 && googleMap.has(core)) {
        savedGoogleCount++;
        continue;
      }

      // Check 3: Saved in phone address book
      // store.contacts.name is only non-null when the contact IS in the phone's address book
      // (even if it wasn't synced to Google). notify = WhatsApp push name (not a saved indicator).
      const storeContact = store?.contacts?.get?.(jid);
      if (storeContact?.name && String(storeContact.name).trim().length > 0) {
        savedPhoneCount++;
        continue;
      }

      // Genuinely not found anywhere — truly unsaved
      const profileName = storeContact?.notify || storeContact?.verifiedName || null;
      unsaved.push({ digits, jid, profileName: profileName ? String(profileName).trim() : null });

      if (unsaved.length >= LIMIT) break;
    }

    // Update progress to 100% before final results
    progressText = `🔍 Scanning DM sources...\n${progressBar(100)}\n\n` +
      `✅ Scan Complete!\n` +
      `• Saved by bot: ${savedLocalCount}\n` +
      `• Saved in Google: ${savedGoogleCount}\n` +
      `• Saved in phone: ${savedPhoneCount}\n` +
      `• Unsaved: ${unsaved.length}\n`;
    
    if (progressKey?.id) {
      await updateProgress(progressKey, progressText);
    }

    // Send final results as a separate message (Message 2)
    if (!unsaved.length) {
      let msg = `✅ All ${checkedCount} scanned DM contacts are already saved!\n\n`;
      msg += `📊 Breakdown:\n`;
      msg += `  • Saved by bot (local DB): ${savedLocalCount}\n`;
      msg += `  • Saved in Google Contacts: ${savedGoogleCount}\n`;
      msg += `  • Saved in phone address book: ${savedPhoneCount}\n`;
      msg += `  • Unsaved: 0\n\n`;
      msg += `Sources: store.contacts=${sources.storeContacts}, `;
      msg += `messages=${sources.storeMessages}, cache=${sources.cache}`;
      return reply(msg);
    }

    const SHOW = Math.min(unsaved.length, LIMIT);
    const lines = unsaved.slice(0, SHOW).map((c, i) => {
      const name = c.profileName || "(no profile name)";
      return `${String(i + 1).padStart(2, " ")}. +${c.digits}\n    📛 ${name}`;
    });

    let msg = `📋 Unsaved DM Contacts — ${SHOW} shown\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━━━\n`;
    msg += `Total DMs in store: ${allJids.length}\n`;
    msg += `Checked: ${checkedCount}`;
    msg += ` | Bot DB: ${savedLocalCount}`;
    msg += ` | Google: ${savedGoogleCount}`;
    msg += ` | Phone: ${savedPhoneCount}`;
    msg += ` | ❌ Unsaved: ${unsaved.length}${unsaved.length >= LIMIT ? "+" : ""}\n`;
    msg += `Google accounts checked: ${googleStats.accounts.length} (${googleMap.size} unique numbers)\n`;
    for (const a of googleStats.accounts) {
      if (a.error) msg += `  ⚠️ ${a.email}: error\n`;
      else msg += `  📧 ${a.email}: ${(a.mainCount || 0) + (a.otherCount || 0)} contacts\n`;
    }
    if (googleStats.otherFailed) {
      msg += `⚠️ Re-run .linkgoogle — "other contacts" scope missing on some accounts\n`;
    }
    msg += `━━━━━━━━━━━━━━━━━━━━━━\n\n`;
    msg += lines.join("\n\n");
    msg += `\n\n━━━━━━━━━━━━━━━━━━━━━━\n`;
    msg += `To save them:\n`;
    msg += `• .saveoldprofile — save with WhatsApp name\n`;
    msg += `• .saveold — save with generic name\n`;
    msg += `• .save +number Name — save one manually`;

    return reply(msg);
  },
};
