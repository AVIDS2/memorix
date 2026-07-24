# MemorixBench-Transfer Preregistration Draft

Status: design-stage draft, before confirmatory outcome inspection
Protocol version: 0.2
Target system: Memorix 1.2.1

## 1. Research question

When a coding project evolves across sessions and agent clients, does a bounded
freshness-aware project memory improve the next agent's engineering outcome
relative to a capable fresh agent that can freely inspect the current
repository, without adding stale-context harm or excessive cost?

The study does not assume that memory is always useful. A sufficiently capable
agent may correctly reconstruct a small or stable project from its current
source and tests. Matching or exceeding a memory condition in that setting is a
valid outcome, not a baseline failure.

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
4. A reproducible canonical-retrieval comparison against no memory, raw
   transcript replay, Mem0, and AgentMemory, plus a separately budgeted native
   Memorix Autopilot product track and explicit agent-facing delivery ablations.

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

The implemented equal-input Track C formation surface is `trace-replay`: it
compares how systems ingest and retrieve the same public event sequence, and
records an auditable formation receipt. A separate executable
`native-session` surface forms Memorix through portable Claude Code command
hook payloads, calls the real hook command in an isolated workspace, and
requires a post-formation storage probe. It is a Memorix-product/no-memory
diagnostic only, not an equal-ingestion baseline comparison and not a
substitute for `trace-replay`. See `NATIVE-SESSION-FORMATION-CONTRACT.md`.
A confirmatory Track C case requires `captured-session-v1` provenance. A
`controlled-replay-v1` trace may harden the development harness but cannot be
promoted as captured user-session evidence.

A confirmatory case must bind at least two independently captured precursor
traces in a `precursor-trace-bundle-v1`, all from the same precursor workspace
snapshot. `case_id`, run seed, and repetition select one trace via the frozen
`hash-bucket-v1` rule before any condition is formed, so a condition cannot
choose a favorable session after seeing results. Every validation/test receipt
must be `isolated-worker-v1`; local captures are diagnostic only.

## 4. Conditions

### Canonical retrieval primary track

The primary cross-provider track gives every memory system the same normalized
precursor trace, one fixed transfer query, the same ordinary current-code
capabilities, and the same bounded rendered-memory ceiling before the agent
starts. Its conditions are:

- `no-memory`: fresh agent with repository and task only;
- `last-n`: bounded event-suffix replay of the same normalized precursor trace;
- `mem0-2.0.12-local`: the pinned open-source Mem0 canonical adapter;
- `agentmemory-0.9.28-full-local`: the pinned AgentMemory canonical adapter;
- `memorix-1.2.1-canonical-local`: Memorix compact-search plus bounded-detail
  canonical adapter, not `memorix_project_context`.

The primary hypothesis family compares `memorix-1.2.1-canonical-local` with
`no-memory` and `last-n`. Mem0 and AgentMemory comparisons use the same
canonical track and are preregistered secondary baseline comparisons; they are
not silently substituted for either primary contrast.

### Budgeted native Memorix product track

The native product track preserves the bounded MCP interface rather than
pretending it is identical to a pre-injected retrieval block. Its conditions
are:

- `memorix-1.2.1-native-autopilot-local`: the default complete
  `memorix_project_context` Workset, reached through one budgeted native MCP
  call;
- `memorix-1.2.1-selective-local`: the same native Autopilot delivery, but
  with an explicit agent policy to call memory only when prior project evidence
  would materially change its plan.

Predeclared native delivery ablations are:

- `memorix-1.2.1-delivery-no-freshness-local`;
- `memorix-1.2.1-delivery-no-current-state-local`;
- `memorix-1.2.1-delivery-no-semantic-code-local`;
- `memorix-1.2.1-delivery-no-knowledge-local`;
- `memorix-1.2.1-delivery-no-workflow-local`;
- oracle-context, reported only as an upper-bound diagnostic.

Every native condition exposes the same one-tool `micro` MCP discovery
profile. `micro`, `lite`, `team`, and `full` are product tool-discovery
profiles, not independent project-context capability conditions, and are not
compared as such. The five delivery ablations form the same complete Workset,
then suppress only the named agent-facing evidence before the existing bounded
Workset renderer runs. They therefore estimate the contribution of delivered
freshness, current-state, semantic-code, knowledge, or workflow information;
they do not claim to turn off Memorix indexing, storage, retrieval, or
background maintenance internally. Each receipt commits the delivery profile
and the named suppressed components.

