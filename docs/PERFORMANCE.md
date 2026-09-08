# Performance and Resource Notes

Memorix is designed to be light for everyday memory use and explicit about heavier paths. This document is a practical guide, not a benchmark paper.

## Runtime Shape

| Mode | What Runs | Typical Use |
| --- | --- | --- |
| `memorix serve` | One stdio MCP process, started by the client | Lightweight IDE/agent memory access |
| `memorix background start` | One long-lived local Node HTTP service process | Dashboard, HTTP MCP, multi-session workflows |
| `memorix serve-http` | Same HTTP service in the foreground | Debugging or supervised launches |
| `memorix` | Interactive terminal UI | Human operator workbench |
| `memorix orchestrate` | Supervisor plus spawned CLI agent workers | Orchestrated subagent loops |

The default memory path uses local SQLite as the canonical store. Orama remains
the in-process compatibility/semantic fallback; large corpora use SQLite FTS5
and, when available, the local LanceDB semantic shadow index. No cloud service
is required.

## Resource Safety Model

Memorix does not impose a small maximum number of memories. SQLite remains the
durable corpus, and large projects are processed in batches. The important
limits are on **simultaneous work and disposable caches**, not on how much the
user is allowed to remember.

- A deferred vector backfill uses one cross-process worker lock per shared data
  directory. Repeated hook events add to the durable queue; they do not spawn a
  new Node process for every event.
- A retrying vector job stays in cooldown. A provider outage therefore cannot
  create a process storm every time another hook fires.
- One backfill worker drains due vector jobs sequentially and releases its
  SQLite/Orama state when it exits. A dead worker lock is recoverable by PID
  liveness, with a long stale-lock fallback for interrupted filesystems.
- Startup index hydration builds Orama documents in bounded batches and cached
  vector attachment is also batched. This limits peak temporary allocations
  without dropping durable observations.
- The API embedding cache is a disposable working cache. Its default byte
  budget is large and can be raised with `MEMORIX_EMBEDDING_CACHE_MAX_BYTES`,
  but it is deliberately separate from the durable memory corpus. Cache
  eviction never deletes a memory; a later vector backfill can regenerate it.
- `serve-http` `/health` exposes `rss`, V8 heap, external memory, array-buffer
  memory, and the V8 heap limit so a real saturation report can distinguish
  JavaScript retention from native/model memory.

## Retrieval Profiles

| Profile | Default? | Network work | Best fit |
| --- | --- | --- | --- |
| `fast` | No | Never | Scripts, probes, latency-sensitive agent steps |
| `balanced` | Yes | Optional embedding only | Everyday search |
| `thorough` | No | Optional embedding plus explicitly enabled memory LLM work | A deliberate deep investigation |

Use `--quality fast|balanced|thorough` with `memorix memory search` or
`memorix search`; the `memorix_search` MCP tool and SDK expose the same field.
`fast` is fully local. `balanced` keeps optional LLM query rewriting and
reranking out of the normal search path. `thorough` is opt-in because it can
add provider latency and cost.

`OPENROUTER_API_KEY` may provide an API key for an OpenRouter embedding endpoint.
It does not enable the memory-LLM lane unless that lane explicitly selects
OpenRouter through its provider or base URL.

## Interactive and Maintenance Boundaries

MCP transport readiness is separate from full search-index readiness. The first
project-scoped tools (`memorix_project_context`, `memorix_context_pack`,
`memorix_graph_context`, and `memorix_codegraph_status`) read SQLite and
CodeGraph Memory directly, so a new agent can get a useful brief without
waiting for unrelated historical records to hydrate into Orama.

Search and ordinary writes use the durable SQLite path directly when the
persistent indexes are available. Corpus-scale retention, consolidation, and
Code Memory refresh are queued durably and run in an isolated child process.
Vector backfill updates the persistent semantic shadow index and keeps Orama as
the compatibility fallback.

## What Is Lightweight

- `memorix_session_start` is lightweight by default. It opens a memory/session context and does not join orchestration coordination state unless `joinTeam: true` is explicitly set.
- stdio MCP starts on demand and exits with the client.
- HTTP background mode idles as a single local process.
- LLM enrichment is optional. Without `MEMORIX_LLM_API_KEY` or `OPENAI_API_KEY`, Memorix uses local heuristic dedup/search behavior.

On the release development machine used for this check, the healthy HTTP service was observed at about 16 MB working set after several hours idle. Treat this as a local sanity observation, not a platform-wide guarantee.

## What Can Be Heavier

