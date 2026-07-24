"""Versioned runtime-isolation measurement contracts for confirmatory runs."""

from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import datetime, timedelta, timezone
import hashlib
import json
from pathlib import Path
import re

from .attestation import REMOTE_WORKER_VAULT_PROFILE_ID


RUNTIME_MEASUREMENT_POLICY_SCHEMA_VERSION = "runtime-measurement-policy-v1"
RUNTIME_MEASUREMENT_RECEIPT_SCHEMA_VERSION = "runtime-measurement-receipt-v1"
REQUIRED_SUBJECT_ISOLATION_PROFILE = "microvm-kvm-v1"
REQUIRED_NETWORK_POLICY_ID = "model-relay-only-v1"
REQUIRED_MEASUREMENTS = (
    "agent-container-inspection-v1",
    "host-kvm-capability-v1",
    "microvm-runtime-v1",
    "network-egress-policy-v1",
    "worker-destruction-v1",
)
MAX_RECEIPT_AGE_SECONDS = 3600
MAX_CLOCK_SKEW = timedelta(minutes=2)
SHA256_PATTERN = re.compile(r"^[0-9a-f]{64}$")
IDENTIFIER_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")
NONCE_PATTERN = re.compile(r"^[0-9a-f]{32}$")


class RuntimeMeasurementError(ValueError):
    """Raised when runtime-isolation evidence is underspecified or stale."""


def _canonical_json(value: object) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode("ascii")


