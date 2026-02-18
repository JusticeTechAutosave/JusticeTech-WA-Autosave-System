// plugins/tutorial.js
// ─────────────────────────────────────────────────────────────────────────────
// USAGE:
//   .tutorial          — shows numbered list of all available tutorials
//   .tutorial 3        — sends tutorial #3 as a YouTube link card (plays in WA)
//
// DEV-ONLY command. Tutorials are stored in database/tutorials.json and
// managed with .tutorialadmin (add/remove/list).
//
// YouTube links are sent using externalAdReply which renders a tappable
// video card inside WhatsApp — tap it to play the video directly in-app.
// ─────────────────────────────────────────────────────────────────────────────

"use strict";

const fs   = require("fs");
const path = require("path");
const https = require("https");

const DB_DIR        = path.join(__dirname, "..", "database");
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
    const raw = fs.readFileSync(TUTORIALS_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed.tutorials) ? parsed : { tutorials: [] };
  } catch {
    return { tutorials: [] };
  }
}

// ── Extract YouTube video ID from any YouTube URL format ─────────────────────
function extractYouTubeId(url) {
  const s = String(url || "").trim();
  // youtu.be/ID
  const short = s.match(/youtu\.be\/([A-Za-z0-9_-]{11})/);
  if (short) return short[1];
  // youtube.com/watch?v=ID  or  /embed/ID  or  /shorts/ID
  const long = s.match(/(?:v=|\/embed\/|\/shorts\/)([A-Za-z0-9_-]{11})/);
  if (long) return long[1];
  return null;
}

function buildYouTubeUrl(videoId) {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

function buildThumbnailUrl(videoId) {
  // maxresdefault is highest quality; fallback to hqdefault if needed
  return `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
}

// ── Fetch YouTube thumbnail as a buffer (needed for WA to render the card) ───
function fetchBuffer(url) {
  return new Promise((resolve) => {
    https.get(url, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve(Buffer.concat(chunks)));
      res.on("error", () => resolve(null));
    }).on("error", () => resolve(null));
  });
}

// ── Build numbered tutorial list text ────────────────────────────────────────
function buildListText(tutorials, prefix) {
  const p = prefix || ".";
  if (!tutorials.length) {
    return (
      `📚 *JusticeTech Tutorials*\n\n` +
      `No tutorials added yet.\n\n` +
      `Add one with:\n${p}tutorialadmin add Title | https://youtu.be/...`
    );
  }

  const lines = tutorials.map((t, i) =>
    `  *${i + 1}.* ${t.title}`
  ).join("\n");

  return (
    `📚 *JusticeTech Tutorials* (${tutorials.length})\n\n` +
    `${lines}\n\n` +
    `Reply with a number to watch:\n` +
    `Example: *${p}tutorial 1*`
  );
}

// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  name: "Tutorial",
  category: "core",
  desc: "Browse and watch bot tutorials directly in WhatsApp (DEV ONLY)",
  command: ["tutorial", "tutorials", "tut"],
  devOnly: true,

  run: async ({ sock, m, reply, args, prefix }) => {
    if (!isDevJid(m)) return reply("🔒 Developer-only feature.");

    const { tutorials } = readTutorials();
    const p = prefix || ".";

    // ── No argument: print the list ───────────────────────────────────────────
    if (!args || !args[0]) {
      return reply(buildListText(tutorials, p));
    }

    // ── Numeric argument: send that tutorial as a playable card ───────────────
    const num = parseInt(args[0], 10);
    if (isNaN(num) || num < 1) {
      return reply(
        `❌ Invalid number.\n\n` +
        `Usage: ${p}tutorial <number>\n` +
        `Example: ${p}tutorial 1\n\n` +
        `Run ${p}tutorial to see the list.`
      );
    }

    if (num > tutorials.length) {
      return reply(
        `❌ Tutorial #${num} doesn't exist.\n` +
        `There are currently *${tutorials.length}* tutorial(s).\n\n` +
        `Run ${p}tutorial to see the full list.`
      );
    }

    const tut    = tutorials[num - 1];
    const vidId  = extractYouTubeId(tut.url);
    const chatJid = m?.chat || m?.key?.remoteJid;

    if (!vidId) {
      // URL isn't a recognisable YouTube link — send as plain text
      return reply(
        `📖 *Tutorial ${num}: ${tut.title}*\n\n` +
        `🔗 ${tut.url}${tut.description ? `\n\n${tut.description}` : ""}`
      );
    }

    const watchUrl      = buildYouTubeUrl(vidId);
    const thumbnailUrl  = buildThumbnailUrl(vidId);

    // Fetch thumbnail so WhatsApp renders the full card with preview image
    const thumbnailBuf = await fetchBuffer(thumbnailUrl);

    const titleText = `📖 Tutorial ${num}: ${tut.title}`;
    const bodyText  = tut.description || "Tap to watch on YouTube";

    // ── Send as rich external ad reply (renders as a tappable video card) ─────
    // mediaType: 2  → renders as a video/YouTube card in WA
    // renderLargerThumbnail: true  → big preview image
    // sourceUrl: the link WhatsApp opens when tapped
    try {
      await sock.sendMessage(
        chatJid,
        {
          text: `${titleText}\n\n${bodyText}\n\n▶️ ${watchUrl}`,
          contextInfo: {
            externalAdReply: {
              title: tut.title,
              body: bodyText,
              mediaType: 2,                          // 2 = video card
              sourceUrl: watchUrl,
              thumbnail: thumbnailBuf || undefined,
              renderLargerThumbnail: true,
              showAdAttribution: false,
            },
          },
        },
        { quoted: m }
      );
    } catch (e) {
      // If the rich send fails, fall back to a clean text link
      console.warn("[tutorial] rich send failed, falling back to text:", e.message);
      return reply(
        `📖 *Tutorial ${num}: ${tut.title}*\n\n` +
        `${bodyText}\n\n` +
        `▶️ ${watchUrl}`
      );
    }
  },
};
