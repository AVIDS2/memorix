# Memorix Active Work

> This is the single living work-status document for this repository. Read it
> before resuming substantial work, update it after a material decision or
> milestone, and do not create parallel progress logs.

**Last updated:** 2026-08-03

## Current Product State

- `1.4.0` is the current published release.
- The next product track is `1.4.1`: admit or reject pending contributions one
  at a time, with focused tests and user-visible acceptance evidence.
- `1.4.1` is not a release authorization by itself. A release needs its own
  changelog, package smoke, and verification evidence.

## Active Objectives

1. Keep the public repository free of operator state, local paths, credentials,
   raw session captures, and one-off development artifacts.
2. Review pending feature contributions individually. Do not merge unrelated
   work as a bundle.
3. Turn MemorixBench from a local harness into a reproducible study with public
   permissive-license task sources, isolated trials, and provenance receipts.

## Pending Admission Work

- #153: assess MiniMax M3 video input separately from the completed image/video
  generation path.
- #140: refresh the public roadmap without restating stale product plans.
- #33, #31, #30: review PDF ingestion, audio ingestion, and graph-search fusion
  as independent changes with their own tests and release rationale.
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

The repository privacy-hygiene baseline is merged. Resume contribution admission
with one focused PR at a time, then advance the benchmark from local fixtures to
public, reproducible task sources.
