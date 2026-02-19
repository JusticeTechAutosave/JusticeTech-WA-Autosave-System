const fs = require("fs");
const path = require("path");

function getProjectName() {
  try {
    // Try from credentials file first
    const credPath = path.join(__dirname, "../credentials/google_oauth_client.json");
    if (fs.existsSync(credPath)) {
      const cred = JSON.parse(fs.readFileSync(credPath, "utf8"));
      return cred?.installed?.project_id || cred?.web?.project_id;
    }
    
    // Fallback to extracting from client_id in google_oauth.json
    const oauthPath = path.join(__dirname, "../data/google_oauth.json");
    if (fs.existsSync(oauthPath)) {
      const oauth = JSON.parse(fs.readFileSync(oauthPath, "utf8"));
      if (oauth.client_id) {
        // Try to extract from URI if it contains project info
        return null; // Usually not in client_id, need credentials file
      }
    }
  } catch {}
  return "justicetech-autosave"; // Default fallback
}

module.exports = {
  name: "GoogleConsole",
  category: "autosave",
  desc: "Get direct links to Google Cloud Console pages",
  command: ["console", "googleconsole", "gconsole"],
  devOnly: true,

  run: async ({ reply, args, isDev, m }) => {
    if (!isDev) return reply("🔒 Developer-only command.");
    const projectName = getProjectName();
    const page = args[0]?.toLowerCase();

    if (!page) {
      return reply(
        `🔗 *Google Cloud Console Links*\n\n` +
        `*Usage:*\n` +
        `.console consent - OAuth consent screen\n` +
        `.console credentials - API credentials\n` +
        `.console apis - APIs & Services\n` +
        `.console project - Project dashboard\n\n` +
        `*Current Project:* ${projectName}`
      );
    }

    let url;
    let description;

    switch (page) {
      case "consent":
      case "oauth":
      case "test":
        url = `https://console.cloud.google.com/apis/credentials/consent?project=${projectName}`;
        description = "OAuth Consent Screen (Add test users here)";
        break;

      case "credentials":
      case "creds":
      case "keys":
        url = `https://console.cloud.google.com/apis/credentials?project=${projectName}`;
        description = "API Credentials (Download OAuth client here)";
        break;

      case "apis":
      case "api":
        url = `https://console.cloud.google.com/apis/dashboard?project=${projectName}`;
        description = "APIs & Services Dashboard";
        break;

      case "project":
      case "dashboard":
      case "home":
        url = `https://console.cloud.google.com/home/dashboard?project=${projectName}`;
        description = "Project Dashboard";
        break;

      case "library":
        url = `https://console.cloud.google.com/apis/library?project=${projectName}`;
        description = "API Library (Enable APIs here)";
        break;

      default:
        return reply(
          `❌ Unknown page: ${page}\n\n` +
          `Available pages:\n` +
          `• consent - OAuth consent screen\n` +
          `• credentials - API credentials\n` +
          `• apis - APIs dashboard\n` +
          `• project - Project home\n` +
          `• library - API library`
        );
    }

    return reply(
      `🔗 *${description}*\n\n` +
      `Project: ${projectName}\n\n` +
      `${url}\n\n` +
      `💡 Click the link to open in browser`
    );
  }
};
