# Memorix Agent Operator Playbook

> Primary operating guide for coding agents that need to install, configure, bind, and use Memorix correctly.

This document is written for AI coding agents, not for human-first browsing. If you are an agent helping a user adopt Memorix, use this file as the execution guide before you attempt installation, integration, or troubleshooting.

---

## 1. What Memorix Is

Memorix is an open-source cross-agent memory layer for coding agents via MCP.

It is designed for software work, not generic chat memory. Its core value is that multiple coding agents and IDEs can share:

- **Observation Memory**: what changed, how something works, gotchas, problem-solution notes
- **Reasoning Memory**: why a decision was made, alternatives, trade-offs, risks
- **Git Memory**: structured engineering truth derived from commits

It supports:

- stdio MCP (`memorix serve`)
- HTTP control plane + dashboard (`memorix background start` or `memorix serve-http --port 3211`)
- local-first project-scoped memory
- cross-agent recall across Cursor, Claude Code, Codex, Windsurf, Gemini CLI, GitHub Copilot, Kiro, OpenCode, Antigravity, and Trae

### 1.0.7 operator delta

If you used Memorix before `1.0.7`, the operator-visible changes worth knowing are:

- session, search, detail, and timeline now expose a clearer `L1 / L2 / L3` retrieval model
- compact evidence surfaces better distinguish repository-backed signals, synthesized analysis, and citation-lite support
- retrieval is more task-line aware inside a single repo and less likely to surface the wrong subdomain
- obvious credentials are sanitized on write and redacted on retrieval surfaces
- retention, stale review, audit, and resolve now form a clearer cleanup/remediation loop
- OpenCode compaction guidance now preserves structured continuation context without falsely implying automatic MCP tool calls

---

## 2. Operating Principles You Must Respect

### Git is the source of truth for project identity

Memorix is project-scoped by default.

Important:

- `projectRoot` is a **detection anchor**
- Git identity is the **final project identity**

If the workspace is not a Git repository:

- project-safe memory will not bind correctly
- some commands may fail closed
- the right first step is usually:

```bash
git init
```

Do not assume a plain folder path is enough.

### Choose one runtime model intentionally

There are four practical operator entry points:

- `memorix` for the interactive local workbench in a TTY
- `memorix serve` for stdio MCP hosts
- `memorix background start` for the recommended long-lived HTTP control plane
- `memorix serve-http --port 3211` for foreground HTTP control-plane work

The two server runtime modes are:

Use:

```bash
memorix serve
```

when the MCP host launches Memorix directly from the current workspace and stdio transport is enough.

Prefer:

```bash
memorix background start
```

when the user wants:

- HTTP MCP transport
- dashboard
- multiple agents or sessions
- team/task/message features
- one shared control-plane process

Use:

```bash
memorix serve-http --port 3211
```

when the user wants the same HTTP control plane in the foreground for debugging, manual supervision, or a custom port.

### In HTTP mode, always bind the project explicitly

At the beginning of a new project session, call:

```json
{
  "agent": "your-agent-name",
  "projectRoot": "ABSOLUTE_WORKSPACE_PATH"
}
```

through `memorix_session_start`.

Do not assume the HTTP connection alone tells Memorix which project the user means.

The HTTP control plane is normally started with `memorix background start`; the same project-binding rules apply when you run `memorix serve-http --port 3211` in the foreground.

### Do not confuse project config and global config

Memorix intentionally supports both:

- **project-level** settings and integrations
- **global-level** defaults

Your job as an agent is to choose the smallest scope that matches the user's goal.

---

## 3. Fastest Valid Setup

Use this path when the user wants the quickest possible adoption.

### Step 1. Install Memorix

```bash
npm install -g memorix
```

### Step 2. Ensure the workspace is a Git repo

If not:

```bash
git init
```

### Step 3. Initialize config

```bash
memorix init
```

`memorix init` is a scope selector, not just a project-local generator. It lets the user choose between:

- `Global defaults`
- `Project config`

Memorix uses:

- `memorix.yml` for behavior and project settings
- `.env` for secrets such as API keys

### Step 4. Start stdio MCP mode

If the user wants the local interactive workbench first, they can also run:

```bash
memorix
```

Use that for local browsing, commands, and quick validation in a TTY.

```bash
memorix serve
```

### Step 5. Add MCP config to the target client

Generic stdio MCP example:

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

Generic HTTP MCP example:

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

**⚠ serverUrl mode requires the background control plane to already be running.**
The `serverUrl` config is a pure HTTP client — it connects to an endpoint but does NOT start the server.
If the control plane is down, the MCP client receives `ECONNREFUSED` with no auto-recovery.

To guarantee the server is available before the IDE connects, use:

```bash
memorix background ensure
```

This command checks health and auto-starts if needed. Add it to your shell profile or IDE startup script.

