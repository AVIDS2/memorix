# Agent Memory Research Program

Started: 2026-07-20
Baseline: Memorix 1.2.1

## Goal

Build a reproducible study of freshness-aware multi-session project memory for
coding agents: a clean benchmark, fair memory baselines, ablations,
cross-project and cross-model experiments, statistical analysis, a public
artifact, and an English LaTeX paper.

## Governance correction

The first development corpus was independently red-teamed on 2026-07-22. Every
exercise exposed answer material through its public case tree, task wording,
transition, oracle, or precursor record. All early exercises and all associated
local agent runs were withdrawn before any confirmatory analysis. They are
maintainer quarantine material only and cannot appear in benchmark tables,
method selection, or the paper.

The public registry is therefore intentionally empty. This is a research
quality gate, not missing work: a benchmark has no value if the task package
already tells the agent the repair.

## What is now implemented

- A research harness for canonical and native memory tracks, bounded retrieval,
  trace-replay formation, provenance receipts, model-route classification,
  command audit, blinded action annotation, and result validation.
- Source-ledger and offline-preflight tooling for recruiting real repositories
  without treating a public issue or patch as an oracle.
- A sealed-task architecture: public case cards, a private transition and
  oracle overlay, a sealed worker patch, a fresh vault grade workspace, and
  redacted receipts.
- An explicit `development-authoring-v1` mode for deterministic maintainer
  checks. It cannot start an agent run or create an outcome row.
- KVM/worker/vault contracts and adversarial isolation preflight. The current
  workstation and VPS do not satisfy those gates, so no local result is called
  confirmatory.
- A four-condition exploratory runner with a strong no-memory control,
  bounded history, forced canonical Memorix delivery, and optional native
  Memorix MCP. It records the clean transfer tree, task prompt, tool policies,
  memory receipts, and client model telemetry for every run.

## Exploratory diagnostic, not evidence

Three new public-oracle development fixtures were run locally once in each
condition. All twelve valid runs passed their public checks, including all
no-memory runs. Forced retrieval incurred setup and context cost; the optional
native route chose not to call memory in these small, fully inspectable tasks.

This is a productive negative result for product design: current code and tests
should win whenever they are sufficient, and Memorix must earn its context
budget rather than be injected by default. It is not a Memorix effect claim.
The route reported more than one model, the fixtures are intentionally small,
and no private oracle or KVM worker was involved. The raw diagnostic artifacts
remain private and cannot enter a public result table.

Real execution also exposed and fixed four harness issues: overly restrictive
normal inspection permissions, shared client home/temp locations, an unnecessary
Git-root assumption for external fixtures, and recursive result collection over
mutable client caches. The full research test suite passes after those fixes.

## Current blockers

1. Rank source-audited real repositories and author private post-snapshot
   development overlays without reusing public issue/PR solutions.
2. Acquire or provision a KVM-capable worker/vault runtime.
3. Build new cases with fresh ids, private transitions, safe public cards, and
   independently reviewed sanitized predecessor traces.
4. Use a provider route whose telemetry proves one actual model before running
   a comparative cohort.

## Next sequence

1. Red-team prospective cases before they receive a public id.
2. Run isolated, preregistered no-memory screening.
3. Freeze the validation/test corpus and execute the full baseline/ablation
   matrix.
4. Perform statistics, failure analysis, artifact review, and manuscript build.

The detailed protocol and evidence thresholds live in `research/PROTOCOL.md`.

## 2026-07-23 baseline runtime gate

The benchmark now has a first-class `preflight-baseline-runtime` command rather
than relying on one-off maintainer scripts. A fresh offline Mem0 preflight
verified write, close/reopen, scoped retrieval, and an empty foreign scope.
A fresh AgentMemory full-service preflight verified write, scoped retrieval,
restart persistence after its documented settle window, and removal of its
per-run Docker volume at final teardown.

The investigation also found that the pinned official AgentMemory Compose
manifest fixes its port topology at 3111 and related engine ports. The adapter
now rejects alternate ports instead of offering a non-functional option. It
preserves data only for the deliberate restart check and cleans the isolated
volume when the run ends.

These receipts establish baseline runnableness only. They do not create a
case, execute a coding agent, validate a product claim, or relax the human
admission, single-model, or KVM worker/vault gates.

## 2026-07-23 controller and admission binding

The black-box controller now has a concrete transport for an already-connected
remote subject socket. It is intentionally unable to open a connection, start
a subject, or assert KVM isolation. Its job is limited to bounded JSONL
framing, timeout handling, matching request ids, and redacted public receipts;
the local socketpair test exercises that narrow I/O contract only.

The confirmatory permit now reloads the source ledger and the candidate's
approved human review at issue time. It rejects a source/case repository or
base mismatch and rejects a private-transition hash that differs from the one
reviewers examined. The permit carries the ledger file hash, candidate id, and
canonical review payload hash, so the grading boundary can revalidate the same
admission chain. The test fixture is synthetic; no real candidate was promoted
or reviewed by an agent.

## 2026-07-23 delivery-ablation correction

Inspection of the actual product showed that `micro`, `lite`, `team`, and
`full` are MCP tool-discovery profiles. They do not alter the contents formed
by `memorix_project_context`, so comparing them as feature ablations would have
been a false causal claim. No result used that comparison.