- `npm run build` and `npx vitest run` can use substantial CPU and disk while they run. Local verification uses the sequential Node/npm build and does not require Docker; Docker image builds are reserved for the VPS/hosted deployment path.
- Docker image size mostly comes from Node, npm dependencies, build artifacts, and image layers. The container runtime should be judged separately from image size.
- Dashboard browsing can add browser-side memory and CPU outside the Memorix Node process.
- Large imports, Git log ingestion, workspace sync, and skill generation can temporarily increase CPU and disk I/O.
- Code Memory refresh walks the project tree. It is incremental, skips common
  dependency/build directories, caps files by count, and skips files over 2
  MiB by default, but very large source trees still need time to scan.
- LLM-backed formation, reranking, extraction, and skill generation add network latency and provider cost when enabled.
- `memorix orchestrate` can run multiple agent workers. Parallel runs also create Git worktrees under `.worktrees/`, so expect extra disk usage until successful worktrees are merged and cleaned up.

## Useful Knobs

| Knob | Default | Use When |
| --- | --- | --- |
| `MEMORIX_SESSION_TIMEOUT_MS` | `43200000` (12 h) | Set a shorter GC window for supervised clients, or `0` to disable idle session GC |
| `MEMORIX_FORMATION_TIMEOUT_MS` | `12000` (12 s) | Raise when LLM-backed formation should outlive slow proxy/provider hops |
| `MEMORIX_LLM_API_KEY` / `OPENAI_API_KEY` | unset | Enable LLM-backed enrichment, extraction, rerank, or skill generation |
| `MEMORIX_LLM_TIMEOUT_MS` | `30000` (30 s) | Bound a single LLM-backed extraction/resolve call |
| `MEMORIX_RERANK_TIMEOUT_MS` | 30000 | Bound HTTP and LLM rerank calls |
| `MEMORIX_RERANK_PROVIDER` | `off` | Set `http` to enable optional HTTP rerank |
| `MEMORIX_RERANK_BASE_URL` | `[memory.llm].base_url` | Compatible `/rerank` API root (path `/rerank` is appended) |
| `MEMORIX_EMBEDDING_CACHE_MAX_BYTES` | `268435456` | Disposable in-process API-vector cache budget; raise for large warm caches, or lower when the host is memory constrained |
| `MEMORIX_ORAMA_HYDRATION_THRESHOLD` | `10000` | Above this durable corpus size, skip full Orama hydration and use persistent SQLite/semantic indexes; this is a working-set threshold, not a memory quota |
| `MEMORIX_SEMANTIC_INDEX` | `auto` | `auto` uses the optional local LanceDB shadow index when installed; `off` or `orama` keeps the legacy semantic path |
| `MEMORIX_SEMANTIC_INDEX_THRESHOLD` | `10000` | Minimum vectors before the optional HNSW/SQ index is trained; vectors remain searchable before training |
| `memorix memory search --quality fast` | n/a | Force a fully local retrieval path for a latency-sensitive call |
| `npm run benchmark:retrieval -- --records 1000 --runs 100` | n/a | Reproduce hot in-process lexical retrieval latency; not an end-to-end claim |
| `npm run gate:large-store -- --records 40000` | n/a | Exercise SDK, HTTP MCP, hook persistence, cache integrity, and reopen behavior against a large isolated store |
| `[codegraph].max_file_bytes` | `2097152` | Raise only when a large file is intentional source that should enter Code Memory |
| `memorix retention status` | report only | Inspect whether memory growth needs cleanup |
| `memorix retention archive` | explicit | Archive expired memories when the project gets noisy |
| `memorix memory deduplicate` / `consolidate` | explicit | Reduce duplicate or scattered memory records |

## Operator Guidance

- For memory-only use, prefer stdio MCP or a lightweight `memorix_session_start`; do not join orchestration coordination state by default.
- HTTP sessions now default to 12 hours and return a fast `404` with a reinitialize hint after expiry. Set `MEMORIX_SESSION_TIMEOUT_MS=0` only when the host has its own reliable lifecycle cleanup; otherwise retain a bounded GC window.
- If LLM-backed formation is timing out against a slow proxy/provider, raise `MEMORIX_FORMATION_TIMEOUT_MS` and keep it higher than `MEMORIX_LLM_TIMEOUT_MS`, because the full pipeline can include multiple LLM-backed stages.
- For Docker, use it when you want a managed HTTP service. Do not use image size alone as the runtime memory estimate.
- For orchestrated subagent work, expect CPU and disk activity proportional to the spawned agents and verification commands.
- For release checks, measure build/test/pack separately from idle service cost.
- When comparing retrieval latency, report cold CLI, warm in-process SDK, MCP/HTTP, remote embedding, and LLM-enhanced paths separately. They have materially different costs.
- When Dashboard shows queued or failed maintenance work, inspect
  `/api/maintenance` on that local dashboard before assuming a Code Memory scan
  or lifecycle task completed.