Some IDEs (Windsurf, Cursor) use `serverUrl` in their MCP config and do not support preflight commands.
For those, the background must be started manually or via OS startup (see §4 Step 3b below).

If you choose HTTP mode, do not stop at the URL. The agent must also bind each project session with `memorix_session_start(projectRoot=ABSOLUTE_WORKSPACE_PATH)` when the workspace path is available.

This is the best path for:

- one workspace
- one agent/IDE
- quick validation
- minimal moving parts

---

## 4. Full Control-Plane Setup

Use this path when the user wants the full Memorix product model.

### Step 1. Install and initialize

```bash
npm install -g memorix
memorix init
```

### Step 2. Ensure Git identity exists

If needed:

```bash
git init
```

### Step 3. Start HTTP control plane

```bash
memorix background start
```

Main URLs:

- MCP endpoint: `http://localhost:3211/mcp`
- dashboard: `http://localhost:3211`

Companion commands:

```bash
memorix background status   # Show running state and health
memorix background ensure   # Auto-start if not running (idempotent, silent when healthy)
memorix background logs     # Show recent log output
memorix background stop     # Stop the background control plane
memorix background restart  # Stop + start
```

### Step 3b. Make the control plane persistent (recommended)

`memorix background start` spawns a detached process that survives the terminal, but it does **not** survive system reboots or user logouts.

The background control plane is a **persistent server** — it is designed to run continuously in the background, not to be auto-launched by MCP clients on demand.

To make it truly persistent:

**Windows** — add to shell profile (`$PROFILE`):

```powershell
memorix background ensure
```

**macOS/Linux** — add to shell profile (`.bashrc`, `.zshrc`):

```bash
memorix background ensure 2>/dev/null
```

Or use a launchd plist / systemd user service for true boot-time persistence.

**Why this matters:** IDEs that use `serverUrl` (Windsurf, Cursor HTTP mode) connect to `http://localhost:3211/mcp` but cannot start the server. If the control plane is down, the IDE shows an MCP error with no recovery path. The user must run `memorix background start` or `ensure` manually.

At startup, `serve-http` seeds its default project root from:

1. `--cwd`
2. `MEMORIX_PROJECT_ROOT`
3. `~/.memorix/last-project-root`
4. `process.cwd()`

That startup root is useful for dashboard and server boot, but it does not replace explicit session binding.

### Step 4. Bind each HTTP session explicitly

At session start, call:

```json
{
  "agent": "your-agent-name",
  "projectRoot": "ABSOLUTE_WORKSPACE_PATH"
}
```

through `memorix_session_start`.

This is the right path for:

- dashboard users
- multi-agent workflows
- team/task/message usage
- multiple concurrent sessions
- debugging project binding and config provenance

---

## 5. Agent Decision Tree

Use this routing logic when helping a user.

### If the user says:

- "I just want it working quickly"
- "I only need Cursor / Claude Code / Codex"
- "I don't care about dashboard"

Choose:

- `memorix serve`
- simple stdio MCP config

### If the user says:

- "I want dashboard"
- "I want HTTP MCP"
- "I want multiple agents / IDEs at once"
- "I want team features"

Choose:

- `memorix background start`
- explicit `memorix_session_start(projectRoot=...)`

### If the user asks for IDE integration files

Use:

```bash
memorix integrate --agent <agent>
```

This is explicit, opt-in generation.

### If the user asks for hooks

Use:

```bash
memorix hooks install --agent <agent>
```

This is also explicit and opt-in.

Do not assume the user wants every supported IDE directory generated.

---

## 6. Generated Dot Directories: What They Mean

Memorix now favors **explicit, per-agent installation**.

That means:

- it does **not** need to spray every supported `.xxx` directory into every repo
- the user or agent can select only the integrations they actually need

Important:

- many `.cursor`, `.windsurf`, `.claude`, `.gemini`, `.opencode`, etc. directories are not arbitrary clutter
- they are often part of the target IDE's own discovery protocol
- do **not** promise that all of them can be physically merged into one folder without breaking host detection

What you can say safely:

- Memorix supports **on-demand generation**
- it does **not** require generating every integration at once
- different hosts still expect their own directory or config path

---

## 7. Hooks vs Integrations

Do not confuse these.

### `memorix integrate`

Purpose:

- generate IDE/agent integration files
- write MCP config, rules, settings, or plugin files for a specific target

Typical use:

```bash
memorix integrate --agent cursor
memorix integrate --agent opencode
memorix integrate --agent gemini-cli
```

### `memorix hooks install`

Purpose:

- install auto-capture hooks for supported agents

Typical use:

```bash
memorix hooks install --agent cursor
memorix hooks install --agent opencode
```

### `memorix git-hook`

Purpose:

- install a post-commit hook in the current Git repo
- automatically ingest commits as Git Memory

Typical use:

```bash
memorix git-hook --force
```

---

## 8. What an Agent Should Do at Session Start

In HTTP control-plane mode:

1. Call `memorix_session_start`
2. Pass:
   - `agent` — display name (e.g. `"cursor-frontend"`)
   - `agentType` — agent type for auto-registration (e.g. `"windsurf"`, `"cursor"`, `"claude-code"`, `"codex"`, `"gemini-cli"`)
   - `projectRoot` = absolute workspace path
3. The agent is automatically registered in the team with a default role derived from `agentType` via `AGENT_TYPE_ROLE_MAP`. No separate `team_manage(join)` call is needed.
4. If project binding fails, stop using project-scoped tools until the path is corrected
5. Then use:
   - `memorix_search`
   - `memorix_detail`
   - `memorix_timeline`
   as needed

In stdio / project-bound mode:

- `projectRoot` is optional if the process is already launched from the correct workspace

---

## 9. Recommended Command Set for Agents

### Core runtime

```bash
memorix serve
memorix background start
memorix serve-http --port 3211
memorix doctor
memorix status
```

### Project setup

```bash
memorix init
memorix integrate --agent <agent>
memorix hooks install --agent <agent>
memorix git-hook --force
```

### Memory operations

Use MCP tools:

- `memorix_store`
- `memorix_search`
- `memorix_detail`
- `memorix_timeline`
- `memorix_resolve`
- `memorix_deduplicate`
- `memorix_store_reasoning`

---

## 10. Installation and Troubleshooting Checklist

If Memorix "doesn't work", check these in order.

### 1. Is the workspace a Git repo?

If not, run:

```bash
git init
```

### 2. Is the runtime mode correct?

- stdio MCP client -> `memorix serve`
- HTTP/dashboard/control-plane use case -> `memorix background start` by default, or `memorix serve-http --port 3211` when foreground control is required

### 3. Is the background control plane actually running?

If the MCP client reports `ECONNREFUSED` on `localhost:3211`:

```bash
memorix background status
```

If it shows "Not running" or "dead":

```bash
memorix background ensure
```

Common causes of the background dying:
- System reboot or user logout (background is not a system service)
- Unhandled error in the control plane process (now logged to `~/.memorix/background.log`)
- Terminal that started it was closed before the process fully detached (rare on Node.js v20+)

The heartbeat file `~/.memorix/background.heartbeat` is updated every 30 seconds while the control plane is alive. If `status` reports a dead process with a recent heartbeat, the control plane crashed — check the log file.

### 4. Is the MCP config pointing to the right command?

On Windows, some hosts behave better with `memorix.cmd` than bare `memorix`.

**serverUrl vs command mode:**
- `serverUrl` (HTTP) requires the background to already be running — it cannot auto-start
- `command` (stdio) launches `memorix serve` on demand — no background needed, but no dashboard/team

If using `serverUrl` and the background keeps disappearing, consider switching to stdio mode as a fallback.

### 5. In HTTP mode, did the session bind with `projectRoot`?

If not, the agent may drift into the wrong project bucket or fail closed.

### 6. Did the user install the integration they actually need?

Use:

```bash
memorix integrate --agent <agent>
memorix hooks install --agent <agent>
```

### 7. Is the generated plugin/hook stale?

OpenCode in particular now supports stale-install detection through:

```bash
memorix hooks status
```

If outdated, re-run:

```bash
memorix hooks install --agent opencode
```

### 8. Are LLM and embedding secrets configured?

Check:

- project `.env`
- user `~/.memorix/.env`
- shell-injected env vars

Use:

```bash
memorix doctor
```

to inspect active runtime status.

---

## 11. What Not to Do

Do not:

- treat `projectRoot` as the final project identity
- assume non-Git folders will behave like stable projects
- mix up stdio and HTTP guidance in the same answer
- promise that all `.xxx` integration directories can be physically merged
- tell users "auto-update is implemented" unless you mean the real wired runtime feature
- rely on stale generated plugin files when diagnosing current behavior
- assume `serverUrl` HTTP mode will auto-start the background control plane — it cannot
- tell users "just restart the IDE" when the fix is `memorix background ensure`
- promise the background control plane survives reboots without OS-level startup config

---

## 12. When This Document Should Be Read First

If a user asks any of these:

- "Install Memorix for me"
- "Set up Memorix in Cursor / Claude Code / Codex / Windsurf / OpenCode / Gemini CLI"
- "Why isn't Memorix binding to my project?"
- "Why does it fail in this workspace?"
- "How should I use serve vs serve-http?"
- "What files will this create?"
- "Why does my MCP client show ECONNREFUSED / connection refused?"
- "Why did the background control plane disappear?"

read this document first, then act.

This playbook is the canonical AI-facing operator guide for installation, project binding, integration, hooks, troubleshooting, and safe usage.
