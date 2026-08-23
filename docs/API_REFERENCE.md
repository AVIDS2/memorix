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
- `memorix identity`
- `memorix memory`
- `memorix codegraph`
- `memorix knowledge`
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
- `memorix media`
- `memorix workbench`

Typical examples:

```bash
memorix --cwd /path/to/repo resume "continue auth bug"
memorix identity join --agent-type codex --name codex-main
memorix session start --agent codex-main --agent-type codex --join-team --use
memorix memory search --query "release blocker"
memorix memory store --text "private triage note" --visibility personal
memorix codegraph refresh
memorix codegraph status --json
memorix knowledge status
memorix reasoning search --query "why sqlite"
memorix retention status
memorix task list
memorix task claim --taskId <id> --agentId <agent-id>
memorix message inbox --agentId <agent-id>
memorix lock status --file src/cli/index.ts
memorix audit project
memorix transfer export --format markdown --out ./memorix-export.md
memorix skills show --name auth-pattern
memorix sync workspace --action scan
memorix ingest image --path ./diagram.png
memorix media import --path ./architecture.png
memorix media attach --asset <asset-id> --title "Architecture diagram"
memorix poll --agentId <agent-id>
memorix receipt --json --probe "release blocker"
```

The CLI is for direct terminal use, not a 1:1 mirror of MCP tool names. It does not require an MCP connection. `--cwd` selects a Git project from any shell; an unbound terminal has project-visible access only, including transfer exports. `memorix identity join|use|clear` makes personal/team access and coordination explicit, while `--as <agent-id>` is the one-command equivalent for scripts. The only MCP-only area is the optional graph-compatibility tools (`create_entities`, `read_graph`, and related tools) for workflows that expect the official memory-server style graph API.

### Memory Autopilot, Code State, and Context Packs

Memory Autopilot is the default agent-facing path for coding context. It builds a bounded task Workset instead of dumping old chat text: current project facts, Code State, selected observations, source-backed claims, matching knowledge/workflow starts, cautions, and verification hints. Code State stores versioned local file, symbol, import-edge, and memory-to-code reference facts beside project memory. It is not a replacement for normal file reads. Its job is to help agents decide which memories still point at current code, which ones are stale, and which files/symbols deserve inspection next.

CLI:

```bash
memorix codegraph refresh
memorix codegraph status
memorix codegraph status --json
memorix context
memorix context --task "continue auth bug"
memorix context "continue auth bug"
memorix resume "continue auth bug"
memorix checkpoint list
memorix checkpoint context --task "continue auth bug"
  memorix context --task "prepare 1.8.0 release"
memorix explain
memorix codegraph context-pack --task "continue auth bug"
```

MCP:

- `memorix_project_context` builds the default Memory Autopilot brief. It can auto-refresh Code State when the local index is missing or stale, infer a task lens (`bugfix`, `feature`, `release`, `onboarding`, `refactor`, `docs`, `test`, or `general`), then return current project facts, Start here files, selected evidence, stale/suspect cautions, and lens-specific verification hints.
- `memorix_codegraph_status` returns provider/index counts for the current project.
- `memorix_context_pack` builds a task-specific packet with reliable current memories, lower-trust unbound memories, current code facts, freshness warnings, suggested reads, and suggested verification.
- `memorix_graph_context` is an advanced compact graph overview. It starts from a small task-matched baseline and can add only directly related, evidence-governed memories. Its `Graph evidence` section includes relation provenance rather than recursively dumping graph neighbors.

