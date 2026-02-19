// plugins/tutorialadmin.js
// ─────────────────────────────────────────────────────────────────────────────
// DEV-ONLY admin tool for managing bot tutorials.
//
// COMMANDS:
//   .tutorialadmin list                              — show all with indexes
//   .tutorialadmin add Title | https://youtu.be/... — add a new tutorial
//   .tutorialadmin add Title | URL | Description     — add with description
//   .tutorialadmin remove 3                          — remove tutorial #3
//   .tutorialadmin edit 2 | New Title | New URL      — edit tutorial #2
//   .tutorialadmin move 3 1                          — move #3 to position #1
//
// Tutorials are saved to database/tutorials.json and read by plugins/tutorial.js
// ─────────────────────────────────────────────────────────────────────────────

"use strict";

const fs   = require("fs");
const path = require("path");

const DB_DIR         = path.join(__dirname, "..", "database");
const TUTORIALS_FILE = path.join(DB_DIR, "tutorials.json");

const DEV_NUMBERS = ["2349032578690", "2348166337692"];

// ── Helpers ───────────────────────────────────────────────────────────────────

function normalizeNumber(input) {
  if (!input) return "";
  let s = String(input).trim();
  if (s.includes("@")) s = s.split("@")[0];
  if (s.includes(":")) s = s.split(":")[0];
  s = s.replace(/\D/g, "");
  if (s.length < 8 || s.length > 15) return "";
  return s;
}

function jidFromCtx(m) {
  return m?.sender || m?.key?.participant || m?.key?.remoteJid || "";
}

function isDevJid(m) {
  const d = normalizeNumber(jidFromCtx(m));
  return !!d && DEV_NUMBERS.includes(d);
}

function readTutorials() {
  if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });
  try {
    const raw    = fs.readFileSync(TUTORIALS_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed.tutorials) ? parsed : { tutorials: [] };
  } catch {
    return { tutorials: [] };
  }
}

function writeTutorials(data) {
  if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });
  fs.writeFileSync(TUTORIALS_FILE, JSON.stringify(data, null, 2));
}

function extractYouTubeId(url) {
  const s = String(url || "").trim();
  const short = s.match(/youtu\.be\/([A-Za-z0-9_-]{11})/);
  if (short) return short[1];
  const long  = s.match(/(?:v=|\/embed\/|\/shorts\/)([A-Za-z0-9_-]{11})/);
  if (long)  return long[1];
  return null;
}

