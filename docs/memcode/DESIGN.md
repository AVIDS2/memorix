# memcode Design Notes

> Internal architecture notes for the bundled first-party memagent.
> For user-facing usage, start with [../MEMCODE.md](../MEMCODE.md).

memcode is the first-party memagent that ships with Memorix. It should feel like a normal terminal coding agent while using Memorix memory natively instead of treating memory as an external MCP add-on.

---

## Product Shape

```text
memorix                 -> opens memcode
memcode                 -> direct native-agent binary
memorix serve           -> stdio MCP server for external agents
memorix background start -> HTTP MCP control plane + dashboard
```

The important boundary:

- memcode is native to Memorix.
- External MCP agents remain first-class users of the same project memory.
- The memory pool belongs to the Git project and the user, not to one terminal agent.

---

## Workspace Packages

```text
packages/memcode      CLI, agent runtime, sessions, tools, slash commands
packages/tui          terminal UI primitives
packages/ai           provider and model plumbing
packages/agent-core   shared agent abstractions
src/memory            Memorix observations, reasoning, sessions, retention
src/search            retrieval, intent detection, compact context
src/store             SQLite canonical state and Orama indexes
src/hooks             hook ingestion and source normalization
src/config            TOML-first config and legacy compatibility
```

memcode should prefer published package boundaries where practical, but may use first-party Memorix internals when the product benefit is clear and the dependency remains stable inside the monorepo.

---

## Native Memory Integration

memcode writes to the same project-scoped Memorix memory pool used by MCP-connected agents.

```text
one Git project -> one Memorix memory namespace
```

Key integration points:

- native tools expose memory search, detail, store, status, and hook state to the agent
- `/memory` slash commands expose memory health and retrieval to the user
- hook capture turns prompts, tool calls, assistant output, and session lifecycle events into structured project context
- memory records include source metadata so memcode-originated context can be distinguished without splitting storage

This keeps the product portable: a user can switch from memcode to Claude Code, Codex, Cursor, Windsurf, or another MCP client and keep the same project memory.

---

## Session Model

memcode owns the interactive session experience:

- continue the latest session with `memcode -c`
- resume through the picker with `memcode -r`
- target a session with `--session` or `--session-id`
- fork prior work with `--fork`
- export sessions for review or archival

Session continuity should avoid visual flashes, stale context leaks, and cwd drift. The selected Git project remains the source of truth for project identity.

---

## Configuration Lanes

Memorix is TOML-first:

```toml
[agent]
provider = "openai"
model = "gpt-4o"

[memory.llm]
provider = "openai"
model = "gpt-4o-mini"

[embedding]
provider = "auto"
```

Lane ownership:

| Lane | Owner | Purpose |
| --- | --- | --- |
| `[agent]` | memcode | coding model used in the terminal agent |
| `[memory.llm]` | Memorix memory runtime | formation, summaries, deduplication, optional rerank |
| `[embedding]` | Memorix search runtime | semantic/vector search |
| `[memory]` | Memorix memory runtime | injection and formation behavior |
| `[git]` | Git Memory | commit ingestion and hook behavior |

Legacy YAML, `.env`, and JSON config files remain compatibility inputs for existing users. New docs and init flows should create TOML.

---

## Tool And Trust Model

Built-in tools:

- `read`
- `bash`
- `edit`
- `write`
- `grep`
- `find`
- `ls`

Trust-sensitive inputs include:

- project instructions
- project skills
- prompt templates
- themes
- extension packages

Flags such as `--approve`, `--no-approve`, `--tools`, `--exclude-tools`, `--no-tools`, and `--no-builtin-tools` should remain clear and predictable. A read-only review mode should be easy to express with `--tools read,grep,find,ls`.

---

## Release Requirements

Before publishing a memcode-affecting release:

1. Run focused memcode tests for session, TUI, tools, and memory integration.
2. Run root typecheck and build.
3. Build `packages/memcode`.
4. Verify `memorix --version` and `memcode --version`.
5. Verify bare `memorix` resolves the bundled memcode entry after `npm link` or package install.
6. Verify `/resume` and memory commands in a real terminal when the change touches TUI behavior.
7. Ensure README, `docs/MEMCODE.md`, `llms.txt`, and `llms-full.txt` describe the shipped behavior.

---

## Design Principles

- Keep the terminal agent practical: inspect, edit, run, resume, and explain.
- Keep memory portable across agents.
- Prefer project-scoped truth over transcript mirroring.
- Expose memory controls directly in the TUI.
- Avoid making users understand internal MCP plumbing when they are working inside memcode.
- Keep external MCP clients first-class, even though memcode is the native path.
