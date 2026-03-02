<p align="center">
  <img src="assets/logo.png" alt="Memorix" width="120">
</p>

<h1 align="center">Memorix</h1>

<p align="center">
  <strong>Persistent memory layer for AI coding agents.</strong><br>
  One MCP server. Nine agents. Zero context loss.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/memorix"><img src="https://img.shields.io/npm/v/memorix.svg?style=flat-square&color=cb3837" alt="npm"></a>
  <a href="https://www.npmjs.com/package/memorix"><img src="https://img.shields.io/npm/dm/memorix.svg?style=flat-square&color=blue" alt="downloads"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache%202.0-green.svg?style=flat-square" alt="license"></a>
  <a href="https://github.com/AVIDS2/memorix"><img src="https://img.shields.io/github/stars/AVIDS2/memorix?style=flat-square&color=yellow" alt="stars"></a>
  <img src="https://img.shields.io/badge/tests-576%20passed-brightgreen?style=flat-square" alt="tests">
</p>

<p align="center">
  <img src="https://img.shields.io/badge/-Cursor-orange?style=flat-square" alt="Cursor">
  <img src="https://img.shields.io/badge/-Windsurf-blue?style=flat-square" alt="Windsurf">
  <img src="https://img.shields.io/badge/-Claude%20Code-purple?style=flat-square" alt="Claude Code">
  <img src="https://img.shields.io/badge/-Codex-green?style=flat-square" alt="Codex">
  <img src="https://img.shields.io/badge/-Copilot-lightblue?style=flat-square" alt="Copilot">
  <img src="https://img.shields.io/badge/-Kiro-red?style=flat-square" alt="Kiro">
  <img src="https://img.shields.io/badge/-Antigravity-grey?style=flat-square" alt="Antigravity">
  <img src="https://img.shields.io/badge/-OpenCode-teal?style=flat-square" alt="OpenCode">
  <img src="https://img.shields.io/badge/-Gemini%20CLI-4285F4?style=flat-square" alt="Gemini CLI">
</p>

<p align="center">
  <a href="README.zh-CN.md">中文文档</a> ·
  <a href="#quick-start">Quick Start</a> ·
  <a href="#features">Features</a> ·
  <a href="#how-it-works">How It Works</a> ·
  <a href="docs/SETUP.md">Full Setup Guide</a>
</p>

---

## Why Memorix?

AI coding agents forget everything between sessions. Switch IDEs and context is gone. Memorix gives every agent a shared, persistent memory — decisions, gotchas, and architecture survive across sessions and tools.

```
Session 1 (Cursor):  "Use JWT with refresh tokens, 15-min expiry"  → stored as 🟤 decision
Session 2 (Claude Code):  "Add login endpoint"  → finds the decision → implements correctly
```

No re-explaining. No copy-pasting. No vendor lock-in.

---

## Quick Start

```bash
npm install -g memorix
```

Add to your agent's MCP config:

<details open>
<summary><strong>Cursor</strong> · <code>.cursor/mcp.json</code></summary>

```json
{ "mcpServers": { "memorix": { "command": "memorix", "args": ["serve"] } } }
```
</details>

<details>
<summary><strong>Claude Code</strong></summary>

```bash
claude mcp add memorix -- memorix serve
```
</details>

<details>
<summary><strong>Windsurf</strong> · <code>~/.codeium/windsurf/mcp_config.json</code></summary>

```json
{ "mcpServers": { "memorix": { "command": "memorix", "args": ["serve"] } } }
```
</details>

<details>
<summary><strong>VS Code Copilot</strong> · <code>.vscode/mcp.json</code></summary>

```json
{ "servers": { "memorix": { "command": "memorix", "args": ["serve"] } } }
```
</details>

<details>
<summary><strong>Codex</strong> · <code>~/.codex/config.toml</code></summary>

```toml
[mcp_servers.memorix]
command = "memorix"
args = ["serve"]
```
</details>

<details>
<summary><strong>Kiro</strong> · <code>.kiro/settings/mcp.json</code></summary>

