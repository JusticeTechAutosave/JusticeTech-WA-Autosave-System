<div align="center">

<img src="https://readme-typing-svg.demolab.com?font=Black+Ops+One&size=42&duration=3000&pause=1000&color=25D366&center=true&vCenter=true&width=600&lines=JusticeTech+Autosave+Bot;WhatsApp+Automation;Built+to+Save+Every+Contact" alt="JusticeTech Autosave Bot" />

<br/>

<img src="https://img.shields.io/badge/WhatsApp-Bot-25D366?style=for-the-badge&logo=whatsapp&logoColor=white"/>
<img src="https://img.shields.io/badge/Node.js-Powered-339933?style=for-the-badge&logo=nodedotjs&logoColor=white"/>
<img src="https://img.shields.io/badge/Google-Integrated-4285F4?style=for-the-badge&logo=google&logoColor=white"/>
<img src="https://img.shields.io/badge/Version-1.2.0-FF6B35?style=for-the-badge"/>
<img src="https://img.shields.io/badge/License-MIT-yellow?style=for-the-badge"/>

<br/><br/>

> **Production-ready WhatsApp automation bot powered by Baileys.**
> Automatically saves contacts to Google Contacts, manages premium subscriptions,
> backs up all bot data to Google Drive, and self-updates from GitHub with zero data loss.

<br/>

