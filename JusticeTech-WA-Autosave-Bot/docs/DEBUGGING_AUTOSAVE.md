# DEBUGGING GUIDE - Autosave Not Skipping Saved Contacts

## Problem
The bot is still replying to and trying to save contacts that have already been saved.

## Fixes Applied

### 1. Enhanced Saved Contact Detection
**File:** `plugins/autosave_google.js`

Added multiple checks to determine if a contact is saved:
```javascript
const isSaved = existing && (
  existing.google?.resourceName ||
  existing.savedAt ||
  existing.name ||
  existing.number
);
```

A contact is considered "saved" if it has ANY of these fields.

### 2. Added Comprehensive Logging
The bot now logs detailed information when processing messages:

```
[AUTOSAVE DEBUG] Contact 2348012345678:
  exists: true
  hasResourceName: true
  hasSavedAt: true
  hasName: true
  existing: {"name":"John 🧾 LEAD","rawName":"John",...}

[AUTOSAVE] Skipping saved contact 2348012345678 - will not send autosave prompt
```

OR for unsaved contacts:
```
[AUTOSAVE DEBUG] Contact 2349087654321:
  exists: false
  hasResourceName: false
  hasSavedAt: false
  hasName: false
  existing: null

[AUTOSAVE] Contact 2349087654321 is NOT saved - starting autosave flow
```

### 3. Save Confirmation Logging
When a contact is saved, the bot logs:
```
[AUTOSAVE] ✅ Successfully saved contact 2348012345678 with name: John 🧾 LEAD
[AUTOSAVE] Saved data: {"name":"John 🧾 LEAD","rawName":"John",...}
```

### 4. New Debug Command
Use `.debug <number>` to check if a contact is saved:

**Command:**
```
.debug 2348012345678
```

**Output:**
```
📊 Debug Result for 2348012345678

Status: ✅ SAVED
Owner: 2349032578690

Field Check:
• savedAt: ✅ 2026-02-13T17:30:00.000Z
• google.resourceName: ✅
• name: ✅ John 🧾 LEAD
• number: ✅ 2348012345678

Full Data:
{
  "name": "John 🧾 LEAD",
  "rawName": "John",
  "wasGeneric": false,
  "number": "2348012345678",
  "jid": "2348012345678@s.whatsapp.net",
  "savedAt": "2026-02-13T17:30:00.000Z",
  "google": {
    "resourceName": "people/c123456789",
    "etag": "%EgUBAgc=",
    "mode": "create"
  }
}
```

## How to Debug

### Step 1: Check the Console Logs
When a saved contact sends a message, you should see:
```
[AUTOSAVE DEBUG] Contact XXXXXXXXXX: { exists: true, hasResourceName: true, ... }
[AUTOSAVE] Skipping saved contact XXXXXXXXXX - will not send autosave prompt
```

If you see this but the bot still replies, there's an issue with the early return.

### Step 2: Use the Debug Command
For any contact that's getting autosave prompts when they shouldn't:
```
.debug <their_phone_number>
```

This will show you exactly what's stored in the database for that contact.

### Step 3: Check What Number Format is Being Used
The logs will show the exact phone number being checked. Make sure it matches the format in your database (digits only, no + or country code prefix duplicates).

### Step 4: Verify Database File
Check `database/autosaved_contacts.json` to see the actual stored data:
```json
{
  "contacts": {
    "2349032578690": {
      "2348012345678": {
        "name": "John 🧾 LEAD",
        "savedAt": "2026-02-13T17:30:00.000Z",
        ...
      }
    }
  }
}
```

## Common Issues and Solutions

### Issue 1: Contact Number Format Mismatch
**Problem:** Contact is saved as `2348012345678` but checked as `+2348012345678`
**Solution:** The bot now normalizes all numbers to digits-only format

### Issue 2: Database Not Persisting
**Problem:** Contact is saved but disappears after restart
**Solution:** Check that `database/autosaved_contacts.json` exists and has write permissions

### Issue 3: Multiple Owner Numbers
**Problem:** Contact saved under one owner number but bot running as different owner
**Solution:** Check console logs to see which owner number the bot is using

### Issue 4: Contact Has Partial Data
**Problem:** Contact object exists but missing key fields
**Solution:** The new check looks for ANY of: resourceName, savedAt, name, or number

## Testing Steps

1. **Test with a new unsaved contact:**
   - Send message from unsaved number
   - Should see: `[AUTOSAVE] Contact XXXXX is NOT saved - starting autosave flow`
   - Should receive welcome message
   - Complete autosave flow

2. **Test with the newly saved contact:**
   - Send another message from same number
   - Should see: `[AUTOSAVE] Skipping saved contact XXXXX`
   - Should NOT receive any autosave prompts

3. **Verify with debug command:**
   ```
   .debug <the_number_you_just_saved>
   ```
   - Should show: `Status: ✅ SAVED`
   - All fields should show ✅

## If Issue Persists

If saved contacts are STILL getting autosave prompts after these fixes:

1. **Share the console logs** - The `[AUTOSAVE DEBUG]` and `[AUTOSAVE]` lines
2. **Run `.debug <number>`** for the problematic contact
3. **Check `database/autosaved_contacts.json`** - Share the entry for that contact
4. **Verify bot restart** - Make sure you restarted after deploying the fix

This will help identify the exact issue.
