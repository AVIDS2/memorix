# Memorix API Reference

This document covers the main Memorix MCP tools and the most important behavior to know when integrating from an IDE or agent.

Memorix exposes:

- core memory tools
- reasoning and session tools
- maintenance and retention tools
- workspace and rules sync tools
- team collaboration tools
- dashboard and optional graph compatibility tools

---

## 1. Retrieval Model Basics

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

## 2. Core Memory Tools

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

## 3. Reasoning Tools

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

## 4. Session Tools

### `memorix_session_start`

Start a new coding session and load recent context.

Important inputs:

- optional `agent` — display name (e.g. `"cursor-frontend"`)
- optional `agentType` — agent type for auto-registration (e.g. `"windsurf"`, `"cursor"`, `"claude-code"`, `"codex"`, `"gemini-cli"`)
- optional `projectRoot`
- optional `sessionId`
- optional `instanceId`

Behavior:

- opens a session for the current project
- can auto-close any previous active session for that project
- **auto-registers the agent in the team** with a default role derived from `agentType` via `AGENT_TYPE_ROLE_MAP` (no separate `team_manage(join)` needed)
- returns recent session context, relevant memories, and the assigned agent ID
- reports watermark (new observations since last session) and available tasks

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

## 5. Quality and Maintenance Tools

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

## 6. Skills and Promotion Tools

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

## 7. Workspace and Rules Tools

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

## 8. Team Collaboration Tools

These tools are most meaningful in HTTP transport mode:

```bash
memorix background start
```

Use `memorix serve-http --port 3211` when you want the same HTTP control plane in the foreground for debugging or manual supervision.

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

---

## 9. Dashboard Tool

### `memorix_dashboard`

Launch the local dashboard in the browser.

Important inputs:

- optional `port`

When using HTTP mode, the main dashboard is usually served from the same port as `serve-http`.

---

## 10. Optional Graph Compatibility Tools

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

## 11. Observation Types

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

## 12. Recommended Usage Pattern

For most agents, the best working pattern is:

1. `memorix_search` to find relevant memories
2. `memorix_detail` for full records
3. `memorix_timeline` for chronological context
4. `memorix_store` or `memorix_store_reasoning` to write back important new context

Git Memory, retention, skills, and team tools sit on top of that core loop.

---

## 13. Related Docs

- [Setup Guide](SETUP.md)
- [Configuration Guide](CONFIGURATION.md)
- [Git Memory Guide](GIT_MEMORY.md)
- [Architecture](ARCHITECTURE.md)
- [Development Guide](DEVELOPMENT.md)
