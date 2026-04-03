# 🎯 AGENT FOCUS AREAS - FUNCTION-SPECIFIC GUIDES

**Version**: 2.0  
**Last Updated**: April 3, 2026  
**Purpose**: Technical reference for agents before fixing bugs  
**Related**: ERROR-RESOLUTION-CHECKLIST.md, CRITICAL-BUGS-DETAILED.md  
**Start Here**: docs/agent/INDEX.md

Detailed guide for each critical function and area. Agent should read relevant section before fixing.

---

## FOCUS AREA 1: Authentication & Session Flow

### Files to Know
- `app.js` - Session config, middleware mounting
- `middleware/auth.js` - Authentication logic
- `routes/auth.js` - Login/logout endpoints
- `database.js` - User table schema

### Key Functions

#### ✍️ getSafeUserId(req)
```javascript
// LOCATION: Multiple files (personnel.js, rooms.js, reports.js)

function getSafeUserId(req) {
  const rawUserId = req.session && req.session.user ? req.session.user.id : null;
  const actorUser = rawUserId ? db.prepare('SELECT id FROM users WHERE id = ?').get(rawUserId) : null;
  return actorUser ? actorUser.id : null;
}

// PURPOSE: Safely get authenticated user ID from session
// PATTERN: Called in ALL route handlers before logActivity()

// **WATCH OUT FOR**:
// ✅ CORRECT: if (!safeUserId) { return error or use null }
// ❌ WRONG: Assume req.session.user always exists

// TEST:
// 1. Login → session.user exists → getSafeUserId returns ID
// 2. Direct GET protected route (no auth) → session null → returns null
// 3. Check all routes use getSafeUserId() before database writes
```

#### 🔐 Auth Middleware
```javascript
// LOCATION: middleware/auth.js

// Should protect routes:
// router.get('/', checkAuth, (req, res) => ...)

// CHECK: Is checkAuth applied to sensitive routes?
// - POST /personel/* (create/delete)
// - POST /esya-takip/* (equipment handover)
// - POST /odalar/* (room management)

grep -r "checkAuth\|requireAuth\|middleware" routes/*.js | wc -l
# Should be high count (50+)
```

### Common Issues & Fixes

**Issue**: Admin bypass - session.user hardcoded
```javascript
// ❌ WRONG - in app.js middleware:
app.use((req, res, next) => {
  if (!req.session.user) {
    req.session.user = { id: 1, role: 'admin' };  // HARDCODE!
  }
  next();
});

// ✅ CORRECT - remove that middleware entirely
// Auth should only set session on successful login
```

**Issue**: Session persists after logout
```javascript
// routes/auth.js logout handler

// ❌ WRONG:
req.session.user = null;  // Not enough

// ✅ CORRECT:
delete req.session.user;
req.session.destroy(() => {
  res.redirect('/login');
});
```

---

## FOCUS AREA 2: Room & Personnel Assignment

### Files to Know
- `routes/personnel.js` - Personnel CRUD & assignment
- `routes/rooms.js` - Room management & inventory
- `database.js` - Room/personnel schema & sync functions

### Critical Data Flow

```
FLOW: Assign Person to Room
┌─────────────┐
│ POST /personel/{id}/oda-degistir
│ Params: new_room_id, allow_cleaning_override
└──────┬──────┘
       │
       ↓
┌─────────────────────────────────┐
│ Validate room exists & available│
│ Check capacity not exceeded      │
│ Check availability_status        │
└──────┬──────────────────────────┘
       │
       ↓
┌─────────────────────────────────┐
│ START TRANSACTION               │
│ UPDATE personnel SET room_id=.. │
│ CALL syncRoomKeyStock(oldRoom)  │ ← Decrement keys
│ CALL syncRoomKeyStock(newRoom)  │ ← Decrement keys  
│ CALL updateRoomStatus(oldRoom)  │ ← Update "temiz"/"dolu"
│ CALL updateRoomStatus(newRoom)  │ ← Update "temiz"/"dolu"
│ CALL logActivity(...)           │ ← Log to audit
│ COMMIT                          │
└──────┬──────────────────────────┘
       │
       ↓
┌─────────────┐
│ Emit socket │ → Real-time update to browsers
└─────────────┘
```

