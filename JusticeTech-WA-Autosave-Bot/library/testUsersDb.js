const fs = require("fs");
const path = require("path");

const DB_FILE = path.join(__dirname, "../data/test_users.json");

function load() {
  if (!fs.existsSync(DB_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(DB_FILE));
  } catch {
    return [];
  }
}

function save(data) {
  fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

function addTestUser(email) {
  const users = load();
  if (users.includes(email)) return false;
  users.push(email);
  save(users);
  return true;
}

function removeTestUser(email) {
  const users = load();
  const filtered = users.filter(e => e !== email);
  save(filtered);
}

function isTestUser(email) {
  return load().includes(email);
}

function listTestUsers() {
  return load();
}

module.exports = {
  addTestUser,
  removeTestUser,
  isTestUser,
  listTestUsers
};