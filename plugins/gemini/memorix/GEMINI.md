# Memorix

This extension adds Memorix memory guidance for the active Gemini CLI workspace.

Use Memorix when prior workspace context, decisions, fixes, or handoff state would materially help the current task and Memorix tools are available.

- Use `memorix_project_context` first for continuation, fresh handoff, or unfamiliar coding work.
- If the MCP tool is not visible yet but the client supports tool discovery or dynamic loading, search/select `memorix_project_context` first. Run `memorix context --task "<task>"` only after MCP is unavailable, disabled, or not discoverable.
- Use `memorix_context_pack` when you need structured refs and freshness for code-bound memories.
- Use `memorix_graph_context` for explicit memory graph questions.
- Use `memorix_search` for focused lookup.
- Use `memorix_detail` before relying on a specific memory.
- Use `memorix_store` for durable workspace knowledge.
- Use `memorix_store_reasoning` for the reason behind a technical decision.
- Use `memorix_resolve` when completed or outdated memories should stop surfacing.

Do not store secrets, credentials, raw private transcripts, or trivial one-off actions.
