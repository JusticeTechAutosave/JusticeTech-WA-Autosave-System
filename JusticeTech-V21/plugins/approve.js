// plugins/approve.js (Option C: DEV-only; approval not used for access)

const { DEV_NUMBERS, listApproved } = require("../library/approvalDb");

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

function isDev(m) {
  const d = normalizeNumber(jidFromCtx(m));
  return !!d && DEV_NUMBERS.includes(d);
}

module.exports = {
  name: "Approval",
  category: "autosave",
  desc: "DEV-only helper (Option C build)",
  command: ["approve", "revoke", "approved"],
  devOnly: true,

  run: async ({ reply, m, prefix, command }) => {
    const p = prefix || ".";
    if (!isDev(m)) return reply("🔒 Developer-only feature.");

    const cmd = String(command || "").toLowerCase();

    if (cmd === "approved") {
      const list = listApproved();
      return reply(
        `✅ Approved list (info only)\n\n` +
          (list.length ? list.map((n) => `• +${n}`).join("\n") : "(empty)") +
          `\n\nNote: Option C locks Autosave + Billing to DEV only.`
      );
    }

    return reply(
      "✅ Option C is enabled.\n\n" +
        "Approval is not used to grant access in this build.\n" +
        "Autosave + Billing are DEV-only.\n\n" +
        "Use:\n" +
        `${p}linkgoogle <number> <email(optional)>\n` +
        `${p}oauth CODE\n` +
        `${p}googleinfo\n`
    );
  },
};