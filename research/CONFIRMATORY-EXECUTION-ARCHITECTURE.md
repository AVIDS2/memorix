# Confirmatory Execution Architecture

This document defines the only execution shape allowed to produce a
confirmatory MemorixBench result. It exists because a hidden-test mount alone
does not protect a benchmark: an agent can modify a test entrypoint, leave a
background process, or observe a later grading workspace if the same machine
and filesystem are reused.

## Trust boundary

```text
Public case + prompt + retrieval context
                 |
                 v
      isolated worker host or disposable VM
      agent container has public /work only
                 |
                 | sealed patch + sanitized action ledger + redacted telemetry
                 v
    local private-oracle vault controller
    fresh grade workspace, offline verifier only
                 |
                 v
       redacted grade receipt + commitments
```

The private overlay, its parent directory, the controller artifact root, and
all private verifier runtime bytes remain on the vault side. They never cross
to the worker. The worker is a separate host or disposable VM, not a Docker
Desktop container on the same Windows host as the vault.

`memorixbench.attestation` defines the signed worker statement used by the
future controller: canonical JSON is signed in a fixed OpenSSH namespace and
binds the job, public bundle, prompt, memory snapshot, workspace snapshot,
sealed patch, exact black-box subject-protocol hash, runtime/image commitments,
inspected isolation state, sentinel suite, destruction receipt, and a short expiry. The vault verifies a configured
worker principal rather than trusting a worker-provided boolean. The module has
an actual temporary-key OpenSSH sign/verify regression test, but it does not
itself issue an external-worker certificate or enable a trial.

That worker signature does not prove what a model relay actually served. The
separate `memorixbench.model_relay` contract requires a relay-owned OpenSSH key
and a short-lived aggregate receipt bound to the same run, job hash, nonce,
requested alias, route-policy hash, actual model set, and hashed provider
request identifiers. The controller keeps relay and worker signer files
separate. A result is rejected unless the relay receipt, the worker's client
telemetry, and the frozen policy all identify one same actual model.

Neither statement proves that the worker actually ran in the requested remote
isolation profile. `memorixbench.runtime_attestation` therefore requires a
third, deployment-owned OpenSSH signer. Its short-lived statement binds the
same job nonce and worker-result hash to the controller policy, pinned worker
runtime and agent image, normalized container inspection, a reviewed runtime
measurement-policy hash, isolation-measurement hash, and destruction receipt.
Worker, relay, and runtime signer files must contain disjoint public keys. This
does not make a signature alone proof of KVM: it makes the operator's
measurement evidence an explicit, independently auditable admission input
instead of an implicit trust assumption.

## Profiles

`docker-agent-diagnostic-v1` is a local containment diagnostic only. It may
exercise read-only rootfs, mount inspection, dropped capabilities, and a random
sentinel probe, but it must never unlock a validation or test case.

`remote-worker-vault-v1` is the first candidate confirmatory profile. A worker
host has no private-oracle bytes. It may use Docker internally, but the Docker
container is only a worker hardening layer; the separation from the vault is the
actual oracle boundary. A Hyper-V worker VM can implement the same contract
under a separate profile identifier.

## Public worker bundle

The controller creates a bundle containing only:

- the public case-definition snapshot and its SHA-256;
- a transfer workspace made from the pinned public revision and transition;
- the normalized public prompt and its SHA-256;
- condition-specific public retrieval context and its SHA-256;
- pinned agent image/reference, tool-catalog hash, and resource policy; and
- a worker job manifest with no credential values, private paths, artifact
  paths, or oracle identifiers.

The public bundle is allowlisted, not a copy of a parent directory. The worker
cannot receive `.git` history, a case-authoring workspace, a public artifact
tree, a host home directory, Docker socket, named pipe, or any ancestor of the
private vault.

## Worker contract

The worker runs one non-root agent container. It gets only `/work` and a
read-only runtime-config mount. The agent root is read-only; writable state is
limited to `/work` and declared tmpfs locations; capabilities are dropped;
`no-new-privileges`, resource limits, and a pinned image digest are mandatory.

The container must not have privileged mode, devices, Docker socket, host
PID/IPC/UTS/user namespaces, host networking, host aliases, or user-controlled
proxy settings. Model egress, when required, goes only through a policy-pinned
relay that cannot proxy arbitrary destinations. A worker must return an error
instead of falling back to direct internet access.

