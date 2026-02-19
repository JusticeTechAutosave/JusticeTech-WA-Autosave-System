// plugins/oauthstatus.js — JusticeTech Autosave Bot v1.1.1 JT
// ─────────────────────────────────────────────────────────────────────────────
// Merged: oauthstatus + checkauth + debuggoogle/googlecheck — DEV ONLY
//
// Commands:
//   .oauthstatus              — full OAuth config + test users status
//   .oauthstatus <number>     — deep-check a specific contact number in Google
//   .oauthstatus refresh      — clear contacts cache and re-fetch
// ─────────────────────────────────────────────────────────────────────────────

"use strict";

const fs   = require("fs");
const path = require("path");
const { listTestUsers } = require("../library/testUsersDb");
const { searchContactByPhone, invalidateContactsCache } = require("../library/googleContacts");
const { getAuthedClientForUser, normalizeNumber } = require("../library/googleTenantAuth");
const { google } = require("googleapis");

const DEV_NUMBERS = ["2349032578690", "2348166337692"];

function jidFromCtx(m) {
  return m?.sender || m?.key?.participant || m?.key?.remoteJid || "";
}

function jidToDigits(jid) {
  let s = String(jid || "").trim();
  if (s.includes("@")) s = s.split("@")[0];
  if (s.includes(":")) s = s.split(":")[0];
  const d = s.replace(/[^0-9]/g, "");
  if (!d || d.length < 8 || d.length > 15) return null;
  return d;
}

function isDevJid(m) {
  const d = jidToDigits(jidFromCtx(m));
  return !!d && DEV_NUMBERS.includes(d);
}

function coreDigits(raw) {
  const d = String(raw || "").replace(/[^0-9]/g, "").replace(/^0+/, "");
  return d.slice(-9);
}

function checkFile(filePath) {
  try { return fs.existsSync(filePath); } catch { return false; }
}

function readJSON(filePath) {
  try { return JSON.parse(fs.readFileSync(filePath, "utf8")); } catch { return null; }
}

function getProjectName() {
  try {
    const credPath = path.join(__dirname, "../credentials/google_oauth_client.json");
    if (fs.existsSync(credPath)) {
      const cred = JSON.parse(fs.readFileSync(credPath, "utf8"));
      return cred?.installed?.project_id || cred?.web?.project_id || null;
    }
  } catch {}
  return null;
}

