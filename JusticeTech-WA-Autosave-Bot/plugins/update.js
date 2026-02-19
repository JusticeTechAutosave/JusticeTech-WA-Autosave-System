// plugins/update.js — JusticeTech Autosave Bot
// ─────────────────────────────────────────────────────────────────────────────
// Auto-update the bot from the latest GitHub release.
//
// USAGE (All users):
//   .update           — check for updates + auto-install if available
//   .update check     — only check version (no install)
//   .update changelog — show what changed in the latest release
//
// USAGE (Owner / Dev only):
//   .update force     — force reinstall even if already up to date
//
// HOW IT WORKS:
//   1. Calls GitHub API to get latest release tag
//   2. Compares with local version.json
//   3. Downloads the release zip from GitHub
//   4. Extracts ONLY safe code files (plugins/, library/, index.js, etc.)
//   5. PRESERVES: database/, data/, credentials/, sessions/, settings/config.js
//   6. Runs npm install if package.json changed
//   7. Restarts the bot process
// ─────────────────────────────────────────────────────────────────────────────

"use strict";

const fs      = require("fs");
const path    = require("path");
const https   = require("https");
const http    = require("http");
const { execSync, spawn } = require("child_process");
const zlib    = require("zlib");

// ── CONFIG — SET THESE TO YOUR GITHUB DETAILS ─────────────────────────────────
// Replace with your actual GitHub username and repository name
const GITHUB_USER  = "JusticeTechAutosave";          // ← your GitHub username
const GITHUB_REPO  = "JusticeTech-WA-Autosave-System"; // ← your GitHub repo name
// ─────────────────────────────────────────────────────────────────────────────

const BOT_ROOT     = path.join(__dirname, "..");
const VERSION_FILE = path.join(BOT_ROOT, "version.json");

// ── Files and folders to PRESERVE during update (user data / secrets) ────────
const PRESERVE_PATHS = new Set([
  "database",
  "data",
  "credentials",
  "sessions",
  "auth_info_baileys",
  "auth_info",
]);

// settings/config.js is preserved (owner has their own number there)
const PRESERVE_FILES = new Set([
  path.join(BOT_ROOT, "settings", "config.js"),
]);

// ── Files and folders that ARE updated from GitHub ───────────────────────────
const UPDATABLE_DIRS  = ["plugins", "library", "docs", "thumbnail", "settings"];
const UPDATABLE_FILES = ["index.js", "message.js", "package.json", "version.json"];

// ── Helpers ───────────────────────────────────────────────────────────────────
function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}

function getLocalVersion() {
  const v = readJson(VERSION_FILE, { version: "0.0.0", codename: "unknown" });
  return v;
}

// Simple semver comparison: returns true if remoteVer > localVer
function isNewer(remoteVer, localVer) {
  const parse = v => String(v || "0.0.0").replace(/^v/, "").split(".").map(Number);
  const [rMaj, rMin, rPat] = parse(remoteVer);
  const [lMaj, lMin, lPat] = parse(localVer);
  if (rMaj !== lMaj) return rMaj > lMaj;
  if (rMin !== lMin) return rMin > lMin;
  return rPat > lPat;
}

// Promise-based HTTPS GET with redirect following
function httpsGet(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith("https") ? https : http;
    const req = client.get(url, {
      headers: {
        "User-Agent": "JusticeTech-AutoUpdate/1.0",
        "Accept":     "application/vnd.github+json",
      },
    }, res => {
      // Follow redirects
      if (res.statusCode >= 301 && res.statusCode <= 302 && res.headers.location) {
        return httpsGet(res.headers.location).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }
      const chunks = [];
      res.on("data", c => chunks.push(c));
      res.on("end",  () => resolve(Buffer.concat(chunks)));
      res.on("error", reject);
    });
    req.on("error", reject);
    req.setTimeout(30_000, () => { req.destroy(); reject(new Error("Request timed out")); });
  });
}

// Fetch GitHub latest release info
async function fetchLatestRelease() {
  const url  = `https://api.github.com/repos/${GITHUB_USER}/${GITHUB_REPO}/releases/latest`;
  const buf  = await httpsGet(url);
  const data = JSON.parse(buf.toString("utf8"));
  if (!data.tag_name) throw new Error("No release found. Make sure you have published at least one release on GitHub.");
  return {
    tag:       data.tag_name,
    version:   data.tag_name.replace(/^v/, ""),
    name:      data.name || data.tag_name,
    body:      data.body || "(no changelog provided)",
    zipUrl:    data.zipball_url,
    publishedAt: data.published_at,
  };
}

