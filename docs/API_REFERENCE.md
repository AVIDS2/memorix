# Memorix API Reference

This document covers the main Memorix MCP tools and the most important behavior to know when integrating from an IDE or agent.

Memorix exposes:

- core memory tools
- reasoning and session tools
- maintenance and retention tools
- workspace and rules sync tools
- team collaboration tools
- dashboard and optional graph compatibility tools

It also exposes a **human/operator CLI surface** for terminal workflows. The CLI is not a raw mirror of MCP tool names; it is the primary product surface for human operators, while MCP remains the integration protocol for IDEs and agents.

---

## 1. CLI vs MCP

Use **MCP** when:

- an IDE or agent needs tool calls
- you want the full fine-grained API surface
- you are integrating Memorix into an MCP-capable client

Use the **CLI** when:

- a human operator wants to inspect or change project state from a terminal
- you are on SSH / Docker / CI / NAS and want direct commands
- you want readable, namespaced actions instead of raw MCP tool payloads
- you want full access to Memorix-native capabilities without depending on an MCP host

The current operator CLI namespaces are:

- `memorix session`
- `memorix memory`
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
- `memorix sync`
- `memorix ingest`

Typical examples:

```bash
memorix session start --agent codex-main --agentType codex
memorix memory search --query "release blocker"
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
```

The CLI is designed as an **operator control surface**, not as a 1:1 rename of MCP tools. All Memorix-native operator capabilities have a CLI path in 1.0.8. The only intentional MCP-only area is the optional graph-compatibility surface (`create_entities`, `read_graph`, and related tools) for workflows that expect the official memory-server style graph API.

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
- optional `agentType` — agent type for optional collaboration identity mapping (e.g. `"windsurf"`, `"cursor"`, `"claude-code"`, `"codex"`, `"gemini-cli"`)
- optional `projectRoot`
- optional `sessionId`
- optional `instanceId`
- optional `joinTeam`
- optional `role`

Behavior:

- opens a session for the current project
- can auto-close any previous active session for that project
- returns recent session context and project binding state
- **does not join the team by default**
- if you only need memory/search/reasoning/session recovery, stop here; no team identity is required
- when `joinTeam=true`, it also registers a collaboration identity using the default role derived from `agentType` via `AGENT_TYPE_ROLE_MAP`
- `team_manage(join)` remains the formal explicit join entrypoint if you want to separate session start from collaboration identity
- team-specific outputs such as agent ID, watermark, and available tasks appear only when the session explicitly joins collaboration

In HTTP control-plane mode, pass `projectRoot` as the absolute workspace or repo root whenever the client knows it. `projectRoot` is the detection anchor; Git remains the source of truth for the final project identity.

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

## 9. Team Collaboration Tools

These tools are most meaningful in HTTP transport mode:

```bash
memorix background start
```

Use `memorix serve-http --port 3211` when you want the same HTTP control plane in the foreground for debugging or manual supervision.

Team collaboration is opt-in project coordination for tasks, messages, locks, and autonomous agent workflows. It is not required for normal memory use, and it should not be treated as an automatic chat room between separate IDE conversations. For production multi-agent execution, use `memorix orchestrate`; the team tools provide the coordination substrate.

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

Return a compact situational-awareness snapshot for an explicitly joined collaborator.

Important inputs:

- optional `agentId`

Use it for:

- active collaborator overview
- available tasks
- unread messages
- active file locks
- project-level team activity

If `agentId` is omitted, it returns a project-level overview only.

### `memorix_handoff`

Create, claim, complete, or inspect handoff artifacts between collaborators.

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

Git Memory, retention, skills, and team tools sit on top of that core loop.

---

## 15. Related Docs

- [Setup Guide](SETUP.md)
- [Configuration Guide](CONFIGURATION.md)
- [Performance and Resource Notes](PERFORMANCE.md)
- [Git Memory Guide](GIT_MEMORY.md)
- [Architecture](ARCHITECTURE.md)
- [Development Guide](DEVELOPMENT.md)