These profiles are deliberately interpreted as **delivery bundles**, not proof
that one internal subsystem has a separable causal effect. For example,
withholding current-state evidence also withholds the current-state cautions
that make that evidence safe to use. Primary ablation contrasts are reported
only on preregistered task strata where the named bundle is relevant. We will
not relabel a bundle effect as an isolated graph, workflow, or freshness-module
effect. Any interaction analysis requires a separately preregistered joint
delivery profile, adequate cases in every cell, and is reported as exploratory
unless it was frozen before the first validation run.

Budgeted native contrasts are preregistered product-surface analyses with their
own call/context receipt. They are reported separately from the canonical
primary family. Unrestricted native product use remains exploratory.

Adapters must pass installation, write, read, isolation, and empty-store smoke
checks before experimental runs. A broken adapter is an infrastructure failure,
not a zero score.

### Strong-model control and selective assistance

`no-memory` is not a deliberately weakened agent. It receives the same exact
agent client, reported model route, timeout, editable transfer checkout,
current-source inspection tools, verification commands, and filesystem boundary
as every other condition. It may enumerate, search, read, edit, and test the
current repository normally. Its only missing input is predecessor-session
evidence and any memory tool. A result is invalid if a no-memory run is denied a
normal current-code capability that a memory run received.

The no-memory control is not given a pre-interaction repository. It receives
the same deliberately evolved transfer snapshot as every memory condition,
because recovering the current state from source is part of the real coding
task. Before every agent starts, the harness removes previous Git history,
creates one transfer-snapshot commit, and rejects any tracked, untracked, or
ignored filesystem residue. Thus the current repository is an intended shared
input, while precursor transcripts, memory stores, agent homes, test output,
and prior-run artifacts are not.

This is a boundary over harness-visible local state, not a claim that a model
provider has no opaque cache, hidden service state, or pretraining exposure.
Claude runs additionally disable session persistence and use a disposable
home/config/cache tree; direct-provider public runs likewise use a disposable
local runtime tree. Route receipts can establish reported model identity and
local configuration, but cannot turn an unobservable provider property into a
confirmed absence of memory. Public and confirmatory claims must retain that
limitation.

`memorix-selective` is an exploratory native policy condition, not a claim that
Memorix already has a hidden automatic abstention classifier. MCP is available
under the same one-call native budget as `memorix-native-autopilot`; the agent is instructed
not to call it merely because it exists, and to rely on current source and tests
when they already determine the work. The run receipt records actual memory-tool
attempts, successful calls, and served context. This lets the study measure
whether optional memory use is helpful without manufacturing a benefit by
forcing retrieval.

Before a routed Claude cohort is started, the controller runs an isolated
no-task model-route preflight. It uses a fixed no-tool prompt in a disposable
Git workspace, a separate HOME/config/cache directory, and only the provider
environment keys needed to make the request. Its receipt must bind the client
alias to exactly one provider-reported model and exactly one `modelUsage`
record; an unbound discovery receipt, mixed helper route, missing telemetry,
tool call, changed probe workspace, or disagreement between event-level model
identity and final usage accounting fails the gate. The probe is not a case or
outcome and cannot enter any table. Every task run retains the stricter per-run
exact telemetry check, so a passing preflight never excuses later route drift.

If a provider's default client configuration routes helper roles to different
models, the controller may explicitly configure all Claude role model IDs to
one declared alias for a separate cohort. That process-local override is
recorded in the route receipt and treated as part of the agent configuration;
it never edits a user's normal settings and is never silently pooled with
default-route results. `run-trial --uniform-role-model <alias>` applies the
same isolated override to every task run and records the requested alias in the
per-run environment and condition receipts; it is invalid for non-Claude
trials.

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