// Download zip and extract to temp dir
async function downloadAndExtract(zipUrl, tmpDir) {
  console.log("[update] Downloading release zip...");
  const buf = await httpsGet(zipUrl);

  // GitHub releases come as .zip (not .tar.gz) via zipball_url
  // We use the built-in zlib for gzip but need to handle zip manually
  // Use unzip via shell (available on all Linux servers)
  const zipPath = path.join(tmpDir, "release.zip");
  fs.writeFileSync(zipPath, buf);

  const extractDir = path.join(tmpDir, "extracted");
  fs.mkdirSync(extractDir, { recursive: true });

  execSync(`unzip -q "${zipPath}" -d "${extractDir}"`);
  fs.unlinkSync(zipPath);

  // GitHub zip contains one top-level folder like "User-Repo-abc1234/"
  const entries = fs.readdirSync(extractDir);
  if (entries.length !== 1) throw new Error("Unexpected zip structure from GitHub");

  return path.join(extractDir, entries[0]); // the root of the extracted repo
}

// Recursively copy dir, skipping preserved paths
function copyDir(srcDir, destDir, relBase) {
  if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
  const entries = fs.readdirSync(srcDir, { withFileTypes: true });
  let count = 0;
  for (const entry of entries) {
    const srcPath  = path.join(srcDir, entry.name);
    const destPath = path.join(destDir, entry.name);
    const relPath  = relBase ? path.join(relBase, entry.name) : entry.name;

    // Never overwrite preserved files
    if (PRESERVE_FILES.has(destPath)) continue;

    if (entry.isDirectory()) {
      count += copyDir(srcPath, destPath, relPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
      count++;
    }
  }
  return count;
}

// Apply the extracted release onto BOT_ROOT
function applyUpdate(srcRoot) {
  let totalFiles = 0;

  // Update specific directories
  for (const dir of UPDATABLE_DIRS) {
    const src  = path.join(srcRoot, dir);
    const dest = path.join(BOT_ROOT, dir);
    if (!fs.existsSync(src)) continue;

    // Special: if dir is "settings", SKIP config.js (user-specific)
    if (dir === "settings") {
      const settingsFiles = fs.readdirSync(src);
      if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
      for (const f of settingsFiles) {
        if (f === "config.js") continue; // always preserve user config
        const srcFile  = path.join(src, f);
        const destFile = path.join(dest, f);
        fs.copyFileSync(srcFile, destFile);
        totalFiles++;
      }
      continue;
    }

    totalFiles += copyDir(src, dest, dir);
  }

  // Update specific root-level files
  for (const file of UPDATABLE_FILES) {
    const src  = path.join(srcRoot, file);
    const dest = path.join(BOT_ROOT, file);
    if (!fs.existsSync(src)) continue;
    fs.copyFileSync(src, dest);
    totalFiles++;
  }

  return totalFiles;
}

// Check if npm install is needed (package.json changed)
function needsNpmInstall(srcRoot) {
  try {
    const oldPkg = readJson(path.join(BOT_ROOT, "package.json"), {});
    const newPkg = readJson(path.join(srcRoot, "package.json"), {});
    return JSON.stringify(oldPkg.dependencies) !== JSON.stringify(newPkg.dependencies);
  } catch { return false; }
}

// Restart the bot (works on pm2, screen, and direct node)
function restartBot() {
  console.log("[update] 🔄 Restarting...");

  // Try pm2 first
  try {
    const pm2List = execSync("pm2 list --no-color 2>/dev/null", { encoding: "utf8" });
    if (pm2List.includes("online") || pm2List.includes("stopped")) {
      execSync("pm2 restart all", { stdio: "inherit" });
      return;
    }
  } catch {}

  // Pterodactyl / direct node: spawn new process and exit this one
  const child = spawn(process.execPath, process.argv.slice(1), {
    detached: true,
    stdio:    "inherit",
    cwd:      BOT_ROOT,
    env:      process.env,
  });
  child.unref();
  process.exit(0);
}

// ─────────────────────────────────────────────────────────────────────────────
module.exports = {
  name: "Update",
  category: "system",
  desc: "Update the bot to the latest version from GitHub",
  command: ["update"],
  devOnly: false,
  premiumOnly: false,

  run: async ({ reply, args, isDev, isOwner, isPremium, prefix, sock, m }) => {
    const pfx = prefix || ".";
    const sub = String(args?.[0] || "").toLowerCase();

    const local = getLocalVersion();

    // ── .update check  (version check only, no install) ──────────────────────
    if (sub === "check") {
      await reply("🔍 Checking for updates...");
      try {
        const remote = await fetchLatestRelease();
        const newer  = isNewer(remote.version, local.version);
        return reply(
          `📦 *Update Check*\n\n` +
          `Current version : v${local.version} (${local.codename || "-"})\n` +
          `Latest release  : ${remote.tag} — ${remote.name}\n` +
          `Published       : ${remote.publishedAt ? remote.publishedAt.split("T")[0] : "—"}\n\n` +
          (newer
            ? `🆕 *Update available!*\nRun ${pfx}update to install.`
            : `✅ You are on the latest version.`)
        );
      } catch (e) {
        return reply(`❌ Could not reach GitHub: ${e.message}`);
      }
    }

    // ── .update changelog ─────────────────────────────────────────────────────
    if (sub === "changelog") {
      await reply("📋 Fetching changelog...");
      try {
        const remote    = await fetchLatestRelease();
        const body      = remote.body.slice(0, 3000);
        const thumbPath = path.join(BOT_ROOT, "thumbnail", "image.jpg");
        const thumb     = fs.existsSync(thumbPath) ? fs.readFileSync(thumbPath) : null;
        const text =
          `📋 *Changelog — ${remote.tag}*\n` +
          `${remote.name}\n` +
          `Published: ${remote.publishedAt ? remote.publishedAt.split("T")[0] : "—"}\n\n` +
          `${body}`;
        if (thumb && sock && m?.chat) {
          try {
            return await sock.sendMessage(m.chat, { image: thumb, caption: text }, { quoted: m });
          } catch {}
        }
        return reply(text);
      } catch (e) {
        return reply(`❌ Could not fetch changelog: ${e.message}`);
      }
    }

    // ── .update  /  .update force ─────────────────────────────────────────────
    const forced = sub === "force";

    // Only dev can force reinstall (bypasses version check)
    if (forced && !isDev) {
      return reply("🔒 *.update force* is a developer-only command.");
    }

    await reply("🔍 Checking latest release on GitHub...");

    let remote;
    try {
      remote = await fetchLatestRelease();
    } catch (e) {
      return reply(
        `❌ *Could not reach GitHub.*\n\n` +
        `Error: ${e.message}\n\n` +
        `Check your server has internet access and that your GitHub repo is public.`
      );
    }

    const newer = isNewer(remote.version, local.version);

    if (!newer && !forced) {
      return reply(
        `✅ *Already up to date!*\n\n` +
        `Current version : v${local.version}\n` +
        `Latest release  : ${remote.tag}\n\n` +
        `Your bot is running the latest version.` +
        (isDev ? `\n\nUse ${pfx}update force to reinstall anyway.` : ``)
      );
    }

    await reply(
      `📥 *${forced && !newer ? "Force reinstalling" : "Update found"}: ${remote.tag}*\n\n` +
      `Current : v${local.version}\n` +
      `New     : ${remote.tag}\n\n` +
      `⏳ Downloading and applying update...\n` +
      `(Bot will restart automatically when done)`
    );

    // Create temp directory
    const tmpDir = path.join(BOT_ROOT, ".update_tmp_" + Date.now());
    fs.mkdirSync(tmpDir, { recursive: true });

    try {
      // 1. Download and extract
      const srcRoot = await downloadAndExtract(remote.zipUrl, tmpDir);
      console.log("[update] Extracted to:", srcRoot);

      // 2. Check if npm install is needed before we overwrite package.json
      const runNpmInstall = needsNpmInstall(srcRoot);

      // 3. Apply update (copy files, preserve user data)
      const fileCount = applyUpdate(srcRoot);
      console.log(`[update] Applied ${fileCount} files`);

      // 4. Run npm install if deps changed
      if (runNpmInstall) {
        await reply("📦 Dependencies changed — running npm install...");
        try {
          execSync("npm install --omit=dev", { cwd: BOT_ROOT, stdio: "inherit" });
        } catch (e) {
          console.warn("[update] npm install warning:", e.message);
        }
      }

      // 5. Cleanup temp dir
      try { execSync(`rm -rf "${tmpDir}"`); } catch {}

      // 6. Read the newly written version.json for confirmation
      const newLocal = getLocalVersion();

      await reply(
        `✅ *Update applied successfully!*\n\n` +
        `Version : v${newLocal.version}\n` +
        `Files   : ${fileCount} updated\n` +
        `Deps    : ${runNpmInstall ? "npm install ran ✅" : "no change"}\n\n` +
        `*Preserved (untouched):*\n` +
        `• database/ (subscriptions, bans, etc.)\n` +
        `• data/ (Google tokens)\n` +
        `• credentials/\n` +
        `• sessions/ (WhatsApp session)\n` +
        `• settings/config.js (your config)\n\n` +
        `🔄 Restarting bot now...`
      );

      // 7. Short delay then restart
      setTimeout(() => restartBot(), 3000);

    } catch (e) {
      // Cleanup on error
      try { execSync(`rm -rf "${tmpDir}"`); } catch {}
      console.error("[update] Error:", e);
      return reply(
        `❌ *Update failed!*\n\n` +
        `Error: ${e.message}\n\n` +
        `Your bot files are unchanged. Fix the issue and try again.\n` +
        `(Common causes: no internet access, private repo, bad zip)`
      );
    }
  },
};
