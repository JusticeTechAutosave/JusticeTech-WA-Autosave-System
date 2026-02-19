// index.js (UPDATED: history sync ONLY when enabled by command via flag)
//
// Changes:
// ✅ syncFullHistory is NO LONGER always true
// ✅ History scan runs only when database/history_sync_flag.json has { enabled: true }
// ✅ After isLatest === true, flag auto-disables
// ✅ Still writes scan cache to database/scan_cache.json
// ✅ Still notifies owner with summary (only when scan was enabled)
//
// Extra fix added:
// ✅ Real-time LID -> PN mapping capture (so autosave can reply to unsaved leads using @lid ids)

console.clear();
const config = () => require("./settings/config");
process.on("uncaughtException", console.error);

let makeWASocket,
  Browsers,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  jidDecode,
  downloadContentFromMessage,
  jidNormalizedUser,
  isPnUser;

const loadBaileys = async () => {
  const baileys = await import("@whiskeysockets/baileys");

  makeWASocket = baileys.default;
  Browsers = baileys.Browsers;
  useMultiFileAuthState = baileys.useMultiFileAuthState;
  DisconnectReason = baileys.DisconnectReason;
  fetchLatestBaileysVersion = baileys.fetchLatestBaileysVersion;
  jidDecode = baileys.jidDecode;
  downloadContentFromMessage = baileys.downloadContentFromMessage;
  jidNormalizedUser = baileys.jidNormalizedUser;
  isPnUser = baileys.isPnUser;
};

const pino = require("pino");
const FileType = require("file-type");
const readline = require("readline");
const fs = require("fs");
const chalk = require("chalk");
const path = require("path");

const { Boom } = require("@hapi/boom");
const { getBuffer } = require("./library/function");
const { smsg } = require("./library/serialize");
const { videoToWebp, writeExifImg, writeExifVid, addExif, toPTT, toAudio } = require("./library/exif");

const messageHandler = require("./message");

const DB_DIR = path.join(__dirname, "database");
const SCAN_CACHE_FILE = path.join(DB_DIR, "scan_cache.json");
const HISTORY_FLAG_FILE = path.join(DB_DIR, "history_sync_flag.json");
const MAINTENANCE_FILE = path.join(DB_DIR, "maintenance.json");

// Load maintenance state into global on startup so gate works immediately
try {
  const _m = JSON.parse(fs.readFileSync(MAINTENANCE_FILE, "utf8"));
  global.__JT_MAINTENANCE = _m;
  if (_m?.active) console.log(chalk.yellow("⚠️  Maintenance mode is ACTIVE — all user commands will be blocked."));
} catch { global.__JT_MAINTENANCE = { active: false }; }

function ensureDbDir() {
  if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(file, data) {
  ensureDbDir();
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

// -------------------- HISTORY FLAG --------------------
function readHistoryFlag() {
  const d = readJson(HISTORY_FLAG_FILE, { enabled: false });
  return !!d.enabled;
}
function setHistoryFlag(enabled) {
  writeJson(HISTORY_FLAG_FILE, { enabled: !!enabled, updatedAt: new Date().toISOString() });
}
// ensure file exists
ensureDbDir();
if (!fs.existsSync(HISTORY_FLAG_FILE)) setHistoryFlag(false);

const question = (text) => {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(chalk.yellow(text), (answer) => {
      resolve(answer);
      rl.close();
    });
  });
};

// fetch helper
async function fetchBuffer(url, timeoutMs = 45000) {
  const ac = new AbortController();
  const to = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ac.signal });
    if (!res.ok) throw new Error(`Fetch failed: ${res.status} ${res.statusText}`);
    const ab = await res.arrayBuffer();
    return { res, buffer: Buffer.from(ab) };
  } finally {
    clearTimeout(to);
  }
}

