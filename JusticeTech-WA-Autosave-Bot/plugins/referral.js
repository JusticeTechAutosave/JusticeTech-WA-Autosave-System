// plugins/referral.js — JusticeTech Autosave Bot v1.1.1 JT
// ─────────────────────────────────────────────────────────────────────────────
// Referral system with conversational registration flow.
//
// FLOW: .referral → bot asks name → user sends name → bot asks number →
//       user sends number → bot asks email → user sends email →
//       bot shows summary → user confirms YES → link sent on WA + email
//
// KEY FIX: Registration flow processes ALL messages regardless of fromMe,
// because bot owners message from their linked device (fromMe=true).
// ─────────────────────────────────────────────────────────────────────────────

"use strict";

const fs   = require("fs");
const path = require("path");

let googleApis;
try { googleApis = require("googleapis"); } catch {}

const {
  getUser,
  getUserByCode,
  registerUser,
  onSubscribed,
  getAllUsers,
  getLeaderboard,
  normalizeNumber,
  REFERRALS_NEEDED,
  REWARD_DAYS,
} = require("../library/referralDb");

let getAuthedClientForUser;
try { ({ getAuthedClientForUser } = require("../library/googleTenantAuth")); } catch {}

const DEV_NUMBERS = ["2349032578690", "2348166337692"];
const DEV_BOT_NUM = "2349032578690";

// ── Session state: key = senderNumber ────────────────────────────────────────
global.__REF_SESSIONS = global.__REF_SESSIONS || {};

function jidFromCtx(m) {
  return m?.sender || m?.key?.participant || m?.key?.remoteJid || "";
}

function isDevNum(n) {
  return DEV_NUMBERS.includes(normalizeNumber(n));
}

function isEmailValid(e) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e || "").trim());
}

