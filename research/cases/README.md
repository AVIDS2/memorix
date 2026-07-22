# Case admission

`cases/` is the public inventory for MemorixBench, not a convenient place to
store a task solution. The registry is deliberately empty until a new case
passes the sealed-task admission path.

## Public surface

A public case card may contain provenance, an immutable base revision, a broad
task category, a public verification command, contamination disclosure, and
commitments to private material. It must not contain or name a hidden test,
reference repair, case-specific source check, forbidden implementation path,
exact behavior predicate, implementation-owner recipe, raw precursor trace, or
private transition patch.

The public tree is hashed before a case is enrolled. The loader rejects the
reserved private-oracle asset names even when they are omitted from the bundle
allowlist. An agent worker never receives this tree or the registry.

## Private authoring overlay

Development authoring may use an external overlay under the artifact drive,
never under this repository. A `development-authoring-v1` overlay binds its
case id, public-tree hash, base revision, transition commitment, hidden test,
reference repair, and any source checks. `memorixbench verify-case` may use
that overlay to prove the four authoring gates locally. It is not an agent
execution mode: `run-trial` rejects development private-oracle cases.

Confirmatory overlays additionally require the black-box controller contract,
a pinned verifier runtime, a private transition, and a separately attested
worker/vault isolation profile. See `PRIVATE-ORACLE-CONTRACT.md` and
`CONFIRMATORY-EXECUTION-ARCHITECTURE.md`.

## Admission rule

The old development corpus was retired after independent leakage review. It
cannot be revived by deleting a patch or relabeling an old run. A future case
needs a new id, clean public surface, sealed post-snapshot transition,
independently reviewed sanitized predecessor evidence, preregistration, and a
matched no-memory screening cohort before it can appear in any effect table.
