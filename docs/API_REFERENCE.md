# Memorix API Reference

This document covers the main Memorix MCP tools and the most important behavior to know when integrating from an IDE or agent.

Memorix exposes:

- core memory tools
- reasoning and session tools
- maintenance and retention tools
- CodeGraph Memory, project context, and context pack tools
- workspace and rules sync tools
- orchestration coordination tools
- privacy-safe handoff diagnostics
- dashboard and optional graph compatibility tools

It also exposes a CLI for terminal workflows. The CLI is not a raw mirror of MCP tool names: the CLI is what you run by hand to inspect and manage memory, while MCP is how IDEs and agents integrate.

---

## 1. CLI vs MCP

Use **MCP** when:

- an IDE or agent needs tool calls
- you want the full API
- you are integrating Memorix into an MCP-capable client

Use the **CLI** when:

- you want to inspect or change project state from a terminal
- you are on SSH / Docker / CI / NAS and want direct commands
- you want readable, namespaced actions instead of raw MCP tool payloads
- you want full access to Memorix CLI capabilities without depending on an MCP client

The current CLI namespaces are:

- `memorix session`
- `memorix memory`
- `memorix codegraph`
- `memorix reasoning`
- `memorix retention`
- `memorix formation`
- `memorix audit`
- `memorix transfer`
- `memorix skills`
- `memorix team`
- `memorix task`
- `memorix message`
- `memorix lock`
- `memorix handoff`
- `memorix poll`
- `memorix receipt`
- `memorix sync`
- `memorix ingest`

Typical examples:

```bash
memorix session start --agent codex-main --agentType codex
memorix memory search --query "release blocker"
memorix context --task "continue auth bug"
memorix codegraph refresh
memorix codegraph status --json
memorix reasoning search --query "why sqlite"
memorix retention status
memorix task list
memorix task claim --taskId <id> --agentId <agent-id>
memorix message inbox --agentId <agent-id>
memorix lock status --file src/cli/index.ts
memorix audit project
memorix transfer export --format markdown
memorix skills show --name auth-pattern
memorix sync workspace --action scan
memorix ingest image --path ./diagram.png
memorix poll --agentId <agent-id>
memorix receipt --json --probe "release blocker"
```

The CLI is for direct terminal use, not a 1:1 mirror of MCP tool names. The only MCP-only area is the optional graph-compatibility tools (`create_entities`, `read_graph`, and related tools) for workflows that expect the official memory-server style graph API.

### Memory Autopilot, CodeGraph Memory, and Context Packs

Memory Autopilot is the default agent-facing path for coding context. It uses CodeGraph Memory, project observations, task-lens heuristics, and freshness labels to produce a compact brief instead of dumping raw old chat text. CodeGraph Memory stores structured file, symbol, import-edge, and memory-to-code reference facts in the same local SQLite database as project memory. It is not a replacement for normal file reads. Its job is to help agents decide which memories still point at current code, which ones are stale, and which files/symbols deserve inspection next.

CLI:

```bash
memorix codegraph refresh
memorix codegraph status
memorix codegraph status --json
memorix context
memorix context --task "continue auth bug"
memorix context --task "prepare 1.1.7 release"
memorix explain
memorix codegraph context-pack --task "continue auth bug"
```

MCP:

- `memorix_project_context` builds the default Memory Autopilot brief. It can auto-refresh CodeGraph Memory when the index is missing or stale, infer a task lens (`bugfix`, `feature`, `release`, `onboarding`, `refactor`, `docs`, `test`, or `general`), then return current project facts, Start here files, reliable code-bound memories, stale/suspect cautions, and lens-specific verification hints.
- `memorix_codegraph_status` returns provider/index counts for the current project.
- `memorix_context_pack` builds a task-specific packet with reliable current memories, lower-trust unbound memories, current code facts, freshness warnings, suggested reads, and suggested verification.

`memorix context` defaults to `--refresh auto`, so first use can seed CodeGraph Memory without a separate manual `memorix codegraph refresh`. Its brief puts live package/changelog/Git facts before memory hints and flags old `progress.txt` / dev-log notes as historical when they predate the latest changelog, so agents should treat current facts as the source of truth when files disagree. Task lenses keep the packet shaped to the work: bugfix briefs prefer failing tests and repros, release briefs prefer metadata/changelog/package checks, and onboarding briefs prefer docs and entry points while hiding unrelated suspect details. Use `--refresh never` for read-only inspection and `--refresh always` when you want to force a fresh scan.

