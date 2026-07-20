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
