# 🚨 KRITIK VE YÜKSEK ÖNCELİKLİ HATALAR - DETAYLI REHBER

**Version**: 2.0  
**Last Updated**: April 3, 2026  
**Related Files**: ERROR-RESOLUTION-CHECKLIST.md, TEST-VALIDATION-MATRIX.md, copilot-instructions.md  
**Entry Point**: docs/agent/INDEX.md → This file

---

## P0.1: req.session.user Hardcode Sorunu ⚠️ BLOCK

### Sorun Tanımı
App startup veya belirli middleware'de session'a hardcode user ataması yapılıyor.

### Etki
- Tüm requests admin user gibi log ediliyor
- Auth role check bypassed
- Test users real test yapamıyorlar

### Bulma Aşaması

**Terminal Command**:
```bash
# Search for hardcoded session assignment
grep -r "req.session.user\s*=" routes/ app.js middleware/ --include="*.js"  | head -20

# Check auth.js specifically
grep -n "req.session.user" routes/auth.js
```

### Kod Analizi

**Beklenen Pattern** (Doğru):
```javascript
// routes/auth.js - POST /login
router.post('/login', (req, res) => {
  const { username, password } = req.body;
  const user = db.prepare('SELECT id, username, full_name, role FROM users WHERE username = ?').get(username);
  
  if (!user || !bcrypt.compareSync(password, userPasswordHash)) {
    return res.status(401).send('Invalid credentials');
  }
  
  // ✅ Session - real login'den sonra
  req.session.user = {
    id: user.id,
    username: user.username,
    full_name: user.full_name,
    role: user.role
  };
  
  res.redirect('/dashboard');
});
```

**Hatalı Pattern** (Doğru Değil):
```javascript
// app.js - MIDDLEWARE içinde
app.use((req, res, next) => {
  // ❌ YANLIŞ: Hardcoded session - hiçbir zaman böyle yapılmamalı
  if (!req.session.user) {
    req.session.user = {
      id: 1,
      username: 'admin',
      full_name: 'System Admin',
      role: 'admin'
    };
  }
  next();
});
```

### Fix Prosedürü

**Step 1**: app.js'de hardcode check et
```bash
cat app.js | grep -A 5 -B 5 "req.session.user"
```

**Step 2**: Bulunursa, o kod bloğu SİL
```javascript
// ❌ Sil bu bölümü
app.use((req, res, next) => {
  if (!req.session.user) {
    req.session.user = { id: 1, username: 'admin', ... };
  }
  next();
});
```

**Step 3**: Auth route test et
```bash
# App restart
npm start

# Login test
curl -c cookies.txt -d "username=admin&password=admin" http://localhost:3000/login

# Protected endpoint test
curl -b cookies.txt http://localhost:3000/personel
```

---

## P0.2: Database Migration Hataları ⚠️ STARTUP CRASH

### Sorun Tanımı
`initDatabase()` sırasında migrations fail ediyor.

### Yaygın Symptoms
```
Error: no such table: personnel
Error: no such column: photo_path
Error: FOREIGN KEY constraint failed
```

### Bulma Aşaması

**Terminal**:
```bash
# Check env variables
echo "DB_PATH: $DB_PATH"
ls -la lojman.db 2>/dev/null || echo "DB file not found"

# Check permissions
touch /tmp/sqlite-test.db && rm /tmp/sqlite-test.db && echo "SQLite write OK"

# Test database
sqlite3 lojman.db ".tables"
```

### Fix Prosedürü

**Step 1**: DB file varsa backup et
```bash
cp lojman.db lojman.db.backup
rm lojman.db  # Fresh start
```

**Step 2**: `database.js`'deki migration kontrol et
```javascript
// database.js - initDatabase() section

// ✅ Kontrol Noktaları:
// 1. Foreign key constraints turned on?
db.pragma('foreign_keys = ON');

// 2. All CREATE TABLE statements complete?
// Eksik table veya column var mı?

// 3. Data types match usage?
// INTEGER vs TEXT, DATETIME formats

// Test Query (add to console):
const tables = db.prepare(`
  SELECT name FROM sqlite_master 
  WHERE type='table' AND name NOT LIKE 'sqlite%'
`).all();
console.log('Created tables:', tables.map(t => t.name));
```

