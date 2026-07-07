# Setup Guide

Memorix is a local-first shared memory layer for AI coding agents.

In the 1.1 line, the normal path is:

```bash
npm install -g memorix
memorix init --global
memorix setup --agent <agent> --global
```

`memorix setup` installs the recommended Memorix integration for the target agent: plugin packages where supported, MCP config, usage guidance, hooks, and skills.
With `--global`, it writes the user-level integrations the host supports. Run the same command inside a repo without `--global` only when you intentionally want repo-local guidance, rules, or hooks for that project.

Common runtime entry points:

| Entry | Use it for |
| --- | --- |
| `memorix setup --agent <agent> --global` | one-command user-level agent integration |
| `memorix` CLI commands | direct workflows: setup, search/store, Git Memory, import/export, dashboard, diagnostics, orchestration, and automation |
| `memorix serve` | stdio MCP server for IDEs and coding agents; defaults to a compact `micro` tool profile |
| `memorix background start` | long-lived HTTP MCP service plus dashboard |
| `memorix serve-http --port 3211` | foreground HTTP MCP for debugging or supervised launches |
| `memorix` / `memcode` | bundled terminal agent that uses the same Memorix memory pool |

Most users should start with `memorix setup --agent <agent> --global`. Use raw `memorix serve` only when you are wiring an MCP client manually. Use HTTP when you intentionally want one shared background process, browser dashboard, Docker deployment, or multiple clients using the same MCP endpoint. Use the CLI for manual operation and automation. Use memcode when you want the bundled terminal agent.

For agent-specific plugin, rules, hooks, and skills support, see [INTEGRATIONS.md](INTEGRATIONS.md).

---

## 1. Requirements

- Node.js `>=22.18.0`
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

Initialize global defaults (optional):

```bash
memorix init --global
```

Install an agent integration:

```bash
memorix setup --agent claude --global
memorix setup --agent codex --global
memorix setup --agent copilot --global
memorix setup --agent cursor --global
memorix setup --agent pi --global
memorix setup --agent gemini-cli --global
memorix setup --agent opencode --global
memorix setup --agent openclaw --global
memorix setup --agent hermes --global
memorix setup --agent omp --global
```

What this does:

- Claude Code: installs a local marketplace plugin, attempts `claude plugin install memorix@memorix-local`, and writes `CLAUDE.md` guidance.
- Codex: installs a local Personal marketplace plugin, attempts `codex plugin add memorix@personal`, and writes `AGENTS.md` guidance.
- GitHub Copilot CLI: installs a local plugin package and attempts `copilot plugin install <local-path>`.
- Cursor: writes Cursor MCP config, rules, skills, and hook guidance.
- Pi: installs the user-level Memorix Pi package and attempts `pi install <path> --approve`.
- Gemini CLI: installs a local extension package under `~/.gemini/extensions/memorix` with MCP, `GEMINI.md`, hooks, commands, and skills. Antigravity CLI has an official Gemini CLI migration path, but Memorix keeps Gemini CLI as its own active standalone target.
- OpenCode: installs a local plugin file, OpenCode skill, MCP config, and `AGENTS.md` guidance.
- Antigravity: installs a native plugin under `~/.gemini/config/plugins/memorix` for global setup or `.agents/plugins/memorix` for workspace setup. The plugin bundles `plugin.json`, `mcp_config.json`, `hooks.json`, rules, and skills.
- OpenClaw: installs `~/.openclaw/extensions/memorix` as an OpenClaw-compatible bundle with bundled stdio MCP, skills, and an OpenClaw `HOOK.md`/`handler.ts` hook pack.
- Hermes Agent: installs into Hermes home (`%LOCALAPPDATA%\hermes` on native Windows, `~/.hermes` elsewhere, or `HERMES_HOME`), enables it in `config.yaml`, registers plugin hooks, a slash command, a CLI command, skills, and writes MCP config in `mcp_servers`.
- Oh-my-Pi: installs an `omp.extensions` package, links it with `omp plugin link <path>` when available, and writes `.omp/mcp.json` or `~/.omp/agent/mcp.json` for MCP.
- Other supported agents: writes their MCP/rules/hooks files according to agent support.

