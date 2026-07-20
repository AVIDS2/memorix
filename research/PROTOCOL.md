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

### Track C: end-to-end transfer

Every condition observes the same precursor session content. A transition is
then applied to the repository. A fresh process, with no raw precursor
transcript except what its condition permits, receives the transfer task. This
track measures the complete formation, maintenance, retrieval, and use path.

## 4. Conditions

Primary conditions:

- no-memory: fresh agent with repository and task only;
- last-n: bounded raw precursor transcript replay;
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

Each case contains:

1. a license-audited repository revision;
2. a precursor task with deterministic success commands;
3. captured high-signal and distractor evidence;
4. a controlled transition between sessions;
5. a dependent transfer task;
6. isolated public and hidden success tests, plus a maintainer-only reference
   repair that passes the hidden tests;
7. an action/evidence oracle, stale evidence, and forbidden stale actions when
   applicable;
8. a deterministic structural oracle when ownership or placement is part of
   correctness and behavior tests alone would let an agent restore stale code.

Source checks are deliberately narrow literal constraints over a declared file
or stable source span. They are evaluated after the agent exits but before a
maintainer-only hidden patch is mounted, and their source and scoped-source
hashes are archived with the grade. They never replace behavioral tests. When
semantic ownership is central to a case, use a hidden language-specific test or
validator (for example, an AST check) rather than treating a literal match as a
complete architecture proof.

External cases additionally declare transition provenance. An upstream replay
reconstructs an observed upstream change. A historically grounded controlled
transition starts from a real repository and real historical constraint but
uses a benchmark-authored state change. The latter is valuable for isolating
freshness, but is never called an upstream incident and is reported as a
separate stratum. It remains development-only until the frozen protocol
specifies its role in confirmatory analysis.

Transition strata are code changes, dependency changes, configuration changes,
documentation or policy changes, and no-change controls. Dependency strength is
classified before model runs as low, medium, or high according to how much the
transfer task depends on precursor-only information.

The corpus must include multiple repositories and at least TypeScript, Python,
and Go. Memorix itself may be used for development and smoke tests but is
excluded from confirmatory generalization claims. Repository-level splits
prevent closely related cases from appearing in both development and test sets.

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
toward a required change or verification step. Action labeling is blinded to
condition. A stratified sample is double-labeled and reports agreement.

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
as a pure run of the requested model. Claude trials use `--bare`, explicit MCP
configuration, disabled client auto-memory, a separate workspace root, and
read/edit denials for artifact, home, and source-repository paths. Bash is
allowed for normal work inside a disposable checkout, while parent traversal,
network, installation, remote-Git, dynamic-interpreter, and external-path
commands are denied or detected from the archived event stream. Native Windows
permission controls are treated as a mitigation, not as a substitute for this
documented command-contamination audit.

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

Missing cost or token data is reported, not imputed as zero. Infrastructure
failures are shown separately. Both intention-to-run and valid-run summaries
are published when exclusions occur.

## 11. Leakage and contamination controls

Case authors never place oracle answers in public prompts, filenames, memory
titles, or adapter configuration. Hidden tests are mounted only for grading.
Agent processes cannot read another condition's logs or memory database.
Precursor transcripts are normalized before condition-specific formation.
Reference repairs are mounted only in a separate maintainer self-test after the
agent process exits. Development pilot runs that reveal prompt ambiguity,
leakage, invalid oracle behavior, or changed execution rules are archived with
their manifest hashes and excluded before confirmatory case selection.

Development cases may retain authoring oracles in the repository so their
admission gates are reproducible; they are explicitly public development
evidence, not private-oracle evaluations. The executable runner currently
refuses validation and test splits. Confirmatory execution is blocked until a
private oracle overlay and verified read isolation exist for every included
agent client, including Codex.

Public repositories may have appeared in model training, so conclusions concern
the controlled transfer intervention, not proof of novel code synthesis. Where
possible, transitions are newly authored and timestamped after the selected
base revision. The paper discloses this limitation.

## 12. Reproducibility and release

The artifact releases case manifests, transition patches, public tests, adapter
versions, environment locks, Dockerfiles where needed, run manifests, checksums,
analysis code, aggregate results, failure inventory, and the exact manuscript
tables and figures. Raw logs are redacted for credentials and personally
identifying paths before public release. Every paper number must be regenerated
from archived machine-readable results by one documented command.

## 13. Claim boundary

A negative or mixed result is a valid outcome. The study will not claim general
agent-memory superiority from retrieval fixtures, one repository, one model, or
an LLM preference judge. Confirmatory deviations are timestamped and reported
before reanalysis.
