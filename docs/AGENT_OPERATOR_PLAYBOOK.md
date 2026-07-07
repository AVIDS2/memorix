# Memorix Agent Playbook

> Primary operating guide for coding agents that need to install, configure, bind, and use Memorix correctly.

This document is written for AI coding agents, not for human-first browsing. If you are an agent helping a user adopt Memorix, use this file as the execution guide before you attempt installation, integration, or troubleshooting.

---

## 1. What Memorix Is

Memorix is a local-first shared memory layer for AI software work.

It is designed for software work, not generic chat memory. Its core value is that multiple coding agents and IDEs can share:

- **Observation Memory**: what changed, how something works, gotchas, problem-solution notes
- **Reasoning Memory**: why a decision was made, alternatives, trade-offs, risks
- **Git Memory**: structured engineering truth derived from commits

It supports:

- agent setup packages (`memorix setup --agent <agent> --global`)
- stdio MCP (`memorix serve`)
- HTTP MCP service + dashboard (`memorix background start` or `memorix serve-http --port 3211`)
- bundled terminal agent (`memorix` or `memcode`) that uses the same shared memory pool
- local-first project-scoped memory
- cross-agent recall across Cursor, Claude Code, Codex, Windsurf, Gemini CLI, GitHub Copilot, OpenCode, OpenClaw, Hermes Agent, Oh-my-Pi, Pi, Kiro, Antigravity, and Trae

### Current 1.1 Baseline

For the 1.1 release line, the visible product shape is:

- `memorix setup --agent <agent> --global` is the default integration command for an existing coding agent or IDE
- setup installs plugin packages where supported, MCP config, usage guidance, hooks, and skills according to agent capability
- `memorix serve` remains the stdio MCP entry for IDEs and external agents; it defaults to the compact `micro` tool profile to avoid flooding agent context
- `memorix background start` and `memorix serve-http --port 3211` run the HTTP MCP service and dashboard
- `memorix` / `memcode` open memcode, the bundled terminal agent
- configuration is TOML-first: global `~/.memorix/config.toml`, project `<git-root>/memorix.toml`
- model lanes are separate: `[memory.llm]` for formation/rerank/summaries, `[embedding]` for semantic search, `[agent]` for the model memcode talks to while coding
- legacy `memorix.yml`, `.env`, and `~/.memorix/config.json` are compatibility inputs, not the recommended setup path
- generated agent rules treat `memorix_session_start` as optional unless explicit session semantics matter
- integration surfaces are agent-specific: Claude Code, Codex, GitHub Copilot CLI, Antigravity, and Hermes receive plugin packages; OpenClaw receives a compatible bundle; Pi and Oh-my-Pi receive package entries; Gemini CLI receives an extension package; OpenCode receives a plugin file and skill; Cursor and other agents receive MCP/rules/hooks where supported
- privacy-safe diagnostics and receipts avoid raw chat, memory text, query text, tool payloads, and local file paths

---

## 2. Operating Principles You Must Respect

### CLI is the direct command surface; MCP is the integration layer

For direct use, prefer `memorix ...` commands first. In the 1.1 line, the CLI covers session, memory, reasoning, retention, formation, audit, transfer, skills, orchestration coordination, sync, ingest workflows, and the bundled terminal agent.

Do not ask memory-only users to join coordination state. A lightweight session is enough for memory, retrieval, reasoning, and continuation. Use `joinTeam` / `team_manage(join)` only for explicit task/message/lock coordination or for CLI-agent work managed by `memorix orchestrate`.

Use MCP when:

- an IDE or agent needs tool calls
- you are integrating Memorix into an MCP-capable client
- you need the optional graph-compatibility tools that intentionally remain MCP-only

Use the CLI when:

- a human is operating Memorix directly
- you are on SSH / Docker / CI / NAS and want direct control
- you want readable, stable command namespaces instead of raw tool payloads

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

There are four practical entry points:

- `memorix setup --agent <agent> --global` for installing Memorix into an existing agent
- `memorix serve` for stdio MCP agents
- `memorix background start` for an optional long-lived HTTP service
- `memorix serve-http --port 3211` for foreground HTTP service work
- `memorix` / `memcode` for the bundled terminal agent in a TTY

