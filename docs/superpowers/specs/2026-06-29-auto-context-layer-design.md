# Auto Context Layer Design

Date: 2026-06-29
Branch: `codex/1.1.3-codegraph-memory`

## Problem

Code Memory is now available, but the user or agent still has to remember to run `memorix codegraph refresh`, `memorix context`, or `memorix explain`. That is not enough. The product needs to feel like a project-aware agent seatbelt: when an agent starts work, Memorix should quietly provide the useful project context and avoid dumping stale or noisy text.

## Goal

Make Memorix produce an agent-ready project context packet by default, using Code Memory, memory freshness, and suggested code reads, without exposing users to internal codegraph/storage concepts.

## Non-Goals

- Do not build a full standalone codegraph engine in this slice.
- Do not add parser dependencies.
- Do not inject large context by default in minimal mode.
- Do not force agents to use Memorix when the project has no useful context.

## User Experience

Users should be able to run:

```powershell
memorix context
```

and get useful output even if they forgot to run:

```powershell
memorix codegraph refresh
```

Agents should be able to call:

```text
memorix_project_context
```

and receive a compact packet with:

- project identity,
- Code Memory status,
- suggested files to read first,
- active code-bound memories,
- freshness warnings,
- a clear instruction to verify code before trusting old memory.

For SessionStart hooks, `sessionInject=full` should include this compact project context. `minimal` should stay light and only point agents toward the project context tool.

## Architecture

Add a shared `auto-context` service under `src/codegraph/`. It owns the policy for:

- whether Code Memory should refresh,
- how to build project context from the SQLite-backed CodeGraphStore,
- how to format agent-facing context text.

CLI commands, MCP tools, and hooks call this shared service. Existing advanced commands such as `memorix codegraph context-pack` remain available.

## Refresh Policy

Default refresh mode is `auto`.

Auto refresh happens when:

- the project has no indexed code files,
- the latest scan is missing,
- the latest scan is older than the configured max age.

The first implementation uses a conservative default max age of 10 minutes. Users and tests can pass `refresh=never` or `refresh=always`.

## Interfaces

New service API:

```ts
buildAutoProjectContext({
  project,
  dataDir,
  observations,
  task,
  refresh,
  maxAgeMs,
  limit,
})
```

New MCP tool:

```text
memorix_project_context
```

Inputs:

- `task?: string`
- `refresh?: "auto" | "always" | "never"`
- `format?: "prompt" | "summary" | "json"`
- `limit?: number`

CLI:

```powershell
memorix context [--task "..."] [--refresh auto|always|never] [--json]
memorix explain [--refresh auto|always|never] [--json]
```

## Safety

- Never include raw secrets.
- Keep prompt output short.
- Prefer suggested reads over long copied code.
- Mark stale/suspect links clearly.
- If refresh fails, return the best available memory context with a warning instead of crashing the whole hook.

## Tests

Cover:

- auto refresh indexes a temp project when Code Memory is empty,
- CLI `memorix context` works without manual refresh,
- MCP tool is included in lite/team/full profiles,
- SessionStart full injection contains project context and suggested reads,
- existing focused and full suites continue to pass.