The product now has an evaluation-only Workset delivery profile with a default
of `full`. The complete Workset is still formed first. A non-default profile
removes only named agent-facing evidence (freshness warnings, current state,
semantic code, knowledge, or workflow) and then invokes the existing bounded
Workset renderer. This supports an honest delivery-surface question without
claiming that indexing, storage, retrieval, or background maintenance was
disabled. The native one-tool gateway includes the profile and named suppressed
components in its hash-bound `0.2` receipt, rejects an ablation receipt with no
suppression evidence, and the trial controller rejects a receipt whose profile
does not match its predeclared policy.

Product Workset and MCP-handler tests, research gateway/trial tests, and the
TypeScript checker passed. A built-CLI end-to-end MCP smoke used an isolated
F-drive home/data/log root, completed `initialize` and one context call, and
recorded `no-freshness` plus its suppression evidence. It verifies only the
runtime wiring, not agent benefit. A PowerShell smoke-script lesson was also
recorded: `$HOME` is read-only, so all artifact commands use `$sandboxHome` to
avoid accidentally targeting the user's normal home directory.

## 2026-07-23 black-box schema binding

The previous controller carried request and response schema hashes, but a hash
alone did not validate the content arriving on a remote subject socket. The
controller now owns a deliberately small, non-executable schema subset and
checks both sides of every exchange against it. It accepts bounded objects,
arrays, strings, integers, booleans, and nulls only, with no references,
patterns, callbacks, arbitrary JSON Schema keywords, or extra object fields.
The actual canonical schema hashes must match the `SubjectProtocol` before a
session starts. Non-finite JSON constants and nested values past the fixed limit
are rejected. The total controller deadline is now applied to each send and
receive, closing the loophole where many individually valid request timeouts
could overrun the session budget.

The new tests cover normal schema-bound exchange, response-shape rejection,
schema-hash mismatch, and a deliberately slow subject. This is protocol
hardening for the future remote KVM subject, not a claim that an external KVM
worker exists or that private grading is now enabled.

## 2026-07-23 automated methods review follow-up

A local print-mode model was asked for anonymous methodology criticism with no
tools and no project edits. Its text is design feedback only, not an
independent human review, baseline result, or paper evidence. Two findings led
to implementation changes. The agent-start cleanliness check now includes
ignored files in addition to tracked and untracked status, so a leftover test
or build artifact cannot silently act as a prior-session channel. The
confirmatory permit also reloads the environment preflight and human admission
review timestamps and rejects either when it is more than 14 days old or too
far future-dated.

The protocol now clarifies that the Workset profiles estimate entangled
agent-facing delivery bundles; they are not evidence that a single internal
module was independently switched off. It also documents why no-memory retains
the same evolved transfer snapshot: current source is intentionally shared,
whereas history and prior-run residue are removed. Finally, the black-box
session commits exchange timing evidence. The subject starts only after the
agent worker is destroyed, so it cannot affect the agent's memory interaction;
aggregate timings make a later grading-infrastructure imbalance observable.

## 2026-07-23 model-route telemetry gate

The harness now has `memorixbench preflight-model-route`, an intentionally
small, no-task probe for a routed Claude client. It runs one fixed reply-only
prompt in a disposable Git workspace, uses an artifact-local HOME, config,
temp, and cache directory, permits no agent tools, and reads only the required
Anthropic provider environment entries from the supplied settings file. The
receipt records aggregate provider-reported model usage, cleanliness and
completion checks, and hashes of private raw client events. It never copies a
credential value into a receipt or repository file. An unbound discovery probe
is deliberately non-passing; a route must name one expected provider-reported
model and produce exactly one matching usage record to pass.

A real local discovery probe against the current routed Claude client completed
normally with no tool calls and no workspace mutation, but reported a mixed
client stack. It therefore failed exactly as designed. This is neither a
Memorix failure nor a research result: it is evidence that this route cannot be
used in a strict single-model confirmatory cohort. The raw probe remains only
in the external artifact root; no task, memory store, benchmark case, or result
row was created.

The team also tested a process-local uniform-role override without writing the
user's Claude settings. It removed helper-model token use, but the assistant
event and final usage accounting still named different models. The gate remained
closed. The receipt now records only model identifiers and their event sources,
which makes that contradiction auditable without releasing message text or
credentials. A one-record usage total is not treated as sufficient evidence
when another client event identifies a different model.

## 2026-07-23 private source-draft preparation

Three candidate leads now have external private transition/task/comparison
drafts and hash-only admission-review templates: Zod for a potential semantic
metadata-identity handoff, Click for a default-map precedence control, and
urfave/cli for a persistent-flag source-tracking control. The Click and
urfave/cli designs are deliberately current-source-sufficient negative-control
candidates, so a strong no-memory result is expected and useful.

The drafts were created from pinned base source and ledger provenance only; no
public issue, PR, patch, or test was copied into them. Their public ledger
entries now state that a private post-snapshot plan exists, but all remain
`screening`. There are no reviewer findings, no admitted candidates, no public
case cards, no private oracle overlays, no traces, and no agent outcomes. Two
independent humans must review each draft before any authoring promotion.

## 2026-07-23 relay attestation hardening

The current custom Claude route exposed a distinction that the original model
gate did not make explicit: client-side fields can disagree, and a proxy can
control display labels. A client report alone is necessary debugging evidence,
not an independent statement of the actual back-end model.

