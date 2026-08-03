# Memorix Active Work

> This is the single living work-status document for this repository. Read it
> before resuming substantial work, update it after a material decision or
> milestone, and do not create parallel progress logs.

**Last updated:** 2026-08-03

## Current Product State

- `1.4.0` is the current published release.
- `1.4.1` is the release candidate. It includes the accepted MiniMax M3 video
  input contribution (#153), the maintained public roadmap contribution (#140),
  and deterministic provider-test boundaries.
- Publication is still gated on the release PR, full local checks, fresh-package
  smoke, GitHub Actions, and npm publication evidence.

## Active Objectives

1. Keep the public repository free of operator state, local paths, credentials,
   raw session captures, and one-off development artifacts.
2. Turn MemorixBench from a local harness into a reproducible study with public
   permissive-license task sources, isolated trials, and provenance receipts.

## Pending Admission Work

- #153: accepted and merged with focused MiniMax M3 video-input tests.
- #140: accepted and merged after replacing its stale release timeline with a
  maintained boundary-and-roadmap document.
- #33, #31, #30: not merged into the superseding media/retrieval architecture.
  Their original authorship is preserved through #173 (PDF derivations), #174
  (audio derivatives), and #175 (graph-assisted evidence expansion).
- #136 and #151: research-only work. Keep it outside npm releases until the
  experimental protocol and evidence are independently complete.

## Research Boundary

The current benchmark harness is a pilot, not a paper result. Confirmatory
claims require public task provenance, isolated execution, frozen routes and
models, blinded grading where applicable, and reported failures as well as wins.

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

Complete the 1.4.1 release gates. Once published, advance MemorixBench from
local fixtures to public, reproducible task sources and keep research work
separate from npm release claims.