// owner notify helper
function normalizeDigits(x) {
  return String(x || "").replace(/\D/g, "");
}
function getOwnerJids() {
  const cfg = config();
  const one = cfg?.ownerNumber ? [cfg.ownerNumber] : [];
  const many = Array.isArray(cfg?.ownerNumbers) ? cfg.ownerNumbers : [];
  const nums = [...one, ...many].map(normalizeDigits).filter(Boolean);
  // Remove duplicates
  const unique = [...new Set(nums)];
  return unique.map((n) => `${n}@s.whatsapp.net`);
}

function isDmJid(jid) {
  const s = String(jid || "");
  // ✅ Include both traditional @s.whatsapp.net AND modern @lid (LID contacts)
  // LID = Locally Identifiable Data (used by WhatsApp for privacy)
  return s.endsWith("@s.whatsapp.net") || s.endsWith("@lid");
}

function normalizeDmJid(jid) {
  const s = String(jid || "");
  return isDmJid(s) ? s : "";
}

function updateScanCache({ chatsCount, contactsCount, messagesCount, dmJidsSet, isLatest }) {
  const prev = readJson(SCAN_CACHE_FILE, {
    startedAt: null,
    updatedAt: null,
    isLatest: false,
    chatsCount: 0,
    contactsCount: 0,
    messagesCount: 0,
    dmJids: [],
  });

  const startedAt = prev.startedAt || new Date().toISOString();
  const merged = new Set([...(prev.dmJids || []), ...Array.from(dmJidsSet || [])]);

  const next = {
    startedAt,
    updatedAt: new Date().toISOString(),
    isLatest: !!isLatest,
    chatsCount: Number(chatsCount || 0),
    contactsCount: Number(contactsCount || 0),
    messagesCount: Number(messagesCount || 0),
    dmJids: Array.from(merged),
  };

  writeJson(SCAN_CACHE_FILE, next);
  return next;
}