`memorix context` defaults to `--refresh auto`, so first use can seed Code State without a separate manual `memorix codegraph refresh`. Its brief puts live package/changelog/Git facts before memory hints and flags an old `ACTIVE_WORK.md`, legacy `progress.txt`, or legacy dev-log note as historical when it predates the latest changelog, so agents should treat current facts as the source of truth when files disagree. Use `--brief-json` for the same bounded brief plus a receipt of selected and omitted evidence; `--json` remains the detailed legacy diagnostic form. Task lenses keep the packet shaped to the work: bugfix briefs prefer failing tests and repros, release briefs prefer metadata/changelog/package checks, and onboarding briefs prefer docs and entry points while hiding unrelated suspect details. Continuation delivery is separate from the task lens: continuation language in `memorix_project_context` enables a bounded prior-work projection, and `memorix resume "..."` makes that choice explicit. It includes only the latest useful session summary, up to three readable durable memories, and at most one recent source-labelled compact checkpoint. Checkpoints are host lifecycle evidence, not durable memory or transcript backups; ordinary new tasks do not receive historical-session context. A completed MCP brief is the default retrieval boundary: search, detail, or Context Pack should expand it only for a named missing fact or an explicit request for deeper history. Use `--refresh never` for read-only inspection and `--refresh always` when you want to force a fresh scan.

Project-specific generated, vendored, or cache paths can be excluded from Code State with `[codegraph].exclude_patterns` in `memorix.toml` or `~/.memorix/config.toml` (`codegraph.excludePatterns` in legacy YAML). User patterns extend the built-in excludes and are applied to indexing, Project Context suggested reads, and Context Pack suggested reads.

SessionStart hooks keep the default minimal hint lightweight. When memory behavior is configured with `sessionInject=full`, Codex receives the compact Memory Autopilot brief at session start instead of only listing recent text memories. After a native compact, Codex receives one bounded checkpoint through its official `SessionStart` compact context channel. Claude Code receives one bounded checkpoint through the next official `UserPromptSubmit` context channel, then delivery stops. Pi and Oh-my-Pi retain the native summary fields their extension API exposes; hosts that do not expose a summary remain labelled as lifecycle-only. Set `memory.inject = "silent"` to disable automatic hook delivery.

The intended loop for agents is: get the project brief when it helps, inspect the suggested current files, use stale or unbound memory only as a lead, store durable outcomes after the work changes the project, and resolve obsolete memories.

### Evidence Cards and Feedback

Evidence Cards are the persisted provenance index for project memory. They do
not replace the observation, source file, commit, or test they point to. Every
observation write creates or refreshes a card with `sourceRef`, `locator`,
`capturedHash`, project ownership, files, verification state, and freshness.

CLI:

```bash
memorix evidence list --json
memorix evidence get --id 42 --json
memorix evidence stale --paths src/server.ts,tests/server.test.ts --json
memorix feedback record --id 42 --signal verification-success --source test:run-1 --json
memorix feedback audit --id 42 --json
```

MCP uses `memorix_evidence` for `list`, `get`, `sync`, `stale`, and `events`,
and `memorix_feedback` for `record`, `show`, and `audit`. Feedback events are
append-only; `revoke` points at the event being undone, so the audit history is
preserved. A memory without explicit feedback keeps the legacy relevance and
retention score. The first feedback event opts that candidate into the
feedback projection.

### HTTP MCP Compatibility

Legacy clients use stateful Streamable HTTP with `Mcp-Session-Id`. Current
stateless clients send `Mcp-Protocol-Version: 2026-07-28` and receive a durable
`Mcp-Project-Handle`. Send that handle on subsequent requests; it is persisted
in SQLite and remains valid across service restart until its TTL expires.
`/protocol-diagnostics` reports the current/legacy contract and explicitly
reports Tasks and polling as unsupported when the pinned SDK cannot provide a
durable implementation. When MCP discovery is unavailable, use one bounded
`memorix context --fallback` request for a task; repeated fallback probing is
rejected by the local budget.

The built-in Lite provider indexes common code files with lightweight file, symbol, and import facts. It is a structural fallback, not a language-server-quality graph. When a project already has a healthy local CodeGraph index, `[codegraph].external_context = "auto"` may add a validated, bounded semantic outline to the Workset. Memorix never initializes, syncs, or exports that external index, and never stores its raw source output. `memorix codegraph status --json`, `memorix doctor --json`, and Project Context JSON identify the actual provider quality.

