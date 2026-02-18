# Enhanced OAuth Test User Management

## 🎯 What This Fixes

**Problem:** Getting "Access blocked: JusticeTech Autosave has not completed the Google verification process"

**Root Cause:** Test users must be added in TWO places:
1. ✅ Bot's local database (automated)
2. ❌ Google Cloud Console (manual - **THIS IS REQUIRED**)

**Solution:** These enhanced plugins make the manual part much easier with direct links, copy-paste exports, and helpful instructions.

---

## 📦 Installation

### Files Included

1. **testuser.js** - Enhanced test user management
2. **oauthstatus.js** - OAuth configuration checker
3. **googleconsole.js** - Quick Google Console links
4. **OAUTH_SETUP_GUIDE.md** - Complete setup guide

### Install Steps

1. **Backup your current plugin:**
   ```bash
   mv plugins/testuser.js plugins/testuser.js.backup
   ```

2. **Copy new plugins:**
   ```bash
   # Copy enhanced testuser
   cp testuser.js /path/to/JusticeTech-FIXED-v2/plugins/

   # Copy new diagnostic plugins
   cp oauthstatus.js /path/to/JusticeTech-FIXED-v2/plugins/
   cp googleconsole.js /path/to/JusticeTech-FIXED-v2/plugins/
   ```

3. **Reload plugins:**
   ```bash
   .reloadplugins
   ```

---

## 🚀 Usage

### Quick Add (Recommended)

```bash
.addtestuser jlfamoustv@gmail.com
```

This will:
- ✅ Add to local database
- ✅ Show you the exact email to copy
- ✅ Give you direct Google Console link
- ✅ Provide step-by-step instructions

### Other Commands

```bash
# List all test users
.testuser list

# Export for Google Console (copy-paste ready)
.testuser export

# Add test user (alternative method)
.testuser add user@gmail.com

# Remove test user
.testuser remove user@gmail.com

# Check OAuth configuration status
.oauthstatus

# Get Google Console links
.console consent      # OAuth consent screen
.console credentials  # Download OAuth client
.console apis        # APIs dashboard
```

---

## 📋 Complete Workflow

### 1. Add Test User to Bot

```bash
.addtestuser jlfamoustv@gmail.com
```

**Output:**
```
✅ jlfamoustv@gmail.com added to local test users

📋 Next step: Add to Google Cloud Console

Copy and paste this email:
jlfamoustv@gmail.com

🔗 Google Console:
https://console.cloud.google.com/apis/credentials/consent?project=justicetech-autosave

📝 Instructions:
1. Click the link above
2. Scroll to "Test users"
3. Click "+ ADD USERS"
4. Paste: jlfamoustv@gmail.com
5. Click "SAVE"
```

### 2. Add to Google Cloud Console

**Option A: Use the link from bot output**
- Click the link provided
- Follow the instructions

**Option B: Navigate manually**
1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Select project: `justicetech-autosave`
3. Left sidebar: **APIs & Services** → **OAuth consent screen**
4. Scroll to **Test users**
5. Click **+ ADD USERS**
6. Paste email: `jlfamoustv@gmail.com`
7. Click **SAVE**

**Option C: Use export for multiple users**
```bash
.testuser export
```
Copy all emails, paste into Google Console at once.

### 3. Send OAuth Link

```bash
.linkgoogle 2348166337692 jlfamoustv@gmail.com
```

Bot will DM the user with OAuth link.

### 4. User Authorizes

User:
1. Receives OAuth link in DM
2. Clicks link
3. Signs in with `jlfamoustv@gmail.com`
4. Accepts permissions (should work now! ✅)
5. Copies the authorization code

### 5. User Completes OAuth

```bash
.oauth 4/0AcXXXXXXXXX...
```

Done! ✅

---

## 🔍 Diagnostics

### Check Your Setup

```bash
.oauthstatus
```

**Example Output:**
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

🔗 Console Links:
Credentials:
https://console.cloud.google.com/apis/credentials?project=justicetech-autosave

OAuth Consent:
https://console.cloud.google.com/apis/credentials/consent?project=justicetech-autosave

🧪 Local Test Users: 2
  1. jlfamoustv@gmail.com
  2. test@gmail.com

📝 Next Steps:
1. Make sure test users are added in Google Console
2. Send OAuth link: .linkgoogle NUMBER EMAIL
3. User authorizes and sends: .oauth CODE
```

---

## 🆕 New Features

### 1. Direct Console Links
- No more searching for the right page
- Project ID auto-detected
- One-click access

### 2. Export Feature
```bash
.testuser export
```
Get all emails in copy-paste format for Google Console.

### 3. Status Checker
```bash
.oauthstatus
```
See complete OAuth configuration status at a glance.

### 4. Quick Console Access
```bash
.console consent      # OAuth consent screen
.console credentials  # API credentials
.console apis        # APIs dashboard
```

### 5. Enhanced Instructions
Every command now includes:
- ✅ What it does
- ✅ Next steps
- ✅ Direct links
- ✅ Copy-paste ready content

---

## 🐛 Troubleshooting

### "OAuth overview" Page Issue

**Problem:** Clicking "OAuth consent screen" shows metrics/overview instead of settings.

**Solution:**
```bash
.console consent
```
Use the direct link provided by this command.

**Or manually:**
1. Look at LEFT sidebar (not the main page)
2. Click "OAuth consent screen" in the sidebar
3. If still on overview, click "Credentials" first, then "OAuth consent screen"

### "Access blocked" Error

**Checklist:**
```bash
.oauthstatus
```

Check:
- ✅ Email in local database? (`.testuser list`)
- ✅ Email in Google Console? (`.console consent` → Check test users)
- ✅ OAuth configured? (`.oauthstatus` → All green checkmarks)

### Can't Find Test Users Section

1. Open: `https://console.cloud.google.com/apis/credentials/consent`
2. If consent screen not configured:
   - Click "CONFIGURE CONSENT SCREEN"
   - Select "External"
   - Fill required fields
   - Continue until you see "Test users" section

---

## 💡 Tips

### Multiple Test Users
```bash
.addtestuser user1@gmail.com
.addtestuser user2@gmail.com
.addtestuser user3@gmail.com
.testuser export  # Copy all at once to Google Console
```

### Check Before Sending Link
```bash
.oauthstatus  # Make sure everything is configured
.testuser list  # Verify user is in local database
```

### Quick Reference
```bash
.addtestuser email@gmail.com     # Quick add + instructions
.testuser export                 # Copy-paste for Console
.console consent                 # Open Google Console
.oauthstatus                    # Check configuration
```

---

## 📚 Additional Resources

- **Setup Guide:** `OAUTH_SETUP_GUIDE.md`
- **Google OAuth Docs:** https://developers.google.com/identity/protocols/oauth2
- **Google Console:** https://console.cloud.google.com

---

## 🔄 Upgrade from Old Version

The new `testuser.js` is **fully backward compatible**:
- ✅ Same database format
- ✅ Same commands work
- ✅ Just adds new features

No migration needed! Just replace the file and reload.

---

## ✨ Summary

**Before:**
```
.testuser add email@gmail.com
# Now what? Where do I add it in Google Console?
```

**After:**
```
.addtestuser email@gmail.com
# Shows exactly what to do with direct link and instructions
```

**Key Improvement:** No more guessing! Every command tells you exactly what to do next with clickable links and copy-paste ready content.

---

## 📞 Support

If you still have issues:
1. Run `.oauthstatus` and share the output
2. Check `OAUTH_SETUP_GUIDE.md` for detailed steps
3. Make sure you're on the actual OAuth consent screen page, not the overview
