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
    <img src="https://img.shields.io/badge/tests-509%20passed-brightgreen?style=flat-square" alt="Tests">
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

### 🔧 Troubleshooting — MCP Connection Issues

> **⚠️ #1 Mistake: Do NOT manually run `memorix serve` in a terminal.**
> MCP uses **stdio transport** — your IDE (Claude Code, Cursor, etc.) launches memorix as a subprocess automatically. Running it manually in PowerShell/Terminal does nothing for the IDE connection.

**Quick diagnostic** — run this first:
```bash
memorix --version       # Should print version number
memorix serve --cwd .   # Should show "[memorix] MCP Server running on stdio"
```
If either fails, follow the table below:

| Symptom | Cause | Fix |
|---------|-------|-----|
| `memorix · ✗ failed` in IDE | IDE can't find the `memorix` command | Run `npm install -g memorix`. On Windows, **restart your IDE** after install so it picks up the new PATH |
| `MCP server initialization timed out` | Using `npx` (downloads every time) | Switch to global install: `npm install -g memorix`, change config to `"command": "memorix"` |
| Repeated "Reconnected to memorix" then fails | memorix process crashes on startup | Check: 1) Node.js ≥ 18 (`node -v`), 2) open a **real project folder** (not Desktop/Home), 3) set `MEMORIX_PROJECT_ROOT` in MCP config |
| `Cannot start Memorix: no valid project detected` | CWD is a system directory | Open a project folder with code, or add `"env": { "MEMORIX_PROJECT_ROOT": "/path/to/project" }` to your MCP config |
| `memorix: command not found` | npm global bin not in PATH | Run `npm config get prefix` to find install location, add its `bin/` to your system PATH, then restart IDE |
| Works in terminal but not in IDE | IDE uses a different PATH than your shell | **Windows:** restart IDE after `npm install -g`. **macOS/Linux:** ensure `~/.bashrc` or `~/.zshrc` exports the npm global bin path |
| Parameter type errors | Old version or non-Anthropic model quirks | Update: `npm install -g memorix@latest` |

**Correct `.claude.json` config:**
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

**❌ Wrong** — do NOT use any of these:
```
"command": "npx"                    ← will timeout
"command": "npx -y memorix serve"   ← wrong format
"command": "node memorix serve"     ← not how it works
```

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

---

## 🧠 What Memorix Can Do

### 24 MCP Tools

| Category | Tools | What They Do |
|----------|-------|-------------|
| **Store & Classify** | `memorix_store`, `memorix_suggest_topic_key` | Store memories with 9 types (🔴gotcha 🟤decision 🟡fix ...), dedup via topic keys |
| **Search & Retrieve** | `memorix_search`, `memorix_detail`, `memorix_timeline` | 3-layer progressive disclosure (~10x token savings), temporal queries, chronological context |
| **Sessions** | `memorix_session_start/end/context` | Auto-inject previous session context, save structured summaries |
| **Maintenance** | `memorix_retention`, `memorix_consolidate`, `memorix_export/import` | Decay scoring, merge duplicates, backup & share |
| **Dashboard** | `memorix_dashboard` | Interactive web UI — D3.js knowledge graph, observation browser, retention panel |
| **Workspace Sync** | `memorix_workspace_sync`, `memorix_rules_sync`, `memorix_skills` | Migrate MCP configs across 8 agents, sync rules (`.mdc` ↔ `CLAUDE.md` ↔ `.kiro/steering/`), auto-generate project skills |
| **Knowledge Graph** | `create_entities`, `create_relations`, `add_observations`, `search_nodes`, `read_graph` | [MCP Official Memory Server](https://github.com/modelcontextprotocol/servers/tree/main/src/memory) compatible — same API, more features |

### 9 Observation Types

Every memory is classified: 🎯 session-request · 🔴 gotcha · 🟡 problem-solution · 🔵 how-it-works · 🟢 what-changed · 🟣 discovery · 🟠 why-it-exists · 🟤 decision · ⚖️ trade-off

### Auto-Memory Hooks

```bash
memorix hooks install    # One-command setup
```

Automatically captures decisions, errors, and gotchas from your coding sessions. Detects patterns in English + Chinese, injects high-value memories at session start, with smart filtering (30s cooldown, skips trivial commands).

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
| **Install** | `pip install` | `pip install` | Built into Claude | **`npm i -g memorix`** |

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
npm test             # vitest (509 tests)
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
