# ⚡ QUICK FIXES & COMMON ISSUES

Quick reference for most common problems. Use this before deep debugging.

---

## SYMPTOM → ROOT CAUSE → FIX MATRIX

### App Won't Start / Crashes on Startup

| Symptom | Root Cause | Fix Command | Verify |
|---------|-----------|-------------|--------|
| `Error: EADDRINUSE: address already in use :::3000` | Port 3000 already in use | `lsof -i :3000 \| grep node \| awk '{print $2}' \| xargs kill -9` | `npm start` |
| `Error: no such table: personnel` | DB migrations didn't run | `rm lojman.db \| npm start` | App starts clean |
| `Error: ENOENT: no such file...lojman.db` | DB file not found | `touch lojman.db \| npm start` | App initializes |
| `Cannot find module 'express'` | Dependencies not installed | `npm install && npm start` | No module errors |
| `SyntaxError: Unexpected token...` | Corrupt JS file | `node -c app.js` check file | Parse succeeds |

### Photos Don't Display

| Symptom | Root Cause | Fix Command | Verify |
|---------|-----------|-------------|--------|
| Browser console 404 on `/uploads/personnel/xyz.jpg` | Uploads folder missing | `mkdir -p public/uploads/personnel` | Folder exists |
| DB photo_path is `C:\uploads\personnel\...` (Windows path) | Photo path not normalized | `sqlite3 lojman.db "UPDATE personnel SET photo_path = NULL WHERE SUBSTR(photo_path,1,1)='C';"` | Paths normalized |
|`<img src="/uploads/…" >` exists but still 404 | Routes not serving static | Check `app.use(express.static(...))` in app.js | Static folder served |
| Upload button doesn't work | Multer not configured or temp dir missing | `mkdir -p /tmp && npm start` | Uploads work |

### Authentication Not Working

| Symptom | Root Cause | Fix Command | Verify |
|---------|-----------|-------------|--------|
| Always shows "Invalid credentials" | Wrong DB schema or no users table | `sqlite3 lojman.db "SELECT * FROM users LIMIT 1;"` | Shows users |
| Login works but redirects to login again | Session not persisting (Redis/file store issue) | `grep -n "session.*store" app.js` → Check config | Check connect-sqlite3 is configured |
| Role-based routes don't work | Auth middleware not applied to routes | `grep -n "checkAuth\|requireAuth" routes/*.js` | All routes protected |
| `req.session.user` is undefined on protected route | Auth middleware missing or not mounting | Check app.js for `app.use(authMiddleware)` | Middleware in place |

### Oda (Room) / Personel Assignment Issues

| Symptom | Root Cause | Fix Command | Verify |
|---------|-----------|-------------|--------|
| Assign person to room → keys don't update | `syncRoomKeyStock()` not called | `grep -n "syncRoomKeyStock" routes/personnel.js` | Function called |
| Key count goes negative | No transaction or double credit | `sqlite3 lojman.db "SELECT room_id, item_name, quantity FROM room_inventory WHERE quantity < 0;"` | No negative quantities |
| Room "temizlenmeli" allows assignment | Override flag not working | Check POST /personel/{id}/oda-degistir for `allow_cleaning_override` | Validation triggers |
| Personel gelişiş/çıkışı oda sorunları çakışıyor | Entry handover + issue sync conflict | `grep -n "syncHandoverIssuesForRoom" routes/personnel.js` → check transaction | Atomicity validated |

### Database & Data Issues

| Symptom | Root Cause | Fix Command | Verify |
|---------|-----------|-------------|--------|
| Duplicate personnel entries | No unique constraint or auto-insert | `sqlite3 lojman.db "SELECT COUNT(*), first_name, last_name FROM personnel GROUP BY first_name, last_name HAVING COUNT(*)>1;"` | No duplicates |
| Foreign key violations on delete | Cascade delete not set or orphan records | `sqlite3 lojman.db "SELECT * FROM personnel WHERE room_id NOT IN (SELECT id FROM rooms);"` | No orphans |
| Data becomes inconsistent after crash | Transactions not atomic | Check `db.transaction()` wrapping WRITE statements | Atomicity applied |
| Reports show wrong data | Stale view or incorrect WHERE clause | `sqlite3 lojman.db ".schema activity_log"` → check schema | Verify query |

### Zimmet (Handover) Modal Pop-up Issues

| Symptom | Root Cause | Fix Command | Verify |
|---------|-----------|-------------|--------|
| Modal closes after "confirm broken item" dialog | Error in background fetch (resolve issue API) | Browser DevTools Network tab → check `/odalar/{id}/demirbas-sorun-coz` response | API responds 200 OK |
| Broken items don't show in reassign modal | Room inventory not fetched or roomOpenIssueMap wrong | `sqlite3 lojman.db "SELECT * FROM room_inventory WHERE room_id={id};"` | Items exist in DB |
| Can't submit reassign form after marking items | Form validation error | Browser DevTools Console → check for JS errors | No console errors |
| Modal says "zimmet formu imzası zorunludur" | Checkbox not being sent in form | Check form data in Network tab POST request | form_signed included |

### Reports & Export Issues

| Symptom | Root Cause | Fix Command | Verify |
|---------|-----------|-------------|--------|
| Excel export button spins forever | Large dataset or streaming error | Check `/raporlar/personel/export` response headers | Response completes |
| Excel file corrupts or opens in notepad | Wrong MIME type or ExcelJS error | `curl -I http://localhost:3000/raporlar/personel/export` | Content-Type: application/vnd.openxmlformats... |
| Reports page empty | No data in database or query filter wrong | `sqlite3 lojman.db "SELECT COUNT(*) FROM personnel;"` | Count > 0 |
| Filters not working in reports | Client-side JS not sending filter params | Browser Network tab → check Query string | Params in URL |

