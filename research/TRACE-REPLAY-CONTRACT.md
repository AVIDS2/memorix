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
