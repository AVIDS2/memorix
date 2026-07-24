from __future__ import annotations

import base64
import binascii
from dataclasses import asdict, dataclass
from datetime import datetime, timedelta, timezone
import hashlib
import json
import re
import shlex
from pathlib import Path
import sqlite3
import stat
from typing import TYPE_CHECKING

from .admission import AdmissionReviewError, load_admission_review, validate_admission_review
from .attestation import (
    REMOTE_WORKER_VAULT_PROFILE_ID,
    AttestationError,
    SignedWorkerAttestation,
    validate_attestation_binding,
    verify_worker_attestation,
)
from .blackbox import BlackBoxError, SubjectProtocol
from .model_relay import (
    ModelRelayAttestationError,
    SignedModelRelayAttestation,
    validate_model_label,
    validate_model_relay_binding,
    verify_model_relay_attestation,
)
from .runtime_attestation import (
    RuntimeAttestationError,
    SignedRuntimeAttestation,
    validate_runtime_attestation_binding,
    verify_runtime_attestation,
)
from .runtime_measurement import (
    RuntimeMeasurementError,
    RuntimeMeasurementPolicy,
    RuntimeMeasurementReceipt,
    validate_runtime_measurement_receipt_binding,
)
from .case_bundle import public_case_definition_hash
from .oracle_assets import PINNED_IMAGE_PATTERN
from .preflight import PreflightError, load_environment_preflight_receipt
from .registry import CaseRegistry, CaseRegistryEntry, CaseRegistryError, validate_case_registry
from .sealed_patch import SealedPatch
from .source_ledger import (
    SourceLedgerError,
    load_source_ledger,
    validate_source_ledger,
)
from .worker_protocol import (
    WORKER_JOB_SCHEMA_VERSION,
    WORKER_RESULT_SCHEMA_VERSION,
    WorkerJob,
    WorkerProtocolError,
    WorkerResult,
    reconstruct_sealed_patch_in_vault,
)

if TYPE_CHECKING:
    from .schema import CaseManifest


CONFIRMATORY_PERMIT_SCHEMA_VERSION = "0.6"
PERMIT_REDEMPTION_SCHEMA_VERSION = "0.3"
SHA256_PATTERN = re.compile(r"^[0-9a-f]{64}$")
IDENTIFIER_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")
MAX_SOURCE_ADMISSION_AGE = timedelta(days=14)
MAX_SOURCE_ADMISSION_FUTURE_SKEW = timedelta(minutes=10)


class ConfirmatoryPermitError(ValueError):
    """Raised when a proposed run cannot enter the confirmatory execution path."""


def _canonical_sha256(payload: dict[str, object]) -> str:
    encoded = json.dumps(
        payload,
        sort_keys=True,
        separators=(",", ","),
        ensure_ascii=True,
    ).encode("ascii")
    return hashlib.sha256(encoded).hexdigest()


def _require_sha256(value: object, *, label: str) -> str:
    if not isinstance(value, str) or not SHA256_PATTERN.fullmatch(value):
        raise ConfirmatoryPermitError(f"{label} must be a lowercase SHA-256 digest")
    return value


def _trusted_file_sha256(path: Path, *, label: str) -> str:
    try:
        metadata = path.lstat()
    except OSError as error:
        raise ConfirmatoryPermitError(f"trusted {label} is unavailable") from error
    if path.is_symlink() or not stat.S_ISREG(metadata.st_mode):
        raise ConfirmatoryPermitError(f"trusted {label} must be a regular file")
    try:
        return hashlib.sha256(path.read_bytes()).hexdigest()
    except OSError as error:
        raise ConfirmatoryPermitError(f"trusted {label} cannot be read") from error


def _allowed_signer_key_fingerprints(path: Path, *, label: str) -> frozenset[str]:
    """Extract public-key fingerprints without trusting signer-file paths."""

    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except OSError as error:
        raise ConfirmatoryPermitError(f"trusted {label} cannot be read") from error
    fingerprints: set[str] = set()
    for line in lines:
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        try:
            parts = shlex.split(stripped)
        except ValueError as error:
            raise ConfirmatoryPermitError(f"trusted {label} has invalid signer syntax") from error
        key_index = next(
            (
                index
                for index, value in enumerate(parts)
                if value.startswith(("ssh-", "ecdsa-", "sk-"))
            ),
            None,
        )
        if key_index is None or key_index + 1 >= len(parts):
            raise ConfirmatoryPermitError(f"trusted {label} has no OpenSSH public key")
        try:
            key_blob = base64.b64decode(parts[key_index + 1], validate=True)
        except (binascii.Error, ValueError) as error:
            raise ConfirmatoryPermitError(f"trusted {label} has invalid public-key data") from error
        if not key_blob:
            raise ConfirmatoryPermitError(f"trusted {label} has an empty public key")
        fingerprints.add(hashlib.sha256(key_blob).hexdigest())
    if not fingerprints:
        raise ConfirmatoryPermitError(f"trusted {label} has no public keys")
    return frozenset(fingerprints)


def _require_recent_source_timestamp(value: str, *, label: str, now: datetime) -> None:
    try:
        observed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as error:
        raise ConfirmatoryPermitError(f"{label} timestamp is invalid") from error
    if observed.tzinfo is None:
        raise ConfirmatoryPermitError(f"{label} timestamp must include a timezone")
    observed = observed.astimezone(timezone.utc)
    if observed - now > MAX_SOURCE_ADMISSION_FUTURE_SKEW:
        raise ConfirmatoryPermitError(f"{label} timestamp is too far in the future")
    if now - observed > MAX_SOURCE_ADMISSION_AGE:
        raise ConfirmatoryPermitError(f"{label} is older than the confirmatory admission window")