module.exports = {
  name: "OAuthStatus",
  category: "autosave",
  desc: "DEV: Check OAuth config, deep-check contacts, or refresh cache",
  command: ["oauthstatus", "checkauth"],
  devOnly: true,

  run: async ({ reply, m, args, prefix, botNumber, botJid, sock }) => {
    if (!isDevJid(m)) return reply("🔒 Developer-only command.");

    const p = prefix || ".";
    const sub = String(args?.[0] || "").toLowerCase().trim();

    const ownerNumber = jidToDigits(botJid || botNumber || sock?.user?.id);

    // ── .oauthstatus refresh — clear cache ────────────────────────────────────
    if (sub === "refresh") {
      if (ownerNumber) invalidateContactsCache(ownerNumber);
      return reply("🔄 Contacts cache cleared. Next lookup will re-fetch from Google API.");
    }

    // ── .oauthstatus <number> — deep-check a contact ──────────────────────────
    const numToCheck = jidToDigits(args?.[0]);
    if (numToCheck && sub !== "status") {
      if (!ownerNumber) return reply("❌ Could not resolve owner number.");
      const numCore = coreDigits(numToCheck);
      let out = `🔬 *Deep Check: ${numToCheck}*\n`;
      out += `coreDigits key: "${numCore}"\n\n`;

      const auth = getAuthedClientForUser(ownerNumber);
      if (!auth) return reply("❌ Google not linked. Run .linkgoogle first.");

      const people = google.people({ version: "v1", auth });

      // Main contacts
      out += `📋 Scanning main contacts...\n`;
      let mainFound = false, mainTotal = 0;
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
              const raw = (p.value || "").replace(/[^0-9]/g, "");
              if (coreDigits(raw) === numCore) {
                mainFound = true;
                out += `✅ FOUND in main contacts\n`;
                out += `  Name: ${person.names?.[0]?.displayName || "(unnamed)"}\n`;
                out += `  Stored as: ${p.value}\n`;
                out += `  resourceName: ${person.resourceName}\n`;
              }
            }
            mainTotal++;
          }
          pageToken = resp.data?.nextPageToken;
        } while (pageToken);
        out += `Main contacts total: ${mainTotal}\n`;
        if (!mainFound) out += `❌ NOT in main contacts\n`;
      } catch (e) {
        out += `⚠️ connections.list error: ${e?.message}\n`;
      }

      out += `\n`;

      // Other contacts
      out += `📋 Scanning other contacts...\n`;
      let otherFound = false, otherTotal = 0;
      try {
        let pageToken;
        do {
          const resp = await people.otherContacts.list({
            readMask: "names,phoneNumbers",
            pageSize: 1000,
            ...(pageToken ? { pageToken } : {}),
          });
          for (const person of resp.data?.otherContacts || []) {
            for (const ph of person.phoneNumbers || []) {
              const raw = (ph.value || "").replace(/[^0-9]/g, "");
              if (coreDigits(raw) === numCore) {
                otherFound = true;
                out += `✅ FOUND in other contacts\n`;
                out += `  Name: ${person.names?.[0]?.displayName || "(unnamed)"}\n`;
                out += `  Stored as: ${ph.value}\n`;
              }
            }
            otherTotal++;
          }
          pageToken = resp.data?.nextPageToken;
        } while (pageToken);
        out += `Other contacts total: ${otherTotal}\n`;
        if (!otherFound) out += `❌ NOT in other contacts\n`;
      } catch (e) {
        out += `⚠️ otherContacts.list error: ${e?.message}\n`;
      }

      out += `\n━━━━━━━━━━━━━━━━\n`;
      if (!mainFound && !otherFound) {
        out += `❌ Not found in either contact bucket.\n\nPossible reasons:\n`;
        out += `1. Contact saved on phone but not synced to Google\n`;
        out += `2. Bot linked to different Google account than where contacts are saved\n`;
        out += `3. Number stored with different digits in Google\n\n`;
        out += `Try: contacts.google.com and search manually.`;
      } else {
        out += `✅ Contact exists. Cache refreshed.`;
        invalidateContactsCache(ownerNumber);
      }
      return reply(out);
    }

    // ── .oauthstatus (default) — full config status ───────────────────────────
    const dataDir   = path.join(__dirname, "../data");
    const credDir   = path.join(__dirname, "../credentials");

    const oauthConfigPath = path.join(dataDir, "google_oauth.json");
    const credentialsPath = path.join(credDir, "google_oauth_client.json");
    const tokensPath      = path.join(dataDir, "google_tokens.json");
    const testUsersPath   = path.join(dataDir, "test_users.json");

    const hasOAuthConfig  = checkFile(oauthConfigPath);
    const hasCredentials  = checkFile(credentialsPath);
    const hasTokens       = checkFile(tokensPath);
    const hasTestUsers    = checkFile(testUsersPath);

    let oauthConfig  = hasOAuthConfig ? readJSON(oauthConfigPath) : null;
    const projectName = getProjectName();
    const testUsers  = listTestUsers();

    let status = `🔍 *Google OAuth Status*\n\n`;

    // Files
    status += `📁 *Config Files:*\n`;
    status += `${hasOAuthConfig  ? "✅" : "❌"} data/google_oauth.json\n`;
    status += `${hasCredentials  ? "✅" : "❌"} credentials/google_oauth_client.json\n`;
    status += `${hasTokens       ? "✅" : "❌"} data/google_tokens.json\n`;
    status += `${hasTestUsers    ? "✅" : "❌"} data/test_users.json\n\n`;

    // OAuth config details
    if (hasOAuthConfig && oauthConfig) {
      status += `🔐 *OAuth Config:*\n`;
      status += `Client ID:     ${oauthConfig.client_id     ? "✅ Set" : "❌ Missing"}\n`;
      status += `Client Secret: ${oauthConfig.client_secret ? "✅ Set" : "❌ Missing"}\n`;
      status += `Redirect URI:  ${oauthConfig.redirect_uri || "❌ Missing"}\n`;
      const expectedUri = "https://developers.google.com/oauthplayground";
      if (oauthConfig.redirect_uri && oauthConfig.redirect_uri !== expectedUri) {
        status += `⚠️ Should be: ${expectedUri}\n`;
      }
      status += "\n";
    } else {
      status += `❌ *OAuth Config:* Not configured\n\n`;
    }

    // Project info
    if (projectName) {
      status += `📊 *Cloud Project:* ${projectName}\n`;
      status += `🔗 Credentials:\nhttps://console.cloud.google.com/apis/credentials?project=${projectName}\n\n`;
      status += `🔗 OAuth Consent:\nhttps://console.cloud.google.com/apis/credentials/consent?project=${projectName}\n\n`;
    } else {
      status += `⚠️ *Project:* Cannot detect project name\n\n`;
    }

    // Test users
    status += `🧪 *Local Test Users:* ${testUsers.length}\n`;
    if (testUsers.length > 0) {
      status += testUsers.slice(0, 5).map((u, i) => `  ${i + 1}. ${u}`).join("\n");
      if (testUsers.length > 5) status += `\n  ... and ${testUsers.length - 5} more`;
      status += "\n\n";
    } else {
      status += `❌ No test users added\n\n`;
    }

    // Next steps
    status += `📝 *Next Steps:*\n`;
    if (!hasOAuthConfig || !oauthConfig?.client_id) {
      status += `1. Download OAuth credentials from Google Console\n2. Save to data/google_oauth.json\n`;
    } else if (testUsers.length === 0) {
      status += `1. Add test users: ${p}addtestuser email@gmail.com\n2. Add same emails to Google Console\n`;
    } else {
      status += `1. Ensure test users added in Google Console\n`;
      status += `2. Send OAuth link: ${p}linkgoogle NUMBER EMAIL\n`;
      status += `3. User authorizes → ${p}oauth CODE\n`;
    }

    status += `\n💡 *Quick Commands (dev):*\n`;
    status += `${p}oauthstatus <number> — deep-check a contact\n`;
    status += `${p}oauthstatus refresh — clear contacts cache\n`;

    return reply(status);
  },
};
