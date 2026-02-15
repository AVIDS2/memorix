<p align="center">
  <img src="assets/logo.png" alt="Memorix Logo" width="120">
  <h1 align="center">Memorix</h1>
  <p align="center"><strong>Cross-Agent Memory Bridge — Universal memory layer for AI coding agents via MCP</strong></p>
  <p align="center">
    <a href="https://www.npmjs.com/package/memorix"><img src="https://img.shields.io/npm/v/memorix.svg?style=flat-square&color=cb3837" alt="npm version"></a>
    <a href="https://www.npmjs.com/package/memorix"><img src="https://img.shields.io/npm/dm/memorix.svg?style=flat-square&color=blue" alt="npm downloads"></a>
    <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache%202.0-green.svg?style=flat-square" alt="License"></a>
    <a href="https://github.com/AVIDS2/memorix"><img src="https://img.shields.io/github/stars/AVIDS2/memorix?style=flat-square&color=yellow" alt="GitHub stars"></a>
    <img src="https://img.shields.io/badge/tests-274%20passed-brightgreen?style=flat-square" alt="Tests">
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

> **One project, six agents, zero context loss.**
>
> Memorix is a **cross-agent memory bridge** — it lets Cursor, Windsurf, Claude Code, Codex, Copilot, and Antigravity **share the same project knowledge** in real-time. Architecture decisions made in one IDE are instantly available in another. Switch tools, open new windows, start fresh sessions — your context follows you everywhere via [MCP](https://modelcontextprotocol.io/). It also **syncs MCP configs, rules, skills, and workflows** across all your agents automatically.

---

## ⚡ Quick Start

### 30-Second Setup (Zero Install)

Add Memorix to your agent's MCP config — **that's it**. No global install needed.

**Windsurf** → `~/.codeium/windsurf/mcp_config.json`
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

Restart your agent and Memorix is running! 🎉

> 💡 More agent configs: [Cursor](#cursor) • [Claude Code](#claude-code) • [Codex](#codex) • [VS Code Copilot](#vs-code-copilot) • [Antigravity](#antigravity)

### Or Install Globally

```bash
npm install -g memorix
```

Then use `"command": "memorix"` instead of `"command": "npx"` in your config.

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

- **6 Agent Adapters** — Windsurf, Cursor, Claude Code, Codex, VS Code Copilot, Antigravity
- **MCP Config Migration** — Detect and migrate MCP server configs (merges — never overwrites)
- **Rules Sync** — Scan → Deduplicate → Conflict detection → Cross-format generation
- **Skills & Workflows** — Copy skill folders and workflow files across agents
- **Apply with Safety** — Backup `.bak` → Atomic write → Auto-rollback on failure

### 🪝 Auto-Memory Hooks

- **Implicit Memory** — Auto-captures decisions, errors, gotchas from agent activity
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
┌──────────────────────────────────────────────────────────────┐
│                    AI Coding Agents                           │
│  Windsurf │ Cursor │ Claude Code │ Codex │ Copilot │ Antigravity
└────────────────────────┬─────────────────────────────────────┘
                         │ MCP Protocol (stdio)
┌────────────────────────▼─────────────────────────────────────┐
│                 Memorix MCP Server (17 tools)                │
│                                                              │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────────┐   │
│  │   Memory     │  │   Compact    │  │  Workspace Sync  │   │
│  │   Layer      │  │   Engine     │  │  (6 adapters)    │   │
│  │             │  │  (3-layer)   │  │                  │   │
│  │ • Graph     │  │              │  │ • MCP Configs    │   │
│  │ • Retention │  │              │  │ • Rules          │   │
│  │ • Entities  │  │              │  │ • Skills         │   │
│  │ • Relations │  │              │  │ • Workflows      │   │
│  └──────┬──────┘  └──────┬───────┘  └──────────────────┘   │
│         │                │                                   │
│  ┌──────▼────────────────▼───────────────────────────────┐  │
│  │  Orama Store (BM25 + Vector) │ Persistence (JSONL)    │  │
│  └───────────────────────────────────────────────────────┘  │
│                                                              │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  Hooks System: Normalizer → Pattern Detector → Store  │  │
│  │  (Auto-captures decisions, bugs, gotchas from agents) │  │
│  └───────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
```

---

## 🔮 Optional: Vector Search

Install `fastembed` for hybrid (BM25 + semantic) search:

```bash
npm install -g fastembed
```

- **Without it** — BM25 full-text search (already very effective for code)
- **With it** — Queries like "authentication" also match "login flow" via semantic similarity
- Local ONNX inference, zero API calls, zero privacy risk

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
npm test             # vitest (274 tests)
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
├── embedding/             # Optional fastembed vector provider
├── hooks/                 # Auto-memory hooks (normalizer + pattern detector)
├── workspace/             # Cross-agent MCP/workflow/skills sync
├── rules/                 # Cross-agent rules sync (6 adapters)
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