@dataclass(frozen=True)
class ControllerTrustPolicy:
    """Controller-owned expectations that a worker cannot choose for itself."""

    policy_id: str
    allowed_signers: Path
    allowed_model_relay_signers: Path
    allowed_runtime_attestation_signers: Path
    subject_protocol: SubjectProtocol
    expected_worker_runtime_sha256: str
    expected_agent_image: str
    expected_agent_image_id: str
    expected_tool_catalog_sha256: str
    expected_container_inspection_sha256: str
    runtime_measurement_policy: RuntimeMeasurementPolicy
    expected_model_relay_policy_sha256: str
    expected_model_route_id: str
    expected_requested_model: str
    expected_actual_model: str
    expected_environment_allowlist_sha256: str
    expected_sentinel_suite_sha256: str
    profile_id: str = REMOTE_WORKER_VAULT_PROFILE_ID
    trusted_ssh_keygen_binary: Path | None = None
    trusted_ssh_keygen_sha256: str | None = None

    @property
    def allowed_signers_sha256(self) -> str:
        return _trusted_file_sha256(self.allowed_signers, label="worker signers file")

    @property
    def allowed_model_relay_signers_sha256(self) -> str:
        return _trusted_file_sha256(
            self.allowed_model_relay_signers,
            label="model relay signers file",
        )

    @property
    def allowed_runtime_attestation_signers_sha256(self) -> str:
        return _trusted_file_sha256(
            self.allowed_runtime_attestation_signers,
            label="runtime attestation signers file",
        )

    @property
    def expected_runtime_measurement_policy_sha256(self) -> str:
        return self.runtime_measurement_policy.sha256

    def public_payload(self) -> dict[str, object]:
        return {
            "policy_id": self.policy_id,
            "profile_id": self.profile_id,
            "allowed_signers_sha256": self.allowed_signers_sha256,
            "allowed_model_relay_signers_sha256": self.allowed_model_relay_signers_sha256,
            "allowed_runtime_attestation_signers_sha256": self.allowed_runtime_attestation_signers_sha256,
            "subject_protocol_sha256": self.subject_protocol.sha256,
            "expected_worker_runtime_sha256": self.expected_worker_runtime_sha256,
            "expected_agent_image": self.expected_agent_image,
            "expected_agent_image_id": self.expected_agent_image_id,
            "expected_tool_catalog_sha256": self.expected_tool_catalog_sha256,
            "expected_container_inspection_sha256": self.expected_container_inspection_sha256,
            "expected_runtime_measurement_policy_sha256": self.expected_runtime_measurement_policy_sha256,
            "expected_model_relay_policy_sha256": self.expected_model_relay_policy_sha256,
            "expected_model_route_id": self.expected_model_route_id,
            "expected_requested_model": self.expected_requested_model,
            "expected_actual_model": self.expected_actual_model,
            "expected_environment_allowlist_sha256": self.expected_environment_allowlist_sha256,
            "expected_sentinel_suite_sha256": self.expected_sentinel_suite_sha256,
            "trusted_ssh_keygen_sha256": self.trusted_ssh_keygen_sha256,
        }

    @property
    def sha256(self) -> str:
        return _canonical_sha256(self.public_payload())

    def validate(self) -> None:
        if not IDENTIFIER_PATTERN.fullmatch(self.policy_id):
            raise ConfirmatoryPermitError("controller policy id is invalid")
        if self.profile_id != REMOTE_WORKER_VAULT_PROFILE_ID:
            raise ConfirmatoryPermitError("controller policy uses an unsupported isolation profile")
        signer_paths = (
            self.allowed_signers.resolve(),
            self.allowed_model_relay_signers.resolve(),
            self.allowed_runtime_attestation_signers.resolve(),
        )
        if len(set(signer_paths)) != len(signer_paths):
            raise ConfirmatoryPermitError(
                "controller policy must use separate worker, model relay, and runtime signer files"
            )
        _trusted_file_sha256(self.allowed_signers, label="worker signers file")
        _trusted_file_sha256(
            self.allowed_model_relay_signers,
            label="model relay signers file",
        )
        _trusted_file_sha256(
            self.allowed_runtime_attestation_signers,
            label="runtime attestation signers file",
        )
        worker_keys = _allowed_signer_key_fingerprints(
            self.allowed_signers,
            label="worker signers file",
        )
        relay_keys = _allowed_signer_key_fingerprints(
            self.allowed_model_relay_signers,
            label="model relay signers file",
        )
        runtime_keys = _allowed_signer_key_fingerprints(
            self.allowed_runtime_attestation_signers,
            label="runtime attestation signers file",
        )
        if worker_keys & relay_keys or worker_keys & runtime_keys or relay_keys & runtime_keys:
            raise ConfirmatoryPermitError(
                "controller policy worker, model relay, and runtime signers share a trust key"
            )
        if self.trusted_ssh_keygen_binary is None or self.trusted_ssh_keygen_sha256 is None:
            raise ConfirmatoryPermitError(
                "controller policy must pin a trusted ssh-keygen binary"
            )
        expected_ssh_keygen_sha256 = _require_sha256(
            self.trusted_ssh_keygen_sha256,
            label="controller policy ssh-keygen",
        )
        if _trusted_file_sha256(
            self.trusted_ssh_keygen_binary,
            label="ssh-keygen binary",
        ) != expected_ssh_keygen_sha256:
            raise ConfirmatoryPermitError(
                "controller policy trusted ssh-keygen binary does not match its hash"
            )
        try:
            self.subject_protocol.validate()
        except BlackBoxError:
            raise ConfirmatoryPermitError("controller subject protocol is invalid") from None
        try:
            self.runtime_measurement_policy.validate()
        except RuntimeMeasurementError as error:
            raise ConfirmatoryPermitError("controller runtime measurement policy is invalid") from error
        if self.runtime_measurement_policy.profile_id != self.profile_id:
            raise ConfirmatoryPermitError(
                "controller runtime measurement policy does not match the worker profile"
            )
        if not PINNED_IMAGE_PATTERN.fullmatch(self.expected_agent_image):
            raise ConfirmatoryPermitError("controller policy agent image must be pinned by digest")
        if not re.fullmatch(r"sha256:[0-9a-f]{64}", self.expected_agent_image_id):
            raise ConfirmatoryPermitError("controller policy agent image id is invalid")
        for label, value in {
            "worker runtime": self.expected_worker_runtime_sha256,
            "tool catalog": self.expected_tool_catalog_sha256,
            "container inspection": self.expected_container_inspection_sha256,
            "runtime measurement policy": self.expected_runtime_measurement_policy_sha256,
            "model relay policy": self.expected_model_relay_policy_sha256,
            "environment allowlist": self.expected_environment_allowlist_sha256,
            "sentinel suite": self.expected_sentinel_suite_sha256,
        }.items():
            _require_sha256(value, label=f"controller policy {label}")
        if not IDENTIFIER_PATTERN.fullmatch(self.expected_model_route_id):
            raise ConfirmatoryPermitError("controller policy model route id is invalid")
        try:
            validate_model_label(
                self.expected_requested_model,
                label="expected requested model",
            )
            validate_model_label(
                self.expected_actual_model,
                label="expected actual model",
            )
        except ModelRelayAttestationError as error:
            raise ConfirmatoryPermitError("controller policy model labels are invalid") from error


