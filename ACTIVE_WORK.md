# Memorix Active Work

> This is the single living work-status document for this repository. Read it
> before resuming substantial work, update it after a material decision or
> milestone, and do not create parallel progress logs.

**Last updated:** 2026-08-10

## Current Product State

- `1.4.2` is the current published release.
- It adds evidence-governed memory retrieval and maintains the controlled media
  boundary introduced in 1.3.x.

## Active Objectives

1. Keep the public repository free of operator state, local paths, credentials,
   raw session captures, and one-off development artifacts.
2. Deliver the controlled media follow-through: #174 audio transcript
   derivations, #175 evidence-bounded graph retrieval, #185 CodeBuddy support,
   and #184 automated Star History verification.

## Completed Contribution Decisions

- #153: accepted and merged with focused MiniMax M3 video-input tests.
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

Complete #174 on the shared derivation contract. It must use provider-specific
credentials, explicit CLI-first consent, bounded asynchronous jobs, and source
asset lifecycle cancellation; #175 must then reuse the existing evidence
governor rather than add unbounded graph traversal.