def _sha256(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def _require_sha256(value: object, *, label: str) -> str:
    if not isinstance(value, str) or not SHA256_PATTERN.fullmatch(value):
        raise RuntimeMeasurementError(f"runtime measurement {label} must be a SHA-256 digest")
    return value


def _require_identifier(value: object, *, label: str) -> str:
    if not isinstance(value, str) or not IDENTIFIER_PATTERN.fullmatch(value):
        raise RuntimeMeasurementError(f"runtime measurement {label} is invalid")
    return value


def _require_positive_int(value: object, *, label: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
        raise RuntimeMeasurementError(f"runtime measurement {label} must be positive")
    return value


def _parse_timestamp(value: object, *, label: str) -> datetime:
    if not isinstance(value, str):
        raise RuntimeMeasurementError(f"runtime measurement {label} must be text")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as error:
        raise RuntimeMeasurementError(f"runtime measurement {label} is invalid") from error
    if parsed.tzinfo is None:
        raise RuntimeMeasurementError(f"runtime measurement {label} must include a timezone")
    return parsed.astimezone(timezone.utc)


@dataclass(frozen=True)
class RuntimeMeasurementPolicy:
    """Frozen controller policy that specifies which private evidence is required."""

    schema_version: str
    policy_id: str
    profile_id: str
    subject_isolation_profile: str
    network_policy_id: str
    required_measurements: tuple[str, ...]
    maximum_receipt_age_seconds: int

    def public_payload(self) -> dict[str, object]:
        payload = asdict(self)
        payload["required_measurements"] = list(self.required_measurements)
        return payload

    @property
    def sha256(self) -> str:
        self.validate()
        return _sha256(_canonical_json(self.public_payload()))

    def validate(self) -> None:
        if self.schema_version != RUNTIME_MEASUREMENT_POLICY_SCHEMA_VERSION:
            raise RuntimeMeasurementError("runtime measurement policy schema is unsupported")
        _require_identifier(self.policy_id, label="policy id")
        if self.profile_id != REMOTE_WORKER_VAULT_PROFILE_ID:
            raise RuntimeMeasurementError("runtime measurement policy profile is unsupported")
        if self.subject_isolation_profile != REQUIRED_SUBJECT_ISOLATION_PROFILE:
            raise RuntimeMeasurementError("runtime measurement policy subject profile is unsupported")
        if self.network_policy_id != REQUIRED_NETWORK_POLICY_ID:
            raise RuntimeMeasurementError("runtime measurement policy network policy is unsupported")
        if self.required_measurements != REQUIRED_MEASUREMENTS:
            raise RuntimeMeasurementError("runtime measurement policy evidence set is unsupported")
        maximum_age = _require_positive_int(
            self.maximum_receipt_age_seconds,
            label="maximum receipt age",
        )
        if maximum_age > MAX_RECEIPT_AGE_SECONDS:
            raise RuntimeMeasurementError("runtime measurement policy receipt age is too large")

    @classmethod
    def from_public_payload(cls, value: object) -> "RuntimeMeasurementPolicy":
        if not isinstance(value, dict):
            raise RuntimeMeasurementError("runtime measurement policy must be an object")
        expected = {
            "schema_version",
            "policy_id",
            "profile_id",
            "subject_isolation_profile",
            "network_policy_id",
            "required_measurements",
            "maximum_receipt_age_seconds",
        }
        if set(value) != expected:
            raise RuntimeMeasurementError("runtime measurement policy has unsupported fields")
        measurements = value.get("required_measurements")
        if not isinstance(measurements, list) or any(
            not isinstance(item, str) for item in measurements
        ):
            raise RuntimeMeasurementError("runtime measurement policy evidence set is invalid")
        policy = cls(
            schema_version=value.get("schema_version"),
            policy_id=value.get("policy_id"),
            profile_id=value.get("profile_id"),
            subject_isolation_profile=value.get("subject_isolation_profile"),
            network_policy_id=value.get("network_policy_id"),
            required_measurements=tuple(measurements),
            maximum_receipt_age_seconds=value.get("maximum_receipt_age_seconds"),
        )
        policy.validate()
        return policy


@dataclass(frozen=True)
class RuntimeMeasurementEvidence:
    measurement_id: str
    evidence_sha256: str

    def public_payload(self) -> dict[str, str]:
        return asdict(self)

    def validate(self) -> None:
        _require_identifier(self.measurement_id, label="evidence id")
        _require_sha256(self.evidence_sha256, label="evidence")


@dataclass(frozen=True)
class RuntimeMeasurementReceipt:
    """Private measurement commitments whose hash is signed by the runtime manager."""

    schema_version: str
    policy_sha256: str
    profile_id: str
    subject_isolation_profile: str
    network_policy_id: str
    run_id: str
    job_sha256: str
    job_nonce: str
    worker_result_sha256: str
    evidence: tuple[RuntimeMeasurementEvidence, ...]
    destruction_receipt_sha256: str
    observed_at: str

    def public_payload(self) -> dict[str, object]:
        payload = asdict(self)
        payload["evidence"] = [item.public_payload() for item in self.evidence]
        return payload

    @property
    def sha256(self) -> str:
        self._validate_unbound()
        return _sha256(_canonical_json(self.public_payload()))

    def _validate_unbound(self) -> None:
        if self.schema_version != RUNTIME_MEASUREMENT_RECEIPT_SCHEMA_VERSION:
            raise RuntimeMeasurementError("runtime measurement receipt schema is unsupported")
        _require_sha256(self.policy_sha256, label="policy")
        if self.profile_id != REMOTE_WORKER_VAULT_PROFILE_ID:
            raise RuntimeMeasurementError("runtime measurement receipt profile is unsupported")
        if self.subject_isolation_profile != REQUIRED_SUBJECT_ISOLATION_PROFILE:
            raise RuntimeMeasurementError("runtime measurement receipt subject profile is unsupported")
        if self.network_policy_id != REQUIRED_NETWORK_POLICY_ID:
            raise RuntimeMeasurementError("runtime measurement receipt network policy is unsupported")
        _require_identifier(self.run_id, label="run id")
        _require_sha256(self.job_sha256, label="job")
        if not NONCE_PATTERN.fullmatch(self.job_nonce):
            raise RuntimeMeasurementError("runtime measurement receipt job nonce is invalid")
        _require_sha256(self.worker_result_sha256, label="worker result")
        _require_sha256(self.destruction_receipt_sha256, label="destruction receipt")
        if tuple(item.measurement_id for item in self.evidence) != REQUIRED_MEASUREMENTS:
            raise RuntimeMeasurementError("runtime measurement receipt evidence set is unsupported")
        for item in self.evidence:
            item.validate()
        _parse_timestamp(self.observed_at, label="observed_at")

    def validate(
        self,
        policy: RuntimeMeasurementPolicy,
        *,
        now: datetime | None = None,
    ) -> None:
        policy.validate()
        self._validate_unbound()
        if self.policy_sha256 != policy.sha256:
            raise RuntimeMeasurementError("runtime measurement receipt policy does not match")
        if self.profile_id != policy.profile_id:
            raise RuntimeMeasurementError("runtime measurement receipt profile does not match")
        if self.subject_isolation_profile != policy.subject_isolation_profile:
            raise RuntimeMeasurementError("runtime measurement receipt subject profile does not match")
        if self.network_policy_id != policy.network_policy_id:
            raise RuntimeMeasurementError("runtime measurement receipt network policy does not match")
        if tuple(item.measurement_id for item in self.evidence) != policy.required_measurements:
            raise RuntimeMeasurementError("runtime measurement receipt evidence set does not match policy")
        observed_at = _parse_timestamp(self.observed_at, label="observed_at")
        verified_now = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
        if observed_at - verified_now > MAX_CLOCK_SKEW:
            raise RuntimeMeasurementError("runtime measurement receipt is observed too far in the future")
        if verified_now - observed_at > timedelta(seconds=policy.maximum_receipt_age_seconds):
            raise RuntimeMeasurementError("runtime measurement receipt is too old")

    @classmethod
    def from_public_payload(
        cls,
        value: object,
        *,
        policy: RuntimeMeasurementPolicy,
        now: datetime | None = None,
    ) -> "RuntimeMeasurementReceipt":
        if not isinstance(value, dict):
            raise RuntimeMeasurementError("runtime measurement receipt must be an object")
        expected = {
            "schema_version",
            "policy_sha256",
            "profile_id",
            "subject_isolation_profile",
            "network_policy_id",
            "run_id",
            "job_sha256",
            "job_nonce",
            "worker_result_sha256",
            "evidence",
            "destruction_receipt_sha256",
            "observed_at",
        }
        if set(value) != expected:
            raise RuntimeMeasurementError("runtime measurement receipt has unsupported fields")
        raw_evidence = value.get("evidence")
        if not isinstance(raw_evidence, list):
            raise RuntimeMeasurementError("runtime measurement receipt evidence is invalid")
        evidence: list[RuntimeMeasurementEvidence] = []
        for item in raw_evidence:
            if not isinstance(item, dict) or set(item) != {"measurement_id", "evidence_sha256"}:
                raise RuntimeMeasurementError("runtime measurement evidence is invalid")
            evidence.append(
                RuntimeMeasurementEvidence(
                    measurement_id=item.get("measurement_id"),
                    evidence_sha256=item.get("evidence_sha256"),
                )
            )
        receipt = cls(
            schema_version=value.get("schema_version"),
            policy_sha256=value.get("policy_sha256"),
            profile_id=value.get("profile_id"),
            subject_isolation_profile=value.get("subject_isolation_profile"),
            network_policy_id=value.get("network_policy_id"),
            run_id=value.get("run_id"),
            job_sha256=value.get("job_sha256"),
            job_nonce=value.get("job_nonce"),
            worker_result_sha256=value.get("worker_result_sha256"),
            evidence=tuple(evidence),
            destruction_receipt_sha256=value.get("destruction_receipt_sha256"),
            observed_at=value.get("observed_at"),
        )
        receipt.validate(policy, now=now)
        return receipt


def load_runtime_measurement_policy(path: str | Path) -> RuntimeMeasurementPolicy:
    source = Path(path)
    try:
        if source.is_symlink() or not source.is_file():
            raise OSError("not a regular file")
        payload = json.loads(source.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise RuntimeMeasurementError("runtime measurement policy cannot be read") from error
    return RuntimeMeasurementPolicy.from_public_payload(payload)


def validate_runtime_measurement_receipt_binding(
    receipt: RuntimeMeasurementReceipt,
    *,
    policy: RuntimeMeasurementPolicy,
    run_id: str,
    job_sha256: str,
    job_nonce: str,
    worker_result_sha256: str,
    destruction_receipt_sha256: str,
    now: datetime | None = None,
) -> None:
    receipt.validate(policy, now=now)
    expected = {
        "run_id": run_id,
        "job_sha256": job_sha256,
        "job_nonce": job_nonce,
        "worker_result_sha256": worker_result_sha256,
        "destruction_receipt_sha256": destruction_receipt_sha256,
    }
    for field, value in expected.items():
        if getattr(receipt, field) != value:
            raise RuntimeMeasurementError(
                f"runtime measurement receipt does not bind the expected {field}"
            )