`memorixbench.model_relay` now defines a separate, relay-signed, short-lived
receipt. It contains no prompt, completion, credential, or raw provider request
ID. Instead it binds the relay policy hash, route id, requested alias, exactly
one actual model, aggregate request count, hashed provider request identifiers,
and the exact run/job/nonce. The confirmatory permit schema now requires this
signature from a signer file distinct from the worker-signing file, then rejects
the run unless the worker's own reported models and per-model usage agree with
the relay's actual model. Tests generate independent temporary OpenSSH keys and
exercise valid, mixed, tampered, and shared-trust-file failure paths.

No relay exists yet for this study, and the current personal proxy is not
reclassified as trusted. This is deliberate fail-closed preparation: it makes
an unsupported claim impossible to admit rather than merely discouraging it in
documentation.

## 2026-07-23 conservative power-plan freeze

The previous protocol named a 50-cluster floor and 80 percent power goal but
did not make the planning calculation reproducible. The research package now
has `memorixbench plan-conservative-power`. It takes a predeclared absolute
minimum detectable success-rate difference plus one or more paired-discordance
scenarios, calculates exact two-sided McNemar power at each candidate cluster
count, and selects the largest adequate count across the scenario envelope.

The planning unit is deliberately one effective paired binary observation per
`case x agent x actual-model` cluster. Although the design keeps repeated runs
for stability, the planner assumes their within-cluster correlation is 1.0 and
gives them no sample-size credit. Under that assumption the non-zero signs are
the same ones used by the primary cluster sign-flip analysis. The planner is
therefore an auditable conservative design gate, not a replacement for the
final clustered analysis.

A synthetic F-drive smoke used hypothetical values only and generated a
hash-bound `planning-only-not-an-experimental-result` receipt. It confirms the
CLI and immutable-output behavior. It does not freeze an MDE, a discordance
envelope, a cohort size, or any research conclusion. Those values must be
chosen before confirmatory labels are read and recorded as a protocol decision;
a favorable pilot effect is explicitly forbidden from shrinking the cohort.

## 2026-07-23 claim-surface reconciliation

A local consistency pass found that the protocol and manuscript correctly name
equal-evidence canonical bounded retrieval as the primary cross-provider
surface, while the claim ledger had called C1 a native-Autopilot claim. That
would have blurred two deliberately separate interventions. C1 now covers only
the canonical primary comparison. The one-call native-Autopilot MCP surface
remains a separately budgeted product track with its own receipt and is never
silently pooled into the primary estimate.

The follow-up protocol pass found the same old terminology in the condition
list, hypotheses, and a second claim. Those locations now name the executable
canonical provider IDs and clearly assign H1/H2 and C1/C2 to the canonical
primary family: Memorix canonical retrieval versus no memory and bounded raw
replay. Mem0 and AgentMemory are secondary canonical baseline comparisons.
Budgeted native Autopilot and its delivery/selective-use contrasts are a
separate preregistered product family, while unrestricted native use stays
exploratory. This is a design correction before any confirmatory result exists,
not a change to a reported outcome.

## 2026-07-23 execution and analysis-chain audit follow-up

Two read-only internal reviews examined the confirmatory path and the
statistical preregistration boundary. They are engineering feedback only: they
do not count as independent human admission review, baseline evidence, or an
experimental result. The reviews found that a worker's client telemetry had not
been cryptographically tied to the relay receipt, a permit could be replayed
through a new permit hash, runtime inputs were not committed, a staged patch
could be incompletely captured, and the statistical plan did not force a frozen
cohort or account conservatively for the H1/H2 Holm family.

The local harness now closes those code paths. A worker result has a canonical
hash that both the worker attestation and the relay attestation must bind. The
permit compares the signed relay inventory, provider-request-id commitment, and
input/output token totals with the signed worker result. It also requires an
exact runtime-config commitment, one-time `(job_sha256, job_nonce)` redemption,
disjoint worker/relay public-key fingerprints, and a controller-pinned absolute
`ssh-keygen` binary hash. Sealed patches are captured against the starting Git
HEAD, reject post-run ignored residue or a changed HEAD, and are reconstructed
by a fresh vault checkout to the committed final-tree hash. Socket receipts now
say explicitly that controller transport does not attest KVM isolation.

The statistical path now uses provider-reported actual model identity rather
than a client alias, rejects pooled multi-agent/model confirmatory cohorts, and
strictly parses `valid_run`. `plan-conservative-power` records family size and
uses a Bonferroni-conservative threshold for a future Holm family. A new frozen
analysis manifest binds registry, power receipts, conditions, one cohort, and
every planned pair; `compare-family` requires it for confirmatory output, while
the old single-comparison command is diagnostic-only. H4 now uses all valid
runs with right-censoring rather than a post-success subset. H5 cannot run
until a numerical non-inferiority rule is frozen.

The complete research suite, empty registry/source-ledger validation, CLI
surfaces, LaTeX manuscript, and diff check passed after these changes. This
does not create a confirmatory case or result. KVM hardware, a trusted remote
runner/relay, independent human case review, and the newly authored corpus are
still external gates.

## 2026-07-23 independent runtime-attestation gate

The preceding audit also identified a trust-boundary gap: a signed worker
receipt can describe its own runtime, but it cannot by itself establish that an
independent operator observed the requested remote isolation profile. The
harness now has `memorixbench.runtime_attestation`, a third OpenSSH-signed
receipt from a deployment/runtime-manager trust root. It binds the exact worker
job nonce and result hash to the controller policy, a reviewed runtime
measurement policy, the pinned runtime and image, container-inspection hash,
relay-only network policy, isolation-measurement commitment, and destruction
receipt.