function isValidUrl(url) {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

// Build a compact admin list
function buildAdminList(tutorials, prefix) {
  const p = prefix || ".";
  if (!tutorials.length) {
    return (
      `📚 *Tutorials — Admin View*\n\n` +
      `No tutorials yet.\n\n` +
      `Add one:\n${p}tutorialadmin add Title | https://youtu.be/...`
    );
  }

  const lines = tutorials.map((t, i) => {
    const vidId  = extractYouTubeId(t.url);
    const urlTag = vidId ? `✅ YouTube` : `🔗 Link`;
    const desc   = t.description ? `\n       └ ${t.description}` : "";
    return `  *${i + 1}.* ${t.title}  [${urlTag}]\n       ${t.url}${desc}`;
  }).join("\n\n");

  return (
    `📚 *Tutorials — Admin View* (${tutorials.length})\n\n` +
    `${lines}\n\n` +
    `─────────────────────────\n` +
    `${p}tutorialadmin add Title | URL\n` +
    `${p}tutorialadmin add Title | URL | Description\n` +
    `${p}tutorialadmin remove <number>\n` +
    `${p}tutorialadmin edit <number> | New Title | New URL\n` +
    `${p}tutorialadmin move <from> <to>`
  );
}

// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  name: "TutorialAdmin",
  category: "core",
  desc: "Add, remove and manage bot tutorials (DEV ONLY)",
  command: ["tutorialadmin", "tutadmin", "tuta"],
  devOnly: true,

  run: async ({ reply, m, args, prefix, text }) => {
    if (!isDevJid(m)) return reply("🔒 Developer-only feature.");

    const p      = prefix || ".";
    const sub    = String(args?.[0] || "").toLowerCase().trim();
    const db     = readTutorials();
    const list   = db.tutorials;

    // ── .tutorialadmin  OR  .tutorialadmin list ───────────────────────────────
    if (!sub || sub === "list") {
      return reply(buildAdminList(list, p));
    }

    // ── .tutorialadmin add Title | URL  OR  Title | URL | Description ─────────
    if (sub === "add") {
      // Rejoin everything after "add "
      const raw = text.replace(/^[^\s]+\s+add\s+/i, "").trim();
      if (!raw) {
        return reply(
          `Usage:\n` +
          `${p}tutorialadmin add Title | URL\n` +
          `${p}tutorialadmin add Title | URL | Description\n\n` +
          `Example:\n` +
          `${p}tutorialadmin add Bot Setup Guide | https://youtu.be/abc123XYZ`
        );
      }

      const parts = raw.split("|").map(s => s.trim()).filter(Boolean);
      if (parts.length < 2) {
        return reply(
          `❌ Separate title and URL with a pipe  |  character.\n\n` +
          `Example:\n${p}tutorialadmin add Bot Setup Guide | https://youtu.be/abc123XYZ`
        );
      }

      const title       = parts[0];
      const url         = parts[1];
      const description = parts[2] || "";

      if (!title || title.length < 2) return reply("❌ Title is too short.");
      if (!isValidUrl(url))           return reply(`❌ Invalid URL: "${url}"\nMake sure it starts with https://`);

      const vidId = extractYouTubeId(url);

      // Check for duplicate
      const dup = list.findIndex(t =>
        extractYouTubeId(t.url) && vidId && extractYouTubeId(t.url) === vidId
      );
      if (dup !== -1) {
        return reply(
          `⚠️ A tutorial with this YouTube video already exists:\n` +
          `  #${dup + 1}: ${list[dup].title}\n\n` +
          `Use ${p}tutorialadmin edit ${dup + 1} | ... to update it instead.`
        );
      }

      list.push({ title, url, description, addedAt: new Date().toISOString() });
      writeTutorials({ tutorials: list });

      return reply(
        `✅ Tutorial added!\n\n` +
        `*#${list.length}: ${title}*\n` +
        `🔗 ${url}` +
        (description ? `\n📝 ${description}` : "") +
        (vidId ? `\n▶️ YouTube ID: ${vidId}` : "\n⚠️ Note: Not a recognised YouTube URL — will send as text link") +
        `\n\nTotal tutorials: ${list.length}`
      );
    }

    // ── .tutorialadmin remove <number> ────────────────────────────────────────
    if (sub === "remove" || sub === "delete" || sub === "del") {
      const n = parseInt(args[1], 10);
      if (isNaN(n) || n < 1 || n > list.length) {
        return reply(
          `❌ Invalid number. Pick 1–${list.length}.\n` +
          `Run ${p}tutorialadmin list to see all.`
        );
      }

      const removed = list.splice(n - 1, 1)[0];
      writeTutorials({ tutorials: list });

      return reply(
        `🗑️ Removed tutorial #${n}:\n*${removed.title}*\n\n` +
        `Remaining: ${list.length} tutorial(s).`
      );
    }

    // ── .tutorialadmin edit <number> | New Title | New URL | New Desc ─────────
    if (sub === "edit" || sub === "update") {
      const n = parseInt(args[1], 10);
      if (isNaN(n) || n < 1 || n > list.length) {
        return reply(
          `❌ Invalid number.\nUsage: ${p}tutorialadmin edit <number> | New Title | New URL\n` +
          `Run ${p}tutorialadmin list to see all.`
        );
      }

      const raw    = text.replace(/^[^\s]+\s+(?:edit|update)\s+\S+\s*/i, "").trim();
      const parts  = raw.split("|").map(s => s.trim()).filter(Boolean);

      if (!parts.length) {
        return reply(
          `Usage: ${p}tutorialadmin edit ${n} | New Title | New URL\n` +
          `Or to change just the title: ${p}tutorialadmin edit ${n} | New Title`
        );
      }

      const old = list[n - 1];
      if (parts[0])  list[n - 1].title       = parts[0];
      if (parts[1]) {
        if (!isValidUrl(parts[1])) return reply(`❌ Invalid URL: "${parts[1]}"`);
        list[n - 1].url         = parts[1];
      }
      if (parts[2])  list[n - 1].description = parts[2];
      list[n - 1].updatedAt = new Date().toISOString();

      writeTutorials({ tutorials: list });

      const t = list[n - 1];
      return reply(
        `✅ Tutorial #${n} updated!\n\n` +
        `*${old.title}* → *${t.title}*\n` +
        `🔗 ${t.url}` +
        (t.description ? `\n📝 ${t.description}` : "")
      );
    }

    // ── .tutorialadmin move <from> <to> ───────────────────────────────────────
    if (sub === "move") {
      const from = parseInt(args[1], 10);
      const to   = parseInt(args[2], 10);

      if (
        isNaN(from) || isNaN(to) ||
        from < 1 || from > list.length ||
        to   < 1 || to   > list.length ||
        from === to
      ) {
        return reply(
          `Usage: ${p}tutorialadmin move <from> <to>\n` +
          `Example: ${p}tutorialadmin move 3 1\n\n` +
          `Run ${p}tutorialadmin list to see current order.`
        );
      }

      const [item] = list.splice(from - 1, 1);
      list.splice(to - 1, 0, item);
      writeTutorials({ tutorials: list });

      return reply(
        `✅ Moved *${item.title}*\nfrom position #${from} → #${to}\n\n` +
        buildAdminList(list, p)
      );
    }

    // ── Unknown subcommand ────────────────────────────────────────────────────
    return reply(
      `❓ Unknown subcommand: *${sub}*\n\n` +
      `Available:\n` +
      `  ${p}tutorialadmin list\n` +
      `  ${p}tutorialadmin add Title | URL\n` +
      `  ${p}tutorialadmin add Title | URL | Description\n` +
      `  ${p}tutorialadmin remove <number>\n` +
      `  ${p}tutorialadmin edit <number> | New Title | New URL\n` +
      `  ${p}tutorialadmin move <from> <to>`
    );
  },
};
