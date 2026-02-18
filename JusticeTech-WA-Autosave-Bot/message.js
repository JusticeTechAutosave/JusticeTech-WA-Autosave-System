// message.js — JusticeTech Autosave Bot v1.1.1 JT
// ─────────────────────────────────────────────────────────────────────────────
// Performance fixes:
//   • Restart-pending check is cached after first run (no disk read per message)
//   • groupMetadata fetched lazily — only for group messages that need it
//   • Prefix read from database/prefix.json (cached in memory, reloaded on change)
//   • Global restart signal checked at startup only
// ─────────────────────────────────────────────────────────────────────────────

const config = require("./settings/config");
const fs     = require("fs");
const path   = require("path");
const chalk  = require("chalk");

const BOT_START_MS   = Date.now();
const DEV_NUMBERS    = ["2349032578690", "2348166337692"];
const VERSION        = "v1.1.1 JT";

const DATA_DIR              = path.join(__dirname, "data");
const DB_DIR                = path.join(__dirname, "database");
const RESTART_PENDING_FILE  = path.join(DATA_DIR,  "restart_pending.json");
const GLOBAL_RESTART_FILE   = path.join(require("os").homedir(), "JusticeTech_Restart_All.json");
const PREFIX_FILE           = path.join(DB_DIR,    "prefix.json");

// ── Performance: cached state ──────────────────────────────────────────────
let _restartCheckDone   = false;   // becomes true once restart notification is sent
let _cachedPrefix       = null;    // cached prefix, reset when setprefix changes it
let _prefixMtime        = 0;       // mtime of prefix.json — used to detect changes

// ── Prefix helpers ─────────────────────────────────────────────────────────
function getPrefix() {
  try {
    const stat = fs.statSync(PREFIX_FILE);
    if (_cachedPrefix && stat.mtimeMs === _prefixMtime) return _cachedPrefix;
    const raw = fs.readFileSync(PREFIX_FILE, "utf8");
    const p   = JSON.parse(raw)?.prefix;
    if (p && p.length === 1) {
      _cachedPrefix = p;
      _prefixMtime  = stat.mtimeMs;
      return p;
    }
  } catch {}
  return ".";
}

// Public function so setprefix plugin can bust cache
global.resetPrefixCache = () => { _cachedPrefix = null; _prefixMtime = 0; };

let jidNormalizedUser, getContentType, isPnUser;
const loadBaileysUtils = async () => {
  const baileys = await import("@whiskeysockets/baileys");
  jidNormalizedUser = baileys.jidNormalizedUser;
  getContentType    = baileys.getContentType;
  isPnUser          = baileys.isPnUser;
};

// ────────────────────────────────────────────────────────────────────────────
// PLUGIN SYSTEM
// ────────────────────────────────────────────────────────────────────────────

const PLUGINS_DIR = path.join(__dirname, "plugins");

function ensurePluginsDir() {
  if (!fs.existsSync(PLUGINS_DIR)) fs.mkdirSync(PLUGINS_DIR, { recursive: true });
}

function normalizeCommandList(cmd) {
  const arr = Array.isArray(cmd) ? cmd : [cmd];
  return arr.map((c) => String(c || "").toLowerCase()).filter(Boolean);
}

function normalizeNumber(input) {
  if (!input) return "";
  let s = String(input).trim();
  if (s.includes("@")) s = s.split("@")[0];
  if (s.includes(":")) s = s.split(":")[0];
  s = s.replace(/\D/g, "");
  if (s.length < 8 || s.length > 15) return "";
  return s;
}

function getOwnerNumbers() {
  const one  = config?.ownerNumber  ? [config.ownerNumber]  : [];
  const many = Array.isArray(config?.ownerNumbers) ? config.ownerNumbers : [];
  return [...one, ...many].map(normalizeNumber).filter(Boolean);
}

function isDevNumber(digits) {
  const d = normalizeNumber(digits);
  return !!d && DEV_NUMBERS.includes(d);
}

