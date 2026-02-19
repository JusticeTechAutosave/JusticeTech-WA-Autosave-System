// plugins/menu.js — JusticeTech Autosave Bot v1.1.1 JT
// ─────────────────────────────────────────────────────────────────────────────
// Role-based command menu.
//
// WHO SEES WHAT:
//   Dev     — ALL commands (including devOnly, billing, autosave, etc.)
//   Owner   — ownerOnly + free commands (NOT premium, NOT dev)
//   Premium — premium + free commands (NOT owner/admin, NOT dev)
//   Free    — free commands only
//
// devOnly plugins NEVER appear in any menu except for the dev themselves.
// Group functions are hidden (coming soon).
// ─────────────────────────────────────────────────────────────────────────────

const fs   = require("fs");
const os   = require("os");
const path = require("path");

const getConfig = require("../settings/config");

let getSub, isActive;
try {
  ({ getSub, isActive } = require("../library/subscriptionDb"));
} catch {
  getSub   = null;
  isActive = null;
}

const image = fs.existsSync("./thumbnail/image.jpg") ? fs.readFileSync("./thumbnail/image.jpg") : null;

const DEV_NUMBERS = ["2349032578690", "2348166337692"];
const VERSION     = "v1.1.1 JT";

const DB_DIR     = path.join(__dirname, "..", "database");
const OWNER_FILE = path.join(DB_DIR, "owner.json");
const DELAY_FILE = path.join(DB_DIR, "reply_delay.json");

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}
function safeTrim(s) { return String(s || "").trim(); }
function senderJid(m) { return m?.sender || m?.key?.participant || m?.key?.remoteJid || ""; }

function normalizeNumber(input) {
  if (!input) return "";
  let s = String(input).trim();
  if (s.includes("@")) s = s.split("@")[0];
  if (s.includes(":")) s = s.split(":")[0];
  s = s.replace(/\D/g, "");
  if (s.length < 8 || s.length > 15) return "";
  return s;
}

function isDev(m) {
  const d = normalizeNumber(senderJid(m));
  return !!d && DEV_NUMBERS.includes(d);
}

function isMenuSafeCmd(cmd) {
  const c = String(cmd || "").toLowerCase().trim();
  return c && !c.includes("internal") && !c.startsWith("_");
}

function sortUnique(arr) {
  return [...new Set(arr)].sort((a, b) => a.localeCompare(b));
}

// ── Classify plugin tier ──────────────────────────────────────────────────────
function pluginTier(pl) {
  if (pl.devOnly) return "dev";
  const cat = String(pl.category || "").toLowerCase();
  // billing passive (payment proof listener) = free; billing commands checked internally
  if (cat === "billing" && !pl.devOnly) return "free";
  if (cat === "billing") return "dev";
  // autosave: premium owners get the autosave commands
  if (cat === "autosave") return "premium";
  if (pl.ownerOnly || pl.adminOnly) return "owner";
  if (pl.premiumOnly)               return "premium";
  return "free";
}

// ── Decide which plugins appear in this user's menu ───────────────────────────
// Hierarchy: Dev > Premium > Owner > Free
// Premium = owner with active subscription → gets owner+premium+free+billing
// Owner (no sub) = gets owner+free+billing
// Free = gets free+billing (sub commands visible to all)
function getVisiblePlugins(allPlugins, callerIsDev, callerIsOwner, callerIsPremium) {
  const no_grp = pl => !pl.hidden;

  if (callerIsDev) {
    // Dev: everything
    return allPlugins.filter(no_grp);
  }
  if (callerIsPremium) {
    // Premium owner: owner + premium + free + billing + autosave (no devOnly)
    return allPlugins.filter(pl =>
      no_grp(pl) && !pl.devOnly &&
      ["owner", "premium", "free", "billing", "autosave"].includes(pluginTier(pl))
    );
  }
  // Non-premium owner or free user: owner + free + billing only (no autosave, no premium)
  return allPlugins.filter(pl =>
    no_grp(pl) && !pl.devOnly && !pl.premiumOnly &&
    String(pl.category || "").toLowerCase() !== "autosave" &&
    ["owner", "free"].includes(pluginTier(pl))
  );
}

