from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import datetime, timedelta, timezone
import hashlib
import json
from pathlib import Path
import re
import subprocess
import tempfile

from .oracle_assets import PINNED_IMAGE_PATTERN


WORKER_ATTESTATION_SCHEMA_VERSION = "0.1"
REMOTE_WORKER_VAULT_PROFILE_ID = "remote-worker-vault-v1"
WORKER_ATTESTATION_NAMESPACE = "memorixbench-worker-attestation-v1"
MAX_ATTESTATION_LIFETIME = timedelta(hours=1)
MAX_CLOCK_SKEW = timedelta(minutes=2)
SHA256_PATTERN = re.compile(r"^[0-9a-f]{64}$")
IMAGE_ID_PATTERN = re.compile(r"^sha256:[0-9a-f]{64}$")
IDENTIFIER_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")


class AttestationError(ValueError):
    """Raised when a worker attestation cannot support a confirmatory run."""


def _canonical_json(value: object) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode("ascii")


def _sha256(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def _require_sha256(value: str, *, label: str) -> None:
    if not SHA256_PATTERN.fullmatch(value):
        raise AttestationError(f"{label} must be a lowercase SHA-256 digest")


def _require_identifier(value: str, *, label: str) -> None:
    if not IDENTIFIER_PATTERN.fullmatch(value):
        raise AttestationError(f"{label} is invalid")


def _required_text(value: object, *, label: str) -> str:
    if not isinstance(value, str):
        raise AttestationError(f"{label} must be text")
    return value


def _required_bool(value: object, *, label: str) -> bool:
    if not isinstance(value, bool):
        raise AttestationError(f"{label} must be boolean")
    return value


def _required_nonnegative_int(value: object, *, label: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise AttestationError(f"{label} must be a non-negative integer")
    return value


def _parse_timestamp(value: str, *, label: str) -> datetime:
    try:
        timestamp = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as error:
        raise AttestationError(f"{label} is not an ISO-8601 timestamp") from error
    if timestamp.tzinfo is None:
        raise AttestationError(f"{label} must include a UTC offset")
    return timestamp.astimezone(timezone.utc)


@dataclass(frozen=True)
class WorkerIsolationSummary:
    network_policy_id: str
    privileged: bool
    read_only_rootfs: bool
    dropped_capabilities: tuple[str, ...]
    no_new_privileges: bool
    host_pid_namespace: bool
    host_ipc_namespace: bool
    host_uts_namespace: bool
    host_user_namespace: bool
    host_network: bool
    workspace_mount_count: int
    runtime_config_mount_count: int
    oracle_mount_count: int
    socket_mount_count: int
    device_mount_count: int
    credential_mount_count: int
    unexpected_mount_count: int
    agent_container_destroyed: bool
    destruction_receipt_sha256: str

    def validate(self) -> None:
        _require_identifier(self.network_policy_id, label="network policy")
        if self.network_policy_id != "model-relay-only-v1":
            raise AttestationError("worker network policy must be model-relay-only-v1")
        if self.privileged or not self.read_only_rootfs or not self.no_new_privileges:
            raise AttestationError("worker container hardening is incomplete")
        if any((
            self.host_pid_namespace,
            self.host_ipc_namespace,
            self.host_uts_namespace,
            self.host_user_namespace,
            self.host_network,
        )):
            raise AttestationError("worker container joined a forbidden host namespace")
        normalized_capabilities = {item.upper() for item in self.dropped_capabilities}
        if normalized_capabilities != {"ALL"}:
            raise AttestationError("worker container must drop all Linux capabilities")
        counts = {
            "workspace mount": self.workspace_mount_count,
            "runtime config mount": self.runtime_config_mount_count,
            "oracle mount": self.oracle_mount_count,
            "socket mount": self.socket_mount_count,
            "device mount": self.device_mount_count,
            "credential mount": self.credential_mount_count,
            "unexpected mount": self.unexpected_mount_count,
        }
        if any(value < 0 for value in counts.values()):
            raise AttestationError("worker mount counts must be non-negative")
        if self.workspace_mount_count != 1 or self.runtime_config_mount_count > 1:
            raise AttestationError("worker mount layout does not match the profile")
        if any(
            value != 0
            for label, value in counts.items()
            if label not in {"workspace mount", "runtime config mount"}
        ):
            raise AttestationError("worker has a forbidden mount")
        if not self.agent_container_destroyed:
            raise AttestationError("worker container destruction was not attested")
        _require_sha256(self.destruction_receipt_sha256, label="destruction receipt")


@dataclass(frozen=True)
class WorkerAttestation:
    schema_version: str
    profile_id: str
    run_id: str
    case_id: str
    condition: str
    agent: str
    job_sha256: str
    public_case_definition_sha256: str
    public_bundle_sha256: str
    prompt_sha256: str
    memory_snapshot_sha256: str
    workspace_snapshot_sha256: str
    sealed_patch_sha256: str
    sealed_patch_bytes: int
    worker_runtime_sha256: str
    agent_image: str
    agent_image_id: str
    tool_catalog_sha256: str
    container_inspection_sha256: str
    model_relay_policy_sha256: str
    environment_allowlist_sha256: str
    sentinel_suite_sha256: str
    isolation: WorkerIsolationSummary
    issued_at: str
    expires_at: str

    def public_payload(self) -> dict[str, object]:
        payload = asdict(self)
        isolation = payload["isolation"]
        assert isinstance(isolation, dict)
        isolation["dropped_capabilities"] = list(self.isolation.dropped_capabilities)
        return payload

    @property
    def payload_sha256(self) -> str:
        return _sha256(_canonical_json(self.public_payload()))

    def canonical_bytes(self) -> bytes:
        self.validate()
        return _canonical_json(self.public_payload())

    def validate(self) -> None:
        if self.schema_version != WORKER_ATTESTATION_SCHEMA_VERSION:
            raise AttestationError("unsupported worker attestation schema")
        if self.profile_id != REMOTE_WORKER_VAULT_PROFILE_ID:
            raise AttestationError("worker attestation does not use the remote worker/vault profile")
        for label, value in {
            "run id": self.run_id,
            "case id": self.case_id,
            "condition": self.condition,
            "agent": self.agent,
        }.items():
            _require_identifier(value, label=label)
        if self.agent not in {"claude", "codex"}:
            raise AttestationError("worker attestation has an unsupported agent")
        for label, value in {
            "job": self.job_sha256,
            "public case definition": self.public_case_definition_sha256,
            "public bundle": self.public_bundle_sha256,
            "prompt": self.prompt_sha256,
            "memory snapshot": self.memory_snapshot_sha256,
            "workspace snapshot": self.workspace_snapshot_sha256,
            "sealed patch": self.sealed_patch_sha256,
            "worker runtime": self.worker_runtime_sha256,
            "tool catalog": self.tool_catalog_sha256,
            "container inspection": self.container_inspection_sha256,
            "model relay policy": self.model_relay_policy_sha256,
            "environment allowlist": self.environment_allowlist_sha256,
            "sentinel suite": self.sentinel_suite_sha256,
        }.items():
            _require_sha256(value, label=label)
        if self.sealed_patch_bytes < 0:
            raise AttestationError("sealed patch byte count must be non-negative")
        if not PINNED_IMAGE_PATTERN.fullmatch(self.agent_image):
            raise AttestationError("worker agent image must be pinned by sha256 digest")
        if not IMAGE_ID_PATTERN.fullmatch(self.agent_image_id):
            raise AttestationError("worker agent image id is invalid")
        self.isolation.validate()
        issued_at = _parse_timestamp(self.issued_at, label="issued_at")
        expires_at = _parse_timestamp(self.expires_at, label="expires_at")
        if expires_at <= issued_at:
            raise AttestationError("worker attestation expires before it is issued")
        if expires_at - issued_at > MAX_ATTESTATION_LIFETIME:
            raise AttestationError("worker attestation lifetime exceeds the profile limit")

    @classmethod
    def from_public_payload(cls, value: dict[str, object]) -> WorkerAttestation:
        expected = {
            "schema_version",
            "profile_id",
            "run_id",
            "case_id",
            "condition",
            "agent",
            "job_sha256",
            "public_case_definition_sha256",
            "public_bundle_sha256",
            "prompt_sha256",
            "memory_snapshot_sha256",
            "workspace_snapshot_sha256",
            "sealed_patch_sha256",
            "sealed_patch_bytes",
            "worker_runtime_sha256",
            "agent_image",
            "agent_image_id",
            "tool_catalog_sha256",
            "container_inspection_sha256",
            "model_relay_policy_sha256",
            "environment_allowlist_sha256",
            "sentinel_suite_sha256",
            "isolation",
            "issued_at",
            "expires_at",
        }
        if set(value) != expected:
            raise AttestationError("worker attestation has unexpected fields")
        isolation_value = value.get("isolation")
        if not isinstance(isolation_value, dict):
            raise AttestationError("worker attestation isolation summary is invalid")
        isolation_expected = {
            "network_policy_id",
            "privileged",
            "read_only_rootfs",
            "dropped_capabilities",
            "no_new_privileges",
            "host_pid_namespace",
            "host_ipc_namespace",
            "host_uts_namespace",
            "host_user_namespace",
            "host_network",
            "workspace_mount_count",
            "runtime_config_mount_count",
            "oracle_mount_count",
            "socket_mount_count",
            "device_mount_count",
            "credential_mount_count",
            "unexpected_mount_count",
            "agent_container_destroyed",
            "destruction_receipt_sha256",
        }
        if set(isolation_value) != isolation_expected:
            raise AttestationError("worker attestation isolation fields are invalid")
        dropped = isolation_value.get("dropped_capabilities")
        if not isinstance(dropped, list) or any(not isinstance(item, str) for item in dropped):
            raise AttestationError("worker attestation dropped capabilities are invalid")
        try:
            isolation = WorkerIsolationSummary(
                network_policy_id=_required_text(
                    isolation_value["network_policy_id"],
                    label="worker network policy",
                ),
                privileged=_required_bool(
                    isolation_value["privileged"],
                    label="worker privileged",
                ),
                read_only_rootfs=_required_bool(
                    isolation_value["read_only_rootfs"],
                    label="worker read-only rootfs",
                ),
                dropped_capabilities=tuple(dropped),
                no_new_privileges=_required_bool(
                    isolation_value["no_new_privileges"],
                    label="worker no-new-privileges",
                ),
                host_pid_namespace=_required_bool(
                    isolation_value["host_pid_namespace"],
                    label="worker host PID namespace",
                ),
                host_ipc_namespace=_required_bool(
                    isolation_value["host_ipc_namespace"],
                    label="worker host IPC namespace",
                ),
                host_uts_namespace=_required_bool(
                    isolation_value["host_uts_namespace"],
                    label="worker host UTS namespace",
                ),
                host_user_namespace=_required_bool(
                    isolation_value["host_user_namespace"],
                    label="worker host user namespace",
                ),
                host_network=_required_bool(
                    isolation_value["host_network"],
                    label="worker host network",
                ),
                workspace_mount_count=_required_nonnegative_int(
                    isolation_value["workspace_mount_count"],
                    label="worker workspace mount count",
                ),
                runtime_config_mount_count=_required_nonnegative_int(
                    isolation_value["runtime_config_mount_count"],
                    label="worker runtime config mount count",
                ),
                oracle_mount_count=_required_nonnegative_int(
                    isolation_value["oracle_mount_count"],
                    label="worker oracle mount count",
                ),
                socket_mount_count=_required_nonnegative_int(
                    isolation_value["socket_mount_count"],
                    label="worker socket mount count",
                ),
                device_mount_count=_required_nonnegative_int(
                    isolation_value["device_mount_count"],
                    label="worker device mount count",
                ),
                credential_mount_count=_required_nonnegative_int(
                    isolation_value["credential_mount_count"],
                    label="worker credential mount count",
                ),
                unexpected_mount_count=_required_nonnegative_int(
                    isolation_value["unexpected_mount_count"],
                    label="worker unexpected mount count",
                ),
                agent_container_destroyed=_required_bool(
                    isolation_value["agent_container_destroyed"],
                    label="worker container destruction",
                ),
                destruction_receipt_sha256=_required_text(
                    isolation_value["destruction_receipt_sha256"],
                    label="worker destruction receipt",
                ),
            )
            attestation = cls(
                schema_version=_required_text(value["schema_version"], label="schema version"),
                profile_id=_required_text(value["profile_id"], label="profile id"),
                run_id=_required_text(value["run_id"], label="run id"),
                case_id=_required_text(value["case_id"], label="case id"),
                condition=_required_text(value["condition"], label="condition"),
                agent=_required_text(value["agent"], label="agent"),
                job_sha256=_required_text(value["job_sha256"], label="job hash"),
                public_case_definition_sha256=_required_text(
                    value["public_case_definition_sha256"],
                    label="public case definition hash",
                ),
                public_bundle_sha256=_required_text(
                    value["public_bundle_sha256"],
                    label="public bundle hash",
                ),
                prompt_sha256=_required_text(value["prompt_sha256"], label="prompt hash"),
                memory_snapshot_sha256=_required_text(
                    value["memory_snapshot_sha256"],
                    label="memory snapshot hash",
                ),
                workspace_snapshot_sha256=_required_text(
                    value["workspace_snapshot_sha256"],
                    label="workspace snapshot hash",
                ),
                sealed_patch_sha256=_required_text(
                    value["sealed_patch_sha256"],
                    label="sealed patch hash",
                ),
                sealed_patch_bytes=_required_nonnegative_int(
                    value["sealed_patch_bytes"],
                    label="sealed patch byte count",
                ),
                worker_runtime_sha256=_required_text(
                    value["worker_runtime_sha256"],
                    label="worker runtime hash",
                ),
                agent_image=_required_text(value["agent_image"], label="agent image"),
                agent_image_id=_required_text(value["agent_image_id"], label="agent image id"),
                tool_catalog_sha256=_required_text(
                    value["tool_catalog_sha256"],
                    label="tool catalog hash",
                ),
                container_inspection_sha256=_required_text(
                    value["container_inspection_sha256"],
                    label="container inspection hash",
                ),
                model_relay_policy_sha256=_required_text(
                    value["model_relay_policy_sha256"],
                    label="model relay policy hash",
                ),
                environment_allowlist_sha256=_required_text(
                    value["environment_allowlist_sha256"],
                    label="environment allowlist hash",
                ),
                sentinel_suite_sha256=_required_text(
                    value["sentinel_suite_sha256"],
                    label="sentinel suite hash",
                ),
                isolation=isolation,
                issued_at=_required_text(value["issued_at"], label="issued_at"),
                expires_at=_required_text(value["expires_at"], label="expires_at"),
            )
        except AttestationError:
            raise
        except (KeyError, TypeError, ValueError) as error:
            raise AttestationError("worker attestation fields are invalid") from error
        attestation.validate()
        return attestation


@dataclass(frozen=True)
class SignedWorkerAttestation:
    signer_principal: str
    attestation: WorkerAttestation
    armored_signature: str

    @property
    def signature_sha256(self) -> str:
        return _sha256(self.armored_signature.encode("utf-8"))

    def public_payload(self) -> dict[str, object]:
        return {
            "schema_version": WORKER_ATTESTATION_SCHEMA_VERSION,
            "signer_principal": self.signer_principal,
            "attestation": self.attestation.public_payload(),
            "armored_signature": self.armored_signature,
            "signature_sha256": self.signature_sha256,
        }

    def validate(self) -> None:
        _require_identifier(self.signer_principal, label="worker signer principal")
        self.attestation.validate()
        if not self.armored_signature.startswith("-----BEGIN SSH SIGNATURE-----"):
            raise AttestationError("worker attestation signature is not an OpenSSH signature")


@dataclass(frozen=True)
class AttestationVerification:
    profile_id: str
    signer_principal: str
    attestation_payload_sha256: str
    signature_sha256: str
    verified_at: str

    def public_payload(self) -> dict[str, object]:
        return asdict(self)


def sign_worker_attestation(
    attestation: WorkerAttestation,
    *,
    signer_principal: str,
    private_key: str | Path,
    ssh_keygen_binary: str = "ssh-keygen",
) -> SignedWorkerAttestation:
    """Sign a canonical worker attestation with an isolated worker key."""

    attestation.validate()
    _require_identifier(signer_principal, label="worker signer principal")
    key_path = Path(private_key)
    if not key_path.is_file():
        raise AttestationError("worker signing key is unavailable")
    with tempfile.TemporaryDirectory(prefix="memorixbench-attestation-") as directory:
        payload_path = Path(directory) / "attestation.json"
        payload_path.write_bytes(attestation.canonical_bytes())
        try:
            completed = subprocess.run(
                [
                    ssh_keygen_binary,
                    "-Y",
                    "sign",
                    "-f",
                    str(key_path),
                    "-n",
                    WORKER_ATTESTATION_NAMESPACE,
                    str(payload_path),
                ],
                check=False,
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
            )
        except FileNotFoundError as error:
            raise AttestationError("ssh-keygen is unavailable for worker attestation") from error
        if completed.returncode != 0:
            raise AttestationError("worker attestation signing failed")
        signature_path = Path(str(payload_path) + ".sig")
        try:
            signature = signature_path.read_text(encoding="utf-8")
        except OSError as error:
            raise AttestationError("worker attestation signature was not created") from error
    signed = SignedWorkerAttestation(
        signer_principal=signer_principal,
        attestation=attestation,
        armored_signature=signature,
    )
    signed.validate()
    return signed


def verify_worker_attestation(
    signed: SignedWorkerAttestation,
    *,
    allowed_signers: str | Path,
    now: datetime | None = None,
    ssh_keygen_binary: str = "ssh-keygen",
) -> AttestationVerification:
    """Verify a worker signature and its short-lived confirmatory binding."""

    signed.validate()
    allowed_signers_path = Path(allowed_signers)
    if not allowed_signers_path.is_file():
        raise AttestationError("trusted worker signers file is unavailable")
    verified_now = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
    issued_at = _parse_timestamp(signed.attestation.issued_at, label="issued_at")
    expires_at = _parse_timestamp(signed.attestation.expires_at, label="expires_at")
    if issued_at - verified_now > MAX_CLOCK_SKEW:
        raise AttestationError("worker attestation is issued too far in the future")
    if expires_at <= verified_now:
        raise AttestationError("worker attestation has expired")
    if verified_now - issued_at > MAX_ATTESTATION_LIFETIME + MAX_CLOCK_SKEW:
        raise AttestationError("worker attestation is too old")
    with tempfile.TemporaryDirectory(prefix="memorixbench-attestation-") as directory:
        root = Path(directory)
        signature_path = root / "attestation.sig"
        signature_path.write_text(signed.armored_signature, encoding="utf-8")
        try:
            completed = subprocess.run(
                [
                    ssh_keygen_binary,
                    "-Y",
                    "verify",
                    "-f",
                    str(allowed_signers_path),
                    "-I",
                    signed.signer_principal,
                    "-n",
                    WORKER_ATTESTATION_NAMESPACE,
                    "-s",
                    str(signature_path),
                ],
                input=signed.attestation.canonical_bytes().decode("ascii"),
                check=False,
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
            )
        except FileNotFoundError as error:
            raise AttestationError("ssh-keygen is unavailable for worker attestation") from error
    if completed.returncode != 0:
        raise AttestationError("worker attestation signature verification failed")
    return AttestationVerification(
        profile_id=signed.attestation.profile_id,
        signer_principal=signed.signer_principal,
        attestation_payload_sha256=signed.attestation.payload_sha256,
        signature_sha256=signed.signature_sha256,
        verified_at=verified_now.isoformat(),
    )


def validate_attestation_binding(
    attestation: WorkerAttestation,
    *,
    run_id: str,
    case_id: str,
    condition: str,
    agent: str,
    job_sha256: str,
    public_case_definition_sha256: str,
    workspace_snapshot_sha256: str,
    sealed_patch_sha256: str,
    sealed_patch_bytes: int,
) -> None:
    """Reject a signed statement that is valid cryptographically but binds another run."""

    attestation.validate()
    expected = {
        "run_id": run_id,
        "case_id": case_id,
        "condition": condition,
        "agent": agent,
        "job_sha256": job_sha256,
        "public_case_definition_sha256": public_case_definition_sha256,
        "workspace_snapshot_sha256": workspace_snapshot_sha256,
        "sealed_patch_sha256": sealed_patch_sha256,
        "sealed_patch_bytes": sealed_patch_bytes,
    }
    for field, value in expected.items():
        if getattr(attestation, field) != value:
            raise AttestationError(f"worker attestation does not bind the expected {field}")
