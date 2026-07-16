# Runtime Integrity 1.1.11 Design

Branch: `codex/1.1.11-runtime-integrity`
Date: 2026-07-14
Status: implemented, awaiting release verification

## Summary

1.1.11 is a reliability release. It makes Memorix behave like a durable local
runtime instead of a collection of synchronous maintenance paths hidden behind
MCP calls. The release focuses on the paths a coding agent experiences first:
startup, first context, writes, retrieval, Code Memory refresh, and operator
diagnostics.

The design keeps Memorix local-first. SQLite remains the source of truth;
Orama remains the in-process retrieval index. The release does not pretend that
all expensive work is free or instantaneous. It makes the boundary explicit:
interactive tools return project-scoped persisted state, while corpus-scale
work has a durable queue and runs outside the MCP request path.

## Product Contract

- An MCP handshake and the first project brief must not wait for a full
  all-project Orama hydration.
- A normal memory write must not rewrite the whole observation corpus.
- Code Memory refresh, retention, and consolidation must not execute inside a
  tool handler or the HTTP control-plane event loop.
- Maintenance must survive a process restart, be observable, retry safely, and
  not grow its own history forever.
- A context brief may use the latest completed Code Memory scan, but must say
  when a refresh is queued instead of implying that a scan already happened.
- Dashboard and HTTP control-plane reads must stay project-scoped.

## Readiness Model

Memorix has three independent readiness states:

1. **Transport readiness**: MCP initialize and `tools/list` are complete.
2. **Interactive readiness**: project-scoped SQLite reads can answer the
   initial context, graph-context, context-pack, and Code Memory status tools.
3. **Maintenance readiness**: Orama hydration, vector recovery, retention,
   consolidation, and Code Memory refresh are working or queued.

Only tools that truly need the in-memory retrieval index wait for full runtime
initialization. This is deliberate: a compact project brief is more valuable
than making a new agent wait for unrelated historical data to load.

## P1-P9 Delivery

### P1: Targeted Persistence

- Replace normal observation writes and status changes with targeted SQLite
  reads/mutations.
- Preserve topic-key convergence and generation-based cross-process freshness.

### P2: Bounded Lifecycle Work

- Make retention and consolidation page through one project with durable
  cursors.
- Treat explicit global archival/export as operator operations, not normal MCP
  request work.

### P3: Durable Maintenance Ledger

- Add SQLite-backed jobs with dedupe keys, leases, heartbeat renewal, retry
  backoff, and resumable payloads.
- Prune completed task history after seven days while keeping failed diagnostics
  available to operators. Sanitize credentials before persisting failures.

### P4: Real Isolation for Heavy Work

- Run retention, consolidation, and Code Memory refresh in a built child
  runner, not a timer callback in the MCP process.
- Keep vector backfill in the owning process because Orama is process-local.

### P5: Incremental Code Memory at Scale

- Refresh changed files only; retain unchanged file metadata and remove deleted
  graph records safely.
- Exclude dependency/build directories by default, cap scans by file count,
  and skip source files larger than 2 MiB by default. The file cap is
  configurable through `codegraph.max_file_bytes` / `max_file_bytes`.

### P6: First-Tool MCP Boundary

- Let `memorix_project_context`, `memorix_context_pack`,
  `memorix_graph_context`, and `memorix_codegraph_status` read project-scoped
  stores before full Orama hydration.
- Keep search, writes, sessions, and all stateful operations behind full
  runtime initialization.

### P7: Cross-Process Correctness

- Remove the obsolete JSON polling watcher. SQLite generation checks are the
  authoritative cross-process refresh mechanism.
- Register HTTP control-plane project roots durably so shared workers can run
  isolated maintenance against the correct project.
- Resolve runtime behavior through the same TOML/YAML chain as the rest of the
  product, with legacy JSON behavior only as a fallback.

### P8: Operator Surface and Deployment Safety

- Expose maintenance summary and job diagnostics through dashboard APIs and
  the existing System Status panel.
- Keep the production image non-root and cover it with a release test.
- Make the dashboard usable on mobile by replacing the desktop sidebar with a
  compact wrapping navigation layout.

### P9: Verification and Release

- Cover queue leases, retries, history retention, credential redaction,
  isolated child execution, incremental Code Memory, config resolution,
  project-scoped dashboard reads, and bootstrap-safe tools.
- Build the package, smoke the actual child runner, and connect a standards
  compliant MCP client to the built stdio server.

## Design Influences

Cognee is useful as a design reference for separating durable knowledge state
from compute-heavy graph enrichment and for treating lifecycle/decay as part of
the product rather than a cleanup script. Memorix retains a different product
shape: local project memory for existing coding agents, without requiring a
remote graph service or making all context a graph query.

## Non-Goals

- Replacing a full AST code intelligence product or claiming CodeGraph Lite is
  equivalent to a language server.
- Moving Orama to a cross-process shared index in this patch release.
- Adding cloud synchronization, new agent protocols, or a new user command
  family.
- Automatically deleting failed maintenance diagnostics.

## Remaining Architectural Boundary

Search remains backed by a process-local Orama index and therefore still needs
full runtime hydration before the first search. The new bootstrap-safe tools
give an agent useful, project-scoped context immediately; replacing Orama with
a shared persistent retrieval index is a separate major-version decision, not
a hidden 1.1.x refactor.