[📲 Chat on WhatsApp](https://wa.me/2349032578690) &nbsp;•&nbsp;
[📧 Send an Email](mailto:justicetechautosave@gmail.com) &nbsp;•&nbsp;
[🐛 Report a Bug](https://github.com/JusticeTechAutosave/JusticeTech-WA-Autosave-System/issues) &nbsp;•&nbsp;
[📋 View Changelog](https://github.com/JusticeTechAutosave/JusticeTech-WA-Autosave-System/releases)

</div>

---

## 📌 Table of Contents

- [What It Does](#-what-it-does)
- [Features](#-features)
- [Requirements](#-requirements)
- [Installation](#-installation)
- [Configuration](#-configuration)
- [Commands](#-commands)
- [Subscription System](#-subscription-system)
- [Backup & Restore](#-backup--restore)
- [Auto-Update](#-auto-update)
- [Project Structure](#-project-structure)
- [Contact & Support](#-contact--support)

---

## 🤖 What It Does

JusticeTech Autosave Bot connects to your WhatsApp account and **automatically saves every contact that messages you** directly into your Google Contacts — so you never lose a number again, even if you lose your phone.

It is built for **deployment on Pterodactyl or any Node.js VPS**, with a multi-owner architecture that lets you sell subscription access to other users running their own instances of the bot.

---

## ✨ Features

### 📇 Contact Autosave
- Automatically saves every new WhatsApp DM sender to Google Contacts in real time
- Supports **bulk save** — scan your entire chat history and save all unsaved contacts at once
- Full WhatsApp history sync for comprehensive contact discovery

### 🔗 Google Integration
- Link multiple Google accounts per bot owner via OAuth
- Save contacts directly to the linked Google account
- Send backup files to Gmail automatically

### 💾 Backup & Restore
- **Google Drive backup** — full bot data bundled and delivered to your email or WhatsApp DM
- **Auto-backup** — configurable interval (every 1–60 minutes), runs silently in the background
- **One-command restore** — paste a backup code to fully restore all settings, tokens, and data
- Restores include: Google tokens, subscriptions, prefix, ban list, referrals, and all configs

### 💳 Subscription Management
- Full subscription billing flow: `.sub buy` → payment proof → dev approval → instant activation
- Plans configurable in `settings/plans.js` (monthly, quarterly, biannual, etc.)
- Trial system for new users
- Dev can grant, extend, or revoke subscriptions remotely via signed payload system
- Ban / unban system with cross-bot signal delivery

### 🔄 Auto-Update System
- `.update` pulls the latest release directly from this GitHub repository
- Replaces all code files automatically
- **Never touches** your session, Google tokens, database, or config
- Runs `npm install` automatically if dependencies changed
- Restarts the bot when done — zero manual steps

### 🛡️ Security
- All cross-bot payloads (activation, revoke, ban) are HMAC-signed and validated
- Session and OAuth credentials excluded from all backups and GitHub commits
- Premium-only feature gating with dev override capability

---

## 📋 Requirements

| Requirement | Version |
|---|---|
| Node.js | **18 or higher** |
| npm | 8+ |
| A Google Account | For OAuth linking |
| A Google Cloud Project | For Contacts + Gmail API |
| A WhatsApp number | For the bot |
| A VPS or Pterodactyl panel | For hosting |

---

## ⚙️ Installation

### 1. Clone the Repository

```bash
git clone https://github.com/JusticeTechAutosave/JusticeTech-WA-Autosave-System.git
cd JusticeTech-WA-Autosave-System
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Configure the Bot

Edit `settings/config.js`:

```js
ownerNumber: "2348012345678",   // your WhatsApp number (digits only, no +)
ownerNumbers: ["2348012345678"],
```

### 4. Set Up Google OAuth

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a project → Enable **Google Contacts API** and **Gmail API**
3. Create OAuth 2.0 credentials (Desktop app type)
4. Download the credentials JSON → save as `credentials/google_oauth_client.json`

### 5. Start the Bot

```bash
npm start
```

Scan the QR code with your WhatsApp → the bot is live.

### 6. Link Your Google Account

In your WhatsApp DM to the bot:

```
.linkgoogle
```

Follow the link sent to you and authorize the bot. Done.

---

## 🔧 Configuration

| File | Purpose |
|---|---|
| `settings/config.js` | Bot owner number, bot name, API keys |
| `settings/plans.js` | Subscription plan definitions and pricing |
| `settings/bank.js` | Payment bank details shown to subscribers |
| `credentials/google_oauth_client.json` | Google OAuth client credentials *(gitignored)* |

### Example Plan Configuration (`settings/plans.js`)

```js
module.exports = {
  monthly:     { label: "1 Month",   days: 30,  price: 1500 },
  quarterly:   { label: "3 Months",  days: 90,  price: 3500 },
  biannual:    { label: "6 Months",  days: 180, price: 6000 },
  yearly:      { label: "1 Year",    days: 365, price: 10000 },
};
```

---

## 📟 Commands

### General (All Users)
| Command | Description |
|---|---|
| `.menu` | Show full command menu with subscription status |
| `.ping` | Check if bot is online |
| `.runtime` | Show how long the bot has been running |
| `.sub buy <plan>` | Start subscription purchase flow |
| `.substatus` | Check your subscription status |
| `.trial` | Claim a free trial (if available) |
| `.update` | Check for updates and auto-install latest version |
| `.update check` | Check version without installing |
| `.update changelog` | View what changed in the latest release |

### Owner / Premium
| Command | Description |
|---|---|
| `.autosave on/off` | Toggle autosave for your account |
| `.historysync on/off/status/reset` | Enable full WhatsApp history scan |
| `.bulksave` | Save all unsaved contacts from history scan |
| `.fetchchats` | View unsaved contacts discovered by history sync |
| `.googlebackup` | Backup all bot data to email + WA |
| `.googlerestore <code>` | Restore from a backup code |
| `.autobackup on/off/interval` | Configure automatic scheduled backups |
| `.linkgoogle` | Link a Google account |
| `.googleaccounts` | List linked Google accounts |

### Developer Only
| Command | Description |
|---|---|
| `.givesub <num> <plan>` | Grant subscription directly to a user |
| `.sub revoke <num>` | Revoke a user's subscription |
| `.sub extend <num> <days>` | Extend a user's subscription |
| `.sub list` | List all active subscriptions |
| `.sub info <num>` | View full subscription record for a user |
| `.approvepay <ref>` | Approve a pending payment |
| `.rejectpay <ref> <reason>` | Reject a payment |
| `.ban <num>` | Ban a user from using the bot |
| `.unban <num>` | Unban a user |
| `.update force` | Force reinstall even if already on latest version |
| `.restart` | Restart the bot process |

---

## 💳 Subscription System

The bot has a complete payment and subscription flow:

```
1. User:  .sub buy monthly
   Bot:   Shows bank details + generates a unique ref (JT-XXXXXX-XXXX)

2. User:  Sends payment screenshot with ref as caption to the bot

3. Bot:   Forwards proof to all dev numbers with approval instructions

4. Dev:   .approvepay JT-XXXXXX-XXXX
   Bot:   Activates subscription on the user's bot instantly

5. User:  .menu → shows "Sub: Active ✅ | Expires: 2026-08-17"
```

All activation and revoke payloads are **HMAC-signed** — they cannot be forged or replayed.

---

## 💾 Backup & Restore

### Manual Backup
```
.googlebackup
```
Delivers a backup to:
- Your WhatsApp DM (downloadable `.txt` file)
- Your linked Gmail (as an attachment)
- The server's home directory (auto-restores on restart)

### Auto-Backup
```
.autobackup on
.autobackup interval 10    ← every 10 minutes
```

### Restore
```
.googlerestore <code>
```
Paste the backup code from the backup message. Restores:
- Google OAuth tokens (no re-linking needed)
- Subscription database
- Bot settings and prefix
- Ban list, referral data, autobackup config

After restore, the subscription cache is automatically invalidated so changes take effect immediately.

---

## 🔄 Auto-Update

Once you publish a new release on GitHub, all deployed bots can update themselves:

```
.update              ← check + install if newer
.update check        ← check only, no install
.update force        ← reinstall even if already on latest
.update changelog    ← see what changed in latest release
```

**What gets updated:** `plugins/`, `library/`, `index.js`, `message.js`, `package.json`, `version.json`

**What is NEVER touched:**

| Protected Path | Contains |
|---|---|
| `database/` | Subscriptions, bans, referrals, scan cache |
| `data/` | Google OAuth tokens |
| `credentials/` | OAuth client secret |
| `sessions/` | WhatsApp login session |
| `settings/config.js` | Your owner number and bot config |

---

## 🗂️ Project Structure

```
JusticeTech-WA-Autosave-System/
├── index.js                  # Bot entry point, WhatsApp connection
├── message.js                # Message routing and command dispatch
├── version.json              # Current version (used by .update)
├── package.json
│
├── plugins/                  # All bot commands (hot-reloadable)
│   ├── autosave_google.js    # Core autosave engine
│   ├── subscription.js       # Full billing + payment system
│   ├── googlebackup.js       # Backup to Drive/email/WA
│   ├── googlerestore.js      # Restore from backup code
│   ├── historysync.js        # History scan management
│   ├── bulksave.js           # Bulk contact save
│   ├── ban.js                # Ban/unban system
│   ├── update.js             # GitHub auto-update
│   └── ...
│
├── library/                  # Shared utilities
│   ├── subscriptionDb.js     # Subscription read/write + cache
│   ├── banDb.js              # Ban database
│   ├── googleTenantAuth.js   # Multi-owner OAuth management
│   ├── googleContacts.js     # Google Contacts API wrapper
│   └── ...
│
├── settings/
│   ├── config.js             # Bot configuration (owner number etc.)
│   ├── plans.js              # Subscription plan definitions
│   └── bank.js               # Bank details for payments
│
├── database/                 # Runtime data (gitignored)
│   ├── subscription.json
│   ├── ban.json
│   └── ...
│
├── data/                     # OAuth tokens (gitignored)
│   └── google_tokens.json
│
└── credentials/              # Google client secret (gitignored)
    └── google_oauth_client.json
```

---

## 📞 Contact & Support

<div align="center">

### Need help? Reach out directly.

<br/>

<a href="https://wa.me/2349032578690">
  <img src="https://img.shields.io/badge/Chat%20on%20WhatsApp-%2325D366?style=for-the-badge&logo=whatsapp&logoColor=white&labelColor=128C7E" alt="WhatsApp" height="45"/>
</a>

&nbsp;&nbsp;&nbsp;

<a href="mailto:justicetechautosave@gmail.com">
  <img src="https://img.shields.io/badge/Send%20an%20Email-%23EA4335?style=for-the-badge&logo=gmail&logoColor=white&labelColor=B23121" alt="Email" height="45"/>
</a>

<br/><br/>

| Channel | Contact |
|---|---|
| 📲 WhatsApp (fastest) | [+234 903 257 8690](https://wa.me/2349032578690) |
| 📧 Email | [justicetechautosave@gmail.com](mailto:justicetechautosave@gmail.com) |
| 🐛 Bug Reports | [GitHub Issues](https://github.com/JusticeTechAutosave/JusticeTech-WA-Autosave-System/issues) |

<br/>

**Support hours:** Monday – Saturday, 8am – 9pm WAT
**Response time:** Usually within a few hours on WhatsApp

</div>

---

## 📄 License

This project is licensed under the **MIT License** — see the [LICENSE](LICENSE) file for details.

---

<div align="center">

Built with ❤️ by **JusticeTech**

<img src="https://img.shields.io/badge/Made%20with-Node.js-339933?style=flat-square&logo=nodedotjs&logoColor=white"/>
<img src="https://img.shields.io/badge/Powered%20by-Baileys-25D366?style=flat-square&logo=whatsapp&logoColor=white"/>
<img src="https://img.shields.io/badge/Integrated%20with-Google-4285F4?style=flat-square&logo=google&logoColor=white"/>

<br/><br/>

*If this project helped you, consider giving it a ⭐ on GitHub — it means a lot!*

</div>