After the agent exits, the worker terminates the container, validates the Git
diff as a sealed patch, hashes it, emits redacted telemetry, and destroys its
workspace. It may return a sanitized action ledger to the vault for blinded
human annotation: action order/time/type/success and provider-redacted operation
summaries only. It must never return raw client events, model/provider identity,
memory text, MCP arguments/results, absolute host paths, a hidden test, or a
private overlay.

## Vault grading contract

The controller materializes a new transfer workspace from the immutable public
base and its sealed private transition. It applies the worker's sealed patch
after path and size validation. It does not reuse the worker filesystem, worker
process, worker artifact directory, or worker container.

The vault grader runs offline. The private verifier may observe the fresh
candidate workspace and mount its private test bundle, but no grade workspace,
verifier stdout/stderr, private command, hidden input, or reference patch is
returned to the worker. Candidate code cannot exfiltrate a hidden test because
the grader has no network and the agent worker has already been destroyed.

The verifier must use a pinned private runtime and fixed entrypoint rather than
delegating to a candidate-controlled script such as a modified `package.json`
test command. Case authors supply a verifier bundle commitment in the private
overlay. A generic hidden patch is insufficient for a confirmatory case.

The vault must not use a generic grader that mounts both candidate files and
private tests into one process container. Candidate code runs while tests run,
so it could inspect those files even when every mount is read-only. Instead,
each confirmatory case needs a black-box controller/subject protocol: the
subject sees public candidate files only, while the controller retains private
fixtures and communicates through a fixed public interface. The subject must be
a fresh KVM-backed Linux microVM; container hardening is defense in depth but
cannot turn Docker Desktop or a same-host container into this boundary. Until
the protocol and KVM preflight pass adversarial tests, no local verifier hook
is available. Local vault preparation is development-only: it may materialize
an authoring workspace and construct a blind packet, but it rejects
confirmatory cases and never runs candidate code against private assets.

The controller protocol now has a concrete `ConnectedSocketSubjectTransport`.
It consumes a socket that an external KVM worker has already established and
attested, carries one bounded JSONL message at a time, and never opens a
connection or starts a subject itself. A local socketpair smoke validates
framing, byte ceilings, request-id matching, and receipt redaction; it is not a
remote KVM subject or a confirmatory run.

The controller also owns concrete request-input and response-output schemas.
Their hashes are committed in `SubjectProtocol`, and every exchanged value is
validated against the same deliberately small schema subset before it reaches
the subject or is accepted back from it. The subset supports bounded objects,
arrays, strings, integers, booleans, and nulls only; it has no `$ref`, regex,
callbacks, executable keywords, or additional properties. Schema hashing alone
is not accepted as validation evidence. The controller applies the remaining
session deadline to each send and receive, so repeated per-request timeouts
cannot exceed the total protocol budget.

The subject runs only after the agent worker has returned a sealed patch and
the worker destruction record has been revalidated. It therefore cannot change
the agent's retrieval timing or memory choices. Its private exchange timings
are committed separately; the redacted session receipt records total and
maximum exchange duration so later analysis can detect a grading-infrastructure
imbalance across conditions instead of treating a timeout as a memory effect.

## Certificate and receipt

The controller accepts a worker result only with an attestation bound to:

- `run_id`, `case_id`, public case-definition hash, public bundle hash, prompt
  hash, memory-snapshot hash, and sealed-patch hash;
- profile hash, worker/VM image or template hash, OCI image digest, agent and
  tool-catalog versions, normalized container inspection hash, and model-relay
  policy hash;
- mount classes and read/write state, `oracle_mount_count = 0`, socket/device/
  credential mount counts, namespace/network/resource policy, and environment
  allowlist hash;
- randomized sentinel-suite results, agent-container destruction record, and
  expiry timestamp; and
- a controller-verifiable signature from a configured worker key.

It also accepts a separate controller-verifiable relay signature over the exact
job nonce, route configuration, requested model alias, one actual model, and
hashed provider request identifiers. The relay receipt contains no prompt,
completion, credential, or raw request ID. A worker configuration hash alone
cannot stand in for this evidence.