@dataclass(frozen=True)
class ConfirmatoryExecutionPermit:
    """A reproducible admission record, not an authority to bypass validation."""

    schema_version: str
    registry_id: str
    registry_sha256: str
    source_ledger_sha256: str
    source_candidate_id: str
    admission_review_payload_sha256: str
    case_id: str
    run_id: str
    condition: str
    agent: str
    job_sha256: str
    job_nonce: str
    controller_policy_id: str
    controller_policy_sha256: str
    public_case_definition_sha256: str
    public_bundle_sha256: str
    memory_snapshot_sha256: str
    workspace_snapshot_sha256: str
    sealed_patch_sha256: str
    sealed_patch_bytes: int
    worker_result_sha256: str
    final_workspace_sha256: str
    subject_protocol_sha256: str
    worker_signer_principal: str
    worker_attestation_payload_sha256: str
    worker_signature_sha256: str
    model_route_id: str
    requested_model: str
    actual_model: str
    model_request_count: int
    provider_request_ids_sha256: str
    model_relay_signer_principal: str
    model_relay_attestation_payload_sha256: str
    model_relay_signature_sha256: str
    runtime_attestation_signer_principal: str
    runtime_attestation_payload_sha256: str
    runtime_attestation_signature_sha256: str
    runtime_measurement_policy_sha256: str
    isolation_measurement_sha256: str
    destruction_receipt_sha256: str
    worker_profile_id: str

    def public_payload(self) -> dict[str, object]:
        return asdict(self)

    @property
    def permit_sha256(self) -> str:
        return _canonical_sha256(self.public_payload())


@dataclass(frozen=True)
class PermitRedemption:
    schema_version: str
    permit_sha256: str
    job_sha256: str
    job_nonce: str
    redeemed_at: str

    def public_payload(self) -> dict[str, object]:
        return asdict(self)


