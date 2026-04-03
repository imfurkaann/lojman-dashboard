# 📚 AGENT DOCUMENTATION INDEX

**Version**: 2.0  
**Last Updated**: April 3, 2026  
**Maintained By**: Lojman Dashboard Team  
**Related**: [copilot-instructions.md](../../copilot-instructions.md) | [.github/AGENTS.md](../../.github/AGENTS.md)

**Start Here**: Choose your task and read the appropriate guide.

---

## 🚨 IF APP IS DOWN / BROKEN

→ **Read**: [QUICK-FIXES.md](QUICK-FIXES.md)
- Fastest diagnostics for common issues
- Symptom → Root Cause → Fix matrices
- Emergency terminal commands

---

## 🎯 FIXING A SPECIFIC BUG

### Step 1: Identify Priority
1. **Critical (P0)**: App won't start or is completely broken
   - Read: [CRITICAL-BUGS-DETAILED.md](#focus-areas) sections P0.1-P0.3
   
2. **High (P1)**: Core business logic broken
   - Read: [CRITICAL-BUGS-DETAILED.md](#focus-areas) sections P1.1-P1.4
   
3. **Medium (P2)**: Performance or edge cases
   - Read: [QUICK-FIXES.md](QUICK-FIXES.md) then [CRITICAL-BUGS-DETAILED.md](CRITICAL-BUGS-DETAILED.md)

### Step 2: Get Full Context

| Bug Category | Read This File | Then This | Time Est |
|--------------|----------------|-----------|----------|
| **Auth / Session** | [AGENT-FOCUS-AREAS.md#focus-area-1](AGENT-FOCUS-AREAS.md) | - | 15 min |
| **Room / Personnel Assignment** | [AGENT-FOCUS-AREAS.md#focus-area-2](AGENT-FOCUS-AREAS.md) | CRITICAL-BUGS-DETAILED.md P1.1 | 20 min |
| **Zimmet / Handover** | [AGENT-FOCUS-AREAS.md#focus-area-3](AGENT-FOCUS-AREAS.md) | CRITICAL-BUGS-DETAILED.md P1.1 | 25 min |
| **Photography** | [AGENT-FOCUS-AREAS.md#focus-area-4](AGENT-FOCUS-AREAS.md) | CRITICAL-BUGS-DETAILED.md P1.2 | 10 min |
| **Database** | [AGENT-FOCUS-AREAS.md#focus-area-5](AGENT-FOCUS-AREAS.md) | CRITICAL-BUGS-DETAILED.md P0.2 | 15 min |

### Step 3: Follow The Workflow

→ **Read**: [AGENT-DEBUG-WORKFLOW.md](AGENT-DEBUG-WORKFLOW.md)
- Systematic step-by-step process
- Includes backup/restore procedures
- Test execution with sample commands
- How to verify fixes

### Step 4: Validate With Tests

→ **Use**: [TEST-VALIDATION-MATRIX.md](TEST-VALIDATION-MATRIX.md)
- 100+ test cases organized by module
- Expected vs actual results
- How to run each test
- Pass/fail criteria

### Step 5: Update Progress

→ **Update**: [ERROR-RESOLUTION-CHECKLIST.md](ERROR-RESOLUTION-CHECKLIST.md)
- Mark bug as ✅ fixed
- Document what was changed
- Note any findings

---

## 📋 BEFORE YOU START FIXING

**Required Reading (10 min)**:
1. This INDEX file (reading now ✅)
2. [ERROR-RESOLUTION-CHECKLIST.md](ERROR-RESOLUTION-CHECKLIST.md) - See all known bugs
3. [QUICK-FIXES.md](QUICK-FIXES.md) - Check if it's common problem

**Decision Tree**:
```
Is app running?
├─ NO → QUICK-FIXES.md "App Won't Start"
└─ YES → Can you log in?
         ├─ NO → QUICK-FIXES.md "Authentication"
         └─ YES → Does feature work?
                 ├─ NO → CRITICAL-BUGS-DETAILED.md + AGENT-DEBUG-WORKFLOW.md
                 └─ YES → TEST-VALIDATION-MATRIX.md + report findings
```

---

## 📁 Files in This Directory

| File | Purpose | When to Read |
|------|---------|--------------|
| **INDEX.md** | This file - navigation guide | Always first |
| **ERROR-RESOLUTION-CHECKLIST.md** | Master checklist of all known bugs, priority order | Before fixing anything |
| **CRITICAL-BUGS-DETAILED.md** | Deep dive into P0/P1 bugs with code examples | For major bugs |
| **TEST-VALIDATION-MATRIX.md** | 100+ test cases for all modules | To validate fixes |
| **AGENT-DEBUG-WORKFLOW.md** | Step-by-step fix workflow with templates | During bug fixing |
| **QUICK-FIXES.md** | Fast diagnostics for common issues | For quick problems |
| **AGENT-FOCUS-AREAS.md** | Function-specific technical details | Deep technical reference |
| **architecture.md** | High-level system design | Understanding structure |
| **database.md** | Database schema reference | Schema questions |
| **routes.md** | API endpoint reference | Route/flow questions |
| **debug-workflows.md** | Debugging patterns | Debugging techniques |

---

## 🔴 EMERGENCY PROCEDURES

### App Completely Broken
```bash
# 1. Quick diagnostic
./docs/agent/quick-fixes.sh  # See file for commands

# 2. If all else fails - reset
rm lojman.db && npm install && npm start
```

**Before that, try**:
- Read [QUICK-FIXES.md](QUICK-FIXES.md) "App Won't Start" section
- Run `npm start 2>&1 | head -50` to see error

### Multiple Bugs = Systematic Approach
1. Open [ERROR-RESOLUTION-CHECKLIST.md](ERROR-RESOLUTION-CHECKLIST.md)
2. Fix PHASE 1 first (P0 - Critical)
3. Restart app after each phase
4. Then PHASE 2 (P1 - High)
5. Then PHASE 3 (P2 - Medium)

---

## 🎓 AGENT LEARNING PATH

### First Time (Agent Setup)
1. Read: This file (INDEX.md)
2. Read: [ERROR-RESOLUTION-CHECKLIST.md](ERROR-RESOLUTION-CHECKLIST.md) - Full overview
3. Skim: [CRITICAL-BUGS-DETAILED.md](CRITICAL-BUGS-DETAILED.md) - Get familiar with bugs
4. Bookmark: [QUICK-FIXES.md](QUICK-FIXES.md) - For daily reference

### Fixing Your First Bug
1. Open [ERROR-RESOLUTION-CHECKLIST.md](ERROR-RESOLUTION-CHECKLIST.md)
2. Find the bug you'll fix (start with P0?)
3. Read [CRITICAL-BUGS-DETAILED.md](CRITICAL-BUGS-DETAILED.md) for that bug
4. Follow [AGENT-DEBUG-WORKFLOW.md](AGENT-DEBUG-WORKFLOW.md) - PHASE BY PHASE
5. Use [TEST-VALIDATION-MATRIX.md](TEST-VALIDATION-MATRIX.md) to validate
6. Mark ✅ in [ERROR-RESOLUTION-CHECKLIST.md](ERROR-RESOLUTION-CHECKLIST.md)

### Subsequent Bugs
1. [QUICK-FIXES.md](QUICK-FIXES.md) - likely already covered
2. If not in QUICK-FIXES → go to CRITICAL-BUGS-DETAILED
3. Follow workflow
4. Update checklist

---

## 💡 PRO TIPS FOR AGENTS

### 1. Terminal Setup
```bash
# Create 2 terminals:
# Terminal 1: npm start (keep running)
# Terminal 2: commands & testing

# Keep handy:
alias dbcheck="sqlite3 lojman.db 'SELECT COUNT(*) FROM personnel;'"
alias dbbackup="sqlite3 lojman.db '.backup backup-$(date +%s).db'"
```

### 2. Reading Efficiently
- **Skim first**: Read headings + code blocks
- **Deep read**: Only details for your specific bug
- **Reference**: Don't memorize, just know where it is

### 3. Testing Systematically
```bash
# For each bug:
# 1. Backup: cp lojman.db lojman.db.bak
# 2. Fix: Edit code
# 3. Test: Run ALL related tests from matrix
# 4. Verify: Check database state
# 5. Restore if failed: cp lojman.db.bak lojman.db
```

### 4. Avoid Common Mistakes
```
❌ DON'T: Skip reading the docs - you'll miss critical details
❌ DON'T: Test one scenario - test PHASE 1-5 from workflow
❌ DON'T: Forget to backup before changes
❌ DON'T: Mix multiple bug fixes - do one at a time
❌ DON'T: Forget to update checklist after fixing

✅ DO: Take systematic approach
✅ DO: Make backups religiously
✅ DO: Test thoroughly
✅ DO: Document findings
✅ DO: Help next agent by updating docs
```

---

## 🔄 PHASE-BASED BUG FIXING

Your job follows this cycle:

```
┌─────────────────────────────────────────┐
│  1. SELECT BUG                          │
│     From ERROR-RESOLUTION-CHECKLIST     │
└────────────┬────────────────────────────┘
             │
             ↓
┌─────────────────────────────────────────┐
│  2. UNDERSTAND BUG                      │
│     Read CRITICAL-BUGS-DETAILED         │
│     Read AGENT-FOCUS-AREAS              │
└────────────┬────────────────────────────┘
             │
             ↓
┌─────────────────────────────────────────┐
│  3. ANALYZE (PHASE 1-2 of WORKFLOW)     │
│     Terminal commands                   │
│     Code inspection                     │
│     Root cause                          │
└────────────┬────────────────────────────┘
             │
             ↓
┌─────────────────────────────────────────┐
│  4. FIX (PHASE 3 of WORKFLOW)           │
│     Backup                              │
│     Implement                           │
│     Verify syntax                       │
└────────────┬────────────────────────────┘
             │
             ↓
┌─────────────────────────────────────────┐
│  5. TEST (PHASE 4 of WORKFLOW)          │
│     Unit tests                          │
│     Regression tests                    │
│     All TEST-VALIDATION-MATRIX cases    │
└────────────┬────────────────────────────┘
             │
             ↓
┌─────────────────────────────────────────┐
│  6. VERIFY (PHASE 5 of WORKFLOW)        │
│     Database state                      │
│     Browser verification                │
│     Update checklist ✅                 │
└────────────┬────────────────────────────┘
             │
             ↓
┌─────────────────────────────────────────┐
│  READY FOR NEXT BUG                     │
│  Go back to Step 1                      │
└─────────────────────────────────────────┘
```

---

## 📞 HELP REFERENCES

### "I don't know where to start"
→ Read [ERROR-RESOLUTION-CHECKLIST.md](ERROR-RESOLUTION-CHECKLIST.md) PHASE 1 first bug

### "App won't start"
→ Read [QUICK-FIXES.md](QUICK-FIXES.md) "App Won't Start / Crashes" section

### "I fixed it but tests fail"
→ Go back to [AGENT-DEBUG-WORKFLOW.md](AGENT-DEBUG-WORKFLOW.md) PHASE 2 (Root Cause Analysis)

### "I don't understand the code"
→ Read [AGENT-FOCUS-AREAS.md](AGENT-FOCUS-AREAS.md) for your bug category

### "How do I know it's fixed?"
→ Use [TEST-VALIDATION-MATRIX.md](TEST-VALIDATION-MATRIX.md) for your module

### "Where is function X defined?"
→ Use `grep -r "function X" routes/ database.js app.js`
→ Or check [AGENT-FOCUS-AREAS.md](AGENT-FOCUS-AREAS.md) "Quick Reference" table

---

## ⏱️ TIME ESTIMATES

| Task | Estimated Time |
|------|----------------|
| Read this INDEX | 5 min |
| Read ERROR-RESOLUTION-CHECKLIST | 10 min |
| Fix one P0 bug | 30-45 min |
| Fix one P1 bug | 45-90 min |
| Fix one P2 bug | 30-60 min |
| Full TEST-VALIDATION cycle | 60 min |
| **Full phase (all P0/P1 bugs)** | **4-6 hours** |

---

## 🎉 SUCCESS CRITERIA

A bug is truly fixed when:
- [ ] Root cause understood and documented
- [ ] Code changed and backed up
- [ ] Syntax verified (no parse errors)
- [ ] Unit test passed
- [ ] Regression tests passed  
- [ ] Database state verified correct
- [ ] Browser behavior matches expected
- [ ] ERROR-RESOLUTION-CHECKLIST updated ✅
- [ ] Test report created
- [ ] Ready for production

---

**Next Step**: Based on your task:
- 🚀 **App is down**: → [QUICK-FIXES.md](QUICK-FIXES.md)
- 🎯 **Fixing specific bug**: → [ERROR-RESOLUTION-CHECKLIST.md](ERROR-RESOLUTION-CHECKLIST.md)
- 🔍 **Deep technical issue**: → [CRITICAL-BUGS-DETAILED.md](CRITICAL-BUGS-DETAILED.md)
- ✅ **Validating fixes**: → [TEST-VALIDATION-MATRIX.md](TEST-VALIDATION-MATRIX.md)

**Good luck! 🚀**
