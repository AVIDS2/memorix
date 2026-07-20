# Agent Memory Research Program

Date: 2026-07-20
Branch: codex/memorix-agent-memory-research
Baseline: memorix 1.2.1 at 1b5bf7f

## Goal

Build a submission-ready, reproducible study of freshness-aware multi-session
project memory for coding agents, including MemorixBench-Transfer, fair memory
baselines, ablations, cross-model and cross-project evaluation, statistical
analysis, an open artifact, and an English LaTeX paper.

## Evidence at start

- The existing Workset harness provides deterministic TypeScript, Python, Go,
  docs-only, dirty-worktree, deleted-symbol, and incomplete-scan fixtures.
- It measures required files, evidence, cautions, and token ceilings. It does
  not yet measure whether an agent produces a correct patch.
- Memorix 1.2.1 exposes code-state snapshots and current/suspect/stale code
  bindings, which is the method component to isolate experimentally.
- A real context smoke in the research worktree bound to the correct 1.2.1
  checkout, but surfaced unrelated historical memories and automatically
  captured research-agent prompts. This is evidence of contamination risk and
  requires isolated data directories plus a dedicated noise analysis.

## Current work

- Drafted preregistration and a claim-evidence ledger.
- Added a versioned case-manifest schema and validator.
- Added paired binary comparison tooling with exact McNemar and deterministic
  paired bootstrap confidence intervals.
- Added an executable TypeScript ownership-transfer case, isolated workspace
  materialization, Claude/Codex runners, run manifests, grading, and a real
  Memorix MCP control-plane adapter. The Python research suite currently has
  16 passing tests.
- A blind Claude pilot completed the transfer task both without memory and
  with the last precursor transcript. This is exploratory only: one case and
  one run cannot support an efficacy claim. The no-memory result needs an
  auditable reclassification because Claude emitted its completed answer just
  before the configured budget boundary.
- A Codex pilot was correctly classified as invalid infrastructure evidence:
  the independent CLI inherited a desktop-managed placeholder credential and
  received HTTP 401. It must not be counted as task failure.

## First real Memorix MCP smoke

- Artifact: `F:\memorix-research-artifacts\adapter-smoke-1784525517`.
- The adapter started the built Memorix 1.2.1 control plane against an isolated
  data directory, initialized an HTTP MCP session, stored a durable token
  policy and the then-current validator location, waited for maintenance,
  applied the between-session code transition, refreshed Code Memory, and
  waited again.
- All 7 precursor and 12 total maintenance jobs completed with zero failures.
  The Claim Ledger correctly requalified the deleted `src/auth.js` ownership
  claim from active to unknown.
- The final task Workset nevertheless contained neither the durable policy nor
  the stale ownership caution. The durable claim remained `needs-review`, and
  task selection matches only exact tokens from subject/predicate/title, not
  the observation narrative or facts. `token-validation`/`tokens` therefore
  did not match the claim's standalone `token` wording. The code-bound
  observation also had no surviving observation ref after deletion.
- This is a concrete baseline limitation, not a failed queue: lifecycle health
  and downstream context usefulness are currently different properties. Keep
  the unmodified 1.2.1 artifact as the baseline and evaluate any retrieval or
  claim-content fix as a separate proposed condition.

## Next

- Make memory-provider configuration explicit so isolated runs cannot
  accidentally inherit local LLM or embedding credentials.
- Add the `memorix-1.2.1` and proposed freshness-aware conditions to the trial
  runner, plus auditable result reclassification.
- Expand development cases before any confirmatory run.

## Canonical Mem0 baseline and controlled-agent hardening

- Added an executable `mem0-2.0.12-local` canonical-retrieval condition. It
  uses a pinned external Mem0 runtime, local Qdrant, FastEmbed
  `BAAI/bge-small-en-v1.5`, `infer=False`, a unique scoped project id, and no
  inherited LLM/embedding credentials. The adapter preflight writes, reopens,
  retrieves, and checks a foreign empty scope before an agent run.
- Canonical seed text, query, ranked-result count, and a 180-token offline
  lexical context ceiling are explicit in `research/BASELINE_PROTOCOL.md`.
  Native product behavior stays a separate track; AgentMemory is not yet an
  executable comparison row.
- The first end-to-end Mem0 attempts exposed two Windows path-length failures:
  FastEmbed cache and then Qdrant collection paths were too deeply nested under
  artifacts. The fixed layout keeps per-run writable data under the short
  F-drive `runtime-data` root and uses an already-pinned F-drive model cache in
  offline mode. Both failures are preserved as infrastructure diagnostics.
