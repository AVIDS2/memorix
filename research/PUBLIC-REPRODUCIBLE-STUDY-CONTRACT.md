# Public Reproducible Study Contract

Status: frozen public cohort v1. The 12-case registry and 144-row execution
matrix were frozen before outcomes were analyzed. Partial, invalidated, or
incomplete repeats are retained for audit but excluded from aggregation.

## Purpose

MemorixBench has two intentionally different evidence paths:

1. The private-oracle confirmatory path requires sealed transitions, a trusted
   remote controller, and independently attested KVM isolation.
2. This public reproducible path measures a fixed coding agent on fully public,
   versioned transfer cases that anyone can rerun locally.

The second path exists because reproducibility, paired controls, and honest
model accounting can support useful empirical evidence before a private
black-box deployment exists. It never inherits the stronger path's claims.

## Permitted Claims

A completed public cohort may support claims of the following form:

> Under the frozen public cases, fixed provider-reported model, bounded tool
> surface, and declared token budget, condition A used fewer/more resources or
> achieved a different pass rate than condition B.

It cannot support any claim that:

- a task was hidden from the model or absent from pretraining;
- a public verifier is tamper-proof against an unrestricted agent;
- an observed result generalizes to all coding agents, repositories, or models;
- a local container or Windows workspace is equivalent to the KVM private
  worker/vault protocol;
- a single fixture, retry, or favorable run estimates an effect size.

## Case Requirements

Every public-evaluation case must be frozen in the registry before the first
paired run. A case card declares a public repository or local fixture, exact
base revision, transfer prompt, verification commands, a public transition or
seeded predecessor record, and a dependency card. The card must separately say:

- why predecessor evidence should help;
- the smallest evidence that would be useful;
- a plausible stale or distracting prior fact;
- what a no-memory agent can still rediscover from current source and tests.

The case also declares `oracle.agent_writable_paths`. The bounded OpenRouter
agent may only write below those relative source roots. It cannot write tests,
package configuration, hooks, parent paths, symbolic/reparse targets, or new
files outside the roots. It may run only a manifest-declared verification
command by index. The controller removes provider credentials from every test
subprocess and records every tool call in a hash-bound action ledger.

All case assets are UTF-8 text. Python and pytest caches are explicitly
excluded from fixture materialization and public hashing because they are
reproducible interpreter residue, not benchmark state.

## Frozen Cohort Shape

The first cohort contains 12 local-fixture cases across Python, TypeScript, and
Go:

- 4 predecessor-dependent positive transfers;
- 4 current-source-sufficient or weak-dependency controls;
- 4 stale/distractor transfers where uncritical reuse is a failure mode.

Each case has three fixed repetitions under the same exact provider-reported
model. Repetitions estimate stability only; the primary unit remains the
`case x agent x actual-model` cluster. The registry must prevent a repository,
task, or trace family from leaking across design and held-out public-evaluation
partitions.

The initial canonical comparison family is:

- `no-memory`;
- `mem0-2.0.12-local`;
- `agentmemory-0.9.28-full-local`;
- `memorix-1.2.1-canonical-local`.

Every condition uses the same exact provider-reported model, prompt, bounded
tool surface, source-root write boundary, timeout, and cost ceiling. Each
memory adapter receives the registered predecessor record through its own
documented local interface; the controller records the formation and retrieval
receipts rather than pretending that distinct memory products have identical
internal algorithms. Native Memorix MCP/autopilot remains a separate product
comparison because its interaction surface is not provider-neutral.

## Independent-Model Replication

`PUBLIC-CROSS-MODEL-REPLICATION-CONTRACT.md` freezes a later, separate
two-condition replication under one exact DeepSeek model. It was created after
the initial Qwen cohort's outcomes were analyzed, so it is not retroactively
called part of that original primary family. Its rows and analysis remain a
separate descriptive model cohort.

## Execution And Analysis

For every run, the controller records provider-returned model id, request
usage, model cost when supplied, prompt/tool-policy hashes, case-definition
hash, clean Git start snapshot, patch hash, verification receipt, and action
ledger. A mixed provider response invalidates a fixed-model public cohort.

Primary outcomes are task pass, wall time, input/output tokens, cost, tool-call
count, and verification attempts. Stale-memory and negative-control outcomes
are reported separately. The paper must show every valid paired row or a
predeclared missing-data reason, never select only passing memories or only
cases where the no-memory control failed.

Before reading outcomes, the cohort freezes its primary treatment/control
pair, resource metric directions, and case-clustered paired summary method.
Results use paired summaries and confidence intervals; they do not pool retries
as independent tasks. Baseline comparisons beyond the frozen primary contrast
are descriptive context, not additional primary hypotheses.

`memorixbench analyze-public-cohort` is fail-closed: it refuses an incomplete
or invalid matrix, averages repetitions within each case before calculating the
primary Memorix-versus-no-memory contrast, and writes an immutable analysis
receipt. Its success-rate bootstrap interval and sign-flip value are explicitly
descriptive for this public cohort, not confirmatory inference. Resource
receipts report treatment minus control plus a declared direction for wall
time, input/output tokens, provider cost, and tool calls.

## Current Evidence

One public Python development smoke preceded the frozen cohort. It demonstrates
the complete mechanics only: exact fixed-model receipt, source-root write
boundary, real Memorix formation/retrieval, real patch, and real unit-test
grading. It is not enrolled in the public-evaluation registry and is excluded
from every aggregate table. The frozen Qwen cohort completed its 144 planned
rows and has a sanitized aggregate receipt in `public-summary/public-cohort-v1.json`.
The separately frozen DeepSeek replication completed its 72 planned rows and
has its own receipt in `public-summary/public-cross-model-deepseek-v1.json`.
Both remain descriptive public-fixture evidence and do not alter the
confirmatory gate.
