# Memorix Active Work

> This is the single living work-status document for this repository. Read it
> before resuming substantial work, update it after a material decision or
> milestone, and do not create parallel progress logs.

**Last updated:** 2026-08-28

## Current Product State

- `1.8.4` is the current published release. It includes the MCP stdio startup
  gate, early `server/discover` handling, bounded project context, evidence
  cards, feedback state, and the current profile system.
- The local 1.8.5 cleanup candidate is complete on
  `codex/1.8.5-module-cleanup` (`b94abdc`). It removes the obsolete Dashboard
  graph renderer and root dependencies, makes the remaining capabilities
  visible, and hardens narrow-screen behavior without changing the published
  version.
- SDK, CLI, hooks, and HTTP MCP share SQLite as the canonical flat data store.
  Large-store startup hydration uses bounded Orama batches so health remains
  responsive without rebalancing the index once per row.
- MCP profiles are currently `micro=9`, `lite=20`, `team=28`, and `full=47`.
  Setup installs `lite`; advanced and compatibility tools remain opt-in so the
  default agent context stays small.
- Open contributor PRs #212 (HTTP rerank) and #204 (WorkBuddy) remain separate
  feature work. They are not part of this patch release.
- Candidate verification is green: `npm test` passed 2997 tests in 309 files,
  `npm run lint`, `npm run build`, stdio MCP smoke, MCP Registry metadata, and
  plugin release metadata checks all passed. Two live embedding files remain
  intentionally skipped when their environment flag is absent.

## Ecosystem Watch (2026-08-28)

Recent public changes reinforce the current product boundary:

- The [MCP 2026-07-28 specification](https://modelcontextprotocol.io/specification/2026-07-28)
  makes requests self-describing and stateless-first, adds `server/discover`,
  and moves long-running work into the official `io.modelcontextprotocol/tasks`
  extension described in the [MCP changelog](https://modelcontextprotocol.io/specification/2026-07-28/changelog).
  Memorix should keep legacy compatibility while migrating deliberately to the
  official SDK v2; it should not claim full modern conformance prematurely.
- [TencentDB Agent Memory 2.0.1](https://github.com/TencentCloud/TencentDB-Agent-Memory/releases/tag/v2.0.1)
  emphasizes cold-start readiness, governed assets, cross-agent loading, and
  faster Wiki/CodeGraph processing. The useful lesson for Memorix is to expose
  asset readiness and provenance clearly, while keeping local project evidence
  authoritative instead of turning Memorix into a remote proxy hub.
- [ContextBench](https://arxiv.org/abs/2602.05892) evaluates coding-agent
  context recall, precision, and efficiency during issue resolution, and reports
  that complex scaffolding does not automatically improve context use. This
  supports Memorix's bounded Workset and single-entry Autopilot approach.
- [MemoryArena](https://memoryarena.github.io/) evaluates interdependent tasks
  across sessions, while [MemSyco-Bench](https://arxiv.org/abs/2607.01071)
  tests whether retrieved memory causes unjustified agreement, scope mistakes,
  or failure to reject stale facts. These are direct signals to keep continuity,
  evidence, feedback, conflict handling, and abstention separate.

The next meaningful product work is therefore not “more memory fields”. It is
making the existing lifecycle observable and trustworthy: the agent should know
what is available, why a memory was selected, when it is stale, and when it is
safer to abstain.

## Current Mainline Scope (2026-08-29)

This is one closeout line, not a promise to move unfinished work into a later
version. The implementation and release number will be decided after the full
scope passes; no partial publication is the success criterion.

### P0 — Reconcile the candidate and the public surface

- Review and merge the local cleanup commit `b94abdc` only after it is applied
  to current `main` and the published package is rebuilt from that tree.
- Keep the canonical Dashboard Memory Map, remove dead renderer/dependency
  paths, make profile counts truthful, and make CLI, MCP, README, docs, and all
  installed agent guidance describe the same reachable tools.
- Keep `micro=9`, `lite=20`, `team=28`, and `full=47`; do not solve tool-schema
  bloat by silently exposing all 47 tools to every agent.

### P1 — Close the real runtime reliability gaps

- Resolve #259/#260 with a real cross-platform concurrency test. The critical
  section must never fall back to an unlocked check-and-spawn after contention;
  it must either observe the existing service, wait/recheck, or fail with a
  useful retry message. Verify stale-lock recovery, duplicate-process cleanup,
  Windows hidden children, macOS launch-agent startup, and Linux service start.
- Add a single readiness/status receipt showing service PID, endpoint, profile,
  project binding, startup state, and last failure without exposing secrets.
- Make every foreground path bounded and cancellable, and make provider errors
  distinguish “saved locally” from “embedding still pending” so a successful
  write never feels hung.

### P2 — Finish MCP compatibility in this same line

- Keep legacy 2025-era `initialize` and Streamable HTTP clients working while
  adding the 2026-07-28 stateless path, using the official SDK path rather than
  accumulating patches around the old SDK.
- Implement and test request metadata/version negotiation, complete
  `server/discover`, `resultType`, response `_meta`, list cache hints, explicit
  unsupported-version errors, and the official Tasks and subscriptions
  extension surfaces where Memorix can give truthful semantics.
- Run the pinned conformance suite plus stock official clients over stdio and
  HTTP. Unsupported features must be rejected or reported explicitly, never
  represented as an empty success.

### P3 — Make memory selection honest and useful

- Every task Workset gets one compact receipt: what was selected, why it was
  selected, source/freshness, coverage, omitted material, token budget, and
  whether the safe decision was to abstain.
- Unify stale, conflict, feedback, retention, and provenance decisions behind
  the same lifecycle calculation. A memory can be useful evidence, a hint, or
  something to ignore; it must not become truth merely because retrieval found
  it.
- Add deterministic multi-session and conflict tests inspired by ContextBench,
  MemoryArena, and MemSyco-Bench: recall, precision, noise, latency, stale
  rejection, scope control, and “do not agree with bad memory”.

### P4 — Finish CodeGraph and Knowledge Workspace integration

- Produce one clear context receipt that distinguishes current Code State,
  local Lite structure, and optional semantic CodeGraph. Include freshness,
  coverage, provenance, limits, and the exact portion delivered to the Agent.
- Keep graph relations source-backed and bounded. The Dashboard, CLI, MCP, and
  Knowledge Workspace must not show different “truths” for the same relation.
- Make reviewed claims, durable pages, workflow inheritance, and agent/project
  scope visibly separate. No raw session dump or arbitrary generated document
  may silently become durable knowledge.

### P5 — Finish integrations without changing users’ Agent settings

- Re-verify Claude Code, Codex, OpenCode, Pi/Oh-my-Pi, Gemini, Copilot,
  Cursor, Antigravity, Hermes, DeepSeek Harness, and WorkBuddy from their real
  supported entry points. Project and global installs must remain isolated and
  idempotent.
- Accept #204 only if its current MCP scopes and skill-less behavior match
  official WorkBuddy documentation; preserve the contributor credit. Otherwise
  request the smallest missing change and keep the issue open with evidence.
- Treat #3 as MCP/rules support until Qwen or iFlow publishes a verifiable hook
  contract. Treat #49 as an external-reachability integration boundary, not a
  reason to turn Memorix into an email or remote identity service.

### P6 — Finish the operator experience and repository hygiene

- Keep Dashboard pages read-mostly and tied to real sources: readiness,
  observations, evidence, retention, sessions, coordination, Knowledge, and
  the single Memory Map. Empty, stale, and failed states must look different.
- Verify desktop and narrow-screen layouts, especially long names, forms,
  graph labels, and error states. Keep the UI quiet and operational rather than
  adding decorative pages for every backend table.
- Remove private operator files, credentials, raw session captures, stale
  generated artifacts, and unowned root directories from the tracked surface;
  retain only reproducible fixtures and canonical documentation.

### P7 — Resolve every open item and release once

- #202: close as completed with its measured hygiene results.
- #249: close only after the modern compatibility contract is either passed or
  its unsupported boundary is formally and testably rejected; no vague
  “partial” claim remains.
- #259/#260: merge or request changes after the duplicate-process gate passes.
- #204: merge with credit or request a concrete correction; do not copy the
  contributor’s work into an owner-only patch.
- #244: merge only if the generated Star History asset is genuinely reachable
  and renders; otherwise close it with the reason recorded.
- Update README, Chinese README, API reference, setup docs, changelog, plugin
  manifests, and release notes together. Run the complete tests, build, package
  smoke, native integration checks, MCP conformance, and release workflow before
  one final publication.

## Agent-Memory Landscape Decision (2026-08-17)

Current ecosystem research focused on TencentDB Agent Memory v2 and the
upstream CodeGraph project. The signal is not that Memorix should become a
remote "memory hub" or duplicate a parser engine. The useful direction is a
local, evidence-bound coding-memory product with a first-class semantic code
provider when the operator chooses one.

- Tencent's product model unifies chat memory, skills, wiki pages, and code
  graphs as assignable assets. Its useful lessons are explicit readiness,
  compact session bootstrap, background processing receipts, and showing an
  Agent what assets are active. Its recent beta issue stream also demonstrates
  the operational cost of central queues, transactions, and broad proxy
  interception.
- Memorix keeps its differentiator: its canonical evidence is the current
  local Git worktree, versioned code state, reviewed knowledge, and task-sized
  worksets. It must not clone private repositories to a service, intercept all
  model traffic through a proxy, alter unrelated Agent configuration, or
  present a generated graph as authoritative source truth.
- The bundled Lite index is a useful local structural fallback, not a semantic
  CodeGraph. A healthy external CodeGraph already adds semantic context, but
  the UX currently describes persisted Lite state and semantic overlay state
  separately. This must become one explicit receipt: what was used for this
  task, its freshness, coverage, limits, and the token budget delivered.
- The first product slice is therefore: keep JSON/context output genuinely
  bounded by default; make Code State versus Semantic CodeGraph unambiguous;
  then add an opt-in CodeGraph lifecycle adapter (detect, initialize, observe
  freshness, and queue bounded sync). It must never run an upstream installer
  that edits the user's Agent configuration.

## Historical Stability Baseline (1.5.0, stress-tested and measured)

- Stress exams live in `tests/stress/` and run in the normal suite:
  - Corpus: 2,000 observations, 25 real searches, planted needles all hit,
    ranking deterministic, project isolation held, tokens 168..170.
  - Concurrency: 60 parallel writes with zero loss; 20 parallel same-topic
    upserts converge to one active record.
  - Session churn: 45 start/end cycles across 3 projects plus 10 parallel
    starts — at most one active session per project.
  - Long-term scale: 300 records, maintenance archives exactly the stale
    set (60) and supersedes exactly the older halves (40); candidates
    untouched.
  - CLI repeat: 15 repeated add/list invocations with stable exit codes and
    no id reuse.
- Embedding lane on the operator's OpenRouter environment:
  `qwen/qwen3-embedding-8b` (4096d) verified live — 100-text batch in ~9.5s,
  cache round-trip, singleton stability. When the base URL is OpenRouter and
  no model is set, the default is now `qwen/qwen3-embedding-8b` instead of
  the OpenAI-only model (pinned by `tests/config/embedding-default-model.test.ts`).
  Image analysis can use a multimodal OpenRouter model
  (`qwen/qwen3-vl-8b-instruct`) through the LLM lane; documented in
  CONFIGURATION.md.
- Live embedding exams stay env-gated (`MEMORIX_RUN_LIVE_EMBEDDING_TESTS=1`)
  and never run in CI.

## Historical Memory Hygiene Baseline (1.4.x, measured)

- Session dedup: `memorix_search` demotes rows already shown in the same
  session and remembers the surfaced set. Session-replay exam: duplicate
  rate 25% → 19%, hits 4/4 and token ceiling unchanged.
- Guidance hygiene: generated guidance now teaches store-the-underivable,
  dual-channel feedback (record successes too), verify-before-use, and the
  ignore contract. Guidance exam: 0/4 → 4/4 rules inside the ceiling.
- Data-dir boundary pinned by `tests/config/data-dir-boundary.test.ts`
  (project config cannot redirect storage).
- Always-on brief: every task brief opens with a "You and this workspace"
  block — user profile, latest session summary, and recent durable
  long-term memories. Exam: 0/3 → 3/3 inside the token ceiling; older
  fixtures without the block still pass.
- Long-term self-maintenance (rule leg, no LLM required):
  - Explicit requests (MCP `longTerm: true`, CLI add/promote) auto-qualify
    on the spot instead of waiting for a manual review.
  - Stale qualified/approved records auto-archive after 30 days without
    activity; newer records auto-supersede same-title records in the same
    scope/kind.
  - Runs in the existing durable maintenance lane (`long-term-maintenance`
    job kind): once at session startup, again after each explicit
    promotion, then a daily reschedule heartbeat. Candidates are never
    auto-advanced; approved records are never auto-archived unless stale.
  - Exam: `tests/evaluation/long-term-maintenance.test.ts` 0/4 → 4/4,
    deterministic and offline.
- Cold-feature sweep (2026-08-14, five-way audit of the whole surface):
  the "taught tools vs installed profile" gap is fixed — `memorix setup`
  now installs `--mode lite` and the repo guidance marks full-only tools;
  `memorix purge` gives memory retirement a real CLI entry; git
  `ingest_on_commit`/`max_diff_size` now actually gate ingestion; the
  media MCP schema hides gated actions; dead code removal, config honesty,
  and doc corrections land in the same batch. Exams added per item.
- Exams live in `tests/evaluation/` and are deterministic and offline.

## Active Objectives

1. Keep the public repository free of operator state, local paths, credentials,
   raw session captures, and one-off development artifacts.
2. Keep the released integration surface honest: native-host validation is
   still required whenever a newly supported agent CLI becomes available.
3. Review open contributor work independently; do not merge it merely because
   it overlaps a planned product direction.
4. Make every bounded foreground path cancel the network work it starts, and
   make non-retryable provider failures fail once with a useful diagnostic.
5. Keep the 40,000-record gate fail-closed across SDK, HTTP MCP, hooks, and
   canonical persistence before every release that changes retrieval/storage.

## Completed Contribution Decisions

- #153: accepted and merged with focused MiniMax M3 video-input tests.
- #178: accepted and merged (squash) with author and co-author credit preserved
  on the merge commit. Adds MiniMax image-to-image via `subject_reference`
  across the provider layer, the media CLI, and the gated `memorix_media` MCP
  tool. Changelog credit for @octo-patch lands with the next release, following
  the #153 precedent.
- #140: accepted and merged after replacing its stale release timeline with a
  maintained boundary-and-roadmap document.
- #33, #31, #30: not merged into the superseding media/retrieval architecture.
  Their original authorship is preserved through #173 (PDF derivations), #174
  (audio derivatives), and #175 (graph-assisted evidence expansion).
- #136, #151, #179, #147, and #152: withdrawn research work. Do not use them
  as product or release evidence.

## Operating Rules

- Git, `package.json`, and `CHANGELOG.md` are live product facts; this document
  records intent and next actions, not a replacement for them.
- Never write secrets, account identifiers, local absolute paths, raw chat
  transcripts, or local tool state into tracked files.
- Keep reusable public docs and test fixtures only when they are source-backed,
  non-sensitive, and exercised by the repository.
- Do not rewrite Git history without explicit maintainer approval. Removing a
  file from the current tree does not erase existing forks or historical clones.

## Immediate Next Step

- Review commit `bf0d79b` on the cleanup branch, then merge and publish only
  after explicit maintainer approval.
- After the candidate, review #212 only after it is rebased onto current `main` and
  re-verified. Validate #204 against current official WorkBuddy behavior before
  considering it for a feature release.

## Historical Release Notes

The #174 controlled audio derivations, #175 governed one-hop graph evidence,
#185 CodeBuddy integration, and #184 Star History CI verification are merged
and included in the published 1.4.3 release. The local machine does not have
the CodeBuddy CLI installed, so a native CodeBuddy-host smoke remains a
documented follow-up rather than claimed release evidence. Legacy requests
#49/#3 remain independent of the 1.4.4 line.

- 1.4.4 published (2026-08-14) through the GitHub publish workflow; the #194
  reporter has been notified with the shipped version.
- DeepSeek Harness support implemented and merged via PR #201 (2026-08-14):
  `memorix setup --agent dsh` installs the `@deepseek-ai/dsh-mcp-client`
  row into `$DSH_HOME/cordis.patch.yml`, AGENTS.md guidance, and skills.
  Native validation composed the generated patch with the real
  `@deepseek-ai/dsh@0.1.0-rc.6` launcher. Shipped in the published 1.4.5
  release.
- Branch protection on `main` was synced with the current CI matrix
  (2026-08-14): the required status contexts referenced removed Node 20 test
  jobs, which blocked every PR from merging. Required contexts are now the
  live `test (ubuntu-latest, 22)`, `test (windows-latest, 22)`, and
  `typecheck`; the one-approval review requirement is unchanged.
- Old GitHub releases before v1.2.0 were pruned from the Releases page
  (2026-08-14); git tags and the full CHANGELOG history are preserved.
