<p align="center">
  <img src="assets/logo.png" alt="Memorix Logo" width="120">
  <h1 align="center">Memorix</h1>
  <p align="center"><strong>Cross-Agent Memory Bridge — Your AI never forgets again</strong></p>
  <p align="center"><a href="README.zh-CN.md">中文文档</a> | English</p>
  <p align="center">
    <a href="https://www.npmjs.com/package/memorix"><img src="https://img.shields.io/npm/v/memorix.svg?style=flat-square&color=cb3837" alt="npm version"></a>
    <a href="https://www.npmjs.com/package/memorix"><img src="https://img.shields.io/npm/dm/memorix.svg?style=flat-square&color=blue" alt="npm downloads"></a>
    <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache%202.0-green.svg?style=flat-square" alt="License"></a>
    <a href="https://github.com/AVIDS2/memorix"><img src="https://img.shields.io/github/stars/AVIDS2/memorix?style=flat-square&color=yellow" alt="GitHub stars"></a>
    <img src="https://img.shields.io/badge/tests-503%20passed-brightgreen?style=flat-square" alt="Tests">
  </p>
  <p align="center">
    <img src="https://img.shields.io/badge/Works%20with-Cursor-orange?style=flat-square" alt="Cursor">
    <img src="https://img.shields.io/badge/Works%20with-Windsurf-blue?style=flat-square" alt="Windsurf">
    <img src="https://img.shields.io/badge/Works%20with-Claude%20Code-purple?style=flat-square" alt="Claude Code">
    <img src="https://img.shields.io/badge/Works%20with-Codex-green?style=flat-square" alt="Codex">
    <img src="https://img.shields.io/badge/Works%20with-Copilot-lightblue?style=flat-square" alt="Copilot">
    <img src="https://img.shields.io/badge/Works%20with-Kiro-red?style=flat-square" alt="Kiro">
    <img src="https://img.shields.io/badge/Works%20with-Antigravity-grey?style=flat-square" alt="Antigravity">
    <img src="https://img.shields.io/badge/Works%20with-Gemini%20CLI-4285F4?style=flat-square" alt="Gemini CLI">
  </p>
  <p align="center">
    <a href="#-stop-re-explaining-your-project">Why</a> •
    <a href="#-get-started-in-30-seconds">Quick Start</a> •
    <a href="#-real-world-scenarios">Scenarios</a> •
    <a href="#-what-memorix-can-do">Features</a> •
    <a href="#-comparison-with-alternatives">Compare</a> •
    <a href="docs/SETUP.md">Full Setup Guide</a>
  </p>
</p>

---

## 😤 Stop Re-Explaining Your Project

Your AI assistant forgets everything when you start a new chat. You spend 10 minutes re-explaining your architecture. **Again.** And if you switch from Cursor to Claude Code? Everything is gone. **Again.**

| Without Memorix | With Memorix |
|-----------------|--------------|
| **Session 2:** "What's our tech stack?" | **Session 2:** "I remember — Next.js with Prisma and tRPC. What should we build next?" |
| **Switch IDE:** All context lost | **Switch IDE:** Context follows you instantly |
| **New team member's AI:** Starts from zero | **New team member's AI:** Already knows the codebase |
| **After 50 tool calls:** Context explodes, restart needed | **After restart:** Picks up right where you left off |
| **MCP configs:** Copy-paste between 7 IDEs manually | **MCP configs:** One command syncs everything |

**Memorix solves all of this.** One MCP server. Eight agents. Zero context loss.

---

## ⚡ Get Started in 30 Seconds

### Step 1: Install globally (one-time)

```bash
npm install -g memorix
```

> ⚠️ **Do NOT use `npx`** — npx downloads the package every time, which causes MCP server initialization timeout (60s limit). Global install starts instantly.

### Step 2: Add to your agent's MCP config

<details open>
<summary><strong>Claude Code</strong></summary>

Run in terminal:
```bash
claude mcp add memorix -- memorix serve
```
Or manually add to `~/.claude.json`:
```json
{
  "mcpServers": {
    "memorix": {
      "command": "memorix",
      "args": ["serve"]
    }
  }
}
```
</details>