Before a real-repository source can move from screening into authoring, two
independent human reviewers who are not the case author must approve a hash-only
admission receipt. It binds the source revision, private transition commitment,
private task brief, and private comparison against public history without
publishing any of those private assets. The reviewers must assess whether the
transition is genuinely new, whether it is materially different from a public
solution, whether predecessor dependency is plausible, and whether current
source could already be sufficient. This is an accountability gate rather than
a claim that anyone can prove an author or model never saw public history; see
`CASE-ADMISSION-REVIEW-CONTRACT.md`.

At confirmatory permit issue, the controller reloads the admitted source entry
and its review receipt, then binds the review's private-transition commitment
to the public case's private-transition commitment. This makes source review a
live execution gate rather than a detached authoring note.

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

RQ0: On low-dependency, no-change, small-repository, or otherwise
current-source-sufficient tasks, a capable no-memory agent may match or exceed
every memory condition. This is a registered validity outcome and does not
justify a general memory-superiority claim.

H1 and H2 are the primary canonical-retrieval hypothesis family. H3 through H5
are separately preregistered secondary product or action analyses and are never
silently pooled into the primary family.

H1: On preregistered medium- or high-dependency stale-transfer cases, complete
Memorix canonical bounded retrieval has higher transfer-task success than no memory.

H2: Complete Memorix canonical bounded retrieval has higher transfer-task success
than last-N transcript replay under an equal retrieved-context token ceiling.

H3: On stale-memory cases, budgeted native Memorix Autopilot delivery produces
fewer stale-memory errors than the native freshness-withheld delivery ablation.

H4: Complete Memorix canonical bounded retrieval reaches the first correct
engineering action earlier than no memory across all valid runs. Runs with no
correct action are right-censored at the frozen task deadline; the analysis
reports completion incidence and a restricted mean time-to-action at that
deadline, rather than conditioning on a post-treatment success subset.

H5: On negative-control tasks with no useful precursor dependency,
memorix-selective has no worse task success than memorix-native-autopilot within the
preregistered harm margin and has fewer unnecessary memory-tool calls or
context intrusions. H5 remains disabled until its product analysis plan freezes
the numerical non-inferiority margin, one-sided alpha, confidence-interval
criterion, and missing-data rule before any product-track outcome is read.

H6: On negative-control tasks, no memory condition is credited as a win merely
because the no-memory agent lacked ordinary current-code inspection or
verification capability.

## 7. Outcomes

Primary outcome:

- task_success: all case-specific required tests pass without forbidden test or
  fixture modification, and every declared source check passes.

Secondary outcomes:

- partial hidden-test pass rate;
- first correct action step and elapsed time;
- handoff success on cross-agent cases;
- relevant evidence precision, recall, and hit rate;
- stale-claim-consistent conflict-action count (the legacy result field remains
  `stale_memory_errors` for schema compatibility);
- negative-control intrusion count;
- memory-tool attempt and successful-call count;
- optional-memory abstention rate and unnecessary-memory-call count on
  preregistered negative controls;
- input, output, retrieved-context, and cached tokens;
- wall time, retrieval latency, and API cost;
- repository exploration breadth before the first correct action.

An action is correct only if it is consistent with the frozen oracle and leads
toward a required change or verification step. Agent clients stream their
machine-readable events into an observed monotonic-time action ledger. A
sanitized ledger preserves action order, time, type, success state, and a
provider-redacted operation summary; raw event logs and memory payloads are not
annotation inputs outside the vault.

For stale-context analysis, a countable episode is not an inferred claim that
memory caused a mistake. It is a frozen, observable action that advances a
behavior explicitly declared stale for the case and conflicts with current
source or the controller oracle. Raters label those action episodes from a
case-specific private rubric; they do not infer the agent's internal cause.

Every run used in C3, C4, or C7 is independently labeled by two blinded human
raters. Matching labels become a consensus; disagreement requires a third,
independent blinded human adjudication. An LLM judge is prohibited. The final
result contains only the final status, numeric outcomes, and commitments to the
packet and labels. `null` means pending or unrateable. A zero stale-error or
intrusion count means it was actually human-rated, not that the harness omitted
the metric. The current public reproducible cohorts do not include a public
blinded-label packet, so they report no conflict-action count; that omission is
never serialized as zero. Their native Memorix hook/MCP work is likewise an
integration diagnostic rather than an outcome comparison. Development may
sample labels to calibrate the rubric, but cannot promote those samples into
confirmatory evidence.