class PermitRedemptionLedger:
    """Controller-private, atomic one-time redemption for confirmatory permits."""

    def __init__(self, path: str | Path) -> None:
        self.path = Path(path)

    def _record_redeemed(self, permit: ConfirmatoryExecutionPermit) -> PermitRedemption:
        try:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            if self.path.exists():
                metadata = self.path.lstat()
                if self.path.is_symlink() or not stat.S_ISREG(metadata.st_mode):
                    raise ConfirmatoryPermitError("permit redemption ledger must be a regular file")
            connection = sqlite3.connect(self.path)
        except sqlite3.Error as error:
            raise ConfirmatoryPermitError("permit redemption ledger is unavailable") from error
        try:
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS permit_redemption (
                    job_sha256 TEXT NOT NULL,
                    job_nonce TEXT NOT NULL,
                    permit_sha256 TEXT UNIQUE NOT NULL,
                    redeemed_at TEXT NOT NULL,
                    PRIMARY KEY (job_sha256, job_nonce)
                )
                """
            )
            columns = tuple(
                row[1]
                for row in connection.execute("PRAGMA table_info(permit_redemption)")
            )
            expected_columns = (
                "job_sha256",
                "job_nonce",
                "permit_sha256",
                "redeemed_at",
            )
            if columns != expected_columns:
                raise ConfirmatoryPermitError(
                    "permit redemption ledger has an unsupported schema"
                )
            redeemed_at = datetime.now(timezone.utc).isoformat()
            try:
                connection.execute("BEGIN IMMEDIATE")
                connection.execute(
                    """
                    INSERT INTO permit_redemption
                    (job_sha256, job_nonce, permit_sha256, redeemed_at)
                    VALUES (?, ?, ?, ?)
                    """,
                    (
                        permit.job_sha256,
                        permit.job_nonce,
                        permit.permit_sha256,
                        redeemed_at,
                    ),
                )
                connection.commit()
            except sqlite3.IntegrityError:
                connection.rollback()
                raise ConfirmatoryPermitError(
                    "confirmatory execution job or permit was already redeemed"
                ) from None
            except sqlite3.Error as error:
                connection.rollback()
                raise ConfirmatoryPermitError("permit redemption ledger transaction failed") from error
        finally:
            connection.close()
        return PermitRedemption(
            schema_version=PERMIT_REDEMPTION_SCHEMA_VERSION,
            permit_sha256=permit.permit_sha256,
            job_sha256=permit.job_sha256,
            job_nonce=permit.job_nonce,
            redeemed_at=redeemed_at,
        )

    def redeem(
        self,
        permit: ConfirmatoryExecutionPermit,
        *,
        reconstruction_workspace: str | Path,
        **inputs: object,
    ) -> PermitRedemption:
        """Validate, reconstruct, then atomically consume a confirmatory permit."""

        validate_confirmatory_execution_permit(permit, **inputs)
        _reconstruct_confirmatory_public_worker_output(
            reconstruction_workspace=reconstruction_workspace,
            worker_job=_require_worker_input(inputs, "worker_job", WorkerJob),
            worker_result=_require_worker_input(inputs, "worker_result", WorkerResult),
            worker_patch=_require_worker_input(inputs, "worker_patch", SealedPatch),
        )
        return self._record_redeemed(permit)


def _require_worker_input(
    inputs: dict[str, object],
    label: str,
    expected_type: type[object],
) -> object:
    value = inputs.get(label)
    if not isinstance(value, expected_type):
        raise ConfirmatoryPermitError(
            f"confirmatory reconstruction requires a valid {label}"
        )
    return value


def _reconstruct_confirmatory_public_worker_output(
    *,
    reconstruction_workspace: str | Path,
    worker_job: WorkerJob,
    worker_result: WorkerResult,
    worker_patch: SealedPatch,
) -> str:
    """Bind the signed worker's claimed final tree to a disposable vault checkout."""

    try:
        return reconstruct_sealed_patch_in_vault(
            workspace=reconstruction_workspace,
            worker_patch=worker_patch,
            expected_workspace_snapshot_sha256=worker_job.workspace_snapshot_sha256,
            expected_final_workspace_sha256=worker_result.final_workspace_sha256,
        )
    except (OSError, ValueError, WorkerProtocolError) as error:
        raise ConfirmatoryPermitError(
            "sealed worker patch reconstruction failed at the grading boundary"
        ) from error


def _require_confirmatory_registry_entry(
    registry: CaseRegistry,
    cases_root: str | Path,
    manifest: CaseManifest,
) -> CaseRegistryEntry:
    try:
        validate_case_registry(registry, cases_root=cases_root)
    except (CaseRegistryError, ValueError):
        raise ConfirmatoryPermitError("case registry admission failed") from None
    entries = tuple(entry for entry in registry.entries if entry.case_id == manifest.case_id)
    if len(entries) != 1 or entries[0].enrollment != "confirmatory":
        raise ConfirmatoryPermitError("case has no confirmatory registry entry")
    entry = entries[0]
    try:
        manifest_definition_sha256 = public_case_definition_hash(manifest)
    except (AttributeError, OSError, ValueError):
        raise ConfirmatoryPermitError("manifest public case definition cannot be verified") from None
    if entry.case_definition_sha256 != manifest_definition_sha256:
        raise ConfirmatoryPermitError("registry case definition does not match the manifest")
    return entry


def _require_confirmatory_manifest(manifest: CaseManifest) -> None:
    if manifest.split not in {"validation", "test"}:
        raise ConfirmatoryPermitError("confirmatory permit requires a validation or test case")
    if manifest.study_track != "C":
        raise ConfirmatoryPermitError("confirmatory permit requires a Track C case")
    if manifest.repository.source_type != "git":
        raise ConfirmatoryPermitError("confirmatory permit requires a public Git repository case")
    if manifest.dependency_classification_status != "preregistered":
        raise ConfirmatoryPermitError("confirmatory permit requires preregistered dependency classification")
    if manifest.oracle.visibility != "private":
        raise ConfirmatoryPermitError("confirmatory permit requires a private oracle")
    if manifest.oracle.required_isolation_profile != REMOTE_WORKER_VAULT_PROFILE_ID:
        raise ConfirmatoryPermitError("confirmatory permit requires the remote worker/vault profile")
    if manifest.oracle.verifier_mode != "black-box-controller-v1":
        raise ConfirmatoryPermitError("confirmatory permit requires the black-box controller verifier")


def _normalized_repository_url(value: object) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ConfirmatoryPermitError(
            "confirmatory permit requires a public repository URL for source admission"
        )
    return value.strip().rstrip("/").removesuffix(".git")