### Key Functions

#### 📊 syncRoomKeyStock(roomId)
```javascript
// LOCATION: database.js

// PURPOSE: Update key count based on occupancy
// RULE: One key per occupied bed

// PROCESS:
// 1. Count occupied personnel in room
// 2. Get max_quantity for "Oda Anahtarı" from room_inventory
// 3. Set quantity = max_quantity - occupied_count
// 4. Ensure quantity >= 0 (don't go negative)

// **MUST TEST**:
// □ Room with 2 beds, 1 occupied → keys = 1
// □ Room with 2 beds, 2 occupied → keys = 0
// □ Room with 2 beds, 0 occupied → keys = 2
// □ Never goes negative
```

#### 🏠 updateRoomStatus(roomId)
```javascript
// This updates the room's visible "status" tag
// 'musait', 'temizlenmeli', 'kullanilamaz'

// RULE:
// - If occupancy = 0 → 'musait' (available)
// - If occupancy > 0 AND occupancy < capacity → 'kismi_dolu' (partial)
// - If occupancy >= capacity → 'dolu' (full)

// **Check this function handles all cases**
```

#### 🎯 isRoomAtCapacity(roomId, excludePersonnelId)
```javascript
// PURPOSE: Check if room has space for one more person

// LOGIC:
// capacity = room.capacity
// current_occupancy = COUNT(personnel WHERE room_id=X AND status='aktif')
// If exclude_personel_id provided, don't count that person
// Return: is_at_capacity = (current_occupancy >= capacity)

// **TEST CASES**:
// □ Room capacity=2, occupancy=1, new person → return FALSE (has space)
// □ Room capacity=2, occupancy=2, new person → return TRUE (full)
// □ Exclude self-reassignment: old room occupancy should not include person
```

### Common Issues & Fixes

**Issue**: Key stock becomes negative
```javascript
// ❌ WRONG - no bounds checking:
db.prepare('UPDATE room_inventory SET quantity = quantity - 1 WHERE room_id=?').run(roomId);

// ✅ CORRECT - atomic transaction + validation:
db.transaction(() => {
  const occupied = db.prepare(
    'SELECT COUNT(*) as count FROM personnel WHERE room_id=? AND status="aktif"'
  ).get(roomId);
  
  const maxQty = db.prepare(
    'SELECT max_quantity FROM room_inventory WHERE room_id=? AND LOWER(item_name) LIKE "%anahtar%"'
  ).get(roomId);
  
  const newQty = Math.max(0, (maxQty?.max_quantity || 0) - occupied.count);
  
  db.prepare('UPDATE room_inventory SET quantity=? WHERE room_id=? AND LOWER(item_name) LIKE "%anahtar%"')
    .run(newQty, roomId);
})();
```

**Issue**: Room occupancy counts wrong
```javascript
// ❌ WRONG - counts all statuses:
SELECT COUNT(*) FROM personnel WHERE room_id=?

// ✅ CORRECT - only count active:
SELECT COUNT(*) FROM personnel WHERE room_id=? AND status='aktif'
```

---

## FOCUS AREA 3: Zimmet (Handover) & Issue Tracking

### Files to Know
- `routes/personnel.js` - Checkout modal, handover submission
- `routes/rooms.js` - Issue creation, resolution
- `database.js` - room_issues schema
- `views/personnel/detail.ejs` - UI for zimmet flow

### Data Model

```sql
-- Inventory items for room
room_inventory:
  - room_id
  - item_name (e.g., "Oda Anahtarı", "Yatak")
  - condition: 'saglam' | 'eksik' | 'arizali' | 'kirik' | 'calismiyor' | 'kayip' | 'diger'

-- Problem tracking
room_issues:
  - room_id
  - inventory_item_name (links to room_inventory.item_name)
  - issue_tag: 'eksik' | 'arizali' | 'kirik' | 'calismiyor' | 'kayip' | 'diger'
  - status: 'acik' | 'devam_ediyor' | 'cozuldu'
  - resolved_at: timestamp when status='cozuldu'

-- Person handover
personnel:
  - entry_handover_payload: JSON of items received on checkin
  - checkout_handover_payload: JSON of items returned on checkout
  - checkout_key_returned: 1|0 - was key returned at checkout?
```

