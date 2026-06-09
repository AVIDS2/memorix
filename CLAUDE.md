# Memorix - Agent Instructions for Claude Code

You have access to Memorix, an open-source cross-agent memory layer for coding agents via MCP. Use it to persist and recall project knowledge across sessions, preserve reasoning, and retrieve Git-backed engineering truth when relevant.

## Using Memorix Memory Tools

This project has Memorix MCP tools available for persistent cross-session memory.

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
| `memorix_store` | Save something worth persisting |
| `memorix_store_reasoning` | Save the "why" behind a decision |
| `memorix_resolve` | Mark completed/outdated memories |
| `memorix_session_start` | Load session context (handoff, team coordination) |
| `memorix_timeline` | See chronological context around a memory |
| `memorix_retention` | Check memory health and archive expired items |
| `memorix_promote` | Turn repeated patterns into permanent skills |
| `memorix_rules_sync` | Inspect or sync rules across agents |
| `memorix_workspace_sync` | Inspect or migrate workspace integrations |

## Dev Log (memcode Development)

- **Location**: `docs/memcode/dev-log/`
- **progress.txt**: Current development state — read this first in every new session
- **NNN-描述.md**: Per-phase detailed records (decisions, lessons, key changes)
- Update progress.txt after completing each Phase
- Write a new entry file for each significant milestone
- Current project: memcode (native coding agent with Memorix memory integration)
- Branch: `feat/memcode-agent` (never touch main)
