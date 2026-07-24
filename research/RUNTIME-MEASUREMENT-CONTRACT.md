# Runtime Measurement Contract

This contract defines the private evidence that a future remote runtime manager
must measure before a MemorixBench confirmatory worker result can receive a
permit. It does not make the current workstation, VPS, or a local container
eligible. The current environment still has no KVM-capable confirmatory host.

## Why this exists

A worker can sign what it observed inside its own container, and a model relay
can sign what it served. Neither statement establishes that a separate runtime
operator launched the worker in the required KVM-backed profile. The runtime
manager therefore produces a private measurement receipt and signs a separate
runtime attestation over its canonical hash.

The receipt contains only stable identifiers and SHA-256 commitments. Raw host
logs, hypervisor configuration, inspection output, sentinel material, and
destruction records remain in the private runtime evidence store. They never
enter a public case card, model prompt, worker bundle, or paper table.

## Frozen policy

Before a confirmatory cohort, the controller loads and hashes a
`runtime-measurement-policy-v1` document. Its canonical fields are:

```json
{
  "schema_version": "runtime-measurement-policy-v1",
  "policy_id": "remote-kvm-runtime-v1",
  "profile_id": "remote-worker-vault-v1",
  "subject_isolation_profile": "microvm-kvm-v1",
  "network_policy_id": "model-relay-only-v1",
  "required_measurements": [
    "agent-container-inspection-v1",
    "host-kvm-capability-v1",
    "microvm-runtime-v1",
    "network-egress-policy-v1",
    "worker-destruction-v1"
  ],
  "maximum_receipt_age_seconds": 300
}
```

The supported v1 profile requires this exact evidence set. A future different
hypervisor or network design needs a new reviewed policy/schema, not a quiet
deletion or rename of a required measurement. The receipt-age ceiling is at
most one hour; the frozen policy normally chooses a much shorter window.

## Per-run receipt

For one worker job, the independent runtime manager records one
`runtime-measurement-receipt-v1` object. It binds the policy hash, profile,
run ID, job hash and nonce, worker-result hash, network policy, a SHA-256 for
each required private measurement artifact, the destruction-record hash, and
an observation timestamp. The receipt has no boolean "trust me" field: it is
eligible only when its exact canonical hash is included in a short-lived
OpenSSH-signed `runtime-attestation-v1` statement.

The controller checks all of the following before issuing a permit:

1. Worker, model-relay, and runtime-manager signer files contain pairwise
   disjoint public keys.
2. The receipt matches the frozen measurement policy and is fresh.
3. The receipt, worker attestation, and runtime attestation use the same run,
   job hash, nonce, worker-result hash, network policy, and destruction hash.
4. The runtime attestation's isolation-measurement hash equals the canonical
   receipt hash and its policy hash equals the controller policy.
5. The existing sealed patch, source-admission, model-route, private-oracle,
   and black-box KVM gates also pass.

The runtime operator can validate a private policy/receipt pair without printing
the raw evidence artifacts:

```powershell
uv run memorixbench validate-runtime-measurement <policy.json> <receipt.json>
```

The command prints only the policy and receipt commitments, run/job/result
hashes, measurement IDs, and timestamp. It does not issue a permit or treat a
passing local parse as a KVM deployment certificate.

The independently signed runtime statement is persisted as a strict JSON object
with an embedded signature digest. Controller code uses
`load_signed_runtime_attestation` before OpenSSH verification; unsupported
fields, digest changes, symlinks, and Windows reparse points are rejected rather
than being silently coerced into a receipt.

## Deployment trust boundary

The controller must place trusted signer files and the pinned `ssh-keygen`
binary on an immutable controller image or read-only deployment mount. The
local Python contract verifies their committed hashes, but it cannot turn a
writable controller host into an independent trust root or eliminate every
file-replacement race by itself. Likewise, the typed receipt commits private
evidence bytes but does not replace the private evidence store and external
audit process that retain and inspect those bytes. Both are hard deployment
gates for a confirmatory run, not optional future polish.

An opaque hash without this parsed receipt is rejected. Conversely, a valid
receipt does not substitute for the underlying remote KVM/Firecracker/jailer
preflight or the private evidence it commits. It makes that preflight evidence
addressable and impossible to silently swap after the worker result exists.
