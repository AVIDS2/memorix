# Setup Guide

Memorix is a local-first memory layer and native coding-agent runtime for AI software work.

In the 1.1 line, there are four common entry points:

| Entry | Use it for |
| --- | --- |
| `memorix` / `memcode` | Native memcode coding agent in your terminal |
| `memorix serve` | stdio MCP server for IDEs and coding agents |
| `memorix background start` | long-lived HTTP MCP control plane plus dashboard |
| `memorix serve-http --port 3211` | foreground HTTP MCP for debugging or supervised launches |

Most users should start with `memorix` or `memorix serve`. Use HTTP when you intentionally want one shared background process, browser dashboard, or multiple clients using the same MCP endpoint.

---

## 1. Requirements

- Node.js `>=22.19.0`
- npm
- Git

Memorix project identity comes from Git. Open or initialize a real Git repository before expecting project-scoped memory to work:

```bash
git init
```

`projectRoot` and current working directory are detection anchors. The final project identity is derived from the real Git root and remote metadata.

---

## 2. Install

```bash
npm install -g memorix
```

Initialize global or project configuration:

```bash
memorix init
```

Memorix uses TOML as the user-facing configuration model:

- `~/.memorix/config.toml` for global defaults
- `<git-root>/memorix.toml` for optional project overrides

Legacy `memorix.yml`, `.env`, and `~/.memorix/config.json` are still read for compatibility, but new setup flows use TOML.

Useful checks:

```bash
memorix --version
memcode --version
memorix status
memorix config path
```

---

## 3. Choose Your Runtime

### Option A: memcode native agent

```bash
memorix
# or
memcode
```

Use this when you want a full terminal coding agent with native Memorix memory. memcode can read, edit, run commands, resume sessions, switch models, and search/store shared project memory.

Common commands:

```bash
memcode -p "summarize this repo"
memcode -c
memcode -r
memcode --model openai/gpt-4o
```

Inside the TUI:

```text
/memory status
/memory search
/memory show
/memory hooks
/model switch
/resume
/tree
/config
```

See [MEMCODE.md](MEMCODE.md).

### Option B: stdio MCP

```bash
memorix serve
```

Use this when your IDE launches Memorix as a local stdio MCP server. This is the default path for single-client setups.

Generic stdio MCP config:

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

Avoid `npx` in persistent MCP configs. Use the globally installed `memorix` binary so startup is predictable.

### Option C: HTTP MCP + dashboard

```bash
memorix background start
```

This starts a local background control plane:

- dashboard: `http://localhost:3211`
- MCP endpoint: `http://localhost:3211/mcp`
- health: `http://localhost:3211/health`

Companion commands:

```bash
memorix background status
memorix background logs
memorix background stop
```

Use foreground HTTP mode for debugging or custom launch supervision:

```bash
memorix serve-http --port 3211
```

Generic HTTP MCP config:

```json
{
  "mcpServers": {
    "memorix": {
      "transport": "http",
      "url": "http://localhost:3211/mcp"
    }
  }
}
```

For multi-project HTTP usage, agents should call `memorix_session_start(projectRoot=...)` with the absolute workspace path when available. This prevents cross-project drift when the background service is shared.

HTTP sessions idle out after 30 minutes by default. For clients that do not recover gracefully from stale HTTP session IDs:

```powershell
$env:MEMORIX_SESSION_TIMEOUT_MS = "86400000"
memorix background restart
```

### Option D: Docker HTTP control plane

```bash
docker compose up --build -d
```

Docker support is for `serve-http`, dashboard, and HTTP MCP. It is not a containerized version of stdio MCP.

See [DOCKER.md](DOCKER.md).

---

## 4. Connect An MCP Client

### Claude Code

Recommended:

```bash
claude mcp add memorix -- memorix serve
```

Manual stdio shape:

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

### Cursor

Project config: `.cursor/mcp.json`

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

### Windsurf

Config file: `~/.codeium/windsurf/mcp_config.json`

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

HTTP variants in Windsurf-like clients may use `serverUrl`:

```json
{
  "mcpServers": {
    "memorix": {
      "serverUrl": "http://localhost:3211/mcp"
    }
  }
}
```

### Codex

Config file: `~/.codex/config.toml`

```toml
[mcp_servers.memorix]
command = "memorix"
args = ["serve"]
startup_timeout_sec = 30
```

HTTP:

```toml
[mcp_servers.memorix]
url = "http://localhost:3211/mcp"
```

For HTTP, pair the URL with agent instructions that call `memorix_session_start(projectRoot=...)` when the current workspace path is known.

### GitHub Copilot / VS Code

Project config: `.vscode/mcp.json`

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

### Kiro

Project config: `.kiro/settings/mcp.json`

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

### Gemini CLI, OpenCode, Antigravity, Trae, and other MCP clients

If the client supports stdio MCP, use:

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

