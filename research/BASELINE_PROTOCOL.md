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
- `trace-replay` is the implemented equal-input Track C surface. Every condition ingests
  the same immutable ordered precursor events through its declared write path.
  The trace has source and canonical hashes, and each adapter returns a
  formation receipt with its source event ids and write/transport/maintenance
  counts.
- `native-session` is a separately executable Memorix product diagnostic for
  portable Claude Code hook captures. It calls the real `memorix hook` command
  for each official hook payload in an isolated workspace and proves at least
  one stored observation can be searched afterward. It is available only to
  `no-memory` and Memorix conditions, so it is never passed off as an equal
  ingestion comparison with Mem0, AgentMemory, or `last-n`.
- The native product track preserves a product's own interface and maintenance path.
  Budgeted Memorix MCP and native AgentMemory smart search, for example, are
  reported separately from their canonical scoped-search baselines.

`native-session` remains a separate, preregistered surface. Its current Claude
hook adapter is local-diagnostic only until the provider capture, worker/vault,
and independent audit evidence satisfy the confirmatory protocol. It is not
silently treated as equivalent to `trace-replay`; see
`NATIVE-SESSION-FORMATION-CONTRACT.md`.

Neither track is allowed to borrow a memory store, embedding API key, hidden
test, source checkout, or transcript from another condition.

## Strong no-memory control

`no-memory` is a full-capability fresh coding-agent control, not a deprived
reader. It receives the same agent binary, actual model route, editable current
checkout, ordinary source-inspection commands, test commands, timeout, and
workspace boundary as a memory condition. It may inspect all current repository
files and run allowed verification. The only withheld asset is predecessor
session evidence and the memory-tool interface. Restricting ordinary current
code reading, search, or test execution in this condition invalidates the pair.

The native exploratory condition `memorix-1.2.1-selective-local` uses the same
one-tool native Autopilot MCP setup and call budget as the complete-delivery
condition. Its prompt
asks the agent to decide whether memory would materially change its plan and to
avoid a call when current source is sufficient. It measures agent-guided
selective assistance; it is not represented as an automatic Memorix retrieval
gate until such a product mechanism exists and is independently tested.

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
most 512 tokens counted with `lexical-token-proxy-v1`. This ceiling was raised
during development calibration because 180 proxy tokens could not retain one
complete terminal handoff event; it is frozen before any validation or test
case is admitted. The offline proxy is only a common context ceiling;
provider-reported prompt tokens remain the primary token accounting in result
tables. The proxy deliberately avoids a tokenizer that downloads data during
an experiment.

Each canonical retrieval records its actual provider call count and round count;
the one-call/one-round profile is explicit rather than inferred from a unique
tool name. Native product runs are reported as their own surface through the
bounded gateway in `NATIVE-MCP-BUDGET-CONTRACT.md`.

For Memorix's canonical formation, each explicit `memorix_store` write is
synchronous and searchable before the call returns. The adapter therefore
starts retrieval immediately after those audited writes and records
`deferred-after-synchronous-store-v1` rather than polling unrelated asynchronous
claim, knowledge, or workflow maintenance. Those background features remain
part of the native product surface, not hidden formation latency in the
canonical retrieval comparison.

## Memorix Canonical Adapter

The implemented canonical condition is `memorix-1.2.1-canonical-local`.

It deliberately does not call `memorix_project_context`, `memorix_context_pack`,
CodeGraph refresh, or any write tool during transfer. It runs one logical
provider retrieval round: Memorix compact search receives the frozen transfer
query and returns at most eight typed observation refs; one bulk detail call
hydrates only those refs; the adapter then renders the returned memory evidence
through the same neutral 512-token renderer used by the other canonical
conditions.

The artifact records both meanings of “call”: `logical_retrieval_call_count =
1` and `logical_retrieval_round_count = 1` describe the experimental treatment,
while `transport_call_count = 2` makes the search-plus-hydration implementation
visible. It is never silently represented as one MCP transport. No raw replay,
source-aware project brief, or agent-driven tool loop enters this condition.

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

Run `memorixbench preflight-baseline-runtime --provider mem0` with explicit
external `--output`, `--mem0-python`, and `--model-cache-root` paths before a
study. The command is offline by construction and writes a compact receipt;
it does not run an agent or create a task result.

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

The pinned official Compose manifest exposes the fixed port set rooted at
`3111`; the adapter rejects alternate ports instead of implying a capability
the manifest does not have. It preserves the named volume only for the
preflight's deliberate restart check, then removes that run's volume at final
teardown. Run `memorixbench preflight-baseline-runtime --provider agentmemory`
with an external `--output` and explicit `--agentmemory-runtime` before a
study. This is a runtime gate, not an agent evaluation.

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

The comparison command rejects `mixed` and `unreported` model profiles by
default, even when both paired conditions report the same model set. The
`--allow-mixed-models` override is available only together with the explicit
development override for a local diagnostic; it cannot unlock a confirmatory
comparison.