def _require_source_admission(
    *,
    source_ledger_path: str | Path,
    source_candidate_id: str,
    manifest: CaseManifest,
) -> tuple[str, str, str]:
    """Bind a reviewed source transition to the exact public case manifest."""

    raw_source_path = Path(source_ledger_path)
    ledger_sha256 = _trusted_file_sha256(raw_source_path, label="source ledger")
    source_path = raw_source_path.resolve()
    try:
        ledger = load_source_ledger(source_path)
        validate_source_ledger(ledger)
    except SourceLedgerError as error:
        raise ConfirmatoryPermitError("source ledger admission failed") from error
    if _trusted_file_sha256(source_path, label="source ledger") != ledger_sha256:
        raise ConfirmatoryPermitError("source ledger changed during admission validation")
    candidate = next(
        (entry for entry in ledger.entries if entry.candidate_id == source_candidate_id),
        None,
    )
    if candidate is None or candidate.status != "admitted":
        raise ConfirmatoryPermitError("source candidate is not admitted")
    if candidate.environment_receipt_path is None:
        raise ConfirmatoryPermitError("admitted source candidate has no environment receipt")
    environment_path = (ledger.source_path.parent.resolve() / candidate.environment_receipt_path).resolve()
    ledger_root = ledger.source_path.parent.resolve()
    if environment_path == ledger_root or ledger_root not in environment_path.parents:
        raise ConfirmatoryPermitError("environment receipt path escapes the source ledger")
    environment_sha256 = _trusted_file_sha256(environment_path, label="environment receipt")
    try:
        environment_receipt = load_environment_preflight_receipt(environment_path)
    except PreflightError as error:
        raise ConfirmatoryPermitError("environment receipt is invalid") from error
    if _trusted_file_sha256(environment_path, label="environment receipt") != environment_sha256:
        raise ConfirmatoryPermitError("environment receipt changed during admission validation")
    now = datetime.now(timezone.utc)
    _require_recent_source_timestamp(
        environment_receipt.observed_at_utc,
        label="environment receipt",
        now=now,
    )
    if candidate.admission_review_path is None or candidate.admission_review_sha256 is None:
        raise ConfirmatoryPermitError("admitted source candidate has no bound review")
    root = ledger.source_path.parent.resolve()
    review_path = (root / candidate.admission_review_path).resolve()
    if review_path == root or root not in review_path.parents:
        raise ConfirmatoryPermitError("admission review path escapes the source ledger")
    review_file_sha256 = _trusted_file_sha256(review_path, label="admission review")
    if review_file_sha256 != candidate.admission_review_sha256:
        raise ConfirmatoryPermitError("admission review does not match the source ledger")
    try:
        review = load_admission_review(review_path)
        validate_admission_review(
            review,
            candidate_id=candidate.candidate_id,
            repository_url=candidate.repository_url,
            base_revision=candidate.base_revision,
            public_transition_revision=candidate.public_transition_revision,
        )
    except AdmissionReviewError as error:
        raise ConfirmatoryPermitError("admission review is invalid") from error
    if _trusted_file_sha256(review_path, label="admission review") != review_file_sha256:
        raise ConfirmatoryPermitError("admission review changed during validation")
    if review.decision != "approved-for-development":
        raise ConfirmatoryPermitError("source admission review is not approved")
    _require_recent_source_timestamp(
        review.reviewed_at_utc,
        label="admission review",
        now=now,
    )
    if _normalized_repository_url(manifest.repository.url) != _normalized_repository_url(
        candidate.repository_url
    ):
        raise ConfirmatoryPermitError("source candidate repository does not match the case")
    if manifest.repository.base_revision != candidate.base_revision:
        raise ConfirmatoryPermitError("source candidate base revision does not match the case")
    if review.private_transition_commitment_sha256 != manifest.transition.commitment_sha256:
        raise ConfirmatoryPermitError(
            "admission review transition commitment does not match the case"
        )
    return ledger_sha256, candidate.candidate_id, review.sha256


def _require_worker_binding(
    entry: CaseRegistryEntry,
    worker_job: WorkerJob,
    worker_result: WorkerResult,
    worker_patch: SealedPatch,
    controller_policy: ControllerTrustPolicy,
) -> None:
    if worker_job.schema_version != WORKER_JOB_SCHEMA_VERSION:
        raise ConfirmatoryPermitError("worker job schema is unsupported")
    if worker_result.schema_version != WORKER_RESULT_SCHEMA_VERSION:
        raise ConfirmatoryPermitError("worker result schema is unsupported")
    if worker_job.case_id != entry.case_id:
        raise ConfirmatoryPermitError("worker job does not bind the registry case")
    if worker_job.public_case_definition_sha256 != entry.case_definition_sha256:
        raise ConfirmatoryPermitError("worker job does not bind the registry case definition")
    if worker_job.controller_policy_sha256 != controller_policy.sha256:
        raise ConfirmatoryPermitError("worker job does not bind the controller policy")
    if worker_job.subject_protocol_sha256 != controller_policy.subject_protocol.sha256:
        raise ConfirmatoryPermitError("worker job does not bind the controller subject protocol")
    expected = {
        "run_id": worker_job.run_id,
        "job_sha256": worker_job.job_sha256,
        "case_id": worker_job.case_id,
        "condition": worker_job.condition,
        "agent": worker_job.agent,
        "model": worker_job.model,
        "public_bundle_sha256": worker_job.public_bundle_sha256,
        "memory_snapshot_sha256": worker_job.memory_snapshot_sha256,
        "subject_protocol_sha256": worker_job.subject_protocol_sha256,
        "controller_policy_sha256": worker_job.controller_policy_sha256,
        "job_nonce": worker_job.job_nonce,
        "workspace_snapshot_sha256": worker_job.workspace_snapshot_sha256,
        "sealed_patch_sha256": worker_patch.sha256,
        "sealed_patch_bytes": worker_patch.byte_count,
    }
    for field, value in expected.items():
        if getattr(worker_result, field) != value:
            raise ConfirmatoryPermitError(f"worker result does not bind the expected {field}")
    if worker_result.changed_paths != worker_patch.changed_paths:
        raise ConfirmatoryPermitError("worker result changed paths do not match the sealed patch")
    if (
        worker_job.runtime_config_sha256 is None
        or worker_result.runtime_config_sha256 != worker_job.runtime_config_sha256
    ):
        raise ConfirmatoryPermitError(
            "worker result does not bind the controller runtime configuration"
        )
    _require_sha256(
        worker_result.final_workspace_sha256,
        label="worker result final workspace",
    )