- Claude's initial narrow Bash allowlist accidentally denied Go's `./...`
  package glob through `Bash(*..*)`, then denied ordinary workspace `grep` and
  `dir` actions. The harness now permits normal commands in a disposable
  checkout, pre-denies network/install/remote-Git/dynamic-interpreter actions,
  and archives/audits every Bash command for parent traversal or external path
  access. Any denial or audit violation invalidates the run.
- A controlled direct permission smoke ran exactly `go test ./...` in 11.3
  seconds without a denial. The first valid paired external development smoke
  used the same seed for Mem0 and no-memory. Both passed hidden tests; Mem0 was
  49.7 seconds/USD 0.108 and no-memory was 104.1 seconds/USD 0.232. This is a
  single easy development pair and is explicitly non-confirmatory.
- Current Claude telemetry for those runs reported DeepSeek V4 Pro message
  events plus Claude Haiku/Opus billing records, despite the configured client
  route. All are therefore recorded as mixed rather than pure DeepSeek Flash.

## AgentMemory full-service baseline

- Implemented `agentmemory-0.9.28-full-local` against the installed official
  runtime and its pinned `iii:0.11.2` Docker path. Every run receives a unique
  Compose project/volume and an isolated home; provider credentials are
  scrubbed, automatic LLM compression and hook injection are disabled, and
  canonical records use `/remember` plus project-scoped `/search`.
- Initial full-service probes exposed two real lifecycle details: iii writes
  the API-visible memory before the file-backed Docker store has flushed, and
  Docker `down` can return before its exposed ports are reusable on Windows.
  A measured 12-second persistence settle gate and a bind-based wait for all
  official iii ports now precede the restart check.
- The full preflight now proves initial write/read, zero foreign-project
  results, service restart, and recovered marker. The current external Go
  smoke then retrieves two records under the same 150-token canonical ceiling,
  completes the hidden repair, and passes command contamination audit. Its
  first timing field undercounted initial service startup and is archived as a
  diagnostic; the corrected follow-up records 25.7s preparation, 0.078s
  retrieval, and 68.6s agent wall time. Neither is comparative evidence.
- Claude may attempt tools excluded by the controlled surface (for example,
  `Grep`). The parser now records unavailable-tool attempts separately from
  permission denials and path contamination; no unavailable tool is treated as
  successful evidence access.

## Development-pilot exclusions and case hardening

- A controlled Python micro-Memorix pilot on the first wording of
  `python-cache-ttl-ownership` is an excluded development diagnostic. The task
  said short TTLs were "accepted again", which the agent reasonably read as the
  intended new policy rather than a regression. It added tests accepting
  `1/30/59` instead of repairing the lower bound. The manifest has been
  reworded to say explicitly that a regression accepts values below the
  existing minimum. The previous manifest SHA and run remain archived but must
  not appear in any comparison.
- The same ambiguity was removed from the TypeScript and Go transfer prompts
  before their first agent runs.
- The trial correctly exercised Memorix (`project_context`, `search`, and
  `detail`) without path leakage. It also exposed a product limitation worth
  measuring separately: the Workset omitted the durable bound under its small
  budget, the agent retrieved the policy in search results but did not open its
  detail, and it then treated the stale implementation change as authoritative.
- Claude's final provider usage listed both `deepseek-v4-flash` and a small
  `claude-haiku-4-5` component. Future runs must archive per-model usage and
  must not be labelled as a pure single-model DeepSeek condition unless the
  provider reports only that model.

## Cross-language development smoke

- The three executable development cases now require non-obvious durable rules:
  Python cache TTLs use a 75-second lower bound and 15-second cadence; Go retry
  delays use a 375ms lower bound and 125ms cadence; TypeScript access tokens
  require `tok_`, at least 18 characters, and an ASCII digit shard marker.
- Each case has passed all four authoring gates: precursor tests pass, transfer
  public tests pass, hidden tests fail on the unmodified transfer snapshot, and
  a maintainer-only reference patch passes the hidden tests.
- Current isolated Micro-Memorix/Claude development smokes passed hidden tests
  for Python, Go, and TypeScript. Every successful run used
  `project_context`, `search`, and `detail`; it repaired the current owner
  without restoring the deleted predecessor file.
- Claude Code's configured route reports a small `claude-haiku-4-5` helper use
  alongside `deepseek-v4-flash`. Trial records now store per-model token/cost
  usage and a mixed-model profile. User configuration was not modified.
