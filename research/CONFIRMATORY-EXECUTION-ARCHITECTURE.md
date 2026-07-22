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
sealed patch, runtime/image commitments, inspected isolation state, sentinel
suite, destruction receipt, and a short expiry. The vault verifies a configured
worker principal rather than trusting a worker-provided boolean. The module has
an actual temporary-key OpenSSH sign/verify regression test, but it does not
itself issue an external-worker certificate or enable a trial.

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

The controller materializes a new transfer workspace from the public case
definition. It applies the sealed patch after path and size validation. It does
not reuse the worker filesystem, worker process, worker artifact directory, or
worker container.

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
the protocol and KVM preflight pass adversarial tests, the generic
`PrivateVerifier` hook is diagnostic-only.

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

The private vault then emits a `RedactedGradeReceipt` bound to the same hashes,
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
2. The worker profile rejects adversarial extra mounts, parent mounts, socket or
   named-pipe access, host namespaces/network, capabilities, devices, proxy
   bypass, reparse points, and unpinned images.
3. A randomized sentinel suite proves absence from the worker filesystem,
   process descriptors, mount table, build context, artifact bundle, settings,
   event logs, and command error paths.
4. The sealed patch is accepted by a fresh vault workspace only; a malicious
   candidate that edits test commands, spawns a background process, or writes a
   host path cannot change the private verifier result.
5. The worker and vault artifacts pass a secret/path/private-content scan before
   a result enters the public analysis corpus.

Until the implementation proves all five gates in an actual worker run, a case
remains non-confirmatory and is excluded from aggregate efficacy comparisons.