- When investigating CPU/RAM growth, inspect `memorix background status --json`
  or `/health` first. Look for multiple `vector-backfill-runner` processes,
  rising `rss` with stable heap, or rising V8 `heapUsed`; those indicate
  different classes of problem and should not be “fixed” by lowering the
  memory corpus limit.
- When a corpus crosses `MEMORIX_ORAMA_HYDRATION_THRESHOLD`, the complete
  durable corpus remains in SQLite. Only the per-query candidate set is loaded
  into the agent process. Management actions such as export, retention, and
  detail views may intentionally load the requested full/project slice.

## Large-Store Release Gate

`npm run gate:large-store -- --records 40000` builds Memorix and creates a
temporary Git project with an isolated data directory. It runs with embeddings
disabled, so it does not use provider credentials or make paid network calls.
The gate measures steady-state writes, first lexical search, process memory,
HTTP readiness, MCP initialize/bind/context/search/store, hook capture, and an
SDK close/reopen cycle. Every network request has a hard timeout, and the
report fails when an interactive path exceeds its release budget. It also
verifies that the personal hook candidate remains durable on disk without
becoming visible to an unbound SDK reader.

Small stores may use bounded Orama batches. Large stores skip that hydration and
use the persistent FTS5 path immediately; the optional semantic shadow index is
opened independently. The MCP search number is intentionally a cold
control-plane measurement and includes only the work still owed by the selected
derived indexes.

Results are machine-specific and should be compared on the same OS and Node
version. The release gate is an integrity and regression check, not a public
latency guarantee.

## 1.9.1 Large-Scale Retrieval Contract

The 1.9.1 line improves retrieval latency without shrinking the user's durable
memory corpus. SQLite remains the source of truth. Search indexes are derived,
rebuildable working structures, following the same boundary used by mature
memory systems that keep human-readable or durable records separate from their
vector/lexical indexes.

The release contract is:

1. A normal lexical or exact-identifier query must be able to use a persistent
   SQLite FTS5 index and fetch only bounded candidates. It must not require
   hydrating every observation into Orama first.
2. FTS5 must be feature-detected. Older or degraded SQLite runtimes fall back
   to the existing Orama path without losing data or changing write semantics.
3. Inserts, updates, deletes, imports, and sync applies must keep the derived
   lexical index current. A rebuild command/test path must repair it after an
   interrupted migration or manual database recovery.
4. Candidate generation, graph/code references, and optional reranking must be
   separately measurable. Reranking is applied only to a small candidate set;
   it must never scan or send the whole corpus to a provider.
5. No durable observation count, retention rule, or user-facing memory quota is
   introduced by this work. Limits apply only to per-query candidates, caches,
   and concurrent maintenance work.
6. Large-store acceptance must report cold start, warm search, MCP search, RSS,
   heap, index mode, result integrity, and recall of planted records at 1k,
   10k, 40k, and 100k records. A slower machine is evidence to report, not a
   reason to quietly lower the corpus size.

The implementation target is SQLite FTS5 plus an optional local LanceDB shadow
index. LanceDB stores only vector IDs and filter metadata, and is loaded at
runtime so the main package still builds on platforms where its native binary
is unavailable. HNSW with scalar quantization is trained only after the vector
table crosses the semantic-index threshold; before that, the table remains
queryable without paying a large training spike. Orama remains the compatibility
fallback. A server-only vector database is not a default dependency for the
local-first product.

The retrieval shape is:

```text
SQLite observations (durable truth)
  -> FTS5 exact/lexical candidates
  -> optional vector candidates
  -> optional CodeGraph/knowledge candidates
  -> rank fusion
  -> optional rerank on the short list
  -> compact result IDs, then detail on demand
```

Measured Windows/Node 22 evidence for this implementation: 1k, 10k, 40k, and
100k records all passed the large-store gate. At 100k, peak RSS was about
419MB, SDK reopen was about 131ms, and the cold HTTP MCP search was about
296ms. These are same-machine acceptance numbers, not universal latency
promises. The release is complete only when the measurements and fallback
behavior remain recorded alongside the implementation.
