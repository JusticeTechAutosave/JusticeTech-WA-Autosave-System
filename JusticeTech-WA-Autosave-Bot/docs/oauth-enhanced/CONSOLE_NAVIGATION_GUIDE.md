# Visual Guide: Finding OAuth Consent Screen in Google Cloud Console

## Problem: Can't Find OAuth Consent Screen Settings

When you click "OAuth consent screen" you see an **Overview page with metrics** instead of the **configuration page**.

---

## Solution 1: Use Direct Link (Easiest!)

### From Bot:
```bash
.console consent
```

The bot will give you a direct link like:
```
https://console.cloud.google.com/apis/credentials/consent?project=justicetech-autosave
```

**Click it!** This bypasses all navigation and goes straight to the right page.

---

## Solution 2: Manual Navigation

### Step-by-Step:

#### 1. Open Google Cloud Console
```
https://console.cloud.google.com
```

#### 2. Select Your Project
- Top bar: Click project dropdown
- Select: `justicetech-autosave`

#### 3. Look at the LEFT SIDEBAR (Not the main page!)
```
☰ Navigation Menu (Left Sidebar)
├── Home
├── Marketplace
├── Billing
├── APIs & Services  ←── CLICK THIS FIRST!
│   ├── Dashboard
│   ├── Library
│   ├── Credentials
│   ├── OAuth consent screen  ←── THEN CLICK THIS!
│   ├── Domain verification
│   └── ...
├── Compute Engine
└── ...
```

#### 4. What You Should See

**CORRECT PAGE (Configuration):**
```
OAuth consent screen
━━━━━━━━━━━━━━━━━━━━

User Type
○ Internal
● External

[ EDIT APP INFO ]

App information
App name: JusticeTech Autosave
User support email: your-email@gmail.com

Test users                    [ + ADD USERS ]
┌──────────────────────────────────────┐
│ user1@gmail.com                      │
│ user2@gmail.com                      │
└──────────────────────────────────────┘
```

**WRONG PAGE (Overview/Metrics):**
```
OAuth overview
━━━━━━━━━━━━━━

Metrics
┌─────────────────────────────────────┐
│ Traffic                             │
│ [Graph showing OAuth requests]      │
└─────────────────────────────────────┘

Errors
┌─────────────────────────────────────┐
│ [Graph showing errors]              │
└─────────────────────────────────────┘
```

---

## Solution 3: Alternative Navigation Path

Sometimes the sidebar is confusing. Try this instead:

### Path A: Via Credentials
1. Click **"Credentials"** in left sidebar (under APIs & Services)
2. At the top, click **"OAuth consent screen"** tab
3. This should take you to the config page

### Path B: Via Search
1. Click the search bar at the top
2. Type: "OAuth consent screen"
3. Click the result that says "OAuth consent screen" (not "OAuth overview")

---

## What If Consent Screen Isn't Configured Yet?

You'll see:
```
OAuth consent screen
━━━━━━━━━━━━━━━━━━━━

[ CONFIGURE CONSENT SCREEN ]
```

### Click it and follow these steps:

#### Step 1: User Type
```
● External  ←── Select this
○ Internal

[ CREATE ]
```

#### Step 2: App Information
```
App name: JusticeTech Autosave
User support email: your-email@gmail.com

App logo: (optional)

Developer contact:
your-email@gmail.com

[ SAVE AND CONTINUE ]
```

#### Step 3: Scopes
```
(You can skip this)

[ SAVE AND CONTINUE ]
```

#### Step 4: Test Users ← THIS IS WHERE YOU ADD EMAILS!
```
Test users                    [ + ADD USERS ]
┌──────────────────────────────────────┐
│                                      │  ←── Click + ADD USERS
└──────────────────────────────────────┘

[ SAVE AND CONTINUE ]
```

Click **+ ADD USERS**, paste your emails, click **ADD**.

#### Step 5: Summary
```
Review your app

[ BACK TO DASHBOARD ]
```

Done! Now test users can authenticate.

---

## Quick Reference: Adding Test Users

Once you're on the OAuth consent screen configuration page:

### Visual Location:
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
OAuth consent screen
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

[... other settings above ...]

Test users                    [ + ADD USERS ]  ←── CLICK HERE
┌──────────────────────────────────────┐
│ (empty or existing emails)           │
└──────────────────────────────────────┘
```

### Steps:
1. **Click** "+ ADD USERS"
2. **Paste** email addresses (one per line):
   ```
   jlfamoustv@gmail.com
   test@gmail.com
   another@gmail.com
   ```
3. **Click** "ADD"
4. **Click** "SAVE" (at the bottom of the page)

---

## Bot Commands for Easy Access

### Get the exact link:
```bash
.console consent
```

### Export emails in copy-paste format:
```bash
.testuser export
```

**Example output:**
```
📋 Ready to paste into Google Console

Step 1: Copy all emails below:
━━━━━━━━━━━━━━━
jlfamoustv@gmail.com
test@gmail.com
━━━━━━━━━━━━━━━

Step 2: Open Google Console:
https://console.cloud.google.com/apis/credentials/consent?project=justicetech-autosave

Step 3: Instructions:
1. Scroll down to "Test users"
2. Click "+ ADD USERS"
3. Paste the emails above (one per line)
4. Click "SAVE"
```

---

## Common Navigation Mistakes

### ❌ Mistake 1: Clicking on "Overview" tab
```
OAuth consent screen
[ Overview ]  [ Edit app registration ]
     ↑
  Don't click this! This is the metrics page.
```

### ❌ Mistake 2: Looking at main content area
The overview/metrics page shows up in the MAIN content area.
The actual configuration is in a DIFFERENT page.

### ✅ Solution: Use the left sidebar
Always navigate using the **left sidebar menu**, not tabs in the main area.

---

## TL;DR

**Easiest method:**
```bash
# In bot
.console consent

# Click the link that appears
# Scroll to "Test users"
# Click "+ ADD USERS"
# Paste emails
# Click "SAVE"
```

**Direct URL format:**
```
https://console.cloud.google.com/apis/credentials/consent?project=YOUR-PROJECT-ID
```

Replace `YOUR-PROJECT-ID` with `justicetech-autosave` (or run `.console consent` to get the exact link).

---

## Still Can't Find It?

### Run this in bot:
```bash
.oauthstatus
```

This will:
- ✅ Detect your project ID
- ✅ Give you the exact link
- ✅ Show what's configured
- ✅ Tell you what to do next

Then use:
```bash
.console consent
```

To get a clickable link directly to the OAuth consent screen configuration page.
