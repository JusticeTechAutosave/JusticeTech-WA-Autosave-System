// library/subscriptionDb.js
// ─────────────────────────────────────────────────────────────────────────────
// Persistent subscription DB — Pterodactyl-safe
// Files live in database/ which persists across restarts on Pterodactyl.
// In-memory cache (global) ensures reads are instant within a session.
// ─────────────────────────────────────────────────────────────────────────────
"use strict";

const fs   = require("fs");
const path = require("path");

const DB_DIR       = path.join(__dirname, "..", "database");
const SUB_FILE     = path.join(DB_DIR, "subscription.json");
const PENDING_FILE = path.join(DB_DIR, "subscription_pending.json");

// In-memory cache on global — survives require() cache busting (rplug)
global.__JT_SUB_CACHE     = global.__JT_SUB_CACHE     || null;
global.__JT_PENDING_CACHE = global.__JT_PENDING_CACHE || null;

// ─── Helpers ──────────────────────────────────────────────────────────────────
function ensureDir() {
  if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });
}

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}

function writeJsonSafe(file, data) {
  try {
    ensureDir();
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
  } catch (e) {
    console.error("[subDb] write error:", file, e && e.message);
  }
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

function nowMs() { return Date.now(); }

function toIso(ms) {
  try { return new Date(ms).toISOString(); } catch { return ""; }
}

// ─── Subscription reads/writes ────────────────────────────────────────────────
function readSubDb() {
  if (global.__JT_SUB_CACHE) return global.__JT_SUB_CACHE;
  ensureDir();
  if (!fs.existsSync(SUB_FILE)) writeJsonSafe(SUB_FILE, { users: {} });
  const db = readJson(SUB_FILE, { users: {} });
  if (!db.users || typeof db.users !== "object") db.users = {};
  global.__JT_SUB_CACHE = db;
  return db;
}

function writeSubDb(db) {
  if (!db.users) db.users = {};
  global.__JT_SUB_CACHE = db;
  writeJsonSafe(SUB_FILE, db);
}

function getSub(user) {
  const u = normalizeNumber(user);
  if (!u) return null;
  return readSubDb().users[u] || null;
}

function isActive(sub) {
  if (!sub) return false;
  return Number(sub.expiresAtMs || 0) > nowMs();
}

function setSub(user, patch) {
  const u = normalizeNumber(user);
  if (!u) throw new Error("Invalid user number: " + user);
  const db = readSubDb();
  db.users[u] = {
    ...(db.users[u] || {}),
    ...patch,
    updatedAtMs: nowMs(),
    updatedAt:   toIso(nowMs()),
  };
  writeSubDb(db);
  return db.users[u];
}

function activateSub(user, planKey, days, ref, approvedBy) {
  const u = normalizeNumber(user);
  if (!u) throw new Error("Invalid user: " + user);
  const d = Number(days || 0);
  if (!Number.isFinite(d) || d <= 0) throw new Error("Invalid days: " + days);
  const expiresAtMs = nowMs() + d * 24 * 60 * 60 * 1000;
  return setSub(u, {
    plan:        String(planKey || "unknown"),
    planType:    "paid",
    ref:         String(ref || ""),
    approvedBy:  normalizeNumber(approvedBy) || String(approvedBy || ""),
    startedAtMs: nowMs(),
    startedAt:   toIso(nowMs()),
    expiresAtMs,
    expiresAt:   toIso(expiresAtMs),
  });
}

function activateTrialHours(user, hours, ref, grantedBy) {
  const u = normalizeNumber(user);
  if (!u) throw new Error("Invalid user: " + user);
  const h = Number(hours || 0);
  if (!Number.isFinite(h) || h <= 0) throw new Error("Invalid hours: " + hours);
  const expiresAtMs = nowMs() + h * 60 * 60 * 1000;
  return setSub(u, {
    plan:        "trial_" + Math.floor(h) + "h",
    planType:    "trial",
    ref:         String(ref || ""),
    grantedBy:   normalizeNumber(grantedBy) || String(grantedBy || ""),
    startedAtMs: nowMs(),
    startedAt:   toIso(nowMs()),
    expiresAtMs,
    expiresAt:   toIso(expiresAtMs),
  });
}

// ─── Pending DB ───────────────────────────────────────────────────────────────
function readPendingDb() {
  if (global.__JT_PENDING_CACHE) return global.__JT_PENDING_CACHE;
  ensureDir();
  if (!fs.existsSync(PENDING_FILE)) writeJsonSafe(PENDING_FILE, { pending: {} });
  const db = readJson(PENDING_FILE, { pending: {} });
  if (!db.pending || typeof db.pending !== "object") db.pending = {};
  global.__JT_PENDING_CACHE = db;
  return db;
}

function writePendingDb(db) {
  if (!db.pending) db.pending = {};
  global.__JT_PENDING_CACHE = db;
  writeJsonSafe(PENDING_FILE, db);
}

function createPending(user, planKey, amount, ref) {
  const u = normalizeNumber(user);
  if (!u) throw new Error("Invalid user: " + user);
  const r = String(ref || "").trim();
  if (!r) throw new Error("Missing ref");
  const db = readPendingDb();
  db.pending[r] = {
    ref:         r,
    jid:         u + "@s.whatsapp.net",
    user:        u,
    plan:        String(planKey || ""),
    amount:      Number(amount || 0),
    status:      "pending",
    createdAtMs: nowMs(),
    createdAt:   toIso(nowMs()),
    note:        "",
  };
  writePendingDb(db);
  return db.pending[r];
}

function getPending(ref) {
  const r = String(ref || "").trim().toUpperCase();
  if (!r) return null;
  // Check both exact case and uppercase
  const db = readPendingDb();
  return db.pending[r] || db.pending[r.toLowerCase()] || null;
}

function setPendingStatus(ref, status, note) {
  const r = String(ref || "").trim().toUpperCase();
  if (!r) throw new Error("Missing ref");
  const db = readPendingDb();
  // Find the actual key (could be uppercase or original)
  const actualKey = db.pending[r] ? r : Object.keys(db.pending).find(k => k.toUpperCase() === r);
  if (!actualKey || !db.pending[actualKey]) throw new Error("Reference not found: " + r);
  db.pending[actualKey] = {
    ...db.pending[actualKey],
    status:      String(status || "pending"),
    note:        String(note || ""),
    updatedAtMs: nowMs(),
    updatedAt:   toIso(nowMs()),
  };
  writePendingDb(db);
  return db.pending[actualKey];
}

// Invalidate in-memory cache so next read re-loads from disk
// Useful after external writes (e.g. self-activation from approval message)
function invalidateCache() {
  global.__JT_SUB_CACHE     = null;
  global.__JT_PENDING_CACHE = null;
}

// ─── Find a subscription record by its ref (searches subscription.json) ───────
// Handles givesub refs that never go through the pending DB
function getSubByRef(ref) {
  const r = String(ref || "").trim().toUpperCase();
  if (!r) return null;
  const db = readSubDb();
  for (const [user, sub] of Object.entries(db.users || {})) {
    if (sub && String(sub.ref || "").toUpperCase() === r) {
      return { user, sub };
    }
  }
  return null;
}

// ─── Mark a ref as used (so it can only be used once for restore) ─────────────
function markRefUsed(ref, usedBy) {
  const r = String(ref || "").trim().toUpperCase();
  if (!r) return;
  // Try pending DB first
  try {
    const db = readPendingDb();
    const actualKey = db.pending[r] ? r : Object.keys(db.pending).find(k => k.toUpperCase() === r);
    if (actualKey) {
      db.pending[actualKey] = {
        ...db.pending[actualKey],
        usedAt:   toIso(nowMs()),
        usedAtMs: nowMs(),
        usedBy:   String(usedBy || ""),
      };
      writePendingDb(db);
    }
  } catch {}
  // Also mark in subscription DB on the sub record itself
  try {
    const match = getSubByRef(r);
    if (match) {
      const db = readSubDb();
      if (db.users[match.user]) {
        db.users[match.user].refUsedAt  = toIso(nowMs());
        db.users[match.user].refUsedBy  = String(usedBy || "");
        writeSubDb(db);
      }
    }
  } catch {}
}

module.exports = {
  normalizeNumber,
  getSub,
  setSub,
  isActive,
  activateSub,
  activateTrialHours,
  createPending,
  getPending,
  setPendingStatus,
  invalidateCache,
  getSubByRef,
  markRefUsed,
  SUB_FILE,
  PENDING_FILE,
};