### Knowledge Workspace and Workflows

`memorix knowledge` is the deliberate, reviewable knowledge-management path. It uses source-backed claims to compile Markdown proposals, protects manually edited pages, and can keep canonical project workflows separate from agent-specific adapters.

```bash
memorix knowledge init --mode local
memorix knowledge status
memorix knowledge claims
memorix knowledge review --id <claim-id> --review approved --detail "checked current source evidence"
memorix knowledge compile
memorix knowledge lint
memorix knowledge apply --proposal <id>
memorix knowledge workflow import
memorix knowledge workflow select --task "prepare a release"
memorix knowledge workflow preview --id <workflow-id> --agent codex
```

The advanced MCP action tool is `memorix_knowledge`. It is registered only in the `team` and `full` tool profiles so normal agents keep the compact micro/lite tool surface. Its actions are `workspace_init`, `status`, `claim_list`, `claim_review`, `compile`, `lint`, `proposal_apply`, `workflow_import`, `workflow_list`, `workflow_select`, `workflow_preview`, `workflow_apply`, and `workflow_run`. Explicit agent observations become `needs-review` claim candidates: check their source evidence, then use `claim_review` with a reason to approve or reject them. Only approved claims can be compiled into publishable Knowledge Workspace pages. Ordinary coding work should stay on `memorix_project_context`.

`memorix_compaction_checkpoint` is a separate advanced MCP action tool registered only in the `full` profile. Its `list`, `show`, `context`, and `archive` actions match `memorix checkpoint` for explicit continuity inspection. Normal agents should not call it during ordinary work; automatic recovery and `memorix_project_context` already handle the bounded path.

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
- optional `visibility`: `project` (default), `personal`, or `team`
- optional `longTerm`: an explicit source-backed long-term record with `kind` (`episodic`, `semantic`, or `procedural`), an optional `scope` (`project`, `user`, or `team`), tags, and applicability

Visibility controls who can retrieve a record through agent-facing memory
tools. Normal memories default to `project`. `personal` and `team` writes
require a joined coordination identity; a personal record is readable only by
its creator and explicitly named recipients. Supplying a `topicKey` never
lets an agent overwrite a record outside its write scope.

When the current Autopilot task is read-only or explicitly says not to modify
files, `memorix_store` returns without writing. Use `overrideReadOnly: true`
only when the user explicitly asks to preserve a record during that task.

`longTerm` is deliberately opt-in. It stores the normal Observation first, then
creates a separate record with an evidence reference. Because an explicit
request carries its own source evidence, the new record is auto-qualified on
the spot and enters Task Worksets as durable context; approval remains an
explicit operator review. Manage records with `memorix memory long-term
list|show|approve|archive|supersede`. Source-derived entries remain
project-bound; only a manual or user-confirmed `user + portable` record created
through the CLI may cross local projects for the same local installation.
Hook-captured and git-derived candidates stay in the candidate state until
qualified.

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
- `purpose` when deliberately expanding beyond the current Autopilot brief
- `force: true` only when the user explicitly asks to re-read a record already represented in that brief

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

Fetch full observation, mini-skill, or curated long-term memory detail.

After `memorix_project_context`, use `purpose` only for a named missing fact. Set `force: true` only when the user explicitly asks for the full underlying record already represented in the brief.

Supports two modes:

- `ids` for current-project observations
- `refs` for project-aware cross-project lookup
- `typedRefs` for typed observation/skill refs and a `durable:<uuid>` reference
  emitted by a Task Workset. A matching `user + portable` durable item is
  intentionally reusable across local projects, but remains background guidance
  rather than a current-project fact.

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