`ControllerTrustPolicy` now requires three distinct signer files whose actual
public-key fingerprints are pairwise disjoint. A confirmatory permit validates
the worker, relay, and runtime receipts against the same job/result, records
the runtime measurement and destruction commitments, and rejects any altered
runtime statement. Temporary-key OpenSSH round-trip, policy-isolation, and
tamper tests passed as part of the complete research suite.

This changes the admission contract, not the evidence state. There is still no
provisioned KVM-capable remote runner, no deployment-owned runtime manager key,
and no per-run measurement artifact. The new path deliberately rejects such a
run instead of allowing a local or worker-self-reported substitute.

## 2026-07-23 parsed runtime-measurement receipt

The first runtime-attestation implementation still accepted a policy hash and
isolation hash as opaque strings. That was enough to bind a signer statement,
but not enough to make the claimed evidence set inspectable. The harness now
defines `runtime-measurement-policy-v1` and
`runtime-measurement-receipt-v1`. The supported v1 policy requires exactly five
private commitments: agent-container inspection, KVM host capability, microVM
runtime, relay-only network egress, and worker destruction.

Each receipt is fresh, policy-bound, and bound to the exact run, job hash,
nonce, worker-result hash, network policy, and destruction receipt. Its
canonical hash must equal the isolation-measurement hash in the independently
signed runtime statement. The permit rejects a missing, stale, malformed, or
altered receipt even when its individual fields still look plausible.

`memorixbench validate-runtime-measurement` provides a small operator-facing
check that parses a private policy/receipt pair and prints only commitments and
stable identifiers. Full regression, source-ledger/empty-registry validation,
diff check, and the four-page LaTeX manuscript compile passed after this change.
No production runtime policy, receipt, remote KVM runner, or result row was
created by this work.

## 2026-07-23 public-artifact release boundary

The release process previously relied on documentation and per-file safety
checks, but had no reproducible answer to the question "which exact files were
reviewed for public release?" `memorixbench.public_artifact` now builds a
versioned whitelist manifest. It accepts only explicitly named relative UTF-8
text files below a declared release root, rejects private/cache/result paths,
symlinks/reparse points, binary data, credential-like text, and absolute host
paths, and records a category, byte count, and SHA-256 for every file.

The paired audit command rereads and rescans the selected tree, then rejects any
byte/hash drift. It prints only commitments, never a local root path. A real
six-file design-material smoke was written to external staging and audited
against the live research worktree. It includes protocol/contract/manuscript
source only; it contains no benchmark case, private artifact, raw model event,
or outcome result.

This is a release-boundary tool, not a publishing claim. It cannot make a
design-only artifact confirmatory, and future summary releases remain subject to
the source, KVM/runtime, relay, registry, frozen-analysis, and independent
artifact-review gates.

## 2026-07-23 related-work novelty correction

A fresh primary-source literature sweep found three close 2025--2026 neighbors
that the initial related-work draft did not name. EvoArena/EvoMem evaluates
progressive environment updates, including software, with a patch-based memory
representation. SWE-EVO evaluates multi-file long-horizon software evolution,
and ChainSWE evaluates chronological dependent bug-fix chains. These works do
not automatically implement the same protocol, but they make broad claims such
as "first dynamic-memory benchmark" or "first evolving-code benchmark"
indefensible.

The reading matrix, paper references, related-work section, and introduction
now say the narrower claim plainly: MemorixBench-Transfer tests a fresh agent
after a sealed repository transition while preserving identical current-code
capabilities and varying only bounded predecessor evidence. It uses equal
canonical memory evidence, a separately reported native product surface, stale
guidance outcomes, and fail-closed provenance/oracle execution. This is a
protocol/artifact contribution contingent on future confirmatory evidence, not
a claim that earlier work did not study dynamic environments or software
maintenance.

The updated bibliography was regenerated from arXiv metadata and the manuscript
was built through BibTeX plus the required LaTeX passes with all new citations
resolved. The manuscript remains a design-stage protocol paper with no efficacy
table or effect estimate.

## 2026-07-23 independent execution/release audit follow-up

A separate read-only code audit reviewed the new worker/relay/runtime evidence
and public-artifact paths. It found three immediate high-risk gaps: the claimed
worker final-tree hash was recorded but not reconstructed at redemption, a
`confirmatory-summary` artifact label was syntactically selectable without its
evidence gates, and a Windows hard link could make an allowed release path alias
an external file. It also found the runtime signature lacked a strict persisted
JSON loader.

The permit ledger now validates live inputs, reconstructs the sealed patch in a
fresh disposable public checkout, verifies the worker baseline and final-tree
commitments, and only then records one-time redemption. Tests cover an actual
Git patch whose false final-tree hash is rejected. The unimplemented
confirmatory artifact tier was removed rather than cosmetically guarded; public
artifact inputs reject hard links, and a materializer creates an empty staging
tree containing only audited files. The runtime attestation now has strict
payload parsing, signature-digest validation, and reparse-safe file loading.

The audit also identified two genuine deployment-level residuals. Typed hashes
and a runtime signature still depend on a separately trusted runtime manager
and private evidence store; they do not prove physical KVM isolation by
themselves. Signer files and the pinned `ssh-keygen` path also need an immutable
controller deployment or read-only mount to close file-replacement races. These
are retained as hard external gates, not relabeled as solved by the local test
suite. The audit was engineering feedback only, never human case review or
experimental evidence.