## 8. Randomization and isolation

The unit of pairing is case, agent client, actual provider-reported model,
repetition, and seed. Condition
order is randomized within blocks. Every run receives a fresh repository
checkout, process environment, memory data directory, and artifact directory.
Conditions never share a writable memory store. The host network policy, tool
allowlist, timeout, context budget, and task prompt are identical unless the
condition definition requires a disclosed difference.

The primary analysis plan contains exactly one `agent x actual-model` cohort.
At least two agent/model cohorts are required for a cross-agent claim, but they
are executed and reported as independent replications rather than pooled as if
the same repository transition were multiple independent cases. A different
agent or actual model requires a separate frozen analysis plan, power receipt,
and family result.

Model identifiers, agent versions, system instructions, integration files, and
command lines are pinned and archived. Provider-reported per-model usage is
also archived; a client run that invokes helper models is labelled `mixed`, not
as a pure run of the requested model. A trial may declare a required single
model; it is then invalid unless both the provider-reported model set and
per-model usage contain exactly that one model. Controlled Claude *trials* use
`--bare`, explicit MCP configuration, disabled client auto-memory, a separate
workspace root, and read/edit denials for artifact, home, and source-repository
paths. The development-only real-client hook-capture controller is the explicit
exception: it must omit `--bare` because that mode skips hooks, while retaining
the disposable home/settings directory, narrow tool allowlist, exact-patch
attestation, and one-model route requirement documented in
`NATIVE-SESSION-FORMATION-CONTRACT.md`. Bash is allowed for normal work inside
a disposable checkout, while parent traversal, network, installation,
remote-Git, dynamic-interpreter, and external-path commands are denied or
detected from the archived event stream. Native Windows permission controls are
treated as a mitigation, not as a substitute for this documented
command-contamination audit.

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

### Exploratory 72-hour pilot

The first pilot is a short engineering and research-design gate, not a
confirmatory cohort. It runs four matched conditions where infrastructure allows:
`no-memory`, `last-n`, `memorix-1.2.1-canonical-local`, and
`memorix-1.2.1-selective-local`. The canonical condition deliberately serves
one bounded retrieved-memory block before the agent starts; the selective
condition instead exposes the native Autopilot MCP surface and lets the agent decline
it. They are different product surfaces and are reported separately. All four
keep the same client, actual model route, current repository checkout, ordinary
source and verification permissions, timeout, and base task prompt. The pilot
records task outcomes, tool use, token/cost telemetry when the client reports
it, and failure reasons. It must not be used to choose a favorable primary
endpoint, case subset, or model after outcomes are read.

The pilot targets six new development-only cases: two current-source-sufficient
negative controls, two durable-predecessor handoffs, and two stale-conflict
transfers. Each case declares its expected no-memory solvability before a run.
Each condition runs twice under a frozen per-case condition order, yielding at
most 48 diagnostic runs. Every run archives a clean agent-start tree identity,
agent-start worktree status hash, task-prompt hash, ordinary-tool-policy hash,
full-tool-policy hash, and applicable trace or memory receipt. A mismatch is an
infrastructure exclusion, never a rerun opportunity to select a nicer outcome.

Pilot cases live outside the public registry until they pass the full sealed
task, private-oracle, independent trace, and worker/vault gates. A local run
without those gates is labelled an exploratory diagnostic even when its patch
passes a private test. It may expose runtime defects, prompt ambiguity, stale
retrieval behavior, and the practical rate at which a strong agent declines
memory; it cannot supply a paper effect size or a confirmatory table.

The development pilot is used to estimate runtime variance, discordant binary
pairs, infrastructure failure rate, and annotation cost. It is not used for
confirmatory claims. Before reading confirmatory condition labels, the final
protocol freezes:

- case inclusion and repository split;
- model and agent matrix;
- repetitions and seeds;
- the minimum detectable paired success-rate difference for each primary
  canonical comparison;
- a target of at least 80 percent power for each primary paired comparison;
- exclusion, retry, timeout, and missing-data rules;
- the negative-control harm margin.