Finally, it requires a third controller-verifiable runtime-manager signature.
That statement must bind the exact worker result and controller policy to the
reviewed measurement policy, pinned worker runtime and image, inspected
container state, relay-only network policy, isolation-measurement commitment,
and the same destruction receipt asserted by the worker. It is not treated as
a substitute for an actual KVM preflight; it makes the evidence produced by
that preflight and the per-run runtime inspection traceable to an independent
operator key.

The remote private controller then emits a redacted grade receipt bound to the same hashes,
the private overlay definition hash, the private verifier runtime commitment,
and the offline grade-container identity. Both public records contain only
stable IDs, states, durations, byte counts, and hashes; no raw path, secret,
oracle, or hidden output is public.

For C3, C4, and C7, the vault creates a blinded annotation packet from the
sanitized action ledger plus a committed private rubric. Two human raters see
neither condition nor model/provider identity; a disagreement requires an
independent human adjudicator. Only the adjudicated numeric summary and its
commitments may join the public result corpus.

## Admission gates

A validation/test run is eligible only when all gates pass for the exact
runtime, not a similar earlier setup:

1. The public case and private overlay validate and bind to each other.
2. The worker, relay, and runtime evidence chains use mutually disjoint signer
   keys and bind one exact job nonce and worker-result hash.
3. The worker profile rejects adversarial extra mounts, parent mounts, socket or
   named-pipe access, host namespaces/network, capabilities, devices, proxy
   bypass, reparse points, and unpinned images.
4. A randomized sentinel suite proves absence from the worker filesystem,
   process descriptors, mount table, build context, artifact bundle, settings,
   event logs, and command error paths.
5. The sealed patch is accepted by a fresh vault workspace only; a malicious
   candidate that edits test commands, spawns a background process, or writes a
   host path cannot change the private verifier result.
6. The worker and vault artifacts pass a secret/path/private-content scan before
   a result enters the public analysis corpus.

## Permit boundary

`memorixbench.permit` is the only future admission path from a remote worker
result to remote black-box grading. It revalidates the frozen registry entry,
Track C/public-repository/preregistration requirements, public case hash,
worker job/result/sealed-patch binding, exact subject protocol, and a live
OpenSSH worker signature, separate OpenSSH model-relay signature, and third
runtime-manager signature. It then emits a hashable
`ConfirmatoryExecutionPermit` containing the measurement-policy, isolation,
and destruction commitments.

The permit also reloads the exact source ledger and the candidate's approved
human-review receipt. It checks that the reviewed repository and base revision
match the case, and that the review's private-transition commitment equals the
manifest's private-transition commitment. The permit records the source-ledger
file hash, candidate id, and canonical review-payload hash, so a later private
patch swap or unrelated review cannot ride on an otherwise valid worker run.

A serialized permit is not trusted by itself. The private controller must call
`validate_confirmatory_execution_permit` with the live registry, patch, signed
worker, model-relay, and runtime attestations, and protocol again at the grading
boundary. Before it can redeem the permit, it must apply that exact sealed patch
to a fresh disposable public checkout whose baseline hash matches the worker
job, and verify that the reconstructed public-tree hash matches the worker
result. The controller snapshots and re-hashes the patch bytes at that boundary
before applying them, so a later replacement of the worker patch file is also
rejected. A mismatch rejects redemption before the black-box subject starts. The
generic local
`run_trial` path intentionally remains unable to consume a permit or run a
private oracle.

The connected-socket transport is deliberately only an I/O component. The
remote runner owns endpoint selection, subject creation, KVM attestation, and
network policy; the controller will not infer those properties from a socket.
Every controller-session receipt therefore labels its transport isolation
evidence `not-attested-by-controller-transport-v1`; an isolation-profile name
in that receipt is a requested protocol requirement, not proof that a socket
peer actually satisfied it.

Until the implementation proves every gate in an actual worker run, a case
remains non-confirmatory and is excluded from aggregate efficacy comparisons.

## Current Environment Status

The current development workstation and existing Linux VPS were checked against
the `microvm-kvm-v1` profile. Neither exposes a usable `/dev/kvm`; neither is a
candidate private subject host. No Docker fallback is permitted. A future
confirmatory run requires a separately provisioned Linux host that passes the
same KVM, Firecracker, jailer, sentinel, and protocol preflight for the exact
runtime used in that run.
