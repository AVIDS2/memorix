# MemorixBench-Transfer Preregistration Draft

Status: design-stage draft, before confirmatory outcome inspection
Protocol version: 0.1
Target system: Memorix 1.2.1

## 1. Research question

When a coding project evolves across sessions and agent clients, does a bounded
freshness-aware project memory improve the next agent's engineering outcome
without adding stale-context harm or excessive cost?

The proposed method is a Freshness-Aware Multi-Session Project Memory system.
Its agent-facing unit is a Task Workset that combines current project facts,
code state, source-qualified claims, selected durable memories, optional wiki
and workflow starts, cautions, and verification evidence under a fixed context
budget. Code state has precedence over narrative memory. Code-bound evidence is
classified as current, suspect, or stale by comparison with the latest complete
snapshot; unsafe evidence is warned about or withheld rather than silently used
as current truth.

## 2. Contributions under test

1. A project-memory method that treats freshness and provenance as retrieval
   constraints rather than metadata shown after retrieval.
2. MemorixBench-Transfer, a benchmark of precursor sessions followed by a fresh
   agent performing a dependent task after controlled project evolution.
3. A downstream evaluation that measures patch correctness, first correct
   action, stale-memory harm, context cost, latency, and cross-agent transfer.
4. A reproducible comparison against no memory, raw transcript replay, Mem0,
   AgentMemory, Memorix operating modes, and component ablations.

## 3. Experimental tracks

### Track A: deterministic Workset requirements

The existing TypeScript, Python, Go, docs-only, dirty-worktree,
deleted-symbol, and incomplete-scan fixtures test required start files,
evidence identifiers, cautions, and token ceilings without a model judge. This
track catches retrieval regressions but is not a downstream-agent result.

### Track B: seeded retrieval parity

Every memory system receives the same approved atomic evidence, timestamps, and
scope labels. The systems retrieve under an equal context-token ceiling. This
isolates retrieval and stale-evidence handling from memory formation quality.
`seeded-canonical` is Track B only: it is deliberately useful for retrieval
parity, but it is not evidence that a product formed memory from a session.

### Track C: end-to-end transfer

Every condition receives the same immutable, normalized precursor trace. Each
event has a session id, sequence, turn, role, kind, and, where relevant, a
tool-call link. The trace is replayed through the condition's documented write
surface before a transition is applied to the repository. A fresh process, with
no raw precursor transcript except the bounded raw-replay control, receives the
transfer task.

The currently implemented Track C formation surface is `trace-replay`: it
compares how systems ingest and retrieve the same public event sequence, and
records an auditable formation receipt. `native-session` remains a separately
labelled future surface; it is not executable and must not be substituted into
the main comparison without a frozen provider-native replay contract. A
confirmatory Track C case requires `captured-session-v1` provenance. A
`controlled-replay-v1` trace may harden the development harness but cannot be
promoted as captured user-session evidence.

A confirmatory case must bind at least two independently captured precursor
traces in a `precursor-trace-bundle-v1`, all from the same precursor workspace
snapshot. `case_id`, run seed, and repetition select one trace via the frozen
`hash-bucket-v1` rule before any condition is formed, so a condition cannot
choose a favorable session after seeing results. Every validation/test receipt
must be `isolated-worker-v1`; local captures are diagnostic only.

## 4. Conditions

Primary conditions:

- no-memory: fresh agent with repository and task only;
- last-n: bounded event-suffix replay of the same normalized precursor trace;
- mem0: pinned open-source Mem0 adapter and version;
- agentmemory: pinned adapter for the explicitly identified AgentMemory project;
- memorix-micro: minimal Memorix surface;
- memorix-lite: standard bounded project context;
- memorix-full: all applicable 1.2.1 memory, code-state, knowledge, workflow, and
  freshness capabilities enabled.

Predeclared ablations:

- full-no-freshness;
- full-no-code-state;
- full-no-graph;
- full-no-knowledge;
- full-no-workflow;
- oracle-context, reported only as an upper-bound diagnostic.

Adapters must pass installation, write, read, isolation, and empty-store smoke
checks before experimental runs. A broken adapter is an infrastructure failure,
not a zero score.

## 5. Benchmark case design

Each admitted case is split between a public card and a private controller
overlay. Together they contain:

1. a license-audited repository revision;
2. a precursor task with deterministic success commands;
3. captured high-signal and distractor evidence;
4. a sealed controlled transition between sessions;
5. a dependent transfer task with a non-revealing public prompt;
6. a controller-only behavioral oracle and maintainer repair;
7. relevance, staleness, and negative-control annotations; and
8. a private deterministic structural oracle when ownership or placement is
   part of correctness and behavior tests alone would let an agent restore
   stale code.

Private source checks are deliberately narrow constraints over a declared file
or stable source span. They are evaluated only by the vault after the agent
exits, and only redacted pass/fail commitments are archived. They never replace
behavioral tests. When semantic ownership is central to a case, use a private
language-specific validator rather than treating a literal match as a complete
architecture proof.

External cases additionally declare transition provenance. An upstream replay
reconstructs an observed upstream change. A historically grounded controlled
transition starts from a real repository and real historical constraint but
uses a benchmark-authored state change. The latter is valuable for isolating
freshness, but is never called an upstream incident and is reported as a
separate stratum. It remains development-only until the frozen protocol
specifies its role in confirmatory analysis.

Transition strata are code changes, dependency changes, configuration changes,
documentation or policy changes, and no-change controls. Dependency strength is
declared as low, medium, or high together with its classification status.
The early retrospective development corpus was withdrawn after leakage review
and is not an eligible source of harness, ablation, or effect evidence. A future
confirmatory case must be marked `preregistered` before its first model run.
Low-dependency cases remain useful only after clean admission and cannot enter
the primary memory-effect analysis without a separate declared analysis stratum.

The corpus must include multiple repositories and at least TypeScript, Python,
and Go. Memorix itself may be used for development and smoke tests but is
excluded from confirmatory generalization claims. Repository-level splits
prevent closely related cases from appearing in both development and test sets.
The frozen registry additionally prohibits a repository family, transition/task
family, or captured-trace family from crossing corpus splits. Each registered
case carries a dependency rationale, minimal sufficient predecessor evidence,
plausible stale distractor, no-memory expectation, source/contamination
disclosure, and authoring-batch id. These are preregistered before the first
condition run and are not mounted in the agent workspace.

Candidate sources live in a separate ledger and cannot be interpreted as cases
or result rows. The ledger pins the base revision and license hash at that
revision, records public-history and benchmark-overlap risk, and requires an
offline environment plus a private post-snapshot transition before admission.
Public issue and PR text is treated as provenance metadata, not copied into the
agent prompt or private oracle.

## 6. Primary hypotheses

H1: Memorix full has higher transfer-task success than no memory.

H2: Memorix full has higher transfer-task success than last-N transcript replay
under an equal retrieved-context token ceiling.

H3: On stale-memory cases, Memorix full produces fewer stale-memory errors than
the no-freshness ablation.

H4: Memorix full reaches the first correct engineering action earlier than no
memory on successful or partially successful runs.

H5: On negative-control tasks with no useful precursor dependency, Memorix full
does not exceed the preregistered harm margin for task success or context
intrusion.

## 7. Outcomes

Primary outcome:

- task_success: all case-specific required tests pass without forbidden test or
  fixture modification, and every declared source check passes.

Secondary outcomes:

- partial hidden-test pass rate;
- first correct action step and elapsed time;
- handoff success on cross-agent cases;
- relevant evidence precision, recall, and hit rate;
- stale-memory error count;
- negative-control intrusion count;
- input, output, retrieved-context, and cached tokens;
- wall time, retrieval latency, and API cost;
- repository exploration breadth before the first correct action.