const clientstart = async () => {
  await loadBaileys();

  const browserOptions = [
    Browsers.macOS("Safari"),
    Browsers.macOS("Chrome"),
    Browsers.windows("Firefox"),
    Browsers.ubuntu("Chrome"),
    Browsers.baileys("Baileys"),
    Browsers.macOS("Edge"),
    Browsers.windows("Edge"),
  ];

  const randomBrowser = browserOptions[Math.floor(Math.random() * browserOptions.length)];

  const store = {
    messages: new Map(), // `${jid}:${id}`
    contacts: new Map(), // jid -> { name/notify/... }
    groupMetadata: new Map(),
    loadMessage: async (jid, id) => store.messages.get(`${jid}:${id}`) || null,
    bind: (ev) => {
      // ✅ Capture incoming messages
      ev.on("messages.upsert", ({ messages }) => {
        for (const msg of messages || []) {
          if (msg.key?.remoteJid && msg.key?.id) {
            store.messages.set(`${msg.key.remoteJid}:${msg.key.id}`, msg);
          }
        }
      });

      // ✅ contacts.set fires on EVERY connect — populates store.contacts without needing history sync
      ev.on("contacts.set", ({ contacts: cts }) => {
        try {
          const dmJids = new Set();
          for (const c of cts || []) {
            if (!c?.id) continue;
            const existing = store.contacts.get(c.id) || {};
            store.contacts.set(c.id, {
              ...existing,
              id: c.id,
              name: c.name || existing.name || null,
              notify: c.notify || existing.notify || null,
              verifiedName: c.verifiedName || existing.verifiedName || null,
              phoneNumber: c.phoneNumber || existing.phoneNumber || null,
              lid: c.lid || existing.lid || null,
            });
            const jid = normalizeDmJid(c.id);
            if (jid) dmJids.add(jid);
          }
          // Persist to scan_cache so fetchchats/bulksave can always see all DM JIDs
          if (dmJids.size > 0) {
            updateScanCache({ chatsCount: 0, contactsCount: dmJids.size, messagesCount: 0, dmJidsSet: dmJids, isLatest: false });
            console.log(chalk.green(`[STORE] contacts.set: ${cts?.length || 0} contacts loaded, ${dmJids.size} DM JIDs cached`));
          }
        } catch (e) {
          console.log("[STORE] contacts.set error:", e?.message);
        }
      });

      // ✅ chats.set fires on EVERY connect — captures all active DM JIDs
      ev.on("chats.set", ({ chats: cts }) => {
        try {
          const dmJids = new Set();
          for (const ch of cts || []) {
            if (!ch?.id) continue;
            const jid = normalizeDmJid(ch.id);
            if (!jid) continue;
            dmJids.add(jid);
            // Merge name if provided
            if (!store.contacts.has(jid)) {
              store.contacts.set(jid, {
                id: jid,
                name: ch.name || null,
                notify: null,
                verifiedName: null,
                phoneNumber: null,
                lid: null,
              });
            } else if (ch.name) {
              const existing = store.contacts.get(jid);
              store.contacts.set(jid, { ...existing, name: ch.name });
            }
          }
          if (dmJids.size > 0) {
            updateScanCache({ chatsCount: dmJids.size, contactsCount: 0, messagesCount: 0, dmJidsSet: dmJids, isLatest: false });
            console.log(chalk.green(`[STORE] chats.set: ${cts?.length || 0} chats loaded, ${dmJids.size} DM JIDs cached`));
          }
        } catch (e) {
          console.log("[STORE] chats.set error:", e?.message);
        }
      });

      // ✅ contacts.update fires when individual contacts change (name updates etc.)
      ev.on("contacts.update", (updates) => {
        for (const u of updates || []) {
          if (!u?.id) continue;
          const existing = store.contacts.get(u.id) || { id: u.id };
          store.contacts.set(u.id, {
            ...existing,
            name: u.name ?? existing.name ?? null,
            notify: u.notify ?? existing.notify ?? null,
            verifiedName: u.verifiedName ?? existing.verifiedName ?? null,
          });
        }
      });
    },
  };

  const { state, saveCreds } = await useMultiFileAuthState(`./${config().session}`);
  const { version } = await fetchLatestBaileysVersion();

  // ✅ Only request history when flag is enabled (must be enabled BEFORE restart)
  const historyEnabled = readHistoryFlag();
  if (historyEnabled) console.log(chalk.yellow("🧾 History sync flag is ON: requesting full history on connect..."));

  const sock = makeWASocket({
    logger: pino({ level: "silent" }),
    printQRInTerminal: !config().status.terminal,
    auth: state,
    version: version,
    browser: randomBrowser,

    // ✅ request history sync only when enabled
    syncFullHistory: historyEnabled,
  });

  // IMPORTANT: set immediately
  sock.public = config().status.public;

  if (config().status.terminal && !sock.authState.creds.registered) {
    const phoneNumber = await question("Enter your WhatsApp number, starting with 234:\nnumber WhatsApp: ");
    const code = await sock.requestPairingCode(phoneNumber);
    console.log(chalk.green(`Your pairing code: ` + chalk.bold.green(code)));
  }

  store.bind(sock.ev);

  const lidMapping = sock.signalRepository.lidMapping;

  // ✅ Real-time LID -> PN mapping capture (critical for autosave + @lid senders)
  sock.ev.on("lid-mapping.update", async ({ mappings }) => {
    try {
      for (const mp of mappings || []) {
        // mapping shape can vary, so try multiple keys safely
        const rawLid = mp?.lid || mp?.LID || mp?.id || mp?.jid || "";
        const rawPn = mp?.pn || mp?.phoneNumber || mp?.PN || mp?.number || "";

        const lidDigits = String(rawLid).replace(/\D/g, "");
        const pnDigits = String(rawPn).replace(/\D/g, "");

        if (!lidDigits || !pnDigits) continue;

        const lidJid = `${lidDigits}@lid`;

        // update local cache so resolvePNFromLID() can find it
        const prev = store.contacts.get(lidJid) || { id: lidJid };
        store.contacts.set(lidJid, {
          ...prev,
          id: lidJid,
          lid: lidJid,
          phoneNumber: pnDigits,
        });

        // also store into baileys mapping repo
        try {
          await lidMapping.storeLIDPNMapping(lidJid, pnDigits);
        } catch {}
      }
    } catch {}
  });

  sock.getLIDForPN = async (phoneNumber) => {
    try {
      return await lidMapping.getLIDForPN(phoneNumber);
    } catch {
      console.log("No LID found for PN:", phoneNumber);
      return null;
    }
  };

  sock.getPNForLID = async (lid) => {
    try {
      return await lidMapping.getPNForLID(lid);
    } catch {
      console.log("No PN found for LID:", lid);
      return null;
    }
  };

  sock.storeLIDPNMapping = async (lid, phoneNumber) => {
    try {
      await lidMapping.storeLIDPNMapping(lid, phoneNumber);
      console.log(chalk.green(`✓ Stored LID<->PN mapping: ${lid} <-> ${phoneNumber}`));
    } catch (error) {
      console.log("Error storing LID/PN mapping:", error);
    }
  };

  sock.ev.on("creds.update", saveCreds);

  // ── History sync accumulator + timeout-based completion ──────────────────
  // WhatsApp often streams history batches WITHOUT ever setting isLatest=true.
  // We use a 30-second idle timer: if no new batch arrives for 30s, we treat
  // the sync as complete. The isLatest=true path is kept as a faster trigger.
  const histAccum = {
    batchCount: 0,
    chatsTotal: 0,
    contactsTotal: 0,
    messagesTotal: 0,
  };
  let histCompletionTimer = null;
  const HIST_IDLE_MS = 30_000; // 30s of silence = sync is done

  async function sendHistorySyncComplete() {
    // Only fire once — clear the timer and check flag
    clearTimeout(histCompletionTimer);
    histCompletionTimer = null;

    // Don't fire if flag was already cleared (e.g. isLatest fired first)
    if (!readHistoryFlag()) return;

    // Auto-disable flag immediately to prevent double-firing
    setHistoryFlag(false);

    const cache = readJson(SCAN_CACHE_FILE, {});
    // Mark scan as complete in the cache
    try {
      writeJson(SCAN_CACHE_FILE, {
        ...cache,
        isLatest: true,
        isComplete: true,
        completedAt: new Date().toISOString(),
      });
    } catch {}
    const msgText =
      `✅ ✅ ✅ HISTORY SCAN COMPLETE ✅ ✅ ✅\n\n` +
      `📊 Final Results:\n` +
      `━━━━━━━━━━━━━━━━━━━━━━\n` +
      `DMs discovered: ${cache.dmJids?.length || 0}\n` +
      `Batches received: ${histAccum.batchCount}\n` +
      `Chats scanned: ${histAccum.chatsTotal}\n` +
      `Contacts loaded: ${histAccum.contactsTotal}\n` +
      `Messages indexed: ${histAccum.messagesTotal}\n` +
      `━━━━━━━━━━━━━━━━━━━━━━\n\n` +
      `✅ All DM contacts are now cached in scan_cache.json\n` +
      `✅ You can now use .fetchchats to see unsaved contacts\n` +
      `✅ You can now use .bulksave to save all contacts\n\n` +
      `🔧 History sync has been auto-disabled.\n` +
      `(No need to run .historysync on again unless you want a fresh scan)`;

    console.log(chalk.green("✅ History sync complete — sending notification to owner..."));

    // ✅ FIX: Send to bot's own JID (the deploying owner), not dev's hardcoded number
    const _rawId = sock.user?.id || "";
    const _botNum = _rawId.split(":")[0].split("@")[0].replace(/\D/g, "");
    const _botSelf = _botNum ? `${_botNum}@s.whatsapp.net` : "";
    if (_botSelf) {
      try { await sock.sendMessage(_botSelf, { text: msgText }); } catch {}
    }
  }

  function rescheduleHistoryTimer() {
    clearTimeout(histCompletionTimer);
    histCompletionTimer = setTimeout(sendHistorySyncComplete, HIST_IDLE_MS);
    console.log(chalk.yellow(`[HISTORY] Timer reset — completing in ${HIST_IDLE_MS / 1000}s if no more batches arrive`));
  }

  // HISTORY SYNC: collect DMs + cache (ONLY when enabled)
  sock.ev.on("messaging-history.set", async ({ chats, contacts, messages, isLatest }) => {
    try {
      // Hard gate: ignore unless flag enabled
      if (!readHistoryFlag()) return;

      const dmJids = new Set();

      histAccum.batchCount++;
      histAccum.chatsTotal += chats?.length || 0;
      histAccum.contactsTotal += contacts?.length || 0;
      histAccum.messagesTotal += messages?.length || 0;

      console.log(
        chalk.green(
          `📥 History sync batch #${histAccum.batchCount}: chats=${chats?.length || 0}, contacts=${contacts?.length || 0}, messages=${messages?.length || 0}, isLatest=${!!isLatest}`
        )
      );

      // Send progress update to owner
      const progressText =
        `📥 History batch #${histAccum.batchCount} received:\n` +
        `• Chats: ${chats?.length || 0} (total: ${histAccum.chatsTotal})\n` +
        `• Contacts: ${contacts?.length || 0} (total: ${histAccum.contactsTotal})\n` +
        `• Messages: ${messages?.length || 0} (total: ${histAccum.messagesTotal})\n\n` +
        (isLatest
          ? `✅ WhatsApp marked this as the final batch — completing now...`
          : `⏳ More batches may follow. Auto-completing 30s after last batch.`);

      // ✅ FIX: Send progress to bot's own JID (the deploying owner)
      const _rawId2 = sock.user?.id || "";
      const _botNum2 = _rawId2.split(":")[0].split("@")[0].replace(/\D/g, "");
      const _botSelf2 = _botNum2 ? `${_botNum2}@s.whatsapp.net` : "";
      if (_botSelf2) {
        try { await sock.sendMessage(_botSelf2, { text: progressText }); } catch {}
      }

      // Process contacts
      for (const c of contacts || []) {
        if (!c?.id) continue;
        store.contacts.set(c.id, {
          id: c.id,
          lid: c.lid || null,
          phoneNumber: c.phoneNumber || null,
          name: c.name || null,
          notify: c.notify || null,
          verifiedName: c.verifiedName || null,
        });
        const jid = normalizeDmJid(c.id);
        if (jid) dmJids.add(jid);
      }

      // Process chats
      for (const ch of chats || []) {
        const jid = normalizeDmJid(ch?.id);
        if (!jid) continue;
        dmJids.add(jid);
        if (!store.contacts.has(jid)) {
          store.contacts.set(jid, { id: jid, name: ch.name || null, notify: null, verifiedName: null, phoneNumber: null, lid: null });
        }
      }

      // Process messages — extract every DM JID that has ever sent or received
      for (const msg of messages || []) {
        if (msg?.key?.remoteJid && msg?.key?.id) {
          store.messages.set(`${msg.key.remoteJid}:${msg.key.id}`, msg);
          const jid = normalizeDmJid(msg.key.remoteJid);
          if (jid) {
            dmJids.add(jid);
            if (!store.contacts.has(jid)) {
              store.contacts.set(jid, { id: jid, name: null, notify: null, verifiedName: null, phoneNumber: null, lid: null });
            }
            // Also capture the sender JID for group/incoming messages
            const senderJid = normalizeDmJid(msg?.key?.participant || msg?.pushName ? `${msg.key.remoteJid}` : "");
            // For DMs specifically, remoteJid IS the contact — already captured above
          }
        }
      }

      updateScanCache({
        chatsCount: histAccum.chatsTotal,
        contactsCount: histAccum.contactsTotal,
        messagesCount: histAccum.messagesTotal,
        dmJidsSet: dmJids,
        isLatest: false, // we manage completion ourselves via timer
      });

      // Path 1: WhatsApp explicitly signals isLatest — complete immediately
      if (isLatest) {
        console.log(chalk.green("✅ isLatest=true received — triggering immediate completion"));
        await sendHistorySyncComplete();
        return;
      }

      // Path 2: Reset idle timer — complete 30s after the last batch arrives
      rescheduleHistoryTimer();

    } catch (e) {
      console.log("History sync handler error:", e?.message || e);
      try {
        const _rawId3 = sock.user?.id || "";
        const _botNum3 = _rawId3.split(":")[0].split("@")[0].replace(/\D/g, "");
        const _botSelf3 = _botNum3 ? `${_botNum3}@s.whatsapp.net` : "";
        if (_botSelf3) {
          await sock.sendMessage(_botSelf3, { text: `❌ History sync error: ${e?.message || String(e)}` });
        }
      } catch {}
    }
  });

  sock.ev.on("messages.upsert", async (chatUpdate) => {
    try {
      if (chatUpdate.type && chatUpdate.type !== "notify") return;

      const mek = chatUpdate.messages?.[0];
      if (!mek || !mek.message) return;

      mek.message = Object.keys(mek.message)[0] === "ephemeralMessage" ? mek.message.ephemeralMessage.message : mek.message;

      if (config().status.reactsw && mek.key && mek.key.remoteJid === "status@broadcast") {
        const emoji = ["😘", "😭", "😂", "😹", "😍", "😋", "🙏", "😜", "😢", "😠", "🤫", "😎"];
        const sigma = emoji[Math.floor(Math.random() * emoji.length)];
        await sock.readMessages([mek.key]);
        await sock.sendMessage(
          "status@broadcast",
          { react: { text: sigma, key: mek.key } },
          { statusJidList: [mek.key.participant] }
        );
      }

      if (sock.public === false && !mek.key.fromMe) return;
      if (mek.key.id && mek.key.id.startsWith("BASE-") && mek.key.id.length === 12) return;

      const m = await smsg(sock, mek, store);
      await messageHandler(sock, m, chatUpdate, store);
    } catch (err) {
      console.log(err);
    }
  });

  sock.decodeJid = (jid) => {
    if (!jid) return jid;
    if (/:\d+@/gi.test(jid)) {
      const decode = jidDecode(jid) || {};
      return (decode.user && decode.server && decode.user + "@" + decode.server) || jid;
    }
    return jid;
  };

  sock.ev.on("contacts.update", (update) => {
    for (const contact of update || []) {
      const id = contact.id;
      if (store && store.contacts && id) {
        store.contacts.set(id, {
          id,
          lid: contact.lid || null,
          phoneNumber: contact.phoneNumber || null,
          name: contact.name || null,
          notify: contact.notify || null,
          verifiedName: contact.verifiedName || null,
        });
      }
    }
  });

  sock.public = config().status.public;

  let openedOnce = false;
  let startupMessageSent = false; // Flag to prevent duplicate startup messages
  
  sock.ev.on("connection.update", async (update) => {
    const { konek } = require("./library/connection/connection");
    konek({
      sock,
      update,
      clientstart,
      DisconnectReason,
      Boom,
    });

    try {
      if (update?.connection === "open") {
        const mode = sock.public === false ? "PRIVATE" : "PUBLIC";
        const userName = sock.user?.name || "JusticeTech";
        const platform = process.platform || "linux";
        const prefix = config()?.prefix || ".";
        const version = "1.1.1 JT";
        
        const isReconnect = openedOnce;
        openedOnce = true;

        // Only send startup message once per session (not on reconnects)
        if (!startupMessageSent && !isReconnect) {
          startupMessageSent = true;

          // ✅ FIX: Send startup message to the BOT'S OWN JID ("Message yourself")
          // This is the deploying owner's number — NOT config.ownerNumber which is the dev's number.
          // sock.user.id is always the number that scanned the QR / linked the session.
          const rawBotJid = sock.user?.id || "";
          const botSelfNumber = rawBotJid.split(":")[0].split("@")[0].replace(/\D/g, "");
          const botSelfJid = botSelfNumber ? `${botSelfNumber}@s.whatsapp.net` : "";

          const msg = 
            `╭──❮ *JusticeTech Autosave Bot System* ❯──╮\n` +
            `│                                              │\n` +
            `│  🚀 *Status* : Started                       │\n` +
            `│  👤 *User*   : ${userName.padEnd(29)} │\n` +
            `│  🖥️ *Platform*: ${platform.padEnd(29)} │\n` +
            `│  🔑 *Prefix* : ${prefix.padEnd(29)} │\n` +
            `│  🔒 *Mode*   : ${mode.padEnd(29)} │\n` +
            `│  📦 *Version*: ${version.padEnd(29)} │\n` +
            `│                                              │\n` +
            `│  NEW: Use .fetchchats to get all DMs         │\n` +
            `│                                              │\n` +
            `╰──❮ *Powered by JusticeTech* ❯──────────────╯`;

          // Send to the deploying owner's own DM (Message yourself)
          if (botSelfJid) {
            await sock.sendMessage(botSelfJid, { text: msg }).catch(() => {});
          }

          // ✅ Send history sync notification to the owner's own DM if enabled
          if (readHistoryFlag() && botSelfJid) {
            const historyMsg = 
              `📥 HISTORY SYNC ENABLED\n\n` +
              `The bot is now requesting your full WhatsApp history from the server.\n\n` +
              `⏱️ Estimated time: 1-5 minutes\n` +
              `📊 This will scan:\n` +
              `  • All chats\n` +
              `  • All contacts\n` +
              `  • All messages\n\n` +
              `📨 You'll receive progress updates as batches arrive.\n` +
              `✅ When complete, you'll see a final summary with total DMs found.\n\n` +
              `⏳ Please wait... Do not run commands until scan completes.`;
            await sock.sendMessage(botSelfJid, { text: historyMsg }).catch(() => {});
          }
        }
      }
    } catch (e) {
      console.log("Owner notify error:", e?.message || e);
    }
  });

  // --- keep your media helpers unchanged ---
  sock.sendText = async (jid, text, quoted = "", options) => {
    return sock.sendMessage(jid, { text: text, ...options }, { quoted });
  };

  sock.downloadMediaMessage = async (message) => {
    const mime = (message.msg || message).mimetype || "";
    const messageType = message.mtype ? message.mtype.replace(/Message/gi, "") : mime.split("/")[0];
    const stream = await downloadContentFromMessage(message, messageType);
    let buffer = Buffer.from([]);
    for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
    return buffer;
  };

  sock.sendImageAsSticker = async (jid, pathInput, quoted, options = {}) => {
    const buff = Buffer.isBuffer(pathInput)
      ? pathInput
      : /^data:.*?\/.*?;base64,/i.test(pathInput)
      ? Buffer.from(pathInput.split`,`[1], "base64")
      : /^https?:\/\//.test(pathInput)
      ? await getBuffer(pathInput)
      : fs.existsSync(pathInput)
      ? fs.readFileSync(pathInput)
      : Buffer.alloc(0);

    const buffer = options && (options.packname || options.author) ? await writeExifImg(buff, options) : await addExif(buff);
    await sock.sendMessage(jid, { sticker: { url: buffer }, ...options }, { quoted });
    return buffer;
  };

  sock.downloadAndSaveMediaMessage = async (message, filename, attachExtension = true) => {
    const quoted = message.msg ? message.msg : message;
    const mime = (message.msg || message).mimetype || "";
    const messageType = message.mtype ? message.mtype.replace(/Message/gi, "") : mime.split("/")[0];

    const stream = await downloadContentFromMessage(quoted, messageType);
    let buffer = Buffer.from([]);
    for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);

    const type = await FileType.fromBuffer(buffer);
    const trueFileName = attachExtension ? filename + "." + type.ext : filename;
    fs.writeFileSync(trueFileName, buffer);
    return trueFileName;
  };

  sock.sendVideoAsSticker = async (jid, pathInput, quoted, options = {}) => {
    const buff = Buffer.isBuffer(pathInput)
      ? pathInput
      : /^data:.*?\/.*?;base64,/i.test(pathInput)
      ? Buffer.from(pathInput.split`,`[1], "base64")
      : /^https?:\/\//.test(pathInput)
      ? await getBuffer(pathInput)
      : fs.existsSync(pathInput)
      ? fs.readFileSync(pathInput)
      : Buffer.alloc(0);

    const buffer = options && (options.packname || options.author) ? await writeExifVid(buff, options) : await videoToWebp(buff);
    await sock.sendMessage(jid, { sticker: { url: buffer }, ...options }, { quoted });
    return buffer;
  };

  sock.getFile = async (PATH, returnAsFilename) => {
    let res, filename;

    const data = Buffer.isBuffer(PATH)
      ? PATH
      : /^data:.*?\/.*?;base64,/i.test(PATH)
      ? Buffer.from(PATH.split`,`[1], "base64")
      : /^https?:\/\//.test(PATH)
      ? (await (async () => {
          const out = await fetchBuffer(PATH, 45000);
          res = out.res;
          return out.buffer;
        })())
      : fs.existsSync(PATH)
      ? (filename = PATH, fs.readFileSync(PATH))
      : typeof PATH === "string"
      ? PATH
      : Buffer.alloc(0);

    if (!Buffer.isBuffer(data)) throw new TypeError("Result is not a buffer");

    const type = (await FileType.fromBuffer(data)) || { mime: "application/octet-stream", ext: "bin" };

    if (data && returnAsFilename && !filename) {
      filename = path.join(__dirname, "./tmp/" + Date.now() + "." + type.ext);
      await fs.promises.mkdir(path.dirname(filename), { recursive: true });
      await fs.promises.writeFile(filename, data);
    }

    return {
      res,
      filename,
      ...type,
      data,
      deleteFile() {
        return filename && fs.promises.unlink(filename);
      },
    };
  };

  sock.sendFile = async (jid, pathInput, filename = "", caption = "", quoted, ptt = false, options = {}) => {
    const type = await sock.getFile(pathInput, true);
    let { res, data: file, filename: pathFile } = type;

    if ((res && res.status !== 200) || file.length <= 65536) {
      try {
        throw { json: JSON.parse(file.toString()) };
      } catch (e) {
        if (e.json) throw e.json;
      }
    }

    const opt = { filename };
    if (quoted) opt.quoted = quoted;

    let mtype = "";
    let mimetype = type.mime;
    let convert;

    if (/webp/.test(type.mime) || (/image/.test(type.mime) && options.asSticker)) mtype = "sticker";
    else if (/image/.test(type.mime) || (/webp/.test(type.mime) && options.asImage)) mtype = "image";
    else if (/video/.test(type.mime)) mtype = "video";
    else if (/audio/.test(type.mime)) {
      convert = await (ptt ? toPTT : toAudio)(file, type.ext);
      file = convert.data;
      pathFile = convert.filename;
      mtype = "audio";
      mimetype = "audio/ogg; codecs=opus";
    } else mtype = "document";

    if (options.asDocument) mtype = "document";

    const message = {
      ...options,
      caption,
      ptt,
      [mtype]: { url: pathFile },
      mimetype,
    };

    let sent;
    try {
      sent = await sock.sendMessage(jid, message, { ...opt, ...options });
    } catch (e) {
      console.error(e);
      sent = null;
    } finally {
      if (!sent) {
        sent = await sock.sendMessage(jid, { ...message, [mtype]: file }, { ...opt, ...options });
      }
      return sent;
    }
  };

  return sock;
};

clientstart();

// Keep your rejection filters
const ignoredErrors = [
  "Socket connection timeout",
  "EKEYTYPE",
  "item-not-found",
  "rate-overlimit",
  "Connection Closed",
  "Timed Out",
  "Value not found",
];

process.on("unhandledRejection", (reason) => {
  if (ignoredErrors.some((e) => String(reason).includes(e))) return;
  console.log("Unhandled Rejection:", reason);
});

const originalConsoleError = console.error;
console.error = function (msg, ...args) {
  if (typeof msg === "string" && ignoredErrors.some((e) => msg.includes(e))) return;
  originalConsoleError.apply(console, [msg, ...args]);
};

const originalStderrWrite = process.stderr.write;
process.stderr.write = function (msg) {
  if (typeof msg === "string" && ignoredErrors.some((e) => msg.includes(e))) return;
  originalStderrWrite.apply(process.stderr, arguments);
};