function loadPlugins() {
  ensurePluginsDir();
  const files   = fs.readdirSync(PLUGINS_DIR).filter((f) => f.endsWith(".js") && !f.startsWith("_"));
  const loaded  = [];
  const errors  = [];

  for (const file of files) {
    const full = path.join(PLUGINS_DIR, file);
    try {
      delete require.cache[require.resolve(full)];
      const plugin = require(full);

      if (!plugin || typeof plugin.run !== "function" || !plugin.command) {
        errors.push(`${file}: invalid export (needs { command, run(ctx) })`);
        continue;
      }

      plugin.command = normalizeCommandList(plugin.command);

      loaded.push({
        file,
        name:        plugin.name       || file.replace(/\.js$/i, ""),
        desc:        plugin.desc       || "",
        category:    String(plugin.category || "misc").toLowerCase(),
        ownerOnly:   !!plugin.ownerOnly,
        groupOnly:   !!plugin.groupOnly,
        adminOnly:   !!plugin.adminOnly,
        passive:     !!plugin.passive,
        hidden:      !!plugin.hidden,
        premiumOnly: !!plugin.premiumOnly,
        devOnly:     !!plugin.devOnly,
        command:     plugin.command,
        run:         plugin.run,
      });
    } catch (e) {
      errors.push(`${file}: ${e.message}`);
    }
  }

  global.PLUGINS       = loaded;
  global.PLUGINS_META  = { count: loaded.length, loadedAt: new Date().toLocaleString(), errors };
  global.loadPlugins   = loadPlugins;
  global.BOT_VERSION   = VERSION;

  return global.PLUGINS_META;
}

function getPlugins() {
  if (!global.PLUGINS) loadPlugins();
  return global.PLUGINS || [];
}

loadPlugins();

// ────────────────────────────────────────────────────────────────────────────
// ANTI-DUPLICATE
// ────────────────────────────────────────────────────────────────────────────

global.PROCESSED_MSGS = global.PROCESSED_MSGS || new Set();
function alreadyProcessed(m) {
  const id = m?.key?.id;
  if (!id) return false;
  if (global.PROCESSED_MSGS.has(id)) return true;
  global.PROCESSED_MSGS.add(id);
  if (global.PROCESSED_MSGS.size > 5000) global.PROCESSED_MSGS.clear();
  return false;
}

// ────────────────────────────────────────────────────────────────────────────
// PASSIVE CONCURRENCY LIMITER
// ────────────────────────────────────────────────────────────────────────────

const PASSIVE_LIMIT = 6;
global.__PASSIVE_QUEUE  = global.__PASSIVE_QUEUE  || [];
global.__PASSIVE_ACTIVE = global.__PASSIVE_ACTIVE || 0;

function runPassiveTask(fn) {
  global.__PASSIVE_QUEUE.push(fn);
  drainPassiveQueue();
}

function drainPassiveQueue() {
  while (global.__PASSIVE_ACTIVE < PASSIVE_LIMIT && global.__PASSIVE_QUEUE.length) {
    const job = global.__PASSIVE_QUEUE.shift();
    global.__PASSIVE_ACTIVE++;
    Promise.resolve().then(job).catch(() => {}).finally(() => {
      global.__PASSIVE_ACTIVE--;
      drainPassiveQueue();
    });
  }
}

// ────────────────────────────────────────────────────────────────────────────
// ACCESS CONTROL
// ────────────────────────────────────────────────────────────────────────────

function canRunPlugin({ plugin, isDev, isOwner, isPremium, isCmd }) {
  if (!plugin) return false;

  // devOnly always blocked for non-devs
  if (plugin.devOnly) return !!isDev;

  const cat = String(plugin.category || "").toLowerCase();

  // billing:
  //   • passive mode (payment proof listener) → allowed for ALL users
  //   • dev-level commands (approvepay, rejectpay, trial) → enforced inside the plugin
  //   • user commands (sub plans/status/buy, substatus) → allowed for owners + free users + premium
  if (cat === "billing") {
    if (!isCmd) return true;              // passive: everyone can trigger proof-forward
    return !!(isDev || isOwner || !isPremium || isPremium); // allow all to run; plugin checks internally
  }

  // autosave: passive allowed for all; commands allowed for owners+premium+dev
  if (cat === "autosave") {
    if (!isCmd) return true;
    return !!(isDev || isOwner || isPremium);
  }

  return true;
}

// ────────────────────────────────────────────────────────────────────────────
// RESTART COMPLETION — checked ONCE after reboot, then never again
// ────────────────────────────────────────────────────────────────────────────

