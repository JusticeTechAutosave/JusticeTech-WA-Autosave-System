// plugins/docs.js — JusticeTech Autosave Bot v1.1.1 JT
// ─────────────────────────────────────────────────────────────────────────────
// Browse, add, edit and delete documentation files.
//
// ALL USERS:
//   .docs              — list all docs
//   .docs 3            — view doc #3
//   .docs readme       — view by name (partial match)
//
// DEV ONLY:
//   .docs add <title>  — create a new doc (then send content in next message)
//   .docs write <num|name> <content> — write/overwrite a doc inline
//   .docs append <num|name> <content> — append to an existing doc
//   .docs delete <num|name> — delete a doc
//   .docs rename <num|name> <newname> — rename a doc
// ─────────────────────────────────────────────────────────────────────────────

"use strict";

const fs   = require("fs");
const path = require("path");

const DOCS_DIR    = path.join(__dirname, "..", "docs");
const DEV_NUMBERS = new Set(["2349032578690", "2348166337692"]);
const MAX_CHARS   = 3800; // WA message limit buffer

function normalizeNumber(input) {
  if (!input) return "";
  let s = String(input).trim();
  if (s.includes("@")) s = s.split("@")[0];
  if (s.includes(":")) s = s.split(":")[0];
  s = s.replace(/\D/g, "");
  return s;
}

function jidFromCtx(m) {
  return m?.sender || m?.key?.participant || m?.key?.remoteJid || "";
}

function isDevJid(m) {
  return DEV_NUMBERS.has(normalizeNumber(jidFromCtx(m)));
}

function ensureDocsDir() {
  if (!fs.existsSync(DOCS_DIR)) fs.mkdirSync(DOCS_DIR, { recursive: true });
}

function getDocs() {
  ensureDocsDir();
  return fs.readdirSync(DOCS_DIR)
    .filter(f => f.endsWith(".md") || f.endsWith(".txt"))
    .sort();
}

// Resolve a doc by number or name — returns filename or null
function resolveDoc(query, docs) {
  const idx = parseInt(query, 10);
  if (!isNaN(idx) && idx >= 1 && idx <= docs.length) return docs[idx - 1];
  const lower = query.toLowerCase();
  const match = docs.find(f => f.toLowerCase().includes(lower));
  return match || null;
}

// Sanitize a title to a safe filename
function safeFilename(title) {
  return title.trim()
    .replace(/[^a-zA-Z0-9_\- ]/g, "")
    .replace(/\s+/g, "_")
    .slice(0, 60) + ".md";
}

// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  name: "Docs",
  category: "info",
  desc: "View and manage documentation files",
  command: ["docs", "doc"],

  run: async ({ reply, args, prefix, m }) => {
    const pfx     = prefix || ".";
    const callerDev = isDevJid(m);
    const docs    = getDocs();
    const sub     = String(args?.[0] || "").toLowerCase().trim();

    // ── DEV: add ──────────────────────────────────────────────────────────────
    if (sub === "add") {
      if (!callerDev) return reply("🔒 Dev only.");
      const title = args.slice(1).join(" ").trim();
      if (!title) return reply(`Usage: ${pfx}docs add <title>\nExample: ${pfx}docs add Setup Guide`);

      const filename = safeFilename(title);
      const fullPath = path.join(DOCS_DIR, filename);

      if (fs.existsSync(fullPath)) {
        return reply(`❌ A doc named *${filename}* already exists.\nUse ${pfx}docs write to overwrite.`);
      }

      ensureDocsDir();
      fs.writeFileSync(fullPath, `# ${title}\n\n_Created ${new Date().toISOString().split("T")[0]}_\n\nAdd your content here.\n`);
      return reply(
        `✅ *Doc created:* ${filename}\n\n` +
        `To add content:\n` +
        `${pfx}docs write ${docs.length + 1} Your content here\n\n` +
        `Or use ${pfx}docs append to add to the existing stub.`
      );
    }

    // ── DEV: write (overwrite) ────────────────────────────────────────────────
    if (sub === "write") {
      if (!callerDev) return reply("🔒 Dev only.");
      const query   = String(args[1] || "").trim();
      const content = args.slice(2).join(" ").trim();

      if (!query || !content) {
        return reply(`Usage: ${pfx}docs write <num|name> <content>\nExample: ${pfx}docs write 2 This is the new content.`);
      }

      const filename = resolveDoc(query, docs);
      if (!filename) return reply(`❌ No doc found matching "*${query}*".\nSee: ${pfx}docs`);

      fs.writeFileSync(path.join(DOCS_DIR, filename), content);
      return reply(`✅ *${filename}* overwritten (${content.length} chars).`);
    }

    // ── DEV: append ───────────────────────────────────────────────────────────
    if (sub === "append") {
      if (!callerDev) return reply("🔒 Dev only.");
      const query   = String(args[1] || "").trim();
      const content = args.slice(2).join(" ").trim();

      if (!query || !content) {
        return reply(`Usage: ${pfx}docs append <num|name> <content>\nExample: ${pfx}docs append 2 More info here.`);
      }

      const filename = resolveDoc(query, docs);
      if (!filename) return reply(`❌ No doc found matching "*${query}*".\nSee: ${pfx}docs`);

      const existing = fs.readFileSync(path.join(DOCS_DIR, filename), "utf8");
      fs.writeFileSync(path.join(DOCS_DIR, filename), existing + "\n\n" + content);
      return reply(`✅ Appended to *${filename}*. Total: ${existing.length + content.length + 2} chars.`);
    }

    // ── DEV: delete ───────────────────────────────────────────────────────────
    if (sub === "delete" || sub === "del" || sub === "remove") {
      if (!callerDev) return reply("🔒 Dev only.");
      const query = args.slice(1).join(" ").trim();
      if (!query) return reply(`Usage: ${pfx}docs delete <num|name>`);

      const filename = resolveDoc(query, docs);
      if (!filename) return reply(`❌ No doc found matching "*${query}*".\nSee: ${pfx}docs`);

      fs.unlinkSync(path.join(DOCS_DIR, filename));
      return reply(`✅ Deleted: *${filename}*`);
    }

    // ── DEV: rename ───────────────────────────────────────────────────────────
    if (sub === "rename") {
      if (!callerDev) return reply("🔒 Dev only.");
      const query   = String(args[1] || "").trim();
      const newName = args.slice(2).join(" ").trim();

      if (!query || !newName) {
        return reply(`Usage: ${pfx}docs rename <num|name> <new name>\nExample: ${pfx}docs rename 3 Updated Setup Guide`);
      }

      const filename = resolveDoc(query, docs);
      if (!filename) return reply(`❌ No doc found matching "*${query}*".\nSee: ${pfx}docs`);

      const newFilename = safeFilename(newName);
      const newPath     = path.join(DOCS_DIR, newFilename);
      if (fs.existsSync(newPath)) return reply(`❌ A doc named *${newFilename}* already exists.`);

      fs.renameSync(path.join(DOCS_DIR, filename), newPath);
      return reply(`✅ Renamed: *${filename}* → *${newFilename}*`);
    }

    // ── LIST: no args ─────────────────────────────────────────────────────────
    if (!args.length || !args[0]) {
      if (!docs.length) return reply(`📄 No documentation files found.`);

      const list = docs.map((f, i) =>
        `  ${String(i + 1).padStart(2)}. ${f.replace(/\.(md|txt)$/i, "")}`
      ).join("\n");

      return reply(
        `📚 *Documentation* (${docs.length} files)\n\n` +
        list +
        `\n\n─────────────────────────\n` +
        `${pfx}docs 1          — view by number\n` +
        `${pfx}docs README     — view by name` +
        (callerDev
          ? `\n\n🛠 *Dev:*\n` +
            `${pfx}docs add <title>\n` +
            `${pfx}docs write <num|name> <content>\n` +
            `${pfx}docs append <num|name> <content>\n` +
            `${pfx}docs delete <num|name>\n` +
            `${pfx}docs rename <num|name> <new name>`
          : "")
      );
    }

    // ── VIEW: by number or name ───────────────────────────────────────────────
    const query    = args.join(" ").trim();
    const filename = resolveDoc(query, docs);

    if (!filename) {
      // Maybe multiple partial matches
      const lower   = query.toLowerCase();
      const matches = docs.filter(f => f.toLowerCase().includes(lower));
      if (matches.length > 1) {
        const list = matches.map((f, i) => `  ${i + 1}. ${f}`).join("\n");
        return reply(
          `🔍 Multiple matches for "*${query}*":\n\n${list}\n\n` +
          `Use the exact number: ${pfx}docs ${docs.indexOf(matches[0]) + 1}`
        );
      }
      return reply(`❌ No doc found matching "*${query}*".\nSee all: ${pfx}docs`);
    }

    const content = fs.readFileSync(path.join(DOCS_DIR, filename), "utf8");
    const display = content.length > MAX_CHARS
      ? content.slice(0, MAX_CHARS) + `\n\n[... truncated — ${content.length} chars total]`
      : content;

    return reply(`📄 *${filename}*\n${"─".repeat(30)}\n\n${display}`);
  },
};