def _verify_signed_worker(
    *,
    signed_worker_attestation: SignedWorkerAttestation,
    worker_job: WorkerJob,
    worker_result: WorkerResult,
    controller_policy: ControllerTrustPolicy,
) -> tuple[str, str, str]:
    try:
        verification = verify_worker_attestation(
            signed_worker_attestation,
            allowed_signers=controller_policy.allowed_signers,
            ssh_keygen_binary=str(controller_policy.trusted_ssh_keygen_binary),
        )
        validate_attestation_binding(
            signed_worker_attestation.attestation,
            run_id=worker_job.run_id,
            case_id=worker_job.case_id,
            condition=worker_job.condition,
            agent=worker_job.agent,
            job_sha256=worker_job.job_sha256,
            public_case_definition_sha256=worker_job.public_case_definition_sha256,
            workspace_snapshot_sha256=worker_job.workspace_snapshot_sha256,
            sealed_patch_sha256=worker_result.sealed_patch_sha256,
            sealed_patch_bytes=worker_result.sealed_patch_bytes,
            subject_protocol_sha256=worker_job.subject_protocol_sha256,
            controller_policy_sha256=worker_job.controller_policy_sha256,
            job_nonce=worker_job.job_nonce,
            worker_result_sha256=worker_result.result_sha256,
        )
    except AttestationError as error:
        detail = str(error)
        if "subject_protocol_sha256" in detail:
            raise ConfirmatoryPermitError(
                "signed worker attestation does not bind the exact subject protocol"
            ) from None
        if "controller_policy_sha256" in detail or "job_nonce" in detail:
            raise ConfirmatoryPermitError(
                "signed worker attestation does not bind the controller job policy"
            ) from None
        raise ConfirmatoryPermitError("signed worker attestation verification failed") from None
    attestation = signed_worker_attestation.attestation
    expected_policy = {
        "profile_id": controller_policy.profile_id,
        "worker_runtime_sha256": controller_policy.expected_worker_runtime_sha256,
        "agent_image": controller_policy.expected_agent_image,
        "agent_image_id": controller_policy.expected_agent_image_id,
        "tool_catalog_sha256": controller_policy.expected_tool_catalog_sha256,
        "container_inspection_sha256": controller_policy.expected_container_inspection_sha256,
        "model_relay_policy_sha256": controller_policy.expected_model_relay_policy_sha256,
        "environment_allowlist_sha256": controller_policy.expected_environment_allowlist_sha256,
        "sentinel_suite_sha256": controller_policy.expected_sentinel_suite_sha256,
        "public_bundle_sha256": worker_job.public_bundle_sha256,
        "memory_snapshot_sha256": worker_job.memory_snapshot_sha256,
        "subject_protocol_sha256": worker_job.subject_protocol_sha256,
        "controller_policy_sha256": worker_job.controller_policy_sha256,
        "job_nonce": worker_job.job_nonce,
    }
    for field, expected in expected_policy.items():
        if getattr(attestation, field) != expected:
            raise ConfirmatoryPermitError("worker attestation does not match the controller policy")
    return (
        verification.signer_principal,
        verification.attestation_payload_sha256,
        verification.signature_sha256,
    )


def _usage_total(worker_result: WorkerResult, field: str) -> int | None:
    values = [getattr(record, field) for record in worker_result.model_usage]
    if not values or any(value is None for value in values):
        return None
    return sum(int(value) for value in values)


def _require_worker_model_evidence(
    worker_result: WorkerResult,
    *,
    requested_model: str,
    actual_model: str,
    relay_attestation: SignedModelRelayAttestation,
) -> None:
    usage_models = tuple(sorted(record.model for record in worker_result.model_usage))
    relay = relay_attestation.attestation
    if (
        worker_result.model != requested_model
        or worker_result.model_profile != "single"
        or worker_result.reported_models != (actual_model,)
        or usage_models != (actual_model,)
    ):
        raise ConfirmatoryPermitError(
            "worker model telemetry does not prove the expected single model"
        )
    if (
        worker_result.model_request_count is None
        or worker_result.provider_request_ids_sha256 is None
        or worker_result.model_request_count != relay.request_count
        or worker_result.provider_request_ids_sha256 != relay.provider_request_ids_sha256
    ):
        raise ConfirmatoryPermitError(
            "worker model telemetry does not bind the relay request inventory"
        )
    input_tokens = _usage_total(worker_result, "input_tokens")
    output_tokens = _usage_total(worker_result, "output_tokens")
    if (
        relay.input_tokens is None
        or relay.output_tokens is None
        or input_tokens is None
        or output_tokens is None
        or input_tokens != relay.input_tokens
        or output_tokens != relay.output_tokens
    ):
        raise ConfirmatoryPermitError(
            "worker model telemetry does not match relay token accounting"
        )


