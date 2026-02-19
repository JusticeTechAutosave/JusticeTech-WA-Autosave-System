// plugins/features.js — JusticeTech Autosave Bot v1.1.1 JT
// ─────────────────────────────────────────────────────────────────────────────
// Role-based feature listing.
//
// WHO SEES WHAT:
//   Dev     — ALL plugins including devOnly/billing/autosave (full visibility)
//   Owner   — ownerOnly + free plugins only (NOT premium, NOT dev)
//   Premium — premium + free plugins only (NOT owner/admin, NOT dev)
//   Free    — free plugins only
//
// SUBCOMMANDS (anyone):
//   .features           — auto-detect role, show your features
//   .features free      — free tier only
//   .features premium   — premium tier (free + premium)
//   .features owner     — owner/admin tier (free + owner)
//   .features all       — dev only: ALL plugins including internal
// ─────────────────────────────────────────────────────────────────────────────

"use strict";

const fs   = require("fs");
const path = require("path");

const THUMB_FILE = path.join(__dirname, "..", "thumbnail", "image.jpg");
function getThumb() {
  try { return fs.existsSync(THUMB_FILE) ? fs.readFileSync(THUMB_FILE) : null; } catch { return null; }
}

const DEV_NUMBERS = ["2349032578690", "2348166337692"];

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

// ── Classify tier ─────────────────────────────────────────────────────────────
function pluginTier(pl) {
  if (pl.devOnly)                              return "dev";
  const cat = String(pl.category || "").toLowerCase();
  if (cat === "billing" || cat === "autosave") return "dev";  // internal dev categories
  if (pl.ownerOnly || pl.adminOnly)            return "owner";
  if (pl.premiumOnly)                          return "premium";
  return "free";
}

// ── Filter by role ────────────────────────────────────────────────────────────
// Hierarchy: Dev > Premium > Owner
// Premium users get ALL owner features + premium-only features
// Owners (no sub) get only free + owner features
// Free = same as owner (owners without sub)
function filterForRole(allPlugins, role) {
  switch (role) {
    case "dev":
      return allPlugins.filter(pl => !pl.hidden);
    case "premium":
      // Premium: owner/free + premium-only (NOT devOnly, NOT billing category)
      return allPlugins.filter(pl =>
        !pl.hidden && !pl.devOnly &&
        String(pl.category || "").toLowerCase() !== "billing" &&
        ["owner", "premium", "free"].includes(pluginTier(pl))
      );
    case "owner":
      // Owner (no active sub): owner/free only (no premium-only commands)
      return allPlugins.filter(pl =>
        !pl.hidden && !pl.devOnly &&
        String(pl.category || "").toLowerCase() !== "billing" &&
        String(pl.category || "").toLowerCase() !== "autosave" &&
        ["owner", "free"].includes(pluginTier(pl))
      );
    default:  // free
      return allPlugins.filter(pl =>
        !pl.hidden && !pl.devOnly &&
        String(pl.category || "").toLowerCase() !== "billing" &&
        String(pl.category || "").toLowerCase() !== "autosave" &&
        pluginTier(pl) === "free"
      );
  }
}

// ── Category config ───────────────────────────────────────────────────────────
const CATEGORY_CONFIG = {
  core:      { icon: "⚙️",  label: "CORE"      },
  tools:     { icon: "🛠️",  label: "TOOLS"     },
  info:      { icon: "ℹ️",  label: "INFO"      },
  contacts:  { icon: "📋",  label: "CONTACTS"  },
  settings:  { icon: "🔧",  label: "SETTINGS"  },
  misc:      { icon: "📦",  label: "MISC"      },
  autosave:  { icon: "💾",  label: "AUTOSAVE"  },
  billing:   { icon: "💳",  label: "BILLING"   },
  google:    { icon: "🔗",  label: "GOOGLE"    },
};

const CAT_ORDER = ["core","tools","info","contacts","settings","google","autosave","billing","misc"];

function buildSection(plugins, prefix, includeBadges) {
  const p = prefix || ".";
  const catMap = new Map();

  for (const pl of plugins) {
    const cat  = String(pl.category || "misc").toLowerCase();
    const cmds = (pl.command || []).filter(c => c && !String(c).startsWith("_"));
    if (!cmds.length) continue;
    if (!catMap.has(cat)) catMap.set(cat, []);

    const badges = [];
    if (includeBadges) {
      if (pl.devOnly)     badges.push("🔴");
      if (pl.ownerOnly)   badges.push("🛡");
      if (pl.premiumOnly) badges.push("🔒");
    }
    const badgeStr = badges.length ? ` ${badges.join("")}` : "";

    catMap.get(cat).push({ name: pl.name + badgeStr, desc: pl.desc || "", cmds });
  }

  if (!catMap.size) return "(none)";

  const sorted = [...catMap.entries()].sort((a, b) => {
    const ia = CAT_ORDER.indexOf(a[0]);
    const ib = CAT_ORDER.indexOf(b[0]);
    if (ia !== -1 && ib !== -1) return ia - ib;
    if (ia !== -1) return -1;
    if (ib !== -1) return  1;
    return a[0].localeCompare(b[0]);
  });

  let out = "";
  for (const [cat, items] of sorted) {
    const cfg = CATEGORY_CONFIG[cat] || { icon: "📦", label: cat.toUpperCase() };
    out += `\n${cfg.icon} *${cfg.label}*\n${"─".repeat(28)}\n`;
    for (const item of items) {
      out += `• ${item.name}\n`;
      for (const cmd of item.cmds) out += `  └ ${p}${cmd}\n`;
      if (item.desc) out += `  └ ${item.desc}\n`;
    }
  }
  return out.trim();
}

// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  name: "Features",
  category: "info",
  desc: "Show features by role: .features / .features free / .features premium / .features owner",
  command: ["features", "cmds"],

  run: async ({ reply, args, m, sock, prefix, isPremium, isOwner, isDev }) => {
    const all   = Array.isArray(global.PLUGINS) ? global.PLUGINS : [];
    const p     = prefix || ".";
    const ver   = global.BOT_VERSION || "v1.2.0 JT";
    const thumb = getThumb();

    // Helper — send reply with bot image if available
    async function sendReply(text) {
      if (thumb && sock && m?.chat) {
        try {
          return await sock.sendMessage(m.chat, { image: thumb, caption: text }, { quoted: m });
        } catch {}
      }
      return reply(text);
    }

    const sub = String(args?.[0] || "").toLowerCase().trim();

    // ── .features all — dev sees EVERYTHING ───────────────────────────────────
    if (sub === "all") {
      if (!isDev) return sendReply("🔒 Developer-only. Use .features free / .features premium / .features owner instead.");
      const section = buildSection(all.filter(pl => !pl.hidden), p, true);
      const counts  = {
        dev:     all.filter(pl => !pl.hidden && pluginTier(pl) === "dev").length,
        owner:   all.filter(pl => !pl.hidden && pluginTier(pl) === "owner").length,
        premium: all.filter(pl => !pl.hidden && pluginTier(pl) === "premium").length,
        free:    all.filter(pl => !pl.hidden && pluginTier(pl) === "free").length,
      };
      return sendReply(
        `🔴 *ALL Features (Dev View)*\n` +
        `${"═".repeat(36)}\n` +
        `🔴 Dev: ${counts.dev}  🛡 Owner: ${counts.owner}  🔒 Premium: ${counts.premium}  🌐 Free: ${counts.free}\n` +
        `${"═".repeat(36)}\n` +
        `${section}\n\n` +
        `${"═".repeat(36)}\n` +
        `📊 Total: ${all.filter(pl => !pl.hidden).length} plugins\n` +
        `🤖 ${ver}`
      );
    }

    // ── .features free ────────────────────────────────────────────────────────
    if (sub === "free" || sub === "public") {
      const plugins = filterForRole(all, "free");
      const section = buildSection(plugins, p, false);
      return sendReply(
        `🌐 *Free Commands*\n` +
        `${"═".repeat(36)}\n` +
        `${section}\n\n` +
        `${"═".repeat(36)}\n` +
        `📊 ${plugins.length} command(s)\n` +
        `🤖 ${ver}\n\n` +
        `Upgrade: ${p}sub`
      );
    }

    // ── .features premium ─────────────────────────────────────────────────────
    if (sub === "premium" || sub === "pro") {
      const plugins = filterForRole(all, "premium");
      const section = buildSection(plugins, p, false);
      return sendReply(
        `🔒 *Premium Commands* (free + premium)\n` +
        `${"═".repeat(36)}\n` +
        `${section}\n\n` +
        `${"═".repeat(36)}\n` +
        `📊 ${plugins.length} command(s)\n` +
        `🤖 ${ver}\n\n` +
        `Subscribe: ${p}sub`
      );
    }

    // ── .features owner ───────────────────────────────────────────────────────
    if (sub === "owner" || sub === "admin") {
      if (!isOwner && !isDev) return sendReply("🔒 Owner-only view.");
      const plugins = filterForRole(all, "owner");
      const section = buildSection(plugins, p, false);
      return sendReply(
        `🛡 *Owner Commands* (free + owner)\n` +
        `${"═".repeat(36)}\n` +
        `${section}\n\n` +
        `${"═".repeat(36)}\n` +
        `📊 ${plugins.length} command(s)\n` +
        `🤖 ${ver}`
      );
    }

    // ── .features (no arg) — role-based auto view ─────────────────────────────
    let role, roleLabel, roleIcon;

    // Hierarchy: Dev > Premium > Owner (free)
    if (isDev) {
      role = "dev"; roleLabel = "Developer"; roleIcon = "✦";
    } else if (isPremium) {
      // Premium = owner with active subscription
      role = "premium"; roleLabel = "Premium"; roleIcon = "★";
    } else {
      // Owner = deployed bot, no active sub (free tier)
      role = "owner"; roleLabel = "Owner"; roleIcon = "◆";
    }

    const plugins = filterForRole(all, role);
    const section = buildSection(plugins, p, isDev);

    const hint = isDev
      ? `${p}features all — full dev view with all categories`
      : isOwner
      ? `${p}features owner — see all your owner commands\n  ${p}features free — see free tier only`
      : isPremium
      ? `${p}features free — free tier\n  ${p}features premium — full premium tier`
      : `${p}features free — what you have access to\n  ${p}features premium — what premium unlocks`;

    return sendReply(
      `${roleIcon} *Features — ${roleLabel}*\n` +
      `${"═".repeat(36)}\n` +
      `${section}\n\n` +
      `${"═".repeat(36)}\n` +
      `📊 ${plugins.length} command(s) available\n` +
      `🤖 ${ver}\n\n` +
      hint
    );
  },
};
