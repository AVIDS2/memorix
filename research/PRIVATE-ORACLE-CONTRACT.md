# Private Oracle Contract

Confirmatory MemorixBench cases use a public case definition and a private
oracle overlay. This separates the task an agent may receive from the hidden
tests and maintainer repair that decide correctness. A private overlay is not
a security claim by itself: a case becomes executable only after an external
agent-isolation certificate has been issued for the exact runtime profile.

## Public case definition

A validation or test case declares `oracle.visibility = "private"`. Its public
case tree contains the immutable repository revision, precursor and transfer
tasks, public verification command, evidence seeds, transition, dependency
strength, and preregistration status. It must not name or contain a hidden test
patch, reference repair, case-specific source check, or case-specific forbidden
action.

Before its first model run, a confirmatory case must have:

- `split = "validation"` or `"test"`;
- `dependency_classification_status = "preregistered"`;
- an immutable full Git commit when it uses an upstream repository;
- a public transition patch committed in the public case tree; and
- an accepted private overlay bound to the exact hash of the whole public case
  definition tree, not merely `case.toml`.

The public tree hash covers file paths and bytes. It is copied into each run
artifact, so later edits cannot silently change the task behind a result.

## Private overlay

The overlay lives outside the Git worktree and outside every public artifact
directory. Its root contains `oracle.toml`, `hidden-tests.patch`, and
`reference.patch`; the last two names are examples only and are not published
in the public case definition. `oracle.toml` uses this versioned contract:

```toml
schema_version = "0.1"
overlay_id = "opaque-case-revision"
case_id = "example-case"
public_case_definition_sha256 = "<sha256 of the public case tree>"
base_commit = "<same revision as the public manifest>"
transition_patch_sha256 = "<sha256 of the public transition patch>"
hidden_patch = "hidden-tests.patch"
hidden_patch_sha256 = "<sha256 of hidden-tests.patch>"
reference_patch = "reference.patch"
reference_patch_sha256 = "<sha256 of reference.patch>"
verifier_runtime = "verifier-runtime"
verifier_runtime_sha256 = "<sha256 of the pinned verifier runtime>"
verifier_image = "<registry image pinned by sha256 digest>"
verifier_command = ["/verifier/entrypoint"]
```

Patch paths are resolved under the overlay root only. The loader rejects a case
identifier, public-tree hash, base revision, transition commitment, asset hash,
or verifier-runtime hash mismatch. It also rejects path escapes, symbolic-link
assets, and public manifests that are not marked private.

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
3. The worker destroys its agent container and returns only a sealed patch. A
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

## Output and disclosure boundary

Private-oracle reports preserve only pass/fail status, return code, duration,
byte counts, and SHA-256 digests for verifier output. They do not emit command
text, stdout, stderr, source-check paths, violation text, overlay paths, hidden
test text, or reference-repair text. This rule applies to `grade`,
`verify-case`, and trial artifacts.

Each future private-oracle result will record only:

- public case-definition hash and private overlay definition hash;
- overlay identifier, hidden/reference patch commitments, and verifier runtime
  commitment;
- isolation profile identifier, runtime image digest, and preflight-certificate
  hash; and
- redacted grade evidence plus the regular agent, model, budget, patch, and
  provenance fields.

During a submission embargo, raw overlays stay in a restricted archive with
their commitments. The open artifact may later release them under the stated
disclosure policy while preserving the original hashes.
