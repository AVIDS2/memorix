# Pi Upstream Policy

`packages/memcode` is a Memorix-native overlay on the Pi coding-agent
runtime. Pi remains the general coding harness; Memorix adds only shared
project memory, project identity, native hook capture, and context recovery.

This repository does not silently track Pi's `main` branch and it does not use
an automatic source overwrite. A released Memorix version is the supported,
tested update unit for end users.

## What Users Update

- `memcode update --self` updates the published Memorix/memcode release.
- `memcode update --extensions` updates installed skills, prompts, themes, and
  extension packages through the normal Pi-compatible package path.
- `memcode update <source>` updates one installed extension package.

Those commands do not replace the core agent runtime with an unreviewed Pi
release.

## What Maintainers Review

The pinned base and package mapping live in
[`packages/memcode/pi-upstream.json`](../packages/memcode/pi-upstream.json).
Run this from a clean, isolated branch:

```powershell
npm run audit:pi-upstream
npm run audit:pi-upstream -- --head v0.82.1 --json
```

The audit calls the official GitHub compare API, groups changed files by the
four forked packages, and highlights paths that overlap with Memcode's native
integration surface. When GitHub's anonymous API limit is exhausted, it safely
uses an already-authenticated local `gh api` session without reading or printing
its token. It only reports. It never fetches source into the worktree, rewrites
files, or changes the pinned base.

GitHub compare exposes at most 300 file entries. When that cap is reached, the
audit falls back to a recursive Git-tree comparison of the two official refs,
so package and overlay counts still cover the full path set. If either tree is
also truncated, it emits a warning: inspect the complete upstream range and
release notes before selecting a port.

## Adoption Rule

1. Start with an isolated `codex/` branch and inspect the audit report.
2. Decide feature by feature whether it belongs to Pi's general harness or
   Memorix's native memory layer.
3. Port only compatible runtime behavior. Do not add a second implementation
   when Pi already owns the behavior.
4. Preserve Memorix-specific memory, hook, and project-identity behavior.
5. Run focused tests, package builds, and a user-facing memcode smoke before
   publishing a Memorix release.

Examples: upstream session environment metadata is compatible and useful to
Memcode, so 1.2.6 adopts the exact `PI_*` contract for model-initiated bash
calls. A local llama.cpp model manager is a broader Pi product surface and is
not imported merely to chase upstream version parity.
