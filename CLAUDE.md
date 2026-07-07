# Memorix - Agent Instructions for Claude Code

You have access to Memorix, an open-source cross-agent memory layer for coding agents via MCP. Use it to persist and recall project knowledge across sessions, preserve reasoning, and retrieve Git-backed engineering truth when relevant.

## Using Memorix Memory Tools

This project has Memorix MCP tools available for persistent cross-session memory.

For broad continuation or a fresh handoff, start with Memory Autopilot before
ad-hoc file reads:

- MCP: `memorix_project_context` with the current task
- Claude Code exposes MCP tools through dynamic tool loading. If the tool is not
  directly visible in the first tool list, search/select the Memorix project
  context tool before using shell fallback.
- CLI fallback: only after MCP is confirmed unavailable, run
  `memorix context --task "<current task>"` from the shell instead of skipping
  memory or hand-writing tool calls
- Do not skip project memory just because the initial MCP status says `pending`

Claude Code starts MCP servers asynchronously. An initial `pending` MCP status is
not a failure by itself; the tools may appear through dynamic tool loading after
startup. The reliable user-facing fallback is the `memorix context` CLI command,
but fallback should come after the MCP-first attempt.

### When to search memory

Use `memorix_search` when prior project context would help — for example:
- The user asks about a past decision, bug, or change
- You need to understand why something was designed a certain way
- You're continuing work that started in a previous session

You do **not** need to search memory for simple, self-contained tasks.

If no memories exist yet, that's fine — just proceed normally.

### When to store memory

Use `memorix_store` when you learn something a future session should not have to rediscover:

| What happened | Type |
|---|---|
| Architecture or design decision | `decision` |
| Bug found and fixed | `problem-solution` |
| Non-obvious pitfall or gotcha | `gotcha` |
| Config or dependency changed | `what-changed` |
| Trade-off discussed with conclusion | `trade-off` |

**Tips:** Use concise titles (~5-10 words). Include `filesModified` when relevant. Use `topicKey` for evolving topics. For "why" decisions, use `memorix_store_reasoning`.

**Don't store:** greetings, simple file reads, trivial commands.

### When to resolve memory

Use `memorix_resolve` when a task is done or a bug is fixed. This keeps future searches focused on active work.

### Tools quick reference

| Tool | Use when |
|---|---|
| `memorix_search` | Find relevant past context |
| `memorix_detail` | Read full content of a specific memory |
| `memorix_project_context` | Get the compact Memory Autopilot brief for a fresh task |
| `memorix_context_pack` | Get structured context when the agent needs refs/freshness |
| `memorix_store` | Save something worth persisting |
| `memorix_store_reasoning` | Save the "why" behind a decision |
| `memorix_resolve` | Mark completed/outdated memories |
| `memorix_session_start` | Load session context (handoff, team coordination) |
| `memorix_timeline` | See chronological context around a memory |
| `memorix_retention` | Check memory health and archive expired items |
| `memorix_promote` | Turn repeated patterns into permanent skills |
| `memorix_rules_sync` | Inspect or sync rules across agents |
| `memorix_workspace_sync` | Inspect or migrate workspace integrations |

## Dev Log

- **Repository-wide current state**: `docs/dev-log/progress.txt`
- Read that root progress file after the Memory Autopilot step for long-running
  release/development work.
- Package-specific historical notes may live under subdirectories such as
  `docs/memcode/dev-log/`; treat them as historical unless the current task is
  explicitly about that package.
- Update the root progress file when completing substantial cross-session work.