### Key Functions

#### 🎭 syncHandoverIssuesForRoom(roomId, handoverItems)
```javascript
// LOCATION: database.js, called from routes/personnel.js

// PURPOSE: When personnel checks out, save zimmet problems to room_issues

// INPUT: handoverItems = [
//   { name: "Oda Anahtarı", delivered: true, tag: null, description: null },
//   { name: "Yatak", delivered: false, tag: "kirik", description: "Bacak kırık" }
// ]

// LOGIC:
// For each item:
//   IF delivered == true:
//     Mark any open issue for this item as 'cozuldu'
//   ELSE (not delivered):
//     Create open issue with tag + description
//     OR update latest open issue if exists

// **CRITICAL**: Avoid duplicates!
// Always update latest open issue, don't create new one each time

// **TEST**:
// □ Checkout with 1 broken item → 1 room_issue created
// □ Checkout again with same item broken → same issue updated (count = 1, not 2)
// □ Checkout with item fixed → issue marked 'cozuldu'
```

#### 🔧 resolveRoomIssue(roomId, itemName)
```javascript
// LOCATION: routes/rooms.js

// Called by: Reassign modal when marking item as "Sağlam Teslim Edildi"

// ACTION:
// Find latest open issue for this item in this room
// Mark status = 'cozuldu', resolved_at = NOW

// **TEST**:
// □ Open issue exists → resolved
// □ Multiple open issues for same item → resolve latest
// □ No issue exists → no error (graceful)
```

#### 📋 syncInventoryConditionWithOpenIssues(roomId, itemName)
```javascript
// LOCATION: database.js

// PURPOSE: Update room_inventory.condition based on latest open issue

// LOGIC:
// Find latest open room_issue for this item
// IF issue exists AND status != 'cozuldu':
//   condition = issue.issue_tag (e.g., 'arizali')
// ELSE:
//   condition = 'saglam'

// This keeps inventory.condition in sync with active issues
```

### Common Issues & Fixes

**Issue**: Modal closes after "confirm broken item" dialog
```javascript
// This happens in views/personnel/detail.ejs reassign modal

// ❌ SYMPTOM: 
// 1. User marks item as "Sağlam Teslim Edildi"
// 2. Confirm dialog: "Sorun kaydı var, onaylıyor musunuz?"
// 3. User clicks OK
// 4. Modal closes unexpectedly

// ✅ FIX: Catch errors in async fetch
// In reassign change handler:
resolveRoomIssueInBackground(roomId, itemName)
  .then(() => {
    // Update UI
    try {
      roomOpenIssueMap[String(roomId)][itemName] = null;
      // ... update DOM
    } catch (e) {
      console.error('DOM update failed:', e);
      // Don't let exception close modal
    }
  })
  .catch((err) => {
    alert('Error: ' + err.message);
    // Keep modal open on error
  });
```

**Issue**: Duplicate zimmet issues created
```javascript
// ❌ WRONG - creates new issue each time:
db.prepare('INSERT INTO room_issues (...)').run(...);  // Always inserts

// ✅ CORRECT - update existing open issue:
const existing = db.prepare(
  'SELECT id FROM room_issues WHERE room_id=? AND inventory_item_name=? AND status != "cozuldu"'
).get(roomId, itemName);

if (existing) {
  db.prepare('UPDATE room_issues SET ... WHERE id=?').run(existing.id);
} else {
  db.prepare('INSERT INTO room_issues (...)').run(...);
}
```

---

## FOCUS AREA 4: Photo Upload & Path Handling

### Files to Know
- `routes/personnel.js` - Photo upload handling
- `middleware/multer-config.js` or upload setup in routes
- `views/personnel/detail.ejs` - Display photos

### Path Normalization