If it supports HTTP MCP, use `http://localhost:3211/mcp`.

---

## 5. Configure Models And Memory

Minimal `~/.memorix/config.toml`:

```toml
[agent]
provider = "openai"
model = "gpt-4o"
api_key = "..."

[memory.llm]
provider = "openai"
model = "gpt-4o-mini"
api_key = "..."

[embedding]
provider = "auto"

[memory]
inject = "minimal"
formation = "active"
```

What each lane does:

| Lane | Used by |
| --- | --- |
| `[agent]` | memcode's coding agent model |
| `[memory.llm]` | memory formation, summaries, deduplication, optional rerank |
| `[embedding]` | semantic/vector search |
| `[memory]` | memory injection and formation behavior |
| `[git]` | Git Memory hook and ingestion behavior |
| `[server]` | server, dashboard, and port defaults |

See [CONFIGURATION.md](CONFIGURATION.md) for the full model and compatibility behavior.

---

## 6. Common Workflows

### Native coding with memory

```bash
cd your-repo
memorix
/memory status
```

### Store and search a memory from the operator CLI

```bash
memorix memory store --text "Auth tokens expire after 24h" --title "Auth token TTL" --entity auth --type decision
memorix memory search --query "auth token ttl"
```

### Capture Git Memory

```bash
memorix git-hook --force
memorix ingest log --count 20
```

### Move memory between machines

```bash
memorix transfer export --format json
memorix transfer import --data "<json export>"
```

This transfers stored memory artifacts, not private chat history from an IDE vendor.

### Run optional Agent Team workflows

Agent Team is explicit autonomous-agent/subagent coordination state. It is not required for normal memory use.

```bash
memorix team status
memorix task list
memorix orchestrate --goal "Add user authentication"
```

Join the team only when you need tasks, handoff messages, advisory locks, or a structured autonomous-agent workflow.

---

## 7. Troubleshooting

### `memorix` opens memcode

That is expected in the 1.1 line. Use `memorix --help` to see the full operator CLI and `memorix serve` for MCP.

### No project memory appears

Check:

```bash
git status
memorix status
memorix receipt --json
```

Shared memory means stored memories are searchable by clients bound to the same Git project. It does not mean raw chat transcripts are mirrored.

### Codex handshake timeout

Increase startup timeout:

```toml
[mcp_servers.memorix]
command = "memorix"
args = ["serve"]
startup_timeout_sec = 30
```

### Codex stale HTTP session after idle time

Set a longer timeout before starting the background service:

```powershell
$env:MEMORIX_SESSION_TIMEOUT_MS = "86400000"
memorix background restart
```

### Windsurf rejects MCP JSON on Windows

Ensure `~/.codeium/windsurf/mcp_config.json` is valid UTF-8 JSON without BOM.

### Project detection is wrong

- open the real repository root in your IDE
- avoid launching the agent from a system directory
- set `MEMORIX_PROJECT_ROOT` only when the client cannot pass cwd reliably
- run `memorix status` to inspect the active project identity

### Git hook installed but commits are missing

Check:

```bash
memorix status
memorix ingest commit --force
```

The commit may have been filtered as noise. See [GIT_MEMORY.md](GIT_MEMORY.md).

---

## 8. Uninstall

Preview:

```bash
memorix uninstall --dry-run
```

Stop background service and remove hooks:

```bash
memorix uninstall --background --hooks
```

Then remove the npm package:

```bash
npm uninstall -g memorix
```

Full local data purge:

```bash
memorix uninstall --dry-run --purge-data
memorix uninstall --yes --background --hooks --purge-data
npm uninstall -g memorix
```

`--purge-data` deletes local Memorix data under `~/.memorix`, including memories, sessions, mini-skills, logs, and config. Use `--dry-run` first.

Memorix does not silently edit all MCP config files during uninstall. It reports remaining entries and shows where to remove them manually.

Common MCP config locations:

| Agent | Config file |
| --- | --- |
| Claude Code | `~/.claude.json` or `.claude/settings.json` |
| Cursor | `~/.cursor/mcp.json` or `.cursor/mcp.json` |
| Windsurf | `~/.codeium/windsurf/mcp_config.json` |
| Codex | `~/.codex/config.toml` |
| VS Code / Copilot | `.vscode/mcp.json` |
| Kiro | `~/.kiro/settings/mcp.json` or `.kiro/settings/mcp.json` |
| Gemini CLI / Antigravity | `~/.gemini/settings.json` |
| Trae | `%APPDATA%/Trae/User/mcp.json` on Windows |

---

## 9. Related Docs

- [Configuration Guide](CONFIGURATION.md)
- [memcode](MEMCODE.md)
- [API Reference](API_REFERENCE.md)
- [Git Memory Guide](GIT_MEMORY.md)
- [Docker Guide](DOCKER.md)
- [Agent Operator Playbook](AGENT_OPERATOR_PLAYBOOK.md)
