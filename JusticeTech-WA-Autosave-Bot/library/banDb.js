// library/banDb.js — JusticeTech Autosave Bot v1.1.1 JT
// ─────────────────────────────────────────────────────────────────────────────
// Stores banned/suspended users.
// File: database/ban_list.json
// {
//   "users": {
//     "2348012345678": {
//       "number": "2348012345678",
//       "reason": "spam",
//       "bannedAt": "ISO",
//       "bannedBy": "2349032578690",
//       "type": "ban"     // "ban" | "suspend"
//     }
//   }
// }
// ─────────────────────────────────────────────────────────────────────────────

"use strict";

const fs   = require("fs");
const path = require("path");

const DB_DIR   = path.join(__dirname, "..", "database");
const BAN_FILE = path.join(DB_DIR, "ban_list.json");

function ensureDir() {
  if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });
}

function readBanDb() {
  try {
    ensureDir();
    if (!fs.existsSync(BAN_FILE)) return { users: {} };
    const d = JSON.parse(fs.readFileSync(BAN_FILE, "utf8"));
    if (!d.users || typeof d.users !== "object") d.users = {};
    return d;
  } catch { return { users: {} }; }
}

function writeBanDb(data) {
  try {
    ensureDir();
    fs.writeFileSync(BAN_FILE, JSON.stringify(data, null, 2));
  } catch (e) {
    console.error("[banDb] write error:", e && e.message);
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

// Ban or suspend a user
function banUser(userNum, reason, bannedBy, type = "ban") {
  const u = normalizeNumber(userNum);
  if (!u) return false;
  const db = readBanDb();
  db.users[u] = {
    number:   u,
    reason:   String(reason || "No reason given"),
    bannedAt: new Date().toISOString(),
    bannedBy: normalizeNumber(bannedBy) || String(bannedBy || ""),
    type:     type === "suspend" ? "suspend" : "ban",
  };
  writeBanDb(db);
  return true;
}

// Remove a ban/suspension
function unbanUser(userNum) {
  const u = normalizeNumber(userNum);
  if (!u) return false;
  const db = readBanDb();
  if (!db.users[u]) return false;
  delete db.users[u];
  writeBanDb(db);
  return true;
}

// Check if a user is banned or suspended
function getBanEntry(userNum) {
  const u = normalizeNumber(userNum);
  if (!u) return null;
  return readBanDb().users[u] || null;
}

function isBanned(userNum) {
  return !!getBanEntry(userNum);
}

// Get all banned users
function getAllBanned() {
  return Object.values(readBanDb().users || {});
}

module.exports = {
  banUser,
  unbanUser,
  getBanEntry,
  isBanned,
  getAllBanned,
  BAN_FILE,
};
