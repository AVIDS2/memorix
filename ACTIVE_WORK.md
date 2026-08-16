# Memorix Active Work

> This is the single living work-status document for this repository. Read it
> before resuming substantial work, update it after a material decision or
> milestone, and do not create parallel progress logs.

**Last updated:** 2026-08-17

## Current Product State

- `1.5.1` is the current published release (2026-08-16) on npm, the
  official MCP Registry, and GitHub Releases. It is the reliability patch for
  bounded formation cancellation and provider-error handling. A separate
  Registry-only publish path now keeps the official MCP Registry current when
  npm was already published manually.
- `1.5.0` is the underlying stability release: the deterministic stress-exam matrix
  (corpus, concurrency, session churn, long-term scale, CLI repeat) runs in
  the normal suite, the OpenRouter embedding lane was verified live
  (`qwen/qwen3-embedding-8b`, 4096d), and the embedding default is now
  provider-aware. Everything from the 1.4.6 memory-native line carries
  forward.
- Contributor PR #206 remains independently reviewed and attributed. It is a
  distinct hook process-lifecycle fix for issue #205; its author needs to
  update one stale static test before it can merge.

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

## 1.5.0 Stability Main Line (stress-tested, measured)

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

## Memory Hygiene Main Line (1.4.x, measured)

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

- Prepare the bounded-context and semantic-CodeGraph UX slice as a standalone
  specification with compatibility tests. Do not make it a giant memory-hub
  rewrite or a new MCP tool surface.
- Keep contributor PR #206 separate: its hook deadline, stdin release,
  deferred embeddings, and smaller hook heap are valuable, but the author
  should update the failing static test and rerun CI before review/merge.

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