A default floor is 50 confirmatory case-model clusters with three repetitions,
but the frozen number must follow recorded, outcome-independent power plans and
available cost budget. Before any confirmatory outcome label is read, the study
records an absolute minimum detectable success-rate difference, a plausible
envelope of paired-discordance rates, alpha, target power, and the cluster
search range for H1 and H2 separately. Each `memorixbench
plan-conservative-power` receipt binds its treatment and control condition; the
H1/H2 plans declare `family_size = 2` and use the conservative Bonferroni
threshold `0.05 / 2`, rather than claiming unmodeled joint power for the later
Holm procedure. The cohort uses the largest cluster count required by either
primary plan and across each plan's declared envelope. The planner assumes
within-cluster correlation of 1.0: it gives no sample-size credit for the three
repetitions and evaluates one effective paired binary outcome per `case x agent
x actual-model` cluster with a two-sided exact McNemar test. Under that
deliberately conservative planning assumption, its non-zero cluster signs match
the final sign-flip test. The final analysis remains the clustered sign-flip
analysis in Section 10.

The controller then writes an immutable `confirmatory-analysis-plan-v1`. It
binds the registry SHA-256, family id and alpha, each H1/H2 condition pair, the
corresponding power-plan SHA-256 and required cluster count, and every planned
`case x agent x actual-model x repetition x seed` row. The initial missing-pair
policy is `fail-closed-v1`: an invalid infrastructure run, missing row, extra
row, duplicate, or incomplete repetition matrix rejects the confirmatory family
analysis rather than allowing silent pairwise deletion. A future replacement or
censoring policy requires a dated schema/protocol amendment before labels are
read.

The development pilot may estimate operational failure rate, annotation cost,
and whether the declared discordance envelope remains physically plausible. It
may not use a favorable observed treatment effect to lower the MDE, select a
favorable envelope point, shrink the cluster count, or stop the confirmatory
cohort. If the declared envelope proves implausible, the correction is a dated
protocol amendment before confirmatory labels are read; it cannot be a silent
recalculation. Stopping early because a result looks positive is prohibited.

## 10. Statistical analysis

The primary analysis unit is a `case x agent x actual-model` cluster, not an
individual retry. Repetitions and seeds estimate stability within that cluster:
each condition's cluster value is its mean task-success rate over its matched
repetitions. H1 (`memorix-1.2.1-canonical-local` versus `no-memory`) and H2
(`memorix-1.2.1-canonical-local` versus `last-n`) form the primary binary
family. Each reports the difference between cluster means, a case-cluster
bootstrap 95 percent confidence interval, and a two-sided paired cluster
sign-flip test; Holm correction controls that two-contrast family at 0.05. A
one-repetition sensitivity analysis may also report exact McNemar results, but
it is not the primary test. The sign-flip enumeration is computationally exact
for its reference distribution, while its inferential interpretation is
conditional on paired cluster differences being sign-exchangeable under the
null; it is not described as a physical condition-label randomization test.
The frozen manifest is validated before either H1/H2 comparison runs, so the
result rows exactly match its registry commitment, power-plan commitments,
single cohort, and repetition matrix. Mem0 and AgentMemory canonical comparisons are
secondary baseline analyses. H4 is a secondary canonical action analysis and
reports its paired interval, p value, and label completeness without changing
the H1/H2 family decision. The frozen native product family contains H3, H5,
and the preregistered delivery-profile contrasts relevant to their declared
task strata; Holm correction controls that family at 0.05 separately. Neither
secondary family is silently pooled with H1/H2.

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
sentinel suite, inspected runtime profile, signed worker attestation bound to
the exact black-box subject protocol, a separate signed model-relay attestation
bound to the job nonce and actual model set, and an independent runtime-manager
attestation bound to the same worker-result hash, reviewed measurement policy,
and isolation/destruction commitments. The worker, relay, and runtime signer
keys must be disjoint. A revalidated confirmatory execution permit and a
redacted grade receipt then bind those three evidence chains to the exact
pinned image.
`RUNTIME-MEASUREMENT-CONTRACT.md` defines the required KVM, microVM, network,
container, and destruction commitments; an opaque isolation hash is not enough.
Client-side Claude/Codex
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