Global setup writes user-level plugin, config, and hook files where the host supports them. Use the same command without `--global` only when you explicitly want repo-local guidance, rules, or hooks for the current project.

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
memorix doctor agents --agent <agent>
```

---

## 3. Choose Your Runtime

### Option A: setup for existing agents

```bash
memorix setup --agent <agent> --global
```

Use this for Claude Code, Codex, Cursor, Windsurf, Copilot, Gemini CLI, OpenCode, OpenClaw, Hermes Agent, Oh-my-Pi, Pi, Kiro, Antigravity, Trae, or any supported agent. It is the default user-facing install path.

To see the current setup matrix:

```bash
memorix setup --list
```

If an agent does not naturally see or use Memorix after setup, inspect the integration layer:

```bash
memorix doctor agents --agent <agent>
memorix repair agents --agent <agent>
```

The doctor checks Memorix-owned MCP entries and guidance files for stale command paths, missing `memorix` MCP servers, missing Claude `alwaysLoad`, and outdated Memory Autopilot rules.

### Option B: manual stdio MCP

```bash
memorix serve
```

Use this when your agent only needs a raw local stdio MCP process or you are debugging a manual config. The agent starts `memorix serve` and communicates with it over stdio.

The stdio server defaults to `--mode micro`, which exposes 7 high-signal tools so agent context is not crowded by rarely used schemas. Use `memorix serve --mode lite` for the extended solo memory surface, `--mode team` for coordination tools, or `--mode full` for advanced and MCP Memory compatibility tools.

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

### Option C: memcode terminal agent

```bash
memorix
# or
memcode
```

Use this when you want a terminal coding agent with Memorix memory already wired in. memcode can read, edit, run commands, resume sessions, switch models, and search/store shared project memory. It uses the same project memory pool as MCP-connected agents.

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

### Option D: HTTP MCP + dashboard

```bash
memorix background start
```

This starts a local background service:

- dashboard: `http://localhost:3211`
- MCP endpoint: `http://localhost:3211/mcp`
- health: `http://localhost:3211/health`

HTTP mode is for a shared process. It is useful when multiple clients should connect to one Memorix endpoint, when you want the browser dashboard, or when running Memorix through Docker. It is not needed for the normal one-agent stdio MCP setup.

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

### Option E: Docker HTTP service

```bash
docker compose up --build -d
```

Docker support is for `serve-http`, dashboard, and HTTP MCP. It is not a containerized version of stdio MCP.

See [DOCKER.md](DOCKER.md).

---

## 4. Manual MCP Client Setup

Use this section when `memorix setup --agent <agent> --global` is not available for the target agent, or when you intentionally want to manage MCP configuration yourself.

### Claude Code fallback

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

### Codex fallback

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

### Pi

Pi uses its package system instead of a separate Memorix MCP config lane:

```bash
memorix setup --agent pi --global
```

This writes the user-level Memorix Pi package and registers it with:

```bash
pi install ~/.pi/agent/packages/memorix --approve
```

Check the loaded package resources with:

```bash
pi config --approve
```

You should see the Memorix extension and the official Memorix skills listed under the Pi package.

### Gemini CLI, OpenCode, Antigravity, Trae, OpenClaw, Hermes Agent, Oh-my-Pi, and other MCP clients

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

OpenCode can also use a local Memorix plugin generated by setup:

```bash
memorix setup --agent opencode --global
```

This writes the OpenCode plugin, skills, MCP config, and `AGENTS.md` guidance in the selected scope.

Antigravity setup installs a native plugin at `~/.gemini/config/plugins/memorix` for global setup or `.agents/plugins/memorix` for workspace setup. The plugin includes stdio MCP, official hooks, rules, and skills:

```bash
memorix setup --agent antigravity --global
```

OpenClaw setup installs a compatible bundle at `~/.openclaw/extensions/memorix`, then best-effort runs `openclaw plugins install <path> --force` and `openclaw hooks enable memorix`. The bundle includes stdio MCP, skills, and an OpenClaw `HOOK.md`/`handler.ts` hook pack:

```bash
memorix setup --agent openclaw --global
```

Hermes Agent setup installs `plugins/memorix` under Hermes home (`%LOCALAPPDATA%\hermes` on native Windows, `~/.hermes` elsewhere, or `HERMES_HOME`), enables it in `config.yaml`, registers hooks/commands/skills through the plugin, and writes `mcp_servers.memorix`:

```bash
memorix setup --agent hermes --global
```

Oh-my-Pi setup installs an `omp.extensions` package, best-effort runs `omp plugin link <path>`, and writes `.omp/mcp.json` for repo-local setup or `~/.omp/agent/mcp.json` with `--global`:

```bash
memorix setup --agent omp --global
```

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
| `[agent]` | model used by memcode while coding |
| `[memory.llm]` | memory formation, summaries, deduplication, optional rerank |
| `[embedding]` | semantic/vector search |
| `[memory]` | memory injection and formation behavior |
| `[git]` | Git Memory hook and ingestion behavior |
| `[server]` | server, dashboard, and port defaults |

See [CONFIGURATION.md](CONFIGURATION.md) for the full model and compatibility behavior.

---

## 6. Common Workflows

### Terminal coding with memory

```bash
cd your-repo
memorix
/memory status
```

### Store and search a memory from the CLI

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

### Run orchestrated subagent work

`memorix orchestrate` coordinates task context, handoffs, advisory locks, verification, and review loops for subagent-style work. You don't need it for normal memory use.

```bash
memorix task list
memorix orchestrate --goal "Add user authentication"
```

Worktree behavior:

- single-worker runs use the current checkout by default
- multi-worker runs create task worktrees under `.worktrees/`
- worktree creation failures stop the run instead of falling back to the shared checkout
- dirty Git worktrees are rejected by default
- successful task worktrees are merged back automatically unless `--no-auto-merge` is set

Useful safety flags:

```bash
memorix orchestrate --goal "Add auth" --isolated
memorix orchestrate --goal "Add auth" --no-worktree
memorix orchestrate --goal "Add auth" --allow-dirty
memorix orchestrate --goal "Add auth" --no-auto-merge
```

Use the `team`, `task`, `message`, `handoff`, and `lock` CLI commands when you need to inspect or operate that coordination state directly.

---

## 7. Troubleshooting

### `memorix` opens memcode

That is expected in the 1.1 line. Use `memorix --help` to see the full CLI and `memorix serve` for MCP.

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
| Gemini CLI | `~/.gemini/settings.json` |
| Antigravity | `~/.gemini/config/mcp_config.json`, `~/.gemini/config/hooks.json`, or plugin files under `~/.gemini/config/plugins/memorix` |
| OpenClaw | `~/.openclaw/openclaw.json` |
| Hermes Agent | `%LOCALAPPDATA%\hermes\config.yaml` on native Windows, `~/.hermes/config.yaml` elsewhere, or `HERMES_HOME\config.yaml` |
| Oh-my-Pi | `.omp/mcp.json` or `~/.omp/agent/mcp.json` |
| Trae | `%APPDATA%/Trae/User/mcp.json` on Windows |

---

## 9. Related Docs

- [Configuration Guide](CONFIGURATION.md)
- [Integration Surfaces](INTEGRATIONS.md)
- [memcode](MEMCODE.md)
- [API Reference](API_REFERENCE.md)
- [Git Memory Guide](GIT_MEMORY.md)
- [Docker Guide](DOCKER.md)
- [Agent Playbook](AGENT_OPERATOR_PLAYBOOK.md)