```javascript
// FUNCTION: normalizePhotoPath(photoPath)

// PURPOSE: Convert various path formats to standard web format
// INPUT formats that should all give same output:
//   - "C:\uploads\personnel\photo.jpg" (Windows absolute)
//   - "\uploads\personnel\photo.jpg" (Windows relative)
//   - "/uploads/personnel/photo.jpg" (Unix already normalized)
//   - "uploads/personnel/photo.jpg" (Relative no slash)
//   - "public/uploads/personnel/photo.jpg" (With public prefix)

// EXPECTED OUTPUT: "/uploads/personnel/photo.jpg"

// LOGIC:
// 1. Replace all backslashes with forward slashes
// 2. Remove "C:" and other drive letters
// 3. Remove "public/" prefix if present
// 4. Find first occurrence of "uploads/"
// 5. Return only path from there onwards
// 6. Ensure leading slash

// TEST:
sqlite3 lojman.db "SELECT COUNT(*) FROM personnel WHERE photo_path NOT LIKE '/%' OR photo_path LIKE '%\\%';"
# Should return 0 (no bad paths)
```

### Common Issues & Fixes

**Issue**: Photo shows 404
```javascript
// CHECK CHAIN:

// 1. Database path format
sqlite3 lojman.db "SELECT id, first_name, photo_path FROM personnel WHERE photo_path IS NOT NULL LIMIT 1;" | head

// 2. File exists on disk
ls -la public/uploads/personnel/

// 3. Static file serving configured
grep "express.static" app.js

// 4. Browser developer tools
// Open inspector → <img src="...">
// Copy src value
// Test in new tab: http://localhost:3000/{src}
// Should not 404
```

---

## FOCUS AREA 5: Database Transactions & Atomicity

### Pattern to Follow

```javascript
// ALL multi-step database writes should use transaction:

// ❌ WRONG:
db.prepare('UPDATE personnel SET room_id=? WHERE id=?').run(newRoomId, personId);
db.prepare('UPDATE room_inventory SET quantity=quantity-1 WHERE room_id=?').run(newRoomId);
logActivity(...);  // If this fails, above changes still applied

// ✅ CORRECT:
const txResult = db.transaction(() => {
  db.prepare('UPDATE personnel SET room_id=? WHERE id=?').run(newRoomId, personId);
  db.prepare('UPDATE room_inventory SET quantity=quantity-1 WHERE room_id=?').run(newRoomId);
  
  try {
    logActivity(...);
  } catch (logErr) {
    console.error('Log error:', logErr);
    // Still rollback? Or log separately?
  }
  
  return { success: true };
})();

if (!txResult.success) {
  return res.status(500).send('Transaction failed');
}
```

### Transaction Checklist

- [ ] Do changes need to be all-or-nothing?
- [ ] Can one failure leave data in inconsistent state?
- [ ] Is there a FK constraint that could break?
- [ ] Wrap in `db.transaction(() => { ... })()`
- [ ] Test both success and failure paths

---

## Quick Reference: Function Locations

| Function | File | Purpose |
|----------|------|---------|
| `initDatabase()` | database.js | Schema creation & migration |
| `getSafeUserId()` | routes/*.js | Safe user ID extraction |
| `syncRoomKeyStock()` | database.js | Update key inventory |
| `updateRoomStatus()` | routes/rooms.js | Update room availability |
| `isRoomAtCapacity()` | routes/personnel.js | Check room space |
| `syncHandoverIssuesForRoom()` | database.js | Save zimmet problems |
| `syncInventoryConditionWithOpenIssues()` | database.js | Sync inventory condition |
| `normalizePhotoPath()` | routes/personnel.js | Fix photo path format |
| `logActivity()` | database.js | Record audit trail |

---

## When to Add Logging

```javascript
// Add console.log in:
// 1. Transaction start/end
console.log(`[TX] Starting room assignment for person ${personId}`);

// 2. Before/after critical state changes
console.log(`[BEFORE] Room ${roomId} keys: ${beforeKeys}, after: ${afterKeys}`);

// 3. Error conditions
console.error(`[ERROR] Failed to sync keys: ${err.message}`);

// 4. API responses (in routes)
console.log(`[RESPONSE] POST /personel/${id}/oda-degistir → ${statusCode}`);

// Then use in production:
// npm start 2>&1 | grep "ERROR" → all errors
// npm start 2>&1 | grep "TX" → transactions only
```

