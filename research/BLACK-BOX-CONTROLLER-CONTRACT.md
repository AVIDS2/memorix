# Black-Box Controller Contract

This contract is the only planned path from a private MemorixBench case to a
confirmatory grade. It exists because a generic hidden-test runner is unsafe:
if candidate code and hidden tests execute in the same filesystem/process
environment, candidate code can read the tests while they run.

The contract intentionally supports a narrower class of coding tasks than a
normal test command. A case that needs arbitrary test-runner access to the
candidate filesystem is not eligible for `black-box-controller-v1` until it
has a specialized, reviewed controller.

## Roles

```text
public candidate workspace ----> fresh subject microVM
                                     |  bounded stdio/vsock request/response only
private controller + fixtures ----> |
                                     v
                            redacted pass/fail receipt
```

The **subject** is a fresh short-lived Linux microVM started from a public,
digest-pinned adapter rootfs. It receives the candidate workspace read-only at
`/work`, a fixed public adapter entrypoint, and a bounded serial/vsock stream.
It has no network interface, private mount, host socket, host namespace,
credential mount, or writable host directory. It does not receive a hidden
patch, controller runtime, private fixture, reference repair, or test filename.

The **controller** stays on the vault side. It owns hidden fixtures and the
expected outputs. It sends public-safe test inputs to the subject over the
container's standard input and reads only bounded, schema-validated responses
from standard output. It never imports candidate code, invokes a
candidate-selected command, mounts candidate paths into its own private runtime,
or returns per-test feedback to the worker.

The subject's public adapter is the only process allowed to load candidate
code. It must use a fixed command and a declared request/response schema. A
candidate may fail, hang, or produce malformed output; those are task outcomes,
not reasons to relax the interface.

## v1 transport

`stdio-jsonl-v1` is the initial logical transport because it avoids a shared
network namespace and makes the information flow inspectable. A confirmatory
implementation carries it over a constrained serial or vsock channel to a
fresh KVM-backed guest; a Docker/Windows implementation may exercise the
protocol only as a non-confirmatory diagnostic:

1. The vault creates a fresh candidate workspace from the sealed patch.
2. It starts one subject microVM with its public rootfs and candidate snapshot;
   stdin/stdout/stderr are captured under byte/time limits. No host directory
   is shared with the guest after launch.
3. The private controller writes one JSON request line at a time and waits for
   exactly one JSON response line. Requests contain only the public interface
   input; expected values and hidden fixture names remain controller-local.
4. The controller evaluates the response locally and sends the next request or
   stops. It never reports an individual assertion result to the subject.
5. The vault powers off and destroys the subject microVM on every completion,
   timeout, parse error, or controller failure. Only a redacted aggregate
   receipt is emitted.

The controller must cap request count, request bytes, response bytes, total
wall time, and subject stderr bytes. It treats additional output, malformed
JSON, an unexpected response identifier, or a response after termination as a
failure. MicroVM runtime inspection, power-off/destruction evidence, and raw
output digests remain vault-private and are bound into the signed grade record.

## Case eligibility

`black-box-controller-v1` can initially cover tasks with a stable public
function, CLI, protocol, or service boundary: for example, a JSON transform, a
CLI command with explicit input/output, or an HTTP-like request handled by the
public adapter. Hidden tests can vary inputs and check private expected
properties without placing private files in the subject.

It cannot honestly cover these in v1:

- a generic `npm test`, `pytest`, or build command that executes hidden test
  files next to candidate code;
- static source inspection that needs private rule files in the candidate
  process;
- browser, GUI, package-manager, or external-service tasks without a dedicated
  controlled adapter; or
- tasks whose hidden input itself reveals the expected repair or private corpus.

Those cases are excluded, not downgraded to a generic hidden mount. A later
specialized controller may expand coverage only with its own protocol,
adversarial tests, and preregistered scope.

## Planned case schema

The public case definition will add this allowlisted subject declaration:

```toml
[oracle.subject]
protocol = "stdio-jsonl-v1"
isolation_profile = "microvm-kvm-v1"
adapter_image = "registry.example.invalid/memorixbench-subject@sha256:<digest>"
adapter_command = ["/adapter/serve"]
request_schema_sha256 = "<sha256>"
response_schema_sha256 = "<sha256>"
max_requests = 32
max_request_bytes = 16384
max_response_bytes = 65536
startup_timeout_seconds = 15
request_timeout_seconds = 10
total_timeout_seconds = 180
```

The public adapter image, command, schemas, and budgets are part of the public
case hash. The private overlay will separately commit a controller runtime,
controller command, private fixtures, and the test sequence. It will not put
those fields in `case.toml` or a worker bundle.

## Admission gates

Before a case is eligible for confirmatory execution, all of these must pass
for the exact image digests and schemas:

1. The vault is a Linux/amd64 host with usable KVM and launches one new guest
   per hidden case. The guest inspection report has no private-root, parent,
   Docker-socket, named-pipe, device, credential, host-namespace, or network
   access, and no shared host directory after launch.
2. Random private sentinels are absent from the subject filesystem, process
   descriptors, environment, command-line errors, build context, and captured
   outputs.
3. The subject adapter is fixed outside `/work`; an adversarial patch cannot
   replace it, choose a command, expand limits, or influence controller
   arguments.
4. Reference repairs pass through the controller protocol, intentional broken
   repairs fail, and a malicious candidate that searches `/`, reads process
   metadata, emits oversized output, or attempts protocol replay cannot reveal
   a private fixture or change grading semantics.
5. The worker's signed attestation and the vault's grade receipt bind the same
   sealed patch, case hash, subject rootfs/inspect hash, controller-runtime
   commitment, limits, and destruction records.

Until this contract is implemented and those gates pass on the real remote
worker/vault runtime, private results remain diagnostic and excluded from every
aggregate efficacy comparison.
