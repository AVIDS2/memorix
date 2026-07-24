# Private Oracle Contract

Confirmatory MemorixBench cases use a public case definition and a private
oracle overlay. This separates the task an agent may receive from the hidden
tests and maintainer repair that decide correctness. A private overlay is not
a security claim by itself: a case becomes executable only after an external
agent-isolation certificate has been issued for the exact runtime profile.

## Public case definition

A validation or test case declares `oracle.visibility = "private"`. Its public
case card contains only the immutable repository revision, a broad task
description, contamination disclosure, preregistration metadata, and opaque
commitments. It must not name or contain a hidden test patch, reference repair,
case-specific source check, forbidden implementation path, exact behavior
predicate, raw predecessor evidence, or transition patch.

Before its first model run, a confirmatory case must have:

- `split = "validation"` or `"test"`;
- `dependency_classification_status = "preregistered"`;
- an immutable full Git commit when it uses an upstream repository;
- a privately authored post-snapshot transition committed only by hash; and
- an accepted private overlay bound to the exact hash of the whole public case
  definition tree, not merely `case.toml`.

The public tree hash covers file paths and bytes. It is copied into each run
artifact, so later edits cannot silently change the public card behind a result.
The private overlay separately commits the transfer construction and grader.

## Private overlay

The overlay lives outside the Git worktree and outside every public artifact
directory. Its root contains the private transition, hidden tests, a reference
repair, an annotation rubric, and a pinned verifier runtime; asset names below
are examples only and are not published in the public case definition.
`oracle.toml` uses this versioned contract:

```toml
schema_version = "0.2"
mode = "black-box-controller-v1"
overlay_id = "opaque-case-revision"
case_id = "example-case"
public_case_definition_sha256 = "<sha256 of the public case tree>"
base_commit = "<same revision as the public manifest>"
transition_patch = "transition.patch"
transition_patch_sha256 = "<sha256 of private transition.patch>"
hidden_patch = "hidden-tests.patch"
hidden_patch_sha256 = "<sha256 of hidden-tests.patch>"
reference_patch = "reference.patch"
reference_patch_sha256 = "<sha256 of reference.patch>"
annotation_rubric = "annotation-rubric.md"
annotation_rubric_sha256 = "<sha256 of the private blinded-rater rubric>"
verifier_runtime = "verifier-runtime"
verifier_runtime_sha256 = "<sha256 of the pinned verifier runtime>"
verifier_image = "<registry image pinned by sha256 digest>"
verifier_command = ["/verifier/entrypoint"]
```

Patch paths are resolved under the overlay root only. The controller rejects a
case identifier, public-tree hash, base revision, transition commitment, asset
hash, or verifier-runtime hash mismatch. It also rejects path escapes,
symbolic-link assets, and public manifests that are not marked private.

`development-authoring-v1` is a narrower overlay mode for local deterministic
authoring gates. It can validate that private assets bind to a public card, but
it cannot enable an agent run or an outcome result. The current public registry
contains no cases while the sealed-transition controller is completed.

## Isolation boundary

No private-oracle agent run is enabled by default. A local Docker preflight is
diagnostic evidence only, because Docker Desktop on the same Windows host does
not separate an agent from a later local grade workspace. The acceptable
confirmatory shape is a separate worker host or disposable VM plus a private
vault controller, with these invariants:

1. The agent worker receives a writable transfer workspace and only the
   explicitly required runtime configuration. It never receives the overlay,
   any parent of the overlay, the host artifact root, a Docker socket, a host
   home directory, host networking, host PID/IPC namespaces, privileged mode,
   added Linux capabilities, or device mounts.
2. Its root filesystem is read-only except for the transfer workspace and
   declared temporary filesystems; `no-new-privileges` and dropped capabilities
   are mandatory. Authentication values are injected transiently and are never
   copied into artifacts or image layers.
3. The worker destroys its agent container and returns a sealed patch plus a
   sanitized action ledger. The ledger may contain action order/time/type,
   success state, and provider-redacted operation summaries, but never raw
   client events, memory text, MCP arguments/results, model identity, or a
   private path. A
   separately started vault grader creates a new workspace, mounts the private
   overlay read-only only after worker exit, has no network access, and returns
   structured, redacted verification evidence to the harness.
4. A fresh adversarial preflight proves that a random private sentinel is not
   observable from the agent container, then records the inspected mounts,
   security options, runtime image digest, and probe-output hashes. Docker
   inspection is necessary but not sufficient; the sentinel probe is required
   as a behavioral check.

