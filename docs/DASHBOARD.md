# Dashboard

The Memorix Dashboard is the local control surface for inspecting project memory and running explicit maintenance. It is available through the shared background service or as a standalone local process.

The 1.8.0 Evidence page is the operator view of the same source-backed cards
used by MCP and CLI. It shows each card's source reference, locator, captured
hash, freshness, verification state, and audit-event count. It is project
scoped and does not replace the underlying observation or code source.

## Start

```bash
memorix background start
# dashboard: http://127.0.0.1:3211

memorix dashboard
# standalone dashboard: http://127.0.0.1:3210
```

Both modes read the same project-scoped stores. The project switcher changes the active project filter; it does not merge projects or grant access to personal memories.

## Coordination Status

The Coordination Status page is a read-only projection of the selected project's persistent coordination state. `TeamStore` is the canonical SQLite layer for agents, tasks, messages, locks, handoffs, and poll state; the Dashboard does not keep a second in-memory coordination registry.

The page reports agents, task status, file locks, and handoffs for the selected project. It exposes no team or task write endpoints and is not a task execution or full orchestration platform. If the SQLite read fails, the API returns an explicit degraded/error status and the page shows that the status is unavailable instead of presenting an empty result as healthy.

## Maintenance Workbench

The Observations page exposes three explicit maintenance actions:

| Action | Effect | Shared implementation |
| --- | --- | --- |
| Cleanup | Deletes low-quality activity records and exact duplicates; optionally archives test/demo noise | `analyzeCleanupObservations` and `applyCleanupMutations` |
| Consolidate | Merges strongly similar project-visible observations while preserving facts and references | `findConsolidationCandidates` and `executeConsolidation` |
| Deduplicate | Uses the configured memory LLM to identify redundant or superseded records and marks them resolved | `planMemoryDeduplication` and `applyDeduplicationPlan` |

The Retention page exposes Archive for records already classified as archive candidates by the canonical retention projection.

Every action follows the same contract:

1. The Dashboard requests a project-scoped preview.
2. The server returns the candidate records, counts, and a signed preview token.
3. The user confirms the displayed plan.
4. Execution verifies the token and current candidate set before mutating data.
5. If memory changed after preview, execution fails with `409` and requires a new preview.

Cleanup noise archival is opt-in. Consolidation never touches personal or team-scoped observations from an unbound Dashboard. Deduplication marks records resolved rather than deleting them. Retention changes status to archived. Manual selection and hard deletion remain separate from the maintenance workbench.

## HTTP Contract

Maintenance endpoints are local Dashboard APIs and are not a replacement for MCP or CLI integrations:

```text
POST /api/maintenance/cleanup/preview
POST /api/maintenance/cleanup/execute
POST /api/maintenance/consolidate/preview
POST /api/maintenance/consolidate/execute
POST /api/maintenance/deduplicate/preview
POST /api/maintenance/deduplicate/execute
POST /api/maintenance/retention/preview
POST /api/maintenance/retention/execute
```

Use the CLI for scripts and remote terminals. Use MCP for agent-driven maintenance. The Dashboard is the reviewable local operator surface; all three call the same maintenance logic.

The control-plane API also exposes `GET /api/evidence?project=<id>` for the
bounded Evidence Console payload. The page is responsive at desktop, tablet,
and narrow mobile widths; long paths wrap instead of widening the viewport,
and maintenance dialogs remain viewport-centered.