def _verify_signed_model_relay(
    *,
    signed_model_relay_attestation: SignedModelRelayAttestation,
    worker_job: WorkerJob,
    worker_result: WorkerResult,
    controller_policy: ControllerTrustPolicy,
) -> tuple[str, str, str]:
    """Require a relay signer and client telemetry to agree on one model route."""

    try:
        verification = verify_model_relay_attestation(
            signed_model_relay_attestation,
            allowed_signers=controller_policy.allowed_model_relay_signers,
            ssh_keygen_binary=str(controller_policy.trusted_ssh_keygen_binary),
        )
        validate_model_relay_binding(
            signed_model_relay_attestation.attestation,
            relay_policy_sha256=controller_policy.expected_model_relay_policy_sha256,
            route_id=controller_policy.expected_model_route_id,
            run_id=worker_job.run_id,
            job_sha256=worker_job.job_sha256,
            job_nonce=worker_job.job_nonce,
            requested_model=controller_policy.expected_requested_model,
            actual_model=controller_policy.expected_actual_model,
            worker_result_sha256=worker_result.result_sha256,
        )
    except ModelRelayAttestationError as error:
        raise ConfirmatoryPermitError("model relay attestation verification failed") from error
    _require_worker_model_evidence(
        worker_result,
        requested_model=controller_policy.expected_requested_model,
        actual_model=controller_policy.expected_actual_model,
        relay_attestation=signed_model_relay_attestation,
    )
    return (
        verification.signer_principal,
        verification.attestation_payload_sha256,
        verification.signature_sha256,
    )


def _verify_signed_runtime_attestation(
    *,
    signed_runtime_attestation: SignedRuntimeAttestation,
    runtime_measurement_receipt: RuntimeMeasurementReceipt,
    worker_job: WorkerJob,
    worker_result: WorkerResult,
    signed_worker_attestation: SignedWorkerAttestation,
    controller_policy: ControllerTrustPolicy,
) -> tuple[str, str, str, str, str]:
    """Require an independent runtime-manager statement for the exact worker run."""

    runtime = signed_runtime_attestation.attestation
    worker_isolation = signed_worker_attestation.attestation.isolation
    try:
        verification = verify_runtime_attestation(
            signed_runtime_attestation,
            allowed_signers=controller_policy.allowed_runtime_attestation_signers,
            ssh_keygen_binary=str(controller_policy.trusted_ssh_keygen_binary),
        )
        validate_runtime_attestation_binding(
            signed_runtime_attestation.attestation,
            controller_policy_sha256=controller_policy.sha256,
            runtime_measurement_policy_sha256=(
                controller_policy.expected_runtime_measurement_policy_sha256
            ),
            run_id=worker_job.run_id,
            job_sha256=worker_job.job_sha256,
            job_nonce=worker_job.job_nonce,
            worker_result_sha256=worker_result.result_sha256,
            worker_runtime_sha256=controller_policy.expected_worker_runtime_sha256,
            agent_image=controller_policy.expected_agent_image,
            agent_image_id=controller_policy.expected_agent_image_id,
            tool_catalog_sha256=controller_policy.expected_tool_catalog_sha256,
            container_inspection_sha256=(
                controller_policy.expected_container_inspection_sha256
            ),
        )
        validate_runtime_measurement_receipt_binding(
            runtime_measurement_receipt,
            policy=controller_policy.runtime_measurement_policy,
            run_id=worker_job.run_id,
            job_sha256=worker_job.job_sha256,
            job_nonce=worker_job.job_nonce,
            worker_result_sha256=worker_result.result_sha256,
            destruction_receipt_sha256=worker_isolation.destruction_receipt_sha256,
        )
    except RuntimeAttestationError as error:
        raise ConfirmatoryPermitError("runtime attestation verification failed") from error
    except RuntimeMeasurementError as error:
        raise ConfirmatoryPermitError("runtime measurement receipt verification failed") from error

    if runtime.profile_id != controller_policy.profile_id:
        raise ConfirmatoryPermitError("runtime attestation does not match the controller profile")
    if runtime.network_policy_id != worker_isolation.network_policy_id:
        raise ConfirmatoryPermitError("runtime attestation does not match worker network isolation")
    if runtime.destruction_receipt_sha256 != worker_isolation.destruction_receipt_sha256:
        raise ConfirmatoryPermitError("runtime attestation does not match worker destruction receipt")
    if runtime.isolation_measurement_sha256 != runtime_measurement_receipt.sha256:
        raise ConfirmatoryPermitError(
            "runtime attestation does not bind the runtime measurement receipt"
        )
    return (
        verification.signer_principal,
        verification.attestation_payload_sha256,
        verification.signature_sha256,
        runtime.isolation_measurement_sha256,
        runtime.destruction_receipt_sha256,
    )


