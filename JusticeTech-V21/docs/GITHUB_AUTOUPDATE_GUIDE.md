# 🚀 GitHub Auto-Update Setup Guide
## JusticeTech Autosave Bot

---

## STEP 1 — Create Your GitHub Repository

1. Go to **https://github.com/new**
2. Fill in:
   - **Repository name:** `JusticeTech-WA-Autosave-System` (must match `GITHUB_REPO` in `plugins/update.js`)
   - **Visibility:** ✅ **Public** (required so the bot can download releases without a token)
   - Do NOT initialize with README (you'll push your own files)
3. Click **Create repository**

---

## STEP 2 — Edit `plugins/update.js` with Your GitHub Details

Open `plugins/update.js` and update lines 47–48:

```js
const GITHUB_USER  = "YourActualUsername";   // ← your GitHub username
const GITHUB_REPO  = "JusticeTech-WA-Autosave-System"; // ← your repo name (must match exactly)
```

---

## STEP 3 — Sanitize `settings/config.js` Before Pushing

Your `config.js` has your dev phone number in it. You have two choices:

**Option A (Recommended):** Replace your real number with a placeholder before pushing:
```js
ownerNumber: "YOUR_NUMBER_HERE",
ownerNumbers: ["YOUR_NUMBER_HERE"],
```
Each user replaces this when they set up the bot.

**Option B:** The `.gitignore` is already set to allow `settings/config.js` to be committed
(because it contains non-sensitive defaults). Just make sure you're comfortable sharing it.

---

## STEP 4 — Push Your Bot to GitHub

Run these commands in your bot's folder:

```bash
# Initialize git (first time only)
git init
git branch -M main

# Connect to your GitHub repo
git remote add origin https://github.com/JusticeTechAutosave/JusticeTech-WA-Autosave-System.git

# Stage all files (gitignore will automatically exclude sensitive files)
git add .

# Commit
git commit -m "Initial release: JusticeTech Autosave Bot v1.2.0"

# Push to GitHub
git push -u origin main
```

**✅ The `.gitignore` automatically excludes:**
- `sessions/` — WhatsApp session
- `data/google_tokens.json` — Google OAuth tokens
- `database/subscription.json` — user subscriptions
- `database/ban.json`, `referral.json` etc.
- `credentials/google_oauth_client.json`
- `node_modules/`

---

## STEP 5 — Publish a GitHub Release (REQUIRED for .update to work)

The `.update` command pulls from **GitHub Releases**, not raw commits.
Every time you want to push an update to users, you must create a Release.

### How to create a release:

1. Go to your repo: `https://github.com/JusticeTechAutosave/JusticeTech-WA-Autosave-System`
2. Click **"Releases"** (right sidebar) → **"Create a new release"**
3. Click **"Choose a tag"** → type a new tag like `v1.2.1` → click **"Create new tag"**
4. Fill in:
   - **Release title:** e.g. `v1.2.1 — Bug fixes + new features`
   - **Description (changelog):** list what changed (users see this with `.update changelog`)
5. Click **"Publish release"**

That's it! Users can now run `.update` and the bot will auto-download v1.2.1.

---

## STEP 6 — How to Push Future Updates

When you fix a bug or add a feature:

```bash
# 1. Make your changes locally

# 2. Stage and commit
git add .
git commit -m "Fix: sub revoke via JTR payload + historysync improvements"

# 3. Push to main branch
git push origin main

# 4. Go to GitHub → Releases → Create new release
#    Set tag: v1.2.2  (increment version each time)
#    Write changelog
#    Publish release
```

Then also update `version.json` in your repo:
```json
{
  "version": "1.2.2",
  "codename": "V23",
  "releaseDate": "2026-02-19",
  "changelog": [
    "Fixed xyz",
    "Added abc"
  ]
}
```

---

## STEP 7 — Using the `.update` Command

Once GitHub is set up and you have at least one release:

| Command | What it does |
|---|---|
| `.update` | Check for updates → download + install + restart if newer |
| `.update check` | Just check version, don't install |
| `.update force` | Force reinstall even if already on latest |
| `.update changelog` | Show the latest release notes from GitHub |

**Example flow:**
```
Dev: .update
Bot: 🔍 Checking latest release on GitHub...
Bot: 📥 Update found: v1.2.1
     Current: v1.2.0
     New:     v1.2.1
     ⏳ Downloading and applying update...

Bot: ✅ Update applied successfully!
     Version: v1.2.1
     Files: 47 updated
     Deps: no change
     
     Preserved (untouched):
     • database/  (subscriptions, bans etc.)
     • data/      (Google tokens)
     • credentials/
     • sessions/  (WhatsApp session)
     • settings/config.js
     
     🔄 Restarting bot now...
[bot restarts automatically]
```

---

## WHAT IS PRESERVED DURING UPDATE

These files/folders are **NEVER touched** by `.update`:

| Path | Contains |
|---|---|
| `database/` | Subscriptions, bans, referrals, scan cache |
| `data/` | Google OAuth tokens (linked accounts) |
| `credentials/` | OAuth client secret |
| `sessions/` | WhatsApp login session |
| `settings/config.js` | Owner number, bot config |

Everything else (plugins, library, index.js, message.js, etc.) gets updated.

---

## TROUBLESHOOTING

**"Could not reach GitHub"**
→ Make sure your server has internet access.
→ Make sure your repo is **Public** (not private).
→ Make sure you have at least one published Release (not just a commit).

**"No release found"**
→ You pushed to GitHub but didn't create a Release. Go to GitHub → Releases → New Release.

**Update applied but bot didn't restart**
→ Run `.restart` manually after the update.

**Users' data got wiped**
→ This should never happen with the preserve list. If it did, restore from `.googlebackup`.

---

## QUICK REFERENCE

```
GitHub repo:    https://github.com/JusticeTechAutosave/JusticeTech-WA-Autosave-System
Releases page:  https://github.com/JusticeTechAutosave/JusticeTech-WA-Autosave-System/releases
API check:      https://api.github.com/repos/JusticeTechAutosave/JusticeTech-WA-Autosave-System/releases/latest
```
