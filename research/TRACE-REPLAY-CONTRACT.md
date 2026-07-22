# Precursor Trace Replay Contract

Status: development-stage measurement contract. It makes Track C auditable; it
does not unlock a product or benchmark claim by itself.

## Why traces exist

`memory_seed` is a useful controlled input for retrieval parity, but it has
already decided what the memory should contain. That is Track B. Track C starts
from the same ordered precursor-session evidence for every condition and lets
each system write through its own documented interface.

The artifact calls this surface `trace-replay`. It is a controlled replay of a
canonical event stream, not a claim that every provider natively captured a
live user conversation. `native-session` stays disabled until it has its own
auditable provider contract.

## Public `precursor-trace-v1` format

A trace is UTF-8 JSON with a case id, provenance, normalization id, and a
contiguous ordered `events` array. Every event has:

- `id`, `session_id`, `sequence`, and non-decreasing `turn`;
- `role`: `user`, `assistant`, `tool`, or `system`;
- `kind`: `message`, `tool_call`, or `tool_result`;
- normalized textual `content`;
- `tool_name` and a unique `tool_call_id` for tool calls;
- the referenced earlier `tool_call_id` for tool results.

The loader rejects credential-like content, private absolute host paths, NUL
bytes, duplicate event ids, non-contiguous sequences, decreasing turns, and
unmatched tool results. It stores both the raw-byte source hash and a canonical
JSON hash. The canonical hash is the identity used for paired Track C results.

Only `captured-session-v1` traces may enter a confirmatory case. A
`controlled-replay-v1` trace is allowed for development hardening only.

## Capture receipts

`memorixbench capture-trace` turns an agent client's private JSONL stream into
a public canonical trace plus a `captured-trace-receipt-v2`. The raw event and
timeline files remain in the private artifact root. The receipt records only
their SHA-256 commitments, the canonical and source trace commitments, agent,
requested/reported model labels, client version, workspace-snapshot commitment,
event counts, explicit omitted-event counts, a validated stdout-to-timeline
binding, redaction count, capture mode, and timestamp.

Before a trace is written, known workspace paths, absolute host paths, and
credential-like strings are replaced or removed. The normal trace validator is
then run on the transformed content. This is deliberate: a raw event stream is
not safe to publish merely because it is JSON. A local capture is always marked
`local-diagnostic-v1`; only a future worker capture bound to the external
isolation contract can use `isolated-worker-v1`.

The current command supports the documented `claude --print --output-format
stream-json` and `codex exec --json` completed-event surfaces. Unknown raw
lines are never silently treated as trace content. The command is a capture and
sanitization tool, not an oracle or an experiment runner.

`memorixbench capture-precursor-session` is the local diagnostic entry point
for this contract. It materializes a case's exact precursor snapshot before the
agent starts, injects only the provider environment needed for a constrained
Claude invocation, disables local auto-memory, records stream timing, verifies
the final content snapshot is unchanged after the session, and rejects
network/path audit violations before trace formation. Raw events and staged
outputs remain private; a separate public root receives a trace only after an
exact injected-secret scan and public-content safety scan pass. Its capture mode
is fixed to `local-diagnostic-v1`: the local process is not an OS-isolated
worker, so confirmatory provenance remains an external controller responsibility.

For code-bearing precursor sessions, `capture-precursor-session` uses
`event-normalize-tool-results-omitted-v1`. It preserves assistant tool calls,
tool-call ids, event order, and an explicit receipt omission count, while every
tool-result body becomes the fixed text `<tool output omitted from public
trace>`. This prevents a Read result from becoming a portable source-code
answer key. The agent's own concise policy handoff remains replayable. The
lower-level `capture-trace` command exposes this as explicit `metadata-only`
mode; verbatim tool results remain available only when deliberately requested
for a diagnostic and must not be treated as safe by default.

## Multi-capture bundles

A confirmatory Track C case cannot nominate one favored precursor session.
`memorixbench build-trace-bundle` consumes at least two independently captured
trace/receipt pairs and writes `precursor-trace-bundle-v1`. It verifies every
receipt-to-trace commitment, requires a shared workspace-snapshot commitment,
refuses duplicate capture ids or canonical traces, and binds one explicit trace
normalization for every capture. It rejects a bundle that mixes normalizations.
Legacy v1 bundles without that field are read as `event-normalize-v1` only. The
bundle uses
`hash-bucket-v1`: `case_id`, run seed, and repetition deterministically select
one capture, so all paired conditions receive the same source trace without a
post-hoc choice.

Validation and test manifests must reference a bundle, not a direct trace; all
bundle assets must be allowlisted in the public case definition and every
receipt must carry `isolated-worker-v1`. A development bundle may use a local
diagnostic capture, but it remains excluded from confirmatory analysis.

## Bounded raw replay

The `last-n` control is rendered with `event-suffix-v1`, not by cutting an
arbitrary transcript string. A view starts at the newest event and adds whole
events backward until its declared token budget would be exceeded. Its receipt
contains:

- trace canonical hash and renderer id;
- token budget and actual proxy-token count;
- retained and dropped event ids;
- truncation flag and deterministic view hash.

This means every condition can be audited against the exact evidence it was
allowed to see. A Track C manifest cannot also declare `memory_seed` or a raw
`precursor.transcript` shortcut.

If the declared budget cannot hold even the newest complete event, rendering
fails before an agent is launched. A header-only replay is invalid evidence,
not an empty-memory control. Development calibration currently uses a shared
512-token lexical-proxy ceiling across raw replay and every canonical memory
condition; that ceiling is frozen before validation or test enrollment.

## Adapter receipts

Every trace-ingestion adapter records a formation receipt with the input trace
hash, source event ids, record count, individual write-operation count,
transport-call count, and maintenance-poll count. Canonical retrieval adapters
also record their actual retrieval call and round count. These receipts are
measurement data, not performance outcomes.

## Current boundary

All executable cases remain public development cases. Confirmatory execution
also requires the separate worker/vault architecture, private oracle overlay,
and an external isolation certificate documented in
`CONFIRMATORY-EXECUTION-ARCHITECTURE.md`. No current trace replay is reported
as a confirmatory result.

The public `capture-trace` command and local capture helper can emit only
`local-diagnostic-v1`. They cannot self-label a receipt as
`isolated-worker-v1`; a future confirmatory exporter must bind a capture to a
verified external worker attestation before that mode is accepted.