One follow-up inspection found a related concrete patch-file issue before final
grading: reconstruction used the `SealedPatch.path` directly after checking the
permit's original hash. The vault now creates a new temporary snapshot with
`snapshot_sealed_patch`, rechecks byte count and SHA-256, and applies only that
snapshot. A regression test mutates the patch file after sealing and confirms
that reconstruction rejects it before touching the candidate tree.

## 2026-07-23 reproducible public-agent execution path

The strongest private-oracle/KVM protocol remains useful for a future audited
cohort, but it is not a prerequisite for every empirical observation. The
research harness now also has an explicitly weaker, public reproducibility
path: an OpenRouter-backed coding agent whose model id is selected by the
controller and recorded from the provider response. This path is not allowed to
claim private-task isolation, hidden-test security, model-pretraining novelty,
or broad confirmatory generalization.

The agent does not receive arbitrary shell or ambient host access. It can list,
read, literal-search, diff, and write files only below per-case writable source
roots. It can run only a numbered command already declared by the case manifest.
The runner scrubs provider credentials from subprocesses, rejects parent paths,
reparse points, binary patch payloads, test/config writes outside the declared
roots, and oversized file/tool payloads. Its event stream produces the same
hash-bound action ledger used elsewhere in the harness. Local-fixture
materialization and public case snapshots also ignore only reproducible Python
and pytest cache directories, preventing a maintainer's local test run from
turning into binary benchmark drift.

A real end-to-end development smoke used
`qwen/qwen3-coder-30b-a3b-instruct` through OpenRouter on one small public
Python transfer fixture. The provider reported exactly that model for both
conditions. With no memory and with one 249-token Memorix canonical retrieval,
both runs made a source-only patch and passed the trusted unit test. The former
used 19 tool calls, 96.5 seconds, and 95,155 input tokens; the latter used 6,
28.5 seconds, and 13,215 input tokens. These numbers are retained as a harness
smoke and product signal only. One fixture, one run per condition, a public
oracle, and a development split cannot estimate an effect size or support a
paper ranking.

## 2026-07-23 frozen public reproducible cohort

The public v1 cohort is now a completed, bounded empirical artifact. It used
the frozen 12-case registry, four canonical conditions (no memory, Mem0,
AgentMemory, and Memorix), three planned seeds, the OpenRouter bounded coding
agent, and the exact provider-reported
`qwen/qwen3-coder-30b-a3b-instruct` model. All 144 planned rows were produced
and validated. The matrix has zero invalid infrastructure rows, one tool-policy
hash, and no case/oracle definition drift across conditions.

The primary result is deliberately modest: canonical Memorix reached 97.2%
case-clustered success versus 94.4% for no memory (+2.8 points; 95% interval
[-8.3, 16.7]; descriptive sign-flip p=1.0). Memorix also averaged fewer input
tokens, cost, wall time, output tokens, and tool calls, but every resource
interval crosses zero. The cohort is not evidence of a general, reliable
performance gain. Mem0 and AgentMemory have the same descriptive 94.4% and
97.2% success rates respectively; their comparisons are secondary context.

All six failures reached the fixed 24-tool limit. The public header-policy
transfer favored Memorix (three successes versus one for no memory), whereas
the Go slug transfer included one Memorix failure despite three no-memory
successes. Those counterexamples are retained in the paper and analysis
receipt. They motivate the next phase: harder, independently reviewed real
repository transfers and cross-model replications rather than rewriting the
fixtures after observing outcomes.

Three early partial execution artifacts remain explicitly invalidated: one
before the Windows Go cache fix, one with a missing runner argument, and one
before the AgentMemory startup-disconnect retry. The final cohort began only
after the complete research test suite and baseline runtime preflights passed.
The manuscript now includes a public results section, compiles successfully,
and was rendered for layout inspection. It remains non-confirmatory until the
separate KVM, remote relay/runtime manager, and independent human-review gates
are satisfied.

## 2026-07-23 cross-model replication and public release audit

After the original Qwen public cohort was analyzed, a separate DeepSeek plan
was frozen before any DeepSeek cohort outcome was read. It retained the 12
public cases, three fixed seeds, the bounded tool policy, and the canonical
Memorix/no-memory contrast, but deliberately did not rerun secondary baseline
systems. A one-case direct provider route preflight recorded exactly
`deepseek/deepseek-v4-flash`; it is excluded from the replication matrix.

Three isolated repeat roots then completed all 72 planned rows. The frozen
validator accepted every row with a single provider-reported model and the same
tool-policy hash. All no-memory and canonical Memorix runs passed, producing a
zero success-rate difference. Canonical Memorix added approximately 2,206 input
tokens and 0.000174 provider cost per case cluster, with descriptive cluster
intervals excluding zero. The result is intentionally preserved as a negative
boundary: on these fully public, all-solvable fixtures the DeepSeek agent had no
accuracy headroom, so memory did not earn its added context cost. It is a
separate model cohort, not extra samples pooled into the original Qwen result.

The public artifact builder was also hardened after a real staging check found
that a test command could create an unlisted virtual environment inside a
materialized release. Exact-tree audit now rejects all unlisted files and
reparse points. The release script places its test environment outside the
staging tree, disables bytecode/cache output there, runs materialized self-tests,
and re-audits the exact staged tree. A new 128-file public summary release built
and audited successfully.

