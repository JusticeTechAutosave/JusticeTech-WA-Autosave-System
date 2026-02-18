# JusticeTech Autosave Bot - Updated Version

## Quick Start Guide

### What's Fixed in This Version? 🎯

This update fixes the issue where **the bot was not replying to unsaved contacts**.

**Problem:** Autosave was OFF and only developers could turn it ON.  
**Solution:** New commands that let owners control autosave.

---

## Immediate Actions After Installing

### 1. Check Autosave Status

Run:
```
.autosavestatus
```

### 2. If It Shows OFF, Turn It ON

As owner:
```
.autosaveon
```

### 3. Test With Unsaved Contact

Send a message from a new number - should receive welcome message.

---

## New Features ✨

### For Everyone
- **`.autosavestatus`** - Check if autosave is ON or OFF
- **`.checkautosave`** - Same as above (alias)

### For Owners
- **`.autosaveon`** - Turn autosave ON
- **`.autosaveoff`** - Turn autosave OFF
- **`.toggleautosave`** - Toggle the current state

---

## Installation

### Fresh Install

```bash
unzip JusticeTech-Fixed-UPDATED.zip
cd JusticeTech-Fixed-UPDATED
npm install
npm start
```

### Upgrading

```bash
# Backup your data
cp -r database database_backup

# Extract new version
unzip -o JusticeTech-Fixed-UPDATED.zip

# Restart
npm start
```

---

## Configuration

### Required Settings

Edit `settings/config.js`:

```javascript
module.exports = {
  ownerNumber: "234XXXXXXXXXX", // Your number (digits only, no +)
  // ... other settings
}
```

### Database Files

The bot creates a `database/` folder with:
- `autosave_flag.json` - Master ON/OFF switch
- `autosaved_contacts.json` - Saved contacts
- `welcome.json` - Welcome messages
- And more...

---

## Commands Reference

### Autosave Control (OWNER ONLY)

| Command | Description |
|---------|-------------|
| `.autosaveon` | Turn autosave ON |
| `.autosaveoff` | Turn autosave OFF |
| `.toggleautosave` | Toggle current state |

### Status Check (ANYONE)

| Command | Description |
|---------|-------------|
| `.autosavestatus` | Check if autosave is enabled |
| `.checkautosave` | Same as above |

### Developer Commands (DEV ONLY)

| Command | Description |
|---------|-------------|
| `.autosave status` | Dev version of status check |
| `.autosave on` | Dev version of turn ON |
| `.autosave off` | Dev version of turn OFF |
| `.save <number> <name>` | Manually save a contact |
| `.bulksave` | Bulk save from history |
| `.tags` | View current tags |
| `.addtag new/old <tag>` | Set tags for new/old contacts |
| And many more... | See `.menu` for full list |

---

## How Autosave Works

### When Autosave is ON ✅

1. Unsaved contact sends a message
2. Bot sends welcome message
3. Bot asks for their name
4. Contact provides name
5. Bot confirms: "Is this correct? Yes/No"
6. Contact confirms
7. Bot saves to Google Contacts
8. Bot asks them to save you back

### When Autosave is OFF ❌

- Bot does NOT respond to unsaved contacts
- No welcome messages sent
- No autosave flow initiated
- Useful for maintenance or when you want manual control

---

## Troubleshooting

### Bot Not Responding to Unsaved Contacts

**Check:**
```
.autosavestatus
```

**If OFF:**
```
.autosaveon
```

**Still not working?**
1. Check console logs
2. Verify `database/autosave_flag.json` shows `"enabled": true`
3. Restart the bot

### Commands Not Working

**Reload plugins:**
```
.reloadplugins
```

**Or restart:**
```
.restart
```

### "Owner Only" Error

**Check:** Is your number in `settings/config.js`?
```javascript
ownerNumber: "234XXXXXXXXXX", // Digits only
```

### Database Issues

**Backup and reset:**
```bash
cp -r database database_backup
rm -rf database
npm start  # Will recreate with defaults
```

---

## File Structure

```
JusticeTech-Fixed-UPDATED/
├── index.js                    # Main bot file
├── message.js                  # Message handler
├── package.json                # Dependencies
├── UPDATE_NOTES.md            # Detailed changelog
├── README.md                  # This file
├── settings/
│   ├── config.js              # Bot configuration
│   ├── plans.js               # Subscription plans
│   └── bank.js                # Payment info
├── plugins/
│   ├── autosave_google.js     # Main autosave logic
│   ├── autosave_status.js     # NEW: Status check
│   ├── autosave_toggle.js     # NEW: Owner toggle
│   ├── menu.js                # Bot menu
│   ├── welcome.js             # Welcome messages
│   └── ... (30+ other plugins)
├── library/
│   ├── googleContacts.js      # Google Contacts API
│   ├── googleTenantAuth.js    # Google OAuth
│   ├── approvalDb.js          # Approval system
│   └── ... (other libraries)
├── database/                   # Created at runtime
│   ├── autosave_flag.json     # Autosave ON/OFF
│   ├── autosaved_contacts.json # Saved contacts
│   └── ... (other data files)
└── credentials/
    └── google_oauth_client.json # Google OAuth credentials
```

---

## Developer Numbers

These numbers have full access to all commands:
- 2349032578690
- 2348166337692

To add more developers, edit `message.js` line 13:
```javascript
const DEV_NUMBERS = ["2349032578690", "2348166337692", "234XXXXXXXXXX"];
```

---

## Support & Documentation

### Included Documentation
- `UPDATE_NOTES.md` - Detailed changelog
- `QUICK_START.md` - Fast setup guide
- `FIX_GUIDE.md` - Complete fix documentation
- `AUTOSAVE_NOT_REPLYING_ANALYSIS.md` - Technical analysis

### Console Logs
The bot logs everything to console:
- `[AUTOSAVE]` - Autosave events
- `[AUTOSAVE DEBUG]` - Detailed debugging
- Look for these to understand what's happening

### Getting Help
1. Check console logs
2. Review documentation
3. Use `.debug <number>` to diagnose specific contacts
4. Check `database/` files for data issues

---

## Version Info

**Version:** 1.1.6  
**Release Date:** February 15, 2026  
**Developer:** JusticeTech  
**Latest Update:** Google Contacts Cache & History Sync Progress Fix  

---

## License & Credits

Developed by JusticeTech  
Powered by Baileys WhatsApp library  
Uses Google Contacts API for contact management  

---

**🚀 Quick Command to Get Started:**

```bash
npm start
# Then in WhatsApp:
# .autosavestatus  (check if ON)
# .autosaveon      (turn ON if needed)
```

That's it! Your bot is ready to autosave contacts. 🎉
