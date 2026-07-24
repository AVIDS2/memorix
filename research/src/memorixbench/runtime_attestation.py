"""Independent runtime-manager attestation for remote confirmatory workers."""

from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import datetime, timedelta, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import tempfile

from .attestation import REMOTE_WORKER_VAULT_PROFILE_ID
from .oracle_assets import PINNED_IMAGE_PATTERN


RUNTIME_ATTESTATION_SCHEMA_VERSION = "runtime-attestation-v1"
RUNTIME_ATTESTATION_NAMESPACE = "memorixbench-runtime-attestation-v1"
MAX_RUNTIME_ATTESTATION_LIFETIME = timedelta(hours=1)
MAX_RUNTIME_CLOCK_SKEW = timedelta(minutes=2)
SHA256_PATTERN = re.compile(r"^[0-9a-f]{64}$")
IMAGE_ID_PATTERN = re.compile(r"^sha256:[0-9a-f]{64}$")
IDENTIFIER_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")
NONCE_PATTERN = re.compile(r"^[0-9a-f]{32}$")


class RuntimeAttestationError(ValueError):
    """Raised when a remote runtime manager cannot prove a worker profile."""


def _canonical_json(value: object) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode("ascii")


def _sha256(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def _require_sha256(value: object, *, label: str) -> str:
    if not isinstance(value, str) or not SHA256_PATTERN.fullmatch(value):
        raise RuntimeAttestationError(f"runtime {label} must be a lowercase SHA-256 digest")
    return value


def _require_identifier(value: object, *, label: str) -> str:
    if not isinstance(value, str) or not IDENTIFIER_PATTERN.fullmatch(value):
        raise RuntimeAttestationError(f"runtime {label} is invalid")
    return value


def _require_text(value: object, *, label: str) -> str:
    if not isinstance(value, str) or not value.strip() or "\x00" in value:
        raise RuntimeAttestationError(f"runtime {label} must be non-empty text")
    return value


def _parse_timestamp(value: object, *, label: str) -> datetime:
    if not isinstance(value, str):
        raise RuntimeAttestationError(f"runtime {label} must be text")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as error:
        raise RuntimeAttestationError(f"runtime {label} is not an ISO-8601 timestamp") from error
    if parsed.tzinfo is None:
        raise RuntimeAttestationError(f"runtime {label} must include a UTC offset")
    return parsed.astimezone(timezone.utc)


@dataclass(frozen=True)
class RuntimeAttestation:
    schema_version: str
    profile_id: str
    run_id: str
    job_sha256: str
    job_nonce: str
    worker_result_sha256: str
    controller_policy_sha256: str
    runtime_measurement_policy_sha256: str
    worker_runtime_sha256: str
    agent_image: str
    agent_image_id: str
    tool_catalog_sha256: str
    container_inspection_sha256: str
    network_policy_id: str
    isolation_measurement_sha256: str
    destruction_receipt_sha256: str
    issued_at: str
    expires_at: str

    def public_payload(self) -> dict[str, object]:
        return asdict(self)

    @property
    def payload_sha256(self) -> str:
        return _sha256(_canonical_json(self.public_payload()))

    def canonical_bytes(self) -> bytes:
        self.validate()
        return _canonical_json(self.public_payload())

    def validate(self) -> None:
        if self.schema_version != RUNTIME_ATTESTATION_SCHEMA_VERSION:
            raise RuntimeAttestationError("unsupported runtime attestation schema")
        if self.profile_id != REMOTE_WORKER_VAULT_PROFILE_ID:
            raise RuntimeAttestationError("runtime attestation uses an unsupported profile")
        for label, value in {
            "run id": self.run_id,
            "network policy": self.network_policy_id,
        }.items():
            _require_identifier(value, label=label)
        if self.network_policy_id != "model-relay-only-v1":
            raise RuntimeAttestationError("runtime network policy must be model-relay-only-v1")
        if not NONCE_PATTERN.fullmatch(self.job_nonce):
            raise RuntimeAttestationError("runtime job nonce is invalid")
        for label, value in {
            "job": self.job_sha256,
            "worker result": self.worker_result_sha256,
            "controller policy": self.controller_policy_sha256,
            "measurement policy": self.runtime_measurement_policy_sha256,
            "worker runtime": self.worker_runtime_sha256,
            "tool catalog": self.tool_catalog_sha256,
            "container inspection": self.container_inspection_sha256,
            "isolation measurement": self.isolation_measurement_sha256,
            "destruction receipt": self.destruction_receipt_sha256,
        }.items():
            _require_sha256(value, label=label)
        if not PINNED_IMAGE_PATTERN.fullmatch(self.agent_image):
            raise RuntimeAttestationError("runtime agent image must be pinned by digest")
        if not IMAGE_ID_PATTERN.fullmatch(self.agent_image_id):
            raise RuntimeAttestationError("runtime agent image id is invalid")
        issued_at = _parse_timestamp(self.issued_at, label="issued_at")
        expires_at = _parse_timestamp(self.expires_at, label="expires_at")
        if expires_at <= issued_at:
            raise RuntimeAttestationError("runtime attestation expires before it is issued")
        if expires_at - issued_at > MAX_RUNTIME_ATTESTATION_LIFETIME:
            raise RuntimeAttestationError("runtime attestation lifetime exceeds the profile limit")

    @classmethod
    def from_public_payload(cls, value: object) -> "RuntimeAttestation":
        if not isinstance(value, dict):
            raise RuntimeAttestationError("runtime attestation must be an object")
        expected = {
            "schema_version",
            "profile_id",
            "run_id",
            "job_sha256",
            "job_nonce",
            "worker_result_sha256",
            "controller_policy_sha256",
            "runtime_measurement_policy_sha256",
            "worker_runtime_sha256",
            "agent_image",
            "agent_image_id",
            "tool_catalog_sha256",
            "container_inspection_sha256",
            "network_policy_id",
            "isolation_measurement_sha256",
            "destruction_receipt_sha256",
            "issued_at",
            "expires_at",
        }
        if set(value) != expected:
            raise RuntimeAttestationError("runtime attestation has unsupported fields")
        attestation = cls(
            schema_version=_require_text(value.get("schema_version"), label="schema version"),
            profile_id=_require_text(value.get("profile_id"), label="profile id"),
            run_id=_require_identifier(value.get("run_id"), label="run id"),
            job_sha256=_require_sha256(value.get("job_sha256"), label="job"),
            job_nonce=_require_text(value.get("job_nonce"), label="job nonce"),
            worker_result_sha256=_require_sha256(value.get("worker_result_sha256"), label="worker result"),
            controller_policy_sha256=_require_sha256(value.get("controller_policy_sha256"), label="controller policy"),
            runtime_measurement_policy_sha256=_require_sha256(value.get("runtime_measurement_policy_sha256"), label="measurement policy"),
            worker_runtime_sha256=_require_sha256(value.get("worker_runtime_sha256"), label="worker runtime"),
            agent_image=_require_text(value.get("agent_image"), label="agent image"),
            agent_image_id=_require_text(value.get("agent_image_id"), label="agent image id"),
            tool_catalog_sha256=_require_sha256(value.get("tool_catalog_sha256"), label="tool catalog"),
            container_inspection_sha256=_require_sha256(value.get("container_inspection_sha256"), label="container inspection"),
            network_policy_id=_require_identifier(value.get("network_policy_id"), label="network policy"),
            isolation_measurement_sha256=_require_sha256(value.get("isolation_measurement_sha256"), label="isolation measurement"),
            destruction_receipt_sha256=_require_sha256(value.get("destruction_receipt_sha256"), label="destruction receipt"),
            issued_at=_require_text(value.get("issued_at"), label="issued_at"),
            expires_at=_require_text(value.get("expires_at"), label="expires_at"),
        )
        attestation.validate()
        return attestation


@dataclass(frozen=True)
class SignedRuntimeAttestation:
    signer_principal: str
    attestation: RuntimeAttestation
    armored_signature: str

    @property
    def signature_sha256(self) -> str:
        return _sha256(self.armored_signature.encode("utf-8"))

    def public_payload(self) -> dict[str, object]:
        return {
            "schema_version": RUNTIME_ATTESTATION_SCHEMA_VERSION,
            "signer_principal": self.signer_principal,
            "attestation": self.attestation.public_payload(),
            "armored_signature": self.armored_signature,
            "signature_sha256": self.signature_sha256,
        }

    def validate(self) -> None:
        _require_identifier(self.signer_principal, label="signer principal")
        self.attestation.validate()
        if not self.armored_signature.startswith("-----BEGIN SSH SIGNATURE-----"):
            raise RuntimeAttestationError("runtime signature is not an OpenSSH signature")

    @classmethod
    def from_public_payload(cls, value: object) -> "SignedRuntimeAttestation":
        if not isinstance(value, dict):
            raise RuntimeAttestationError("signed runtime attestation must be an object")
        expected = {
            "schema_version",
            "signer_principal",
            "attestation",
            "armored_signature",
            "signature_sha256",
        }
        if set(value) != expected or value.get("schema_version") != RUNTIME_ATTESTATION_SCHEMA_VERSION:
            raise RuntimeAttestationError("signed runtime attestation has unsupported fields")
        signature = _require_text(value.get("armored_signature"), label="signature")
        signed = cls(
            signer_principal=_require_identifier(
                value.get("signer_principal"),
                label="signer principal",
            ),
            attestation=RuntimeAttestation.from_public_payload(value.get("attestation")),
            armored_signature=signature,
        )
        if _require_sha256(value.get("signature_sha256"), label="signature") != signed.signature_sha256:
            raise RuntimeAttestationError("runtime signature digest does not match")
        signed.validate()
        return signed


@dataclass(frozen=True)
class RuntimeAttestationVerification:
    signer_principal: str
    attestation_payload_sha256: str
    signature_sha256: str
    verified_at: str


def load_signed_runtime_attestation(path: str | Path) -> SignedRuntimeAttestation:
    source = Path(path)
    try:
        metadata = os.lstat(source)
        attributes = getattr(metadata, "st_file_attributes", 0)
        reparse_flag = getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0)
        if source.is_symlink() or bool(attributes & reparse_flag) or not stat.S_ISREG(metadata.st_mode):
            raise OSError("not a regular file")
        payload = json.loads(source.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise RuntimeAttestationError("signed runtime attestation cannot be read") from error
    return SignedRuntimeAttestation.from_public_payload(payload)


def sign_runtime_attestation(
    attestation: RuntimeAttestation,
    *,
    signer_principal: str,
    private_key: str | Path,
    ssh_keygen_binary: str = "ssh-keygen",
) -> SignedRuntimeAttestation:
    attestation.validate()
    _require_identifier(signer_principal, label="signer principal")
    key_path = Path(private_key)
    if not key_path.is_file():
        raise RuntimeAttestationError("runtime signing key is unavailable")
    with tempfile.TemporaryDirectory(prefix="memorixbench-runtime-attestation-") as directory:
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
                    RUNTIME_ATTESTATION_NAMESPACE,
                    str(payload_path),
                ],
                check=False,
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
            )
        except FileNotFoundError as error:
            raise RuntimeAttestationError("ssh-keygen is unavailable for runtime attestation") from error
        if completed.returncode != 0:
            raise RuntimeAttestationError("runtime attestation signing failed")
        signature_path = Path(str(payload_path) + ".sig")
        try:
            signature = signature_path.read_text(encoding="utf-8")
        except OSError as error:
            raise RuntimeAttestationError("runtime attestation signature was not created") from error
    signed = SignedRuntimeAttestation(
        signer_principal=signer_principal,
        attestation=attestation,
        armored_signature=signature,
    )
    signed.validate()
    return signed


