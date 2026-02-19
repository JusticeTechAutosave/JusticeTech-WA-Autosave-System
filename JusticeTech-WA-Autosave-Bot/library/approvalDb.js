// library/approvalDb.js
// Option C helper: stores approved numbers, but ALWAYS includes DEV numbers.

const fs = require("fs");
const path = require("path");

const DEV_NUMBERS = ["2349032578690", "2348166337692"];

const DB_DIR = path.join(__dirname, "..", "database");
const FILE = path.join(DB_DIR, "approved.json");

function normalizeDigits(x) {
  return String(x || "").replace(/\D/g, "");
}

function ensure() {
  if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });
  if (!fs.existsSync(FILE)) fs.writeFileSync(FILE, JSON.stringify({ numbers: [] }, null, 2));

  // merge devs once (idempotent)
  const db = readRawNoEnsure();
  const set = new Set((db.numbers || []).map(normalizeDigits).filter(Boolean));
  for (const d of DEV_NUMBERS) set.add(normalizeDigits(d));
  writeRawNoEnsure({ numbers: Array.from(set) });
}

function readRawNoEnsure() {
  try {
    const raw = fs.readFileSync(FILE, "utf8");
    const db = JSON.parse(raw);
    if (!db || typeof db !== "object") return { numbers: [] };
    if (!Array.isArray(db.numbers)) db.numbers = [];
    return db;
  } catch {
    return { numbers: [] };
  }
}

function writeRawNoEnsure(db) {
  try {
    fs.writeFileSync(FILE, JSON.stringify(db, null, 2));
  } catch {}
}

function read() {
  ensure();
  return readRawNoEnsure();
}

function write(db) {
  ensure();
  writeRawNoEnsure(db);
}

function isApproved(numberDigits) {
  const n = normalizeDigits(numberDigits);
  if (!n) return false;
  const db = read();
  return (db.numbers || []).map(normalizeDigits).includes(n);
}

function approve(numberDigits) {
  const n = normalizeDigits(numberDigits);
  if (!n) return false;

  const db = read();
  const set = new Set((db.numbers || []).map(normalizeDigits).filter(Boolean));
  set.add(n);

  db.numbers = Array.from(set);
  write(db);
  return true;
}

function revoke(numberDigits) {
  const n = normalizeDigits(numberDigits);
  if (!n) return false;

  const db = read();
  const set = new Set((db.numbers || []).map(normalizeDigits).filter(Boolean));
  set.delete(n);

  // keep dev numbers always included
  for (const d of DEV_NUMBERS) set.add(normalizeDigits(d));

  db.numbers = Array.from(set);
  write(db);
  return true;
}

function listApproved() {
  const db = read();
  return (db.numbers || []).map(normalizeDigits).filter(Boolean);
}

module.exports = {
  isApproved,
  approve,
  revoke,
  listApproved,
  DEV_NUMBERS,
};