Zod, Click, and urfave/cli source caches were independently re-audited against
their ledger entries: origin, fixed public-parent commit, and license bytes all
matched. This does not move any source past `screening`. The configured VPS was
checked read-only and exposes Docker but no usable KVM device, so it cannot
satisfy the future worker/vault isolation requirement. No private draft was run
against an agent and no local Docker result was relabeled as confirmatory.

## 2026-07-23 final public-artifact verification

One fresh v2 materialization generated manifest
`f39b1662b1ec5c4418e94df931be1b918257eac8e198d365efd1bdc25beceadd` with
128 whitelisted entries. The source-tree audit, isolated materialized public
self-test, and exact staged-tree audit all passed. Independently, the complete
research test suite passed, the LaTeX manuscript was current and compiled under
the documented build path, and the repository diff passed whitespace checks.

This is intentionally an internal reproducibility closure, not a fabricated
confirmatory result. The paper and `research/SUBMISSION-READINESS.md` continue
to name the missing human-review, real-repository, trusted-relay, and KVM
evidence gates.

## 2026-07-23 native Claude hook formation

The previous benchmark harness could replay normalized precursor traces but
could not establish that Memorix's actual hook entry point could form state
from a native client event without silently calling that replay. A new
`native-hook-capture-v1` path now receives private Claude Code hook JSONL,
removes transcript paths, permits only workspace-contained path values, and
replaces those values with a portable workspace token. The converter requires
the session's completed precursor workspace to be clean and to match the
declared snapshot hash. It fails instead of producing a capture when the
workspace is dirty, mismatched, unsafe, or contains a path outside its root.

The formation adapter rehydrates the token in a new clean Git checkout and
invokes the real Memorix CLI hook process for every event. It uses isolated
storage and user-profile directories and then independently searches for a
declared marker.
The receipt commits the portable capture identity, ordered event count, hashed
hook-event audit, and storage-probe result count. Trial validation now records
native capture identities and rejects mixes of `native-session` and
`trace-replay` evidence. Native formation permits only no-memory and Memorix
conditions; it cannot provide an unfair native-write shortcut to Mem0,
AgentMemory, or `last-n`.

A controlled local Claude Code session made one constrained file edit under a
temporary settings file. Its actual `PostToolUse` payload reached an external
forwarder, the normal Memorix hook stored a searchable observation, and the
captured payload was converted and replayed in a fresh matching clone. This
is a product integration smoke, not a task-outcome experiment or a benchmark
result. The raw event, transient settings, client output, and data directories
remain external and are excluded from public release material.

## 2026-07-24 real-source environment gate and invalid client probes

The Go `backoff-permanent-error` lead was checked against its audited base
revision. The older local cache was a promisor checkout: although its commit
and tree identities were auditable, a fresh local clone attempted an implicit
object fetch. A new complete external checkout avoided that ambiguity. A
focused unrelated test passed both normally and under disabled Go proxy and sum
database settings, producing the source-ledger's new hash-only preflight
receipt. The historical `TestIssue177` failure at the base remains the task
oracle and is not an environment-health test. This only changes environment
readiness from unverified to offline-ready; it does not admit the source.

An exploratory direct-client predecessor capture was also attempted solely to
exercise the native hook path on a real Go repository. One attempt was invalid
because a temporary PowerShell forwarder corrupted non-ASCII stdin. The
replacement reusable forwarder reads and writes UTF-8 bytes explicitly, and a
separate smoke confirms JSON parseability, non-ASCII preservation, and
searchable storage. A later client attempt exhausted its local budget before a
final response and exposed an inherited global MCP tool attempt. It generated
no usable capture or result. Both attempts remain outside all evaluation data;
the controlled benchmark launcher already uses strict MCP configuration and is
not represented by that manual client environment.

## 2026-07-23 final public-artifact audit

After binding the new backoff preflight receipt, the ledger tests were made
explicit about which screening source lacks offline readiness and about copying
existing receipts into temporary-ledger tests. The full research suite then
passed. The manuscript was compiled with `pdflatex` because this Windows MiKTeX
installation lacks the Perl engine required by `latexmk`; it produced a
warning-free six-page PDF whose pages were visually inspected.

The final external public release build materialized 132 allowlisted files with
manifest SHA-256
`07b9704ee6db90ded38b22162fe267ab29981fe5471eef153e3d6ce26b02408d`.
The source audit, isolated materialized public-test run, and exact-tree audit
all passed. This remains a public reproducibility artifact, not a release of
private hook events, client settings, private-oracle material, or confirmatory
outcomes.

## 2026-07-23 isolated Claude Code route probe

Claude Code 2.1.201 was probed from an external artifact directory with safe
mode, a strict empty MCP map, no tools, and no persisted session. It returned a
fixed response and did not load project instructions, hooks, plugins, or MCP
tools; no user configuration was modified. That validates a narrow isolated
client startup path for ordinary product diagnostics. The provider telemetry
still named both the DeepSeek Flash route and a Claude Haiku helper model in one
request. The probe is not a trial, precursor, or result row, but it reaffirms
that this routed client cannot satisfy the confirmatory single-actual-model
requirement.

## 2026-07-23 bibliography and final artifact rebuild

The manuscript's nine arXiv citations were checked against official Atom
metadata and paper pages. Titles, author order, and years match the BibTeX
entries. A final related-work citation now points to OpenAI's official
SWE-bench Verified contamination audit, limiting the public-history argument
to what that source supports. The bibliography was rebuilt with BibTeX and the
six-page rendered output was re-inspected without undefined references,
overfull/underfull boxes, or layout problems.