Claude and Codex client-side permission settings remain defense in depth. They
are never accepted as the isolation proof, because the agent process must not
be able to reach the oracle at the operating-system boundary in the first
place.

### Black-box verifier requirement

There is intentionally no generic `docker run` implementation that mounts a
candidate workspace and hidden tests into the same process container. Even with
read-only mounts and a fixed entrypoint, candidate code executing during a test
can inspect private files and tailor its behavior to them.

A confirmatory private case therefore needs a case-specific
`black-box-controller-v1` verifier: the subject process sees only public
candidate files and exposes a fixed, public interaction boundary; the private
controller owns hidden fixtures and observes only that boundary. The subject
must run in a new KVM-backed Linux microVM on the remote vault runtime. Docker
can harden controller-side helpers or exercise public diagnostics, but it is
not accepted as the subject isolation proof for a private result.

The current vault code deliberately has no local `PrivateVerifier` callback.
Its workspace-preparation entry point is development-only: it can freeze a
committed private transition long enough to materialize an authoring workspace,
then removes that snapshot before returning. It rejects validation and test
cases before materializing their private transition. Neither a local Docker
run, a Windows Docker Desktop run, nor a generic hidden-test mount can unlock
confirmatory execution.

The future remote controller must first issue and revalidate a
`ConfirmatoryExecutionPermit`. That permit binds a registered Track C case, the
exact worker job/result/patch, a signed worker attestation, a separate signed
model-relay attestation for the exact job nonce and actual model, an independent
runtime-manager attestation over a fresh parsed measurement receipt, and the
pinned black-box subject protocol. It is a gating record, not a way to enable
the generic local trial runner.

At permit issue time, the controller also reloads the admitted source-ledger
entry and its approved review receipt. The review's private transition hash
must equal the public manifest's private transition commitment, and the
candidate repository/base must equal the case repository/base. This prevents a
reviewed private design from being silently replaced before execution.

The controller's concrete socket transport accepts only a connection already
created by the remote KVM runner. It owns JSONL framing, byte limits, timeouts,
and redacted receipts, but it cannot launch a subject, select a network
endpoint, or attest isolation. Those responsibilities deliberately remain
outside the local benchmark process.

A local client preflight can detect internally inconsistent telemetry, but it
cannot prove what an arbitrary proxy served. The confirmatory permit therefore
requires a relay-owned signer distinct from the worker signer. The relay receipt
binds the requested alias, actual model set, route policy, and hashed provider
request identifiers to the controller nonce; it contains no prompt, completion,
or credential text.

The runtime-manager signer is separate from both worker and relay trust roots.
Its receipt must parse against the frozen KVM measurement policy and bind the
same job nonce, worker-result hash, network policy, and destruction record as
the worker. The receipt exposes only commitments; the controller refuses an
opaque isolation hash without the parsed policy/receipt pair. See
`RUNTIME-MEASUREMENT-CONTRACT.md` for the exact evidence contract.

The private controller validates the public subject interface rather than
trusting schema hashes as labels. A fixed, controller-owned schema pair binds
the input and output values for every black-box exchange. It rejects unknown
fields, unbounded strings/arrays, non-finite JSON values, unsupported schema
keywords, and an output whose schema hash differs from the signed subject
protocol. These schemas describe the public interaction shape only; they never
encode hidden expected values or private test predicates.

The subject is never part of the agent turn. It starts only after the worker's
agent container has been destroyed and its sealed patch has been admitted by
the controller. The controller commits per-exchange timings privately and
emits only aggregate timing evidence, so a later condition comparison can
separate grading-time failures from agent-memory behavior.

## Output and disclosure boundary

Future remote private-oracle reports preserve only pass/fail status, return
code, duration, byte counts, and SHA-256 digests for verifier output. They do
not emit command text, stdout, stderr, source-check paths, violation text,
overlay paths, hidden-test text, or reference-repair text. This rule applies to
all future grade, verification, and trial artifacts.

Each future private-oracle result will record only:

- public case-definition hash and private overlay definition hash;
- verifier runtime commitment and blinded annotation commitments;
- isolation profile identifier, runtime image digest, and preflight-certificate
  hash; and
- redacted grade evidence plus the regular agent, model, budget, patch, and
  provenance fields.

During a submission embargo, raw overlays stay in a restricted archive with
their commitments. The open artifact may later release them under the stated
disclosure policy while preserving the original hashes.
