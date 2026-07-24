# MemorixBench-Transfer

MemorixBench-Transfer is the reproducible research artifact for evaluating
freshness-aware, multi-session project memory in coding agents. It extends the
deterministic Workset tests in the main Memorix repository with downstream
engineering outcomes: whether a fresh agent starts in the right place, avoids
obsolete guidance, and completes a dependent task after project state changes.

This directory is a research program, not a blanket benchmark claim. It keeps
three evidence tiers separate: design and diagnostics, a bounded public
reproducible cohort, and the stricter preregistered confirmatory protocol. A
public cohort can support only its stated fixed-model, fixed-task observations;
confirmatory claims remain locked until independent execution is complete.

## Research tracks

1. Deterministic retrieval checks reuse the existing Workset fixture corpus.
2. Track B seeded retrieval compares memory systems with the same approved
   evidence; it is retrieval parity, not a claim about memory formation.
3. Track C trace replay gives every system the same normalized precursor event
   sequence, records formation receipts, and evaluates a fresh agent on a
   dependent transfer task. A separate Claude Code native-hook formation path
   exercises Memorix's real hook entry point but is reported only as a native
   product/control diagnostic.
4. Stale-memory stress cases change code, dependencies, configuration, or
   project policy between the precursor and transfer phases.
5. Real engineering cases grade patches with isolated tests rather than an LLM
   judge.

## Layout

- PROTOCOL.md: preregistration draft and statistical analysis plan.
- BASELINE_PROTOCOL.md: fair canonical and native memory-baseline contract.
- TRACE-REPLAY-CONTRACT.md: immutable precursor-event format, bounded replay,
  and the Track B/Track C boundary.
- NATIVE-SESSION-FORMATION-CONTRACT.md: portable Claude Code hook capture,
  isolated native formation, and its stricter non-comparison boundary.
- NATIVE-DIAGNOSTIC-EXECUTION-QUEUE.md: frozen policy for local native-product
  diagnostics, kept separate from public and confirmatory evidence.
- LOCAL-AGENT-UX-DIAGNOSTIC.md: one documented Pi Coding Agent usability
  observation and its explicit non-efficacy boundary.

## Baseline runtime gates

Before admitting any trial, run the baseline's own write/read/isolation gate
into a new external artifact directory. These commands do not execute an agent
or create experimental results:

```powershell
uv run memorixbench preflight-baseline-runtime --provider mem0 --output <artifact-dir> --mem0-python <python.exe> --model-cache-root <offline-model-cache>
uv run memorixbench preflight-baseline-runtime --provider agentmemory --output <artifact-dir> --agentmemory-runtime <runtime-dir>
```

The Mem0 command requires an existing offline model cache. The AgentMemory
command uses its pinned official Compose topology, checks persistence across a
restart, and removes its per-run Docker volume during final teardown.

Before spending a cohort on a routed Claude client, bind the requested client
alias to the exact provider-reported model in a separate external artifact
directory. This fixed probe has no case, memory, task, or agent tools; it is a
route gate, not an experimental result. The first discovery run may omit
`--expected-reported-model`, but deliberately exits nonzero and cannot unlock a
cohort. Re-run it with the exact telemetry label to obtain a passing receipt:

```powershell
uv run memorixbench preflight-model-route --output <artifact-dir> --claude-provider-settings <settings.json> --model <client-alias> --expected-reported-model <exact-reported-model>
```

The receipt stores only aggregate model usage and hashes of private client
events. It also records model identifiers by event source, so a mismatch between
an assistant message and final usage accounting fails closed rather than being
mistaken for a one-model run. It never writes provider credential values into
the repository or receipt. Every trial still independently rejects a route
whose actual telemetry does not match its required single model.

This client-side preflight is necessary but not sufficient for a confirmatory
claim. A custom relay can choose its own display labels. Confirmatory execution
therefore additionally requires an independent relay-signed receipt, bound to
the exact worker job nonce, requested alias, actual model set, route-policy
hash, and hashed provider request identifiers. The controller accepts a result
only when that receipt, the worker's client telemetry, and the frozen policy
all agree on one actual model.

