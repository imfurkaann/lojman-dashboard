# 🤖 AGENT DEBUG WORKFLOW - STEP BY STEP

Use this workflow template for each bug fix.

---

## Quick Start Agent Command

```bash
# For each P0/P1 bug:
agent="LojmanDebugDocsAgent"  # Use this specific agent

# Commands:
# 1. READ: Read CRITICAL-BUGS-DETAILED.md for [BUG_NAME]
# 2. TERMINAL: Run terminal commands from guide
# 3. ANALYZE: Check code locations provided
# 4. FIX: Implement fix with code snippets  
# 5. TEST: Run test scenarios
# 6. VERIFY: Update ERROR-RESOLUTION-CHECKLIST.md ✅
```

---

## Template: Bug #X Fix Workflow

### PHASE 1: INFORMATION GATHERING

**1.1 Read Bug Documentation**
```
DOC: Read docs/agent/CRITICAL-BUGS-DETAILED.md section [BUG_ID]/[BUG_NAME]
EXTRACT: Root cause, file locations, test scenarios
```

**1.2 Terminal Reconnaissance**
```bash
# Example for P0.1 (hardcoded session)
grep -r "req.session.user\s*=" routes/ app.js middleware/ --include="*.js"

# Example for P1.1 (sync error)
grep -n "syncRoomKeyStock\|syncHandoverIssuesForRoom" routes/*.js database.js
```

**1.3 Code Location Mapping**
```
File:     routes/personnel.js
Function: assignPersonnelToRoom()
Line:     ~450
Context:  Person assignment logic - key stock sync
```

---

### PHASE 2: ROOT CAUSE ANALYSIS

**2.1 Expected vs Actual**
```
Expected Behavior: 
  - Assign person to room
  - Key count decrements by 1
  - Person.room_id updated
  - Activity logged

Actual Behavior (observed):
  - Keys don't decrement
  - Person.room_id updated (partial works)
  - No activity log
```

**2.2 Code Inspection**
```javascript
// Check file: routes/personnel.js line ~450

// Current code:
db.prepare('UPDATE personnel SET room_id = ? WHERE id = ?').run(roomId, personId);
// ❌ Missing: syncRoomKeyStock(roomId)
// ❌ Missing: logActivity()
// ❌ Missing: transaction wrapper
```

**2.3 Hypothesis**
```
Hypothesis: syncRoomKeyStock() not called after assignment
Confidence: HIGH
Evidence: 
  - Function exists in database.js
  - Called in other flows but not here
  - Key counts remain static
```

---

### PHASE 3: FIX IMPLEMENTATION

**3.1 Create Backup**
```bash
# Before any changes
cp routes/personnel.js routes/personnel.js.backup
sqlite3 lojman.db ".backup lojman.db.backup"
echo "Backups created"
```

**3.2 Implement Fix**
```javascript
// File: routes/personnel.js
// Function: ~450 assignPersonnelToRoom

// BEFORE:
db.prepare('UPDATE personnel SET room_id = ? WHERE id = ?').run(roomId, personId);

// AFTER:
db.transaction(() => {
  db.prepare('UPDATE personnel SET room_id = ?, status = ? WHERE id = ?')
    .run(roomId, 'aktif', personId);
  
  syncRoomKeyStock(roomId);  // ← Added
  logActivity('oda_tahsis', `${personName} - ${roomNumber}'e atandı`, null, safeUserId);  // ← Added
})();
```

**3.3 Verify Syntax**
```bash
# Check for JS syntax errors
node -c routes/personnel.js
# Output: Should be silent (no errors)

# Or start app and watch for parse errors
npm start 2>&1 | head -50
```

---

### PHASE 4: TEST EXECUTION

**4.1 Unit Test**
```bash
# Start clean
npm start

# Test case from TEST-VALIDATION-MATRIX: ROOM-1
echo "TEST: Assign person to room"

# Manual workflow test:
# 1. Open browser: http://localhost:3000/login
# 2. Login as admin
# 3. Go to Personnel list
# 4. Add new person: Ali Veli
# 5. Click detail → "Oda Değiştir"
# 6. Select Oda 101
# 7. Check /odalar/101 - key count should decrement

# Or curl test:
COOKIES="/tmp/cookies.txt"

# Step 1: Login
curl -c $COOKIES -d "username=admin&password=admin" \
  http://localhost:3000/login &>/dev/null

# Step 2: Add person
curl -b $COOKIES -d "first_name=TestAli&last_name=Veli&gender=erkek&phone=05551234567" \
  -X POST http://localhost:3000/personel/ekle > /dev/null 2>&1

# Step 3: Get new person ID (check DB)
PERSON_ID=$(sqlite3 lojman.db "SELECT id FROM personnel WHERE first_name='TestAli' ORDER BY id DESC LIMIT 1;")
echo "Created person ID: $PERSON_ID"

# Step 4: Assign to room
curl -b $COOKIES \
  -d "new_room_id=1&reassign_form_signed=0&reassign_key_delivered=0" \
  -X POST http://localhost:3000/personel/$PERSON_ID/oda-degistir > /dev/null 2>&1

# Step 5: Verify
ROOM_KEYS=$(sqlite3 lojman.db \
  "SELECT quantity FROM room_inventory WHERE room_id=1 AND LOWER(item_name) LIKE '%anahtar%';")
echo "Room 101 key count after assignment: $ROOM_KEYS"
echo "✅ PASS if keys decremented from initial"
```

**4.2 Regression Test**
```bash
# Run full test matrix for MODULE 3 (Room Assignment)
# Run tests: ROOM-1 through ROOM-7

# Create test script: test-room-module.sh
#!/bin/bash
npm start &
sleep 3

