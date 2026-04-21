# Performance and Resource Notes

Memorix is designed to be light for everyday memory use and explicit about heavier paths. This document is a practical operator guide, not a benchmark paper.

## Runtime Shape

| Mode | What Runs | Typical Use |
| --- | --- | --- |
| `memorix serve` | One stdio MCP process, started by the client | Lightweight IDE/agent memory access |
| `memorix background start` | One long-lived local Node HTTP control-plane process | Dashboard, HTTP MCP, multi-session workflows |
| `memorix serve-http` | Same HTTP control plane in the foreground | Debugging or supervised launches |
| `memorix` | Interactive terminal UI | Human operator workbench |
| `memorix orchestrate` | Supervisor plus spawned CLI agent workers | Autonomous multi-agent loops |

The default memory path uses local SQLite as the canonical store and Orama for search/indexing. No cloud service is required.

## What Is Lightweight

- `memorix_session_start` is lightweight by default. It opens a memory/session context and does not join team collaboration unless `joinTeam: true` is explicitly set.
- stdio MCP starts on demand and exits with the client.
- HTTP background mode idles as a single local process.
- LLM enrichment is optional. Without `MEMORIX_LLM_API_KEY` or `OPENAI_API_KEY`, Memorix uses local heuristic dedup/search behavior.

On the release development machine used for this check, the healthy HTTP control plane was observed at about 16 MB working set after several hours idle. Treat this as a local sanity observation, not a platform-wide guarantee.

## What Can Be Heavier

- `npm run build`, `npx vitest run`, and Docker image builds can use substantial CPU and disk while they run.
- Docker image size mostly comes from Node, npm dependencies, build artifacts, and image layers. The container runtime should be judged separately from image size.
- Dashboard browsing can add browser-side memory and CPU outside the Memorix Node process.
- Large imports, Git log ingestion, workspace sync, and skill generation can temporarily increase CPU and disk I/O.
- LLM-backed formation, reranking, extraction, and skill generation add network latency and provider cost when enabled.
- `memorix orchestrate` intentionally runs multiple agent workers, so its resource profile is closer to a multi-process build/test loop than a memory daemon.

## Useful Knobs

| Knob | Default | Use When |
| --- | --- | --- |
| `MEMORIX_SESSION_TIMEOUT_MS` | `1800000` (30 min) | Increase for HTTP MCP clients that do not recover from stale session IDs after idle time |
| `MEMORIX_LLM_API_KEY` / `OPENAI_API_KEY` | unset | Enable LLM-backed enrichment, extraction, rerank, or skill generation |
| `MEMORIX_RERANK_TIMEOUT_MS` | provider default | Bound slow LLM rerank calls |
| `memorix retention status` | report only | Inspect whether memory growth needs cleanup |
| `memorix retention archive` | explicit | Archive expired memories when the project gets noisy |
| `memorix memory deduplicate` / `consolidate` | explicit | Reduce duplicate or scattered memory records |

## Operator Guidance

- For memory-only use, prefer stdio MCP or a lightweight `memorix_session_start`; do not join team collaboration by default.
- For long-lived IDE sessions over HTTP, set `MEMORIX_SESSION_TIMEOUT_MS=86400000` before `memorix background start` if your client is stale-session-sensitive.
- For Docker, use it when you want a managed HTTP control plane. Do not use image size alone as the runtime memory estimate.
- For autonomous multi-agent work, expect CPU and disk activity proportional to the spawned agents and verification commands.
- For release checks, measure build/test/pack separately from idle service cost.

## Current Optimization Opportunities

These are not release blockers, but they are reasonable future improvements:

- Add a lightweight benchmark command that reports startup time, index size, SQLite size, and search latency.
- Add dashboard-side performance telemetry for API latency and payload sizes.
- Document recommended retention schedules for large projects.
- Explore slimmer Docker layers if image size becomes a common pain point.
