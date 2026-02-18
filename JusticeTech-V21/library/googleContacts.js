// library/googleContacts.js
// MULTI-ACCOUNT: Fetches contacts from ALL linked Google accounts and merges them.
// A number found in ANY linked account is treated as saved.

const { google } = require("googleapis");
const {
  getAuthedClientForUser,
  getAuthedClientsForUser,
  normalizeNumber,
} = require("./googleTenantAuth");

function makePerson(name, number) {
  const cleanName = String(name || "").trim();
  const cleanNum = normalizeNumber(number);
  return {
    names: [{ displayName: cleanName, givenName: cleanName }],
    phoneNumbers: [{ value: `+${cleanNum}` }],
  };
}

async function upsertContactForOwner({ ownerNumber, contactName, contactNumber, resourceName }) {
  const owner = normalizeNumber(ownerNumber);
  const num = normalizeNumber(contactNumber);
  if (!owner) throw new Error("Missing ownerNumber");
  if (!num) throw new Error("Invalid contact number");
  if (!contactName || String(contactName).trim().length < 2) throw new Error("Invalid contact name");

  // Always write to the primary (first) linked account
  const auth = getAuthedClientForUser(owner);
  if (!auth) throw new Error("No Google account linked for this bot owner.");

  const people = google.people({ version: "v1", auth });

  if (resourceName) {
    const got = await people.people.get({ resourceName, personFields: "names,phoneNumbers,metadata" });
    const etag = got.data?.etag || got.data?.metadata?.sources?.[0]?.etag;
    const updated = await people.people.updateContact({
      resourceName,
      updatePersonFields: "names,phoneNumbers",
      requestBody: { ...makePerson(contactName, num), etag },
    });
    return {
      resourceName: updated.data.resourceName,
      etag: updated.data.etag || null,
      mode: "updated",
    };
  }

  const created = await people.people.createContact({
    requestBody: makePerson(contactName, num),
  });
  return {
    resourceName: created.data.resourceName,
    etag: created.data.etag || null,
    mode: "created",
  };
}

// ── coreDigits: reduce any phone number to its last 9 digits for fuzzy matching ──
// This normalises local/international variants:
//   +2348051378960  →  051378960
//   08051378960     →  051378960
//   2348051378960   →  051378960
function coreDigits(raw) {
  const d = String(raw || "").replace(/[^0-9]/g, "").replace(/^0+/, "");
  return d.slice(-9);
}

// ── Per-owner merged contacts cache ──────────────────────────────────────────
// { [ownerNumber]: { map: Map<coreDigits, contactEntry>, builtAt, accounts: [...stats] } }
const _contactsCache = {};
const CACHE_TTL_MS = 5 * 60 * 1000;

// ── Fetch all contacts from ONE people client into a map ─────────────────────
async function _fetchContactsFromClient(people, accountEmail) {
  const map = new Map();
  let mainCount = 0;
  let otherCount = 0;
  let otherFailed = false;

  // Bucket 1: Main contacts
  try {
    let pageToken;
    do {
      const resp = await people.people.connections.list({
        resourceName: "people/me",
        personFields: "names,phoneNumbers",
        pageSize: 1000,
        ...(pageToken ? { pageToken } : {}),
      });
      for (const person of resp.data?.connections || []) {
        for (const p of person.phoneNumbers || []) {
          const key = coreDigits(p.value);
          if (key.length >= 7 && !map.has(key)) {
            map.set(key, {
              resourceName: person.resourceName,
              name: person.names?.[0]?.displayName || null,
              etag: person.etag || null,
              bucket: "contacts",
              account: accountEmail,
            });
          }
        }
        mainCount++;
      }
      pageToken = resp.data?.nextPageToken;
    } while (pageToken);
  } catch (e) {
    console.log(`[GOOGLE] connections.list failed for ${accountEmail}: ${e?.message}`);
  }

  // Bucket 2: Other contacts (auto-collected by Google/Android)
  try {
    let pageToken;
    do {
      const resp = await people.otherContacts.list({
        readMask: "names,phoneNumbers",
        pageSize: 1000,
        ...(pageToken ? { pageToken } : {}),
      });
      for (const person of resp.data?.otherContacts || []) {
        for (const p of person.phoneNumbers || []) {
          const key = coreDigits(p.value);
          if (key.length >= 7 && !map.has(key)) {
            map.set(key, {
              resourceName: person.resourceName,
              name: person.names?.[0]?.displayName || null,
              etag: person.etag || null,
              bucket: "otherContacts",
              account: accountEmail,
            });
          }
        }
        otherCount++;
      }
      pageToken = resp.data?.nextPageToken;
    } while (pageToken);
  } catch (e) {
    otherFailed = true;
    console.log(`[GOOGLE] otherContacts.list failed for ${accountEmail}: ${e?.message}`);
  }

  console.log(`[GOOGLE] ${accountEmail}: ${mainCount} contacts + ${otherCount} other → ${map.size} unique`);
  return { map, mainCount, otherCount, otherFailed };
}