// ── Category order ────────────────────────────────────────────────────────────
const CAT_ORDER = ["core","tools","info","contacts","settings","google","misc","autosave","billing"];

function categoryRank(cat) {
  const c   = String(cat || "misc").toLowerCase();
  const idx = CAT_ORDER.indexOf(c);
  return idx === -1 ? 999 : idx;
}

// ── Badge for line ────────────────────────────────────────────────────────────
function badgeFor(pl, callerIsDev) {
  if (!callerIsDev) return "";  // Only dev sees internal badges
  const b = [];
  if (pl.devOnly)     b.push("🔴");
  if (pl.ownerOnly)   b.push("🛡");
  if (pl.premiumOnly) b.push("🔒");
  return b.length ? ` ${b.join("")}` : "";
}

// ── Subscription info ─────────────────────────────────────────────────────────
function planLabel(p) {
  if (!p) return "No plan";
  if (p === "monthly") return "Monthly";
  if (p === "m3")      return "3 Months";
  if (p === "m6")      return "6 Months";
  if (p === "yearly")  return "1 Year";
  const m = String(p).match(/^trial_(\d+)h$/);
  if (m) return `Trial ${m[1]}hr`;
  return p;
}

function formatExpiry(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return String(iso);
  const pad = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function getSubInfo(m, callerIsDev, senderNumberFromCtx) {
  if (callerIsDev) return { status: "Lifetime ♾️", plan: "Developer", expires: "Never" };
  if (!getSub || !isActive) return { status: "Inactive ❌", plan: "No plan", expires: "—" };

  // Always use senderNumber from ctx — it's already normalised by message.js
  // and correctly handles fromMe=true (owner messaging own bot) and LID addresses.
  const lookupKey = normalizeNumber(senderNumberFromCtx || "") || normalizeNumber(senderJid(m));
  if (!lookupKey) return { status: "Inactive ❌", plan: "No plan", expires: "—" };

  // Invalidate cache so we always read the latest subscription.json from disk
  try {
    const { invalidateCache } = require("../library/subscriptionDb");
    if (invalidateCache) invalidateCache();
  } catch {}

  const sub = getSub(lookupKey);
  if (!sub) return { status: "Inactive ❌", plan: "No plan", expires: "—" };
  const active = isActive(sub);
  return {
    status:  active ? "Active ✅" : "Inactive ❌",
    plan:    active ? planLabel(sub.plan) : "No plan",
    expires: active ? (formatExpiry(new Date(sub.expiresAtMs || 0).toISOString()) || "—") : "—",
  };
}

// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  name: "Menu",
  category: "core",
  desc: "Dynamic command menu — shows commands for your role",
  command: ["menu", "help"],

  run: async ({ sock, m, prefix, isPremium, isOwner, isDev: callerIsDev, senderNumber }) => {
    const cfg    = typeof getConfig === "function" ? getConfig() : getConfig || {};
    const pfx    = prefix || ".";
    const devCtx   = callerIsDev;
    const premCtx  = !devCtx && isPremium;   // premium = active subscription (any owner)
    const ownerCtx = !devCtx && !premCtx;    // owner = deployed, no active sub

    const subInfo = getSubInfo(m, devCtx, senderNumber);

    // System stats
    const usedMB     = process.memoryUsage().heapUsed / 1024 / 1024;
    const totalMB    = os.totalmem() / 1024 / 1024;
    const memPct     = totalMB ? (usedMB / totalMB) * 100 : 0;
    const ramBar     = "█".repeat(Math.max(0, Math.min(10, Math.floor(memPct / 10)))) + "░".repeat(Math.max(0, 10 - Math.floor(memPct / 10)));

    const up  = process.uptime();
    const uptime = `${Math.floor(up/86400)}d ${Math.floor((up%86400)/3600)}h ${Math.floor((up%3600)/60)}m ${Math.floor(up%60)}s`;

    const isPublic  = cfg?.status?.public !== false;
    const modeText  = isPublic ? "Public" : "Private";

    const ownerDb    = readJson(OWNER_FILE, { name: "" });
    const ownerName  = safeTrim(ownerDb?.name) || safeTrim(sock?.user?.name) || "Bot";

    const delayDb    = readJson(DELAY_FILE, { maxSeconds: 0 });
    const delayText  = Number(delayDb?.maxSeconds || 0) > 0 ? `${Math.min(30, delayDb.maxSeconds)}s max` : "OFF";

    // Hierarchy: Dev > Premium > Owner
    const roleLabel  = devCtx ? "Developer" : premCtx ? "Premium" : "Owner";

    // Build command list
    const allPlugins = Array.isArray(global.PLUGINS) ? global.PLUGINS : [];
    const visible    = getVisiblePlugins(allPlugins, devCtx, isOwner, isPremium);

    const cats = new Map();
    for (const pl of visible) {
      const cat  = String(pl.category || "misc").toLowerCase();
      const cmds = sortUnique((pl.command || []).filter(isMenuSafeCmd));
      if (!cmds.length) continue;
      if (!cats.has(cat)) cats.set(cat, []);
      for (const c of cmds) {
        cats.get(cat).push(`│➽ ${pfx}${c}${badgeFor(pl, devCtx)}`);
      }
    }

    const sorted = [...cats.entries()].sort((a, b) => {
      const ra = categoryRank(a[0]), rb = categoryRank(b[0]);
      return ra !== rb ? ra - rb : a[0].localeCompare(b[0]);
    });

    const blocks = [];

    // Header
    blocks.push(
`┏▣ ◈ *${cfg?.settings?.title || "Bot"}* ◈
┃👤 *Owner*   : ${ownerName}
┃🏷️ *Role*    : ${roleLabel}
┃📊 *Sub*     : ${subInfo.status}
┃📋 *Plan*    : ${subInfo.plan}
┃📅 *Expires* : ${subInfo.expires}
┃🔑 *Prefix*  : [ ${pfx} ]
┃🌐 *Mode*    : ${modeText}
┃⏱️ *Uptime*  : ${uptime}
┃⏳ *Delay*   : ${delayText}
┃🧠 *RAM*     : [${ramBar}] ${memPct.toFixed(1)}%
┃🤖 *Version* : ${VERSION}
┗▣`.trim()
    );

    // Badges legend (only show dev-relevant ones to dev)
    // BADGES - vertical layout
    if (devCtx) {
      blocks.push(
`┏▣ ◈ *BADGES* ◈
│🔴 Dev-only
│🛡 Owner-only
│🔒 Premium-only
┗▣`.trim()
      );
    } else {
      blocks.push(
`┏▣ ◈ *BADGES* ◈
│🛡 Owner-only
│🔒 Premium-only
┗▣`.trim()
      );
    }

    // Command categories
    for (const [cat, lines] of sorted) {
      const pretty = cat.toUpperCase();
      blocks.push(
`┏▣ ◈ *${pretty}* ◈
${lines.sort().join("\n")}
┗▣`.trim()
      );
    }

    // Footer note
    if (!devCtx) {
      const upgradeHint = ownerCtx
        ? `💡 Get a subscription to unlock premium commands.`
        : premCtx
        ? `💡 You have access to free + premium commands.`
        : `💡 Get a subscription to unlock more commands. Use ${pfx}sub`;
      blocks.push(
`┏▣ ◈ *NOTE* ◈
│${upgradeHint}
┗▣`.trim()
      );
    }

    const menuText = blocks.join("\n\n");

    if (image) return sock.sendMessage(m.chat, { image, caption: menuText }, { quoted: m });
    return sock.sendMessage(m.chat, { text: menuText }, { quoted: m });
  },
};
