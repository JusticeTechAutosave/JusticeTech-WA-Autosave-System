# Quick Start: Enhanced OAuth Test User Management

## 🎯 What You Get

Three enhanced plugins that make managing Google OAuth test users much easier:

1. **testuser.js** - Adds test users with auto-generated Google Console links
2. **oauthstatus.js** - Check your OAuth configuration at a glance
3. **googleconsole.js** - Quick access to Google Console pages

Plus detailed guides to help you navigate Google Cloud Console.

---

## ⚡ Quick Install

### 1. Upload Files to Your Bot Server

Upload these files to your bot:
- `testuser.js` → `plugins/testuser.js`
- `oauthstatus.js` → `plugins/oauthstatus.js`
- `googleconsole.js` → `plugins/googleconsole.js`

### 2. Reload Plugins

In your bot, send:
```
.reloadplugins
```

### 3. Test It

```
.addtestuser your-email@gmail.com
```

---

## 🚀 First Time Setup

### Step 1: Add Your First Test User

```
.addtestuser jlfamoustv@gmail.com
```

**The bot will reply with:**
- ✅ Confirmation
- 📋 Email to copy
- 🔗 Direct link to Google Console
- 📝 Step-by-step instructions

### Step 2: Add to Google Console

**Option A: Click the link** from bot output

**Option B: Use this command:**
```
.console consent
```

Then:
1. Click the link
2. Scroll to "Test users"
3. Click "+ ADD USERS"
4. Paste: `jlfamoustv@gmail.com`
5. Click "SAVE"

### Step 3: Send OAuth Link

```
.linkgoogle 2348166337692 jlfamoustv@gmail.com
```

### Step 4: User Completes OAuth

User receives link → Authorizes → Sends code:
```
.oauth 4/0AcXXXXXXX...
```

Done! ✅

---

## 📋 Essential Commands

### Add Test User
```bash
.addtestuser email@gmail.com    # Quick add with instructions
.testuser add email@gmail.com   # Alternative
```

### List/Export Users
```bash
.testuser list                  # Show all test users
.testuser export                # Copy-paste format for Console
```

### Check Configuration
```bash
.oauthstatus                   # Full configuration check
```

### Google Console Access
```bash
.console consent               # OAuth consent screen
.console credentials           # API credentials
.console apis                  # APIs dashboard
```

---

## 🐛 Troubleshooting

### Can't Find OAuth Consent Screen?

**Problem:** You see "OAuth overview" with graphs instead of configuration.

**Solution:**
```
.console consent
```
Click the link - it goes directly to the right page.

Or read: `CONSOLE_NAVIGATION_GUIDE.md`

### "Access blocked" Error?

**Check these:**
```
.oauthstatus
```

Make sure:
- ✅ Email in local database
- ✅ Email in Google Console test users
- ✅ OAuth client configured

### Need Help?

1. Run `.oauthstatus` - shows what's missing
2. Read `OAUTH_SETUP_GUIDE.md` - complete setup steps
3. Read `CONSOLE_NAVIGATION_GUIDE.md` - visual guide for Google Console

---

## 📚 Documentation Files

- **README.md** - Complete features and usage
- **OAUTH_SETUP_GUIDE.md** - Detailed setup instructions
- **CONSOLE_NAVIGATION_GUIDE.md** - Visual navigation guide
- **QUICKSTART.md** - This file!

---

## 💡 Pro Tips

### Add Multiple Users at Once
```bash
.addtestuser user1@gmail.com
.addtestuser user2@gmail.com
.addtestuser user3@gmail.com
.testuser export               # Copy all → paste in Console
```

### Check Before Linking
```bash
.oauthstatus                  # Verify setup
.testuser list                # Confirm user added
.console consent              # Open Console to verify
```

### Save Console Link
```bash
.console consent
```
Bookmark the link for easy access!

---

## 🎓 Example Session

```bash
# 1. Check current status
> .oauthstatus
✅ All files configured
🧪 Local Test Users: 0

# 2. Add test user
> .addtestuser jlfamoustv@gmail.com
✅ jlfamoustv@gmail.com added
📋 Next: Add to Google Console
🔗 https://console.cloud.google.com/apis/credentials/consent?project=...

# 3. Verify it's added
> .testuser list
🧪 Local Test Users (1):
  1. jlfamoustv@gmail.com

# 4. Open Google Console (click link from step 2)
# Add email to test users there

# 5. Send OAuth link
> .linkgoogle 2348166337692 jlfamoustv@gmail.com
✅ Sent Google auth link to +2348166337692

# 6. User authorizes and completes
> .oauth 4/0AcXXXXXX...
✅ Google account linked successfully!
```

---

## ⚙️ Configuration Check

Run this to see if everything is set up:

```bash
.oauthstatus
```

**Example output:**
```
🔍 Google OAuth Configuration Status

📁 Configuration Files:
✅ data/google_oauth.json
✅ credentials/google_oauth_client.json
✅ data/google_tokens.json
✅ data/test_users.json

🔐 OAuth Configuration:
Client ID: ✅ Set
Client Secret: ✅ Set
Redirect URI: https://developers.google.com/oauthplayground

📊 Google Cloud Project:
Project: justicetech-autosave

🧪 Local Test Users: 1
  1. jlfamoustv@gmail.com

📝 Next Steps:
1. Make sure test users are added in Google Console
2. Send OAuth link: .linkgoogle NUMBER EMAIL
3. User authorizes and sends: .oauth CODE
```

If you see ❌ anywhere, follow the "Next Steps" section.

---

## 🆘 Still Need Help?

### Check Status
```bash
.oauthstatus
```

### Get Console Link
```bash
.console consent
```

### Export Users
```bash
.testuser export
```

### Read Guides
- Google Console navigation: `CONSOLE_NAVIGATION_GUIDE.md`
- Complete setup: `OAUTH_SETUP_GUIDE.md`
- All features: `README.md`

---

## ✅ Success Checklist

- [ ] Plugins installed and reloaded
- [ ] `.oauthstatus` shows all green ✅
- [ ] Test user added locally (`.testuser list`)
- [ ] Test user added in Google Console
- [ ] OAuth link sent (`.linkgoogle`)
- [ ] User authorized successfully (`.oauth`)

Once all checked, your OAuth setup is complete! 🎉

---

## 🔄 What's Different from Before?

**Old workflow:**
```
.testuser add email@gmail.com
# Now what? Where do I add it?
# *searches Google Console for 20 minutes*
```

**New workflow:**
```
.addtestuser email@gmail.com
# Bot shows: exact link, what to copy, step-by-step
# Click → Paste → Done in 30 seconds
```

**Key improvements:**
- ✅ Direct Google Console links
- ✅ Copy-paste ready content
- ✅ Clear next steps
- ✅ Configuration checker
- ✅ Visual guides

---

That's it! Start with `.addtestuser your-email@gmail.com` and follow the bot's instructions.