For most agent integrations, use:

```bash
memorix setup --agent <agent> --global
```

This installs the recommended integration package or config for that agent. Use raw `memorix serve` only when manually wiring an MCP client.

The two server runtime modes are:

Use:

```bash
memorix serve
```

when the MCP client launches Memorix directly from the current workspace and stdio transport is enough.

Stdio MCP defaults to `--mode micro` and exposes only the core project-context/search/detail/store tools. Use `--mode lite` for sessions, timeline, reasoning, transfer, and retention tools; `--mode team` for coordination tools; and `--mode full` only for advanced or compatibility surfaces.

Prefer:

```bash
memorix background start
```

when the user wants:

- HTTP MCP transport
- dashboard
- multiple agents or sessions
- explicit task/message/handoff/lock coordination
- one shared HTTP service process

Default recommendation: if the user wants memory inside an existing IDE or agent, start with `memorix setup --agent <agent> --global`. Use `memorix serve` only for manual MCP wiring. Use the CLI for direct workflows and automation because it does not depend on an IDE's MCP session lifecycle. Use memcode only when the user wants the bundled terminal agent. Reach for HTTP only when a shared background service, multi-client MCP access, Docker, or a live dashboard endpoint is actually needed.

Use:

```bash
memorix serve-http --port 3211
```

when the user wants the same HTTP service in the foreground for debugging, manual supervision, or a custom port.

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

The HTTP service is normally started with `memorix background start`; the same project-binding rules apply when you run `memorix serve-http --port 3211` in the foreground.

HTTP MCP sessions idle out after 30 minutes by default. If the user's HTTP MCP client is sensitive to stale session IDs after long idle periods, set `MEMORIX_SESSION_TIMEOUT_MS` before starting or restarting the service. Example: `MEMORIX_SESSION_TIMEOUT_MS=86400000` keeps sessions alive for 24 hours.

### Do not confuse project config and global config

Memorix intentionally supports both:

- **project-level** settings and integrations
- **global-level** defaults

Your job as an agent is to choose the smallest scope that matches the user's goal.

Generated guidance must match that scope:

- Project guidance may say "this repository/project" because it lives in the repo or workspace.
- Global/plugin skill guidance must not say "this project uses Memorix." It should say "use Memorix when the active workspace has Memorix tools available."
- Do not install or document a fake plugin surface for agents that only expose MCP/rules/config. Use the agent's official entry point.

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
memorix init --global
```

`memorix init` is a scope selector, not just a project config generator. It lets the user choose between:

- `Global defaults`
- `Project config`

Memorix writes TOML by default:

- global defaults: `~/.memorix/config.toml`
- project overrides: `<git-root>/memorix.toml`

Use global config for personal provider credentials. Use project config for repo-specific model choices, memory behavior, server defaults, and Git Memory settings. Do not commit secrets.

### Step 4. Install the agent integration

For an existing agent or IDE:

```bash
memorix setup --agent <agent> --global
```

Examples:

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

What this installs depends on the target agent:

- Claude Code: local `memorix-local` marketplace plugin, best-effort `claude plugin install memorix@memorix-local`, plugin-bundled stdio MCP, hooks, skills, plus `CLAUDE.md` guidance.
- Codex: local Personal marketplace plugin under `~/.codex/plugins/memorix`, marketplace entry at `~/.agents/plugins/marketplace.json`, best-effort `codex plugin add memorix@personal`, plugin-bundled stdio MCP, hooks, skills, plus `AGENTS.md` guidance.
- GitHub Copilot CLI: local plugin package under `~/.copilot/plugins/local/memorix`, best-effort `copilot plugin install <local-path>`, plugin-bundled stdio MCP, hooks, and skills.
- Cursor: Cursor MCP config, `.cursor/rules/memorix.mdc`, skills, and hook guidance through Cursor's project config surfaces.
- Pi: user Pi package with extension-based hook capture and a Memorix skill, registered through `pi install <path> --approve`; project-local setup uses `-l`.
- Gemini CLI: local extension package under `~/.gemini/extensions/memorix`, extension-bundled stdio MCP, `GEMINI.md` context, hooks, commands, and skills. Antigravity CLI has an official Gemini CLI migration path, but Gemini CLI remains a separate target.
- OpenCode: local plugin file, `opencode.json` MCP config, OpenCode skill, plus `AGENTS.md` guidance.
- Antigravity: native plugin under `~/.gemini/config/plugins/memorix` or `.agents/plugins/memorix`, with `plugin.json`, `mcp_config.json`, `hooks.json`, rules, and skills.
- OpenClaw: OpenClaw-compatible bundle under `~/.openclaw/extensions/memorix`, bundled `.mcp.json`, skills, and OpenClaw `HOOK.md`/`handler.ts` hook pack.
- Hermes Agent: Hermes plugin under Hermes home (`%LOCALAPPDATA%\hermes` on native Windows, `~/.hermes` elsewhere, or `HERMES_HOME`), enabled in `config.yaml`, with plugin hooks, slash command, CLI command, skills, and MCP config.
- Oh-my-Pi: `omp.extensions` package linked through `omp plugin link <path>` when available, with extension hook events, a `memorix` command, skills, and MCP config.
- Windsurf, Kiro, Trae: MCP config plus rules/hooks where supported.

Run the same setup command without `--global` only when you intentionally want repo-local guidance, rules, or hooks for a single Git project.

If the user wants the bundled terminal agent:

```bash
memorix
```

This opens the memcode TUI. It uses the same Memorix memory pool as MCP-connected agents. Useful slash commands include:

```text
/help
/model switch
/memory status
/memory search
/memory show
/memory hooks
/resume
/tree
/fork
/git status
/git diff
/config
```

### Step 5. Manual MCP config only when setup is not enough

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

**⚠ serverUrl mode requires the background HTTP service to already be running.**
The `serverUrl` config is a pure HTTP client — it connects to an endpoint but does NOT start the server.
If the service is down, the MCP client receives `ECONNREFUSED` with no auto-recovery.

To guarantee the server is available before the IDE connects, use:

```bash
memorix background ensure
```

This command checks health and auto-starts if needed. Add it to your shell profile or IDE startup script.

Some IDEs (Windsurf, Cursor) use `serverUrl` in their MCP config and do not support preflight commands.
For those, the background must be started manually or via OS startup (see §4 Step 3b below).

If you choose HTTP mode, do not stop at the URL. The agent must also bind each project session with `memorix_session_start(projectRoot=ABSOLUTE_WORKSPACE_PATH)` when the workspace path is available.

The setup path is best for:

- one workspace
- one agent/IDE
- quick validation
- minimal moving parts

---

## 4. Full HTTP Service Setup

Use this path when the user wants the full Memorix product model.

### Step 1. Install and initialize

```bash
npm install -g memorix
memorix init --global
```

### Step 2. Ensure Git identity exists

If needed:

```bash
git init
```

### Step 3. Start HTTP service

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
memorix background stop     # Stop the background HTTP service
memorix background restart  # Stop + start
```

### Step 3b. Make the HTTP service persistent (recommended)

`memorix background start` spawns a detached process that survives the terminal, but it does **not** survive system reboots or user logouts.

The background HTTP service is a **persistent server** — it is designed to run continuously in the background, not to be auto-launched by MCP clients on demand.

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

**Why this matters:** IDEs that use `serverUrl` (Windsurf, Cursor HTTP mode) connect to `http://localhost:3211/mcp` but cannot start the server. If the service is down, the IDE shows an MCP error with no recovery path. The user must run `memorix background start` or `ensure` manually.

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
- explicit task/message/handoff/lock coordination
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

- `memorix setup --agent <agent> --global`
- stdio MCP as the default transport

### If the user says:

- "I want dashboard"
- "I want HTTP MCP"
- "I want multiple agents / IDEs at once"
- "I want shared HTTP MCP or a live dashboard endpoint"

Choose:

- `memorix background start`
- explicit `memorix_session_start(projectRoot=...)`

### If the user asks for IDE integration files

Use:

```bash
memorix setup --agent <agent> --global
```

This is the default integration package when you want the global/user-level install.

Use `memorix integrate --agent <agent>` only when the user explicitly wants the older/manual generation path or wants to update one generated integration surface without running full setup.