When a provider configuration assigns different model IDs to Claude's helper
roles, a controlled experiment may pass `--uniform-role-model <client-alias>`.
That override applies only to the disposable probe process and is recorded in
the receipt; it neither edits a user's settings nor represents the default
client route. A future cohort must use the same declared route configuration.

## Power-plan freeze

The primary unit is a `case x agent x actual-model` cluster, so three repeated
runs do not become three independent samples. Before reading any confirmatory
outcome label, create an immutable planning receipt from values chosen by the
protocol reviewers, not from a favorable pilot effect:

```powershell
uv run memorixbench plan-conservative-power `
  --output <artifact-dir>/power-plan.json `
  --planning-id <frozen-plan-id> `
  --treatment-condition <treatment-condition-id> `
  --control-condition <control-condition-id> `
  --family-size 2 `
  --minimum-detectable-difference <absolute-success-rate-difference> `
  --discordance <first-predeclared-scenario> `
  --discordance <second-predeclared-scenario>
```

The command binds the receipt to one treatment/control comparison, evaluates
exact paired-binary power for each declared discordance scenario, and selects
the largest required cluster count. Its planning model
assumes repeated runs inside a cluster are perfectly correlated, granting no
precision credit for repeats. It is a preregistration artifact, not an
experimental result; the actual primary analysis remains the cluster sign-flip
test in `PROTOCOL.md`.

For the two-comparison H1/H2 canonical family, use `--family-size 2`. The
planner then uses the conservative Bonferroni `0.05 / 2` threshold rather than
pretending it knows the joint power of future Holm-adjusted tests.

## Confirmatory comparison family

After collecting only valid confirmatory rows, calculate the frozen H1/H2
family together instead of reporting whichever pair looks favorable:

```powershell
uv run memorixbench compare-family <results.jsonl> `
  --family-id canonical-primary-v1 `
  --analysis-plan <artifact-dir>/canonical-primary-plan.json `
  --comparison H1:memorix-1.2.1-canonical-local:no-memory `
  --comparison H2:memorix-1.2.1-canonical-local:last-n `
  --output <artifact-dir>/canonical-primary.json