An action is correct only if it is consistent with the frozen oracle and leads
toward a required change or verification step. Agent clients stream their
machine-readable events into an observed monotonic-time action ledger. A
sanitized ledger preserves action order, time, type, success state, and a
provider-redacted operation summary; raw event logs and memory payloads are not
annotation inputs outside the vault.

Every run used in C3, C4, or C7 is independently labeled by two blinded human
raters. Matching labels become a consensus; disagreement requires a third,
independent blinded human adjudication. An LLM judge is prohibited. The final
result contains only the final status, numeric outcomes, and commitments to the
packet and labels. `null` means pending or unrateable. A zero stale-error or
intrusion count means it was actually human-rated, not that the harness omitted
the metric. Development may sample labels to calibrate the rubric, but cannot
promote those samples into confirmatory evidence.

## 8. Randomization and isolation

The unit of pairing is case, agent client, model, repetition, and seed. Condition
order is randomized within blocks. Every run receives a fresh repository
checkout, process environment, memory data directory, and artifact directory.
Conditions never share a writable memory store. The host network policy, tool
allowlist, timeout, context budget, and task prompt are identical unless the
condition definition requires a disclosed difference.

Model identifiers, agent versions, system instructions, integration files, and
command lines are pinned and archived. Provider-reported per-model usage is
also archived; a client run that invokes helper models is labelled `mixed`, not
as a pure run of the requested model. A trial may declare a required single
model; it is then invalid unless both the provider-reported model set and
per-model usage contain exactly that one model. Claude trials use `--bare`, explicit MCP
configuration, disabled client auto-memory, a separate workspace root, and
read/edit denials for artifact, home, and source-repository paths. Bash is
allowed for normal work inside a disposable checkout, while parent traversal,
network, installation, remote-Git, dynamic-interpreter, and external-path
commands are denied or detected from the archived event stream. Native Windows
permission controls are treated as a mitigation, not as a substitute for this
documented command-contamination audit.

The raw event timeline stays in the private run artifact. The worker-to-vault
boundary permits only a sanitized action ledger with no client/provider
identity, memory operation arguments, or absolute host paths.

Authentication, provider quota, MCP startup, agent-runtime, missing-event,
permission-denied, and command-contamination failures are infrastructure
exclusions. Any permission denial or command-audit violation invalidates a run
until the declared constrained environment is repaired and preflighted; it is
never treated as agent behavior or silently retried. A fixed-budget exhaustion
or timeout is an observed task failure when the process otherwise ran in the
declared environment.

## 9. Sample size and pilot freeze

The development pilot is used to estimate runtime variance, discordant binary
pairs, infrastructure failure rate, and annotation cost. It is not used for
confirmatory claims. Before reading confirmatory condition labels, the final
protocol freezes:

- case inclusion and repository split;
- model and agent matrix;
- repetitions and seeds;
- the minimum detectable paired success-rate difference;
- a target of at least 80 percent power for the primary paired comparison;
- exclusion, retry, timeout, and missing-data rules;
- the negative-control harm margin.

A default target is at least 50 confirmatory case-model pairs with three
repetitions, but the frozen number must follow the pilot's discordant-pair power
analysis and available cost budget. Stopping early because a result looks
positive is prohibited.

## 10. Statistical analysis

The primary binary comparison uses paired success outcomes, reports the absolute
success-rate difference with a paired bootstrap 95 percent confidence interval,
and uses an exact two-sided McNemar test. Secondary binary comparisons use the
same method. Holm correction controls the family-wise error rate for the
predeclared primary and ablation families.

Continuous paired outcomes use distribution plots, median and mean paired
differences, bootstrap intervals, and a paired permutation or Wilcoxon test when
appropriate. Mixed-effects sensitivity models include repository and case as
grouping factors and model/agent/language/transition stratum as fixed effects.
These models are secondary and do not replace the paired primary analysis.