Setup may write plugin packages, MCP config, project rules, settings, instruction files, or local plugin files depending on the target. See [INTEGRATIONS.md](INTEGRATIONS.md) for the public matrix.

### If the user asks for hooks

Use:

```bash
memorix hooks install --agent <agent> --global
```

This is also explicit and opt-in.

Use `memorix hooks install --agent <agent> --global` when the host supports a user-level/global hook surface and the user wants hooks without rewriting a repo. Use the project-scoped form when the user wants hooks only for the current repository.

Use it as a fallback when the user only wants hook capture files. Do not assume the user wants every supported IDE directory generated.

---

## 6. Generated Dot Directories: What They Mean

Memorix now favors **explicit, per-agent installation**.

That means:

- it does **not** need to spray every supported `.xxx` directory into every repo
- the user or agent can select only the integrations they actually need

Important:

- many `.cursor`, `.windsurf`, `.claude`, `.gemini`, `.opencode`, etc. directories are not arbitrary clutter
- they are often part of the target IDE's own discovery protocol
- do **not** promise that all of them can be physically merged into one folder without breaking agent discovery

What you can say safely:

- Memorix supports **on-demand generation**
- it does **not** require generating every integration at once
- different agents still expect their own directory or config path

---

## 7. Hooks vs Integrations

Do not confuse these.

### `memorix setup`

Purpose:

- install the recommended Memorix integration package or config for a specific target
- write plugin packages, MCP config, rules, settings, instruction files, hooks, or plugin files according to agent capability

Typical use:

```bash
memorix setup --agent claude --global
memorix setup --agent codex --global
memorix setup --agent cursor --global
memorix setup --agent opencode --global
```

### `memorix integrate`

Purpose:

- fallback/manual generation for IDE/agent integration files
- update rules, settings, instruction files, or plugin files for a specific target without the full setup package

Typical use:

```bash
memorix integrate --agent cursor
memorix integrate --agent opencode
memorix integrate --agent gemini-cli
```

### `memorix hooks install`

Purpose:

- install auto-capture hooks for supported agents
- generate a local plugin where that is the agent's hook mechanism, currently OpenCode

Typical use:

```bash
memorix hooks install --agent cursor --global
memorix hooks install --agent opencode --global
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

In HTTP service mode:

1. Use `memorix_search` / `memorix_detail` when prior project context would materially help the task.
2. Call `memorix_session_start` when explicit session semantics are useful: handoff, long-running work, restoring prior session context, coordination state, or project binding in a multi-project HTTP service.
3. When calling `memorix_session_start`, pass:
   - `agent` — display name (e.g. `"cursor-frontend"`)
   - `agentType` — optional agent/client type for coordination role mapping (e.g. `"windsurf"`, `"cursor"`, `"claude-code"`, `"codex"`, `"gemini-cli"`)
   - `projectRoot` = absolute workspace path when the client knows it
4. By default this only starts a lightweight session. It does **not** join orchestration coordination state.
5. If the user wants orchestrated subagent coordination, either:
   - call `memorix_session_start` with `joinTeam: true`
   - or call `team_manage(join)` explicitly
6. If project binding fails, stop using project-scoped tools until the path is corrected
7. Then use:
   - `memorix_search`
   - `memorix_detail`
   - `memorix_timeline`
   as needed

In stdio / project-bound mode:

- `projectRoot` is optional if the process is already launched from the correct workspace
- a session bind is optional; keep this path lightweight unless the user explicitly needs session, handoff, or orchestration coordination semantics

Important boundary:

- `team_manage(join)` does not make separate Cursor, Windsurf, Codex, or TUI conversation windows magically talk to each other.
- For real autonomous multi-agent implementation loops, use `memorix orchestrate`; it launches CLI agents, coordinates work through tasks/context, and runs verification/fix/review gates.
- Shared memory means stored memories are searchable across clients in the same Git project. It does not mean every chat message is mirrored automatically.
- For support/debugging, use `memorix receipt --json` or `memorix doctor --receipt`; receipts emit hashes/counts only and omit raw prompts, raw memory text, raw queries, tool payloads, and local file paths.
- `memorix orchestrate` runs one worker in the current checkout by default. For multiple workers it creates task worktrees under `.worktrees/`, fails closed if isolation cannot be created, rejects dirty Git state unless `--allow-dirty` is set, and auto-merges successful task branches unless `--no-auto-merge` is set.

---

## 9. Recommended Command Set for Agents

### Core runtime

```bash
memorix serve
memorix background start
memorix serve-http --port 3211
memorix doctor
memorix doctor agents --agent <agent>
memorix status
```

### Project setup

```bash
memorix init --global
memorix setup --agent <agent> --global
memorix repair agents --agent <agent>
memorix integrate --agent <agent>
memorix hooks install --agent <agent>
memorix git-hook --force
memorix orchestrate --goal "<goal>" --isolated
memorix orchestrate --goal "<goal>" --no-auto-merge
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