def issue_confirmatory_execution_permit(
    *,
    registry: CaseRegistry,
    cases_root: str | Path,
    source_ledger_path: str | Path,
    source_candidate_id: str,
    manifest: CaseManifest,
    worker_job: WorkerJob,
    worker_result: WorkerResult,
    worker_patch: SealedPatch,
    controller_policy: ControllerTrustPolicy,
    signed_worker_attestation: SignedWorkerAttestation,
    signed_model_relay_attestation: SignedModelRelayAttestation,
    signed_runtime_attestation: SignedRuntimeAttestation,
    runtime_measurement_receipt: RuntimeMeasurementReceipt,
) -> ConfirmatoryExecutionPermit:
    """Admit an exact signed remote execution into the future vault path.

    This function intentionally does not execute a worker or a verifier. It
    only proves that an already completed remote worker result is eligible for
    remote black-box grading. A caller must validate this permit again at the
    grading boundary rather than trusting a serialized copy.
    """

    controller_policy.validate()
    _require_confirmatory_manifest(manifest)
    entry = _require_confirmatory_registry_entry(registry, cases_root, manifest)
    ledger_sha256, candidate_id, review_sha256 = _require_source_admission(
        source_ledger_path=source_ledger_path,
        source_candidate_id=source_candidate_id,
        manifest=manifest,
    )
    _require_worker_binding(entry, worker_job, worker_result, worker_patch, controller_policy)
    signer, attestation_sha256, signature_sha256 = _verify_signed_worker(
        signed_worker_attestation=signed_worker_attestation,
        worker_job=worker_job,
        worker_result=worker_result,
        controller_policy=controller_policy,
    )
    (
        runtime_signer,
        runtime_attestation_sha256,
        runtime_signature_sha256,
        isolation_measurement_sha256,
        destruction_receipt_sha256,
    ) = _verify_signed_runtime_attestation(
        signed_runtime_attestation=signed_runtime_attestation,
        runtime_measurement_receipt=runtime_measurement_receipt,
        worker_job=worker_job,
        worker_result=worker_result,
        signed_worker_attestation=signed_worker_attestation,
        controller_policy=controller_policy,
    )
    relay_signer, relay_attestation_sha256, relay_signature_sha256 = _verify_signed_model_relay(
        signed_model_relay_attestation=signed_model_relay_attestation,
        worker_job=worker_job,
        worker_result=worker_result,
        controller_policy=controller_policy,
    )
    return ConfirmatoryExecutionPermit(
        schema_version=CONFIRMATORY_PERMIT_SCHEMA_VERSION,
        registry_id=registry.registry_id,
        registry_sha256=registry.sha256,
        source_ledger_sha256=ledger_sha256,
        source_candidate_id=candidate_id,
        admission_review_payload_sha256=review_sha256,
        case_id=worker_job.case_id,
        run_id=worker_job.run_id,
        condition=worker_job.condition,
        agent=worker_job.agent,
        job_sha256=worker_job.job_sha256,
        job_nonce=worker_job.job_nonce,
        controller_policy_id=controller_policy.policy_id,
        controller_policy_sha256=controller_policy.sha256,
        public_case_definition_sha256=worker_job.public_case_definition_sha256,
        public_bundle_sha256=worker_job.public_bundle_sha256,
        memory_snapshot_sha256=worker_job.memory_snapshot_sha256,
        workspace_snapshot_sha256=worker_job.workspace_snapshot_sha256,
        sealed_patch_sha256=worker_patch.sha256,
        sealed_patch_bytes=worker_patch.byte_count,
        worker_result_sha256=worker_result.result_sha256,
        final_workspace_sha256=worker_result.final_workspace_sha256,
        subject_protocol_sha256=worker_job.subject_protocol_sha256,
        worker_signer_principal=signer,
        worker_attestation_payload_sha256=attestation_sha256,
        worker_signature_sha256=signature_sha256,
        model_route_id=controller_policy.expected_model_route_id,
        requested_model=controller_policy.expected_requested_model,
        actual_model=controller_policy.expected_actual_model,
        model_request_count=worker_result.model_request_count,
        provider_request_ids_sha256=worker_result.provider_request_ids_sha256,
        model_relay_signer_principal=relay_signer,
        model_relay_attestation_payload_sha256=relay_attestation_sha256,
        model_relay_signature_sha256=relay_signature_sha256,
        runtime_attestation_signer_principal=runtime_signer,
        runtime_attestation_payload_sha256=runtime_attestation_sha256,
        runtime_attestation_signature_sha256=runtime_signature_sha256,
        runtime_measurement_policy_sha256=(
            controller_policy.expected_runtime_measurement_policy_sha256
        ),
        isolation_measurement_sha256=isolation_measurement_sha256,
        destruction_receipt_sha256=destruction_receipt_sha256,
        worker_profile_id=REMOTE_WORKER_VAULT_PROFILE_ID,
    )


def validate_confirmatory_execution_permit(
    permit: ConfirmatoryExecutionPermit,
    **inputs: object,
) -> None:
    """Reissue from live signed inputs and reject any stale or hand-built permit."""

    if permit.schema_version != CONFIRMATORY_PERMIT_SCHEMA_VERSION:
        raise ConfirmatoryPermitError("confirmatory execution permit schema is unsupported")
    try:
        expected = issue_confirmatory_execution_permit(**inputs)  # type: ignore[arg-type]
    except TypeError as error:
        raise ConfirmatoryPermitError("confirmatory permit validation inputs are invalid") from error
    if expected != permit or expected.permit_sha256 != permit.permit_sha256:
        raise ConfirmatoryPermitError("confirmatory execution permit does not bind the current inputs")


def redeem_confirmatory_execution_permit(
    permit: ConfirmatoryExecutionPermit,
    *,
    redemption_ledger: PermitRedemptionLedger,
    reconstruction_workspace: str | Path,
    **inputs: object,
) -> PermitRedemption:
    """Validate, reconstruct, and atomically consume a permit before grading."""

    return redemption_ledger.redeem(
        permit,
        reconstruction_workspace=reconstruction_workspace,
        **inputs,
    )
