# MemorixBench-Transfer

MemorixBench-Transfer is the reproducible research artifact for evaluating
freshness-aware, multi-session project memory in coding agents. It extends the
deterministic Workset tests in the main Memorix repository with downstream
engineering outcomes: whether a fresh agent starts in the right place, avoids
obsolete guidance, and completes a dependent task after project state changes.

This directory is a research program, not a benchmark claim. Results remain
unproven until the preregistered confirmatory run is complete and independently
audited.

## Research tracks

1. Deterministic retrieval checks reuse the existing Workset fixture corpus.
2. Track B seeded retrieval compares memory systems with the same approved
   evidence; it is retrieval parity, not a claim about memory formation.
3. Track C trace replay gives every system the same normalized precursor event
   sequence, records formation receipts, and evaluates a fresh agent on a
   dependent transfer task.
4. Stale-memory stress cases change code, dependencies, configuration, or
   project policy between the precursor and transfer phases.
5. Real engineering cases grade patches with isolated tests rather than an LLM
   judge.

## Layout

- PROTOCOL.md: preregistration draft and statistical analysis plan.
- BASELINE_PROTOCOL.md: fair canonical and native memory-baseline contract.
- TRACE-REPLAY-CONTRACT.md: immutable precursor-event format, bounded replay,
  and the Track B/Track C boundary.
- ANNOTATION-PROTOCOL.md: blinded human action labels, adjudication, and the
  redacted result-summary boundary.
- CLAIMS.md: every intended paper claim and the evidence required to unlock it.
- LITERATURE.md: comparison boundaries for adjacent memory systems and benchmarks.
- RESULTS-PILOT.md: excluded diagnostics and non-confirmatory smoke evidence.
- cases/: public case manifests and case-authoring rules.
- CASE-CANDIDATES.md: researched candidates that are not yet eligible cases.
- CASE-REGISTRY-CONTRACT.md: frozen corpus inventory, split isolation, and
  dependency/contamination disclosure rules.
- SOURCE-LEDGER-CONTRACT.md: provenance and admission rules for real-repository
  leads that are not yet benchmark cases.
- LEGACY-ARTIFACTS.md: pre-snapshot diagnostic artifact boundary.
- PRIVATE-ORACLE-CONTRACT.md: public/private case boundary and the required
  external isolation proof for confirmatory trials.
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
    uv run memorixbench validate-source-ledger cases/CANDIDATE-SOURCES.toml

To audit a pre-cloned source cache without allowing a mutable remote checkout:

    uv run memorixbench audit-source-candidate \
      cases/CANDIDATE-SOURCES.toml backoff-permanent-error \
      F:/memorix-research-artifacts/repository-cache/backoff

To convert one private agent event stream into a sanitized Track C trace and
its public receipt:

    uv run memorixbench capture-trace \
      --events F:/memorix-research-artifacts/capture/events.jsonl \
      --timeline F:/memorix-research-artifacts/capture/event-timeline.jsonl \
      --case-id example-case --agent claude \
      --prompt-file F:/memorix-research-artifacts/capture/prompt.txt \
      --output F:/memorix-research-artifacts/capture/trace.json \
      --receipt F:/memorix-research-artifacts/capture/receipt.json \
      --client-version claude-cli-pinned \
      --workspace-snapshot-sha256 <sha256> \
      --workspace-root F:/memorix-research-artifacts/capture/workspace

This produces diagnostic evidence only unless the receipt is bound to the
separate external worker/vault isolation profile.

For an auditable local precursor capture, prefer the integrated command over a
hand-assembled client invocation:

    uv run memorixbench capture-precursor-session \
      cases/development/<case>/case.toml \
      --prompt-file F:/memorix-research-artifacts/prompts/<capture>.txt \
      --artifact-root F:/memorix-research-artifacts/private-captures/<capture> \
      --public-output-root F:/memorix-research-artifacts/captured-traces/<capture> \
      --workspace-root F:/memorix-research-artifacts/capture-workspaces \
      --agent claude \
      --client-version <claude-version> \
      --capture-id <capture-id> \
      --timeout-seconds 240 \
      --claude-provider-settings C:/Users/<user>/.claude/settings.json \
      --repository-cache F:/memorix-research-artifacts/repository-cache/<repo>

It materializes the fixed precursor snapshot, runs a constrained local session
with local auto-memory disabled, retains the raw stream only under the private
artifact root, verifies the final workspace content snapshot is unchanged, and
audits shell commands. Trace and receipt are first staged privately, scanned
against injected provider secrets, then atomically released as `trace.json` and
`receipt.json` in the separate public-output root. A local run is always
`local-diagnostic-v1`: it is not an OS-isolated read-only worker and cannot be
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
      --bootstrap-log F:/memorix-research-artifacts/candidate-preflight/cobra-completion-os-args/bootstrap-go-test.log \
      --offline-command "GOPROXY=off GOSUMDB=off go test ./..." --offline-exit-code 0 \
      --offline-log F:/memorix-research-artifacts/candidate-preflight/cobra-completion-os-args/offline-go-test.log \
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

Development cases also carry a maintainer-only `oracle.reference_patch`. Run
`memorixbench grade ... --phase transfer --reference --allow-case-commands` in
a fresh materialized workspace to verify that the known-good repair passes the
same hidden tests used for agents. The reference patch is never mounted during
an agent run. A case may also declare scoped source checks for refactoring
boundaries that behavior tests cannot observe directly. Those checks run after
the agent exits but before hidden tests are mounted, are included with source
hashes in `grade` output and trial artifacts, and are part of task success
rather than advisory prose. For a semantic ownership constraint, use a hidden
language-specific validator rather than relying on string matching alone.

Before a case is eligible for an agent run, execute all four authoring gates in
one fresh artifact root:

    uv run memorixbench verify-case cases/development/<case>/case.toml \
      --target-root F:/memorix-research-artifacts/case-authoring/<case> \
      --allow-case-commands

The command proves precursor-public success, transfer-public success, hidden
regression failure, and reference-repair success. It intentionally preserves
the four materialized workspaces as audit evidence.

For a Git case, `--repository-cache <checkout>` may replace the clone transport
only after MemorixBench verifies an `origin` match and checks out the manifest's
immutable full commit. The commit fixes the content; `origin` is recorded as
provenance metadata, not treated as cryptographic proof. The gate output records
whether each workspace came from the remote or a pinned local cache.

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

Baseline adapters must additionally pass their pinned local preflight before an
agent run. See `BASELINE_PROTOCOL.md` for the equal-evidence/equal-budget
retrieval contract and the distinction between canonical and native product
tracks.

The native Memorix product track is itself budgeted by a one-tool MCP gateway;
see `NATIVE-MCP-BUDGET-CONTRACT.md`. It records whether the agent elected to
use Memorix and prevents native tool discovery from turning into unbounded
retrieval rounds.

All currently executable cases are development-only. Their result artifacts
carry `evidence_tier: development`, and `memorixbench compare` rejects them
unless `--allow-development` is passed explicitly. Validation and test splits
remain disabled until a private-oracle overlay is paired with a passing external
agent-isolation certificate for the exact runtime image. A private black-box
subject additionally requires a Linux/KVM microVM preflight; run
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
