# Memorix Active Work

> This is the single living work-status document for this repository. Read it
> before resuming substantial work, update it after a material decision or
> milestone, and do not create parallel progress logs.

**Last updated:** 2026-08-14

## Current Product State

- `1.4.5` is the current published release on npm, the official MCP
  Registry, and GitHub Releases.
- The memory-hygiene work continues on the 1.4.x line (no 1.5.0 rush):
  session dedup, guidance hygiene rules, and the data-dir boundary are
  implemented and score-verified; user-profile capture guidance and the
  session-summary template are in progress. Publication waits for
  maintainer approval.

## Memory Hygiene Main Line (1.4.x, measured)

- Session dedup: `memorix_search` demotes rows already shown in the same
  session and remembers the surfaced set. Session-replay exam: duplicate
  rate 25% → 19%, hits 4/4 and token ceiling unchanged.
- Guidance hygiene: generated guidance now teaches store-the-underivable,
  dual-channel feedback (record successes too), verify-before-use, and the
  ignore contract. Guidance exam: 0/4 → 4/4 rules inside the ceiling.
- Data-dir boundary pinned by regression test (project config cannot
  redirect storage).
- Exams live in `tests/evaluation/` and are deterministic and offline.

## Active Objectives

1. Keep the public repository free of operator state, local paths, credentials,
   raw session captures, and one-off development artifacts.
2. Keep the released integration surface honest: native-host validation is
   still required whenever a newly supported agent CLI becomes available.
3. Review open contributor work independently; do not merge it merely because
   it overlaps a planned product direction.

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