<details>
<summary><strong>Cursor</strong></summary>

Add to `.cursor/mcp.json` in your project:
```json
{
  "mcpServers": {
    "memorix": {
      "command": "memorix",
      "args": ["serve"]
    }
  }
}
```
</details>

<details>
<summary><strong>Windsurf</strong></summary>

Add to Windsurf MCP settings (`~/.codeium/windsurf/mcp_config.json`):
```json
{
  "mcpServers": {
    "memorix": {
      "command": "memorix",
      "args": ["serve"]
    }
  }
}
```
</details>

<details>
<summary><strong>VS Code Copilot / Codex / Kiro</strong></summary>

Same format — add to the agent's MCP config file:
```json
{
  "mcpServers": {
    "memorix": {
      "command": "memorix",
      "args": ["serve"]
    }
  }
}
```
</details>

<details>
<summary><strong>Antigravity / Gemini CLI</strong></summary>

Add to `.gemini/settings.json` (project) or `~/.gemini/settings.json` (global):
```json
{
  "mcpServers": {
    "memorix": {
      "command": "memorix",
      "args": ["serve"]
    }
  }
}
```

**Antigravity IDE only:** Antigravity uses its own install path as CWD. You **must** add:
```json
{
  "mcpServers": {
    "memorix": {
      "command": "memorix",
      "args": ["serve"],
      "env": {
        "MEMORIX_PROJECT_ROOT": "E:/your/project/path"
      }
    }
  }
}
```

**Gemini CLI** reads MCP config from the same path. Hooks are automatically installed to `.gemini/settings.json`.
</details>

### Step 3: Restart your agent — done!

No API keys. No cloud accounts. No dependencies. Works with any directory (git repo or not).

> 📖 **Full setup guide for all 8 agents** → [docs/SETUP.md](docs/SETUP.md)

<details>
<summary><strong>🔧 Troubleshooting</strong></summary>

| Problem | Solution |
|---------|----------|
| `MCP server initialization timed out after 60 seconds` | You're using `npx`. Run `npm install -g memorix` and change config to `"command": "memorix"` |
| `Cannot start Memorix: no valid project detected` | Your CWD is a system directory (home, Desktop, etc). Open a real project folder or set `MEMORIX_PROJECT_ROOT` |
| `memorix: command not found` | Run `npm install -g memorix` first. Verify with `memorix --version` |
| Parameter type errors (GLM/non-Anthropic models) | Update to v0.9.1+: `npm install -g memorix@latest` |

</details>

---

## 🎬 Real-World Scenarios

### Scenario 1: Cross-Session Memory

```
Monday morning — You and Cursor discuss auth architecture:
  You: "Let's use JWT with refresh tokens, 15-minute expiry"
  → Memorix auto-stores this as a 🟤 decision

Tuesday — New Cursor session:
  You: "Add the login endpoint"
  → AI calls memorix_search("auth") → finds Monday's decision
  → "Got it, I'll implement JWT with 15-min refresh tokens as we decided"
  → Zero re-explaining!
```

### Scenario 2: Cross-Agent Collaboration

```
You use Windsurf for backend, Claude Code for reviews:

  Windsurf: You fix a tricky race condition in the payment module
  → Memorix stores it as a 🟡 problem-solution with the fix details

  Claude Code: "Review the payment module"
  → AI calls memorix_search("payment") → finds the race condition fix
  → "I see there was a recent race condition fix. Let me verify it's correct..."
  → Knowledge transfers seamlessly between agents!
```

### Scenario 3: Gotcha Prevention

```
Week 1: You hit a painful Windows path separator bug
  → Memorix stores it as a 🔴 gotcha: "Use path.join(), never string concat"

Week 3: AI is about to write `baseDir + '/' + filename`
  → Session-start hook injected the gotcha into context
  → AI writes `path.join(baseDir, filename)` instead
  → Bug prevented before it happened!
```

### Scenario 4: Workspace Sync Across IDEs

```
You have 12 MCP servers configured in Cursor.
Now you want to try Kiro.

  You: "Sync my workspace to Kiro"
  → memorix_workspace_sync scans Cursor's MCP configs
  → Generates Kiro-compatible .kiro/settings/mcp.json
  → Also syncs your rules, skills, and workflows
  → Kiro is ready in seconds, not hours!
```