**Step 3**: Restart ve verify
```bash
npm start
# Check console for migration errors
# Should see: "Database initialized" (if not, show error)

# Verify tables exist
sqlite3 lojman.db ".schema personnel" | head
```

---

## P1.1: Personel-Oda-Zimmet Sync Sorunu 🔄 DATA INCONSISTENCY

### Sorun Tanımı
Personel assignment sırasında:
- Key stock'u senkronize olmuyor
- Zimmet sorunu kayıtları çelişkin
- Oda capacity yanlış hesaplanıyor

### Etki
- Oda key sayısı negative gidiyor
- Zimmet sorunları duplicate kaydediliyor
- Personel başarıyla assign olmasa da sanki olmuş gibi görünüyor

### Test Senaryosu

**Terminal Setup**:
```bash
npm start
# Open browser: http://localhost:3000/login → admin/admin
```

**Test Step by Step**:
1. Navigate to `/odalar` (Rooms page)
2. Click on Oda 101 → Check "Anahtar Sayısı" (Key Count)
3. Write down: `key_qty_before = X`
4. Navigate to `/personel` → Click "Personel Ekle"
5. Create new person
6. Assign to Oda 101
7. Check `/odalar` → Oda 101 key count
8. **EXPECT**: `key_qty_after = X - 1`
9. **IF NOT**: Sync error

### Root Cause Analiz

**File**: `routes/personnel.js` + `database.js`

**Key Functions** (Check these):
```javascript
// 1. syncRoomKeyStock(roomId)
// Should: Decrement available keys when personnel assigned
// Should: Increment keys when personnel leaves

// 2. syncHandoverIssuesForRoom(roomId, items)
// Should: Avoid duplicate issue records
// Should: Handle NULL/empty items correctly

// 3. updateRoomStatus(roomId)
// Should: Update room availability based on occupants
```

### Fix Prosedürü

**Step 1**: Sync function logic kontrol et
```bash
grep -n "syncRoomKeyStock\|syncHandoverIssuesForRoom\|updateRoomStatus" \
  routes/personnel.js routes/rooms.js database.js | head -30
```

**Step 2**: Check call sites
```bash
# Personnel assigned - key should decrement
grep -A 10 "INSERT INTO personnel" routes/personnel.js | grep -i "sync\|key"

# Personnel unassigned - key should increment
grep -A 10 "UPDATE personnel SET status" routes/personnel.js | grep -i "sync\|key"
```

**Step 3**: Verify transaction consistency
```javascript
// PATTERN CHECK:

// ❌ WRONG: No transaction
db.prepare('UPDATE rooms SET key_qty = key_qty - 1').run();
db.prepare('INSERT INTO room_issues ...').run();  // Can fail, partial state

// ✅ CORRECT: Atomic transaction
db.transaction(() => {
  db.prepare('UPDATE rooms SET key_qty = key_qty - 1').run();
  db.prepare('INSERT INTO room_issues ...').run();
  // If either fails, both rollback
})();
```

**Step 4**: Test fix
```bash
npm start
# Repeat test scenario above
# Should show key_qty_after = X - 1
```

### Debug Query

If still broken, run in SQLite:
```sql
-- Check room 101 current state
SELECT r.id, r.room_number, r.*, 
       (SELECT COUNT(*) FROM personnel WHERE room_id = r.id AND status='aktif') as current_occupants
FROM rooms r WHERE r.room_number = 101;

-- Check key inventory
SELECT * FROM room_inventory 
WHERE room_id = (SELECT id FROM rooms WHERE room_number = 101) 
AND LOWER(item_name) LIKE '%anahtar%';

-- Check issues
SELECT * FROM room_issues 
WHERE room_id = (SELECT id FROM rooms WHERE room_number = 101) 
AND status != 'cozuldu'
ORDER BY created_at DESC LIMIT 5;
```

---

## P1.2: Fotoğraf Path Normalize Sorunu 📸 BROKEN IMAGES

### Sorun Tanımı
Personel fotoğrafları personel detay sayfasında görünmüyor.

### Yaygın Symptoms
```
Canvas:
- Photo upload sonra saved db'de path: `\uploads\personnel\xyz.jpg`
- Browser render'ında HTTP GET: http://localhost:3000/uploads/personnel/xyz.jpg → 404
- OR: `///uploads//personnel/xyz.jpg` (double slash)
```

### Bulma Aşaması

**Browser DevTools**:
1. Open `/personel/1` (person detail)
2. Right-click fotoğraf → Inspect
3. Check `<img src="...">` attribute
4. Copy src → Open new tab → Navigate
5. Should 404 if broken path

**Terminal Check**:
```bash
# Check physical files
ls -la public/uploads/personnel/ | head

