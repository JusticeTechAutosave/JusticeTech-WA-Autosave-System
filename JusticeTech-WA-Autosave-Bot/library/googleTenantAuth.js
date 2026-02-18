// library/googleTenantAuth.js
// MULTI-ACCOUNT: Each bot owner can link multiple Google accounts.
// Token storage format:
//   { users: { "ownerNumber": { accounts: [ { email, access_token, refresh_token, linkedAt }, ... ] } } }
// Old single-token format is auto-migrated on first read.

const fs = require("fs");
const path = require("path");
const os = require("os");
const axios = require("axios");
const { google } = require("googleapis");

const DATA_DIR = path.join(__dirname, "..", "data");
const TOKENS_FILE = path.join(DATA_DIR, "google_tokens.json");
const OAUTH_CFG = path.join(DATA_DIR, "google_oauth.json");

// ── Persistent backup stored OUTSIDE the project dir (survives bot updates) ──
// Lives in the user's home directory so it's never overwritten when you
// drop a new bot zip into the project folder.
const HOME_BACKUP_FILE = path.join(os.homedir(), "JusticeTech_Autosave_Backup.json");

function writeTokensWithBackup(data) {
  const json = JSON.stringify(data, null, 2);
  fs.writeFileSync(TOKENS_FILE, json);
  // Mirror to home-dir backup every time tokens change
  try { fs.writeFileSync(HOME_BACKUP_FILE, json); } catch {}
}

function ensure() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

  // ── Auto-restore: if token file is missing/empty, try home-dir backup ──────
  const tokensMissing = !fs.existsSync(TOKENS_FILE) ||
    fs.readFileSync(TOKENS_FILE, "utf8").trim() === "" ||
    fs.readFileSync(TOKENS_FILE, "utf8").trim() === JSON.stringify({ users: {} }, null, 2);
  
  if (tokensMissing && fs.existsSync(HOME_BACKUP_FILE)) {
    try {
      const backup = fs.readFileSync(HOME_BACKUP_FILE, "utf8");
      const parsed = JSON.parse(backup);
      // Only restore if backup actually has user data
      if (parsed?.users && Object.keys(parsed.users).length > 0) {
        fs.writeFileSync(TOKENS_FILE, backup);
        console.log("[GoogleAuth] ✅ Auto-restored Google tokens from home backup.");
      }
    } catch (e) {
      console.warn("[GoogleAuth] ⚠️ Could not auto-restore backup:", e.message);
    }
  }

  if (!fs.existsSync(TOKENS_FILE)) {
    fs.writeFileSync(TOKENS_FILE, JSON.stringify({ users: {} }, null, 2));
  }
  if (!fs.existsSync(OAUTH_CFG)) {
    fs.writeFileSync(OAUTH_CFG, JSON.stringify({
      client_id: "",
      client_secret: "",
      redirect_uri: "https://developers.google.com/oauthplayground",
    }, null, 2));
  }
}

function readJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { return fallback; }
}

function writeJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function normalizeNumber(input) {
  if (!input) return "";
  let s = String(input).trim();
  if (s.includes("@")) s = s.split("@")[0];
  if (s.includes(":")) s = s.split(":")[0];
  s = s.replace(/\D/g, "");
  if (s.length < 8 || s.length > 15) return "";
  return s;
}

function getOAuthConfig() {
  ensure();
  const cfg = readJSON(OAUTH_CFG, null);
  if (!cfg?.client_id || !cfg?.client_secret || !cfg?.redirect_uri) {
    throw new Error("Google OAuth not configured. Missing data/google_oauth.json.");
  }
  return cfg;
}

// ── Internal: read raw user entry, auto-migrate old single-token format ──────
function _readUserEntry(db, owner) {
  const raw = db.users?.[owner];
  if (!raw) return { accounts: [] };

  // Old format: { access_token, refresh_token, savedAt, ... }
  if (raw.access_token || raw.refresh_token) {
    return {
      accounts: [{
        email: raw.email || "unknown (legacy)",
        access_token: raw.access_token,
        refresh_token: raw.refresh_token,
        expiry_date: raw.expiry_date || null,
        token_type: raw.token_type || "Bearer",
        scope: raw.scope || null,
        linkedAt: raw.savedAt || Date.now(),
      }]
    };
  }

  // New format: { accounts: [...] }
  if (Array.isArray(raw.accounts)) return raw;

  return { accounts: [] };
}

// ── Get all linked accounts for an owner ─────────────────────────────────────
function getUserAccounts(ownerNumber) {
  ensure();
  const owner = normalizeNumber(ownerNumber);
  if (!owner) return [];
  const db = readJSON(TOKENS_FILE, { users: {} });
  return _readUserEntry(db, owner).accounts || [];
}

// ── Save (add or update) one Google account for an owner ─────────────────────
// If an account with the same email exists, it's updated. Otherwise appended.
function saveUserAccount(ownerNumber, tokens, email) {
  ensure();
  const owner = normalizeNumber(ownerNumber);
  if (!owner) throw new Error("Invalid owner number");

  const db = readJSON(TOKENS_FILE, { users: {} });
  if (!db.users) db.users = {};

  const entry = _readUserEntry(db, owner);
  const accounts = entry.accounts || [];

  const accountEmail = String(email || "unknown").trim().toLowerCase();
  const existing = accounts.findIndex(a =>
    String(a.email || "").toLowerCase() === accountEmail
  );

  const accountObj = {
    email: accountEmail,
    access_token: tokens.access_token || null,
    refresh_token: tokens.refresh_token || null,
    expiry_date: tokens.expiry_date || null,
    token_type: tokens.token_type || "Bearer",
    scope: tokens.scope || null,
    linkedAt: existing >= 0 ? accounts[existing].linkedAt : Date.now(),
    updatedAt: Date.now(),
  };

  if (existing >= 0) {
    // Preserve existing refresh_token if new one not issued
    if (!tokens.refresh_token && accounts[existing].refresh_token) {
      accountObj.refresh_token = accounts[existing].refresh_token;
    }
    accounts[existing] = accountObj;
  } else {
    accounts.push(accountObj);
  }

  db.users[owner] = { accounts };
  writeTokensWithBackup(db);
  return true;
}