Missing cost or token data is reported, not imputed as zero. Secondary action,
stale-error, and intrusion analyses reject pending or unrateable labels and
report their missingness; they never coerce them to zero. Infrastructure
failures are shown separately. Both intention-to-run and valid-run summaries
are published when exclusions occur.

Native MCP interaction is reported on its own budgeted product track. It is
never silently pooled with the canonical retrieval primary comparison; see
`NATIVE-MCP-BUDGET-CONTRACT.md` for the one-call, fixed-task, bounded-output
gateway and its receipt rules.

## 11. Leakage and contamination controls

Case authors never place oracle answers in public prompts, filenames, memory
titles, or adapter configuration. A private fixture is never mounted into the
same process environment that executes candidate code; confirmatory cases use
the controller/subject boundary in `BLACK-BOX-CONTROLLER-CONTRACT.md`.
Agent processes cannot read another condition's logs or memory database.
Track C precursor traces are normalized before condition-specific formation.
The raw precursor transcript is never injected as a separate asset in Track C:
the manifest rejects it in favor of the selected trace bundle entry. The raw source-file hash,
canonical trace hash, bounded-view hash, retained event ids, dropped event ids,
token count, formation receipt, and retrieval call/round counts are archived
for every applicable run.
Reference repairs are mounted only in a separate maintainer self-test after the
agent process exits. Development pilot runs that reveal prompt ambiguity,
leakage, invalid oracle behavior, or changed execution rules are archived with
their manifest hashes and excluded before confirmatory case selection.

Authoring oracles, exact transitions, reference repairs, and hidden tests live
outside the repository. The local development overlay can prove deterministic
authoring gates, but the runner refuses every private-oracle agent trial. A
confirmatory execution remains blocked until each included agent client runs on
a separate worker host or disposable VM with no private task or oracle bytes,
returns a sealed patch plus only a sanitized action ledger, and is graded by a
fresh offline vault after the worker is destroyed. A local Docker containment
probe is diagnostic only. The full worker/vault protocol requires a randomized
sentinel suite, inspected runtime profile, signed worker attestation, and a
redacted grade receipt for the exact pinned image. Client-side Claude/Codex
permission rules are defense in depth, not read-isolation evidence. Private
grade reports preserve only status, duration, byte counts, and output hashes.
Confirmatory result summaries contain no absolute artifact path, repository
cache path, or private overlay identifier; they use opaque receipts and
commitments instead.

Public repositories may have appeared in model training, so conclusions concern
the controlled transfer intervention, not proof of novel code synthesis. Where
possible, transitions are newly authored and timestamped after the selected
base revision. The paper discloses this limitation.

## 12. Reproducibility and release

The artifact releases sanitized case cards, adapter versions, environment locks,
controller interfaces, run manifests, commitments, analysis code, aggregate
results, failure inventory, and the exact manuscript tables and figures. Raw
logs are redacted for credentials and personally identifying paths before public
release. Every paper number must be regenerated from archived machine-readable
results by one documented command.

Private overlays, hidden verifier output, reference repairs, and any ephemeral
credential injection material remain outside the public artifact. The release
includes their commitments and the isolation-certificate hashes instead. After
the embargo, any disclosure must preserve those original commitments and state
whether the public release is identical to the version used for grading.

For remote repositories, a pinned local Git cache may be used only when its
`origin` matches the manifest URL and it contains the immutable full commit
named by the manifest. The commit identity, not a mutable remote URL, fixes the
content; the origin match is recorded as provenance metadata. Artifacts record
the transport and origin so transient network failure is never misclassified as
an agent outcome.

## 13. Claim boundary

A negative or mixed result is a valid outcome. The study will not claim general
agent-memory superiority from retrieval fixtures, one repository, one model, or
an LLM preference judge. Confirmatory deviations are timestamped and reported
before reanalysis.
