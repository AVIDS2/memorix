# Native MCP Budget Contract

Memorix is both a memory system and a coding-agent product surface. A native
MCP interaction is therefore not automatically comparable to a pre-injected
retrieval block: the agent can decide whether to call it, product context may
include source-aware hints, and an unrestricted client can make many calls.
MemorixBench keeps those questions separate instead of hiding them under one
condition label.

## Three Tracks

1. **Canonical retrieval track** is the primary cross-provider comparison. Each
   provider receives the same formation input, one fixed transfer query, and a
   bounded context block before the agent starts. The Memorix canonical adapter
   joins Mem0 and AgentMemory on this track; it does not use native MCP
   interaction.
2. **Budgeted native MCP track** measures the Memorix product surface. The
   agent can elect to call one fixed, read-only `memorix_project_context` tool
   during the task. It is reported as a native-product ablation, not pooled
   into the canonical primary effect estimate.
3. **Unrestricted native product track** may be useful for user-experience
   demonstrations, but has no call or context budget and is exploratory only.
   It is never used for a confirmatory cross-provider efficacy claim.

## Budgeted Native Surface

`native_mcp_gateway.py` is a stdio MCP proxy. It launches the real Memorix
control plane behind the gateway, but lists exactly one tool:
`memorix_project_context`.

For each run, the gateway fixes and commits:

- transfer-task SHA-256 rather than caller-provided tool arguments;
- `refresh = never` for the comparable memory-only native surface;
- one served MCP call maximum;
- the same 180-token lexical proxy output budget used by canonical retrieval;
- no memory writes, graph calls, search calls, detail calls, or context-pack
  calls during transfer; and
- a private run receipt containing only hashes, token counts, truncation, call
  attempts, served calls, and provider-failure count.

The agent sees the returned packet but not the receipt. A second call is an MCP
tool error, not a retry or an extra context round. The gateway never logs raw
context to stdout or its receipt.

## Result Accounting

Every budgeted native result carries the policy hash, call budget, receipt
status, attempts, served calls, emitted context tokens, and truncation flag.

- `recorded-v1`: the gateway started and produced a valid receipt.
- `not-started-v1`: the agent never used the MCP server; this is a valid product
  choice and reports no retrieval context.
- `missing-after-attempt-v1`: a tool call appeared in agent telemetry but no
  gateway receipt exists. The run is an invalid infrastructure result, not a
  task failure or a zero-retrieval result.

The trial validator rejects a receipt with more served calls than attempts, a
served call above the policy budget, context evidence without a served call, or
an output above 180 tokens.

## Verification Boundary

The gateway has unit tests for JSON-RPC framing, strict no-argument tool calls,
token truncation, exhausted calls, receipt validation, and Claude MCP config
generation. A real local smoke also creates a Memorix control plane, forms
canonical evidence, starts the gateway as a subprocess, performs MCP
initialize/list/call/call, and verifies one served call followed by rejection.

This proves controlled native interaction plumbing. It does not prove model
benefit, and it does not make a development case or a local run confirmatory.