```json
{
  "typedRefs": ["durable:9f3d9a6d-1111-4222-8333-abcdefabcdef"],
  "purpose": "Need the full verified release procedure before publishing."
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

Exports contain only observations visible to the calling agent. An unbound
agent receives project-visible observations only; personal and team records
require its explicit active identity.

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

### `memorix_audit_project`

Scan the current project for observations that may have been written to the
wrong project bucket — entities that appear exclusively in a different
project. Read-only; nothing is changed.

Available in the `full` tool profile (`MEMORIX_MODE=full` or `--mode full`).

Important inputs:

- optional `threshold` — minimum occurrences in another project to flag
  (default: 2)

Archive confirmed mis-attributed observations with `memorix_resolve`.

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

- `MEMORIX_SESSION_TIMEOUT_MS` — HTTP MCP session idle timeout in milliseconds. Default: `43200000` (12 hours). Expired session IDs receive a fast `404` with a reinitialize hint. Increase this for long-lived clients, for example `86400000` for 24 hours; set `0` only when the host provides reliable lifecycle cleanup.

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

A targeted handoff is private to its sender and recipient. A handoff without
`toAgentId` is visible only to active members of that project's team. Reading a
targeted handoff does not give its recipient permission to rewrite or resolve
it on behalf of the sender.

---

## 10. Controlled Media and Legacy Ingestion

### `memorix media`

`memorix media` is the complete operator surface for local media assets. It
accepts an explicit local regular file, validates its type and size, stores a
content-addressed copy outside the Git worktree, and only enters normal memory
when attached. It does not ingest arbitrary URLs or capture screenshots
automatically.

The default controlled-asset limit is 100 MiB. `memorix ingest image` and the
legacy MCP image path limit automatic vision analysis to 20 MiB. Larger images
can still be imported and attached; they receive a text fallback instead of an
oversized provider request.

```bash
memorix media import --path ./architecture.png --json
memorix media list --kind image --json
memorix media show --asset <asset-id> --json
memorix media attach --asset <asset-id> --title "Architecture diagram" --json
memorix media remove --asset <asset-id> --force --json
memorix media cleanup --max-bytes 1073741824 --json
```

MiniMax image creation is an explicit CLI action. Video creation is queued as a
durable job, so it survives process restarts and can be inspected or cancelled.

```bash
memorix media generate image --prompt "..." --json
memorix media generate image --prompt "..." --image ./reference.png --json
memorix media generate video --prompt "..." --json
memorix media derive-pdf --asset <asset-id> --attach --json
memorix media derive-audio --asset <asset-id> --provider groq --attach --json
memorix media status --job <media-job-id> --json
memorix media cancel --job <media-job-id> --json
```

Set `MINIMAX_API_KEY` (or `MINIMAX_CN_API_KEY`) outside Git before using
generation. Image-to-image passes the reference image through MiniMax
`subject_reference` for the image-01/image-01-live models. `memorix_media` is
the matching single MCP tool in every profile, including `micro`. Its
import/attach/list/show/derive-pdf/derive-audio/status/cancel actions are
available normally; generation requires `MEMORIX_MCP_MEDIA_GENERATION=1`
because it can incur provider charges. Text-only embedding providers never
produce a pretend image, audio, video, or document vector.

Audio transcription is also explicit. `derive-audio` consumes an existing
controlled audio asset and queues a durable transcript derivative. It supports
`openai` (`OPENAI_API_KEY`) and `groq` (`GROQ_API_KEY`) with no credential
fallback between them. MCP transcription is disabled until
`MEMORIX_MCP_MEDIA_TRANSCRIPTION=1` is deliberately set.

### `memorix_ingest_image`

This is the legacy full-profile MCP compatibility tool. It accepts image bytes,
imports the verified image into the same controlled media library, then creates
a text retrieval projection. Prefer `memorix_media` for new agent integrations.

Important inputs:

- `base64`
- optional `filename`
- optional `prompt`

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
