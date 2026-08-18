# Dashboard

The Memorix Dashboard is the local control surface for inspecting project memory and running explicit maintenance. It is available through the shared background service or as a standalone local process.

## Start

```bash
memorix background start
# dashboard: http://127.0.0.1:3211

memorix dashboard
# standalone dashboard: http://127.0.0.1:3210
```

Both modes read the same project-scoped stores. The project switcher changes the active project filter; it does not merge projects or grant access to personal memories.

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