```

The immutable output records the input-file hash, every raw paired comparison,
Holm-adjusted p values, alpha, and whether the run was confirmatory. The
`--allow-development`, `--include-low-dependency`, and `--allow-mixed-models`
overrides are surfaced in that output and label it as development analysis;
they cannot silently create a confirmatory family result.

`memorixbench compare` remains available only with `--allow-development` for a
single diagnostic contrast. It cannot emit a confirmatory comparison because it
does not carry the frozen family matrix.

Validate the frozen manifest before any execution or analysis:

```powershell
uv run memorixbench validate-analysis-plan <artifact-dir>/canonical-primary-plan.json
```

- ANNOTATION-PROTOCOL.md: blinded human action labels, adjudication, and the
  redacted result-summary boundary.
- CLAIMS.md: every intended paper claim and the evidence required to unlock it.
- EVIDENCE-STATUS.md: a reader-facing map of what has been observed, what is
  implemented but not yet measured, and what remains externally gated.
- LITERATURE.md: comparison boundaries for adjacent memory systems and benchmarks.
- RESULTS-PILOT.md: excluded diagnostics and non-confirmatory smoke evidence.
- PILOT-72H.md: the deliberately limited local diagnostic design and its
  decision gates; raw outcomes stay outside the public artifact.
- RETIRED-DEVELOPMENT-CORPUS.md: withdrawal record for unsafe early exercises.
- cases/: public case manifests and case-authoring rules.
- CASE-CANDIDATES.md: researched candidates that are not yet eligible cases.
- CANDIDATE-ADMISSION-PLAN.md: ranked real-repository leads and the no-leak
  author/reviewer pipeline required before any source becomes a case.
- CASE-REGISTRY-CONTRACT.md: frozen corpus inventory, split isolation, and
  dependency/contamination disclosure rules.
- SOURCE-LEDGER-CONTRACT.md: provenance and admission rules for real-repository
  leads that are not yet benchmark cases.
- CASE-ADMISSION-REVIEW-CONTRACT.md: independent human review required before a
  source lead can become an admitted private-transition case.
- AUTOMATED-PRE-ADMISSION-AUDIT-CONTRACT.md: hash, provenance, source-cache,
  and leakage checks that prepare a private design draft for human review but
  cannot issue an admission decision.
- LEGACY-ARTIFACTS.md: pre-snapshot diagnostic artifact boundary.
- PRIVATE-ORACLE-CONTRACT.md: public/private case boundary and the required
  external isolation proof for confirmatory trials.
- RUNTIME-MEASUREMENT-CONTRACT.md: frozen KVM/runtime evidence policy and the
  hash-only per-run receipt signed by an independent runtime manager.
- PUBLIC-ARTIFACT-CONTRACT.md: explicit public-file whitelist, hash manifest,
  and release-boundary audit that excludes private/diagnostic material.
- PUBLIC-REPRODUCIBLE-STUDY-CONTRACT.md: bounded public transfer-study path,
  fixed-model requirements, and its explicit claim boundary.
- public-cohort-plans/: frozen public-evaluation matrices; results must match
  the selected plan exactly before aggregate analysis.
- SEALED-TASK-CONTRACT.md: exactly what is public, worker-visible, and
  controller-only for a future task.
- CONFIRMATORY-EXECUTION-ARCHITECTURE.md: worker/vault separation required
  before a private-oracle result can enter the confirmatory corpus.
- src/memorixbench/: manifest validation and analysis tooling.
- tests/: deterministic tests for the research tooling.
- artifacts/: checksums and public artifact metadata; large local artifacts are ignored.
- results/: final aggregate tables; raw traces and model logs are ignored.
- paper/: the English LaTeX manuscript once verified sources and results exist.

## Local setup

From this directory:

    uv sync --extra dev --extra analysis
    uv run pytest
    uv run memorixbench validate-cases cases
    uv run memorixbench validate-registry cases/REGISTRY.toml cases
    uv run memorixbench validate-public-cohort-plan public-cohort-plans/memorixbench-public-cohort-v1.json --registry cases/REGISTRY.toml --cases-root cases
    uv run memorixbench validate-source-ledger cases/CANDIDATE-SOURCES.toml

## Public reproducible cohort

The public cohort is a separately bounded path. It runs a fixed OpenRouter
model and a safe local tool surface against the frozen public registry; it is
not a substitute for the sealed confirmatory worker. Use one external artifact
root for all three repetitions so the final matrix can be validated together:

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/run-public-cohort-repeat.ps1 `
  -Repetition 1 -Seed 101 -ArtifactRoot <artifact-root>\public-cohort-v1-final `
  -MemorixCli <memorix-cli-index.js> -Mem0Python <mem0-python> `
  -AgentMemoryRuntime <agentmemory-runtime>
pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/run-public-cohort-repeat.ps1 `
  -Repetition 2 -Seed 202 -ArtifactRoot <artifact-root>\public-cohort-v1-final `
  -MemorixCli <memorix-cli-index.js> -Mem0Python <mem0-python> `
  -AgentMemoryRuntime <agentmemory-runtime>
pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/run-public-cohort-repeat.ps1 `
  -Repetition 3 -Seed 303 -ArtifactRoot <artifact-root>\public-cohort-v1-final `
  -MemorixCli <memorix-cli-index.js> -Mem0Python <mem0-python> `
  -AgentMemoryRuntime <agentmemory-runtime>

uv run memorixbench validate-public-cohort-results public-cohort-plans/memorixbench-public-cohort-v1.json `
  --registry cases/REGISTRY.toml --cases-root cases `
  --results-root <artifact-root>\public-cohort-v1-final
uv run memorixbench analyze-public-cohort public-cohort-plans/memorixbench-public-cohort-v1.json `
  --registry cases/REGISTRY.toml --cases-root cases `
  --results-root <artifact-root>\public-cohort-v1-final `
  --output <artifact-root>\public-cohort-v1-final\public-analysis.json
```

The post-result cross-model replication is frozen separately and uses only the
canonical Memorix/no-memory contrast. It needs no baseline runtime arguments:

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/run-public-cohort-repeat.ps1 `
  -Repetition 1 -Seed 101 -ArtifactRoot <artifact-root>\deepseek-r1 `
  -PlanPath public-cohort-plans/memorixbench-public-cross-model-deepseek-v1.json `
  -MemorixCli <memorix-cli-index.js>
```

