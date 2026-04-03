# 🤖 Lojman Dashboard - Available Agents

**Guide to all specialized agents for this workspace.**  
See [copilot-instructions.md](../copilot-instructions.md) for general project info.

---

## Agent Index

### 1️⃣ Lojman Debug Docs Agent

**Purpose**: Systematic bug diagnosis and root cause analysis  
**When to Use**: 
- App crashes or has logic errors
- Need to trace request → route → database flow
- Debugging auth, session, or data sync issues
- Creating/updating technical documentation

**Tools Available**: read, search, edit, execute, todo  
**Models**: GPT-5 (Copilot), Claude Sonnet 4.5 (Copilot)

**Quick Start**:
```
@Lojman Debug Docs Agent
Which error are you solving? 
Environment: local or docker? 
Expected vs actual behavior (describe).
```

**Example Usage**:
- "Fix P0.1 hardcoded session bug"
- "Diagnose why room key sync fails"
- "Update docs/agent/CRITICAL-BUGS-DETAILED.md with new tests"

**Workflow**:
1. Read [docs/agent/QUICK-FIXES.md](../docs/agent/QUICK-FIXES.md) for quick match
2. Follow [docs/agent/AGENT-DEBUG-WORKFLOW.md](../docs/agent/AGENT-DEBUG-WORKFLOW.md)
3. Test with [docs/agent/TEST-VALIDATION-MATRIX.md](../docs/agent/TEST-VALIDATION-MATRIX.md)
4. Mark ✅ in [docs/agent/ERROR-RESOLUTION-CHECKLIST.md](../docs/agent/ERROR-RESOLUTION-CHECKLIST.md)

---

### 2️⃣ Docker Personnel Image Debugger

**Purpose**: Fix personnel photo display issues in Docker environments  
**When to Use**:
- Photo src broken in personnel detail page
- 404 errors for /uploads/personnel/* in browser
- Static file serving misconfigured in Docker
- Volume mounts or path mismatches

**Tools Available**: read, search, execute, edit  
**Input Format**: 
```
Problem: [describe issue, example URL, container name]
Expected: How should photos display?
```

**Quick Start**:
```
@Docker Personnel Image Debugger
Photos show broken <img> tag in detail page.
URL: http://localhost:3000/personel/1/detay
Container: lojman-dashboard
Expected: Show stored photo
```

**Diagnostic Flow**:
1. Identify failing page and exact <img src> in HTML
2. Check upload destination path
3. Verify static middleware routes
4. Check Docker volume binds
5. Test with curl and browser

**Not For**:
- General business logic bugs
- Non-photo-related issues
- Database schema problems

---

## 🎯 Decision Tree: Which Agent?

```
Is the issue related to photos/images in Docker?
├─ YES → Use Docker Personnel Image Debugger
└─ NO → Is it a logic/data/auth bug?
        ├─ YES → Use Lojman Debug Docs Agent
        └─ NO → Use default agent or check copilot-instructions.md
```

---

## 📚 Documentation Requirements

Before invoking any agent, ensure:
- [ ] [docs/agent/INDEX.md](../docs/agent/INDEX.md) is readable
- [ ] [docs/agent/ERROR-RESOLUTION-CHECKLIST.md](../docs/agent/ERROR-RESOLUTION-CHECKLIST.md) is current
- [ ] [docs/agent/CRITICAL-BUGS-DETAILED.md](../docs/agent/CRITICAL-BUGS-DETAILED.md) covers your bug

If a bug isn't documented, ask the main agent to:
1. Create a section in CRITICAL-BUGS-DETAILED.md
2. Add test cases to TEST-VALIDATION-MATRIX.md
3. Update ERROR-RESOLUTION-CHECKLIST.md

---

## 🔧 Agent Configuration

All agents are configured in `.github/agents/*.agent.md` with:
- Tool restrictions (read, search, edit, execute, etc.)
- Model preferences (GPT-5, Claude)
- User-invocable status
- Argument hints

To modify an agent, edit its `.agent.md` file directly.

---

## 💡 Pro Tips

- **For Quick Fixes**: Use QUICK-FIXES.md first, then invoke agent only if not listed
- **For Complex Issues**: Follow AGENT-DEBUG-WORKFLOW.md step-by-step
- **For Multiple Bugs**: Prioritize ERROR-RESOLUTION-CHECKLIST.md PHASE 1 first
- **For Validation**: Always test with TEST-VALIDATION-MATRIX.md cases
- **For Docker**: Always verify docker-compose.yml volume binds before assuming code bugs

---

## 📞 Creating New Agents

If you need a new specialized agent:
1. Create `.github/agents/new-agent.agent.md`
2. Follow template in existing agents
3. Include YAML frontmatter: name, description, tools, model, argument-hint
4. Add to this AGENTS.md index
5. Brief users on when to invoke it

---

**Last Updated**: April 3, 2026  
**See Also**: [copilot-instructions.md](../copilot-instructions.md) | [docs/agent/INDEX.md](../docs/agent/INDEX.md)
