const {
  addTestUser,
  removeTestUser,
  listTestUsers
} = require("../library/testUsersDb");
const fs = require("fs");
const path = require("path");

// Read project ID from google_oauth.json
function getProjectId() {
  try {
    const oauthPath = path.join(__dirname, "../data/google_oauth.json");
    const oauth = JSON.parse(fs.readFileSync(oauthPath, "utf8"));
    // Try to extract project ID from client_id (format: xxx-yyy.apps.googleusercontent.com)
    if (oauth.client_id) {
      const match = oauth.client_id.match(/^(\d+)-/);
      if (match) return match[1];
    }
    return null;
  } catch {
    return null;
  }
}

// Get project name from google_oauth.json or credentials
function getProjectName() {
  try {
    const credPath = path.join(__dirname, "../credentials/google_oauth_client.json");
    if (fs.existsSync(credPath)) {
      const cred = JSON.parse(fs.readFileSync(credPath, "utf8"));
      return cred?.installed?.project_id || cred?.web?.project_id || "justicetech-autosave";
    }
    return "justicetech-autosave";
  } catch {
    return "justicetech-autosave";
  }
}

const DEV_NUMBERS_TU = ["2349032578690", "2348166337692"];

function normalizeNumberTU(input) {
  if (!input) return "";
  let s = String(input).trim();
  if (s.includes("@")) s = s.split("@")[0];
  if (s.includes(":")) s = s.split(":")[0];
  s = s.replace(/\D/g, "");
  if (s.length < 8 || s.length > 15) return "";
  return s;
}

function isDevTU(m) {
  const sender = m?.sender || m?.key?.participant || m?.key?.remoteJid || "";
  const d = normalizeNumberTU(sender);
  return !!d && DEV_NUMBERS_TU.includes(d);
}

module.exports = {
  name: "TestUser",
  category: "autosave",
  desc: "Manage Google OAuth test users with Google Console integration",
  command: ["testuser", "addtestuser"],
  devOnly: true,

  run: async ({ args, reply, prefix, m }) => {
    if (!isDevTU(m)) return reply("🔒 Developer-only command.");
    const firstArg = args[0]?.toLowerCase();
    
    // If first arg contains @, treat it as email (quick add mode)
    if (firstArg && firstArg.includes("@")) {
      const directEmail = firstArg;
      const added = addTestUser(directEmail);
      const projectName = getProjectName();
      const consentUrl = `https://console.cloud.google.com/apis/credentials/consent?project=${projectName}`;
      
      return reply(
        added
          ? `✅ ${directEmail} added to local test users\n\n` +
            `📋 Next step: Add to Google Cloud Console\n\n` +
            `Copy and paste this email:\n${directEmail}\n\n` +
            `🔗 Google Console:\n${consentUrl}\n\n` +
            `📝 Instructions:\n` +
            `1. Click the link above\n` +
            `2. Scroll to "Test users"\n` +
            `3. Click "+ ADD USERS"\n` +
            `4. Paste: ${directEmail}\n` +
            `5. Click "SAVE"`
          : `⚠️ ${directEmail} is already a test user`
      );
    }

    // Otherwise, treat as action-based command
    const action = firstArg;
    const email = args[1]?.toLowerCase();

    // Show help if no action
    if (!action) {
      const projectName = getProjectName();
      const consentUrl = `https://console.cloud.google.com/apis/credentials/consent?project=${projectName}`;
      
      return reply(
        `🧪 *Test User Management*\n\n` +
        `*Commands:*\n` +
        `${prefix || "."}testuser add email@gmail.com\n` +
        `${prefix || "."}testuser remove email@gmail.com\n` +
        `${prefix || "."}testuser list\n` +
        `${prefix || "."}testuser export\n` +
        `${prefix || "."}addtestuser email@gmail.com (quick add)\n\n` +
        `*Google Console:*\n${consentUrl}\n\n` +
        `💡 Tip: Use 'export' to get a ready-to-paste list for Google Console`
      );
    }

    // Add test user
    if (action === "add") {
      if (!email || !email.includes("@")) {
        return reply("❌ Please provide a valid email address.");
      }
      const added = addTestUser(email);
      const users = listTestUsers();
      const projectName = getProjectName();
      const consentUrl = `https://console.cloud.google.com/apis/credentials/consent?project=${projectName}`;
      
      return reply(
        added
          ? `✅ ${email} added as local test user (${users.length} total)\n\n` +
            `📋 Next: Add to Google Cloud Console\n\n` +
            `Copy this email:\n${email}\n\n` +
            `🔗 Add at:\n${consentUrl}\n\n` +
            `Then user can run:\n.linkgoogle to get OAuth link`
          : `⚠️ ${email} is already a test user`
      );
    }

    // Remove test user
    if (action === "remove") {
      if (!email) return reply("❌ Provide an email to remove.");
      removeTestUser(email);
      return reply(
        `🗑️ ${email} removed from local test users\n\n` +
        `⚠️ Also remove from Google Console:\n` +
        `https://console.cloud.google.com/apis/credentials/consent?project=${getProjectName()}`
      );
    }

    // List test users
    if (action === "list") {
      const users = listTestUsers();
      if (!users.length) {
        return reply(
          `No test users added yet.\n\n` +
          `Add one with:\n${prefix || "."}testuser add email@gmail.com`
        );
      }
      
      const projectName = getProjectName();
      const consentUrl = `https://console.cloud.google.com/apis/credentials/consent?project=${projectName}`;
      
      return reply(
        `🧪 *Local Test Users (${users.length}):*\n\n` +
        users.map((u, i) => `${i + 1}. ${u}`).join("\n") +
        `\n\n🔗 *Google Console:*\n${consentUrl}\n\n` +
        `💡 Use "${prefix || "."}testuser export" to get copy-paste format`
      );
    }

    // Export for Google Console
    if (action === "export") {
      const users = listTestUsers();
      if (!users.length) {
        return reply("No test users to export.");
      }
      
      const projectName = getProjectName();
      const consentUrl = `https://console.cloud.google.com/apis/credentials/consent?project=${projectName}`;
      
      // Format for easy copy-paste into Google Console
      const exportText = users.join("\n");
      
      return reply(
        `📋 *Ready to paste into Google Console*\n\n` +
        `*Step 1:* Copy all emails below:\n` +
        `━━━━━━━━━━━━━━━\n` +
        `${exportText}\n` +
        `━━━━━━━━━━━━━━━\n\n` +
        `*Step 2:* Open Google Console:\n${consentUrl}\n\n` +
        `*Step 3:* Instructions:\n` +
        `1. Scroll down to "Test users"\n` +
        `2. Click "+ ADD USERS"\n` +
        `3. Paste the emails above (one per line)\n` +
        `4. Click "SAVE"\n\n` +
        `✅ Total: ${users.length} email${users.length !== 1 ? 's' : ''}`
      );
    }

    return reply("❌ Unknown action. Use: add, remove, list, or export");
  }
};
