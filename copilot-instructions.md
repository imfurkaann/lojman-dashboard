# Lojman Dashboard - Copilot Instructions

**Project**: Lojman Yönetim Paneli (Dormitory Management Dashboard)  
**Stack**: Node.js + Express + SQLite + EJS + Socket.IO  
**Status**: Active Development & Bug Fixes

---

## 🎯 Quick Navigation

- **First Time?** → Read [docs/agent/INDEX.md](docs/agent/INDEX.md)
- **Have a Bug?** → See [docs/agent/QUICK-FIXES.md](docs/agent/QUICK-FIXES.md)
- **Architecture Help?** → Check [docs/agent/architecture.md](docs/agent/architecture.md)
- **Troubleshooting?** → Use [docs/agent/troubleshooting.md](docs/agent/troubleshooting.md)

---

## 🤖 Available Agents

Use `.github/AGENTS.md` to see all agents and when to invoke them. Current agents:

1. **Lojman Debug Docs Agent** - For bug fixing & root cause analysis
2. **Docker Personnel Image Debugger** - For photo display issues in Docker

---

## 📋 Project Structure

```
├── app.js                           # Express app entry point
├── database.js                      # SQLite setup & helpers
├── package.json                     # Dependencies
├── .github/
│   ├── agents/
│   │   ├── lojman-debug-docs.agent.md
│   │   └── docker-personnel-image-debug.agent.md
│   └── copilot-instructions.md      # This file
├── views/                           # EJS templates
├── routes/                          # Express route handlers
│   ├── auth.js
│   ├── dashboard.js
│   ├── personnel.js
│   ├── rooms.js
│   ├── entries.js
│   ├── equipment.js
│   ├── reports.js
│   └── ...
├── middleware/
│   ├── auth.js
│   └── tc-encryption.js
├── public/
│   ├── css/
│   ├── js/
│   └── uploads/personnel/           # Photo storage
├── docs/agent/                      # Comprehensive agent docs
│   ├── INDEX.md                     # Start here
│   ├── QUICK-FIXES.md
│   ├── ERROR-RESOLUTION-CHECKLIST.md
│   ├── CRITICAL-BUGS-DETAILED.md
│   ├── AGENT-DEBUG-WORKFLOW.md
│   ├── TEST-VALIDATION-MATRIX.md
│   ├── architecture.md
│   ├── database.md
│   ├── routes.md
│   └── troubleshooting.md
└── data/                            # Static reference files
```

---

## 🔧 Project-Specific Rules

### Authentication & Session
- ✅ Always use `getSafeUserId(req)` before database writes to user ID
- ✅ Protect routes with `authMiddleware` - check app.js for pattern
- ✅ Session stored per request in `req.session.user`
- ❌ Never hardcode `req.session.user` - auth happens only on login

### Database & Transactions
- ✅ Use `db.transaction()` for multi-step operations (personnel assign, checkout, handover)
- ✅ Always include FOREIGN KEY constraints with CASCADE where appropriate
- ✅ Normalize photo paths to `/uploads/personnel/filename.jpg` format
- ❌ Don't assume DB state - verify with explicit queries first

### Room & Personnel Sync
- ✅ Call `syncRoomKeyStock(roomId)` after any personnel assignment change
- ✅ Call `syncHandoverIssuesForRoom(roomId)` after inventory changes
- ✅ Emit socket events after state changes: `io.emit('personnel:room-update', ...)`
- ❌ Don't rely on manual key counting - trust the sync functions

### File Uploads
- ✅ Store personnel photos in `public/uploads/personnel/`
- ✅ Validate file types & sizes before saving
- ✅ Use multer with `diskStorage` for reliability
- ❌ Don't store absolute file paths (Windows paths like `C:\...`) - normalize to relative

### Socket.IO
- ✅ Emit `app:data-changed` after successful mutations (done auto in app.js)
- ✅ Emit specific events like `personnel:room-update` from route handlers
- ✅ Use `req.app.locals.io` to access socket instance
- ❌ Don't assume socket connection in client - add connection listeners

---

## 🐳 Docker Notes

### Common Issues
- If container is running on port 3000, local `npm start` will fail with `EADDRINUSE`
  - Stop: `docker compose down`
  - Or use: `PORT=3001 npm start`
- Photo uploads may not sync if volume mounts are misconfigured
  - Check `docker-compose.yml` for `public/uploads/personnel` binding
- Socket.IO WebSocket may fail if CORS or network is misconfigured
  - Check browser DevTools Network tab for WS connection status

---

## 🧪 Testing & Validation

Before marking bugs ✅:
1. Run the specific test case from [TEST-VALIDATION-MATRIX.md](docs/agent/TEST-VALIDATION-MATRIX.md)
2. Verify with terminal commands where applicable
3. Update [ERROR-RESOLUTION-CHECKLIST.md](docs/agent/ERROR-RESOLUTION-CHECKLIST.md) with status

---

## 📖 Key Documentation Files

| File | Purpose |
|------|---------|
| [INDEX.md](docs/agent/INDEX.md) | Navigation guide for all agents |
| [QUICK-FIXES.md](docs/agent/QUICK-FIXES.md) | Symptom → Root Cause → Fix lookup table |
| [CRITICAL-BUGS-DETAILED.md](docs/agent/CRITICAL-BUGS-DETAILED.md) | Deep technical analysis of P0/P1 bugs |
| [AGENT-DEBUG-WORKFLOW.md](docs/agent/AGENT-DEBUG-WORKFLOW.md) | Step-by-step bug fix process |
| [TEST-VALIDATION-MATRIX.md](docs/agent/TEST-VALIDATION-MATRIX.md) | 100+ test cases by module |
| [architecture.md](docs/agent/architecture.md) | System design & data flow |
| [database.md](docs/agent/database.md) | SQLite schema & relationships |
| [routes.md](docs/agent/routes.md) | Endpoint catalog & patterns |
| [troubleshooting.md](docs/agent/troubleshooting.md) | Local & Docker debugging |

---

## 🚀 Essential Commands

```bash
# Install & run
npm install
npm start

# Docker
docker compose up -d
docker compose down

# Database
sqlite3 lojman.db "SELECT * FROM personnel LIMIT 1;"
sqlite3 lojman.db ".schema"

# Check for issues
npm test
node -c app.js            # Syntax check
grep -r "syncRoomKeyStock" routes/

# Clean reset
rm lojman.db sessions.db
npm start
```

---

## 📞 Support

For systematic issue diagnosis, agents should:
1. Read [docs/agent/INDEX.md](docs/agent/INDEX.md) first
2. Follow [AGENT-DEBUG-WORKFLOW.md](docs/agent/AGENT-DEBUG-WORKFLOW.md) for fix process
3. Use [TEST-VALIDATION-MATRIX.md](docs/agent/TEST-VALIDATION-MATRIX.md) to validate fixes
4. Update [ERROR-RESOLUTION-CHECKLIST.md](docs/agent/ERROR-RESOLUTION-CHECKLIST.md) when complete

---

**Last Updated**: April 3, 2026  
**Maintained By**: Lojman Dashboard Development Team  
**Questions?** Check docs/agent/ documentation or existing agent guides.
