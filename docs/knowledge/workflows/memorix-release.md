---
id: memorix-release
title: Memorix release
description: Prepare a Memorix release with evidence, package verification, and explicit maintainer approval.
status: active
version: 1
taskLenses: [release]
triggers: [release, publish, npm, version, changelog]
allowedAgents: [codex, claude-code, cursor, windsurf, copilot, antigravity, gemini-cli, openclaw, hermes, omp, kiro, opencode, trae]
verificationGates:
  - Version and changelog match the release scope
  - npm run lint passes
  - npm run build passes
  - npm test passes
  - Focused live MCP smoke passes when server behavior changed
  - Package smoke passes
  - CI passes on the release commit
  - Maintainer approval is explicit before publishing
---

## Inspect

Read the current version, changelog, Git state, open release risks, and the
diff that will ship. Do not treat a release tag, an old test run, or a local
token as proof that this exact commit is ready.

## Prepare

Update version metadata, changelog, and user-facing documentation only for
changes that are actually included. Keep package workspace visibility and npm
access settings unchanged unless the release specifically changes them.

## Verify

Run `npm run lint`, `npm run build`, and `npm test`. Run focused tests for the
changed surface. When MCP behavior changed, use a real isolated stdio client to
exercise the affected tool path. Inspect `npm pack --dry-run --json` and run a
package smoke from the packed artifact when packaging changed.

## Review

Record what passed, what was not run, and any remaining risk. Confirm that the
release commit has passing CI. A workflow may prepare evidence, but publishing
requires explicit maintainer approval.

## Publish

After explicit maintainer approval, publish through the approved release path.
Never put credentials in the repository, release notes, workflow files, or
command output. Verify the published package version without exposing tokens.

## Follow Up

Check a fresh install or `npx` invocation, create or update the GitHub release
if appropriate, and reply to affected issue reporters with the concrete fix and
version. Store the verification evidence as project knowledge rather than an
unstructured chat note.
