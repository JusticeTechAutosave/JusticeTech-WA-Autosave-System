// library/premium.js
const { getSub, isActive } = require("./subscriptionDb");

function jidFromCtx(m) {
  return m?.sender || m?.key?.participant || m?.key?.remoteJid || "";
}

function isPremiumJid(jid) {
  const sub = getSub(jid);
  return isActive(sub);
}

// Use inside plugins
function requirePremium({ m, reply }, msg = "🔒 This feature is for PREMIUM users.\nUse: .sub plans") {
  const jid = jidFromCtx(m);
  if (!isPremiumJid(jid)) {
    reply(msg);
    return false;
  }
  return true;
}

module.exports = {
  jidFromCtx,
  isPremiumJid,
  requirePremium,
};