The runner stops on the first invalid infrastructure row. Preserve and mark
that partial artifact invalid, correct the infrastructure, then restart that
repetition in a fresh artifact root. Do not merge partial repeats.

## Public release build

The public cohort release has a frozen source whitelist and derives case files
only from the registry-bound public bundles. Build a new external staging root
with one command; it creates the manifest, audits the source tree, materializes
only the audited files, runs the materialized self-tests, and audits the staged
tree again:

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/build-public-release.ps1 `
  -ArtifactRoot <artifact-root>\memorixbench-public-release
```

The command never publishes raw model events, runtime logs, private oracle
assets, or source-review working material. The staged release contains the
frozen public summary and can only support the bounded descriptive cohort
claims stated in `PUBLIC-REPRODUCIBLE-STUDY-CONTRACT.md`.

To audit a pre-cloned source cache without allowing a mutable remote checkout:

    uv run memorixbench audit-source-candidate \
      cases/CANDIDATE-SOURCES.toml backoff-permanent-error \
      <artifact-root>/repository-cache/backoff

To convert one private agent event stream into a sanitized Track C trace and
its public receipt:

    uv run memorixbench capture-trace \
      --events <artifact-root>/capture/events.jsonl \
      --timeline <artifact-root>/capture/event-timeline.jsonl \
      --case-id example-case --agent claude \
      --prompt-file <artifact-root>/capture/prompt.txt \
      --output <artifact-root>/capture/trace.json \
      --receipt <artifact-root>/capture/receipt.json \
      --client-version claude-cli-pinned \
      --workspace-snapshot-sha256 <sha256> \
      --workspace-root <artifact-root>/capture/workspace

This produces diagnostic evidence only unless the receipt is bound to the
separate external worker/vault isolation profile.

Local precursor capture is a harness diagnostic, not a way to admit a public
task. It must run from a private controller workspace, retain raw events only
under the configured artifact root, and release at most a separately reviewed
sanitized trace. A local run is always `local-diagnostic-v1`: it cannot be
relabeled as isolated-worker evidence by a CLI flag.

Bundle two or more independently captured traces before a Track C case is
admitted:

    uv run memorixbench build-trace-bundle \
      --case-root cases/validation/example-case --case-id example-case \
      --trace cases/validation/example-case/traces/capture-a.json \
      --receipt cases/validation/example-case/traces/capture-a-receipt.json \
      --trace cases/validation/example-case/traces/capture-b.json \
      --receipt cases/validation/example-case/traces/capture-b-receipt.json \
      --output cases/validation/example-case/trace-bundle.json

After a candidate has been prewarmed in the external artifact root, record the
hash-only offline verification receipt before changing its ledger readiness:

    uv run memorixbench record-environment-preflight \
      cases/CANDIDATE-SOURCES.toml cobra-completion-os-args \
      --bootstrap-command "go test ./..." --bootstrap-exit-code 0 \
      --bootstrap-log <artifact-root>/candidate-preflight/cobra-completion-os-args/bootstrap-go-test.log \
      --offline-command "GOPROXY=off GOSUMDB=off go test ./..." --offline-exit-code 0 \
      --offline-log <artifact-root>/candidate-preflight/cobra-completion-os-args/offline-go-test.log \
      --runtime "go1.25.5 windows-amd64" --offline-policy go-proxy-off-v1 \
      --output cases/preflight/cobra-completion-os-args.json

Raw worktrees, transcripts, patches, model events, and caches must be written to
an external artifact root. Set MEMORIXBENCH_ARTIFACT_ROOT to a drive with enough
space. Do not point experiments at the user's normal Memorix data directory.
Every condition receives an isolated data directory and repository checkout.
Case phase commands scrub an inherited `VIRTUAL_ENV`, so they resolve from the
materialized workspace rather than the research controller's environment.
Explicit external cache configuration such as `UV_CACHE_DIR` remains available,
but must be prewarmed and rechecked: a historical preflight receipt is evidence
of one successful offline run, not proof that a later machine still holds its
cache.

For a native Claude hook capture, freeze the completed precursor workspace into
a clean Git snapshot before converting private hook JSONL. The converter checks
the supplied snapshot hash and rejects a dirty workspace; it will not turn a
live post-edit session into a portable benchmark input.

