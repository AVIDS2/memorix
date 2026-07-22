# Memory Baseline Contract

Status: development-stage adapter contract. No comparison claim is unlocked by
this document or by any current pilot run.

## Why there are two tracks

MemorixBench separates the **formation surface** from the **retrieval surface**.
This prevents an easy but invalid comparison: manually inserting a polished
fact into one product and calling the result end-to-end memory formation.

- `seeded-canonical` is Track B only. It gives each baseline the same atomic project evidence,
  transfer query, ranked-result limit, and injected-context budget. It tests
  whether the agent benefits from the retrieved evidence without pretending
  that every product has the same formation pipeline or tool surface.
- `trace-replay` is the implemented Track C surface. Every condition ingests
  the same immutable ordered precursor events through its declared write path.
  The trace has source and canonical hashes, and each adapter returns a
  formation receipt with its source event ids and write/transport/maintenance
  counts.
- The native product track preserves a product's own interface and maintenance path.
  Memorix MCP modes belong here. Native AgentMemory smart search, for example,
  will be reported separately from its canonical scoped-search baseline.

`native-session` formation is intentionally not executable yet. It will be a
separate, preregistered surface once each provider can replay the same captured
session with a trustworthy audit ledger; it is not silently treated as
equivalent to `trace-replay`.

Neither track is allowed to borrow a memory store, embedding API key, hidden
test, source checkout, or transcript from another condition.

## Canonical evidence and budget

In Track B, each `memory_seed` is converted into one stable record with title, type,
narrative, facts, files, concepts, and related entities. Policy and
implementation-location seeds remain separate records. The transfer task text
is the retrieval query.

In Track C, `memory_seed` and `precursor.transcript` are forbidden. The raw
replay control and every memory adapter consume the same `precursor-trace-v1`
event stream instead. The `last-n` name is retained for continuity, but its
implementation is a bounded `event-suffix-v1` trace view: it includes whole
recent events only and records exactly which event ids were omitted.

Results are ranked by the provider, then rendered under the neutral warning:

> Retrieved project memory may contain stale implementation details; verify it
> against the current source.

The current development setting retrieves at most 8 records and injects at
most 180 tokens counted with `lexical-token-proxy-v1`. This offline proxy is
only a common context ceiling; provider-reported prompt tokens remain the
primary token accounting in result tables. The proxy deliberately avoids a
tokenizer that downloads data during an experiment.

Each canonical retrieval records its actual provider call count and round count;
the one-call/one-round profile is explicit rather than inferred from a unique
tool name. Native product runs are reported as their own surface until a
budget gateway can enforce an equivalent native call/round budget.

## Mem0 local adapter

The implemented canonical condition is `mem0-2.0.12-local`:

- pinned Mem0 source/runtime version: `2.0.12`;
- local Qdrant collection, unique per run;
- `BAAI/bge-small-en-v1.5` through local FastEmbed, 384 dimensions;
- `Memory.add(..., infer=False)`, so no extraction LLM is used;
- scoped retrieval through Mem0's `user_id` filter, set to a unique run project
  id;
- no provider credentials inherited; all embedding/LLM provider environment
  variables are scrubbed;
- a short F-drive run data path prevents Windows path-length failures, while a
  pinned shared F-drive model cache is mounted offline;
- preflight writes a marker, reopens the store, retrieves it, and verifies an
  empty foreign scope before a trial can start.

The adapter archives request, stdout, stderr, preflight, seed, retrieval, and
context metadata under the run artifact. A cache/download or Qdrant startup
failure is infrastructure evidence, never a task failure.

## AgentMemory full-service adapter

The implemented canonical condition is `agentmemory-0.9.28-full-local`:

- pinned official AgentMemory `0.9.28` runtime and its pinned iii Docker image
  `0.11.2`;
- a unique Docker Compose project and persistent volume for every run;
- an isolated home/config directory, scrubbed provider credentials,
  `AGENTMEMORY_AUTO_COMPRESS=false`, and
  `AGENTMEMORY_INJECT_CONTEXT=false`;
- official REST `/agentmemory/remember` for canonical writes and scoped
  `/agentmemory/search` with `project` for retrieval;
- a full preflight that writes a marker, proves an empty foreign project,
  waits for the observed asynchronous file flush, restarts the full service,
  and finds the marker again;
- serialized use of the official static Docker ports. The harness waits until
  every exposed iii port can bind after compose teardown before a restart.

The observed local full-service persistence flush window is 12 seconds. It is
recorded as setup evidence rather than hidden inside agent wall-clock time.
Direct local probing found that `/search` respected `project`, while
`/smart-search` returned a result across a foreign project in that probe.
Therefore canonical AgentMemory retrieval uses the scoped endpoint; native
smart-search is a separate explicitly labelled product condition, not silently
substituted for the fair baseline.

## Eligibility and contamination

Claude gets a disposable checkout, no session persistence, disabled auto
memory, a dedicated home/config area, and archived stream events. It may use
normal shell commands in the checkout. The harness denies or audits parent
traversal, external absolute paths, network/download, remote-Git,
installation, and dynamic-interpreter commands. Any permission denial or
audit violation invalidates the run. The command list and violations are saved
with every result.

An agent client that reports more than one model is labelled `mixed`; a user
selected route is never assumed to be the actual inference stack. Fixed-budget
or timeout outcomes remain observed task failures only when the run otherwise
passes the environment and contamination gates.