def verify_runtime_attestation(
    signed: SignedRuntimeAttestation,
    *,
    allowed_signers: str | Path,
    now: datetime | None = None,
    ssh_keygen_binary: str = "ssh-keygen",
) -> RuntimeAttestationVerification:
    signed.validate()
    allowed_signers_path = Path(allowed_signers)
    if not allowed_signers_path.is_file():
        raise RuntimeAttestationError("trusted runtime signers file is unavailable")
    verified_now = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
    issued_at = _parse_timestamp(signed.attestation.issued_at, label="issued_at")
    expires_at = _parse_timestamp(signed.attestation.expires_at, label="expires_at")
    if issued_at - verified_now > MAX_RUNTIME_CLOCK_SKEW:
        raise RuntimeAttestationError("runtime attestation is issued too far in the future")
    if expires_at <= verified_now:
        raise RuntimeAttestationError("runtime attestation has expired")
    if verified_now - issued_at > MAX_RUNTIME_ATTESTATION_LIFETIME + MAX_RUNTIME_CLOCK_SKEW:
        raise RuntimeAttestationError("runtime attestation is too old")
    with tempfile.TemporaryDirectory(prefix="memorixbench-runtime-attestation-") as directory:
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
                    RUNTIME_ATTESTATION_NAMESPACE,
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
            raise RuntimeAttestationError("ssh-keygen is unavailable for runtime verification") from error
    if completed.returncode != 0:
        raise RuntimeAttestationError("runtime attestation signature verification failed")
    return RuntimeAttestationVerification(
        signer_principal=signed.signer_principal,
        attestation_payload_sha256=signed.attestation.payload_sha256,
        signature_sha256=signed.signature_sha256,
        verified_at=verified_now.isoformat(),
    )


def validate_runtime_attestation_binding(
    attestation: RuntimeAttestation,
    *,
    controller_policy_sha256: str,
    runtime_measurement_policy_sha256: str,
    run_id: str,
    job_sha256: str,
    job_nonce: str,
    worker_result_sha256: str,
    worker_runtime_sha256: str,
    agent_image: str,
    agent_image_id: str,
    tool_catalog_sha256: str,
    container_inspection_sha256: str,
) -> None:
    attestation.validate()
    expected = {
        "controller_policy_sha256": controller_policy_sha256,
        "runtime_measurement_policy_sha256": runtime_measurement_policy_sha256,
        "run_id": run_id,
        "job_sha256": job_sha256,
        "job_nonce": job_nonce,
        "worker_result_sha256": worker_result_sha256,
        "worker_runtime_sha256": worker_runtime_sha256,
        "agent_image": agent_image,
        "agent_image_id": agent_image_id,
        "tool_catalog_sha256": tool_catalog_sha256,
        "container_inspection_sha256": container_inspection_sha256,
    }
    for field, value in expected.items():
        if getattr(attestation, field) != value:
            raise RuntimeAttestationError(
                f"runtime attestation does not bind the expected {field}"
            )