### Socket.IO Real-Time Issues

| Symptom | Root Cause | Fix Command | Verify |
|---------|-----------|-------------|--------|
| Socket.IO doesn't connect (WebSocket fails) | CORS misconfigured or port blocked | Browser DevTools → Network/WS tab `socket.io` | Connection 101 Switching |
| Personnel list doesn't auto-refresh in other tabs | Emit event not reaching client | Check `req.app.locals.io.emit()` calls in routes | Event fired |
| Reports page always stale after new data | Socket event name mismatch | `grep -r "io.emit" app.js routes/ \| grep -i report` | Event names consistent |
| Container-to-Host WebSocket blocked (Docker) | Network or firewall issue | `docker inspect lojman-dashboard \| grep Network` | Check bridge network |

### Performance / Slowness

| Symptom | Root Cause | Fix Command | Verify |
|---------|-----------|-------------|--------|
| `/personel` page loads slowly with 100+ entries | No pagination or inefficient query | `sqlite3 lojman.db "EXPLAIN QUERY PLAN SELECT * FROM personnel LIMIT 100;"` | Query indexed properly |
| Report generation times out | Missing indexes or N+1 query | Check database indexes with `sqlite3 lojman.db ".indexes"` | Indexes on foreign keys |
| Upload slow (5+ seconds) | Large file or no async | Check multer config diskStorage vs memory | Use disk storage |
| Container memory spike | Memory leak in Node or large data load | `docker stats lojman-dashboard` | Monitor memory usage |

---

## EXPRESS TERMINAL DIAGNOSTICS

```bash
#!/bin/bash
# Run this script to quickly diagnose system state

echo "=== CHECKING PROJECT HEALTH ==="

echo "1. Port availability:"
lsof -i :3000 2>/dev/null && echo "⚠️  Port 3000 in use" || echo "✅ Port 3000 free"

echo ""
echo "2. Dependencies installed:"
npm list 2>/dev/null | head -5 && echo "✅ Looks OK" || echo "❌ Install issues"

echo ""
echo "3. Database state:"
if [ -f lojman.db ]; then
   TABLES=$(sqlite3 lojman.db "SELECT COUNT(name) FROM sqlite_master WHERE type='table';" 2>/dev/null)
   echo "✅ DB exists with $TABLES tables"
else
   echo "❌ DB file missing"
fi

echo ""
echo "4. Photo directory:"
[ -d public/uploads/personnel ] && echo "✅ Upload dir exists" || echo "❌ Missing, can create"

echo ""
echo "5. Authorization setup:"
grep -q "router.use(.*middleware" app.js && echo "✅ Middleware imported" || echo "❌ Middleware config missing"

echo ""
echo "6. Socket.IO enabled:"
grep -q "socketIo\|socket.io" app.js && echo "✅ Socket.IO configured" || echo "⚠️  Check config"

echo ""
echo "7. First 5 users in DB:"
sqlite3 lojman.db "SELECT id, username, full_name FROM users LIMIT 5;" 2>/dev/null || echo "❌ Query failed"

```

Usage:
```bash
chmod +x diagnostics.sh
./diagnostics.sh
```

---

## QUICK RESET (Nuclear Option)

Use only if everything is broken:

```bash
#!/bin/bash
echo "FULL RESET - WARNING: ALL DATA WILL BE LOST"
read -p "Continue? (y/n) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
  rm -f lojman.db lojman.db-shm lojman.db-wal
  rm -rf public/uploads/personnel/*
  npm install
  npm start
  echo "✅ Reset complete. App starting fresh..."
else
  echo "❌ Cancelled"
fi
```

---

## LOGS & DEBUGGING

### Enable Debug Mode

```bash
# In app.js, add at top:
const debug = require('debug')('lojman:*');

// Then run with:
DEBUG=lojman:* npm start
```

### Check Logs for Errors

```bash
# Capture startup logs
npm start 2>&1 | tee startup.log

# Search for errors
grep -i "error\|warn\|fail" startup.log

# Real-time follow
npm start | grep -i "error\|warn" --line-buffered
```

### Database Query Debugging

```bash
sqlite3 lojman.db

# Enable timing
.timer on

# Profile slow query
EXPLAIN QUERY PLAN SELECT * FROM personnel WHERE room_id = 1;

# Check indexes
.indexes personnel
```

---

## WHEN IN DOUBT: CHECKLIST

```
□ 1. Is Node running? (ps aux | grep node)
□ 2. Is port 3000 free? (lsof -i :3000)
□ 3. Is DB file present? (ls -la lojman.db)
□ 4. npm install run recently? (ls node_modules/express)
□ 5. Can I query DB? (sqlite3 lojman.db "SELECT 1;")
□ 6. Static files served? (curl http://localhost:3000/css/style.css)
□ 7. Authentication works? (curl -c /tmp/.cookies -d "username=admin&password=admin" http://localhost:3000/login)
□ 8. WebSocket connected? (Browser DevTools → Network → WS tab)

If all check ✅ → App should work
If any fail → Run corresponding fix from matrix above
```

---

## Emergency Support Commands

```bash
# Restart everything
docker compose down && docker compose up -d --build

# View logs
docker logs -f lojman-dashboard

# Shell into container
docker exec -it lojman-dashboard /bin/sh

# Database backup
sqlite3 lojman.db ".backup backup-$(date +%s).db"

# Check container health
docker compose ps
docker inspect lojman-dashboard | grep -A 5 Health
```

---

**Remember**: If quick fix doesn't work → Read CRITICAL-BUGS-DETAILED.md → Use AGENT-DEBUG-WORKFLOW.md