async function sendReferralEmail(ownerNumber, recipientEmail, name, code, link) {
  if (!googleApis || !getAuthedClientForUser) return { ok: false, error: "Gmail not available" };
  const auth = getAuthedClientForUser(ownerNumber);
  if (!auth) return { ok: false, error: "No linked Google account" };
  try {
    const gmail = googleApis.google.gmail({ version: "v1", auth });
    const body  = [
      `Hello ${name},`,
      ``,
      `Your referral code: ${code}`,
      `Your referral link: ${link}`,
      ``,
      `When ${REFERRALS_NEEDED} people you refer subscribe to any plan, you earn ${REWARD_DAYS} FREE days.`,
      `If you already have an active subscription, those days are added to it.`,
      ``,
      `Track progress: message the bot with .referral stats`,
      ``,
      `— JusticeTech Bot System`,
    ].join("\n");
    const mime = [
      "MIME-Version: 1.0", "From: me", `To: ${recipientEmail}`,
      `Subject: Your JusticeTech Referral Link`,
      `Content-Type: text/plain; charset="UTF-8"`, "", body,
    ].join("\n");
    await gmail.users.messages.send({ userId: "me", requestBody: { raw: Buffer.from(mime).toString("base64url") } });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ── Core session handler — processes one step of the flow ─────────────────────
// Returns true if it handled the message (caller should not process further).
async function handleSession(senderNum, text, chatJid, sock, pfx, botNum) {
  const session = global.__REF_SESSIONS[senderNum];
  if (!session || !session.step) return false;

  const t = String(text || "").trim();

  // ── await_name ────────────────────────────────────────────────────────────
  if (session.step === "await_name") {
    if (!t || t.length < 2 || t.length > 60) {
      await sock.sendMessage(chatJid, {
        text: "❌ Please enter your real name (2–60 characters).\n\nExample: Justice Maxwell",
      });
      return true;
    }
    session.data = session.data || {};
    session.data.name = t;
    session.step = "await_number";
    await sock.sendMessage(chatJid, {
      text: `✅ Name saved: *${t}*\n\n📱 Now send your WhatsApp number (with country code):\n\nExample: 2348012345678`,
    });
    return true;
  }

  // ── await_number ──────────────────────────────────────────────────────────
  if (session.step === "await_number") {
    const num = normalizeNumber(t);
    if (!num) {
      await sock.sendMessage(chatJid, {
        text: "❌ Invalid number. Include your country code.\n\nExample: 2348012345678",
      });
      return true;
    }
    session.data.phone = num;
    session.step = "await_email";
    await sock.sendMessage(chatJid, {
      text: `✅ Number: *+${num}*\n\n📧 Now send your email address:`,
    });
    return true;
  }

  // ── await_email ───────────────────────────────────────────────────────────
  if (session.step === "await_email") {
    if (!isEmailValid(t)) {
      await sock.sendMessage(chatJid, {
        text: "❌ Invalid email address.\n\nExample: yourname@gmail.com",
      });
      return true;
    }
    session.data.email = t.toLowerCase();
    session.step = "await_confirm";
    await sock.sendMessage(chatJid, {
      text: [
        `📋 *Please confirm your details:*`,
        ``,
        `👤 Name:   ${session.data.name}`,
        `📱 Number: +${session.data.phone}`,
        `📧 Email:  ${session.data.email}`,
        ``,
        `Reply *YES* to confirm and get your referral link.`,
        `Reply *NO* to cancel.`,
      ].join("\n"),
    });
    return true;
  }

  // ── await_confirm ─────────────────────────────────────────────────────────
  if (session.step === "await_confirm") {
    const answer = t.toUpperCase();

    if (answer === "NO" || answer === "CANCEL") {
      delete global.__REF_SESSIONS[senderNum];
      await sock.sendMessage(chatJid, { text: `❌ Registration cancelled. Use ${pfx}referral to start again.` });
      return true;
    }

    if (answer !== "YES" && answer !== "Y") {
      await sock.sendMessage(chatJid, { text: "Please reply *YES* to confirm or *NO* to cancel." });
      return true;
    }

    // Register
    const result = registerUser({
      phone:          session.data.phone,
      name:           session.data.name,
      email:          session.data.email,
      referredByCode: session.referredByCode || null,
      devJid:         DEV_BOT_NUM,
    });

    delete global.__REF_SESSIONS[senderNum];
    const user = result.user;

    await sock.sendMessage(chatJid, {
      text: [
        `🎉 *Registration Complete!*`,
        ``,
        `Your referral code: *${user.referralCode}*`,
        `Your referral link:`,
        user.referralLink,
        ``,
        `📊 Earn *${REWARD_DAYS} FREE days* when ${REFERRALS_NEEDED} people you refer subscribe.`,
        `Already subscribed? Days are added to your plan.`,
        ``,
        `Track progress: ${pfx}referral stats`,
      ].join("\n"),
    });

    // Email
    const emailResult = await sendReferralEmail(botNum, user.email, user.name, user.referralCode, user.referralLink);
    if (emailResult.ok) {
      await sock.sendMessage(chatJid, { text: `📧 Link also sent to *${user.email}*` });
    } else {
      await sock.sendMessage(chatJid, { text: `ℹ️ Could not send email (${emailResult.error}). Save your link above.` });
    }
    return true;
  }

  return false;
}

// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  name: "Referral",
  category: "info",
  desc: "Refer friends, earn 30 free days when 5 subscribe",
  command: ["referral", "refer", "ref"],
  passive: true,

  run: async (ctx) => {
    const { sock, m, args, prefix, command, senderNumber, isDev, botNumber, botJid } = ctx;
    const pfx = prefix || ".";

    // Resolve sender number — works for both fromMe (owner's own device) and regular messages
    const senderNum = normalizeNumber(senderNumber || jidFromCtx(m));
    const chatJid   = m?.chat || m?.key?.remoteJid || "";
    const botNum    = normalizeNumber(botNumber || (botJid ? String(botJid).split("@")[0] : "") || "");

    // Raw message text (works for all message types)
    const rawBody = String(
      m?.text || m?.body || m?.message?.conversation ||
      m?.message?.extendedTextMessage?.text || ""
    ).trim();

    const isCmd = rawBody.startsWith(pfx);

    // ── Passive: handles registration flow + ref code detection ──────────────
    // NOTE: Do NOT gate on isFromMe — bot owners message from their linked device
    // where fromMe=true. We need to process ALL messages when a session is active.
    if (!isCmd) {
      // Check if sender has an active registration session → handle it
      if (global.__REF_SESSIONS[senderNum]?.step) {
        await handleSession(senderNum, rawBody, chatJid, sock, pfx, botNum);
        return;
      }

      // Detect ref code (ref-JT-XXXXX) from incoming messages (non-owners arriving via link)
      if (!m?.key?.fromMe) {
        const refMatch = rawBody.match(/^ref-(JT-[A-Z0-9]+)$/i);
        if (refMatch) {
          const code     = refMatch[1].toUpperCase();
          const referrer = getUserByCode(code);
          if (referrer && referrer.phone !== senderNum) {
            global.__REF_SESSIONS[senderNum] = global.__REF_SESSIONS[senderNum] || {};
            global.__REF_SESSIONS[senderNum].referredByCode = code;
            await sock.sendMessage(chatJid, {
              text: [
                `🎉 You were referred by *${referrer.name}*!`,
                ``,
                `Use ${pfx}referral to register and get your own link.`,
                `Refer ${REFERRALS_NEEDED} subscribers → earn *${REWARD_DAYS} FREE days*!`,
              ].join("\n"),
            });
          }
        }
      }
      return;
    }

    // ── Command mode ──────────────────────────────────────────────────────────
    const sub = String(args?.[0] || "").toLowerCase().trim();

    // ── DEV: .referral leaderboard ────────────────────────────────────────────
    if (sub === "leaderboard" || sub === "lb") {
      if (!isDev) return ctx.reply("🔒 Developer-only.");
      const board = getLeaderboard();
      if (!board.length) return ctx.reply("📊 No referrals recorded yet.");
      const lines = board.map((u, i) => {
        return [
          `${String(i+1).padStart(2)}. *${u.name}* (+${u.phone})`,
          `    ✅ ${u.successfulReferrals.length} successful  ⏳ ${u.pendingReferrals.length} pending  🎁 ${Math.floor(u.successfulReferrals.length / REFERRALS_NEEDED)} rewards`,
        ].join("\n");
      }).join("\n\n");
      return ctx.reply(`🏆 *Referral Leaderboard* (${board.length})\n\n${lines}\n\n${pfx}referral all — full details`);
    }

    // ── DEV: .referral all ────────────────────────────────────────────────────
    if (sub === "all") {
      if (!isDev) return ctx.reply("🔒 Developer-only.");
      const users = getAllUsers();
      if (!users.length) return ctx.reply("📊 No registrations yet.");
      const lines = users.map((u, i) => [
        `${i+1}. *${u.name}*`,
        `   📱 +${u.phone}`,
        `   📧 ${u.email}`,
        `   🔗 ${u.referralCode}`,
        `   ✅ ${u.successfulReferrals.length} referred  ⏳ ${u.pendingReferrals.length} pending`,
        `   Joined: ${u.registeredAt?.split("T")[0]}`,
      ].join("\n")).join("\n\n");
      return ctx.reply(`📋 *All Referral Registrations* (${users.length})\n\n${lines}`);
    }

    // ── DEV: .referral credit <phone> ─────────────────────────────────────────
    if (sub === "credit") {
      if (!isDev) return ctx.reply("🔒 Developer-only.");
      const targetNum = normalizeNumber(args[1]);
      if (!targetNum) return ctx.reply(`Usage: ${pfx}referral credit <phone>`);
      const result = onSubscribed(targetNum);
      if (!result) return ctx.reply(`⚠️ Could not credit +${targetNum}. Not registered or no referrer.`);
      if (result.rewardEarned) {
        try {
          const { activateSub, getSub, isActive } = require("../library/subscriptionDb");
          const existing = getSub(result.referrer.phone);
          if (isActive(existing) && existing.expiresAtMs) {
            const days = Math.ceil((existing.expiresAtMs + result.rewardDays * 86400000 - Date.now()) / 86400000);
            activateSub(result.referrer.phone, existing.plan, days, "referral", "system");
          } else {
            activateSub(result.referrer.phone, "referral_reward", result.rewardDays, "referral", "system");
          }
        } catch {}
        try {
          await sock.sendMessage(`${result.referrer.phone}@s.whatsapp.net`, {
            text: `🎉 *Referral Reward!*\n\n*${result.subscriberName}* just subscribed!\n\n🎁 ${result.rewardDays} FREE days added to your account!`,
          });
        } catch {}
      }
      return ctx.reply(`✅ Credited. ${result.referrer.name}'s score: ${result.successCount}`);
    }

    // ── .referral link ────────────────────────────────────────────────────────
    if (sub === "link") {
      const user = getUser(senderNum);
      if (!user) return ctx.reply(`❌ Not registered yet.\nUse ${pfx}referral to sign up.`);
      return ctx.reply(`🔗 *Your Referral Link*\n\n${user.referralLink}\n\nCode: *${user.referralCode}*\n\n${REFERRALS_NEEDED} subscribers = ${REWARD_DAYS} FREE days!\n\n${pfx}referral stats — see progress`);
    }

    // ── .referral stats ───────────────────────────────────────────────────────
    if (sub === "stats" || sub === "status") {
      const user = getUser(senderNum);
      if (!user) return ctx.reply(`❌ Not registered.\nUse ${pfx}referral to sign up.`);
      const success     = user.successfulReferrals.length;
      const pending     = user.pendingReferrals.length;
      const nextNeeded  = REFERRALS_NEEDED - (success % REFERRALS_NEEDED || REFERRALS_NEEDED);
      const totalRewards = Math.floor(success / REFERRALS_NEEDED);

      const loadUser = p => { try { return require("../library/referralDb").getUser(p); } catch { return null; } };
      const succLines = success ? user.successfulReferrals.slice(-10).map((p, i) => { const u = loadUser(p); return `  ${i+1}. ${u?.name || "Unknown"} (+${p}) ✅`; }).join("\n") : "  (none yet)";
      const pendLines = pending ? user.pendingReferrals.slice(-10).map((p, i)  => { const u = loadUser(p); return `  ${i+1}. ${u?.name || "Unknown"} (+${p}) ⏳`; }).join("\n") : "  (none yet)";

      return ctx.reply([
        `📊 *Your Referral Stats*`, ``,
        `Name: ${user.name}`,
        `Code: ${user.referralCode}`, ``,
        `✅ Successful: ${success}`,
        `⏳ Pending:    ${pending}`,
        `🎁 Rewards:    ${totalRewards} × ${REWARD_DAYS} days`, ``,
        `Progress: ${success % REFERRALS_NEEDED || (success > 0 ? REFERRALS_NEEDED : 0)}/${REFERRALS_NEEDED}${nextNeeded > 0 && nextNeeded < REFERRALS_NEEDED ? ` — ${nextNeeded} more needed` : success > 0 ? ` — milestone reached!` : ""}`, ``,
        `✅ *Successful Referrals:*`, succLines, ``,
        `⏳ *Pending Referrals:*`,   pendLines, ``,
        `🔗 ${user.referralLink}`,
      ].join("\n"));
    }

    // ── .referral reset ───────────────────────────────────────────────────────
    if (sub === "reset") {
      delete global.__REF_SESSIONS[senderNum];
      return ctx.reply(`✅ Session cleared. Use ${pfx}referral to start.`);
    }

    // ── .referral (no arg) — dashboard or start registration ─────────────────
    const existing = getUser(senderNum);
    if (existing) {
      return ctx.reply([
        `👤 *Referral Dashboard*`, ``,
        `Name: ${existing.name}`,
        `Code: *${existing.referralCode}*`,
        `Link: ${existing.referralLink}`, ``,
        `✅ Successful: ${existing.successfulReferrals.length}  ⏳ Pending: ${existing.pendingReferrals.length}`,
        `🎁 Rewards: ${Math.floor(existing.successfulReferrals.length / REFERRALS_NEEDED)} × ${REWARD_DAYS} days`, ``,
        `${pfx}referral stats  — detailed view`,
        `${pfx}referral link   — just your link`,
      ].join("\n"));
    }

    // Start registration
    global.__REF_SESSIONS[senderNum] = {
      step:          "await_name",
      data:          {},
      referredByCode: global.__REF_SESSIONS[senderNum]?.referredByCode || null,
    };

    return ctx.reply([
      `🤝 *JusticeTech Referral Program*`, ``,
      `Earn *${REWARD_DAYS} FREE days* when ${REFERRALS_NEEDED} people you refer subscribe.`,
      `Already subscribed? Days are added to your plan.`, ``,
      `Let's get you registered. What's your name?`,
      `(Send your name — 2 to 60 characters)`,
    ].join("\n"));
  },
};
