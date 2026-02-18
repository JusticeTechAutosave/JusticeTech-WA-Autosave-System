// library/ownerRegistryDb.js — JusticeTech Autosave Bot v1.1.1 JT
// ─────────────────────────────────────────────────────────────────────────────
// CENTRAL OWNER REGISTRY — lives on the dev's bot.
//
// Written every time the dev approves a subscription (.approvepay / .givesub).
// This is the ONLY reliable cross-instance source of truth about who has been
// approved, since each owner runs their own bot instance with their own database/.
//
// File: database/approved_owners.json
// Structure:
// {
//   "owners": {
//     "2348012345678": {
//       "number":     "2348012345678",
//       "plan":       "monthly",
//       "ref":        "JT-XXXX-YYYY",
//       "approvedAt": "2025-01-01T00:00:00.000Z",
//       "approvedAtMs": 1234567890000,
//       "approvedBy": "2349032578690",
//       "expiresAtMs": 1234567890000,
//       "expiresAt":  "2025-02-01T00:00:00.000Z"
//     }
//   }
// }
// ─────────────────────────────────────────────────────────────────────────────

"use strict";

const fs   = require("fs");
const path = require("path");

const DB_DIR        = path.join(__dirname, "..", "database");
const REGISTRY_FILE = path.join(DB_DIR, "approved_owners.json");

function ensureDir() {
  if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });
}

function readRegistry() {
  try {
    ensureDir();
    if (!fs.existsSync(REGISTRY_FILE)) return { owners: {} };
    const data = JSON.parse(fs.readFileSync(REGISTRY_FILE, "utf8"));
    if (!data.owners || typeof data.owners !== "object") data.owners = {};
    return data;
  } catch {
    return { owners: {} };
  }
}

function writeRegistry(data) {
  try {
    ensureDir();
    if (!data.owners) data.owners = {};
    fs.writeFileSync(REGISTRY_FILE, JSON.stringify(data, null, 2));
  } catch (e) {
    console.error("[ownerRegistry] write error:", e && e.message);
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

// Register or update an owner after approval/givesub
function registerOwner(userNum, planKey, ref, approvedBy, expiresAtMs) {
  const u = normalizeNumber(userNum);
  if (!u) return;
  const data = readRegistry();
  const existing = data.owners[u] || {};
  data.owners[u] = {
    ...existing,
    number:      u,
    plan:        String(planKey || "unknown"),
    ref:         String(ref || ""),
    approvedAt:  new Date().toISOString(),
    approvedAtMs: Date.now(),
    approvedBy:  normalizeNumber(approvedBy) || String(approvedBy || ""),
    expiresAtMs: Number(expiresAtMs || 0),
    expiresAt:   expiresAtMs ? new Date(Number(expiresAtMs)).toISOString() : "",
  };
  writeRegistry(data);
}

// Get all registered owner numbers (as plain digit strings)
function getAllRegisteredNumbers() {
  const data = readRegistry();
  return Object.keys(data.owners || {});
}

// Get a specific owner's registry entry
function getRegisteredOwner(userNum) {
  const u = normalizeNumber(userNum);
  if (!u) return null;
  const data = readRegistry();
  return data.owners[u] || null;
}

// Remove an owner from the registry
function removeOwner(userNum) {
  const u = normalizeNumber(userNum);
  if (!u) return false;
  const data = readRegistry();
  if (!data.owners[u]) return false;
  delete data.owners[u];
  writeRegistry(data);
  return true;
}

module.exports = {
  registerOwner,
  getAllRegisteredNumbers,
  getRegisteredOwner,
  removeOwner,
  REGISTRY_FILE,
};
