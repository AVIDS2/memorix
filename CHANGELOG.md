# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Changed
- **Coordination truth in Dashboard** -- the Dashboard Coordination Status page
  is a read-only project-scoped view backed by the persistent SQLite `TeamStore`
  for agents, tasks, messages, locks, handoffs, and poll state. It no longer
  falls back to an in-memory team snapshot or presents coordination read errors
  as a healthy empty result.

## [1.8.0] - 2026-08-23

### Added
- **Persisted Evidence Cards** -- observation provenance is stored in SQLite
  with project ownership, source reference, locator, captured hash, files,
  verification state, freshness, and audit events. Cards are available through
  `memorix_evidence`, `memorix evidence`, and the Dashboard Evidence Console.
- **Auditable memory feedback** -- verification, use, correction, source-change,
  conflict, strengthen, weaken, and revoke events materialize a bounded
  retrieval/retention weight without deleting the original source record.
- **Stateless MCP project handles** -- 2026-07-28-style requests can use an
  explicit `Mcp-Project-Handle` that survives service restart, while legacy
  stateful Streamable HTTP remains supported.
- **One-shot CLI fallback budget** -- repeated MCP-unavailable probing for the
  same project/task is deduplicated and fail-closed after one bounded context
  request.
- **Evidence Console** -- Dashboard includes a responsive, project-scoped
  evidence view with source, locator, freshness, verification, and audit count.

### Changed
- HTTP TeamStore resolution is project-data-directory scoped, preventing A/B
  coordination state from crossing when sessions bind different projects.
- The 1.8.0 documentation records the shipped compatibility adapter, explicit
  non-goals, fallback semantics, and the Antigravity/Gemini setup matrix.

### Fixed
- Preserve the 1.7 micro MCP profile's nine-tool budget by keeping Evidence and
  Feedback in lite/team/full profiles.
- Keep legacy relevance unchanged until a memory receives explicit feedback.
- Keep SQLite-backed HTTP helpers lazy so mocked and lightweight MCP startup
  paths do not open the database during module evaluation.

## [1.7.3] - 2026-08-22

### Added
- **Optional HTTP rerank** -- Thorough search with at least 3 candidates can
  reorder top hits through a configurable Cohere-compatible
  `POST {base_url}/rerank` endpoint (`{model, query, documents}`). Works with
  any compatible `/rerank` API. Configure `[rerank]` or `MEMORIX_RERANK_*`;
  base URL inherits the memory LLM lane when unset. Bearer inherits only
  when the effective rerank URL is that same trusted endpoint; a different
  host requires `MEMORIX_RERANK_API_KEY` / `rerank.api_key`. The model id
  is user-configured. When HTTP rerank is configured, a miss or timeout
  keeps the original order (no LLM fallback). LLM rerank remains available
  when HTTP rerank is off.

### Fixed
- **OpenAI-compatible provider base URLs** -- preserve explicit versioned paths
  such as Volcano Ark's `/api/v3` for ordinary chat, tool calling, streaming,
  and vision requests instead of appending an incorrect `/v1` segment.
- HTTP rerank honors `MEMORIX_RERANK_TIMEOUT_MS` on the inner fetch
  (default 30s) instead of aborting at 5s.
- HTTP rerank no longer inherits or transmits the memory LLM credential
  when `rerank.base_url` points at a different endpoint. If a Memory LLM
  key is present, that foreign host is not called until
  `MEMORIX_RERANK_API_KEY` / `rerank.api_key` is set.
- Codegraph CLI tests close git/sqlite sandboxes with retries so Windows
  `afterEach` cannot hang past vitest's 10s hookTimeout.

## [1.7.2] - 2026-08-19

### Changed
- **Faster large-store cold retrieval** -- startup hydration now inserts
  persisted observations into Orama in bounded batches. This avoids rebuilding
  index balance once per row while continuing to yield to HTTP health traffic.
- **Fail-closed large-store evidence** -- the reproducible 40,000-record gate
  now exercises and times HTTP readiness, MCP initialize/bind/context/search/
  store, hook capture, and SDK reopen behavior with hard request and release
  budgets instead of checking persistence alone.
- **Isolated index tests** -- startup hydration tests explicitly disable the
  embedding lane and restore the caller environment instead of reading an
  operator's provider configuration or local vector cache.
- **Current public guidance** -- README and canonical development/status docs
  now describe preview-first Dashboard maintenance and the 1.7 product line.

## [1.7.1] - 2026-08-19

### Fixed
- **Contained graph text** -- long graph node names, summaries, and relation
  targets now wrap inside the Dashboard tooltip and inspector instead of
  overflowing their containers.
- **Centered maintenance preview** -- the Cleanup preview dialog is centered
  on desktop and narrow screens, including after the Dashboard global reset
  styles are applied.
## [1.7.0] - 2026-08-18

### Added
- **Preview-first Dashboard maintenance** -- the Observations page now offers
  project-scoped Cleanup, Consolidate, and Deduplicate previews, while the
  Retention page can preview and archive canonical retention candidates. Every
  mutation shows its candidate set before confirmation.
- **Shared maintenance execution** -- Dashboard, CLI, and MCP use the same
  cleanup and deduplication planners/executors instead of maintaining separate
  mutation logic.

### Changed
- **Fail-closed maintenance actions** -- execution requires a signed,
  project-bound preview and rejects stale candidate sets with a refreshable
  conflict instead of applying a partial plan.
- **Conservative cleanup noise detection** -- normal engineering terms such as
  compatibility, handoff, sandbox, and version are no longer treated as noise;
  only explicit fixture markers and tool receipts are opt-in archive candidates.
- **Dashboard documentation** -- added the canonical Dashboard maintenance,
  scope, and safety contract to the public documentation map.

## [1.6.3] - 2026-08-18

