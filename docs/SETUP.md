# Agent Setup Guide

Memorix supports two runtime modes:

- `memorix serve` for stdio MCP integrations
- `memorix serve-http --port 3211` for HTTP MCP, the dashboard, and collaboration features on one port

For most IDE setups, start with `memorix serve`. If you want the dashboard, Team tools, or a shared HTTP endpoint for multiple agents, use `serve-http`.

---

## 1. Install and Initialize

Install Memorix globally:

```bash
npm install -g memorix
```

Initialize project config:

```bash
memorix init
```

This creates the two-file setup Memorix is built around:

- `memorix.yml` for behavior and project settings
- `.env` for secrets only

See [CONFIGURATION.md](CONFIGURATION.md) for the full model.

---

## 2. Choose a Runtime Mode

### Option A: stdio MCP

```bash
memorix serve
```

Use this when your IDE launches Memorix as a local stdio MCP server.

### Option B: HTTP MCP + Dashboard

```bash
memorix serve-http --port 3211
```

This mode gives you:

- HTTP MCP endpoint at `http://localhost:3211/mcp`
- dashboard at `http://localhost:3211`
- Team and collaboration features
- a single long-lived Memorix process shared by multiple agents

Recommended when:

- you want to use the dashboard regularly
- you want Team tools to work
- you want multiple IDEs or agents to talk to one Memorix instance

---

## 3. MCP Config by Client

### Claude Code

Recommended:

```bash
claude mcp add memorix -- memorix serve
```

Manual config example:

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

HTTP example:

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

HTTP example:

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

HTTP example:

```toml
[mcp_servers.memorix]
url = "http://localhost:3211/mcp"
```

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

### OpenCode

OpenCode integration is usually file-based and managed through Memorix hook installers or workspace sync. If you use stdio MCP directly, the same `memorix serve` command applies.

### Gemini CLI and similar clients

If the client supports stdio MCP:

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

If it supports HTTP MCP, prefer:

- `http://localhost:3211/mcp`

---

## 4. Dashboard

Recommended dashboard entry:

- `http://localhost:3211`

This is the dashboard served by `memorix serve-http` and is the main control plane.

It includes:

- Overview
- Git Memory
- Graph
- Observations
- Retention
- Sessions
- Team
- Config
- Identity Health

There is also a standalone `memorix dashboard` command, but it is best treated as a local read-mostly dashboard. Team features require HTTP transport and are only fully available in `serve-http` mode.

---

## 5. Team and Collaboration Features

Team features require HTTP transport:

```bash
memorix serve-http --port 3211
```

These features include:

- agent registry
- direct messages
- file locks
- task board

If you open the standalone dashboard and see a message saying Team features require HTTP transport, that is expected.

---

## 6. Common Setup Flows

### Minimal local setup

```bash
npm install -g memorix
memorix init
memorix serve
```

### Recommended full setup

```bash
npm install -g memorix
memorix init
memorix git-hook --force
memorix serve-http --port 3211
```

Then:

- point your IDE MCP client to `memorix serve` or `http://localhost:3211/mcp`
- open the dashboard at `http://localhost:3211`

---

## 7. Troubleshooting

### Avoid `npx`

Do not launch Memorix with `npx` in normal MCP configs. It adds startup cost and can cause handshake timeouts.

Prefer:

```bash
memorix serve
```

Not:

```bash
npx memorix serve
```

### Windsurf says the MCP config file has invalid JSON

On Windows, `~/.codeium/windsurf/mcp_config.json` must be valid JSON encoded as UTF-8 **without BOM**. A BOM at the start of the file can make Windsurf reject otherwise valid JSON.

### Codex handshake timeout

If Codex reports MCP startup timeouts, increase:

```toml
startup_timeout_sec = 30
```

or higher on slower Windows machines.

### Project detection is wrong

Memorix identifies projects from Git. If an IDE launches from a system directory or does not pass the workspace root correctly:

- prefer opening the repository root in the IDE
- if needed, set `MEMORIX_PROJECT_ROOT`
- use `memorix status` to inspect the active project identity

### Dashboard Team page says HTTP transport is required

That means you are using the standalone dashboard, not `serve-http`.

Use:

```bash
memorix serve-http --port 3211
```

and open:

- `http://localhost:3211`

### Git hook installed but commits are not appearing as memory

Check:

- the repository has Git initialized
- the hook file exists
- the commit was not filtered as noise
- the active project identity is correct

Use:

```bash
memorix status
```

and see [GIT_MEMORY.md](GIT_MEMORY.md).

---

## 8. Related Docs

- [Configuration Guide](CONFIGURATION.md)
- [Git Memory Guide](GIT_MEMORY.md)
- [Architecture](ARCHITECTURE.md)
- [API Reference](API_REFERENCE.md)
- [Development Guide](DEVELOPMENT.md)
