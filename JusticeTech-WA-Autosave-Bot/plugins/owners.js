// plugins/owners.js — JusticeTech Autosave Bot v1.1.1 JT
// ─────────────────────────────────────────────────────────────────────────────
// DEV-ONLY: List all registered bot owners and premium users.
//
// Source of truth: database/approved_owners.json (central registry)
// Written every time dev runs .approvepay or .givesub
//
// Dev numbers are ALWAYS excluded from all lists.
//
// COMMANDS:
//   .owners              — summary list (non-dev owners only)
//   .owners premium      — only users with active subscriptions
//   .owners all          — full details + sub status
//   .owners expired      — lapsed subscriptions
// ─────────────────────────────────────────────────────────────────────────────

"use strict";

const { getAllRegisteredNumbers, getRegisteredOwner } = require("../library/ownerRegistryDb");
const { getSub, isActive, invalidateCache } = require("../library/subscriptionDb");

const DEV_NUMBERS = new Set(["2349032578690", "2348166337692"]);

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
  return DEV_NUMBERS.has(normalizeNumber(jidFromCtx(m)));
}

function fmtDate(ms) {
  if (!ms) return "—";
  const d = new Date(Number(ms));
  if (!Number.isFinite(d.getTime())) return "—";
  const p = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function planLabel(p) {
  if (!p) return "?";
  const map = { monthly:"Monthly", m3:"3 Months", m6:"6 Months", yearly:"1 Year", referral_reward:"Referral" };
  if (map[p]) return map[p];
  const t = String(p).match(/^trial_(\d+)h$/);
  if (t) return `Trial ${t[1]}h`;
  return p;
}

// Build full owner list from central registry + live sub check
function collectAllOwners() {
  // Invalidate sub cache so live status is always fresh
  try { invalidateCache(); } catch {}

  const numbers = getAllRegisteredNumbers().filter(n => !DEV_NUMBERS.has(n));
  if (!numbers.length) return [];

  return numbers.map(num => {
    const reg = getRegisteredOwner(num) || {};
    // Try to get live sub status from this bot's subscriptionDb
    // (Works if this IS the owner's bot; gracefully returns null otherwise)
    let sub = null;
    try {
      const liveSub = getSub(num);
      if (liveSub) {
        sub = {
          plan:      liveSub.plan,
          active:    isActive(liveSub),
          expiresMs: liveSub.expiresAtMs || 0,
          expiresAt: fmtDate(liveSub.expiresAtMs),
        };
      }
    } catch {}

    // Fall back to registry data if live sub not available
    if (!sub && reg.expiresAtMs) {
      sub = {
        plan:      reg.plan,
        active:    Number(reg.expiresAtMs) > Date.now(),
        expiresMs: reg.expiresAtMs,
        expiresAt: fmtDate(reg.expiresAtMs),
      };
    }

    return { number: num, sub, reg };
  });
}

module.exports = {
  name: "Owners",
  category: "core",
  desc: "Dev-only: list all registered bot owners and premium users",
  command: ["owners", "listowners", "ownerlist"],
  devOnly: true,

  run: async ({ reply, m, args, prefix }) => {
    if (!isDevJid(m)) return reply("🔒 Developer-only feature.");

    const pfx = prefix || ".";
    const sub = String(args?.[0] || "").toLowerCase().trim();
    const all = collectAllOwners();

    if (!all.length) {
      return reply(
        `📋 No registered owners yet.\n\n` +
        `Owners are registered when you:\n` +
        `  • Run .approvepay after a payment\n` +
        `  • Run .givesub <number> <plan>`
      );
    }

    // ── .owners premium ───────────────────────────────────────────────────────
    if (sub === "premium") {
      const premium = all.filter(o => o.sub?.active);
      if (!premium.length) return reply("📋 No active premium users found.");
      const lines = premium.map((o, i) => [
        `${i+1}. +${o.number}`,
        `   Plan    : ${planLabel(o.sub.plan)}`,
        `   Expires : ${o.sub.expiresAt}`,
        `   Ref     : ${o.reg?.ref || "—"}`,
      ].join("\n")).join("\n\n");
      return reply(`🔒 *Active Premium Users* (${premium.length})\n\n${lines}`);
    }

    // ── .owners expired ───────────────────────────────────────────────────────
    if (sub === "expired") {
      const expired = all.filter(o => o.sub && !o.sub.active);
      if (!expired.length) return reply("📋 No expired subscriptions found.");
      const lines = expired.map((o, i) => [
        `${i+1}. +${o.number}`,
        `   Plan    : ${planLabel(o.sub.plan)} (EXPIRED)`,
        `   Expired : ${o.sub.expiresAt}`,
      ].join("\n")).join("\n\n");
      return reply(`📋 *Expired Subscriptions* (${expired.length})\n\n${lines}`);
    }

    // ── .owners all ───────────────────────────────────────────────────────────
    if (sub === "all") {
      const lines = all.map((o, i) => {
        const subLine = o.sub
          ? (o.sub.active
              ? `   🔒 Active — ${planLabel(o.sub.plan)} (expires ${o.sub.expiresAt})`
              : `   ❌ Expired — ${planLabel(o.sub.plan)} (${o.sub.expiresAt})`)
          : `   🌐 No sub data`;
        const approvedLine = o.reg?.approvedAt
          ? `   Approved : ${String(o.reg.approvedAt).split("T")[0]}`
          : "";
        const refLine = o.reg?.ref ? `   Ref      : ${o.reg.ref}` : "";
        return [`${i+1}. +${o.number}`, subLine, approvedLine, refLine].filter(Boolean).join("\n");
      }).join("\n\n");

      const activeCount  = all.filter(o => o.sub?.active).length;
      const expiredCount = all.filter(o => o.sub && !o.sub.active).length;
      const noSubCount   = all.filter(o => !o.sub).length;

      return reply(
        `📋 *All Registered Owners* (${all.length})\n` +
        `🔒 Active: ${activeCount}  ❌ Expired: ${expiredCount}  🌐 Unknown: ${noSubCount}\n\n` +
        lines
      );
    }

    // ── .owners (default) — summary ───────────────────────────────────────────
    const activeCount  = all.filter(o => o.sub?.active).length;
    const expiredCount = all.filter(o => o.sub && !o.sub.active).length;
    const noSubCount   = all.filter(o => !o.sub).length;

    const lines = all.map((o, i) => {
      const status = o.sub?.active ? "🔒" : o.sub ? "❌" : "🌐";
      return `  ${i+1}. ${status} +${o.number}`;
    }).join("\n");

    return reply([
      `📋 *Registered Bot Owners — Summary*`,
      ``,
      `Total: ${all.length}  🔒 Active: ${activeCount}  ❌ Expired: ${expiredCount}  🌐 Unknown: ${noSubCount}`,
      ``,
      lines,
      ``,
      `────────────────────────`,
      `${pfx}owners all        — full details`,
      `${pfx}owners premium    — active subscribers only`,
      `${pfx}owners expired    — lapsed subscriptions`,
    ].join("\n"));
  },
};