### Scenario 5: Auto-Generated Project Skills

```
After 2 weeks of development, you have 50+ observations:
  - 8 gotchas about Windows path issues
  - 5 decisions about the auth module
  - 3 problem-solutions for database migrations

  You: "Generate project skills"
  → memorix_skills clusters observations by entity
  → Auto-generates SKILL.md files:
    - "auth-module-guide.md" — JWT setup, refresh flow, common pitfalls
    - "database-migrations.md" — Prisma patterns, rollback strategies
  → Syncs skills to any agent: Cursor, Claude Code, Kiro...
  → New team members' AI instantly knows your project's patterns!
```

### Scenario 6: Session Lifecycle (v0.8.0)

```
Morning — Start a new session in Windsurf:
  → memorix_session_start auto-injects:
    📋 Previous Session: "Implemented JWT auth middleware"
    🔴 JWT tokens expire silently (gotcha)
    🟤 Use Docker for deployment (decision)
  → AI instantly knows what you did yesterday!

Evening — End the session:
  → memorix_session_end saves structured summary
  → Next session (any agent!) gets this context automatically
```

### Scenario 7: Topic Key Upsert — No More Duplicates (v0.8.0)

```
You update your architecture decision 3 times over a week:

  Day 1: memorix_store(topicKey="architecture/auth-model", ...)
  → Creates observation #42 (rev 1)

  Day 3: memorix_store(topicKey="architecture/auth-model", ...)
  → Updates #42 in-place (rev 2) — NOT a new #43!

  Day 5: memorix_store(topicKey="architecture/auth-model", ...)
  → Updates #42 again (rev 3)

  Result: 1 observation with latest content, not 3 duplicates!
```

---

## 🧠 What Memorix Can Do

### Smart Memory (24 MCP Tools)

| What You Say | What Memorix Does |
|-------------|-------------------|
| "Remember this architecture decision" | `memorix_store` — Classifies as 🟤 decision, extracts entities, creates graph relations, auto-associates session |
| "What did we decide about auth?" | `memorix_search` → `memorix_detail` — 3-layer progressive disclosure, ~10x token savings |
| "What auth decisions last week?" | `memorix_search` with `since`/`until` — Temporal queries with date range filtering |
| "What happened around that bug fix?" | `memorix_timeline` — Shows chronological context before/after |
| "Show me the knowledge graph" | `memorix_dashboard` — Opens interactive web UI with D3.js graph + sessions panel |
| "Which memories are getting stale?" | `memorix_retention` — Exponential decay scores, identifies archive candidates |
| "Start a new session" | `memorix_session_start` — Tracks session lifecycle, auto-injects previous session summaries + key memories |
| "End this session" | `memorix_session_end` — Saves structured summary (Goal/Discoveries/Accomplished/Files) for next session |
| "What did we do last session?" | `memorix_session_context` — Retrieves session history and key observations |
| "Suggest a topic key for this" | `memorix_suggest_topic_key` — Generates stable keys for deduplication (e.g. `architecture/auth-model`) |
| "Clean up duplicate memories" | `memorix_consolidate` — Find & merge similar observations by text similarity, preserving all facts |
| "Export this project's memories" | `memorix_export` — JSON (importable) or Markdown (human-readable for PRs/docs) |
| "Import memories from teammate" | `memorix_import` — Restore from JSON export, re-assigns IDs, deduplicates by topicKey |

### Cross-Agent Workspace Sync

| What You Say | What Memorix Does |
|-------------|-------------------|
| "Sync my MCP servers to Kiro" | `memorix_workspace_sync` — Migrates configs, merges (never overwrites) |
| "Check my agent rules" | `memorix_rules_sync` — Scans 8 agents, deduplicates, detects conflicts |
| "Generate rules for Cursor" | `memorix_rules_sync` — Cross-format conversion (`.mdc` ↔ `CLAUDE.md` ↔ `.kiro/steering/`) |
| "Generate project skills" | `memorix_skills` — Creates SKILL.md from observation patterns |
| "Inject the auth skill" | `memorix_skills` — Returns skill content directly into agent context |

