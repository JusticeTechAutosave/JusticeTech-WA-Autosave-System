# Google OAuth Test Users Setup Guide

## Problem
When users try to authenticate, they get:
```
Access blocked: JusticeTech Autosave has not completed the Google verification process
Error 403: access_denied
```

## Solution: Add Test Users in BOTH Places

### 1. Bot Local Database ✅ (Automated)
```bash
.addtestuser user@gmail.com
```
Or:
```bash
.testuser add user@gmail.com
```

### 2. Google Cloud Console ⚠️ (Manual - Required!)

**Direct Link:**
```
https://console.cloud.google.com/apis/credentials/consent?project=justicetech-autosave
```

**Steps:**
1. Click the link above (or navigate manually):
   - Google Cloud Console → APIs & Services → OAuth consent screen
   
2. If you see "OAuth overview" with metrics:
   - Look at the LEFT sidebar
   - Click "OAuth consent screen" (not "Overview")
   - OR click "Credentials" first, then "OAuth consent screen"

3. If consent screen is not configured yet:
   - Click "CONFIGURE CONSENT SCREEN"
   - Select "External"
   - Click "CREATE"
   - Fill required fields:
     - App name: JusticeTech Autosave
     - User support email: your-email@gmail.com
     - Developer contact: your-email@gmail.com
   - Click "SAVE AND CONTINUE"
   - Skip scopes (click "SAVE AND CONTINUE")
   - Now you're at "Test users" section

4. Add test users:
   - Click "+ ADD USERS"
   - Paste email addresses (one per line)
   - Click "ADD"
   - Click "SAVE AND CONTINUE"

## Quick Commands

### Export all test users for copy-paste:
```bash
.testuser export
```

### List all test users:
```bash
.testuser list
```

### Add test user (with auto-instructions):
```bash
.addtestuser jlfamoustv@gmail.com
```

### Remove test user:
```bash
.testuser remove user@gmail.com
```

## After Adding Test Users

1. User sends: `.linkgoogle` (to bot owner)
2. Bot owner sends: `.linkgoogle 2348166337692 jlfamoustv@gmail.com`
3. User receives OAuth link in DM
4. User clicks link, authorizes (should work now! ✅)
5. User copies the code
6. User sends: `.oauth CODE`
7. Done! ✅

## Common Issues

### "Access blocked" error
- ❌ Email not added to Google Console
- ✅ Add via: https://console.cloud.google.com/apis/credentials/consent

### "Invalid client" error
- ❌ Wrong client_id/client_secret in data/google_oauth.json
- ✅ Download credentials from Google Console → Credentials → OAuth 2.0 Client

### "Redirect URI mismatch"
- ❌ Redirect URI in code doesn't match Google Console
- ✅ Make sure both use: `https://developers.google.com/oauthplayground`

### Can't find "OAuth consent screen"
- Look in LEFT SIDEBAR under "APIs & Services"
- NOT in the overview/metrics page
- Direct link works best

## Publishing Your App (Optional - for unlimited users)

If you don't want to manually add each test user:

1. Complete OAuth consent screen configuration
2. Add all required information
3. Submit for verification
4. Google reviews (takes 1-2 weeks)
5. Once approved, anyone can use it

**Note:** For personal/internal use, test users mode is sufficient!