Project-specific generated, vendored, or cache paths can be excluded from CodeGraph Memory with `[codegraph].exclude_patterns` in `memorix.toml` or `~/.memorix/config.toml` (`codegraph.excludePatterns` in legacy YAML). User patterns extend the built-in excludes and are applied to indexing, Project Context suggested reads, and Context Pack suggested reads.

SessionStart hooks keep the default minimal hint lightweight. When memory behavior is configured with `sessionInject=full`, Memorix injects the compact Memory Autopilot brief at session start instead of only listing recent text memories.

The intended loop for agents is: get the project brief when it helps, inspect the suggested current files, use stale or unbound memory only as a lead, store durable outcomes after the work changes the project, and resolve obsolete memories.

The built-in Lite provider indexes common code files with lightweight file, symbol, and import facts. Future providers can feed richer graph data into the same store and context APIs.

### Cross-Agent Handoff Receipt

`memorix receipt` creates a privacy-safe diagnostic artifact for cross-agent memory handoff debugging.

```bash
memorix receipt --json
memorix receipt --json --probe "query to verify"
memorix doctor --receipt
```

The receipt helps answer whether two clients are bound to the same Git/project identity, whether any memory writes exist, and whether an optional search probe returns matching memories. It emits hashes and counts only: project identity hash, root/cwd hashes, write count, recent observation ID hashes, optional query hash, result count, and result ID hashes.

It intentionally does not emit raw chat transcripts, raw memory text, raw search queries, tool arguments/results, or local file paths. Shared memory means stored memories are searchable across clients in the same project; it does not mean every chat message is mirrored across clients.

---

## 2. Retrieval Model Basics

Before looking at individual tools, there are three important defaults:

### Project scope comes first

- `memorix_search` defaults to the current project
- use `scope="global"` when you intentionally want cross-project recall

### Global hits can be opened explicitly

If you search globally, open results with project-aware refs:

```json
{
  "refs": [
    { "id": 84, "projectId": "AVIDS2/test-memorix-demo" }
  ]
}
```

This is supported by `memorix_detail`.

### Retrieval is source-aware

Memorix ranks memory differently depending on intent:

- "what changed" style queries tend to favor Git Memory
- "why" style queries tend to favor reasoning and decision memory
- "problem" style queries can favor both fixes and Git Memory

---

## 3. Core Memory Tools

### `memorix_store`

Store a new observation.

Typical uses:

- store a decision
- store a gotcha
- store a problem-solution note
- record a milestone or a shipped change

Important inputs:

- `entityName`
- `type`
- `title`
- `narrative`
- optional `facts`
- optional `filesModified`
- optional `concepts`
- optional `topicKey`
- optional `progress`
- optional `source`
- optional `relatedCommits`
- optional `relatedEntities`

Example:

```json
{
  "entityName": "auth-module",
  "type": "decision",
  "title": "JWT over cookie sessions",
  "narrative": "Chose JWT because multiple agents and tools need stateless auth.",
  "facts": [
    "Goal: support cross-agent local integrations",
    "Constraint: avoid server-side session state"
  ],
  "filesModified": ["src/auth/index.ts"],
  "concepts": ["jwt", "auth", "stateless"]
}
```

### `memorix_search`

Search project memory or global memory.

Important inputs:

- `query`
- `limit`
- `scope`
- `status`
- `type`
- `source`
- `since`
- `until`
- `maxTokens`

Typical uses:

- search the current project
- search only Git memories with `source="git"`
- search resolved or archived memories with `status="all"`

Example:

```json
{
  "query": "why did we switch to HTTP transport",
  "limit": 10
}
```

Global example:

```json
{
  "query": "release status",
  "scope": "global"
}
```

### `memorix_detail`

Fetch full observation detail.

Supports two modes:

- `ids` for current-project observations
- `refs` for project-aware cross-project lookup

Examples:

```json
{
  "ids": [42, 43]
}
```

```json
{
  "refs": [
    { "id": 84, "projectId": "AVIDS2/test-memorix-demo" }
  ]
}
```

### `memorix_timeline`

Get the chronological context around one observation.

Important inputs:

- `anchorId`
- `depthBefore`
- `depthAfter`

Use it when you want:

- what happened before this memory
- what happened after this memory

### `memorix_resolve`

Mark observations as resolved or archived.

Important inputs:

- `ids`
- optional `status`

Typical use:

