# URGENT FIX - Saved Contacts Still Getting Prompts

## What I Fixed

### 1. Strengthened Saved Contact Detection
Changed from basic OR check to comprehensive multi-condition check:

**OLD (Weak):**
```javascript
if (existing?.google?.resourceName || existing?.savedAt || existing?.name) {
  return; // Skip autosave
}
```

**NEW (Strong):**
```javascript
const isSaved = existing && (
  existing.google?.resourceName ||
  existing.savedAt ||
  existing.name ||
  existing.number  // Added this
);

if (isSaved) {
  console.log(`Skipping saved contact ${contactNumber}`);
  return; // Skip autosave
}
```

### 2. Added Detailed Logging
Every message now logs what the bot finds:
- Whether contact exists in database
- Which fields are present (resourceName, savedAt, name, number)
- Full contact data (JSON)
- Whether autosave flow is triggered or skipped

### 3. Created Debug Command
New command: `.debug <number>`
- Shows if contact is saved
- Shows which fields are present
- Shows full database entry

### 4. Added Save Confirmation Logging
When a contact is saved, bot logs:
- Contact number
- Name saved
- Full saved data

## How to Use

### After Deployment:

1. **Watch the console** when messages come in:
   ```
   [AUTOSAVE DEBUG] Contact 234801234567: { exists: true, ... }
   [AUTOSAVE] Skipping saved contact 234801234567
   ```

2. **Check specific contacts:**
   ```
   .debug 234801234567
   ```
   Shows if they're marked as saved in database

3. **Test the flow:**
   - Message from new number → Should start autosave ✅
   - Complete autosave
   - Message from same number → Should NOT start autosave ✅

## Files Changed

1. **plugins/autosave_google.js**
   - Added comprehensive logging
   - Strengthened saved contact check
   - Added number field to check

2. **plugins/debug.js** (NEW)
   - Debug command to check contact status

## What to Check If Still Broken

If saved contacts STILL get prompts:

1. **Check console logs** - Look for `[AUTOSAVE DEBUG]` lines
2. **Run `.debug <number>`** for the problematic contact
3. **Verify the number format** - Must be digits only (no +, spaces, etc.)
4. **Check database file** - `database/autosaved_contacts.json`
5. **Confirm bot restarted** after deploying this fix

## Most Likely Cause

If the fix doesn't work, it's probably one of:

1. **Number format mismatch** - Saved as one format, checked as another
2. **Multiple owner accounts** - Saved under different owner number
3. **Database not persisting** - File permissions or write errors
4. **Contact has partial data** - Some fields missing

The debug logs will reveal which one it is.

## Emergency Workaround

If you need an immediate solution while debugging:

Temporarily disable autosave for testing:
```
.autosavestatus off
```

Then re-enable after fixing:
```
.autosavestatus on
```
