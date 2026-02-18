// plugins/broadcast.js — JusticeTech Autosave Bot v1.1.1 JT
// ─────────────────────────────────────────────────────────────────────────────
// DEV-ONLY: Broadcast a message to all registered bot owners.
//
// Source of truth: database/approved_owners.json (central registry)
// Written every time dev runs .approvepay or .givesub
//
// Dev numbers are ALWAYS excluded from broadcasts.
//
// COMMANDS:
//   .broadcast <message>         — send to all owners
//   .broadcast list              — list recipients
//   .broadcast preview <message> — preview without sending
// ─────────────────────────────────────────────────────────────────────────────

"use strict";

const { getAllRegisteredNumbers } = require("../library/ownerRegistryDb");

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

// Get all real owner numbers from central registry — devs excluded
function getAllOwnerNumbers(senderNumber) {
  const registered = getAllRegisteredNumbers();
  return registered.filter(n => {
    if (DEV_NUMBERS.has(n)) return false;
    if (senderNumber && n === normalizeNumber(senderNumber)) return false;
    return true;
  });
}

module.exports = {
  name: "Broadcast",
  category: "core",
  desc: "Dev-only: broadcast message to all registered bot owners",
  command: ["broadcast", "bcast"],
  devOnly: true,

  run: async ({ reply, sock, m, args, prefix, senderNumber }) => {
    if (!isDevJid(m)) return reply("🔒 Developer-only feature.");

    const pfx    = prefix || ".";
    const sub    = String(args?.[0] || "").toLowerCase().trim();
    const owners = getAllOwnerNumbers(senderNumber);

    // ── .broadcast list ───────────────────────────────────────────────────────
    if (sub === "list") {
      if (!owners.length) return reply(
        `📋 No registered owners yet.\n\n` +
        `Owners are added when you run .approvepay or .givesub.`
      );
      return reply(
        `📋 *Broadcast Recipients (${owners.length})*\n\n` +
        owners.map((n, i) => `  ${i+1}. +${n}`).join("\n") +
        `\n\n${pfx}broadcast <message> to send`
      );
    }

    // ── .broadcast preview <msg> ──────────────────────────────────────────────
    if (sub === "preview") {
      const msgText = args.slice(1).join(" ").trim();
      if (!msgText) return reply(`Usage: ${pfx}broadcast preview <your message>`);
      return reply(
        `👁️ *Preview* — would send to ${owners.length} owner(s):\n\n` +
        `────────────────────\n${msgText}\n────────────────────\n\n` +
        `Send: ${pfx}broadcast <message>`
      );
    }

    // ── .broadcast <message> ──────────────────────────────────────────────────
    const msgText = args.join(" ").trim();
    if (!msgText) {
      return reply(
        `📡 *Broadcast*\n\n` +
        `Usage: ${pfx}broadcast <message>\n\n` +
        `${pfx}broadcast list             — see recipients (${owners.length} now)\n` +
        `${pfx}broadcast preview <msg>    — preview first`
      );
    }

    if (!owners.length) {
      return reply(
        `❌ No registered owners to broadcast to.\n\n` +
        `Owners are registered when you:\n` +
        `  • Run .approvepay after a payment\n` +
        `  • Run .givesub <number> <plan>`
      );
    }

    await reply(`⏳ Broadcasting to ${owners.length} owner(s)...`);

    const fullMsg = `📡 *JusticeTech Bot — Announcement*\n\n${msgText}\n\n— JusticeTech Dev Team`;
    let sent = 0, failed = 0;

    for (const num of owners) {
      try {
        await sock.sendMessage(`${num}@s.whatsapp.net`, { text: fullMsg });
        sent++;
        await new Promise(r => setTimeout(r, 600));
      } catch (e) {
        failed++;
        console.warn(`[broadcast] Failed ${num}:`, e.message);
      }
    }

    return reply(`✅ *Broadcast Complete*\n\nSent: ${sent}\nFailed: ${failed}\nTotal: ${owners.length}`);
  },
};