# Check DB values
sqlite3 lojman.db "SELECT id, first_name, photo_path FROM personnel WHERE photo_path IS NOT NULL LIMIT 5;"

# Check what normalizePhotoPath returns
node -e "
const src = require('./routes/personnel.js');
const paths = [
  'C:/lojman/uploads/personnel/xyz.jpg',
  '/uploads/personnel/xyz.jpg',
  'uploads/personnel/xyz.jpg',
  '\\\\uploads\\\\personnel\\\\xyz.jpg'
];
// This requires import - manual test instead
"
```

### Fix Prosedürü

**Step 1**: Review normalize function
```bash
grep -n "normalizePhotoPath\|getPhotoFileSystemPath" routes/personnel.js | head -5
```

**Step 2**: Test each case manually
```javascript
// In Node REPL:
// app.js'deki personnel route'ında test et

// Test case 1: Windows path
path1 = 'C:\\uploads\\personnel\\photo.jpg'
// Expected normalization: /uploads/personnel/photo.jpg

// Test case 2: Unix path
path2 = '/uploads/personnel/photo.jpg'
// Expected: /uploads/personnel/photo.jpg (unchanged)

// Test case 3: Relative path
path3 = 'uploads/personnel/photo.jpg'
// Expected: /uploads/personnel/photo.jpg (add leading slash)
```

**Step 3**: Create migration script (if needed)
```bash
sqlite3 lojman.db "
UPDATE personnel 
SET photo_path = REPLACE(REPLACE(photo_path, '\\\\', '/'), 'C:', '')
WHERE photo_path IS NOT NULL;
"
```

**Step 4**: Restart ve test
```bash
npm start
# Open /personel/1, photo should appear
```

---

## P1.3: Duplicate Helper Logics 🔀 CODE DUPLICATION

### Sorun Tanımı
`personnel.js` ve `rooms.js`'de duplicate capacity/key helper functions var.

### Bulma Aşaması

**Terminal**:
```bash
# Find duplicate function definitions
grep -n "isRoomAtCapacity\|getAvailableRooms\|getRoomInventory" \
  routes/personnel.js routes/rooms.js

# Compare implementations
diff <(grep -A 10 "function isRoomAtCapacity" routes/personnel.js) \
     <(grep -A 10 "function isRoomAtCapacity" routes/rooms.js)
```

### Fix Prosedürü

**Step 1**: Identify all duplicates
```bash
grep -o "^function [a-zA-Z]*" routes/personnel.js | sort -u > /tmp/personnel-funcs
grep -o "^function [a-zA-Z]*" routes/rooms.js | sort -u > /tmp/rooms-funcs
comm -12 <(sort /tmp/personnel-funcs) <(sort /tmp/rooms-funcs)
```

**Step 2**: Merge to shared module
```bash
# Create: lib/room-helpers.js
# Copy consolidated functions there
# Update imports in personnel.js and rooms.js:
#   const { isRoomAtCapacity, getAvailableRooms } = require('../lib/room-helpers');
```

**Step 3**: Test after refactor
```bash
npm start
# Regression test: all room/personnel flows
```

---

## Debug Template

Use this for each bug:

```markdown
### [BUG_NAME]

**Terminal Commands**:
\`\`\`bash
COMMAND_1
COMMAND_2
\`\`\`

**Expected Output**: ...
**Actual Output**: ...

**Root Cause**: ...

**Fix Steps**:
1. ...
2. ...
3. ...

**Verification**:
\`\`\`bash
TEST_COMMAND
\`\`\`

**Expected Result**: ...
```

---

## Agent Notes

- Each P0 bug = app won't start or is completely broken  
- Each P1 bug = core business logic broken (data inconsistency, missing features)
- Each P2 bug = edge cases, performance, UX issues

**Priority**: Fix ALL P0 → ALL P1 → Then P2

**For Each Bug**:
1. Read this guide thoroughly
2. Run all terminal commands
3. Identify exact code location
4. Implement fix
5. Test with provided scenarios
6. Update ERROR-RESOLUTION-CHECKLIST.md ✅