- hide completed or outdated memories from default search without deleting them

---

## 4. Reasoning Tools

### `memorix_store_reasoning`

Store a reasoning trace for a non-trivial decision.

Important inputs:

- `entityName`
- `decision`
- `rationale`
- optional `alternatives`
- optional `constraints`
- optional `expectedOutcome`
- optional `risks`
- optional `concepts`
- optional `filesModified`
- optional `relatedCommits`
- optional `relatedEntities`

Use it when the key value is:

- why a choice was made
- what alternatives were rejected
- what risks are accepted

### `memorix_search_reasoning`

Search only reasoning traces.

Important inputs:

- `query`
- `limit`
- `scope`

Use it when you want:

- decision rationale
- design trade-offs
- previous thinking on a similar problem

---

## 5. Session Tools

### `memorix_session_start`

Start a new coding session and load recent context.

Important inputs:

- optional `agent` — display name (e.g. `"cursor-frontend"`)
- optional `agentType` — agent/client type for optional orchestration coordination identity mapping (e.g. `"windsurf"`, `"cursor"`, `"claude-code"`, `"codex"`, `"gemini-cli"`, `"openclaw"`, `"hermes"`, `"omp"`)
- optional `projectRoot`
- optional `sessionId`
- optional `instanceId`
- optional `joinTeam`
- optional `role`

Behavior:

- opens a session for the current project
- can auto-close any previous active session for that project
- returns recent session context and project binding state
- **does not join orchestration coordination state by default**
- if you only need memory/search/reasoning/session recovery, stop here; no coordination identity is required
- when `joinTeam=true`, it also registers a coordination identity using the default role derived from `agentType` via `AGENT_TYPE_ROLE_MAP`
- `team_manage(join)` is the explicit join entrypoint if you want to separate session start from coordination identity
- coordination-specific outputs such as agent ID, watermark, and available tasks appear only when the session explicitly joins that coordination state

In HTTP service mode, pass `projectRoot` as the absolute workspace or repo root whenever the client knows it. `projectRoot` is the detection anchor; project identity still comes from Git.

### `memorix_session_end`

End the active session with a summary.

Important inputs:

- `sessionId`
- optional `summary`

Use it to write a handoff note for the next session or next agent.

### `memorix_session_context`

Fetch recent session summaries and context.

Important inputs:

- optional `limit`

---

## 6. Quality and Maintenance Tools

### `memorix_retention`

Inspect retention state or archive expired memories.

Important inputs:

- `action`

Typical actions:

- `report`
- `archive`

### `memorix_consolidate`

Merge similar memories to reduce noise.

Important inputs:

- `action`
- optional `threshold`

Typical actions:

- `preview`
- `execute`

### `memorix_deduplicate`

Scan for duplicates and contradictions.

Important inputs:

- optional `dryRun`
- optional `query`

### `memorix_transfer`

Export or import project memory.

Important inputs:

- `action`
- optional `format`
- optional `data`

Typical actions:

- `export`
- `import`

### `memorix_suggest_topic_key`

Generate a stable `topicKey` for upsert-style memory writes.

Important inputs:

- `title`
- `type`

### `memorix_formation_metrics`

Show aggregated metrics for the formation pipeline.

Use it to inspect:

- processed observation counts
- value score averages
- stage timing
- recent pipeline behavior

---

## 7. Skills and Promotion Tools

### `memorix_skills`

Work with memory-driven project skills.

Important inputs:

- `action`
- optional `name`
- optional `target`
- optional `write`

Typical actions:

- `list`
- `generate`
- `inject`

### `memorix_promote`

Promote observations into durable mini-skills.

Important inputs:

- `action`
- optional `observationIds`
- optional `skillId`
- optional `instruction`
- optional `trigger`
- optional `tags`

Typical actions:

- `list`
- `promote`
- `delete`

---

## 8. Workspace and Rules Tools

### `memorix_workspace_sync`

Scan, preview, or apply cross-agent workspace migration.

Important inputs:

- `action`
- optional `target`
- optional `items`

Typical actions:

- `scan`
- `migrate`
- `apply`

### `memorix_rules_sync`

Scan or generate cross-agent rule files.

Important inputs:

- `action`
- optional `target`

Typical actions:

- `status`
- `generate`

---

## 9. Orchestration Coordination Tools

These tools support task, handoff, message, lock, and subagent-style orchestration workflows. They are available through MCP profiles that include coordination tools and through the CLI. HTTP is optional: use it when you want a shared MCP service or live dashboard endpoint, not because coordination state requires HTTP.