Because the citation sources are included in the public release whitelist, a
fresh final staging run superseded the previous manifest. The current
132-entry public release manifest is
`a273c7e0d18490792fa27b3fd7db7b792b654836e845ca1e8ebcd11929e3fafc`.
It passed source audit, isolated materialized public tests, and exact-tree
audit. The earlier 132-entry manifest remains only a chronological staging
artifact, not the current candidate release.

## 2026-07-23 automated manuscript review follow-up

A local Claude Code session in safe mode, strict empty-MCP mode, read-only tool
mode, and no-persistence mode reviewed only the paper source. Its text is
automated feedback, not an independent human review, research evidence, or a
provider/model cohort. It correctly identified two non-removable positioning
risks: the current paper is a protocol plus a small public reproducibility
study, and twelve public fixtures cannot establish a reliable efficacy effect.
Those points remain explicit rather than being softened.

The actionable follow-up was narrow. The abstract now states the protocol/
reproducibility scope; the public-cohort and limitation sections state the
twelve-cluster sensitivity boundary and ceiling replication; the manuscript and
protocol distinguish isolated local run state from opaque provider state; and
they say explicitly that stale-conflict labels and budgeted native-MCP outcomes
are absent rather than counted as zero. The generic bibliography style changed
from `plain` to `abbrv`, preserving the full author lists while fitting the
complete reference list and revised limitations into a clean six-page PDF.

## 2026-07-23 final-review public release

The final full-suite, paper-log, and diff checks passed after the manuscript
boundary changes. A fresh external public materialization produced the current
132-entry candidate manifest:
`2f930c2fb23b0c14c9dd0f9fddc929183406202cd8ca80968fd5e37aa2cf0585`.
The source whitelist audit, clean materialized public test run, and exact-tree
audit passed. It supersedes prior staging manifests and is suitable for
external protocol/artifact review only; it does not convert the unexecuted
confirmatory study into an effectiveness claim.

## 2026-07-24 anonymous NIER package

The project now has a distinct anonymous IEEE NIER candidate in
`research/paper-icse-nier/`, rather than relabeling the six-page protocol paper
as a venue-ready effectiveness manuscript. It frames the contribution narrowly
and truthfully: an executable fail-closed evaluation design for fresh-agent
project memory, plus mixed public reproducibility observations. It adds the
primary-outcome/resource boundary, matrix rejection semantics, threats to
validity, artifact contract, and a detailed future confirmatory sequence.

The final candidate PDF is four pages. It has an anonymous author and PDF
metadata, passed strict `chktex`, bibliography consistency, the documented
four-step LaTeX recipe, and manual page rendering. Its review-stage archive was
built outside the repository from a fresh public materialization: 132
allowlisted supplementary files passed five materialized public tests and an
exact-tree audit. The staging script removes the one project-identifying
request header only in the review copy, then asserts no Git metadata, reparse
points, local paths, credentials, or project identity strings remain. The final
staged manuscript matches the local PDF hash.

This closes the internally controllable NIER manuscript/package work. It does
not record a submission, independent artifact review, or paper acceptance. Nor
does it remove the larger research gates: independently reviewed private
real-repository cases, a single-actual-model trusted route, KVM-backed
controller/worker/vault evidence, and cross-project confirmatory replication.

## 2026-07-24 single-model native gate and final local package refresh

An isolated no-tool Claude Code route probe was repeated with all three Claude
role aliases overridden only in the experiment child process. It reported one
actual `deepseek-v4-flash` model in both event and usage telemetry, used no
tools, and left its disposable workspace clean. This does not alter the user's
normal Claude configuration, and it is not a trusted relay or confirmatory
route certificate.

The trial harness now accepts `--uniform-role-model` for Claude only. It applies
the same process-local role override to each task run and records it in the
condition/environment receipts. The native diagnostic launcher runs the same
route preflight immediately before a task and refuses to start one when the
route is mixed, unbound, or otherwise invalid. A new frozen native diagnostic
queue specifies negative-control, durable-handoff, and stale-conflict rows, but
intentionally has no newly admitted case yet; old diagnostic fixtures are not
retroactively promoted after their outcomes were seen.

The public artifact and anonymous NIER package were then rebuilt from the
latest sources. The current materialized supplement contains 135 allowlisted
files, passes its five public tests and exact-tree audit, and the anonymous ZIP
contains no Git metadata, reparse points, local identity strings, or credential
values. The staged anonymous manuscript is a four-page PDF with anonymous
metadata and the same SHA-256 as the locally compiled PDF. This is still a
local upload candidate only, not a submission, review, or publication record.

## 2026-07-24 automated private-draft pre-review

Added `memorixbench audit-private-draft`, a strict mechanical pre-review gate
for a private real-repository draft and its pinned local source cache. The gate
validates the source ledger and offline receipt, cache origin/first-parent/
license bytes, the exact four-file private bundle, the admission-draft's three
commitments, and path/credential safety. It emits only hashes and public source
audit facts. Its immutable output says `automated-pre-review-only-v1` and
`admission_decision = not-issued`, so no script or automated reviewer can mark
a candidate admitted.

