# Public Artifact Contract

This contract controls the public, static portion of a future MemorixBench
release. It does not publish a dataset, raw runtime evidence, model transcript,
or result table by itself. A file is public only after an explicit release
decision; this manifest merely makes that decision auditable and reproducible.

## Explicit whitelist

The release builder accepts only explicit POSIX-relative `--include` paths
under one declared root. It does not recursively publish a directory. Each
selected file must be a regular UTF-8 text file with an allowed source,
metadata, documentation, or paper-source suffix. It rejects symlinks/reparse
points, binary files, files over the static-entry limit, and paths under
`.git`, `.venv`, `artifacts`, `cache`, `private`, `raw`, or `results`.

Every file is scanned with the same public-safety checks used by trace export:
absolute host paths, credential-like values, private keys, and malformed JSON
are rejected. The output manifest stores only relative path, deterministic
category, byte count, and SHA-256. It never stores the release-root path.

## Build and audit

Build a manifest to an external staging location before a release:

```powershell
uv run memorixbench build-public-artifact-manifest `
  --root <public-release-root> `
  --release-id <frozen-release-id> `
  --evidence-tier design-only-v1 `
  --include README.md `
  --include PROTOCOL.md `
  --include paper/main.tex `
  --output <external-staging>/public-artifact-manifest.json
```

Then audit the same checkout against that manifest immediately before upload:

```powershell
uv run memorixbench audit-public-artifact-manifest `
  --root <public-release-root> `
  --manifest <external-staging>/public-artifact-manifest.json
```

The audit rereads and rescans every selected file, then rejects byte/hash drift.
Pass `--require-exact-tree` for a materialized staging directory to also reject
any unlisted file, symlink/reparse point, or unsupported filesystem entry. It
prints only release ID, evidence tier, manifest hash, and entry count.

Do not upload the source tree itself. Materialize a new, empty staging directory
from the audited manifest and upload only that directory:

```powershell
uv run memorixbench materialize-public-artifact `
  --root <public-release-root> `
  --manifest <external-staging>/public-artifact-manifest.json `
  --target <external-staging>/upload-directory
```

The materializer copies only the audited whitelist, verifies every copied byte
against the manifest, and refuses an existing target. It also rejects source
files with more than one hard link, preventing an allowed-looking path inside
the release root from aliasing a file outside it.

## Evidence boundary

`design-only-v1` is appropriate for protocol, harness, test, manuscript source,
and contract materials, and it must not be described as a benchmark result
release. `public-reproducible-summary-v1` is available for the narrower public
cohort result tier. It requires the exact
`public-summary/public-cohort-v1.json` receipt in addition to an explicit
whitelist; the builder and audit both validate that receipt's schema and
descriptive evidence label.

A confirmatory-summary tier is deliberately not implemented: it will remain
rejected until the builder can verify redeemed permits, a frozen analysis plan,
the confirmatory result corpus, and an independent artifact-review receipt.
Raw private measurements, private oracle assets, raw model events, and
source-review working material remain outside every public manifest.
