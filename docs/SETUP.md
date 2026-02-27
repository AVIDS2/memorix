# Agent Setup Guide

Detailed MCP configuration for every supported AI coding agent.

**Prerequisites:** Install memorix globally (one-time):

```bash
npm install -g memorix
```

> Do NOT use `npx` — it re-downloads on every launch and causes MCP initialization timeout.

---

## Claude Code

**Recommended** — run in terminal:
```bash
claude mcp add memorix -- memorix serve
```

**Manual** — add to `~/.claude.json` (global) or `.claude/settings.json` (project):
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

> **Windows:** `~/.claude.json` is located at `C:\Users\<YourUsername>\.claude.json`

---

## Cursor

**Config file:** `.cursor/mcp.json` (project) or `~/.cursor/mcp.json` (global)

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

---

## Windsurf

**Config file:** `~/.codeium/windsurf/mcp_config.json`

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

---

## VS Code Copilot

**Config file:** `.vscode/mcp.json` (project) or VS Code `settings.json` (global)

`.vscode/mcp.json`:
```json
{
  "servers": {
    "memorix": {
      "command": "memorix",
      "args": ["serve"]
    }
  }
}
```

> Note: `.vscode/mcp.json` uses `"servers"` as the top-level key. VS Code `settings.json` wraps it under `"mcp": { "servers": { ... } }`.

---

## Codex

**Config file:** `~/.codex/config.toml`

```toml
[mcp_servers.memorix]
command = "memorix"
args = ["serve"]
```

---

## Kiro

**Config file:** `.kiro/settings/mcp.json` (project) or `~/.kiro/settings/mcp.json` (global)

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

---

## Antigravity

**Config file:** `~/.gemini/antigravity/mcp_config.json`

> **Important:** Antigravity uses its own install path as CWD, not your project directory. You **must** set `MEMORIX_PROJECT_ROOT`.

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

---

## Gemini CLI

**Config file:** `.gemini/settings.json` (project) or `~/.gemini/settings.json` (global)

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

---

## Optional: Vector Search

Memorix supports **hybrid search** (BM25 + semantic vectors) with automatic provider detection:

| Priority | Provider | Install | Notes |
|----------|----------|---------|-------|
| 1st | `fastembed` | `npm install -g fastembed` | Fastest, native ONNX |
| 2nd | `transformers.js` | `npm install -g @huggingface/transformers` | Pure JS/WASM |
| Fallback | Full-text (BM25) | Always available | Already very effective |

```bash
# Option A: Native speed (recommended)
npm install -g fastembed

# Option B: Universal compatibility
npm install -g @huggingface/transformers
```

- **Without either** — BM25 full-text search works great out of the box
- **With any provider** — "authentication" also matches "login flow" via semantic similarity
- Both run **locally** — zero API calls, zero privacy risk, zero cost
- The dashboard shows which provider is active in real-time

---

## Data Storage

All data is stored locally per project:

```
~/.memorix/data/<projectId>/
├── observations.json      # Structured observations
├── id-counter.txt         # Next observation ID
├── entities.jsonl         # Knowledge graph nodes
└── relations.jsonl        # Knowledge graph edges
```

- `projectId` is auto-detected from Git remote URL (e.g., `user/repo`)
- Data is shared across all agents accessing the same project
- No cloud, no API keys, no external services

---

## Troubleshooting

### npx cold start timeout
Some IDEs (especially Windsurf) have a 60-second MCP initialization timeout. If `npx` downloads the package slowly:
```json
"args": ["-y", "memorix@latest", "serve", "--cwd", "/path/to/your/project"]
```

### Windows "dubious ownership" 
Memorix v0.7.3+ automatically bypasses this with `safe.directory=*` and falls back to reading `.git/config` directly.

### Project detected as `local/<name>` instead of `owner/repo`
Update to v0.7.3+ which fixes Windows git remote detection.

### Antigravity: "Error: no tools returned"
Antigravity does not set `cwd` to your project and does not support MCP roots. Add `MEMORIX_PROJECT_ROOT` to your MCP config (see [Antigravity section](#antigravity) above).

### Project detection priority
Memorix resolves the project root in this order:
1. `--cwd` CLI argument
2. `MEMORIX_PROJECT_ROOT` environment variable
3. `INIT_CWD` (npm lifecycle)
4. `process.cwd()` (set by IDE)
5. MCP roots protocol (requested from IDE client)
6. Error with instructions

[← Back to main README](../README.md)