### 0. Is the agent integration stale?

Run:

```bash
memorix doctor agents --agent <agent>
```

If it reports stale MCP command paths, missing `memorix` MCP entries, missing Claude `alwaysLoad`, or outdated Memory Autopilot guidance, run:

```bash
memorix repair agents --agent <agent>
```

Repair only rewrites Memorix-owned MCP entries and Memorix-owned guidance blocks. It should not edit unrelated user config.

### 1. Is the workspace a Git repo?

If not, run:

```bash
git init
```

### 2. Is the runtime mode correct?

- stdio MCP client -> `memorix serve`
- HTTP/dashboard/shared-service use case -> `memorix background start` by default, or `memorix serve-http --port 3211` when foreground control is required
- existing IDE/agent integration -> `memorix setup --agent <agent> --global`

### 3. Is the background HTTP service actually running?

If the MCP client reports `ECONNREFUSED` on `localhost:3211`:

```bash
memorix background status
```

If it shows "Not running" or "dead":

```bash
memorix background ensure
```

If the client is connected but starts failing after roughly 30 minutes of no Memorix tool use, check for stale HTTP session expiry rather than treating it as project binding failure. Restart the service with a longer idle timeout:

```powershell
$env:MEMORIX_SESSION_TIMEOUT_MS = "86400000"
memorix background restart
```

Common causes of the background dying:
- System reboot or user logout (background is not a system service)
- Unhandled error in the service process (now logged to `~/.memorix/background.log`)
- Terminal that started it was closed before the process fully detached (rare on Node.js v20+)

The heartbeat file `~/.memorix/background.heartbeat` is updated every 30 seconds while the service is alive. If `status` reports a dead process with a recent heartbeat, the service crashed — check the log file.

### 4. Is the MCP config pointing to the right command?

On Windows, some clients behave better with `memorix.cmd` than bare `memorix`.

**serverUrl vs command mode:**
- `serverUrl` (HTTP) requires the background to already be running — it cannot auto-start
- `command` (stdio) launches `memorix serve` on demand — no background needed; use `memorix dashboard` for a standalone read-mostly dashboard and CLI orchestration tools for coordinated subagent workflows

If using `serverUrl` and the background keeps disappearing, consider switching to stdio mode as a fallback.

### 5. In HTTP mode, did the session bind with `projectRoot`?

If not, the agent may drift into the wrong project bucket or fail closed.

### 6. Did the user install the integration they actually need?

Use:

```bash
memorix setup --agent <agent> --global
```

Use `memorix integrate --agent <agent>` or `memorix hooks install --agent <agent>` only for fallback/manual updates of one surface.

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
- assume `serverUrl` HTTP mode will auto-start the background HTTP service — it cannot
- tell users "just restart the IDE" when the fix is `memorix background ensure`
- promise the background HTTP service survives reboots without OS-level startup config

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
- "Why did the background HTTP service disappear?"

read this document first, then act.

This playbook is the canonical AI-facing guide for installation, project binding, integration, hooks, troubleshooting, and safe usage.
## Docker Note

When Memorix runs in Docker, treat it as an **HTTP service deployment**, not a stdio MCP process.

- Connect IDEs and agents to `http://host:3211/mcp`
- Use `memorix_session_start(projectRoot=...)` with a path that is visible **inside** the container
- If the repo is not mounted into the container, project-scoped Git/config semantics will fail closed