# ROOM-1 test
curl -c /tmp/cookies.txt -d "username=admin&password=admin" \
  http://localhost:3000/login
# ... (rest of tests)

kill %1  # Stop server
```

**4.3 Check Logs**
```bash
# While running, check console output
npm start

# Should see:
# ✅ "logActivity called" 
# ✅ "syncRoomKeyStock executed"
# ✅ No errors in transaction
```

---

### PHASE 5: VERIFICATION & DOCUMENTATION

**5.1 Database Verify**
```bash
# Check correct state in DB
sqlite3 lojman.db << 'EOF'
-- Verify person assigned
SELECT id, first_name, room_id, status FROM personnel WHERE first_name='TestAli';

-- Verify key count synced
SELECT room_id, item_name, quantity FROM room_inventory 
WHERE room_id=1 AND LOWER(item_name) LIKE '%anahtar%';

-- Verify activity logged
SELECT * FROM activity_log WHERE personnel_id=(SELECT id FROM personnel WHERE first_name='TestAli' ORDER BY id DESC LIMIT 1) 
ORDER BY created_at DESC LIMIT 1;
EOF
```

**5.2 Update Checklist**
```bash
# Edit: docs/agent/ERROR-RESOLUTION-CHECKLIST.md

# Find section:
# ### P1.1 - Personel-Oda-Zimmet Sync Hatası

# Add under "Fix" line:
# ✅ [DATE] Fixed by [AGENT]: syncRoomKeyStock() added to personnel assignment
# ✅ Tested ROOM-1 through ROOM-7 scenarios
# ✅ DB verification passed
```

**5.3 Create Test Report**
```bash
cat > /tmp/bug-fix-report.txt << 'EOF'
BUG FIX REPORT
==============
Bug ID: P1.1
Bug Name: Personel-Oda-Zimmet Sync Hatası
Severity: HIGH
Fixed: [DATE] by [AGENT]

Root Cause: syncRoomKeyStock() not called during personnel assignment

Changes Made:
- File: routes/personnel.js
- Function: assignPersonnelToRoom()
- Added: db.transaction() wrapper
- Added: syncRoomKeyStock(roomId) call
- Added: logActivity() call

Test Results:
✅ ROOM-1: Assign room to person - PASS
✅ ROOM-2: Key stock sync - PASS
✅ ROOM-3: Capacity check - PASS
✅ ROOM-4: Room list - PASS
✅ Regression: All MODULE 3 tests - PASS

Verification:
✅ DB state correct
✅ Activity logged
✅ No console errors

Ready for: Production deployment
EOF

cat /tmp/bug-fix-report.txt
```

---

## Multi-Bug Sequence Workflow

When fixing multiple bugs in sequence:

### Order: P0.1 → P0.2 → P0.3 → P1.1 → P1.2 → ...

```bash
# For each bug:
# 1. PHASE 1: Info gathering (5 min)
# 2. PHASE 2: Root cause (5 min)
# 3. PHASE 3: Implement (10 min)
# 4. PHASE 4: Test (15 min)
# 5. PHASE 5: Verify (5 min)
# Total: ~40 min per bug

# Between bugs:
npm start  # Fresh start
# Regression test previous fixes still work
# Then: Fix next bug

# After all bugs fixed:
# Full TEST-VALIDATION-MATRIX.md execution
# Full module testing
```

---

## Emergency Rollback

If fix breaks something:

```bash
# Immediate rollback
git checkout routes/personnel.js  # Or restore from backup
# OR
cp routes/personnel.js.backup routes/personnel.js

# Restart
npm start

# Re-diagnose
# Update checklist: "Fix failed at PHASE X - rollback applied"
```

---

## Agent Decision Tree

```
START: "Fix bug P0.1" 
  │
  ├─→ Understand problem (read CRITICAL-BUGS-DETAILED.md)
  │   └─→ Got it? → Continue | No? → Re-read, ask clarification
  │
  ├─→ Run diagnostic commands
  │   └─→ Problem confirmed? → Continue | No? → Check different file
  │
  ├─→ Implement fix
  │   └─→ Backup taken? → Yes? → Proceed | No? → Backup first
  │   └─→ Syntax check passed? → Yes? → Continue | No? → Fix syntax
  │
  ├─→ Run tests
  │   └─→ All PASS? → Continue | Some FAIL? → Re-analyze code
  │
  ├─→ Verify in DB/Browser
  │   └─→ Correct state? → Continue | Wrong? → Rollback
  │
  ├─→ Update documentation
  │   └─→ Checklist updated? → Yes? → DONE ✅
  │       └─→ Test report created? → Yes? → READY FOR NEXT BUG
  │
  END: "Bug fixed and verified"
```

---

## Performance Tips for Agents

1. **Parallel Operations**: While code compiles, run database verification queries
2. **Smart Grep**: Use `-n` flag to get line numbers, faster navigation
3. **Reuse Terminals**: Keep 1 terminal for server, 1 for commands
4. **Test Early**: Don't wait until all phases done - test incrementally
5. **Cache Results**: Store grep results in temp files for re-use

---

## Common Pitfalls to Avoid

❌ **DON'T**: Rush Phase 5 - documentation is critical for next agent
❌ **DON'T**: Forget database backups before changes
❌ **DON'T**: Skip Phase 4 regression tests
❌ **DON'T**: Update code without reading context fully
❌ **DON'T**: Mix multiple bug fixes in single commit

✅ **DO**: Take systematic approach
✅ **DO**: Document every finding
✅ **DO**: Verify with multiple test methods
✅ **DO**: Update checklists as you go
✅ **DO**: Leave clear notes for next agent