```json
{ "mcpServers": { "memorix": { "command": "memorix", "args": ["serve"] } } }
```
</details>

<details>
<summary><strong>Antigravity</strong> · <code>~/.gemini/antigravity/mcp_config.json</code></summary>

```json
{ "mcpServers": { "memorix": { "command": "memorix", "args": ["serve"], "env": { "MEMORIX_PROJECT_ROOT": "/your/project/path" } } } }
```
</details>

<details>
<summary><strong>OpenCode</strong> · <code>~/.config/opencode/config.json</code></summary>

```json
{ "mcpServers": { "memorix": { "command": "memorix", "args": ["serve"] } } }
```
</details>

<details>
<summary><strong>Gemini CLI</strong> · <code>.gemini/settings.json</code></summary>

```json
{ "mcpServers": { "memorix": { "command": "memorix", "args": ["serve"] } } }
```
</details>

Restart your agent. Done. No API keys, no cloud, no dependencies.

> **Note:** Do NOT use `npx` — it re-downloads each time and causes MCP timeout. Use global install.
>
> 📖 [Full setup guide](docs/SETUP.md) · [Troubleshooting](docs/SETUP.md#troubleshooting)

---

## Features

### 25 MCP Tools

| | |
|---|---|
| **Memory** | `memorix_store` · `memorix_search` · `memorix_detail` · `memorix_timeline` — 3-layer progressive disclosure with ~10x token savings |
| **Sessions** | `memorix_session_start` · `memorix_session_end` · `memorix_session_context` — auto-inject previous context on new sessions |
| **Knowledge Graph** | `create_entities` · `create_relations` · `add_observations` · `search_nodes` · `open_nodes` · `read_graph` — [MCP Official Memory Server](https://github.com/modelcontextprotocol/servers/tree/main/src/memory) compatible |
| **Workspace Sync** | `memorix_workspace_sync` · `memorix_rules_sync` · `memorix_skills` — migrate MCP configs, rules, and skills across 9 agents |
| **Maintenance** | `memorix_retention` · `memorix_consolidate` · `memorix_export` · `memorix_import` — decay scoring, dedup, backup |
| **Dashboard** | `memorix_dashboard` — web UI with D3.js knowledge graph, observation browser, retention panel |

### 9 Observation Types

🎯 session-request · 🔴 gotcha · 🟡 problem-solution · 🔵 how-it-works · 🟢 what-changed · 🟣 discovery · 🟠 why-it-exists · 🟤 decision · ⚖️ trade-off

### Auto-Memory Hooks

```bash
memorix hooks install
```

Captures decisions, errors, and gotchas automatically. Pattern detection in English + Chinese. Smart filtering (30s cooldown, skips trivial commands). Injects high-value memories at session start.

### Hybrid Search

BM25 fulltext out of the box (~50MB RAM). Semantic search is **opt-in** to minimize resource usage:

```bash
# Enable semantic search (optional — requires 300-500MB RAM)
# Set in your MCP config env, or export before starting:
MEMORIX_EMBEDDING=fastembed    # ONNX, fastest (~300MB)
MEMORIX_EMBEDDING=transformers # Pure JS (~500MB)
MEMORIX_EMBEDDING=off          # Default — BM25 only, minimal resources
```

Install the provider you chose:
```bash
npm install -g fastembed              # for MEMORIX_EMBEDDING=fastembed
npm install -g @huggingface/transformers  # for MEMORIX_EMBEDDING=transformers
```

Both run 100% locally. Zero API calls.

### LLM Enhanced Mode (Optional)

Enable intelligent memory deduplication and fact extraction with your own API key:

```bash
# Set in your MCP config env, or export before starting:
MEMORIX_LLM_API_KEY=sk-xxx          # OpenAI-compatible API key
MEMORIX_LLM_PROVIDER=openai         # openai | anthropic | openrouter
MEMORIX_LLM_MODEL=gpt-4o-mini       # model name
MEMORIX_LLM_BASE_URL=https://...    # custom endpoint (optional)
```

Or use existing env vars — Memorix auto-detects:
- `OPENAI_API_KEY` → OpenAI
- `ANTHROPIC_API_KEY` → Anthropic  
- `OPENROUTER_API_KEY` → OpenRouter

**Without LLM**: Free heuristic deduplication (similarity-based)  
**With LLM**: Smart merge, fact extraction, contradiction detection

### Interactive CLI

```bash
memorix              # Interactive menu (no args)
memorix status       # Project info + stats
memorix dashboard    # Web UI at localhost:3210
memorix hooks install # Auto-capture for IDEs
```

---

## How It Works

```
┌─────────┐  ┌───────────┐  ┌────────────┐  ┌───────┐  ┌──────────┐
│ Cursor  │  │ Claude    │  │ Windsurf   │  │ Codex │  │ +4 more  │
│         │  │ Code      │  │            │  │       │  │          │
└────┬────┘  └─────┬─────┘  └─────┬──────┘  └───┬───┘  └────┬─────┘
     │             │              │              │           │
     └─────────────┴──────┬───────┴──────────────┴───────────┘
                          │ MCP (stdio)
                   ┌──────┴──────┐
                   │   Memorix   │
                   │  MCP Server │
                   └──────┬──────┘
                          │
          ┌───────────────┼───────────────┐
          │               │               │
   ┌──────┴──────┐ ┌──────┴──────┐ ┌──────┴──────┐
   │   Orama     │ │  Knowledge  │ │  Rules &    │
   │ Search      │ │  Graph      │ │  Workspace  │
   │ (BM25+Vec)  │ │  (Entities) │ │  Sync       │
   └─────────────┘ └─────────────┘ └─────────────┘
                          │
                   ~/.memorix/data/
                   (100% local, per-project isolation)
```

- **Project isolation** — auto-detected from `git remote`, scoped search by default
- **Shared storage** — all agents read/write the same `~/.memorix/data/`, cross-IDE by design
- **Token efficient** — 3-layer progressive disclosure: search → timeline → detail

---

## Comparison

| | [Mem0](https://github.com/mem0ai/mem0) | [mcp-memory-service](https://github.com/doobidoo/mcp-memory-service) | **Memorix** |
|---|---|---|---|
| **Agents** | SDK-based | 13+ (MCP) | **9 agents (MCP)** |
| **Cross-agent workspace sync** | — | — | **MCP configs, rules, skills, workflows** |
| **Knowledge graph** | — | Yes | **Yes (MCP Official compatible)** |
| **Hybrid search** | — | Yes | **Yes (BM25 + vector)** |
| **Token-efficient retrieval** | — | — | **3-layer progressive disclosure** |
| **Auto-memory hooks** | — | — | **Yes (multi-language pattern detection)** |
| **Memory decay** | — | Yes | **Yes (exponential + immunity)** |
| **Web dashboard** | Cloud | Yes | **Yes (D3.js graph)** |
| **Privacy** | Cloud | Local | **100% local** |
| **Cost** | Per-call | $0 | **$0** |

---

## Development

```bash
git clone https://github.com/AVIDS2/memorix.git
cd memorix && npm install

npm run dev       # watch mode
npm test          # 534 tests
npm run build     # production build
```

📚 [Architecture](docs/ARCHITECTURE.md) · [API Reference](docs/API_REFERENCE.md) · [Modules](docs/MODULES.md) · [Design Decisions](docs/DESIGN_DECISIONS.md)

> For AI systems: [`llms.txt`](llms.txt) · [`llms-full.txt`](llms-full.txt)

---

## Acknowledgements

Built on ideas from [mcp-memory-service](https://github.com/doobidoo/mcp-memory-service), [MemCP](https://github.com/maydali28/memcp), [claude-mem](https://github.com/anthropics/claude-code), and [Mem0](https://github.com/mem0ai/mem0).

## License

[Apache 2.0](LICENSE)

---

<p align="center">
  <sub>Built by <a href="https://github.com/AVIDS2">AVIDS2</a> · Star ⭐ if it helps your workflow</sub>
</p>