// ── Remove one account by email ───────────────────────────────────────────────
function removeUserAccount(ownerNumber, email) {
  ensure();
  const owner = normalizeNumber(ownerNumber);
  if (!owner) throw new Error("Invalid owner number");

  const db = readJSON(TOKENS_FILE, { users: {} });
  if (!db.users) return false;

  const entry = _readUserEntry(db, owner);
  const before = entry.accounts.length;
  entry.accounts = entry.accounts.filter(a =>
    String(a.email || "").toLowerCase() !== String(email || "").trim().toLowerCase()
  );

  if (entry.accounts.length === before) return false; // nothing removed

  db.users[owner] = entry;
  writeTokensWithBackup(db);
  return true;
}

// ── Backward-compat: getUserTokens = first account's tokens ──────────────────
function getUserTokens(ownerNumber) {
  const accounts = getUserAccounts(ownerNumber);
  if (!accounts.length) return null;
  const a = accounts[0];
  return {
    access_token: a.access_token,
    refresh_token: a.refresh_token,
    expiry_date: a.expiry_date,
    token_type: a.token_type,
    scope: a.scope,
  };
}

// ── Backward-compat: saveUserTokens = saves/updates "unknown" legacy slot ────
function saveUserTokens(ownerNumber, tokens, email) {
  return saveUserAccount(ownerNumber, tokens, email || "unknown");
}

// ── Build OAuth2 client for a single account entry ───────────────────────────
function _buildClient(owner, accountObj) {
  const cfg = getOAuthConfig();
  const oauth2 = new google.auth.OAuth2(cfg.client_id, cfg.client_secret, cfg.redirect_uri);
  oauth2.setCredentials({
    access_token: accountObj.access_token,
    refresh_token: accountObj.refresh_token,
    expiry_date: accountObj.expiry_date,
    token_type: accountObj.token_type || "Bearer",
  });

  // Auto-save refreshed tokens back to the right account slot
  oauth2.on("tokens", (newTokens) => {
    try {
      if (!newTokens) return;
      const merged = {
        ...accountObj,
        ...newTokens,
      };
      if (!newTokens.refresh_token && accountObj.refresh_token) {
        merged.refresh_token = accountObj.refresh_token;
      }
      saveUserAccount(owner, merged, accountObj.email);
    } catch {}
  });

  return oauth2;
}

// ── Get ONE auth client (primary account, backward compat) ───────────────────
function getAuthedClientForUser(ownerNumber) {
  const owner = normalizeNumber(ownerNumber);
  if (!owner) return null;
  const accounts = getUserAccounts(owner);
  if (!accounts.length) return null;
  return _buildClient(owner, accounts[0]);
}

// ── Get ALL auth clients (one per linked account) ────────────────────────────
function getAuthedClientsForUser(ownerNumber) {
  const owner = normalizeNumber(ownerNumber);
  if (!owner) return [];
  const accounts = getUserAccounts(owner);
  return accounts
    .filter(a => a.access_token || a.refresh_token)
    .map(a => ({
      email: a.email,
      client: _buildClient(owner, a),
    }));
}

// ── Make OAuth URL ────────────────────────────────────────────────────────────
function makeAuthUrl(ownerNumber) {
  const cfg = getOAuthConfig();
  const owner = normalizeNumber(ownerNumber);
  if (!owner) throw new Error("Invalid owner number");

  const scopes = [
    "https://www.googleapis.com/auth/contacts",
    "https://www.googleapis.com/auth/contacts.other.readonly",
    "https://www.googleapis.com/auth/userinfo.email", // so we can detect which email was linked
  ];

  const oauth2 = new google.auth.OAuth2(cfg.client_id, cfg.client_secret, cfg.redirect_uri);
  return oauth2.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: scopes,
    state: owner,
    include_granted_scopes: true,
  });
}

// ── Exchange code for tokens ──────────────────────────────────────────────────
async function exchangeCodeForTokens(code) {
  const cfg = getOAuthConfig();
  const payload = new URLSearchParams({
    code: String(code || "").trim(),
    client_id: cfg.client_id,
    client_secret: cfg.client_secret,
    redirect_uri: cfg.redirect_uri,
    grant_type: "authorization_code",
  });

  const res = await axios.post("https://oauth2.googleapis.com/token", payload.toString(), {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    timeout: 30000,
  });

  return res.data;
}

// ── Fetch the Google account email using an access token ─────────────────────
async function fetchGoogleEmail(accessToken) {
  try {
    const res = await axios.get("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${accessToken}` },
      timeout: 10000,
    });
    return res.data?.email || null;
  } catch {
    return null;
  }
}

module.exports = {
  TOKENS_FILE,
  OAUTH_CFG,
  HOME_BACKUP_FILE,

  normalizeNumber,
  getOAuthConfig,

  // Multi-account API
  getUserAccounts,
  saveUserAccount,
  removeUserAccount,
  getAuthedClientsForUser,
  fetchGoogleEmail,

  // Backward-compat API (single account)
  getUserTokens,
  saveUserTokens,
  getAuthedClientForUser,

  // Auth URL + token exchange
  makeAuthUrl,
  exchangeCodeForTokens,
};