## Case status

The public registry contains twelve frozen `public-reproducible` local-fixture
cases. The early development corpus was withdrawn because its public surface
leaked answer material; see `RETIRED-DEVELOPMENT-CORPUS.md`. The new public
cases support only the bounded public study contract. New real-repository or
private-overlay authoring still requires the sealed-transition worker/vault
controller and its adversarial isolation preflight before it can create a
confirmatory result.

For a pinned Git source, a local repository cache may replace clone transport
only after MemorixBench verifies the `origin` and exact immutable commit. The
commit fixes content; `origin` remains provenance metadata rather than
cryptographic proof.

## Reproducibility contract

A publishable run must record the case manifest hash, repository revision,
transition hash, condition, agent and model identifiers, seed, command line,
environment lock, container digest when used, token and time accounting, patch
hash, test evidence, and raw event-log checksum. Track C additionally records
the raw and canonical precursor-trace hashes, bounded-view receipt, formation
receipt, and actual retrieval call/round counts. Aggregate tables without that
provenance are exploratory only.

Action timing is captured from streamed client events with an observed monotonic
clock. Raw action/event logs remain in the private run artifact. A worker may
transfer only a sanitized action ledger to the vault, which produces blinded
human annotation packets; final result summaries contain label commitments and
numeric outcomes, never rater identities or private rubric text.

The requested model label is not sufficient provenance. Runs record the
provider-reported per-model token and cost breakdown plus a `single`, `mixed`,
or `unreported` execution profile. A run that uses a helper model is reported
as a mixed client stack rather than as a pure single-model result.

For a confirmatory remote run, the model relay uses a separate OpenSSH signer
file from the worker signer. Its signed aggregate receipt contains no prompt or
response text, but binds the job nonce, route configuration, requested alias,
actual model set, and hashed provider request identifiers. A worker-config hash
or client display name alone cannot substitute for this relay evidence.

Confirmatory execution additionally requires a third, deployment-owned runtime
attestation signer with a key distinct from both worker and relay keys. Its
receipt binds the exact worker result to the reviewed runtime-measurement policy,
pinned image/runtime, inspected container state, relay-only network policy,
isolation measurement, and destruction record. This is an auditable admission
requirement, not a claim that a local machine has already proven KVM isolation.
Validate the private policy/receipt pair with
`memorixbench validate-runtime-measurement <policy.json> <receipt.json>` before
presenting it to the controller; the command emits commitments only.

Baseline adapters must additionally pass their pinned local preflight before an
agent run. See `BASELINE_PROTOCOL.md` for the equal-evidence/equal-budget
retrieval contract and the distinction between canonical and native product
tracks.

The native Memorix product track is itself budgeted by a one-tool MCP gateway;
see `NATIVE-MCP-BUDGET-CONTRACT.md`. It records whether the agent elected to
use Memorix and prevents native tool discovery from turning into unbounded
retrieval rounds.

The native track has one complete Autopilot delivery condition. Its optional
freshness, current-state, semantic-code, knowledge, and workflow comparisons
are explicitly labelled prompt-delivery ablations, not misleading comparisons
between MCP tool-discovery profiles.

Only `public-reproducible` cases are currently eligible to create a public
result row. `development-authoring-v1` is reserved for deterministic maintainer
checks of a new private overlay; it cannot start an agent trial. Development,
validation, and test enrollment remain disabled until a private-oracle overlay
is paired with a passing external agent-isolation certificate for the exact
runtime image. A private black-box subject additionally requires a Linux/KVM
microVM preflight; run
`memorixbench preflight-microvm` on the intended vault host. A host without
KVM refuses private execution rather than falling back to Docker. Claude/Codex
permission rules are defense in depth, never the proof.

Every case declares `dependency_strength` as `low`, `medium`, or `high`, plus
whether the classification is `retrospective-development` or `preregistered`.
Only the latter can support a confirmatory result, and a low-dependency case is
never promoted into a primary memory-effect result merely because an agent
completed it.

The registry also freezes repository, task, and trace family identifiers so a
closely related task cannot leak from development into validation or test. It
requires an explicit contamination disclosure and a four-part dependency card.
These disclosures document the experimental boundary; they do not claim that a
public repository was absent from model pretraining.