### Knowledge Graph (MCP Official Compatible)

| Tool | What It Does |
|------|-------------|
| `create_entities` | Build your project's knowledge graph |
| `create_relations` | Connect entities with typed edges (causes, fixes, depends_on) |
| `add_observations` | Attach observations to entities |
| `search_nodes` / `open_nodes` | Query the graph |
| `read_graph` | Export full graph for visualization |

> **Drop-in compatible** with [MCP Official Memory Server](https://github.com/modelcontextprotocol/servers/tree/main/src/memory) — same API, more features.

### 9 Observation Types

Every memory is classified for intelligent retrieval:

| Icon | Type | When To Use |
|------|------|-------------|
| 🎯 | `session-request` | Original task/goal for this session |
| 🔴 | `gotcha` | Critical pitfall — "Never do X because Y" |
| 🟡 | `problem-solution` | Bug fix with root cause and solution |
| 🔵 | `how-it-works` | Technical explanation of a system |
| 🟢 | `what-changed` | Code/config change record |
| 🟣 | `discovery` | New insight or finding |
| 🟠 | `why-it-exists` | Rationale behind a design choice |
| 🟤 | `decision` | Architecture/design decision |
| ⚖️ | `trade-off` | Compromise with pros/cons |

### Visual Dashboard

Run `memorix_dashboard` to open a web UI at `http://localhost:3210`:

- **Interactive Knowledge Graph** — D3.js force-directed visualization of entities and relations
- **Observation Browser** — Filter by type, search with highlighting, expand/collapse details
- **Retention Panel** — See which memories are active, stale, or candidates for archival
- **Project Switcher** — View any project's data without switching IDEs
- **Batch Cleanup** — Auto-detect and bulk-delete low-quality observations
- **Light/Dark Theme** — Premium glassmorphism design, bilingual (EN/中文)

### Auto-Memory Hooks

Memorix can **automatically capture** decisions, errors, and gotchas from your coding sessions:

```bash
memorix hooks install    # One-command setup
```

- **Implicit Memory** — Detects patterns like "I decided to...", "The bug was caused by...", "Never use X"
- **Session Start Injection** — Loads recent high-value memories into agent context automatically
- **Multi-Language** — English + Chinese keyword matching
- **Smart Filtering** — 30s cooldown, skips trivial commands (ls, cat, pwd)

---

## 📊 Comparison with Alternatives

| | [Mem0](https://github.com/mem0ai/mem0) | [mcp-memory-service](https://github.com/doobidoo/mcp-memory-service) | [claude-mem](https://github.com/anthropics/claude-code) | **Memorix** |
|---|---|---|---|---|
| **Agents supported** | SDK-based | 13+ (MCP) | Claude Code only | **7 IDEs (MCP)** |
| **Cross-agent sync** | No | No | No | **Yes (configs, rules, skills, workflows)** |
| **Rules sync** | No | No | No | **Yes (7 formats)** |
| **Skills engine** | No | No | No | **Yes (auto-generated from memory)** |
| **Knowledge graph** | No | Yes | No | **Yes (MCP Official compatible)** |
| **Hybrid search** | No | Yes | No | **Yes (BM25 + vector)** |
| **Token-efficient** | No | No | Yes (3-layer) | **Yes (3-layer progressive disclosure)** |
| **Auto-memory hooks** | No | No | Yes | **Yes (multi-language)** |
| **Memory decay** | No | Yes | No | **Yes (exponential + immunity)** |
| **Visual dashboard** | Cloud UI | Yes | No | **Yes (web UI + D3.js graph)** |
| **Privacy** | Cloud | Local | Local | **100% Local** |
| **Cost** | Per-call API | $0 | $0 | **$0** |
| **Install** | `pip install` | `pip install` | Built into Claude | **`npx memorix serve`** |

**Memorix is the only tool that bridges memory AND workspace across agents.**

---

## 🔮 Optional: Vector Search

Out of the box, Memorix uses BM25 full-text search (already great for code). Add semantic search with one command:

```bash
# Option A: Native speed (recommended)
npm install -g fastembed

# Option B: Universal compatibility
npm install -g @huggingface/transformers
```

With vector search, queries like "authentication" also match memories about "login flow" via semantic similarity. Both run **100% locally** — zero API calls, zero cost.

---

## 🔒 Project Isolation

- **Auto-detected** — Project identity from `git remote` URL, zero config needed
- **MCP roots fallback** — If `cwd` is not a project (e.g., Antigravity), Memorix tries the [MCP roots protocol](https://modelcontextprotocol.io/docs/concepts/roots) to get your workspace path from the IDE
- **Per-project storage** — `~/.memorix/data/<owner--repo>/` per project
- **Scoped search** — Defaults to current project; `scope: "global"` to search all
- **Zero cross-contamination** — Project A's decisions never leak into project B

**Detection priority:** `--cwd` → `MEMORIX_PROJECT_ROOT` → `INIT_CWD` → `process.cwd()` → MCP roots → error

---

## ❓ Frequently Asked Questions

**How do I keep context when switching between Cursor and Claude Code?**
Install Memorix in both IDEs. They share the same local memory directory — architecture decisions made in Cursor are instantly searchable in Claude Code. No cloud sync needed.

**How do I prevent my AI from forgetting previous sessions?**
Use `memorix_session_start` at the beginning of each session — it automatically injects previous session summaries and key observations (gotchas, decisions, discoveries). Use `memorix_session_end` to save a structured summary before leaving. All observations persist on disk and are searchable via `memorix_search` anytime.

**How do I sync MCP server configs between IDEs?**
Run `memorix_workspace_sync` with action `"migrate"` and your target IDE. It scans source configs and generates compatible configs for the target — merges, never overwrites.

**How do I migrate from Cursor to Windsurf / Kiro / Claude Code?**
Memorix workspace sync migrates MCP configs, agent rules (`.mdc` ↔ `CLAUDE.md` ↔ `.kiro/steering/`), skills, and workflows. One command, seconds to complete.

**Is there an MCP server for persistent AI coding memory?**
Yes — Memorix is a cross-agent memory MCP server supporting 7 IDEs with knowledge graph, 3-layer progressive disclosure search, workspace sync, and auto-generated project skills.

**How is this different from mcp-memory-service?**
Both are great memory servers. Memorix adds: cross-agent workspace sync (MCP configs, rules, skills), auto-generated project skills from memory patterns, 3-layer token-efficient search, and session-start memory injection hooks.

**Does it work offline / locally?**
Yes, 100%. All data stored in `~/.memorix/data/`. No cloud, no API keys, no external services. Optional vector search also runs locally via ONNX/WASM.

> 📖 For AI systems: see [`llms.txt`](llms.txt) and [`llms-full.txt`](llms-full.txt) for machine-readable project documentation.

---

## 🧑‍💻 Development

```bash
git clone https://github.com/AVIDS2/memorix.git
cd memorix
npm install

npm run dev          # tsup watch mode
npm test             # vitest (422 tests)
npm run lint         # TypeScript type check
npm run build        # Production build
```

> 📚 **Documentation:** [Architecture](docs/ARCHITECTURE.md) • [API Reference](docs/API_REFERENCE.md) • [Modules](docs/MODULES.md) • [Design Decisions](docs/DESIGN_DECISIONS.md) • [Setup Guide](docs/SETUP.md) • [Known Issues](docs/KNOWN_ISSUES_AND_ROADMAP.md)

---

## 🙏 Acknowledgements

Memorix stands on the shoulders of these excellent projects:

- [mcp-memory-service](https://github.com/doobidoo/mcp-memory-service) — Hybrid search, exponential decay, access tracking
- [MemCP](https://github.com/maydali28/memcp) — MAGMA 4-graph, entity extraction, retention lifecycle
- [claude-mem](https://github.com/anthropics/claude-code) — 3-layer Progressive Disclosure
- [Mem0](https://github.com/mem0ai/mem0) — Memory layer architecture patterns

---

## 📄 License

Apache 2.0 — see [LICENSE](LICENSE)

---

<p align="center">
  <strong>Made with ❤️ by <a href="https://github.com/AVIDS2">AVIDS2</a></strong>
  <br>
  <sub>If Memorix helps your workflow, consider giving it a ⭐ on GitHub!</sub>
</p>
