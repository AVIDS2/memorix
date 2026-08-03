# MemorixBench sealed-local runner

This is the deliberately small execution core for exploratory project-memory
trials. It is not a general sandbox and it is not a confirmatory study runner.

The model receives only four ordinary coding tools: list files, read files,
write allowed files, and run a trusted verifier. The verifier is supplied by
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
