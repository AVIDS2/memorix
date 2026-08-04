# MemorixBench sealed-local runner

This is the deliberately small execution core for exploratory project-memory
trials. It is not a general sandbox and it is not a confirmatory study runner.

The model receives only five ordinary coding tools: list files, read files,
write allowed files, replace one exact writable text fragment, and run a trusted
verifier. The verifier is supplied by
the controller in an external oracle file, so its location and content are not
visible to the model. The `raw-record` condition adds one explicit read of a
fixed predecessor record; `memorix-native` adds one normal `memorix context
--json` call and one cited `memorix memory detail` expansion. Every
memory-providing condition has the same case-defined evidence-size cap, while
the receipt records the provider-reported token usage actually consumed. This
is a capacity control, not a claim that different providers tokenize text
identically. The native path does not expose an evaluation-only MCP parameter or
alter the product's retrieval behavior.

## Evidence-surface profiles

`native-product` is the product-experience profile. It exposes the real
condition-specific tool surface, so it measures total integration cost,
including tool-schema overhead. It must not be used alone to attribute a token
or success difference solely to predecessor information.

`canonical-information` gives every condition the same two neutral predecessor
tools. `no-memory` returns no prior evidence, `raw-record` returns the fixed
record, and `memorix-native` uses the real Memorix brief/detail backend. This
is the profile for causal information comparisons; its neutral tools deliberately
do not claim to reproduce the exact product UX.

The `optional` policy leaves those tools available for the agent to choose. The
`fixed-index` policy is a separate controlled cohort: the runner gives all
conditions the same instruction to consult the index before the first source
edit and expands a listed record once. Noncompliance becomes an invalid row.
It estimates evidence delivery against an explicit empty index, not natural
tool adoption or an end-to-end product claim.

Every condition also receives the same repair-loop contract: after an
agent-visible failed verification, it must keep diagnosing, editing allowed
source, and verifying while budget remains. Receipts distinguish the agent's
ordinary tool requests from the controller's final private-oracle check, then
record edit attempts, source changes, and a structured termination reason
without retaining model prose. A case where all matched rows make no edit is a
retained no-action calibration, not a memory-effect result.

The controlled index always returns the same `records` shape. Native retrieval
first checks whether real Memorix selected the seeded observation, then exposes
the case-local alias `1`; the real backend brief remains in the private
sidecar. This avoids treating a condition-specific record ID or text layout as
an information effect.

Version-2 case cards also declare the precursor observation type, source files,
and concepts. The native path stores that declared record only after the copied
source has a clean baseline commit, matching Memorix's normal code-bound memory
selection. Delivered evidence is retained in an ignored external sidecar for
audit; receipts retain only its SHA-256 digest.

Run deterministic tests:

```powershell
uv run --directory research/bench python -m unittest discover -s tests -v
```

Validate a public case card:

```powershell
uv run --directory research/bench memorixbench validate-case <case.json>
```

A real run additionally needs an external oracle JSON file and an external
artifact directory. Both must stay outside the Git checkout. Raw model output
and oracle paths are never written into the receipt. Each current receipt also
contains a protocol version and a hash of the runner source tree, so later
source-backed trials can identify the exact executable study surface without
recording a local checkout path.
