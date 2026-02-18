// library/referralDb.js — JusticeTech Autosave Bot v1.1.1 JT
// ─────────────────────────────────────────────────────────────────────────────
// Persistent referral database.
// Schema:
//   referrals.json: {
//     users: {
//       "<phone>": {
//         phone, name, email,
//         referralCode,            // unique code e.g. "JT-ABC123"
//         referralLink,            // "https://wa.me/2349032578690?text=ref-JT-ABC123"
//         referredBy: null | code, // code of who invited this user
//         registeredAt,
//         successfulReferrals: [phone, ...],  // who they referred AND subscribed
//         pendingReferrals: [phone, ...],     // who they referred but not yet subscribed
//         rewardClaimed: 0,                   // how many 30-day rewards given so far
//       }
//     }
//   }
// ─────────────────────────────────────────────────────────────────────────────

"use strict";

const fs   = require("fs");
const path = require("path");

const DB_DIR  = path.join(__dirname, "..", "database");
const REF_FILE = path.join(DB_DIR, "referrals.json");

const REFERRALS_NEEDED = 5;   // successful referrals to earn reward
const REWARD_DAYS      = 30;  // days added per milestone

// ── Helpers ───────────────────────────────────────────────────────────────────

function ensureDb() {
  if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });
  if (!fs.existsSync(REF_FILE)) fs.writeFileSync(REF_FILE, JSON.stringify({ users: {} }, null, 2));
}

function readDb() {
  ensureDb();
  try {
    const raw = JSON.parse(fs.readFileSync(REF_FILE, "utf8"));
    if (!raw.users || typeof raw.users !== "object") raw.users = {};
    return raw;
  } catch {
    return { users: {} };
  }
}

function writeDb(db) {
  ensureDb();
  fs.writeFileSync(REF_FILE, JSON.stringify(db, null, 2));
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

function generateCode(phone) {
  const part1 = phone.slice(-4);
  const part2 = Math.random().toString(36).slice(2, 5).toUpperCase();
  return `JT-${part2}${part1}`;
}

// ── Public API ────────────────────────────────────────────────────────────────

function getUser(phone) {
  const p  = normalizeNumber(phone);
  if (!p) return null;
  const db = readDb();
  return db.users[p] || null;
}

function getUserByCode(code) {
  const c  = String(code || "").toUpperCase().trim();
  if (!c) return null;
  const db = readDb();
  const entry = Object.values(db.users).find(u => u.referralCode === c);
  return entry || null;
}

function registerUser({ phone, name, email, referredByCode, devJid }) {
  const p = normalizeNumber(phone);
  if (!p) throw new Error("Invalid phone number");

  const db = readDb();

  // Check if already registered
  if (db.users[p]) {
    return { existing: true, user: db.users[p] };
  }

  // Validate referrer if provided
  let referredBy = null;
  if (referredByCode) {
    const referrer = getUserByCode(referredByCode);
    if (referrer) referredBy = referredByCode;
  }

  const code = generateCode(p);
  const link = `https://wa.me/${devJid || "2349032578690"}?text=ref-${code}`;

  const user = {
    phone:               p,
    name:                String(name || "").trim(),
    email:               String(email || "").toLowerCase().trim(),
    referralCode:        code,
    referralLink:        link,
    referredBy,
    registeredAt:        new Date().toISOString(),
    successfulReferrals: [],
    pendingReferrals:    [],
    rewardClaimed:       0,
  };

  db.users[p] = user;
  writeDb(db);

  // Add this user to referrer's pending list
  if (referredBy) {
    const referrer = Object.values(db.users).find(u => u.referralCode === referredBy);
    if (referrer && !referrer.pendingReferrals.includes(p)) {
      referrer.pendingReferrals.push(p);
      db.users[referrer.phone] = referrer;
      writeDb(db);
    }
  }

  return { existing: false, user };
}

// Called when a user subscribes — find their referrer and credit them
// Returns: { referrer, rewardEarned } or null
function onSubscribed(phone) {
  const p  = normalizeNumber(phone);
  if (!p) return null;

  const db   = readDb();
  const user = db.users[p];
  if (!user) return null;

  const referredByCode = user.referredBy;
  if (!referredByCode) return null;

  // Find the referrer
  const referrer = Object.values(db.users).find(u => u.referralCode === referredByCode);
  if (!referrer) return null;

  const refPhone = referrer.phone;

  // Move from pending → successful if not already
  if (!referrer.successfulReferrals.includes(p)) {
    referrer.successfulReferrals.push(p);
    referrer.pendingReferrals = referrer.pendingReferrals.filter(r => r !== p);

    db.users[refPhone] = referrer;
    writeDb(db);

    // Check if milestone reached
    const successCount = referrer.successfulReferrals.length;
    const prevClaimed  = referrer.rewardClaimed || 0;
    const newMilestones = Math.floor(successCount / REFERRALS_NEEDED) - prevClaimed;

    let rewardEarned = false;
    if (newMilestones > 0) {
      referrer.rewardClaimed = prevClaimed + newMilestones;
      db.users[refPhone] = referrer;
      writeDb(db);
      rewardEarned = true;
    }

    return {
      referrer,
      subscriberName: user.name || phone,
      successCount,
      rewardEarned,
      rewardDays: newMilestones * REWARD_DAYS,
      milestonesEarned: newMilestones,
    };
  }

  return null;
}

function getAllUsers() {
  return Object.values(readDb().users);
}

function getLeaderboard() {
  return getAllUsers()
    .filter(u => u.successfulReferrals.length > 0 || u.pendingReferrals.length > 0)
    .sort((a, b) => b.successfulReferrals.length - a.successfulReferrals.length);
}

module.exports = {
  normalizeNumber,
  getUser,
  getUserByCode,
  registerUser,
  onSubscribed,
  getAllUsers,
  getLeaderboard,
  REFERRALS_NEEDED,
  REWARD_DAYS,
};