// ── Build merged contacts map from ALL linked accounts ────────────────────────
async function getContactsMap(owner) {
  const now = Date.now();
  const cached = _contactsCache[owner];
  if (cached && now - cached.builtAt < CACHE_TTL_MS) {
    console.log(`[GOOGLE] Using cache for ${owner} (${cached.map.size} entries, ${cached.accounts.length} accounts)`);
    return cached;
  }

  const clientEntries = getAuthedClientsForUser(owner);
  if (!clientEntries.length) {
    console.log(`[GOOGLE] No linked accounts for ${owner}`);
    return null;
  }

  console.log(`[GOOGLE] Building merged map for ${owner} across ${clientEntries.length} account(s)...`);

  const mergedMap = new Map();
  const accountStats = [];

  for (const { email, client } of clientEntries) {
    try {
      const people = google.people({ version: "v1", auth: client });
      const result = await _fetchContactsFromClient(people, email);

      // Merge into main map — first account wins on conflicts
      for (const [key, entry] of result.map.entries()) {
        if (!mergedMap.has(key)) mergedMap.set(key, entry);
      }

      accountStats.push({
        email,
        mainCount: result.mainCount,
        otherCount: result.otherCount,
        otherFailed: result.otherFailed,
        uniqueKeys: result.map.size,
      });
    } catch (e) {
      console.log(`[GOOGLE] Error fetching contacts for ${email}: ${e?.message}`);
      accountStats.push({ email, error: e?.message });
    }
  }

  console.log(`[GOOGLE] Merged map: ${mergedMap.size} unique numbers across ${accountStats.length} accounts`);

  if (mergedMap.size > 0 || accountStats.length > 0) {
    _contactsCache[owner] = {
      map: mergedMap,
      builtAt: now,
      accounts: accountStats,
    };
  }

  return _contactsCache[owner] || null;
}

// ── Invalidate cache ──────────────────────────────────────────────────────────
function invalidateContactsCache(ownerNumber) {
  const owner = normalizeNumber(ownerNumber);
  if (owner && _contactsCache[owner]) {
    delete _contactsCache[owner];
    console.log(`[GOOGLE] Cache invalidated for ${owner}`);
  }
}

// ── isGoogleLinked: true if at least one account is linked ───────────────────
function isGoogleLinked(ownerNumber) {
  const owner = normalizeNumber(ownerNumber);
  if (!owner) return false;
  const clients = getAuthedClientsForUser(owner);
  return clients.length > 0;
}

// ── buildContactsMapForOwner: public entry point for fetchchats ───────────────
async function buildContactsMapForOwner(ownerNumber) {
  const owner = normalizeNumber(ownerNumber);
  if (!owner) return { map: null, error: "Invalid owner number" };

  if (!isGoogleLinked(owner)) {
    return { map: null, error: "No Google account linked — run .linkgoogle first" };
  }

  try {
    const result = await getContactsMap(owner);
    if (!result) return { map: null, error: "Could not build contacts map" };

    return {
      map: result.map,
      accounts: result.accounts,
      error: null,
    };
  } catch (e) {
    return { map: null, error: e?.message || "Unknown error fetching contacts" };
  }
}

// ── searchContactByPhone: backward-compat single lookup ──────────────────────
async function searchContactByPhone(ownerNumber, phoneNumber) {
  const owner = normalizeNumber(ownerNumber);
  const num = normalizeNumber(phoneNumber);
  if (!owner || !num) return null;

  const result = await buildContactsMapForOwner(owner);
  if (!result.map) return null;

  const numCore = coreDigits(num);
  if (!numCore || numCore.length < 7) return null;

  return result.map.get(numCore) || null;
}

async function deleteContactForOwner({ ownerNumber, resourceName }) {
  const owner = normalizeNumber(ownerNumber);
  if (!owner) throw new Error("Missing ownerNumber");
  if (!resourceName) throw new Error("Missing resourceName");

  const auth = getAuthedClientForUser(owner);
  if (!auth) throw new Error("No Google account linked for this bot owner.");

  const people = google.people({ version: "v1", auth });
  await people.people.deleteContact({ resourceName });
  return true;
}

module.exports = {
  upsertContactForOwner,
  deleteContactForOwner,
  searchContactByPhone,
  invalidateContactsCache,
  isGoogleLinked,
  buildContactsMapForOwner,
  coreDigits,
};
