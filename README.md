<p align="center">
  <img src="assets/logo.png" alt="Memorix Logo" width="120">
  <h1 align="center">Memorix</h1>
  <p align="center"><strong>Cross-Agent Memory Bridge — Universal memory layer for AI coding agents via MCP</strong></p>
  <p align="center">
    <a href="https://www.npmjs.com/package/memorix"><img src="https://img.shields.io/npm/v/memorix.svg?style=flat-square&color=cb3837" alt="npm version"></a>
    <a href="https://www.npmjs.com/package/memorix"><img src="https://img.shields.io/npm/dm/memorix.svg?style=flat-square&color=blue" alt="npm downloads"></a>
    <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache%202.0-green.svg?style=flat-square" alt="License"></a>
    <a href="https://github.com/AVIDS2/memorix"><img src="https://img.shields.io/github/stars/AVIDS2/memorix?style=flat-square&color=yellow" alt="GitHub stars"></a>
    <img src="https://img.shields.io/badge/tests-422%20passed-brightgreen?style=flat-square" alt="Tests">
  </p>
  <p align="center">
    <a href="#-quick-start">Quick Start</a> •
    <a href="#-features">Features</a> •
    <a href="#-agent-configuration">Agent Config</a> •
    <a href="#-how-it-works">How It Works</a> •
    <a href="#-development">Development</a>
  </p>
</p>

---

