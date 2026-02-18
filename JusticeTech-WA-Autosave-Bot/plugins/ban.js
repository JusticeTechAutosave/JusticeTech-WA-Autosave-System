// plugins/ban.js — JusticeTech Autosave Bot v1.1.1 JT
// ─────────────────────────────────────────────────────────────────────────────
// DEV-ONLY: Ban, suspend, unban users across all bot instances.
//
// HOW CROSS-BOT BAN WORKS:
//   Dev runs .ban 234xxx on dev's bot
//   → Writes to dev's database/ban_list.json
//   → Sends a signed JTB (JusticeTech Ban) payload to target's bot number
//   → Target's bot receives the payload, validates it, writes to its own ban_list.json
//   → message.js on target's bot blocks that user on every command
//
// COMMANDS:
//   .ban <number> [reason]         — permanently ban
//   .ban suspend <number> [reason] — soft suspend (same block effect)
//   .unban <number>                — remove ban or suspension
//   .ban list                      — list all banned users
//   .ban info <number>             — details for one user
// ─────────────────────────────────────────────────────────────────────────────

"use strict";

const { banUser, unbanUser, getBanEntry, isBanned, getAllBanned } = require("../library/banDb");

const DEV_NUMBERS  = ["2349032578690", "2348166337692"];
const DEV_SET      = new Set(DEV_NUMBERS);
const BAN_MARKER   = "\u200BJTB:"; // zero-width space + JTB: — invisible in chat
const BAN_SECRET   = "JT_BAN_2025_SECRET";

// ── Payload signing ───────────────────────────────────────────────────────────

function sign(action, num, reason) {
  const raw = [action, num, reason, BAN_SECRET].join("|");
  let h = 5381;
  for (let i = 0; i < raw.length; i++) h = (((h << 5) + h) ^ raw.charCodeAt(i)) >>> 0;
  return h.toString(36).toUpperCase();
}

function buildBanPayload(action, num, reason, type) {
  return BAN_MARKER + JSON.stringify({
    action, num,
    reason: reason || "Banned by developer",
    type:   type || "ban",
    by:     DEV_NUMBERS[0],
    sig:    sign(action, num, reason || "Banned by developer"),
  });
}

function parseBanPayload(text) {
  try {
    if (!text || !text.startsWith(BAN_MARKER)) return null;
    const d = JSON.parse(text.slice(BAN_MARKER.length));
    if (!d.action || !d.num || !d.sig) return null;
    if (d.sig !== sign(d.action, d.num, d.reason)) { console.log("[JTB] bad sig"); return null; }
    return d;
  } catch { return null; }
}

// Expose for message.js passive handler
module.exports.BAN_MARKER     = BAN_MARKER;
module.exports.parseBanPayload = parseBanPayload;

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
  return DEV_SET.has(normalizeNumber(jidFromCtx(m)));
}

// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  ...module.exports,

  name: "Ban",
  category: "core",
  desc: "Dev-only: ban/suspend/unban users across all bot instances",
  command: ["ban", "unban"],
  devOnly: true,

  run: async ({ reply, sock, m, args, prefix, command }) => {
    if (!isDevJid(m)) return reply("🔒 Developer-only feature.");

    const pfx     = prefix || ".";
    const sub     = String(args?.[0] || "").toLowerCase().trim();
    const myNum   = normalizeNumber(jidFromCtx(m));

    // ── Send ban payload to target's bot (cross-bot delivery) ─────────────────
    async function deliverBan(target, reason, type) {
      const payload = buildBanPayload("ban", target, reason, type);
      try {
        await sock.sendMessage(target + "@s.whatsapp.net", { text: payload });
      } catch (e) {
        console.warn("[JTB] deliver ban failed for", target, e.message);
      }
    }

    async function deliverUnban(target) {
      const payload = buildBanPayload("unban", target, "unban", "unban");
      try {
        await sock.sendMessage(target + "@s.whatsapp.net", { text: payload });
      } catch (e) {
        console.warn("[JTB] deliver unban failed for", target, e.message);
      }
    }

    // ── .unban <number> ───────────────────────────────────────────────────────
    if (command === "unban") {
      const target = normalizeNumber(args[0] || "");
      if (!target) return reply("Usage: " + pfx + "unban <number>");

      const removed = unbanUser(target);
      if (!removed) return reply("ℹ️ +" + target + " is not currently banned or suspended.");

      // Deliver unban signal to their bot
      await deliverUnban(target);

      // Notify the user
      sock.sendMessage(target + "@s.whatsapp.net", {
        text: "✅ Your account restriction has been lifted. You can now use the bot again.",
      }).catch(() => {});

      return reply("✅ *+" + target + "* has been unbanned successfully.");
    }

    // ── .ban list ─────────────────────────────────────────────────────────────
    if (sub === "list") {
      const all = getAllBanned();
      if (!all.length) return reply("📋 No banned or suspended users.");
      const lines = all.map((e, i) =>
        (i + 1) + ". " + (e.type === "suspend" ? "🔶" : "🚫") + " +" + e.number +
        "\n   Reason: " + e.reason +
        "\n   Since:  " + String(e.bannedAt || "").split("T")[0]
      ).join("\n\n");
      return reply("🚫 *Banned / Suspended* (" + all.length + ")\n\n" + lines + "\n\n🚫 = ban  🔶 = suspend");
    }

    // ── .ban info <number> ────────────────────────────────────────────────────
    if (sub === "info") {
      const target = normalizeNumber(args[1] || "");
      if (!target) return reply("Usage: " + pfx + "ban info <number>");
      const entry = getBanEntry(target);
      if (!entry) return reply("ℹ️ +" + target + " is not banned or suspended.");
      return reply(
        "🚫 *Ban Info: +" + target + "*\n\n" +
        "Type   : " + (entry.type === "suspend" ? "🔶 Suspended" : "🚫 Banned") + "\n" +
        "Reason : " + entry.reason + "\n" +
        "Since  : " + String(entry.bannedAt || "").split("T")[0] + "\n" +
        "By     : +" + (entry.bannedBy || "unknown")
      );
    }

    // ── .ban suspend <number> [reason] ────────────────────────────────────────
    if (sub === "suspend") {
      const target = normalizeNumber(args[1] || "");
      const reason = args.slice(2).join(" ").trim() || "Suspended by developer";
      if (!target) return reply("Usage: " + pfx + "ban suspend <number> [reason]");
      if (DEV_SET.has(target)) return reply("❌ Cannot suspend a developer.");

      banUser(target, reason, myNum, "suspend");
      await deliverBan(target, reason, "suspend");

      sock.sendMessage(target + "@s.whatsapp.net", {
        text: "🔶 Your account has been suspended from this bot.\nReason: " + reason + "\n\nContact the developer if you believe this is an error.",
      }).catch(() => {});

      return reply("🔶 *+" + target + "* has been *suspended*.\nReason: " + reason);
    }

    // ── .ban <number> [reason] ────────────────────────────────────────────────
    const target = normalizeNumber(sub.replace(/^\+/, "") || "");
    const reason = args.slice(1).join(" ").trim() || "Banned by developer";

    if (!target || target.length < 8) {
      return reply(
        "🚫 *Ban Commands*\n\n" +
        pfx + "ban <number> [reason]          — ban permanently\n" +
        pfx + "ban suspend <number> [reason]  — suspend\n" +
        pfx + "unban <number>                 — remove ban or suspension\n" +
        pfx + "ban list                       — view all bans\n" +
        pfx + "ban info <number>              — ban details"
      );
    }

    if (DEV_SET.has(target)) return reply("❌ Cannot ban a developer.");

    banUser(target, reason, myNum, "ban");
    await deliverBan(target, reason, "ban");

    sock.sendMessage(target + "@s.whatsapp.net", {
      text: "🚫 Your account has been banned from this bot.\nReason: " + reason,
    }).catch(() => {});

    return reply("🚫 *+" + target + "* has been *banned*.\nReason: " + reason);
  },
};