- Fixed-budget exhaustion and timeout are now classified as valid task failures
  rather than exclusions. Authentication, provider quota, MCP startup, runtime,
  and missing-event failures remain infrastructure exclusions. Earlier raw
  no-memory runs are retained as diagnostics and are not aggregated.

## External-repository case authoring

- AgentMemory source audit confirmed a documented REST surface (`remember` and
  `smart-search`) and a standalone MCP proxy, but the full service depends on a
  pinned iii engine and its README identifies native Windows as a manual setup
  path. A fair baseline must therefore preflight and archive engine/store
  availability rather than treat a failed install as a task failure.
- Added `go-backoff-zero-jitter-ownership`, pinned to the MIT-licensed
  `cenkalti/backoff` v5 revision `3d3869e86accb1d31bcb9cb954435afa128bd986`.
  Its durable policy is historically grounded in upstream commit `6b0e4ad`,
  while its later helper-extraction regression is deliberately benchmark
  authored and marked as such in `PROVENANCE.md`.
- The first older v4 cut was rejected because current Go rejects its stale
  example name before any behavioral test runs. The selected v5 cut passes
  unmodified `go test ./...` under the current toolchain.
- All four authoring gates passed for the v5 case: precursor, transfer public,
  hidden failure on unmodified transfer, and reference-patch recovery. No model
  trial has used this case yet.

## Oracle review and Python external case

- An independent benchmark review blocked the first version of the Python
  `itsdangerous` case before it entered the development corpus: its hidden test
  could have accepted a blanket rejection of `max_age=0`, the task wording
  revealed the answer, and its “do not restore the old owner” rule was only
  prose.
- The revised case now asks only for restoration of the established policy,
  checks both zero-age acceptance at the current timestamp and rejection of a
  future timestamp, and uses a hidden Python AST assertion to require that
  `TimestampSigner.unsign` delegates age validation rather than inlining
  `SignatureExpired` again.
- The harness now evaluates literal source checks before hidden-test mounting,
  archives both source hashes and check phase, and treats a failed check as a
  task failure. Literal checks are only a lightweight guard; the Python case's
  ownership rule is enforced by the hidden AST oracle.
- A second independent code review found that the original source-check order
  could have let a hidden patch alter checked source. The runner now checks the
  agent-authored tree first, and a regression test proves a hidden source patch
  cannot repair that result. The same review identified that development
  oracles are not a private test set; trial artifacts are now explicitly marked
  `development`, comparison rejects them by default, and non-development
  execution is blocked pending a private overlay plus per-client read-isolation
  preflight.
- Fresh pinned-repository gates passed: precursor public suite 101/101,
  transfer public suite 101/101, unmodified transfer hidden oracle 103 pass +
  1 expected failure, and reference repair 104/104 with the hidden AST oracle
  passing. It had no agent result at admission time.
- A later isolated no-memory Claude diagnostic passed the same hidden suite,
  confirming that this transfer state is low predecessor-dependency for the
  current strong client. It remains a development admission and ownership
  check, not a Memorix comparison row or primary-effect candidate.

## Reproducible case-authoring gate

- Added `memorixbench verify-case`, which materializes four fresh workspaces
  and records the complete admission sequence: precursor public success,
  transfer public success, hidden-regression failure, and reference-repair
  success. It preserves the workspaces rather than deleting evidence.
- Its first end-to-end run used the external `itsdangerous` case and reproduced
  all four gates from a fresh upstream clone. This caught and then prevented a
  malformed hidden-patch hunk during authoring; patch application is now part
  of the automatic admission path rather than an informal manual check.
- A subsequent GitHub SSL failure was classified as infrastructure rather than
  case behavior. The materializer now supports a pinned local Git cache only
  with a full immutable commit and recorded origin metadata; an offline
  `itsdangerous` run reproduced all four gates through that cache.
- A governance review corrected the initial dependency labels: they are
  retrospective development classifications, not preregistration. The next
  confirmatory corpus must carry a frozen `preregistered` classification before
  any model call. New trial artifacts also snapshot the full case definition,
  instead of relying on a manifest hash alone.

## Candidate triage

- Audited a JavaScript `p-limit` runtime-concurrency candidate with real
  upstream policy history. It is deferred rather than admitted: the pinned
  snapshot lacks a reproducible lockfile, and current full tests suffer from
  dependency drift. Its exact provenance, policy commits, and admission
  blockers live in `research/CASE-CANDIDATES.md`.