### Fixed
- **Safe home-directory boundaries** -- project binding and SQLite now share
  the same effective `HOME`/`USERPROFILE` resolution on Windows, so an agent
  launched from a user directory is rejected consistently and cannot create a
  decoy `~/memorix.db`. Contributed by
  [@RaviTharuma](https://github.com/RaviTharuma) in #230, with a maintainer
  compatibility follow-up for Windows environment resolution.
- **Fast first session on large stores** -- `memorix_session_start` uses a
  bounded newest-first slice while the remaining hydration work continues in
  the background, keeping first contact responsive on large projects.

## [1.6.2] - 2026-08-18

### Changed
- **Responsive large-store control plane** -- HTTP health and MCP initialize
  no longer wait for full observation or embedding-cache hydration. Hook writes
  persist directly without loading the full corpus, one-shot CLI paths avoid
  cached-vector attachment, and ordinary embedding-disabled writes stay off
  the provider/configuration hot path. Contributed by
  [@RaviTharuma](https://github.com/RaviTharuma) in #214.
- **Bounded and crash-safe embedding cache** -- JSONL cache loading is bounded
  by a 256 MiB raw-vector payload budget, legacy JSON migration publishes via
  temporary-file rename, concurrent loads are single-flighted, and sidecar
  metadata avoids rescanning a large cache on every save.

### Fixed
- **SDK lifecycle and persistence parity** -- `MemoryClient.close()` releases
  its SQLite handle on Windows, reopening the same directory reloads a fresh
  store snapshot, and SDK clients use the same flat data directory as CLI,
  hooks, and HTTP MCP instead of the retired per-project directory layout.
- **Correct background entrypoint** -- `memorix background start` launches the
  built HTTP CLI entrypoint rather than the stdio library entry.

## [1.6.1] - 2026-08-17

### Fixed
- **Bounded hook lifecycle on every desktop platform** -- `memorix hook` now
  reads stdin with an idle bound, performs embedding writes in the deferred
  lane, and has a hard process deadline. The hook-specific V8 heap is 512 MiB
  instead of the control plane's 4 GiB. This prevents hung hook processes and
  associated CPU or memory pressure on macOS, Windows, and Linux. The Windows
  CLI heap restart also hides its child console window.
- **Recoverable HTTP MCP sessions** -- HTTP MCP sessions now default to a
  12-hour idle window. An expired or unknown session receives a fast `404`
  with a reinitialize hint instead of looking like a silent client hang. Set
  `MEMORIX_SESSION_TIMEOUT_MS=0` only when the host owns lifecycle cleanup.
- **Truthful embedding diagnostics** -- the HTTP control plane exposes its
  real runtime embedding state. `memorix doctor` reads that state instead of
  reporting a fresh local probe as ready while the running service is degraded
  by authorization, billing, timeout, or upstream failure.
- **Accurate doctor JSON health** -- a live PID with an unreachable HTTP
  control plane now reports `healthy: false` rather than a false positive.

### Changed
- **macOS release coverage** -- normal CI now runs the full build and test
  suite on `macos-latest` in addition to Ubuntu and Windows.

## [1.6.0] - 2026-08-17

### Added
- **Bounded context receipts** -- `memorix context|resume --brief-json`,
  `memorix codegraph context-pack --brief-json`, and MCP project-context
  `format: "receipt"` return only the agent-ready brief, selection receipt,
  CodeGraph quality, and optional Agent loadout. The detailed `--json` and
  MCP `format: "json"` forms remain available for diagnostics.
- **Task-scoped Agent loadouts** -- `--agent <target>` selects only compatible
  project workflows and reports their required context and workflow tools.
  This is guidance, not a replacement for the host agent's authorization.
- **Explicit external CodeGraph lifecycle** -- `memorix codegraph init|sync`
  manages an already installed local CodeGraph index. It never invokes
  CodeGraph's agent installer or writes Agent configuration.

### Changed
- **Honest CodeGraph status** -- Status now distinguishes the persistent Lite
  Code State index from the provider actually usable for the current task.
  A stale external graph falls back to Lite instead of being presented as fresh.
- **Bounded fallback guidance** -- Newly generated Agent rules teach
  `--brief-json` for the one CLI fallback; `--json` is reserved for deliberate
  detailed diagnostics.

## [1.5.1] - 2026-08-16

### Fixed
- **Bounded formation cancellation** -- Formation deadlines now abort the
  LLM and vector-search work they started, including response-body reads and
  retry waits. A provider that ignores cancellation still cannot hold the
  caller past its deadline.
- **Embedding error classification** -- Only an explicit HTTP 400 batch-shape
  error may trigger batch splitting. Authentication, billing, quota, and
  upstream errors fail once instead of multiplying latency through recursive
  retries.

## [1.5.0] - 2026-08-14

### Added
- **Stability stress suite** -- Five deterministic, offline stress exams now
  run in the normal test suite: a 2,000-observation corpus (planted needles,
  ranked determinism, project isolation), 60-way parallel writes plus
  20-way same-topic upserts, session churn across projects with parallel
  starts, 300-record long-term maintenance exactness, and repeated CLI
  invocations. Live embedding stress exams are env-gated
  (`MEMORIX_RUN_LIVE_EMBEDDING_TESTS=1`) and never run in CI.
- **Provider-aware embedding default** -- When the embedding base URL
  points at OpenRouter and no model is configured, the default is now
  `qwen/qwen3-embedding-8b` (4096 dimensions) instead of the OpenAI-only
  default. An explicitly configured model always wins.

### Changed
- **Verified OpenRouter embedding lane** -- The `api` embedding provider
  was exercised live against `qwen/qwen3-embedding-8b` on OpenRouter:
  a 100-text batch, cache round-trip, and provider-singleton stability all
  pass. Docs cover the env-var form and borrowing `OPENROUTER_API_KEY`.
- **Multimodal vision option documented** -- Image analysis can run on the
  LLM lane through an OpenAI-compatible vision endpoint, including
  OpenRouter models such as `qwen/qwen3-vl-8b-instruct`.

## [1.4.6] - 2026-08-14

### Added
- **Memory-native brief block** -- Every task brief opens with a "You and
  this workspace" block: the user profile (personal `user-profile`
  observations), the latest ended session summary, and recent durable
  long-term memories, all inside the existing token budget. Older callers
  and fixtures without the block are unaffected.
- **Long-term memory self-maintenance (rule leg, no LLM required)** --
  Explicit long-term requests (MCP `longTerm: true`, CLI add/promote)
  auto-qualify on the spot instead of waiting for a manual review;
  hook-captured and Git-derived candidates keep the review path. Stale
  qualified/approved records auto-archive after 30 days without activity,
  and a newer record auto-supersedes same-title records in the same scope
  and kind. Maintenance runs in the existing durable lane at session start,
  after each explicit promotion, then on a daily heartbeat. Approval stays
  an explicit operator action.
- **`memorix purge`** -- Retires the current project's memories from
  retrieval (`--all` for every project, `--yes` required outside a
  terminal). Observations and long-term records are archived, never
  hard-deleted, so the audit trail survives.
- **Eval coverage** -- New deterministic, offline exams pin the always-on
  brief, long-term maintenance, profile parity, purge safety, git ingest
  policy, media schema honesty, and server config defaults.

### Changed
- **Installed tool profile matches taught tools** -- `memorix setup` and
  every plugin template now run `memorix serve --mode lite`, so the tools
  taught in generated guidance (sessions, timeline, reasoning, retention)
  actually exist. Repo guidance marks the full-only tools
  (`promote`, `rules_sync`, `workspace_sync`) with `MEMORIX_MODE=full`.
- **Honest media schema** -- With the generation/transcription gates
  closed, `memorix_media` no longer advertises `generate-image`,
  `generate-video`, or `derive-audio` (or their parameters); agents see
  only what the operator enabled.
- **Config that does something** -- `[server].port` and
  `[server].dashboardPort` are now real startup defaults for `serve-http`
  and `dashboard`; `git.ingest_on_commit` actually gates post-commit
  ingestion and `git.max_diff_size` caps captured diff content. The
  never-consumed `mcpServers` key was removed from `memorix.yml`
  (unknown keys are ignored), and `[team]`/`[hooks]` are documented as
  parsed-but-reserved.

### Fixed
- **Guidance hygiene** -- Generated agent guidance now teaches
  store-the-underivable, dual-channel feedback, verify-before-use, the
  ignore contract, user-profile capture, and session-end summaries.
- **Session search dedup** -- `memorix_search` demotes rows already shown
  in the same session (duplicate rate 25% → 19% in the replay exam, hits
  and token budget unchanged).
- **Dead code removal** -- Removed the superseded slash-REPL, the legacy
  in-memory team layer, retired TUI components, and duplicate commands
  (about 4,600 net lines), each verified unreferenced before deletion.

## [1.4.5] - 2026-08-14

### Added
- **DeepSeek Harness integration** -- `memorix setup --agent dsh` installs
  Memorix into DeepSeek's official harness: a `@deepseek-ai/dsh-mcp-client`
  row in `$DSH_HOME/cordis.patch.yml` (tools appear as `mcp__memorix__*`),
  AGENTS.md guidance at the harness and project levels, and official skills
  under `$DSH_HOME/skills` or `.dsh/skills`. Existing user patch rows are
  preserved and installs are idempotent. DSH has no hook surface, so none is
  written. `doctor`, `repair`, `uninstall`, and `setup --list` cover the new
  target, and MCP checks for user-level-only adapters now run under an
  explicit global scope (fixing the same latent skip for Trae). Native
  validation composed the generated patch with the real
  `@deepseek-ai/dsh@0.1.0-rc.6` launcher.

## [1.4.4] - 2026-08-14

### Added
- **MiniMax image-to-image** -- `memorix media generate image --image
  <path>` sends a reference image through MiniMax's documented
  `subject_reference` API for the image-01/image-01-live models. The gated
  `memorix_media` MCP tool accepts an optional base64 reference image with the
  same 20 MiB visual limit and MIME validation. The existing MCP generation
  billing gate is unchanged. Contributed by
  [@octo-patch](https://github.com/octo-patch) in #178.

### Fixed
- **CLI argument crash on long text** -- `memorix memory store --text` could
  fail with `Error: named?.trim is not a function` when a repeated flag or a
  Windows PowerShell 5.1 argument split delivered the value as an array.
  CLI argument coercion now joins repeated free-text arguments and takes the
  last value for scalar and enum flags, with regression tests. Reported by
  [@skywalker-35](https://github.com/skywalker-35) in #194.

## [1.4.3] - 2026-08-10

### Added
- **Controlled document and audio derivations** -- Explicit CLI jobs can now
  derive searchable text from managed PDFs and from supported audio
  transcription providers. The original asset remains local and provenance,
  provider credentials, retries, cancellation, and provider cost reporting are
  bounded rather than inferred.
- **Evidence-bounded graph context** -- Retrieval can add direct, one-hop
  entity and commit evidence to an existing workset, while using the same
  freshness, trust, visibility, and token-budget governor as normal project
  knowledge. It does not perform unbounded graph traversal.
- **CodeBuddy integration** -- `memorix setup --agent codebuddy` installs an
  official-format local marketplace plugin with MCP, skills, and lifecycle
  hooks, without changing CodeBuddy model, permission, or user settings.

### Fixed
- **YAML dependency security** -- Replaced the unmaintained `gray-matter` /
  `js-yaml` 3 parsing chain with the maintained `yaml` parser for Memorix
  configuration, rules, workflows, and knowledge-page front matter. Memcode's
  HTTP client and the MCP SDK's patched transitive network dependencies are
  pinned to their fixed releases.
- **Optional local Transformers install** -- Memorix no longer installs
  `@huggingface/transformers` by default because its current upstream release
  still brings a high-severity `sharp`/libvips advisory. The local Transformers
  embedding provider remains available through an explicit user install.
- **Star History release verification** -- Generated chart pull requests now
  explicitly dispatch the normal CI workflow. This avoids relying on the
  GitHub `GITHUB_TOKEN` behavior that otherwise suppresses a follow-up
  `pull_request` workflow.
- **Plugin release metadata** -- CodeBuddy now participates in the same
  version-manifest synchronization as the other versioned integration plugins.

## [1.4.2] - 2026-08-06

### Added
- **Evidence-governed memory** -- A deterministic governor now decides whether
  project knowledge should be included, compacted, deferred, or excluded based
  on source backing, freshness, conflicts, quality, scope, and token budget.
- **Outcome-aware memory** -- Workflow verification results are recorded as
  append-only outcome signals so failed evidence is less likely to be reused
  as trusted project knowledge.
- **CodeGraph evolution views** -- Lite CodeGraph now keeps hash-only snapshot
  manifests, reports exact file-level diffs, and exposes bounded one-hop impact
  slices through the CLI. Continuation worksets include code evolution and
  stale-memory binding counts.

### Fixed
- **Star History automation** -- The chart workflow now updates a dedicated
  branch and opens or refreshes a pull request instead of trying to push
  directly to protected `main`, which caused every scheduled refresh to fail.

## [1.4.1] - 2026-08-03

### Added
- **MiniMax M3 video input** -- The bundled `@memorix/ai` provider layer now advertises and routes MiniMax M3 video content through MiniMax's Anthropic-compatible API. Base64 video is covered by focused request-shape tests, and image-only models still receive a clear text fallback instead of an invalid video block. Contributed by [@octo-patch](https://github.com/octo-patch) in #153.

### Changed
- **Maintained product roadmap** -- Replaced the stale version-by-version roadmap with current product boundaries, operating constraints, and public directions. Release facts now live in this changelog and active maintainer work lives in `ACTIVE_WORK.md`. Contributed by [@FBISiri](https://github.com/FBISiri) in #140.

### Fixed
- **Deterministic provider tests** -- `@memorix/ai` unit tests no longer discover local API keys or Pi OAuth credentials and unexpectedly call paid, changing provider endpoints. Routine tests are offline by default; deliberate live validation requires `MEMORIX_AI_LIVE_TESTS=1` plus the required credentials.
- **Stable model metadata assertion** -- Removed a test-only assumption that OpenRouter will permanently list `moonshotai/kimi-k2.6:free`; the bundled catalog snapshot no longer contains that route, while coverage remains for the supported Kimi K2.6 compatibility metadata.

## [1.4.0] - 2026-08-02

### Changed
- **Stable multimodal release** -- Promoted the controlled media lifecycle, explicit MiniMax image/video generation, and honest multimodal embedding foundation introduced in 1.3.3 to the stable line after the 1.3.4 Windows, MCP binding, cancellation, cleanup, configuration-migration, and fresh-package hardening work.

### Verified
- **Release evidence** -- Full local regression, fresh npm-package MCP smoke, GitHub Actions on Windows and Ubuntu, Docker control-plane startup, native SQLite compatibility, npm provenance publication, and official MCP Registry publication all passed before this release.
- **Release boundary** -- “Stable” means no known release blocker after those gates. It does not claim that any software is mathematically free of future defects.

## [1.3.4] - 2026-08-02

### Fixed
- **Fail-closed project binding** -- Stdio and HTTP MCP servers no longer restore or keep writing a remembered project root. A launch without a reliable workspace now waits for an explicit root, MCP Roots, or `memorix_session_start`, preventing cross-project memory access.
- **Portable MCP Roots** -- File URI roots now remain POSIX paths on Linux/macOS and convert correctly on Windows, including drive-letter paths and UNC roots.
- **Atomic media attachments** -- A media retrieval observation and its asset link now commit in one SQLite transaction. If linking fails, no dangling observation survives. Completed video downloads also persist their local asset before a retryable attachment step.
- **Authoritative video cancellation** -- A cancellation that lands while a video worker is downloading or finishing can no longer be overwritten back to `completed`; MCP can cancel an existing job even when new MCP media generation is disabled.
- **Recoverable media cleanup** -- Files Windows cannot immediately release are visibly staged for retry, and media cleanup reports reclaimed or still-pending staged bytes instead of silently implying deletion succeeded.
- **Non-destructive Codex migration** -- Legacy Codex hook cleanup now preserves customized hook files instead of deleting a file merely because its commands begin with `memorix hook`.
- **One stdio runtime** -- Direct `node dist/index.js` invocation now delegates to `memorix serve`; importing the package no longer starts an MCP server as a side effect.

### Changed
- **Bounded default MCP surface** -- The `micro` profile exposes nine tools: agent-ready context, retrieval, one explicit session recovery path, and one controlled media operation. Advanced tools remain opt-in through higher profiles.

## [1.3.3] - 2026-08-02

### Added
- **Controlled media assets** -- Added a local content-addressed asset library for explicit images, audio, video, and PDFs. Assets live outside the Git worktree, keep validated MIME/hash/size provenance, support explicit attachment to normal memory, and have link-aware quota cleanup.
- **MiniMax media generation** -- Added explicit MiniMax image generation and durable MiniMax-H3 video jobs. Video tasks survive process restarts, expose status/cancellation, and import completed output only after bounded safe download validation.
- **Honest multimodal embedding foundation** -- Added typed media embedding inputs, profile/modality compatibility checks, and separate media-vector storage. Text-only embedding providers now return a capability fallback instead of inventing a visual vector.
- **One MCP media operation** -- Added `memorix_media` for agent-facing import, attachment, inspection, and job status while retaining CLI as the complete management surface.

### Changed
- **Legacy image ingestion joins the asset lifecycle** -- `memorix ingest image` and the full-profile compatibility tool now keep a verified controlled image asset alongside the text retrieval projection instead of discarding the binary.
- **MCP binding boundary** -- Project binding is now a transport-neutral request context. Legacy HTTP session IDs only route transport requests; explicit project roots cannot be overwritten by Roots discovery, including a workspace that contains a nested Git project.

### Fixed
- **Atomic media removal** -- Asset removal stages a file in a controlled recovery directory, then atomically detaches links, removes derivations/vectors, and marks the asset deleted. A database failure restores the file instead of silently losing it.
- **No ambient paid generation** -- MCP image/video generation is disabled until `MEMORIX_MCP_MEDIA_GENERATION=1` is explicitly set. CLI generation remains deliberate and auditable.
- **Bounded image analysis** -- Legacy base64 image ingestion validates canonical input before decoding, caps visual analysis at 20 MiB, and sanitizes provider-derived descriptions and diagnostics before persistence.
- **Test data isolation** -- Tool-profile integration tests now always use temporary Memorix data directories instead of a developer's real local memory database.
- **Smaller install artifact** -- Excluded runtime-unneeded distribution sourcemaps from the npm package while retaining compiled code, source, documentation, and memcode runtime assets.

## [1.3.2] - 2026-08-02

### Fixed
- **Windows background lifecycle** -- Background Control Plane startup now uses a hidden, independent Windows launcher that returns the real Node PID immediately, writes managed state before readiness checks, and avoids both console flashes and host-reclaimed child processes.
- **Safe stale-process handling** -- Background start, stop, and ensure no longer kill a live PID merely because old local state is unhealthy. A forced stop happens only after the health endpoint proves the PID belongs to the registered Memorix service.
- **Truthful setup preview** -- `memorix setup --dry-run`, including `--global`, now performs no file, plugin, hook, MCP, or agent-setting changes. This is covered for Codex user-level paths.
- **CLI failure boundaries** -- `background`, `serve-http`, and `dashboard` now reject malformed or out-of-range ports before starting a service; background log line limits are bounded, and these expected input errors are concise rather than internal stack traces.
- **Recoverable orchestration work** -- Failed or timed-out orchestration worktrees retain uncommitted work for inspection rather than being force-removed; Git helper calls use argument arrays and bounded inputs.
- **Dependency hardening** -- Refreshed the MCP SDK and transitive package overrides; production dependency audit is clean.

## [1.3.1] - 2026-07-31

### Fixed
- **Windows CLI window flicker** -- Memorix now hides Windows child-process windows across normal CLI work: startup restart, Git/project probes, hook runners, setup checks, background controls, orchestration, and memcode utility commands no longer flash a console for each invocation.
- **Recoverable vector backfill** -- One-shot vector backfill no longer launches as a detached Windows process. The durable queue still preserves and retries the work, while `unref()` lets the foreground CLI return without a visible extra console.

## [1.3.0] - 2026-07-30

### Added
- **Curated long-term memory** -- Added source-bound episodic, semantic, and procedural memory records with explicit `candidate -> qualified -> approved -> archived/superseded` lifecycle states, evidence references, audit events, and task-aware delivery.
- **Deliberate local portability** -- A user may explicitly create a `user + portable` memory for reuse across projects on the same local installation. Project and team facts remain project-bound, and source-derived evidence can never be made portable.
- **Long-term memory CLI** -- Added `memorix memory long-term list|show|add|promote|qualify|approve|archive|supersede` for reviewable lifecycle management without requiring an MCP connection.

### Changed
- **Bounded Worksets** -- Task context can now select up to three relevant qualified or approved long-term records, with source and lifecycle status preserved in the context receipt. Candidates, archived records, and superseded records are never injected.
- **Low-noise agent guidance** -- Generated rules and shipped plugin skills tell agents to create long-term candidates only for stable facts, reusable procedures, or completed episodes; approval remains an explicit operator action.
- **Bounded semantic recall** -- Keyword matching remains the deterministic first path. A configured embedding provider gets one 1.8-second, no-retry fallback only when no reviewed long-term item matched, so a slow remote service cannot turn context delivery into a long foreground wait.

### Fixed
- **Long-term CLI discoverability** -- `memorix memory` help now documents the existing `--title`, `--tags`, and `--applicability` fields for curated long-term records.

## [1.2.10] - 2026-07-28

### Added
- **Official MCP Registry publication path** -- Ships the checked `server.json` manifest and a GitHub OIDC publication step that runs after npm succeeds. This release is the first package version eligible for official Registry registration.

### Fixed
- **Codex plugin ownership** -- `memorix setup --agent codex --global` now uses Codex's personal marketplace plugin path and never creates project-local `.codex` configuration as a fallback. Custom user MCP configuration stays untouched; legacy Memorix files are migrated only after Codex confirms the plugin is enabled.
- **Glama-compatible Docker build** -- Docker now installs every workspace dependency set before compiling. CI builds and starts the HTTP control-plane image, so a future container regression is caught on the pull request instead of by an external registry scan.

## [1.2.9] - 2026-07-28

### Fixed
- **One retention truth across the product** -- Dashboard, HTTP control-plane, and background cleanup now use the same canonical retention projection. Permanent, active, stale, and archive-ready memory states no longer disagree across surfaces.
- **More useful session continuation** -- Resume and handoff-shaped requests prioritize the prior task, what changed, and remaining work without treating ordinary verification or compatibility language as disposable noise. Delivery stays bounded rather than replaying a transcript.
- **Responsive CLI writes with remote embeddings** -- `memorix memory store` now persists the memory and queues durable vector work before starting a detached backfill worker. A slow embedding API no longer keeps a one-shot CLI command open; lexical recall remains available while vector search catches up.

## [1.2.8] - 2026-07-27

### Fixed
- **Recoverable vector backfill** -- Temporary embedding or index failures no longer exhaust a shared background job. Memorix keeps one diagnosable retry with bounded backoff, batches provider requests, and lets a later healthy MCP session resume the same recovery work instead of accumulating permanent failures.
- **Accurate vector status outside MCP** -- The standalone dashboard and HTTP control plane no longer present an unhydrated in-memory index as a healthy `0 / 0` result. They now explicitly say that vector status belongs to the active MCP session when they cannot observe it.
- **Codex plugin ownership** -- Agent Doctor recognizes the enabled Codex plugin as the owner of `memorix serve`, reports first-use hook approval as a host consent step instead of a broken install, and avoids suggesting a redundant config repair.
- **Safe Codex migration** -- `memorix setup --agent codex --global` removes only the known old source-path Memorix MCP entry after the official plugin installation succeeds. Custom user-managed MCP entries remain untouched.

## [1.2.7] - 2026-07-27

### Added
- **Native compaction continuity** -- Memorix records host-native compaction lifecycle checkpoints separately from durable memory. Pi and Oh-my-Pi preserve the native summary fields their extension API exposes; Codex and Claude Code keep an honest lifecycle marker when their hook payload exposes no summary.
- **One-time host recovery** -- Codex receives one bounded checkpoint through its documented `SessionStart` compact path. Claude Code receives the same bounded checkpoint through its documented next `UserPromptSubmit` context path. Neither path replays a transcript or repeats delivery.
- **Claude handoff routing** -- Claude Code now receives a compact official `UserPromptSubmit` hint for handoff and continuation requests, directing one Memory Autopilot call before broad file or Git exploration without injecting a broad brief into unrelated prompts.
- **Cross-agent continuation evidence** -- Explicit `memorix resume` / task continuation Worksets can include one recent, source-labelled compact checkpoint from the same Git project. It remains historical lifecycle evidence, not promoted knowledge.
- **Checkpoint CLI and advanced MCP inspection** -- Added `memorix checkpoint list|show|context|archive`; the matching `memorix_compaction_checkpoint` MCP action is available only in the `full` profile.

### Fixed
- **Repeated compact lifecycle safety** -- Retried pre-compact and post-compact hook delivery is idempotent. Multiple real compactions in one long host session retain separate checkpoints when the host exposes a new preflight marker or native compaction event ID.

## [1.2.6] - 2026-07-27

### Added
- **Truthful Memcode command discovery** -- The interactive command list and editor autocomplete now derive from the same executable Pi-compatible command registry. Memorix-native `/memory` actions, including nested completion after `/memory `, are available without advertising dead commands.
- **Deterministic memory resolution** -- `/memory delete <id>` now resolves the selected project-memory entry instead of only showing a candidate list.
- **Pi-compatible shell session context** -- Model-initiated Memcode bash calls now receive current `PI_SESSION_ID`, `PI_SESSION_FILE`, `PI_PROVIDER`, `PI_MODEL`, and `PI_REASONING_LEVEL` metadata. Extensions can explicitly disable this exposure.
- **Maintainer Pi-upstream audit** -- Added a pinned upstream manifest, `npm run audit:pi-upstream`, and a documented review policy. The read-only audit detects GitHub compare truncation and falls back to a full official Git-tree comparison.

### Fixed
- **No misleading terminal actions** -- Removed stale, non-dispatched TUI entries and unreachable `/git` actions, including the former implicit stage-all commit path.
- **Memcode release identity** -- Version-check and user-agent internals now identify the published Memorix/Memcode package rather than incorrectly calling it a Pi release; bundled `memcode --version` now reports the installed Memorix release instead of an internal workspace version.
- **Task-flag parity** -- `memorix context --task "..."` now works without a redundant positional task argument.
- **Plugin release metadata** -- All shipped versioned plugin manifests now match the published Memorix release, including Claude Code, Codex, Copilot, Gemini CLI, OpenClaw, Oh-my-Pi, and Pi.
- **Complete Node SQLite fallback** -- The supported Node built-in SQLite fallback now matches the transaction variants and permissive named-parameter behavior Memorix uses with `better-sqlite3`. Team task claims, Knowledge Workspace review, and other row-object writes no longer fail when the optional native binding is unavailable.

## [1.2.5] - 2026-07-27

### Added
- **Explicit retrieval profiles** -- Search now accepts `fast`, `balanced` (default), or `thorough` through the CLI, MCP, and SDK. Fast is fully local, balanced keeps optional LLM work out of everyday retrieval, and thorough explicitly opts into configured LLM query refinement.
- **Reproducible retrieval evidence** -- Added `npm run benchmark:retrieval` for a clearly-labelled hot in-process SDK lexical benchmark with p50/p95/p99 output. It does not present CLI startup, MCP transport, remote embedding, or LLM latency as the same metric.

### Changed
- **Lighter read-only CLI path** -- Memory search, detail, timeline, recent, graph context, and help no longer create session bookkeeping or maintenance-target metadata. Identity and visibility checks remain unchanged.

### Fixed
- **Completed searches no longer retain timeout watchdogs** -- Embedding, rerank, MCP search, and maintenance timeout paths share a helper that clears the timer when work settles. This removes the avoidable CLI exit delay caused by an already-completed optional rerank.
- **OpenRouter lane isolation** -- An embedding-only `OPENROUTER_API_KEY` no longer silently enables the memory LLM lane. It remains valid for a memory LLM only when that lane explicitly selects an OpenRouter provider or base URL.

## [1.2.4] - 2026-07-26

### Added
- **One-call continuation for CLI-only agents** -- Added `memorix resume "<task>"`, a direct terminal entry that returns the same bounded Memory Autopilot Workset as Project Context without requiring MCP discovery or command probing.

### Changed
- **Continuation is a delivery choice, not a separate memory silo** -- Project Context now recognizes continuation language independently of its task lens. It adds only the latest meaningful session summary and up to three readable durable anchors, with source records in the existing context receipt. Ordinary new tasks remain free of old-session dumps.
- **Stable agent fallback guidance** -- Generated skills and rules now direct an agent with unavailable MCP to make exactly one task-aware CLI call: `memorix resume` for prior work or `memorix context` for a new task. Continuation requests must take that brief before local file/Git archaeology, and an absent `.memorix` directory is not treated as proof that no durable memory exists. This prevents broad command enumeration, repeated search loops, and false cold-start conclusions.

### Fixed
- **Claude continuation delivery** -- Claude Code now receives an explicit continuation's bounded prior-work Workset through its official `UserPromptSubmit.additionalContext` response, rather than relying on an advisory rule or a SessionStart message the host does not place in model context. `memory.inject = "silent"` still disables automatic injection.
- **Fresh-install SQLite resilience** -- When the optional `better-sqlite3` native binary is missing on a supported Node 22 runtime, Memorix now opens the same local `memorix.db` through Node's built-in SQLite instead of losing session and durable-memory reads across CLI or hook processes. No data migration or configuration change is required.
- **Standard TOML literal strings** -- Project and global configuration now accepts single-quoted TOML strings, including `#` characters inside the literal value.
- **MCP continuation summary parity** -- `memorix_project_context` now includes the same bounded prior-session and durable-memory evidence in `format: "summary"` as it does in the default prompt format, so agents that request a compact summary do not lose a valid handoff.
- **Actionable continuation anchors** -- Bounded continuation text no longer cuts a technical flag or symbol halfway through. The shared guidance also avoids redundant Context Pack/search/detail calls after a complete Autopilot brief, keeping the default agent path compact.
- **Autopilot duplicate retrieval** -- A completed MCP Project Context now holds a short-lived delivery boundary. Follow-up search/detail calls do not re-send memories already represented in that brief unless the user explicitly asks to inspect the underlying record.
- **Read-only memory mutation** -- A task that asks for read-only work or says not to modify files now rejects automatic `memorix_store` writes. An agent must have an explicit user request before it can override that boundary.
- **Prior-work privacy parity** -- Continuation retrieval applies the same project, team, and personal-memory visibility reader as session context, including canonical project aliases. A different identity cannot receive another agent's personal durable memory through the new delivery path.
- **Rule-surface drift** -- The shared automatic-memory rule file now carries the same one-call CLI fallback contract as setup-generated agent guidance.

## [1.2.3] - 2026-07-25

### Fixed
- **Session context now respects observation visibility** -- Automatic session handoff and manual session-context reads in the CLI, MCP server, and Workbench apply the caller's project, team, and personal-memory reader. A new identity cannot receive another agent's personal observations through session startup.
- **Identity before handoff** -- CLI and MCP coordination sessions establish their explicit identity before assembling prior context, so an owner's own personal records remain available while a newly joined agent fails closed.
- **Graph-side disclosure guard** -- Agent-facing session handoff no longer derives graph-neighbor hints from graph relations that do not yet carry observation visibility metadata.

## [1.2.2] - 2026-07-25

### Added
- **Direct CLI control plane** -- Added a consistent terminal surface for memory, context, Code State, knowledge, coordination, audit, and transfer work. `--cwd` selects the Git project from any shell, `memorix workbench` explicitly opens the interactive terminal UI, and every action group now has task-oriented help.
- **Explicit local CLI identity** -- Added `memorix identity status|join|use|clear`. A user can deliberately activate one project coordination identity for personal/team memory and task, message, lock, handoff, and poll commands without needing an MCP connection.
- **Automation-friendly transfer** -- Memory exports can write directly to a file, and imports accept `--file` or `--stdin` as well as existing inline JSON.

### Changed
- **One visibility reader across terminal surfaces** -- CLI commands, Workbench search, recents, health, graph, knowledge, and chat now resolve the same project/actor reader. An unbound terminal remains project-scoped by default.
- **CLI ergonomics** -- Root `search`, `remember`, and `recent` aliases now use the canonical memory commands; kebab-case flags are accepted alongside the existing camelCase forms.

### Fixed
- **Private evidence cannot become public indirectly** -- Personal and team observations are rejected when promoting shared skills or generating project skills.
- **TUI visibility mismatch** -- The interactive terminal UI no longer falls back to an unbound reader after an explicit local identity has been activated.
- **Transfer visibility bypass** -- CLI and MCP exports now include only observations readable by the current caller, rather than exporting personal/team records from the same project by default.

## [1.2.1] - 2026-07-19

### Added
- **Review-gated Knowledge claims** -- Explicit agent observations now become source-backed candidates first. They can be inspected and deliberately approved or rejected through `memorix knowledge claims` / `memorix knowledge review` or the advanced `memorix_knowledge` MCP action before they enter knowledge compilation.
- **Versioned Memorix release workflow** -- Added `docs/knowledge/workflows/memorix-release.md`, a canonical release playbook with verification gates and an explicit maintainer approval boundary.

### Fixed
- **Claude setup respects `--noHooks`** -- Project setup now keeps generated `CLAUDE.md` guidance without also creating Claude lifecycle-hook configuration when hook capture was explicitly disabled.
- **Claude Code manual MCP readiness** -- Manual setup examples now include Claude Code's `alwaysLoad: true` entry and point to Doctor/Repair for detecting and restoring the eager-load contract.
- **Workflow import fidelity** -- Canonical Windsurf workflows preserve their source ID, title, agents, phases, and verification gates instead of being reduced to a generated `workflow:<hash>` entry. Release workflows no longer match a non-release task merely because it says “verify” or “test”.
- **Graph surface consistency** -- Explicit `relatedEntities` now persist as graph edges, and MCP graph tools, standalone Dashboard, HTTP control plane, and exports share one project-scoping rule.
- **Intent-aware task and workflow routing** -- A safety constraint such as “do not publish” no longer routes an incident or debugging task into a release lens or release workflow. Explicit release requests still retain release verification while publication is deferred for approval.
- **Git fact consistency** -- Project Context, Context Pack, and CodeGraph CLI now report `Git: unavailable` for an invalid or unreadable repository instead of presenting it as a clean worktree.
- **Windows verification-gate timeout** -- A timed-out orchestration gate now resolves promptly while its shell process tree is terminated in the background, instead of waiting indefinitely for a descendant process to close.

## [1.2.0] - 2026-07-18

### Added
- **Versioned Code State** -- Added local code snapshots, source epochs, completeness metadata, and memory-to-code freshness so project memory can be requalified when the checkout changes.
- **Claim ledger and reviewable knowledge workspace** -- Added source-backed claims with confidence/conflict lifecycle, plus local or explicitly versioned Markdown workspaces that compile proposals before a reviewed page can change.
- **Canonical project workflows** -- Added import, selection, preview, safe adapter application, and run receipts for project workflows without treating an agent-specific instruction file as the source of truth.
- **Bounded task Worksets** -- Memory Autopilot and Context Pack now select task-relevant current facts, evidence, knowledge/workflow starts, cautions, and verification instead of adding a generic historical-memory dump.
- **Advanced Knowledge Workspace MCP tool** -- Added `memorix_knowledge` as one action-based management surface for workspace, proposal, and workflow operations in the explicit `team` and `full` MCP profiles.
- **Optional local semantic CodeGraph provider** -- A healthy pre-indexed local CodeGraph can add a validated, bounded semantic outline to a task Workset. The built-in Lite provider remains available with explicit capability limits.

### Changed
- **Durable knowledge lifecycle** -- Code State refresh, claim derivation/requalification, knowledge compile/lint, and workflow indexing run through resumable maintenance jobs rather than turning interactive requests into a corpus-wide foreground scan.
- **Provider quality is visible** -- CodeGraph status, Doctor, and Project Context JSON report whether the task used Lite structural evidence or a validated external semantic outline.

### Fixed
- **Incomplete scan truthfulness** -- Unreadable files and deferred removals now remain visible in snapshot completeness instead of being silently treated as a complete code view.
- **External CodeGraph safety boundary** -- Memorix only accepts local output for the exact healthy project root, rejects stale/malformed/oversized/path-escaping data, runs without a shell, and never persists raw external source output.
- **Node 26 SQLite runtime** -- Upgraded the optional `better-sqlite3` path to a release that supports Node 26, and added a Node 26 CI smoke that opens an in-memory database. Fixes #130; reported by @RaviTharuma.

## [1.1.13] - 2026-07-17

### Added
- **Codex installation proof** -- `memorix doctor agents --agent codex --scope global` now checks the local plugin bundle, Personal marketplace entry, five declared and trusted lifecycle hooks, and the installed/enabled state reported by `codex plugin list`.

### Fixed
- **Codex plugin version drift** -- Global setup now stamps the copied Codex plugin manifest with the installed Memorix version, so Codex no longer reports the old template version after an upgrade. The source template is covered by a release regression test as well.
- **Workspace package publish trap** -- `@memorix/ai`, `@memorix/agent-core`, `@memorix/tui`, and `@memorix/memcode` are now explicitly internal workspaces. The root `memorix` package ships their bundled runtime, and the release workflow publishes only that supported public package.

## [1.1.12] - 2026-07-17

### Added
- **Codex lifecycle hook capture** -- The Memorix Codex plugin now bundles the documented `SessionStart`, `UserPromptSubmit`, `PostToolUse`, `PreCompact`, and `Stop` hook events, with a Windows-safe `commandWindows` command override.

### Fixed
- **Codex hook normalization and injection** -- Codex lifecycle payloads now preserve their event names, `SessionStart` returns Codex-native `hookSpecificOutput.additionalContext`, and capture-only events stay quiet instead of filling the agent context with save-status messages.
- **OpenCode hooks on Windows** -- The generated plugin resolves the installed npm `memorix.cmd` shim while setup runs and uses that stable path inside OpenCode, instead of relying on OpenCode's inherited `PATH`. Hook delivery stays quiet unless `MEMORIX_HOOK_DEBUG=1` is explicitly set. Fixes #125.
- **Setup scope isolation** -- Project-level setup no longer installs Claude, Codex, or Copilot plugin bundles in the user home. Use `--global` for user-level plugins, skills, and lifecycle hooks.
- **TUI embedding startup** -- TUI health, chat, and quick-search paths now use the same lexical-ready startup flow as MCP instead of making a remote dimension probe during the first screen or search.
- **Semantic recall after restart** -- API-backed embeddings now restore compatible vectors from the local cache during index hydration, without placing remote embedding calls on the MCP startup path. Redundant namespace-scoped cache metadata survives a lost dimensions cache; cache misses enter the existing bounded background recovery lane, and the first successful vector upgrades a cache-less lexical index in the same process. Based on the diagnosis in #126 by @Tom-Ma-Ming.
- **Concurrent index startup** -- Cache-only startup and ordinary database callers now share one Orama initialization, so a later vector-schema attempt cannot replace an already hydrated lexical index. Resets also discard obsolete in-flight instances.
- **Lazy API vector-cache I/O** -- A cache-only start with no trusted dimension metadata now skips parsing the potentially large API vector cache entirely; the cache is loaded only after compatible local metadata or a normal embedding initialization establishes its dimensions.

## [1.1.11] - 2026-07-16

### Added
- **Durable runtime maintenance** -- Added a SQLite-backed maintenance ledger for vector recovery, retention, consolidation, and Code Memory refresh. Jobs use dedupe keys, leases, heartbeats, retry backoff, resumable cursors, and operator-visible state.
- **Isolated maintenance runner** -- Retention, consolidation, and Code Memory scans now run through a compiled child-process runner instead of sharing an MCP request/event loop. Vector recovery stays with the owning process because its Orama index is process-local.
- **Code Memory scan safeguards** -- CodeGraph Lite now skips common dependency/build directories and source files larger than 2 MiB by default. Configure the limit with `[codegraph].max_file_bytes` or YAML `codegraph.maxFileBytes`.
- **Maintenance diagnostics** -- Dashboard APIs and System Status now show queued/running/failed maintenance state without mixing projects.

### Changed
- **First-turn MCP readiness** -- `memorix_project_context`, `memorix_context_pack`, `memorix_graph_context`, and `memorix_codegraph_status` now read the current project's SQLite state directly before full Orama hydration. Search, writes, and sessions retain their full-runtime boundary.
- **Bounded memory lifecycle** -- Automatic retention and consolidation process one project page at a time and resume through durable cursors, avoiding corpus-sized work in an interactive request.
- **Incremental Code Memory** -- Changed files are reparsed, unchanged files keep their metadata, and removed/oversized files are removed from the graph without replacing the entire project graph.
- **Mobile dashboard navigation** -- The desktop sidebar becomes a compact mobile navigation layout so dashboard content remains readable on narrow screens.

### Fixed
- **Cross-process refresh model** -- Removed the obsolete JSON-file polling watcher. SQLite generation checks are now the sole authoritative mechanism for cross-process observation freshness.
- **Maintenance history and diagnostics** -- Completed maintenance records expire after a retention window; persisted failure messages redact credential values.
- **Maintenance enqueue atomicity** -- History pruning now runs inside the enqueue transaction, so a failed enqueue cannot discard completed diagnostic history.
- **Dashboard project scope** -- Knowledge, graph, retention, observation, and export reads use project-scoped SQLite queries instead of loading and filtering the full flat memory store.
- **Behavior configuration alignment** -- TOML/YAML memory behavior settings now drive runtime injection, formation, auto-cleanup, and sync advisory behavior; legacy `config.json` is a fallback rather than a separate source of truth.
- **Container runtime privilege** -- The official HTTP control-plane image is explicitly verified to run as the non-root `node` user.

## [1.1.10] - 2026-07-13

### Fixed
- **Large-project Memory Autopilot timeouts** -- `memorix_project_context` now reuses one CodeGraph snapshot per request and performs first-use code-ref backfill in memory with one batched write instead of per-memory database scans and transactions. Prose-only and ambiguous symbol mentions no longer create large volumes of noisy code references, keeping first-use context generation responsive with thousands of active memories.
- **Ruby CodeGraph symbol fidelity** -- Ruby namespaces and punctuated method names such as `Foo::Bar`, `save!`, `valid?`, and `name=` now remain intact through Lite indexing and memory-to-code binding.

## [1.1.9] - 2026-07-12

### Added
- **Configurable CodeGraph excludes** -- Added `[codegraph].exclude_patterns` / YAML `codegraph.excludePatterns` support so CodeGraph, Project Context suggested reads, context packs, diagnostics, and related CLI flows can skip project-specific generated or vendor paths while keeping the built-in defaults.

### Fixed
- **Config inspection aliases** -- `memorix config get` now accepts TOML-style snake_case dotted keys such as `codegraph.exclude_patterns` when reading resolved camelCase config values.
- **Orama search index consistency** -- Search access tracking now preserves internally stored vector-backed documents, public/detail cache results continue to strip embeddings, and hydration reconciles persisted observations by exact composite ID instead of skipping observation hydration when a shared index already contains mini-skills.

## [1.1.8] - 2026-07-08

### Added
- **Agent integration doctor and repair** -- Added `memorix doctor agents` and `memorix repair agents` to inspect and repair Memorix-owned agent integration files. The doctor flags stale MCP command paths, missing Claude `alwaysLoad`, missing `memorix` MCP entries, and outdated Memory Autopilot guidance without printing environment secrets.

### Changed
- **Memory Autopilot adoption** -- Setup-generated agent guidance now makes `memorix_project_context` the default first step for non-trivial coding work before progress files, dev logs, broad file reads, or git archaeology.

### Fixed
- **Claude Code local MCP repair** -- `memorix doctor agents` and `memorix repair agents` now inspect and repair Claude Code 2.x project-private local MCP entries in `~/.claude.json`, replacing stale worktree commands with `memorix serve` and `alwaysLoad: true`.
- **Cleaner CodeGraph Memory briefs** -- CodeGraph Lite and Memory Autopilot now ignore `.tmp`, nested `.worktrees`, and `.claude/worktrees` directories, so suggested reads point at the real project instead of local caches or agent scratch worktrees.
- **All-scope doctor noise** -- Agent doctor now treats one healthy local, project, or global scope as sufficient in all-scope mode, while still flagging genuinely stale or repairable configs.

## [1.1.7] - 2026-07-07

### Added
- **Task-lensed Memory Autopilot** -- `memorix context --task ...` and MCP `memorix_project_context` now infer a task lens (`bugfix`, `feature`, `release`, `onboarding`, `refactor`, `docs`, `test`, or `general`) and shape Start here files, reliable memories, cautions, and verification hints for that task.

### Changed
- **Brief noise control** -- Release/onboarding/docs-shaped briefs now keep unrelated stale or suspect memory details out of the main prompt while preserving counts and warnings, so agents see less old-context noise.
- **Agent guidance** -- Generated rules and official skills now tell agents to pass the user's actual task into `memorix_project_context` or the CLI fallback, making natural-language continuation the default product path.

## [1.1.6] - 2026-07-06

### Changed
- **Release-safe model catalogs** -- `npm run build` and `prepublishOnly` no longer refresh live model catalogs. Model catalog refresh is now an explicit maintenance action via `npm run update-models`, so publishing uses the generated catalog already committed to the repository.

### Fixed
- **Live catalog shrink guard** -- Model catalog generators now refuse to overwrite the checked-in catalog when a live API returns an unexpectedly small result set, unless `MEMORIX_ALLOW_MODEL_CATALOG_SHRINK=1` is set intentionally.
- **Project-scoped diagnostics** -- `memorix doctor` now reports observation totals for the current project instead of mixing in unrelated flat-store project records.
- **Claude Code handoff guidance** -- Project and plugin instructions now point fresh Claude Code sessions at `memorix_project_context`, prefer official MCP tool discovery before shell fallback, set `alwaysLoad: true` for the small Claude plugin MCP surface, and use the repository-wide dev log instead of stale package-specific memcode notes.
- **Setup-installed rules refresh** -- Re-running setup now refreshes the Memorix-owned block in shared `CLAUDE.md` / `AGENTS.md` / `GEMINI.md` files while preserving user-authored content, so upgraded guidance actually reaches existing installs.

## [1.1.5] - 2026-07-02

### Added
- **Memory Autopilot brief** -- `memorix context` and `memorix_project_context` now present a compact agent-ready brief with Start here files, reliable code-bound memories, stale/suspect cautions, verification hints, and usage guidance.
- **Unbound memory tier** -- `memorix_context_pack` now includes task-relevant memories that do not yet have current code refs as lower-trust unbound context instead of silently dropping them.

### Changed
- **Context ranking policy** -- Context packs now separate reliable current memories from stale warnings and unbound leads, so agents can use memory as an action map rather than a raw text dump.
- **Agent guidance loop** -- Generated rules and official Memorix skills now teach agents to get project context, inspect suggested files, store durable outcomes, and resolve stale/completed memories.

### Fixed
- **Agent tool allowlist auditability** -- Agent-core now has explicit turn allowlist lookup and regression coverage proving a tool absent from the active turn context cannot execute.
- **Session selector search safety** -- memcode session search no longer executes user-provided `re:` input as a regular expression; regex-shaped input is treated as literal search text.
- **Autopilot current-truth grounding** -- `memorix context` and `memorix_project_context` now put live package, changelog, Git branch/commit, and stale progress-note warnings before memory hints so agents do not mistake old dev-log files for the current project state.
- **Default install audit surface** -- The published package no longer installs `fastembed` by default because its current releases still pull vulnerable `tar` versions for downstream consumers. The FastEmbed provider remains available when users install `fastembed` explicitly.
- **YAML parser advisory** -- Updated the pinned `js-yaml` 3.x line to the patched 3.15 release while keeping compatibility with existing gray-matter workflow parsing.

## [1.1.4] - 2026-07-01

### Changed
- **Contributor attribution** -- Added post-release credit metadata for the 1.1.3 fixes accepted from #105 and #98 so GitHub can associate the accepted work with the contributing accounts.

### Fixed
- **Stdio MCP startup latency** -- `memorix serve` now registers MCP tools before loading the full project memory runtime, then warms the runtime in the background. This keeps `initialize` / `tools/list` fast for IDEs and registries even when the local memory corpus is large, while real tool calls still wait for project runtime readiness before executing.

## [1.1.3] - 2026-06-29

### Added
- **CodeGraph Memory MVP** -- Added a SQLite-backed code structure plane with project-scoped files, symbols, import edges, and observation-to-code references. This lets Memorix store structured code facts beside text observations instead of treating memory as text-only context.
- **CodeGraph Lite provider** -- Added a built-in TypeScript/JavaScript indexer for file hashes, basic symbol extraction, and import edges, with no new runtime dependency. Richer external CodeGraph providers can be added later against the same store and context-pack contract.
- **Freshness-aware context packs** -- Added code-ref freshness evaluation and context pack rendering so agents can distinguish current code-bound memories from suspect or stale ones, then inspect suggested files/symbols.
- **CodeGraph operator surface** -- Added `memorix codegraph refresh`, `memorix codegraph status`, and `memorix codegraph context-pack`, plus MCP tools `memorix_codegraph_status` and `memorix_context_pack`.

### Changed
- **Memory writes attach to code refs** -- New observations now best-effort bind to indexed files and symbols after they are stored, without blocking ordinary memory writes if CodeGraph Memory is unavailable.
- **Documentation updated for multi-dimensional memory** -- API docs and design notes now document CodeGraph Memory as the first context-fabric layer beyond pure text memory.
- **OpenRouter embedding key support** -- The embedding lane now accepts `OPENROUTER_API_KEY` when `[embedding].base_url` points to OpenRouter, while keeping `MEMORIX_EMBEDDING_API_KEY` as the explicit highest-priority embedding key.

### Fixed
- **Session project binding** -- `memorix_session_start({ projectRoot })` no longer hijacks an already-bound parent repo to the first nested git repository under that path. Based on #98 by @Tom-Ma-Ming.

## [1.1.2] - 2026-06-27

### Fixed
- **Removed unowned product-domain defaults** -- Removed hardcoded unowned product-domain references from memcode defaults, tests, and generated help text. Version checks now use the official npm registry endpoint, changelog links point to GitHub releases, OpenRouter attribution uses the GitHub repository URL, and `/share` falls back to the GitHub gist URL unless the user explicitly sets `MEMCODE_SHARE_VIEWER_URL`.
- **Disabled default install report endpoint** -- memcode no longer sends install/update pings to any default product-domain endpoint. A report endpoint is used only when `MEMCODE_INSTALL_REPORT_URL` is explicitly configured by the user.

## [1.1.1] - 2026-06-26

### Added
- **OpenClaw compatible bundle** -- Added `memorix setup --agent openclaw` support for an OpenClaw-compatible bundle with bundled `.mcp.json`, official skills, and an OpenClaw `HOOK.md`/`handler.ts` hook pack, plus workspace MCP sync support for OpenClaw's `~/.openclaw/openclaw.json` `mcp.servers` format.
- **Hermes Agent plugin** -- Added `memorix setup --agent hermes` support for a Hermes plugin under `~/.hermes/plugins/memorix`, plugin enablement in `~/.hermes/config.yaml`, plugin hooks, a slash command, a CLI command, official skills, and `mcp_servers` MCP config.
- **Oh-my-Pi package** -- Added `memorix setup --agent omp` support for an `omp.extensions` package with extension hook events, a `memorix` command, official skills, and Oh-my-Pi `.omp/mcp.json` / `~/.omp/agent/mcp.json` MCP config.

### Changed
- **Gemini CLI and Antigravity positioning** -- Documented Google's current Gemini CLI to Antigravity CLI transition while keeping `gemini-cli` and `antigravity` as separate Memorix targets because their supported install/config lanes are still distinct.
- **OpenClaw/Hermes/Oh-my-Pi setup lanes** -- These targets now use their official package/plugin/bundle extension points instead of being treated as MCP-only fallback clients.

### Fixed
- **MCP config merging** -- Setup now deep-merges nested `mcp.servers` JSON configs and preserves existing Hermes YAML keys when adding the Memorix server.
- **Workspace tool schemas** -- `memorix_workspace_sync` now accepts `gemini-cli`, `openclaw`, `hermes`, and `omp` targets; `memorix_rules_sync` now exposes the existing Gemini CLI rules adapter.
- **Hook fallback guard** -- Direct `memorix hooks install --agent openclaw|hermes|omp` no longer writes fallback hook files and instead points users to the package-owned setup lane.

## [1.1.0] - 2026-06-21

### Added -- Official Agent Integration Packages
- **One-command setup** -- Added `memorix setup` as the main installer for Claude Code, Codex, GitHub Copilot CLI, Cursor, Windsurf, Gemini CLI, OpenCode, Pi, Kiro, Antigravity, Trae, and generic MCP clients.
- **Official plugin/package templates** -- Added first-party integration packages under `plugins/` for Claude Code, Codex, GitHub Copilot CLI, Gemini CLI, Pi, and Cursor package assets. Setup installs each host through its closest native entry point instead of asking users to assemble MCP, rules, skills, and hooks by hand.
- **Official Memorix skills** -- Added seven practical agent skills: memory search/store, reasoning memory, sessions and handoff, Git Memory, mini-skills, orchestration, and troubleshooting. The skills prefer MCP tools when available and document CLI fallbacks for operator use.
- **Integration matrix docs** -- Added `docs/INTEGRATIONS.md` and updated README/setup docs to explain plugin packages, MCP, project guidance, hooks, skills, memcode, and when HTTP MCP is actually useful.

### Changed
- **CLI as the operator surface** -- The `memorix` CLI now documents and exposes the operator path for setup, memory, reasoning, sessions, Git Memory, transfer, retention, dashboard, orchestration, sync, ingest, skills, and diagnostics. MCP remains the agent-tool entry point.
- **Stdio MCP stays the default** -- Normal agent setup uses `memorix serve`. HTTP MCP is documented as an advanced control-plane path for dashboard, Docker, shared endpoint, or multiple clients.
- **Agent Team wording tightened** -- User-facing docs now frame orchestration as subagent/task coordination through `memorix orchestrate`, not a separate “agents team” product.
- **memcode enters the 1.1 line** -- The bundled first-party memagent remains available through `memorix`, `memorix memcode`, and `memcode`, with shared Memorix project memory and updated setup/docs.

### Fixed
- **Release packaging coverage** -- npm package contents now include official plugin templates, skills, hooks, and integration docs so published installs can generate the same setup files tested in the repository.
- **Claude marketplace version drift** -- The generated Claude local marketplace now uses the current CLI package version instead of a hard-coded release number.
- **Session CLI fallback** -- `memorix session start` supports `--projectRoot`, matching the official sessions/troubleshooting skill guidance for CLI fallback use.
- **Windows publish workflow alignment** -- GitHub npm publish workflow now uses Node.js 22, matching the package engine floor.

### Verification
- Targeted setup, hook, skill, CLI, and operator-surface tests passed during release preparation.
- `npm run lint`, `npm run build`, and npm pack inspection were used to verify TypeScript, bundled CLI output, and published package contents.

## [1.0.11] - 2026-06-13

### Added -- memcode Native Agent Release Candidate
- **Bundled memcode entry path** -- `memorix` with no subcommand and `memorix memcode` now launch the native memcode coding agent path, backed by the Pi-derived agent runtime under the Memorix package namespace.
- **Native Memorix runtime awareness** -- memcode now exposes first-party runtime status through `memorix_status` and `/memory status`, including canonical project identity, shared aliases, project memory counts, source/value distribution, embedding/vector status, search mode, memory LLM lane, retention summary, native hook state, and last injected memory refs.
- **Native hook bridge** -- memcode feeds its own prompt, tool, and assistant lifecycle events into the Memorix hook pipeline by default instead of behaving like an external MCP-only integration.
- **Memory startup and command surface** -- restored the normal agent conversation surface with full slash-command discovery, startup diagnostics, startup card, memory commands, and native `/memory hooks` inspection.

### Changed
- **Shared project memory remains the default** -- memcode uses the same canonical project memory pool as Claude Code, Codex, and other Memorix-connected agents. memcode-specific behavior is represented with metadata rather than a separate memory bucket.
- **API key lanes are isolated** -- memory LLM, embedding, and agent calls now use separate configuration lanes so users can mix providers without accidental cross-lane key reuse.
- **TUI interaction model stabilized** -- mouse text selection, wheel scroll, prompt history, activity status, and input rendering were aligned with normal coding-agent TUI expectations.
- **Runtime floor aligned with memcode** -- the package now declares Node.js `>=22.19.0`, matching the bundled native coding-agent stack.

### Fixed
- **Embedding fallback noise** -- invalid or unavailable embedding providers now fall back to BM25 with concise diagnostics instead of repeatedly deforming the TUI or spamming runtime output.
- **Runtime config loading** -- YAML loading works in ESM contexts without relying on an unbound CommonJS `require`.
- **Publish blocker** -- removed the stale Pi shrinkwrap path from memcode packaging so `@memorix/memcode` no longer locks installs to `@earendil-works/pi-*` packages or calls a missing shrinkwrap generator.

## [1.0.10] - 2026-06-08

### Added -- Low-Intrusion Handoff Diagnostics
- **Privacy-safe handoff receipts (#95)** -- Added `memorix receipt --json` for cross-agent memory debugging. Receipts expose project identity hashes, write/search counts, recent observation ID hashes, and privacy boundaries without raw chat, raw memory text, raw search queries, tool payloads, or local file paths.
- **Doctor receipt mode** -- Added `memorix doctor --receipt` so support/debugging can include the same receipt summary alongside normal health diagnostics.
- **Cross-agent memory boundary docs** -- Documented the operational boundary: MCP connection success does not mean a memory was written, and shared memory means stored memories are searchable across clients in the same Git project, not that chat transcripts are mirrored.
- **TUI Agent LLM config scope** -- Added `agent` / `MEMORIX_AGENT_LLM_*` configuration for TUI/chat agent calls. Memory formation, compression, rerank, and embedding remain on their existing `llm` / `embedding` configuration paths. If `agent` is unset, TUI chat falls back to `llm` for backward compatibility.

### Changed
- **Generated agent rules are less intrusive** -- Rules now prefer `memorix_search` when useful and treat `memorix_session_start` as optional, reserved for handoff, long-running work, session recovery, team coordination, or HTTP project binding.
- **Agent Team wording tightened** -- Public docs now frame Agent Team as optional autonomous-agent/subagent coordination state rather than an IDE-window chat room. Existing `team_*` APIs and CLI namespaces are unchanged.

### Fixed
- **Release publish blocker** -- `tests/integration/release-blockers.test.ts` now reserves an ephemeral local TCP port for the real `memorix serve-http` smoke test instead of assuming port `19879` is free. This removes a CI-only `EADDRINUSE` failure that blocked the npm publish workflow.
- **Standalone dashboard embedding config (#46 follow-up)** -- `memorix dashboard` now loads project `.env` / project YAML before dashboard status routes initialize embedding provider state, matching `status`, `doctor`, and TUI behavior.

### Documentation
- Added a small moving-between-machines note covering `memorix transfer export/import` without changing the Memorix package name or primary README structure.

## [1.0.9] - 2026-05-19

### Added -- Knowledge Base / LLM Wiki Foundation
- **First-class Knowledge Base layer** -- Added a readable project knowledge layer generated from durable memory, git-backed facts, mini-skills, and project evidence. The Knowledge Base is a shared human-and-AI surface, not a replacement for raw observations and not a TUI-only feature.
- **Knowledge graph projection** -- Added a semantic graph projection over the same eligible knowledge inputs, preserving source refs for navigation and traceability.
- **Dashboard Knowledge foundation** -- Dashboard surfaces can consume the same generated knowledge contract as the TUI, keeping Knowledge Base and graph semantics aligned.

### Added -- TUI Knowledge Workbench
- **Tabbed terminal workbench** -- Reworked the TUI around `Home`, `Knowledge`, `Memory`, `Workbench`, and `Graph` tabs.
- **Knowledge browsing** -- Added a Knowledge tab for generated wiki sections, item summaries, entities, and source refs.
- **Memory browsing** -- Added a Memory tab for recent/search/detail flows with ref-focused navigation from Knowledge.
- **Workbench session center** -- Added explicit session status, explicit bind/end actions, context source summary, and chat. Entering the tab does not auto-start a session.
- **Graph text browser** -- Added a terminal-native Knowledge Graph tab with summary stats, cluster browsing, node detail, light filtering, and Graph -> Knowledge jumps.
- **Cross-surface ref navigation** -- Added Knowledge -> Memory, Memory -> Knowledge, and Graph -> Knowledge navigation paths based on stable refs where available.

### Changed
- **Knowledge architecture clarified** -- Documented the memory layer as the primary input to the knowledge layer, while project evidence such as docs, source structure, and git facts act as secondary inputs.
- **TUI scope tightened** -- The TUI now behaves as a knowledge-native workbench, not a placeholder coding-agent harness. No fake Run Task / Review controls are exposed.
- **Session semantics preserved** -- `session_start` remains explicit and lightweight. Agent Team join remains opt-in.

### Fixed
- **Formation duplicate detection (#94)** -- Fixed Formation resolve comparing raw Orama/BM25 ranking scores against normalized similarity thresholds. Noisy log-dump memories with high backend scores no longer discard unrelated valid memories as duplicates.
- **TUI chat input lock** -- Fixed a regression where after a free-text chat response the bottom input bar became unresponsive because the chat overlay disabled the CommandBar. Chat overlay now keeps input active so users can continue the conversation.
- **TUI read-only overlay input lock** -- Fixed read-only overlays such as `/doctor` disabling the CommandBar. Users can now keep typing commands or questions while diagnostics and other non-action views are open.
- **TUI shortcut/input conflicts** -- Fixed CommandBar conflicts with view shortcuts such as Graph `f`/`k`, Memory `k`, and Knowledge `m` while still allowing normal first-character input.
- **Graph TypeScript build issue** -- Fixed a type-only re-export under `verbatimModuleSyntax`.

### Known Limitations
- The Knowledge Base and Knowledge Graph are read-only generated projections in 1.0.9.
- 1.0.9 does not include a desktop app, realtime agent messaging layer, GraphRAG system, graph editing, or full coding-agent harness.

### Stats
- **Verified TUI subset:** 95 passing tests across `interaction`, `workbench`, and `graph` suites.
- **Release gates run during cleanup:** `npm run lint`, `npm run build`, and full `npm test`.

## [1.0.8] - 2026-04-19

### Added -- Operator CLI Surface
- **Namespaced operator commands** -- Added human-oriented CLI namespaces for `session`, `memory`, `reasoning`, `retention`, `formation`, `audit`, `transfer`, `skills`, `team`, `task`, `message`, `lock`, `handoff`, `poll`, `sync`, and `ingest` so Memorix-native operations no longer require raw MCP tool calls.
- **Lightweight session start + explicit collaboration join** -- `memorix session start` now opens project-bound memory sessions without auto-registering a team identity. Operators can opt into collaboration with `--joinTeam`, or join later via `memorix team join`, while still getting default role mapping from `agentType` when they do join.
- **CLI-first project ops** -- Terminal operators can now inspect memory detail/timeline, store and search reasoning traces, run retention and formation checks, audit attribution, export/import memory snapshots, inspect/generate skills, run explicit rules/workspace sync flows, and ingest images without leaving the shell.

### Added -- Programmatic SDK
- **`memorix/sdk` subpath export** -- `createMemoryClient()` factory returns a self-contained `MemoryClient` with `store`, `search`, `get`, `getAll`, `count`, `resolve`, and `close` methods. No MCP transport or CLI needed — initialize from a Git project root, read/write observations directly.
- **`createMemorixServer` re-export** -- Embed the full MCP server into your own Node.js process and connect it to any transport.
- **`detectProject` re-export** -- Standalone Git-based project detection.
- **Three subpath exports** -- `memorix/sdk` (runtime API + types), `memorix/types` (type-only), `memorix` (MCP stdio entry).

### Added -- Official Docker Deployment
- **Official HTTP control-plane container path** -- `Dockerfile` now builds a real `serve-http` runtime image instead of defaulting to stdio MCP.
- **Compose example** -- added `compose.yaml` with port `3211`, persistent data volume, and `/health` healthcheck.
- **Docker docs** -- added `docs/DOCKER.md` and linked Docker deployment from README / setup docs.
- **Runtime truth** -- documentation now explicitly states that Docker support is for the HTTP control plane and that project-scoped Git/config behavior requires the container to see the bound repo path.

### Visual Semantic Layering (dashboard follow-up)
- Team mental model tightened before release: docs and dashboard copy now say "explicit collaborators" instead of implying a persistent IDE-window roster.
- `memorix team status` now defaults to active collaborators only; inactive/historical identities remain available with `--all` for audits without flooding the normal operator view.
- Team page headline is now **active-only**; `recent`/`historical` shown as secondary subtitle only.
- Team agents list gets four filter tabs: **Active** (default) / Recent / Historical / All. Historical rows no longer flood the view; they sit behind an explicit "Show historical (N)" toggle.
- Each agent row carries an explicit tier badge (Active/Recent/Historical) instead of a single "offline" sea of red.
- Historical agent rows are de-emphasized (reduced opacity, muted colors) so they don't dominate the main view.
- Identity page headline shows **real** project count + **real** alias groups only. Temporary/placeholder IDs moved into a collapsed "Historical / temporary project IDs" section.
- Identity "Dirty IDs" card now splits current-project dirty (primary) from historical dirty (secondary) so a single placeholder no longer looks like an active problem.
- Project switcher groups items into **Current / Real projects / Temporary / Placeholder**, with temporary and placeholder folded behind a "Show temporary" toggle. Each group has a visible count so users can tell a real project list apart from the historical test/smoke scratch pile.
- All new labels wired through the i18n system (English + Simplified Chinese).

### Team Page Cleanup (1.0.7 final)
- **Team page semantics**: clearly presented as a **project collaboration space**, not an organization backend or staffing admin tool. Scope labels: "Project Collaboration" / "All Projects".
- **Explicit collaboration join**: `memorix_session_start` is lightweight by default and no longer auto-registers a team identity. Collaboration is now opt-in via `joinTeam: true` or `team_manage(join)`, and default role mapping from `agentType` applies only when joining.
- **"Continue This Project" resume area**: shows open tasks, available-to-claim tasks, open handoffs, unread messages, active locks, and active agent count at the top of the Team page. Provides a clear "pick up where you left off" entry point.
- **Unified statistics**: stat cards clearly labeled — Active Agents (with session count + historical total), Locked Files, Tasks (by status), Messages (unread count). No conflicting or ambiguous labels.

### Added -- Multi-Agent Orchestrator (Phase 7)
- **`memorix orchestrate`** -- Autonomous pipeline: plan → parallel execution → verify gates → fix loops → review → merge. 4 agent adapters (Claude, Codex, Gemini, OpenCode), capability routing with quotas, worktree isolation, evidence collection, stranded task detection, agent fallback on repeated failures.
- **CLI flags**: `--agents claude:2,codex:1`, `--goal`, `--parallel`, `--compile-command`, `--test-command`, `--max-fix`, `--budget`, `--routing`, `--memory-capture`, `--no-evidence`, `--global-timeout`

### Added -- SQLite Canonical Store (Phase 2)
- Observations, mini-skills, sessions, archives all in SQLite. Shared DB handle, freshness-safe retrieval, in-place archiving.

### Added -- Team Identity (Phase 4)
- Team store with agent registration, heartbeat, task board, handoff artifacts, stale detection. Prompt identity contract, sticky attribution prevention.

### Fixed
- **HTTP stale-session poisoning (#82)** — `serve-http` no longer has only a hardcoded 30-minute idle GC. Added `MEMORIX_SESSION_TIMEOUT_MS` so long-running HTTP MCP clients such as Codex can keep sessions alive for longer work blocks without getting stuck on stale `Mcp-Session-Id` failures.
- **TUI responsive layout** — sidebar width now scales with terminal width (28% ratio, 26-40 range) instead of fixed 34 columns; content area uses `flexGrow` to fill remaining space; maximized terminal windows now show expanded UI instead of locked small-window layout
- **TUI search score display** — replaced absurd raw-percentage display (e.g. "927%") with relative relevance dots (●●●○○) normalized against top result
- **TUI /resume numeric index** — `/resume 2` now selects thread #2 from the list (1-based), in addition to `/resume <threadId>` by ID
- **TUI CJK text wrapping** — Ink's `wrap="wrap"` doesn't understand double-width CJK characters, causing garbled text; replaced with CJK-aware manual line splitting in chat output and ContextRail sizing so mixed CJK content renders predictably
- **TUI layout DRY** — sidebar/content width calculation extracted to shared `computeLayoutWidths()` in theme.ts; App.tsx and ChatView.tsx now use the same function, preventing drift
- **TUI CommandBar overlay** — palette no longer pushes input bar down; rendered as overlay in App.tsx; mouse SGR mode centrally managed to avoid conflicts between palette clicks and chat scrolling
- **TUI chat freeze under assistant output** — removed assistant Markdown rendering from the workbench chat path and render chat bodies as plain text with CJK-aware wrapping; this avoids heavy reparsing/rerender spikes that could freeze the TUI when the assistant started answering after tool calls
- **#4** Parallel multi-agent — fully implemented via orchestrator
- **#52** observations.json perf — migrated to SQLite
- **#56** LLM rerank timeout — configurable via `MEMORIX_RERANK_TIMEOUT_MS`
- **#75** Cursor stdio binding — deferred-binding mode instead of exit
- **Gemini JSON parse** — brace-counting extractor handles trailing text
- **Evidence for failed tasks** — both fix-exhausted and normal failure paths now write evidence
- **Agent fallback** — failed agents excluded from retry routing
- **P1: uninstall hooks** — shared context files (AGENTS.md/GEMINI.md) now block-level removal instead of deleting entire file
- **P1: budget abort** — current settled dispatch now fails task (was left stuck in_progress)
- **P1: streaming completion** — waits for stdout/stderr close before resolving (was missing final JSONL lines)
- **P1: Claude adapter headless hang** — added `--bare` flag to skip hooks/LSP/keychain/interactive ops, plus `--mcp-config` to restore Memorix MCP tool access in bare mode
- **P1: planner JSON materialization** — use accumulated text from message stream instead of ring buffer `tailOutput` (avoids truncation when planner does many tool calls before outputting plan)
- **P1: reviewer hanging** — `--mcp-config` enables `memorix_handoff` / `team_task` MCP tool calls that reviewer needs for completion path
- **P1: structured planner double-create** — `plannerType: 'plan'` tasks now forbidden from calling `team_task create` (must output JSON only; coordinator materializes). Prevents duplicate engineer/reviewer tasks in goal-mode pipelines
- **P2: budget validation** — CLI and coordinator reject NaN/negative/zero budget values
- **P2: streaming buffer** — bounded at 1024 messages with drop-oldest policy
- **P2: install audit** — recordFile called even when Memorix block already exists (audit self-heal on reinstall)
- **P2: install audit** — new shared file creation also records audit entry
- **P2: uninstall return** — rules-only agents (codex/gemini-cli) return true when audit cleanup succeeds
- **#80** OpenCode hooks — plugin now uses individual event-name keys (`session.created`, `file.edited`, `command.executed`, etc.) instead of invalid catch-all `event` handler that OpenCode never called. Replaced fragile `cat | memorix hook` pipe with `Bun.spawn` stdin pipe for reliable cross-platform invocation. Added diagnostic logging on failure. Hooks status now distinguishes verified (config-based) from unverified (plugin-based) agents.
- **OpenCode plugin v5** — replaced `Bun.spawn` with `child_process.spawnSync` for cross-runtime compatibility (OpenCode may fall back to Node.js on Windows where Bun segfaults). Fixed `file.edited` field extraction (`input.path` before `input.file`). Added exit code and stderr diagnostic logging. Added 10s timeout to prevent hangs.
- **Copilot Windows runtime** — `powershell` field omitted from hook config when `pwsh` (PowerShell v7+) is not installed, preventing `spawn pwsh.exe ENOENT` errors. Copilot falls back to `bash` field (Git Bash). Install command warns if `pwsh` is missing on Windows and suggests `winget install Microsoft.PowerShell`.
- **Copilot global hooks** — `getGlobalConfigPath('copilot')` was falling through to the Claude case and returning `~/.claude/settings.json`, which is completely wrong. Per official GitHub docs, Copilot only supports project-level hooks at `.github/hooks/*.json` — there is no global hooks path. Fixed by returning empty string for global path, adding guards in install/uninstall to reject `--global` for Copilot, and updating hooks status to skip the global check.
- **Hook handler diagnostics** — `runHook()` store path and `handleSessionStart()` now log errors to stderr instead of silently swallowing, making end-to-end pipeline failures visible for debugging.

### Added -- 1.0.7 Closeout
- **Routing explainability** — `buildRoutingDecision()` / `buildIdleReasons()` helpers trace adapter selection reasons (default_preference, cli_override, quota_fallback, excluded_failed, last_resort) in pipeline trace, evidence, and summary
- **Structured role extraction** — `extractRole()` prioritizes `metadata.role` over `[Role: ...]` text parsing; canonical source is structured metadata
- **Balanced scheduling** — `--scheduling balanced` policy with round-robin tiebreaker among equally-preferred adapters; `best-fit` remains default
- **Idle agent visibility** — pipeline summary includes `idleAgents` with reasons for non-participation
- **Pipeline summary extensions** — `routingDecisions` and `idleAgents` fields in `PipelineSummary` for full explainability
- **#62+#74** dashboard loadDotenv
- **#70** doctor health check
- **#69** background start non-TTY hang
- **#66** dashboard delete/cleanup/export
- **#79** Codex roots/list protocol compatibility
- **#18** dot-directory merge + hooks install migration

### Removed -- Dead Code (Stabilization)
- **`src/store/json-store.ts`** — `JsonBackend` class deleted; no runtime or test references. SQLite is sole canonical backend, `DegradedBackend` is read-only fallback.
- **`appendArchivedObservations` / `loadArchivedObservations`** — dead code removed from `persistence-json.ts` and `persistence.ts` re-exports. Archives live in SQLite `status='archived'` rows.
- **`'json'` from `getBackendName()` return type** — union narrowed to `'sqlite' | 'degraded'` across `ObservationStore` interface, `SqliteBackend`, `DegradedBackend`.

### Changed -- Stale Naming Cleanup
- All `JsonBackend` references in comments and test names replaced with `DegradedBackend`.
- `observations.ts:71` "For JsonBackend" → "For DegradedBackend".
- `obs-store.ts:91` "JsonBackend: no-op" → "DegradedBackend: no-op".
- `sqlite-store.test.ts:389` test name "falls back to JsonBackend" → "falls back to DegradedBackend", assertion `['sqlite', 'json']` → `['sqlite', 'degraded']`.

### Fixed -- Dashboard Semantics Closure
- **Mode/Port semantics** — `DashboardState` now includes `mode` ('standalone' | 'control-plane') and `port`. `/api/project` returns `mode`, `port`, and `mcpEndpoint`. Dashboard UI shows mode banner with i18n support.
- **Team API contract** — `/api/team` in control-plane mode now normalizes SQLite snake_case rows to camelCase, matching the frontend contract. Added `listAllAgents`, `listAllLocks`, `listAllTasks` to `TeamStore` for global scope.
- **Team page crash-proof** — `loadTeam()` safely normalizes missing/null fields (`a.id`, `tk.deps`, `l.lockedBy`). No more `Cannot read properties of undefined` errors.
- **Project switcher sync** — Switching project in the dashboard now calls `/api/set-current-project` to sync backend state.
- **i18n coverage** — All remaining hardcoded English strings in Team page (time ago, lock TTL, agent time labels, session count) now use `t()` with Chinese translations.
- **CLI help alignment** — `memorix dashboard` and `memorix serve-http` JSDoc now document mode semantics (Standalone=3210, Control Plane=3211). Startup logs show mode label.

### Changed -- Test Suite Stabilization
- **E2e demo tests** (`tests/e2e/`) excluded from default `vitest run` — these test CLI-agent demo artifacts, not Memorix product code. Available via `npm run test:e2e`.
- **Live LLM quality tests** excluded from default suite — require `MEMORIX_RUN_LIVE_LLM_TESTS=1`. Rules-only fallback test preserved in `tests/memory/formation-rules-fallback.test.ts`. Available via `npm run test:llm-live`.
- **Coordinator merge-conflict test** made deterministic — synchronous conflict file writes in `spawn()` instead of async `setTimeout` race. Removed `{ retry: 3 }`.
- **Default test suite**: 156 files, 2064 tests, **0 failed**.

### Added -- Hooks Test Coverage
- Audit ledger lost/corrupted → re-install recovers audit entry (codex).
- Non-shared-rules agent install/uninstall (claude) verifying config file creation and cleanup.

## [1.0.6] - 2026-04-05

### Added -- Memory Provenance and Layered Retrieval
- **Provenance foundation** -- Observations now carry `sourceDetail` (`explicit` / `hook` / `git-ingest`) and `valueCategory` (`core` / `contextual` / `ephemeral`). All ten write-path call sites annotated. Backward-compatible: old data without new fields parses cleanly.
- **Layered disclosure (L1/L2/L3)** -- `memorix_session_start` now separates routing hints (L1), working context (L2), and deep evidence (L3). Session injection scores observations by source and value category so hook noise stays out of working context.
- **Evidence retrieval** -- `memorix_detail` and `memorix_timeline` now surface provenance cues (source badge, evidence basis) so operators can trace why a memory exists and what supports it.
- **Verification-aware evidence** -- Detail and timeline outputs distinguish direct, summarized, derived, and repository-backed evidence without requiring a full citation framework.
- **Citation-lite** -- Evidence-bearing surfaces emit lightweight citation hints (`[source: git]`, `[verified: repo-backed]`) to support "why surfaced" and "what supports this" queries.
- **Retrieval tuning** -- Source-aware boost treats `git-ingest` as first-class git evidence for intent-aware ranking. Lightweight provenance tiebreaking for ambiguous retrieval results. L1 routing surfaces active entities as next-hop search guidance.
- **Graph routing hints** -- Knowledge graph neighborhood is used for lightweight retrieval enrichment and entity-affinity scoring without a full graph rewrite.

### Added -- Task-Line Scoping, Secret Safety, and Attribution Hardening
- **Task-line scoping** -- Search and session context now bias toward the current entity/task-line/subdomain, reducing cross-workstream contamination within a single project bucket.
- **Secret safety** -- Store-time detection blocks obvious credentials, passwords, and tokens from entering durable memory. Retrieval-time redaction acts as a second safety net for already-stored sensitive data.
- **Project attribution hardening** -- Write-path consistency checks reduce wrong-bucket writes. `memorix_audit_project` scans for misattributed observations and reports them with confidence levels.
- **Ambiguous-target attribution fix** -- Observations stored during ambiguous project context are now flagged rather than silently written to the wrong bucket.

### Added -- Retention, Cleanup, and Operator Remediation
- **Retention calibration** -- Source-aware retention multipliers (hook 0.5x, git-ingest 1.5x) and value-category multipliers (ephemeral 0.5x, core 2.0x) with a 7-day minimum floor. Immunity refined: only `critical` importance and `core` valueCategory grant permanent immunity; `high`-importance types keep long retention but can now decay.
- **Retention explainability** -- `memorix_retention action="stale"` shows a full table with per-observation retention explanation (importance, multipliers, effective days, zone, immunity reason).
- **Cleanup remediation loop** -- `memorix_retention` (stale/report), `memorix_audit_project`, and `memorix_resolve` now form a coherent operator loop. Each output includes structured `Suggested IDs: [...]` blocks and explicit next-step guidance. `memorix_resolve` links back to retention report for closed-loop cleanup.

### Added -- OpenCode Plugin Improvements
- **`post_compact` event** -- New `post_compact` hook event type. OpenCode's `session.compacted` event correctly maps to `post_compact` (was incorrectly mapped to `pre_compact`). Plugin event handler triggers `runHook` side-effect on compaction completion.
- **Structured compaction prompt** -- OpenCode compaction prompt rewritten as a structured continuation format requesting current task, key decisions, active files, blockers, next steps, active entities, and memorix context. No longer promises automatic `memorix_store` / `memorix_session_start` invocation during compaction.

### Fixed
- **#45 OpenCode compaction** -- Compaction prompt no longer makes misleading tool-call promises. `session.compacted` event now fires a real side-effect via `runHook`. Normalizer mapping corrected to `post_compact`.
- **#46 Dotenv load order** -- `loadDotenv()` now runs before `getEmbeddingProvider()` in `status`, `doctor`, and TUI entry points, fixing "No API key" errors when `.env` credentials were present.
- **#48 Ingest log dedup** -- `memorix ingest log` now deduplicates by commit hash, matching the behavior of `ingest commit` and TUI batch ingest. Repeated runs skip already-ingested commits.

### Stats
- **Tests:** 1439 passed | 2 skipped (102 files)
- **Phases landed:** 11 (provenance -> layered disclosure -> evidence -> verification -> citation-lite -> retrieval tuning -> graph routing -> task-line/secret -> attribution -> retention -> cleanup ergonomics)

---

## [1.0.5] - 2026-03-24

### Added
- **TUI workbench matured into a product-grade terminal UI** - Added an Ink-native `/configure` flow, interactive sidebar navigation, unified keyboard model, better no-project empty state, compact responsive layouts, and broader TUI interaction coverage.
- **Gemini CLI as a first-class integration target** - Added a dedicated Gemini CLI target across TUI integrate flows, workspace adapters, rules sync, hook normalization, and MCP config generation.
- **Release-blocker regression suite** - Added real embedded `serve-http` route tests for CORS and `/api/config`, plus cold-start CLI search regression coverage against persisted observations.
- **Silent auto-update wiring** - Wired the existing updater into real runtime entry points so TUI and HTTP control-plane starts can background-check and silently install newer npm releases without blocking startup.

### Changed
- **Control plane stability and scope semantics** - Hardened HTTP project binding, dashboard API behavior, project-scoped health/search diagnostics, and release-readiness around multi-project sessions.
- **Product positioning and integration messaging** - Updated README, AI-facing docs, and agent/rules entry docs to foreground Memorix as an open-source cross-agent memory layer compatible with ten major coding IDEs and MCP hosts.
- **Search and retrieval transparency** - Search mode reporting is now project-scoped end-to-end, including TUI, embedded stats, and MCP search responses.
- **Session handoff semantics** - `memorix_session_start` now separates `Recent Handoff`, `Key Project Memories`, and `Recent Session History` so recency-first handoff context is no longer mixed with long-term importance-ranked memories.

### Fixed
- **Embedded dashboard security and config isolation** - Fixed localhost-only CORS behavior for embedded dashboard JSON APIs and closed the `/api/config?project=...` startup-project YAML leak.
- **Cross-project retrieval correctness** - Fixed `memorix_detail` bare numeric IDs to remain project-safe instead of opening observations from another project.
- **Concurrent memory write consistency** - Fixed `topicKey` upsert races by rechecking authoritative disk state under the file lock before deciding whether to create or update.
- **CLI cold-start search regression** - Fixed `memorix search` so persisted observations are hydrated into the Orama index on a fresh process before searching.
- **Embedding provider resilience** - Fixed API embedding batch-limit handling with provider-aware chunking, automatic split-and-retry on oversized batches, and retry handling for transient 429/5xx errors.
- **OpenCode stale plugin detection** - Added generated-version markers and hook-status detection so outdated OpenCode plugin installs are surfaced and can be reinstalled before they corrupt the TUI experience.
- **Documentation encoding regressions** - Restored clean UTF-8 copy for Chinese README content and agent/rules entry docs so release docs match the current product shape.

### Known Limitations
- **Gemini CLI / Antigravity shared `.gemini/*` ecosystem** - This follows the official Gemini ecosystem design. Integrations are independent at the target/adapter level, but hook runtime identity can still behave as "last installer wins" because both share the same official hook config surface.

### Stats
- **Tests:** 1099/1101 passing (`82` files, `2` skipped)
- **Runtime surfaces covered before release:** stdio MCP, HTTP control plane, dashboard, TUI workbench, silent auto-update, Gemini CLI integration, git-hook ingest, and cold-start CLI search

---

## [1.0.4] -- 2026-03-17

### Added
- **Git Memory pipeline** -- `git commit` can now flow directly into Memorix via `memorix git-hook`, `memorix git-hook-uninstall`, and `memorix ingest commit --auto`. Stored observations now carry `source` and `commitHash`, and Git memories can be filtered explicitly with `source: "git"`.
- **Reasoning Memory tools** -- Added `memorix_store_reasoning` and `memorix_search_reasoning` so design rationale, alternatives, constraints, and risks can be stored and searched as a first-class memory layer.
- **Source-aware retrieval and cross-linking** -- Search now boosts Git, reasoning, and problem-solution memories differently based on query intent. Git memories and reasoning memories can cross-reference each other via related commits and shared entities.
- **Structured config model** -- Added project/user `memorix.yml`, project/user `.env` loading, `memorix init`, and configuration provenance diagnostics in `memorix status`.
- **Dashboard control plane upgrades** -- Added Git Memory, Config Provenance, and Identity Health views, plus richer stats and a stabilized graph layout for the HTTP dashboard.

### Changed
- **Documentation consolidation** -- Reworked README, README.zh-CN, setup, architecture, API reference, configuration, Git Memory, and development guides so they match the current product model: local-first platform, `memorix.yml + .env`, Git Memory, HTTP dashboard, and the four-layer architecture.
- **Project detection model** -- Project identity now centers on real Git roots, MCP roots support, system-directory fallback handling, and runtime project switching instead of older placeholder-style fallback identities.
- **Dashboard usage model** -- `memorix background start` is now the primary long-lived HTTP control-plane entrypoint when you want HTTP transport, collaboration features, and dashboard access in one place. `memorix serve-http --port 3211` remains the foreground/debug variant.

### Fixed
- **Project identity drift** -- Fixed Codex/Windsurf startup issues that produced `local/System32`, IDE-installation-directory identities, or other incorrect local project bindings.
- **Worktree-safe Git hooks** -- Hook installation, uninstall, auto-install checks, and status reporting now resolve hooks directories correctly for both normal repos and Git worktrees.
- **Runtime config correctness** -- Fixed project-level `memorix.yml` not reaching runtime getters, `.env` values leaking across project switches, and legacy `config.json` not showing up correctly in provenance diagnostics.
- **Git Memory quality** -- Added noise filtering, preserved release/version milestone commits, and implemented `memorix ingest commit --force` as an escape hatch for manual ingestion.
- **Cross-project detail retrieval** -- Global search results can now be opened reliably with project-aware refs instead of colliding on observation IDs from different projects.
- **Skill generation noise** -- `memorix_skills generate` now filters low-signal command-history observations like `git`, `gh`, `npm`, and `npx` so generated skills stay project-relevant.
- **OpenCode static plugin noise** -- Merged the first external PR to silence `console.log` spam in the static OpenCode plugin without reintroducing session lifecycle side effects.
- **CI/publish flow** -- Restored CI green after type/test regressions and changed npm publishing workflow to manual trigger instead of automatic release publishing.

### Stats
- **Tests:** 879/879 passing across 68 files
- **Runtime modes:** stdio MCP (`memorix serve`), HTTP MCP + dashboard (`memorix background start` by default, or `memorix serve-http --port 3211` in the foreground), and standalone dashboard remain supported

---

## [1.0.3] -- 2026-03-14

### Added
- **Memory Formation Pipeline** -- Three-stage pipeline (Extract -> Resolve -> Evaluate) runs in shadow mode on every `memorix_store` call and hooks trigger. Collects quality metrics without affecting storage decisions.
  - **Extract**: Automatic fact extraction from narratives, title normalization, entity resolution against Knowledge Graph, observation type verification.
  - **Resolve**: 4 resolution actions (new/merge/evolve/discard) based on similarity scoring, word overlap, and contradiction detection.
  - **Evaluate**: Multi-factor knowledge value assessment (type weight, fact density, specificity, causal reasoning, noise detection). Categorizes memories as core/contextual/ephemeral.
- **`memorix_formation_metrics` tool** -- New MCP tool to query aggregated Formation Pipeline metrics (value scores, resolution actions, extraction rates, processing times).
- **`getEntityNames()` method** on `KnowledgeGraphManager` for Formation Pipeline entity resolution.

### Stats
- **Default MCP Tools:** 23 (+1: `memorix_formation_metrics`)
- **Tests:** 803/803 passing across 60 files (+50 new Formation Pipeline tests)
- **Hooks safety:** handler.ts +21 lines (shadow call only), zero modification to existing hook logic

---

## [1.0.2] -- 2026-03-14

### Fixed
- **MCP Server version mismatch** -- Server now reports the correct version from `package.json` (was hardcoded `0.1.0`). Injected at build time via tsup `define`.
- **CI Node.js matrix** -- Removed Node 18 from CI matrix to match `engines: >=20` in `package.json`.
- **Orama reindex idempotency** -- `reindexObservations()` now resets the Orama DB before rebuilding, eliminating "document already exists" errors in multi-session scenarios.
- **E2E tests no longer touch real user data** -- Mini-skills E2E tests now use a temporary directory with synthetic observations instead of reading/writing `~/.memorix/data/`.

---

## [1.0.1] -- 2026-03-14

### Fixed
- **OpenCode stdout pollution** -- Removed all `console.log` / `console.error` from the generated OpenCode plugin template. Hooks now run fully silent. (fixes #15)
- **OpenCode session_id missing** -- `normalizeOpenCode()` now reads `session_id` from the payload instead of hardcoding empty string. Plugin template generates and injects a stable session ID per plugin lifetime. (fixes #14)
- **Auto-install hooks scope** -- Hooks are now only auto-installed for IDEs whose project-level config directory already exists (e.g., `.cursor/`, `.windsurf/`), preventing unwanted IDE directories from appearing in projects opened with a different IDE.

### Added
- **`MEMORIX_DATA_DIR` environment variable** -- Override the default data directory (`~/.memorix/data/`) by setting `MEMORIX_DATA_DIR`. Applied consistently across persistence, alias registry, and embedding cache.

---

## [1.0.0] -- 2026-03-09

### 🎉 First Stable Release

Memorix reaches v1.0.0 -- all major features complete. Future versions will iterate based on AI/agent ecosystem evolution.

### Added
- **Multi-Agent Team Collaboration** -- 4 team tools (`team_manage`, `team_file_lock`, `team_task`, `team_message`) for cross-IDE agent coordination. File-based persistence via `team-state.json`. Verified: Windsurf <-> Antigravity bidirectional communication.
- **Auto-Cleanup on Startup** -- Background retention archiving and intelligent deduplication run automatically in `deferredInit`. With LLM configured: semantic dedup via any OpenAI-compatible model. Without LLM: Jaccard similarity consolidation. Zero manual maintenance required.
- **`memorix_transfer` tool** -- Merged `memorix_export` + `memorix_import` into a single tool with `action: "export" | "import"`.
- **TEAM.md** -- Multi-agent coordination protocol documentation.

### Changed
- **Tool consolidation: 41 -> 22 default tools (-46%)**
  - Team tools: 13 individual -> 4 merged (action parameter pattern)
  - Knowledge Graph tools: 9 -> conditional via `~/.memorix/settings.json` (`{ "knowledgeGraph": true }`)
  - Export+Import: 2 -> 1 (`memorix_transfer`)
- **Dashboard Team Panel** -- Redesigned with Iconify icons, Material Design 3 style. Agent cards, task lists, message panel, file lock panel.
- **README updated** for v1.0.0 stable (EN + 中文).

### Fixed
- **Windows EPERM file lock race condition** -- Treat EPERM same as EEXIST in file-lock.ts.
- **PowerShell BOM in config.json** -- `Set-Content -Encoding UTF8` adds BOM in PS 5.x, breaking `JSON.parse`. Always use Node.js for config file writes.

### Production Hardening
- Cross-session shared team state
- Inbox capped at 200 messages with auto-eviction
- Session timeout GC (30min idle -> auto-close)
- Send to inactive agent rejected
- Agent leave releases file locks + clears inbox
- Orphaned task rescue when assignee inactive
- Input validation: agent name max 100, message max 10KB

### Stats
- **Default MCP Tools:** 22 (+9 optional KG)
- **Tests:** 753/753 passing across 56 files
- **IDE Support:** 10 agents (Cursor, Windsurf, Claude Code, Codex, Copilot, Kiro, Antigravity, OpenCode, Trae, Gemini CLI)

## [0.12.0] -- 2026-03-08

### Added
- **Intent-Aware Recall** -- Search understands query intent ("why X?" prioritizes decisions/trade-offs, "how to X?" prioritizes how-it-works).
- **MCP Deadlock Fix** -- Resolved stdio transport deadlock under high concurrency.
- **Dashboard Dark Theme Fix** -- Proper dark mode support across all panels.
- **Build Race Condition Fix** -- Fixed tsup parallel build race condition.

## [0.11.0] -- 2026-03-07

### Added
- **Mini-Skills** (`memorix_promote`) -- Promote observations to permanent skills that auto-inject at session start. Never decay, project-scoped.
- **LLM Quality Engine** -- Compact-on-write (duplicate detection at write time), narrative compression (~27% token reduction), search reranking (60% queries improved).
- **`memorix_deduplicate` tool** -- LLM-powered semantic deduplication with dry-run support.
- **`memorix_resolve` tool** -- Mark completed tasks and fixed bugs as resolved to prevent context pollution.

### Fixed
- **Retention decay fix** -- Reclassified `what-changed`/`discovery` to low retention (30d instead of 90d).

### Stats
- **Tests:** 641 -> 674 passing

## [0.10.6] -- 2026-03-06

### Fixed
- Minor stability improvements.

## [0.10.5] -- 2026-03-05

### Fixed
- **🔴 Critical: Antigravity MCP connection failure** -- CLI banner (starting with 🧠 emoji, UTF-8 `F0 9F A7 A0`) was written to `stdout` via `console.log` in the non-interactive branch. When `citty` dispatches to `serve` subcommand, it calls parent `run()` first, polluting the MCP JSON-RPC stream. Go's `encoding/json` in Antigravity failed on the first byte `0xF0` with `invalid character 'ð'`. Fix: `console.log` -> `console.error` for all CLI banner output.
- **🔴 Critical: Claude Code Stop hook schema validation failure** -- `hookSpecificOutput` was returned for all hook events, but Claude Code only supports it for `PreToolUse`, `UserPromptSubmit`, and `PostToolUse`. Events like `SessionStart`, `Stop`, and `PreCompact` with `hookSpecificOutput` triggered `JSON validation failed: Invalid input`. Fix: only include `hookSpecificOutput` for the 3 supported event types.
- **Claude Code hook_event_name not read** -- Handler read `payload.hookEventName` (camelCase) but Claude Code sends `hook_event_name` (snake_case), causing `hookEventName` to always be empty and `hookSpecificOutput` to be `{}`.
- **Windows hook stdin piping broken** -- `cmd /c memorix hook` wrapper broke stdin piping for hook event JSON. Changed to `memorix.cmd hook` which directly invokes the CMD shim and properly forwards stdin.
- **CLI emoji removed** -- All emoji in CLI output replaced with plain text markers (`[OK]`, `[FAIL]`, `[WARN]`, `[SKIP]`, `[DRY RUN]`) for enterprise-grade compatibility and to prevent future UTF-8 encoding issues.

## [0.9.25] -- 2026-02-28

### Fixed
- **Windsurf "no tools returned"** -- Transport-first architecture caused Windsurf to query `tools/list` before tools were registered. Normal path now registers tools first, then connects transport. Roots path (invalid cwd) still connects first to query `listRoots`.
- **Windsurf rules not activated** -- Generated `.windsurf/rules/memorix.md` lacked YAML frontmatter (`trigger: always_on`). Windsurf ignored the file without it. Also added `alwaysApply: true` frontmatter for Cursor `.mdc` files.
- **Windsurf hook `post_command` content too short** -- Normalizer didn't extract `commandOutput` from Windsurf `post_command` events, causing content to be <30 chars and filtered out.
- **Hook hot-reload broken on Windows** -- `fs.watch()` lost track of `observations.json` after `atomicWriteFile` (which uses `rename()`). Switched to `fs.watchFile` with 2s polling for reliable cross-platform hot-reload. Hook-written memories are now searchable within ~4 seconds.

## [0.9.18] -- 2026-02-26

### Fixed
- **Self-referential command noise** -- Bash commands that inspect memorix's own data (e.g. `node -e "...observations.json..."`, `cat ~/.memorix/...`) were being stored as observations, creating a feedback loop. Now filtered alongside `memorix_internal` tools.

## [0.9.17] -- 2026-02-26

### Fixed
- **Session activity noise** -- Empty `session_end` events were unconditionally stored, generating ~8.5% of all observations as useless `"Session activity (discovery)"` entries. Now requires content ≥ 50 chars, matching the quality-first philosophy of 0.9.16.

## [0.9.16] -- 2026-02-26

### Architecture
- **Classify -> Policy -> Store pipeline** -- Replaced the monolithic `switch/case` handler (527 lines) with a clean declarative pipeline (432 lines). Inspired by claude-mem's store-first philosophy and mcp-memory-service's configurable scoring.
- **Tool Taxonomy** -- `classifyTool()` categorizes tools into `file_modify | file_read | command | search | memorix_internal | unknown`. Each category has a declarative `StoragePolicy` (store mode, minLength, defaultType).
- **Pattern detection = classification only** -- Pattern detection now only determines observation *type* (decision, error, etc.), not whether to store. Storage decisions are made by policy.
- **Unified `TYPE_EMOJI`** -- Single exported constant, eliminating 3 duplicated copies across handler and session_start.

### Fixed
- **🔴 Critical: Bash commands with `cd` prefix silently dropped** -- Claude Code sends Bash commands as `cd /project && npm test 2>&1`. The noise filter `/^cd\b/` matched the `cd` prefix and silently discarded the entire command. This caused `npm test`, `npm install express`, `node -e "..."`, and all other project-scoped commands to never be stored. Fix: `extractRealCommand()` strips `cd path && ` prefix before noise checking, so `cd /path && npm test` is correctly evaluated as `npm test`.
- **Cooldown key too broad** -- Old key `post_tool:Bash` meant ALL Bash commands shared one 30-second cooldown. New key uses `event:filePath|command|toolName`, so `npm test` and `npm install` have independent cooldowns.
- **Store-first for commands** -- Command-category tools now use `store: 'always'` policy with minLength 30 (down from 50-200), capturing more meaningful development activity.

## [0.9.15] -- 2026-02-26

### Fixed
- **Feedback visibility** -- Hook auto-stores were silent. Now returns `systemMessage` to the agent after each save, e.g. `🟢 Memorix saved: Updated auth.ts [what-changed]`. Gives Codex-like visibility into what memorix is recording.
- **File-modifying tools always store** -- Write/Edit/MultiEdit tool events were rejected when content lacked pattern keywords (e.g., writing utility functions with no "error"/"fix" keywords). Now file-modifying tools always store if content > 100 chars, classified as `what-changed` by default.
- **PreCompact low-quality spam** -- PreCompact events stored empty/minimal observations with no meaningful content. Now requires `MIN_STORE_LENGTH` (100 chars) to store.
- **Normalizer prompt extraction** -- `normalizeClaude` only extracted `prompt` for `user_prompt` events. Now extracts for all events (PreCompact, etc.), preserving context that would otherwise be lost.

## [0.9.14] -- 2026-02-26

### Fixed
- **🔴 Critical: Hooks never auto-store during development** -- Two root causes:
  1. `extractContent()` had a fatal `parts.length === 0` guard that skipped rich `toolInput` data (file content, edit diffs, commands) whenever `toolResult` was present. Since all agents send short `toolResult` like `"File written successfully"` (28 chars), the content was always < 100 chars and got rejected by `MIN_STORE_LENGTH`.
  2. Bash/shell tool events (npm install, npm test, git commands) also got rejected because their content (~90 chars) fell below the generic `post_tool` threshold of 200 chars, even though commands are inherently meaningful.
- **Fix**: Always extract `toolInput` fields alongside `toolResult`. Bash tools now use a dedicated low-threshold path (50 chars) with noise command filtering, matching the `post_command` logic.

### Added
- **12 Claude Code E2E tests** -- Validates the full hook pipeline (stdin JSON -> normalize -> handleHookEvent -> observation) for Write, Edit, Bash, UserPromptSubmit, SessionStart, Stop, PreCompact, and edge cases (noise filtering, memorix recursion skip, short prompts).

## [0.9.12] -- 2026-02-25

### Fixed
- **Copilot hooks format completely wrong** -- Was reusing Claude Code's `generateClaudeConfig()` (PascalCase events, `command` field). Copilot requires `version: 1`, `bash`/`powershell` fields, `timeoutSec`, and camelCase event names (`sessionStart`, `userPromptSubmitted`, `preToolUse`, `postToolUse`, `sessionEnd`, `errorOccurred`). Now uses dedicated `generateCopilotConfig()`. Source: [GitHub Docs](https://docs.github.com/en/copilot/reference/hooks-configuration).
- **Codex fake hooks.json removed** -- Codex has no hooks system (only `notify` in config.toml for `agent-turn-complete`). Was generating a non-existent `.codex/hooks.json`. Now only installs rules (AGENTS.md). Source: [OpenAI Codex Config Reference](https://developers.openai.com/codex/config-reference/).
- **Kiro hook file extension wrong** -- Was `.hook.md`, should be `.kiro.hook`. Now generates 3 hook files: `memorix-agent-stop.kiro.hook` (session memory), `memorix-prompt-submit.kiro.hook` (context loading), `memorix-file-save.kiro.hook` (file change tracking). Source: [Kiro Docs](https://kiro.dev/docs/hooks/).
- **Kiro only had 1 event** -- Was only `file_saved`. Now covers `agent_stop`, `prompt_submit`, and `file_save` events.

### Added
- **Antigravity/Gemini CLI hook installer** -- New `generateGeminiConfig()` for `.gemini/settings.json`. PascalCase events (`SessionStart`, `AfterTool`, `AfterAgent`, `PreCompress`), timeout in milliseconds (10000ms). Source: [Gemini CLI Docs](https://geminicli.com/docs/hooks/).
- **Copilot normalizer** -- Dedicated `normalizeCopilot()` function with `inferCopilotEvent()` for payload-based event detection (Copilot sends typed payloads without explicit event names).
- **Gemini CLI normalizer** -- Dedicated `normalizeGemini()` function with event mapping for all 11 Gemini CLI events (`BeforeAgent`, `AfterAgent`, `BeforeTool`, `AfterTool`, `PreCompress`, etc.).
- **Gemini CLI event mappings** -- Full EVENT_MAP entries for Gemini CLI PascalCase events -> normalized events.
- **Copilot event mappings** -- EVENT_MAP entries for Copilot-specific camelCase events (`userPromptSubmitted`, `preToolUse`, `postToolUse`, `errorOccurred`).

## [0.9.11] -- 2026-02-25

### Fixed
- **CLI crashes with `Dynamic require of "fs" is not supported`** -- When bundling CJS dependencies (like `gray-matter`) into ESM output via `noExternal`, esbuild's CJS-to-ESM wrapper couldn't resolve Node.js built-in modules. Added `createRequire` banner to provide a real `require` function before esbuild's wrapper runs, fixing `require('fs')` and other built-in module calls.

## [0.9.10] -- 2026-02-25

### Fixed
- **CLI crashes with `ERR_MODULE_NOT_FOUND` on global install** -- `@orama/orama`, `gpt-tokenizer`, `gray-matter` and other dependencies were not bundled into the CLI output. tsup treated `dependencies` as external by default. Added `noExternal` to force-bundle all deps into CLI (275KB -> 2.59MB), making `memorix hook` work reliably when installed globally via `npm install -g`.
- **Cursor agent detection corrected** -- Real Cursor payload confirmed to include `hook_event_name` + `conversation_id` (not just `workspace_roots`). Detection now uses `conversation_id` or `cursor_version` as primary discriminator vs Claude Code (which sends `session_id` without `conversation_id`). `extractEventName` reads `hook_event_name` first, falls back to payload inference.

## [0.9.9] -- 2026-02-25

### Fixed
- **Cursor hooks config format invalid** -- Generated config was missing required `version` field and used objects instead of arrays for hook scripts. Cursor requires `{ version: 1, hooks: { eventName: [{ command: "..." }] } }` format. Added `sessionStart`, `beforeShellExecution`, `afterMCPExecution`, `preCompact` events.
- **Cursor agent detection failed** -- Cursor does NOT send `hook_event_name` like Claude Code. Detection now uses Cursor-specific fields (`workspace_roots`, `is_background_agent`, `composer_mode`). Event type inferred from payload structure (e.g., `old_content`/`new_content` -> `afterFileEdit`).
- **Cursor `session_id` field not read** -- Normalizer expected `conversation_id` but Cursor sends `session_id`. Now reads both with fallback.

## [0.9.8] -- 2026-02-25

### Fixed
- **Claude Code hooks installed to wrong file** -- Hooks were written to `.github/hooks/memorix.json` but Claude Code reads from `.claude/settings.local.json` (project-level) or `~/.claude/settings.json` (global). Now correctly writes to `.claude/settings.local.json` for project-level installation.
- **Hooks merge overwrites existing settings** -- Shallow spread `{...existing, ...generated}` would overwrite the entire `hooks` key, destroying user's other hook configurations. Now deep-merges the `hooks` object so existing hooks from other tools are preserved.

## [0.9.7] -- 2026-02-25

### Fixed
- **Claude Code hooks never triggering auto-memory** -- Claude Code sends `hook_event_name` (snake_case) but the normalizer expected `hookEventName` (camelCase). This caused **every event** (SessionStart, UserPromptSubmit, PostToolUse, PreCompact, Stop) to be misidentified as `post_tool`, breaking event routing, prompt extraction, memory injection, and session tracking. Also fixed `session_id` -> `sessionId` and `tool_response` -> `toolResult` field mappings.
- **Empty content extraction from Claude Code tool events** -- `extractContent()` now unpacks `toolInput` fields (Bash commands, Write file content, etc.) when no other content is available. Previously tool events produced empty or near-empty content strings.
- **User prompts silently dropped** -- `MIN_STORE_LENGTH=100` was too high for typical user prompts. Added `MIN_PROMPT_LENGTH=20` specifically for `user_prompt` events.
- **Post-tool events too aggressively filtered** -- Tool events with substantial content (>200 chars) are now stored even without keyword pattern matches.

## [0.9.6] -- 2026-02-25

### Fixed
- **Cross-IDE project identity fragmentation** -- Data was stored in per-project subdirectories (`~/.memorix/data/<projectId>/`), but different IDEs often detected different projectIds for the same repo (e.g. `placeholder/repo` vs `local/repo` vs `local/Kiro`). This caused observations to silently split across directories, making cross-IDE relay unreliable. Now **all data is stored in a single flat directory** (`~/.memorix/data/`). projectId is metadata only, not used for directory partitioning. Existing per-project subdirectories are automatically merged on first startup (IDs remapped, graphs deduplicated, subdirs backed up to `.migrated-subdirs/`).
- **`scope: 'project'` parameter now works** -- Previously accepted but ignored. Now properly filters search results by the current project's ID via Orama where-clause.

## [0.9.5] -- 2026-02-25

### Fixed
- **Claude Code hooks `matcher` format** -- `matcher` must be a **string** (tool name pattern like `"Bash"`, `"Edit|Write"`), not an object. For hooks that should fire on ALL events, `matcher` is now omitted entirely instead of using `{}`. Fixes `matcher: Expected string, but received object` validation error on Claude Code startup.

## [0.9.4] -- 2026-02-25

### Fixed
- **Codex/all-IDE `tools/list -> Method not found`** -- Critical bug where `local/<dirname>` projects (any directory without a git remote) wrongly entered the MCP roots resolution flow. This flow connects the server *before* registering tools, so the MCP `initialize` handshake declared no `tools` capability, causing all subsequent `tools/list` calls to fail with "Method not found". Now only truly invalid projects (home dir, system dirs) enter the roots flow; `local/` projects go through the normal path (register tools first, then connect).

## [0.9.3] -- 2026-02-25

### Fixed
- **`memorix_timeline` "not found" bug** -- Timeline was using unreliable Orama empty-term search. Now uses in-memory observations (same fix pattern as `memorix_detail`).
- **`memorix_retention` "no observations found" bug** -- Same root cause as timeline. Now uses in-memory observations for reliable document retrieval.
- **`memorix_search` cross-IDE projectId mismatch** -- Removed redundant projectId filter from search. Data isolation is already handled at the directory level. Different IDEs resolving different projectIds for the same directory no longer causes empty search results.
- **Claude Code hooks format** -- Updated `generateClaudeConfig` to use the new `{matcher: {}, hooks: [...]}` structure required by Claude Code 2025+. Fixes "Expected array, but received undefined" error on `memorix hooks install --agent claude --global`.
- **EPERM `process.cwd()` crash** -- All CLI commands (`serve`, `hooks install/uninstall/status`) now safely handle `process.cwd()` failures (e.g., deleted CWD on macOS) with fallback to home directory.

## [0.9.2] -- 2026-02-25

### Fixed
- **Empty directory support** -- Memorix now starts successfully in any directory, even without `.git` or `package.json`. No more `__invalid__` project errors for brand new folders. Only truly dangerous directories (home dir, drive root, system dirs) are rejected.
- **`findPackageRoot` safety** -- Walking up from temp/nested directories no longer accidentally selects the home directory as project root.

### Changed
- **README rewrite** -- Complete rewrite of Quick Start section for both EN and 中文 READMEs:
  - Two-step install (global install + MCP config) instead of error-prone `npx`
  - Per-agent config examples (Claude Code, Cursor, Windsurf, etc.)
  - Troubleshooting table for common errors
  - AI-friendly: agents reading the README will now configure correctly on first try

## [0.9.1] -- 2026-02-25

### Fixed
- **Defensive parameter coercion** -- All 24 MCP tools now gracefully handle string-encoded arrays and numbers (e.g., `"[16]"` -> `[16]`, `"20"` -> `20`). Fixes compatibility with Claude Code CLI's known serialization bug ([#5504](https://github.com/anthropics/claude-code/issues/5504), [#26027](https://github.com/anthropics/claude-code/issues/26027)) and non-Anthropic models (GLM, etc.) that may produce incorrectly typed tool call arguments. Codex, Windsurf, and Cursor were already unaffected.

## [0.9.0] -- 2026-02-24

### Added
- **Memory Consolidation** (`memorix_consolidate`) -- Find and merge similar observations to reduce memory bloat. Uses Jaccard text similarity to cluster observations by entity+type, then merges them preserving all facts, files, and concepts. Supports `preview` (dry run) and `execute` modes with configurable similarity threshold.
- **Temporal Queries** -- `memorix_search` now supports `since` and `until` parameters for date range filtering. Example: "What auth decisions did we make last week?"
- **Explainable Recall** -- Search results now include a `Matched` column showing which fields matched the query (title, entity, concept, narrative, fact, file, or fuzzy). Helps understand why each result was found.
- **Export/Import** -- Two new tools for team collaboration:
  - `memorix_export` -- Export project observations and sessions as JSON (importable) or Markdown (human-readable for PRs/docs)
  - `memorix_import` -- Import from JSON export, re-assigns IDs, skips duplicate topicKeys
- **Dashboard Sessions Panel** -- New "Sessions" tab in the web dashboard with timeline view, active/completed counts, agent info, and session summaries. Bilingual (EN/中文).
- **Auto sessionId** -- `memorix_store` now automatically associates the current active session's ID with stored observations.
- **16 new tests** -- 8 consolidation + 8 export/import (484 total).

### Stats
- **MCP Tools:** 20 -> 24 (memorix_consolidate, memorix_export, memorix_import + dashboard sessions API)
- **Tests:** 484/484 passing

## [0.8.0] -- 2026-02-24

### Added
- **Session Lifecycle Management** -- 3 new MCP tools for cross-session context continuity:
  - `memorix_session_start` -- Start a coding session, auto-inject context from previous sessions (summaries + key observations). Previous active sessions are auto-closed.
  - `memorix_session_end` -- End a session with structured summary (Goal/Discoveries/Accomplished/Files format). Summary is injected into the next session.
  - `memorix_session_context` -- Manually retrieve session history and context (useful after compaction recovery).
- **Topic Key Upsert** -- `memorix_store` now accepts an optional `topicKey` parameter. When an observation with the same `topicKey + projectId` already exists, it is **updated in-place** instead of creating a duplicate. `revisionCount` increments on each upsert. Prevents data bloat for evolving decisions, architecture docs, etc.
- **`memorix_suggest_topic_key` tool** -- Suggests stable topic keys from type + title using family heuristics (`architecture/*`, `bug/*`, `decision/*`, `config/*`, `discovery/*`, `pattern/*`). Supports CJK characters.
- **Session persistence** -- `sessions.json` with atomic writes and file locking for cross-process safety.
- **Observation fields** -- `topicKey`, `revisionCount`, `updatedAt`, `sessionId` added to `Observation` interface.
- **30 new tests** -- 16 session lifecycle tests + 14 topic key upsert tests (468 total).

### Improved
- **`storeObservation` API** -- Now returns `{ observation, upserted }` instead of just `Observation`, enabling callers to distinguish new vs updated observations.

### Inspired by
- [Engram](https://github.com/alanbuscaglia/engram) -- Session lifecycle design, topic_key upsert pattern, structured session summaries.

## [0.7.11] -- 2026-02-24

### Added
- **File locking & atomic writes** (`withFileLock`, `atomicWriteFile`) -- Cross-process safe writes for `observations.json`, `graph.jsonl`, and `counter.json`. Uses `.memorix.lock` directory lock with stale detection (10s timeout) and write-to-temp-then-rename for crash safety.
- **Retention auto-archive** -- `memorix_retention` tool now supports `action="archive"` to move expired observations to `observations.archived.json`. Reversible -- archived memories can be restored manually.
- **Chinese entity extraction** -- Entity extractor now recognizes Chinese identifiers in brackets (`「认证模块」`, `【数据库连接】`) and backticks, plus Chinese causal language patterns (因为/所以/由于/导致/决定/采用).
- **Graph-memory bidirectional sync** -- Dashboard DELETE now cleans up corresponding `[#id]` references from knowledge graph entities. Prevents orphaned data.

### Improved
- **Search accuracy** -- Added fuzzy tolerance, field boosting (title > entityName > concepts > narrative), lowered similarity threshold to 0.5, tuned hybrid weights (text 0.6, vector 0.4).
- **Auto-relations performance** -- Entity lookups now use O(1) index (`Map`) instead of O(n) `find()` on every observation store. `KnowledgeGraphManager` maintains a `entityIndex` rebuilt on create/delete mutations.
- **Re-read-before-write** -- `storeObservation` re-reads `observations.json` inside the lock before writing, merging concurrent changes instead of overwriting.

## [0.7.10] -- 2026-02-24

### Added
- **Chinese README** (`README.zh-CN.md`) -- Full bilingual documentation with language switcher at the top of both README files.
- **Antigravity config guide** -- Collapsible note in README Quick Start and updated `docs/SETUP.md` Antigravity section explaining the `MEMORIX_PROJECT_ROOT` requirement, why it's needed (cwd + MCP roots both unavailable), and how to configure it.
- **Project detection priority documentation** -- Clear detection chain (`--cwd` -> `MEMORIX_PROJECT_ROOT` -> `INIT_CWD` -> `process.cwd()` -> MCP roots -> error) in README, SETUP.md, and troubleshooting section.

## [0.7.9] -- 2026-02-24

### Fixed
- **Dashboard auto-switch when project changes** -- When the dashboard is already running (started from project A) and `memorix_dashboard` is called from project B, the dashboard server's current project is now updated via a `/api/set-current-project` POST request before opening the browser. Previously, the dashboard always showed the project it was initially started with; now it correctly switches to the calling project. Existing browser tabs will also show the correct project on the next page load/refresh.

### Added
- **MCP roots protocol support** -- When the IDE's `cwd` is not a valid project (e.g., Antigravity sets cwd to `G:\Antigravity`), Memorix now automatically tries the MCP `roots/list` protocol to get the IDE's actual workspace path. This means standard MCP configs (`npx memorix@latest serve`) can work without `--cwd` in IDEs that support MCP roots. Falls back gracefully if the client doesn't support roots. Priority chain: `--cwd` > `MEMORIX_PROJECT_ROOT` > `INIT_CWD` > `process.cwd()` > **MCP roots** > error.

## [0.7.8] -- 2026-02-24

### Fixed
- **Graceful error on invalid project detection** -- When `detectProject()` returns `__invalid__` (e.g., IDE sets cwd to its own install directory like `G:\Antigravity`), the server now prints a clear, actionable error message with fix instructions (`--cwd` or `MEMORIX_PROJECT_ROOT`) instead of crashing with an opaque stack trace.
- **Dashboard process liveness check** -- `memorix_dashboard` now verifies the port is actually listening before returning "already running". If the dashboard process was killed externally (e.g., `taskkill`), it automatically restarts instead of opening a browser to a dead server.

### Added
- **`MEMORIX_PROJECT_ROOT` environment variable** -- New way to specify the project directory for IDEs that don't set `cwd` to the project path (e.g., Antigravity uses `G:\Antigravity` as cwd). Priority: `--cwd` > `MEMORIX_PROJECT_ROOT` > `INIT_CWD` > `process.cwd()`. Example MCP config: `"env": { "MEMORIX_PROJECT_ROOT": "e:/your/project" }`.

## [0.7.7] -- 2026-02-24

### Fixed
- **Wrong project detection in Antigravity/global MCP configs** -- Removed dangerous `scriptDir` fallback in `serve.ts` that caused the MCP server to detect the memorix development repo (or other wrong projects) instead of the user's actual project. When `process.cwd()` was not a git repo, the old code fell back to the memorix script's own directory, which could resolve to a completely unrelated project. Now relies solely on `detectProject()` which has proper fallback logic.
- **Dashboard always showing wrong project** -- When re-opening the dashboard (already running on port 3210), it now passes the current project as a `?project=` URL parameter. The frontend reads this parameter and auto-selects the correct project in the switcher, so opening dashboard from different IDEs/projects shows the right data.

## [0.7.6] -- 2026-02-24

### Added
- **`llms.txt` + `llms-full.txt`** -- Machine-readable project documentation for AI crawlers (2026 llms.txt standard). Helps Gemini, GPT, Claude, and other AI systems discover and understand Memorix automatically.
- **FAQ semantic anchors in README** -- 7 Q&A entries matching common AI search queries ("How do I keep context when switching IDEs?", "Is there an MCP server for persistent AI coding memory?", etc.)

### Changed
- **GitHub repo description** -- Shortened to ~150 chars for optimal og:title/og:description generation
- **GitHub topics** -- 20 GEO-optimized tags including `cursor-mcp`, `windsurf-mcp`, `claude-code-memory`, `cross-ide-sync`, `context-persistence`, `agent-memory`
- **package.json keywords** -- Replaced generic tags with IDE-specific MCP entity-linking keywords
- **package.json description** -- Shortened to under 160 chars for better meta tag generation
- **MCP tool descriptions** -- Enhanced `memorix_store`, `memorix_search`, `memorix_workspace_sync`, `memorix_skills` with cross-IDE context so AI search engines understand what problems they solve

## [0.7.5] -- 2026-02-22

### Changed
- **README rewrite** -- Completely restructured to focus on real-world scenarios, use cases, and features. Added 5 walkthrough scenarios, comparison table with alternatives, "Works with" badges for all 7 agents. Moved detailed config to sub-README.
- **New `docs/SETUP.md`** -- Dedicated setup guide with agent-specific config, vector search setup, data storage, and troubleshooting

## [0.7.4] -- 2026-02-22

### Fixed
- **Hyphenated concepts not searchable** -- Concepts like `project-detection` and `bug-fix` are now normalized to `project detection` and `bug fix` in the search index so Orama's tokenizer can split them into individual searchable terms. Original observation data is preserved unchanged.

## [0.7.3] -- 2026-02-22

### Fixed
- **Windows: git remote detection fails due to "dubious ownership"** -- Added `safe.directory=*` flag to all git commands so MCP subprocess can read git info regardless of directory ownership settings. If git CLI still fails, falls back to directly parsing `.git/config` file. This fixes projects incorrectly getting `local/<dirname>` instead of `owner/repo` as their project ID.

## [0.7.2] -- 2026-02-22

### Fixed
- **`memorix_workspace_sync` rejects `kiro` as target** -- Added `kiro` to `AGENT_TARGETS` enum (adapter was already implemented but missing from the tool's input schema)
- **`memorix_rules_sync` missing `kiro` target** -- Added `kiro` to `RULE_SOURCES` enum so Kiro steering rules can be generated as a sync target
- **VS Code Copilot README config** -- Separated `.vscode/mcp.json` (workspace) and `settings.json` (global) formats which have different JSON structures

## [0.7.1] -- 2026-02-22

### Fixed
- **Dashboard checkbox checkmark not visible** -- Added `position: relative/absolute` to `.obs-checkbox::after` so the ✓ renders correctly in batch select mode
- **Embedding provider status flickers to "fulltext only"** -- Replaced `initialized` boolean flag with a shared Promise lock; concurrent callers now wait for the same initialization instead of seeing `provider = null` mid-load
- **`memorix_dashboard` MCP tool reliability** -- Replaced fixed 800ms wait with TCP port polling (up to 5s) so the tool only returns after the HTTP server is actually listening
- **Dashboard embedding status always shows "fulltext only"** -- Fixed root cause: dashboard is an independent process, `isEmbeddingEnabled()` from orama-store always returns false there; now uses `provider !== null` directly

## [0.7.0] -- 2026-02-21

### Added
- **Memory-Driven Skills Engine** (`memorix_skills` MCP tool):
  - `list` -- Discover all `SKILL.md` files across 7 agent directories
  - `generate` -- Auto-generate project-specific skills from observation patterns (gotchas, decisions, how-it-works)
  - `inject` -- Return full skill content directly to agent context
  - Intelligent scoring: requires skill-worthy observation types, not just volume
  - Write to any target agent with `write: true, target: "<agent>"`
- **Transformers.js Embedding Provider**:
  - Pure JavaScript fallback (`@huggingface/transformers`) -- no native deps required
  - Provider chain: `fastembed` -> `transformers.js` -> fulltext-only
  - Quantized model (`q8`) for small footprint
- **Dashboard Enhancements**:
  - Canvas donut chart for observation type distribution
  - Embedding provider status card (enabled/provider/dimensions)
  - Search result highlighting with `<mark>` tags
- **17 new tests** for Skills Engine (list, generate, inject, write, scoring, dedup)

### Changed
- Scoring algorithm requires at least 1 skill-worthy type (gotcha/decision/how-it-works/problem-solution/trade-off) -- pure discovery/what-changed entities won't generate skills
- Volume bonus reduced from 2xobs to 1xobs (capped at 5) to favor quality over quantity
- Type diversity bonus increased from 2 to 3 points per unique skill-worthy type

### Fixed
- 422 tests passing (up from 405), 34 test files, zero regressions

## [0.5.0] -- 2026-02-15

### Added
- **Antigravity Adapter**: Full support for Antigravity/Gemini IDE (MCP config + rules)
- **Copilot Adapter**: VS Code Copilot MCP config adapter + rules format adapter
- **Comprehensive Documentation**: 7 developer docs in `docs/` (Architecture, Modules, API Reference, Design Decisions, Development Guide, Known Issues & Roadmap, AI Context)
- **8 new npm keywords**: antigravity, mcp-tool, memory-layer, ai-memory, progressive-disclosure, orama, vector-search, bm25
- `prepublishOnly` now runs `npm test` in addition to build

### Changed
- README completely rewritten with clearer structure, npx zero-install setup, 6 agent configs, comparison table, Progressive Disclosure example, and architecture diagram
- `description` field expanded for better npm search ranking
- `files` array cleaned up (removed unused `examples` directory)

### Fixed
- 274 tests passing (up from 219), zero regressions

## [0.1.0] -- 2026-02-14

### Core
- Knowledge Graph: Entity-Relation-Observation model (MCP Official compatible)
- 3-Layer Progressive Disclosure: compact search -> timeline -> detail
- 9 observation types with icon classification
- Full-text search via Orama (BM25)
- Per-project isolation via Git remote detection
- 14 MCP tools (9 official + 5 Memorix extensions)

### Cross-Agent Sync
- Rules Parser: 4 format adapters (Cursor, Claude Code, Codex, Windsurf)
- Rules Syncer: scan -> deduplicate -> conflict detection -> cross-format generation
- Workspace Sync: MCP config migration + workflow sync + apply with backup/rollback

### Intelligence (Competitor-Inspired)
- Access tracking: accessCount + lastAccessedAt (from mcp-memory-service)
- Token budget: maxTokens search trimming (from MemCP)
- Memory decay: exponential decay + retention lifecycle + immunity (from mcp-memory-service + MemCP)
- Entity extraction: regex-based file/module/URL/CamelCase extraction (from MemCP)
- Auto-enrichment: memorix_store auto-extracts and enriches concepts/files
- Causal detection: "because/due to/caused by" pattern detection
- Auto-relations: implicit Knowledge Graph relation creation (causes/fixes/modifies)
- Retention status: memorix_retention MCP tool

### Vector Search
- Embedding provider abstraction layer (extensible)
- fastembed integration (optional, local ONNX, 384-dim bge-small)
- Orama hybrid search mode (BM25 + vector)
- Graceful degradation: no fastembed -> fulltext only
- Embedding cache (5000 entries LRU)

### Agent Instructions
- CLAUDE.md: Claude Code usage instructions + lifecycle hooks
- Example configs for Cursor, Windsurf, Codex