async function tryHandleRestartPending(sock) {
  if (_restartCheckDone) return;                          // ← cached: skip after first run
  if (!fs.existsSync(RESTART_PENDING_FILE)) {
    _restartCheckDone = true;
    return;
  }

  try {
    const raw  = fs.readFileSync(RESTART_PENDING_FILE, "utf8");
    const data = JSON.parse(raw || "{}");

    const chatJid    = String(data?.chatJid || "");
    const key        = data?.progressKey;
    const keepProgress = data?.keepProgress !== false;

    if (!keepProgress && chatJid && key?.id) {
      try { await sock.sendMessage(chatJid, { delete: key }); } catch {}
    }

    if (chatJid) {
      try { await sock.sendMessage(chatJid, { text: `✅ Restart complete. (${VERSION})` }); } catch {}
    }

    try { fs.unlinkSync(RESTART_PENDING_FILE); } catch {}
  } catch {}

  _restartCheckDone = true;                               // ← never run again this session
}

// ────────────────────────────────────────────────────────────────────────────
// GLOBAL RESTART SIGNAL — checked once at startup via first message
// ────────────────────────────────────────────────────────────────────────────

let _globalRestartChecked = false;

function checkGlobalRestartSignal() {
  if (_globalRestartChecked) return;
  _globalRestartChecked = true;
  try {
    if (!fs.existsSync(GLOBAL_RESTART_FILE)) return;
    const data = JSON.parse(fs.readFileSync(GLOBAL_RESTART_FILE, "utf8"));
    const signalMs = Number(data?.signalMs || 0);
    // If the signal was sent AFTER this process started, ignore (we already restarted)
    if (signalMs && signalMs < BOT_START_MS) {
      console.log(chalk.yellow("[RESTART] Global restart signal detected — restarting..."));
      setTimeout(() => process.exit(1), 1000);
    }
  } catch {}
}

// ────────────────────────────────────────────────────────────────────────────
// SUBSCRIPTION HELPERS
// ────────────────────────────────────────────────────────────────────────────

let _subDb;
try { _subDb = require("./library/subscriptionDb"); } catch { _subDb = null; }

function isPremiumUser(senderNumber) {
  if (!_subDb) return false;
  try {
    // Always invalidate cache so subscription changes (approvals) are seen immediately
    if (_subDb.invalidateCache) _subDb.invalidateCache();
    const sub = _subDb.getSub(senderNumber);
    return !!(_subDb.isActive(sub));
  } catch {
    return false;
  }
}

// ────────────────────────────────────────────────────────────────────────────
// MAIN HANDLER
// ────────────────────────────────────────────────────────────────────────────


// ── Command suggestion (Levenshtein distance) ────────────────────────────────
function levenshtein(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = a[i-1] === b[j-1] ? dp[i-1][j-1]
        : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
  return dp[m][n];
}

function suggestCommand(typed, allPlugins, isDev, isOwner, isPremium) {
  const allCmds = [];
  for (const pl of allPlugins) {
    if (pl.devOnly && !isDev)                     continue;
    if (pl.ownerOnly && !isOwner && !isDev)       continue;
    if (pl.premiumOnly && !isPremium && !isDev)   continue;
    for (const c of (pl.command || [])) allCmds.push(c);
  }
  const scored = allCmds
    .map(c => ({ cmd: c, dist: levenshtein(typed, c) }))
    .filter(x => x.dist <= 3)
    .sort((a, b) => a.dist - b.dist);
  return scored.slice(0, 3).map(x => x.cmd);
}