```bash
memorix team status
memorix orchestrate --goal "..."
```

Use `memorix background start` or `memorix serve-http --port 3211` only when you want the HTTP service in the background or foreground.

Coordination state is opt-in project state for tasks, handoff messages, locks, and subagent workflows. You don't need it for normal memory use, and it is not an automatic chat room between separate IDE conversations. For production multi-agent execution, use `memorix orchestrate`; these tools provide the coordination layer.

`memorix orchestrate` uses Git worktrees for parallel worker isolation. Single-worker runs use the current checkout unless `--isolated` is set. Parallel runs fail closed if a task worktree cannot be created. Dirty Git worktrees are rejected unless `--allow-dirty` is set. Successful task worktrees merge back automatically unless `--no-auto-merge` is set.

Runtime environment:

- `MEMORIX_SESSION_TIMEOUT_MS` — HTTP MCP session idle timeout in milliseconds. Default: `1800000` (30 minutes). Increase this for clients that do not transparently reinitialize after stale HTTP session IDs, for example `86400000` for 24 hours.

### `team_manage`

Register, unregister, or inspect agents.

Important inputs:

- `action`
- optional `name`
- optional `role`
- optional `capabilities`
- optional `agentId`

### `team_message`

Send, broadcast, or read messages between agents.

Important inputs:

- `action`
- optional `agentId`
- optional `from`
- optional `to`
- optional `content`
- optional `type`
- optional `markRead`

### `team_task`

Create, claim, complete, or list tasks.

Important inputs:

- `action`
- optional `taskId`
- optional `agentId`
- optional `description`
- optional `deps`
- optional `status`
- optional `available`

### `team_file_lock`

Acquire, release, or inspect advisory file locks.

Important inputs:

- `action`
- optional `agentId`
- optional `file`

### `memorix_poll`

Return a compact situational-awareness snapshot for an explicitly joined coordination participant.

Important inputs:

- optional `agentId`

Use it for:

- active coordination participant overview
- available tasks
- unread messages
- active file locks
- project-level team activity

If `agentId` is omitted, it returns a project-level overview only.

### `memorix_handoff`

Create, claim, complete, or inspect handoff artifacts between coordination participants.

Important inputs:

- `action`
- optional `handoffId`
- optional `fromAgentId`
- optional `toAgentId`
- optional `summary`
- optional `context`

Use it when work should survive agent/session boundaries without relying on an IDE chat window staying alive.

---

## 10. Ingestion Tools

### `memorix_ingest_image`

Ingest an image as memory context when visual artifacts are relevant to the project.

Important inputs:

- `path`
- optional `title`
- optional `entityName`
- optional `type`

CLI equivalent:

```bash
memorix ingest image --path ./diagram.png
```

---

## 11. Dashboard Tool

### `memorix_dashboard`

Launch the local dashboard in the browser.

Important inputs:

- optional `port`

When using HTTP mode, the main dashboard is usually served from the same port as `serve-http`.

---

## 12. Optional Graph Compatibility Tools

Memorix can expose MCP-compatible graph tools for workflows that expect the official memory-server style graph API.

Typical graph tool families include:

- create entities
- create relations
- add observations
- delete entities
- delete observations
- delete relations
- search nodes
- open nodes
- read graph

These are optional compatibility tools rather than the main recommended Memorix workflow.

---

## 13. Observation Types

Common observation types include:

- `session-request`
- `gotcha`
- `problem-solution`
- `how-it-works`
- `what-changed`
- `discovery`
- `why-it-exists`
- `decision`
- `trade-off`
- `reasoning`

Each type helps retrieval and formatting behave differently, especially when combined with source-aware ranking.

---

## 14. Recommended Usage Pattern

For most agents, the best working pattern is:

1. `memorix_search` to find relevant memories
2. `memorix_detail` for full records
3. `memorix_timeline` for chronological context
4. `memorix_store` or `memorix_store_reasoning` to write back important new context

Git Memory, retention, skills, and orchestration coordination tools sit on top of that core loop.

---

## 15. Related Docs

- [Setup Guide](SETUP.md)
- [Configuration Guide](CONFIGURATION.md)
- [Performance and Resource Notes](PERFORMANCE.md)
- [Git Memory Guide](GIT_MEMORY.md)
- [Architecture](ARCHITECTURE.md)
- [Development Guide](DEVELOPMENT.md)
