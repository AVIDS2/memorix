# Setup Guide

Memorix is an open-source cross-agent memory layer for coding agents via MCP, with tiered support for Cursor, Claude Code, Windsurf (★ core), GitHub Copilot, Kiro, Codex (◆ extended), and Gemini CLI, OpenCode, Antigravity, Trae (○ community).

Memorix has four common operator entry points:

- `memorix` for the interactive local workbench in a TTY
- `memorix serve` for stdio MCP integrations
- `memorix background start` for the recommended long-lived HTTP control plane
- `memorix serve-http --port 3211` for foreground HTTP MCP, debugging, and manual supervision

The two server runtime modes are:

- `memorix serve` for stdio MCP integrations
- `memorix background start` or `memorix serve-http --port 3211` for HTTP MCP, the dashboard, and collaboration features

For the smoothest multi-project setup, use `memorix background start` as the main control plane. Use `memorix serve` when an IDE specifically wants a stdio MCP server process.

## Current Release Context

This guide targets the **1.0.8** working release line.

If you are setting up Memorix on a fresh machine or upgrading from an older install, the most visible operator-facing changes in 1.0.8 are:

- provenance-aware memory fields and layered retrieval surfaces
- stronger evidence semantics and citation-lite compact output
- task-line scoping plus secret-safe storage/retrieval behavior
- attribution auditing, retention explainability, and a cleaner remediation loop
- OpenCode compaction using structured continuation context and `post_compact`
- official Docker deployment for the HTTP control plane

### Support Tiers

| Tier | Clients | Meaning |
|------|---------|---------|
| ★ Core | Claude Code, Cursor, Windsurf | Full hook integration + tested MCP + rules sync |
| ◆ Extended | GitHub Copilot, Kiro, Codex | Hook integration with platform caveats |
| ○ Community | Gemini CLI, OpenCode, Antigravity, Trae | Best-effort hooks, community-reported compatibility |

**Install ≠ runtime-ready.** `memorix hooks install` succeeds when config files are written to disk; whether the agent actually loads and executes those hooks at runtime depends on the agent's own behavior. Core-tier agents are verified end-to-end; extended/community may have gaps.

---

## 1. Install and Initialize

Install Memorix globally:

```bash
npm install -g memorix
```

Initialize Memorix:

```bash
memorix init
```

The init wizard lets you choose between:

- `Global defaults` for personal multi-project workflows
- `Project config` for repo-specific overrides

Memorix then creates the two-file setup it is built around:

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

### Option B: HTTP MCP + Dashboard

```bash
memorix background start
```

This mode gives you:

- HTTP MCP endpoint at `http://localhost:3211/mcp`
- dashboard at `http://localhost:3211`
- Team and collaboration features
- a single long-lived Memorix process shared by multiple agents

Companion commands:

```bash
memorix background status
memorix background logs
memorix background stop
```

Startup note:

- `serve-http` seeds its default project root from `--cwd` -> `MEMORIX_PROJECT_ROOT` -> `~/.memorix/last-project-root` -> `process.cwd()`
- this helps the dashboard and control plane start in a sensible project even before any agent binds explicitly
- in multi-session workflows, agents should still call `memorix_session_start(projectRoot=...)` to avoid cross-project drift
- HTTP MCP sessions idle out after 30 minutes by default. For clients that do not transparently recover from stale HTTP session IDs, set `MEMORIX_SESSION_TIMEOUT_MS` before starting the control plane, for example `MEMORIX_SESSION_TIMEOUT_MS=86400000` for 24 hours.

Use `memorix serve-http --port 3211` when you want the same HTTP control plane in the foreground for debugging, manual supervision, or a custom port.

Important for multi-project usage:

- In HTTP control-plane mode, agents should call `memorix_session_start` with `projectRoot` set to the **absolute path of the current workspace or repo root** when that path is available.
- `projectRoot` is a detection anchor only; Git remains the source of truth for the final project identity.
- If the client cannot provide a reliable workspace path, Memorix should fail closed rather than silently inventing an `untracked/*` project.

Recommended when:

- you want to use the dashboard regularly
- you want Team tools to work
- you want multiple IDEs or agents to talk to one Memorix instance

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

Some clients use a different key than `transport`. The per-client examples below show the exact shape where that differs.

### Option C: Dockerized HTTP Control Plane

If you want Memorix as a long-lived containerized control plane:

```bash
docker compose up --build -d
```

This repo now ships:

- an official `Dockerfile`
- an example `compose.yaml`
- a healthchecked HTTP deployment on port `3211`

Docker mode is for:

- `memorix serve-http`
- dashboard access
- HTTP MCP clients pointing at `http://localhost:3211/mcp`

It is not a containerized form of stdio MCP.

Important path truth:

- project-scoped Git/config behavior only works when the container can see the repo path it is asked to bind
- if you run Memorix in Docker on a different machine than your IDE, you must mount the relevant repos into the container or accept reduced project-scoped semantics

See [DOCKER.md](DOCKER.md) for the full deployment guide.

---

## 3. MCP Config by Client

If you want Memorix to generate IDE-specific dot files, install them explicitly:

```bash
memorix integrate --agent cursor
memorix integrate --agent windsurf
memorix integrate --agent opencode
```

This keeps the default experience MCP-first and zero-write until you opt into a specific IDE integration.

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

If you use the HTTP control plane and your client supports workspace-aware prompts or rules, make sure it calls `memorix_session_start` with the current workspace absolute path as `projectRoot`.

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

For Windsurf-like HTTP clients, pair the MCP URL with agent instructions that pass the current workspace absolute path as `projectRoot` when starting a Memorix session.

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

For Codex-like HTTP clients, the transport URL alone is not enough for multi-project parallel work. The agent should also call `memorix_session_start` with the current workspace absolute path as `projectRoot`.

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

This is the dashboard served by the HTTP control plane. In normal use, start it with `memorix background start`; use `memorix serve-http` when you want the same service in the foreground.

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
memorix background start
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
memorix background start
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

### Codex stale HTTP session after idle time

If Codex is connected to `http://localhost:3211/mcp` and fails after a long idle period with a transport/body decoding error, the HTTP session may have expired server-side. Memorix defaults to a 30-minute HTTP session idle timeout. Increase it before starting the background control plane:

```powershell
$env:MEMORIX_SESSION_TIMEOUT_MS = "86400000" # 24h
memorix background restart
```

This keeps the default safe for normal users while giving long-running Codex HTTP sessions a practical recovery knob.

### Project detection is wrong

Memorix identifies projects from Git. If an IDE launches from a system directory or does not pass the workspace root correctly:

- prefer opening the repository root in the IDE
- if needed, set `MEMORIX_PROJECT_ROOT`
- use `memorix status` to inspect the active project identity

### Dashboard Team page says HTTP transport is required

That means you are using the standalone dashboard, not the HTTP control plane.

Use:

```bash
memorix background start
```

or, if you want it in the foreground:

```bash
memorix serve-http --port 3211
```

Then open:

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