The real Zod, Click, and urfave/cli private drafts each passed this pre-review
against their external caches. The receipts live under
`<external-artifact-root>/pre-admission-audits-20260724-094436`; all
three candidates remain `screening` and require independent human review,
overlap review, case/oracle authoring, independent precursor traces, and an
isolated confirmatory permit. Full tests then passed and a fresh 138-entry
public release (`02558ff7e1746660ad866fb0911099ea5d7fa49f9c0e4faa0854e35120442a0d`)
passed source/materialized/exact-tree checks. The anonymous supplement must be
rebuilt from this latest public release before any upload is considered.

## 2026-07-24 refreshed anonymous NIER candidate

Rebuilt the anonymous local candidate from the current 138-entry public source
release at
`<external-artifact-root>/icse-nier-anonymous-review-20260724-pre-admission-final`.
The source release manifest is
`075e1f14a95b93fcfa2e3ecf726c9f1a507ae3dbdd788a865e0472d71a799191`; the
neutralized supplement passed its five public tests and exact-tree audit. Direct
checks confirmed a four-page PDF with `Anonymous Authors` metadata and the same
SHA-256 as the local paper, and found no project identity or private-draft
feature terms in the supplement. This refresh is still a local submission
candidate, never evidence of venue upload, external review, or acceptance.

## 2026-07-24 author-side public-history surface triage

Performed a post-commit, non-decision author screen using only public changed
file names and function headers. Zod's public parse/codec surface and
urfave/cli's public completion surface appear distinct from their drafts'
declared high-level topics, but neither result proves novelty or handoff need.
Click's public transition also changes `src/click/core.py`, the same broad
module family likely involved in default-map behavior. It remains only a
no-memory-favorable control and now carries an explicit heightened-review note.
The source ledger stays unchanged: all three candidates are still screening,
their overlap labels are still unreviewed, and this screen created no case or
experimental result.

## 2026-07-24 literature refresh and final anonymous-package preparation

Refreshed related work with Agent Workflow Memory, an adjacent study of
induced and selectively retrieved reusable workflows for web-navigation. The
papers now state the boundary directly: that work is relevant to reusable
agent state, but it does not answer whether freshness-aware predecessor
evidence changes a coding agent's checked patch after repository evolution.
No result, baseline, or efficacy claim was added.

Both bibliography checks pass. The anonymous NIER candidate rebuilt to four
pages; manual rendering of its first and final pages confirmed anonymous
metadata, complete tables and references, and intact two-column flow. The
longer protocol paper rebuilt to seven pages after the related-work addition,
with no undefined citations or box-overflow warnings. The prior anonymous
archive is therefore historical only; a new package will be materialized from
the updated sources before any upload candidate is considered.

## 2026-07-24 final anonymous NIER artifact verification

Materialized the final anonymous candidate from the updated 138-entry public
release. The public-release digest is
`32471a04ad8282ceb11eefea452e8650bac07cc3295ad15971fba386cc5d5a2a`, the
neutralized supplement digest is
`b493bbc62a2a71f8ee47b9683ddb9862d405177574a4f0d876f8f798b82f402c`, and
the archive digest is
`9bc0cdcd468be67be2be03eb1333d26295fc144c914c122f0d659e3385f0b2a6`.
The staged four-page PDF exactly matches the local PDF at
`96714a12a0e95b0b7d2dffbf6b60a226b5fdafb1093c168c47e81401190582f9`
and has `Anonymous Authors` metadata.

Independent package checks found no Git metadata, reparse points, credentials,
project identity text, private draft files, or host-specific path markers.
Generic references to private-oracle and admission governance remain in the
public protocol because they define the method's fail-closed boundary; they do
not include a private case, transition, oracle, or answer. The supplement's
five materialized public tests and exact-tree audit passed, as did the full
research suite and whitespace/diff check. This is a verified local upload
candidate only, never a recorded venue submission, review, or acceptance.

## 2026-07-24 evidence boundary and clean package refresh

Added a public `EVIDENCE-STATUS.md` page to make the evidence hierarchy visible
at the artifact entry point: bounded public observations, tested mechanisms
without task outcomes, unexecuted protocol work, and external claim gates. It
records the inconclusive 144-row Qwen cohort, the 72-row DeepSeek ceiling/cost
replication, and the fact that no C1--C8 product-effect claim is currently
proven. The frozen release whitelist and public-release test now require this
page, preventing a later package from silently omitting the boundary.

The product tool-profile integration tests now isolate `MEMORIX_DATA_DIR` in a
fresh temporary directory and restore the caller environment after each test.
This removes a local-test side effect without changing product runtime
behavior.

A new 139-entry anonymous candidate was materialized under
`<external-artifact-root>/icse-nier-anonymous-review-20260724-evidence-status-verified`.
The source manifest, neutralized supplement manifest, package manifest, and
archive hashes are `40d1df4a2363a06cf6628492f7f0142b10b842a7bc41e7ac63fab782075e96fc`,
`9b67c23c8aa66ed21541f4463818f9c64083b7e478ab20a485223f0e152508b2`,
`add5bc27831a824c3651559e61d01066aa6115f8197763c90c1aab2838e557db`, and
`96bfade47917b79803dac454dfe7de1c048c99ce316d1db82ecc735801e3d49e`.
It passed the materialized public tests and exact-tree audit, then a separate
read-only manifest/hash/tree/identity/archive audit. The staged manuscript has
four pages, `Anonymous Authors` metadata, and visually checked first/final
pages. It remains a local candidate, not a venue submission, external review,
or acceptance.
