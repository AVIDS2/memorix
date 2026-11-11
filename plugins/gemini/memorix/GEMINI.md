# Memorix

This extension adds Memorix memory guidance for the active Gemini CLI workspace.

Use Memorix when prior workspace context, decisions, fixes, or handoff state would materially help the current task and Memorix tools are available.

- Call `memorix_project_context` with the user's actual task for continuation, fresh handoff, or unfamiliar coding work so Memorix can choose a task-lensed brief.
- If the MCP tool is not visible yet but the client supports tool discovery or dynamic loading, search/select `memorix_project_context` first. Run `memorix context --task "<task>" --fallback --brief-json` only after MCP is unavailable, disabled, or not discoverable, and pass the user's real task text.
- Use `memorix_context_pack` when you need structured refs and freshness for code-bound memories.
- Use `memorix_graph_context` for explicit memory graph questions.
- Use `memorix_search` for focused lookup.
- Use `memorix_detail` before relying on a specific memory.
- Use `memorix_store` for durable workspace knowledge.
- Use `memorix_evidence` when you need to check a memory's source, freshness, or verification state.
- Use `memorix_feedback` when a memory helped, conflicted with current evidence, or was corrected.
- Use `memorix_media` for controlled local media import, inspection, and derivation; provider-backed generation remains explicitly gated.
- Use `longTerm` on `memorix_store` only for a stable fact, reusable procedure, or completed episode that merits explicit review. It creates a candidate, not live context; keep the default project scope and do not use it for routine updates.
- A `user` + `portable` durable memory in a task brief is intentionally reusable across projects. When it matches the task, use it as background even if it originated elsewhere; it is not a current-project fact. Expand it only when needed with `memorix_detail` and `typedRefs: ["durable:<id>"]`, stating the missing fact as `purpose`.
- Use `memorix_store_reasoning` for the reason behind a technical decision.
- Use `memorix_resolve` when completed or outdated memories should stop surfacing.

The standard extension uses the `lite` MCP profile (20 tools). Coordination and advanced tools are opt-in through `--mode team` or `--mode full`; use the CLI fallback instead of repeatedly probing unavailable tools.

Do not store secrets, credentials, raw private transcripts, or trivial one-off actions.