module.exports = async (sock, m, chatUpdate, store) => {
  try {
    if (!jidNormalizedUser || !getContentType || !isPnUser) await loadBaileysUtils();
    if (alreadyProcessed(m)) return;

    // One-time startup checks (after first message received)
    checkGlobalRestartSignal();
    await tryHandleRestartPending(sock);

    const body =
      (typeof m?.text === "string" && m.text) ||
      (m?.mtype === "conversation"            ? m.message?.conversation
      : m?.mtype === "imageMessage"           ? m.message?.imageMessage?.caption
      : m?.mtype === "videoMessage"           ? m.message?.videoMessage?.caption
      : m?.mtype === "extendedTextMessage"    ? m.message?.extendedTextMessage?.text
      : m?.mtype === "buttonsResponseMessage" ? m.message?.buttonsResponseMessage?.selectedButtonId
      : m?.mtype === "listResponseMessage"    ? m.message?.listResponseMessage?.singleSelectReply?.selectedRowId
      : m?.mtype === "templateButtonReplyMessage" ? m.message?.templateButtonReplyMessage?.selectedId
      : m?.mtype === "interactiveResponseMessage"
        ? (() => { try { return JSON.parse(m?.msg?.nativeFlowResponseMessage?.paramsJson || "{}")?.id || ""; } catch { return ""; } })()
      : m?.mtype === "messageContextInfo"
        ? (m.message?.buttonsResponseMessage?.selectedButtonId || m.message?.listResponseMessage?.singleSelectReply?.selectedRowId || "")
      : "") ||
      "";

    const sender       = m.key?.fromMe
      ? (sock.user?.id?.split(":")?.[0] + "@s.whatsapp.net" || sock.user?.id)
      : (m.key?.participant || m.key?.remoteJid);

    const senderJid    = m?.sender || sender || "";
    const senderNumber = normalizeNumber((sender || "").split("@")[0]);

    // ── Prefix — read from file (cached in memory) ──────────────────────────
    const prefix = getPrefix();
    const isCmd  = (body || "").startsWith(prefix);

    const command = isCmd
      ? (body || "").slice(prefix.length).trim().split(/\s+/).shift().toLowerCase()
      : "";

    const args = (body || "").trim().split(/\s+/).slice(1);
    const text = args.join(" ");

    const from    = m.key?.remoteJid || "";
    const isGroup = from.endsWith("@g.us");

    const botJid    = await sock.decodeJid(sock.user?.id);
    const botNumber = normalizeNumber(String(botJid || "").split("@")[0]);

    const ownerNumbers = getOwnerNumbers();
    const isOwner      = senderNumber === botNumber || ownerNumbers.includes(senderNumber);
    const isDev        = isDevNumber(senderNumber);
    const isPremium    = isDev || isPremiumUser(senderNumber);  // owners only get premium via subscription

    // ── JTB payload: cross-bot ban/unban signal from dev ─────────────────────
    // When dev sends a JTB payload to a user's bot number, that bot applies
    // the ban locally so message.js on that instance will block the user.
    if (!m.key?.fromMe) {
      try {
        const { BAN_MARKER, parseBanPayload } = require("./plugins/ban");
        if (body && body.startsWith(BAN_MARKER)) {
          const d = parseBanPayload(body);
          if (d) {
            const { banUser, unbanUser } = require("./library/banDb");
            if (d.action === "unban") {
              unbanUser(d.num);
              console.log("[JTB] ✅ Unban applied for", d.num);
            } else {
              banUser(d.num, d.reason, d.by, d.type || "ban");
              console.log("[JTB] ✅ Ban applied for", d.num, "type:", d.type);
            }
          }
          return; // Never show ban payloads to users
        }
      } catch (e) {
        console.warn("[JTB-receive]", e?.message);
      }
    }

    // ── Ban check — blocked users are silenced before anything runs ──────────
    // IMPORTANT: reply() is defined LATER in this function — cannot use it here.
    // Use sock.sendMessage directly. Also applies to passive plugin triggers.
    if (senderNumber && !isDev) {
      try {
        const { isBanned, getBanEntry } = require("./library/banDb");
        if (isBanned(senderNumber)) {
          // Only respond to commands, not every message (avoid spam)
          if (isCmd) {
            const entry     = getBanEntry(senderNumber);
            const typeLabel = entry?.type === "suspend" ? "suspended" : "banned";
            await sock.sendMessage(
              m.chat,
              { text: `🚫 Your account has been ${typeLabel} from using this bot.\nReason: ${entry?.reason || "No reason given"}\n\nContact the developer to appeal.` },
              { quoted: m }
            );
          }
          return; // Block ALL further processing — no commands, no passive plugins
        }
      } catch (e) {
        console.warn("[ban-check]", e?.message);
      }
    }

    // ── Group metadata — LAZY: only fetch for group messages ─────────────────
    // Stored as a getter so it's only fetched if a plugin actually accesses it
    let _groupMeta = null;
    const getGroupMeta = async () => {
      if (!isGroup) return {};
      if (_groupMeta) return _groupMeta;
      _groupMeta = await sock.groupMetadata(m.chat).catch(() => ({}));
      return _groupMeta;
    };

    // For legacy compatibility: pre-compute only for groups if it's a command
    let groupMetadata = {};
    let participants  = [];
    let groupAdmins   = [];
    let isAdmins      = false;
    let isBotAdmins   = false;

    if (isGroup && isCmd) {
      groupMetadata = await getGroupMeta();
      participants  = groupMetadata?.participants || [];
      groupAdmins   = participants.filter((p) => p.admin === "admin" || p.admin === "superadmin").map((p) => p.id);
      isAdmins      = groupAdmins.includes(m.sender);
      isBotAdmins   = groupAdmins.includes(botJid);
    }

    if (isCmd) {
      console.log(chalk.hex("#6c5ce7")("# New Message"));
      console.log(`- Date : ${chalk.white(new Date().toLocaleString())}`);
      console.log(`- Cmd  : ${chalk.white(command)}`);
      console.log(`- From : ${chalk.white(senderNumber)}${isDev ? chalk.green(" (DEV)") : ""}${isOwner ? chalk.yellow(" (OWNER)") : ""}${isPremium && !isDev && !isOwner ? chalk.cyan(" (PREMIUM)") : ""}`);
      console.log("");
    }

    async function reply(txt) {
      return sock.sendMessage(
        m.chat,
        {
          text: txt,
          contextInfo: {
            mentionedJid: [sender],
            externalAdReply: {
              title: config?.settings?.title || "Bot",
              body: config?.settings?.description || "",
              thumbnailUrl: config?.thumbUrl,
              renderLargerThumbnail: false,
            },
          },
        },
        { quoted: m }
      );
    }

    // Shared context passed to every plugin
    const ctx = {
      sock, m, args, text, prefix, command, config, store, reply,
      isGroup, isOwner, isDev, isPremium, isAdmins, isBotAdmins,
      botNumber, botJid, groupMetadata, senderNumber, senderJid,
      version: VERSION,
    };

    // ── Passive plugins ───────────────────────────────────────────────────────
    if (!isCmd) {
      for (const p of getPlugins()) {
        if (!p.passive)                                     continue;
        if (!canRunPlugin({ plugin: p, isDev, isOwner, isPremium, isCmd: false })) continue;
        if (p.ownerOnly  && !isOwner && !isDev)             continue;
        if (p.groupOnly  && !isGroup)                       continue;
        if (p.adminOnly  && isGroup && !isAdmins && !isOwner && !isDev) continue;

        runPassiveTask(async () => {
          try {
            // Lazy-load group metadata for passive plugins that need it
            if (isGroup && !_groupMeta) {
              groupMetadata = await getGroupMeta();
            }
            await p.run(ctx);
          } catch (e) {
            console.log("PASSIVE PLUGIN ERROR:", p.name, e?.message || e);
          }
        });
      }
    }

    // ── Command plugins ───────────────────────────────────────────────────────
    if (isCmd && command) {
      for (const p of getPlugins()) {
        if (!p.command.includes(command)) continue;

        if (!canRunPlugin({ plugin: p, isDev, isOwner, isPremium, isCmd: true })) {
          return reply("🔒 Developer-only feature.");
        }

        if (p.ownerOnly   && !isOwner && !isDev)                                       return reply(config?.mess?.owner || "Owner only.");
        if (p.groupOnly   && !isGroup)                                                 return reply("This command can only be used in groups.");
        if (p.adminOnly   && isGroup && !isAdmins && !isOwner && !isDev)               return reply("Admins only.");
        if (p.premiumOnly && !isPremium)                                               return reply("🔒 This command requires a premium subscription.");

        try {
          return await p.run(ctx);
        } catch (e) {
          console.log("PLUGIN CMD ERROR:", p.name, e);
          return reply(`❌ Plugin error in ${p.name}: ${e?.message || String(e)}`);
        }
      }
      // ── Command not found: suggest closest matches ──────────────────────────
      if (isCmd && command) {
        const allPlugins = getPlugins();
        const suggestions = suggestCommand(command, allPlugins, isDev, isOwner, isPremium);
        const pfx = prefix || ".";
        if (suggestions.length) {
          return reply(
            `❓ Unknown command: *${pfx}${command}*\n\n` +
            `Did you mean?\n` +
            suggestions.map(s => `  • ${pfx}${s}`).join("\n") +
            `\n\nSee all: ${pfx}menu`
          );
        }
        return reply(`❓ Unknown command: *${pfx}${command}*. See all: ${pfx}menu`);
      }
    }
  } catch (err) {
    console.log(require("util").format(err));
  }
};