> **One project, seven agents, zero context loss.**
>
> Memorix is a **cross-agent memory bridge** — it lets Cursor, Windsurf, Claude Code, Codex, Copilot, Antigravity, and **Kiro** **share the same project knowledge** in real-time. Architecture decisions made in one IDE are instantly available in another. Switch tools, open new windows, start fresh sessions — your context follows you everywhere via [MCP](https://modelcontextprotocol.io/). It also **syncs MCP configs, rules, skills, and workflows** across all your agents automatically.

---

## ⚡ Quick Start

One config line. Seven agents. Zero context loss.

```json
{
  "mcpServers": {
    "memorix": {
      "command": "npx",
      "args": ["-y", "memorix@latest", "serve"]
    }
  }
}
```

Add this to your agent's MCP config, restart — done. 🎉

> 💡 Agent-specific config paths: [Windsurf](#windsurf) • [Cursor](#cursor) • [Claude Code](#claude-code) • [Codex](#codex) • [VS Code Copilot](#vs-code-copilot) • [Antigravity](#antigravity) • [Kiro](#kiro)

---

## 🤔 The Problem

| Situation | Pain |
|-----------|------|
| Architecture decisions in Cursor | Invisible to Claude Code |
| Bug fix knowledge in Windsurf | Doesn't transfer to Codex |
| MCP server configs | Manually copy-paste between agents |
| Agent rules & skills | Stuck in one IDE |
| Start a new session | Re-explain everything from scratch |

**No one bridges memory AND workspace configs across agents — until now.**

---

## ✨ Features

### 🧠 Smart Memory

- **Knowledge Graph** — Entity-Relation model, [MCP Official Memory Server](https://github.com/modelcontextprotocol/servers/tree/main/src/memory) compatible
- **9 Observation Types** — 🎯 session-request 🔴 gotcha 🟡 problem-solution 🔵 how-it-works 🟢 what-changed 🟣 discovery 🟠 why-it-exists 🟤 decision ⚖️ trade-off
- **Auto-Enrichment** — Automatically extracts file paths, module names, CamelCase identifiers from your narratives
- **Auto-Relations** — Detects causal language ("because", "due to", "fixed by") and auto-creates typed graph relations
- **Memory Decay** — Exponential decay scoring with immunity rules, so old memories fade while critical ones persist forever

### 🔍 Token-Efficient Search

- **3-Layer Progressive Disclosure** — Based on [claude-mem](https://github.com/anthropics/claude-code) (~10x token savings)
  - **L1** `memorix_search` → Compact index (~50-100 tokens/result)
  - **L2** `memorix_timeline` → Chronological context
  - **L3** `memorix_detail` → Full details on demand (~500-1000 tokens/result)
- **Hybrid Search** — Full-text (BM25) + Vector (semantic) via [Orama](https://github.com/orama/orama)
- **Token Budget** — `maxTokens` parameter auto-trims results to fit context windows

### 🔄 Cross-Agent Workspace Sync

- **7 Agent Adapters** — Windsurf, Cursor, Claude Code, Codex, VS Code Copilot, Antigravity, **Kiro**
- **MCP Config Migration** — Detect and migrate MCP server configs (merges — never overwrites)
- **Rules Sync** — Scan → Deduplicate → Conflict detection → Cross-format generation
- **Skills & Workflows** — Copy skill folders and workflow files across agents
- **Memory-Driven Skills** — `memorix_skills` auto-generates project-specific `SKILL.md` from observation patterns (gotchas, decisions, how-it-works)
- **Apply with Safety** — Backup `.bak` → Atomic write → Auto-rollback on failure

### 🔒 Project Isolation

- **Per-Project Data** — Each project stores data in its own directory (`~/.memorix/data/<owner--repo>/`)
- **Git-Based Detection** — Project identity derived from `git remote`, no manual config needed
- **Scoped Search** — `memorix_search` defaults to current project; set `scope: "global"` to search all
- **Auto Migration** — Legacy global data automatically migrates to project directories on first run
- **Zero Cross-Contamination** — Architecture decisions from project A never leak into project B

### 📊 Visual Dashboard

- **Web Dashboard** — `memorix_dashboard` opens a beautiful web UI at `http://localhost:3210`
- **Project Switcher** — Dropdown to view any project's data without switching IDEs
- **Knowledge Graph** — Interactive visualization of entities and relations
- **Type Distribution Chart** — Canvas donut chart showing observation type breakdown
- **Embedding Status** — Real-time display of vector search provider status (enabled/provider/dimensions)
- **Retention Scores** — Exponential decay scoring with immunity status
- **Observation Management** — Expand/collapse details, **search with text highlighting**, delete with confirmation, data export
- **Batch Cleanup** — Auto-detect and bulk-delete low-quality observations
- **Light/Dark Theme** — Premium glassmorphism design, bilingual (EN/中文)

### 🪝 Auto-Memory Hooks

- **Implicit Memory** — Auto-captures decisions, errors, gotchas from agent activity
- **Session Start Injection** — Intelligently loads recent high-value memories (gotchas, decisions, problem-solutions) and injects a concise summary into the agent's system prompt at session start
- **Multi-Language Pattern Detection** — English + Chinese keyword matching
- **Cooldown & Noise Filtering** — 30s cooldown, skips trivial commands (ls, cat, pwd)
- **One-Command Install** — `memorix hooks install` sets up hooks + rules for your agent

### 🔁 Context Continuity

```
Session 1: You and AI discuss auth architecture
  → Memorix auto-stores the decision

Session 2: New chat, same project
  → AI searches Memorix → "Ah, we decided on JWT with refresh tokens"
  → No re-explaining needed!
```

---

## 🔧 Agent Configuration

### Windsurf

`~/.codeium/windsurf/mcp_config.json`:
```json
{
  "mcpServers": {
    "memorix": {
      "command": "npx",
      "args": ["-y", "memorix@latest", "serve"]
    }
  }
}
```

> **Timeout troubleshooting** — If you see `MCP server initialization timed out after 60 seconds`, add `--cwd` to force the project root:
> ```json
> {
>   "mcpServers": {
>     "memorix": {
>       "command": "npx",
>       "args": ["-y", "memorix@latest", "serve", "--cwd", "<your-project-path>"]
>     }
>   }
> }
> ```

### Cursor

`.cursor/mcp.json`:
```json
{
  "mcpServers": {
    "memorix": {
      "command": "npx",
      "args": ["-y", "memorix@latest", "serve"]
    }
  }
}
```

### Claude Code

`~/.claude.json`:
```json
{
  "mcpServers": {
    "memorix": {
      "command": "npx",
      "args": ["-y", "memorix@latest", "serve"]
    }
  }
}
```

### Codex

`~/.codex/config.toml`:
```toml
[mcp_servers.memorix]
command = "npx"
args = ["-y", "memorix@latest", "serve"]
```

### VS Code Copilot

`.vscode/mcp.json` or VS Code `settings.json`:
```json
{
  "mcp": {
    "servers": {
      "memorix": {
        "command": "npx",
        "args": ["-y", "memorix@latest", "serve"]
      }
    }
  }
}
```

### Antigravity

`~/.gemini/antigravity/settings/mcp_config.json`:
```json
{
  "mcpServers": {
    "memorix": {
      "command": "npx",
      "args": ["-y", "memorix@latest", "serve"]
    }
  }
}
```

### Kiro

`.kiro/settings/mcp.json`:
```json
{
  "mcpServers": {
    "memorix": {
      "command": "npx",
      "args": ["-y", "memorix@latest", "serve"]
    }
  }
}
```

---

## 🛠 Available MCP Tools

### Memorix Extensions

| Tool | Purpose | Token Cost |
|------|---------|------------|
| `memorix_store` | Store observation with auto-enrichment | — |
| `memorix_search` | L1: Compact index search | ~50-100/result |
| `memorix_timeline` | L2: Chronological context | ~100-200/group |
| `memorix_detail` | L3: Full observation details | ~500-1000/result |
| `memorix_retention` | Memory decay & retention status | — |
| `memorix_dashboard` | Launch visual web dashboard in browser | — |
| `memorix_rules_sync` | Scan/deduplicate/generate rules across agents | — |
| `memorix_workspace_sync` | Migrate MCP configs, workflows, skills | — |

### MCP Official Compatible (Drop-in Replacement)

| Tool | Purpose |
|------|---------|
| `create_entities` | Create knowledge graph entities |
| `create_relations` | Create relations between entities |
| `add_observations` | Add observations to entities |
| `delete_entities` | Delete entities (cascades relations) |
| `delete_observations` | Delete specific observations |
| `delete_relations` | Delete relations |
| `search_nodes` | Search knowledge graph |
| `open_nodes` | Get entities by name |
| `read_graph` | Read entire graph |

---

## 🧩 How It Works

### Data Flow

```
Agent ──memorix_store──▶ Entity Extractor ──▶ Auto-Relations ──▶ Knowledge Graph
                         │                                        │
                         ▼                                        │
                     Orama Index ◀───────── Persistence Layer ◀───┘
                     (BM25 + Vector)        (~/.memorix/data/<project>/)
                         │
Agent ◀──memorix_search──┘  L1: Compact Index (~50-100 tokens)
Agent ◀──memorix_timeline─  L2: Timeline Context
Agent ◀──memorix_detail───  L3: Full Details (~500-1000 tokens)
```

### Progressive Disclosure Example

```
🔍 Agent calls memorix_search("auth bug")

📋 L1 Response (compact — agent scans IDs):
| ID  | Time    | T  | Title                    | Tokens |
|-----|---------|-----|--------------------------|--------|
| #42 | 2:14 PM | 🟡 | Fixed JWT refresh timeout | ~155   |
| #38 | 1:30 PM | 🔵 | How JWT refresh works     | ~220   |

🔎 Agent calls memorix_detail([42])

📄 L3 Response (full content):
# Observation #42 — Fixed JWT refresh timeout
Type: 🟡 problem-solution | Entity: auth-module
Narrative: The JWT refresh token was timing out after 15 minutes
because the expiry was hardcoded. Fixed by reading from env...
Facts: ["Default timeout: 60s", "Fix: use REFRESH_TTL env var"]
Files: ["src/auth/jwt.ts", "src/config.ts"]
```

### Architecture

```
┌───────────────────────────────────────────────────────────────────┐
│                      AI Coding Agents                              │
│  Windsurf │ Cursor │ Claude Code │ Codex │ Copilot │ Antigravity │ Kiro
└───────────────────────────┬───────────────────────────────────────┘
                            │ MCP Protocol (stdio)
┌───────────────────────────▼───────────────────────────────────────┐
│                  Memorix MCP Server (17 tools)                    │
│                                                                    │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────────┐         │
│  │   Memory     │  │   Compact    │  │  Workspace Sync  │         │
│  │   Layer      │  │   Engine     │  │  (7 adapters)    │         │
│  │             │  │  (3-layer)   │  │                  │         │
│  │ • Graph     │  │              │  │ • MCP Configs    │         │
│  │ • Retention │  │              │  │ • Rules          │         │
│  │ • Entities  │  │              │  │ • Skills         │         │
│  │ • Relations │  │              │  │ • Workflows      │         │
│  └──────┬──────┘  └──────┬───────┘  └──────────────────┘         │
│         │                │                                         │
│  ┌──────▼────────────────▼───────────────────────────────┐        │
│  │  Orama Store (BM25 + Vector) │ Persistence (JSONL)    │        │
│  └───────────────────────────────────────────────────────┘        │
│                                                                    │
│  ┌───────────────────────────────────────────────────────┐        │
│  │  Hooks System: Normalizer → Pattern Detector → Store  │        │
│  │  (Auto-captures decisions, bugs, gotchas from agents) │        │
│  └───────────────────────────────────────────────────────┘        │
└───────────────────────────────────────────────────────────────────┘
```

---

## 🔮 Optional: Vector Search

Memorix supports **hybrid search** (BM25 + semantic vectors) with a provider priority chain:

| Priority | Provider | How to Enable | Notes |
|----------|----------|---------------|-------|
| 1st | `fastembed` | `npm install -g fastembed` | Fastest, native ONNX bindings |
| 2nd | `transformers.js` | `npm install -g @huggingface/transformers` | Pure JS/WASM, cross-platform |
| Fallback | Full-text (BM25) | Always available | Already very effective for code |

```bash
# Option A: Native speed (recommended if it installs cleanly)
npm install -g fastembed

# Option B: Universal compatibility (works everywhere, no native deps)
npm install -g @huggingface/transformers
```

- **Without either** — BM25 full-text search works great out of the box
- **With any provider** — Queries like "authentication" also match "login flow" via semantic similarity
- Both run **locally** — zero API calls, zero privacy risk, zero cost
- The dashboard shows which provider is active in real-time

---

## 💾 Data Storage

All data is stored locally per project:

```
~/.memorix/data/<projectId>/
├── observations.json      # Structured observations
├── id-counter.txt         # Next observation ID
├── entities.jsonl         # Knowledge graph nodes (MCP compatible)
└── relations.jsonl        # Knowledge graph edges (MCP compatible)
```

- `projectId` is auto-detected from Git remote URL (e.g., `user/repo`)
- Data is shared across all agents (same directory)
- No cloud, no API keys, no external services

---

## 🧑‍💻 Development

```bash
git clone https://github.com/AVIDS2/memorix.git
cd memorix
npm install

npm run dev          # tsup watch mode
npm test             # vitest (405 tests)
npm run lint         # TypeScript type check
npm run build        # Production build
```

### Project Structure

```
src/
├── server.ts              # MCP Server entry (17 tools)
├── types.ts               # All type definitions
├── memory/                # Graph, observations, retention, entity extraction
├── store/                 # Orama search engine + disk persistence
├── compact/               # 3-layer Progressive Disclosure engine
├── embedding/             # Vector providers (fastembed → transformers.js → fallback)
├── skills/                # Memory-driven project skills engine (list → generate → inject)
├── hooks/                 # Auto-memory hooks (normalizer + pattern detector)
├── workspace/             # Cross-agent MCP/workflow/skills sync
├── rules/                 # Cross-agent rules sync (7 adapters)
├── dashboard/             # Visual web dashboard (knowledge graph, stats)
├── project/               # Git-based project detection
└── cli/                   # CLI commands (serve, hook, sync, dashboard)
```

> 📚 Full documentation available in [`docs/`](./docs/) — architecture, modules, API reference, design decisions, and more.

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
