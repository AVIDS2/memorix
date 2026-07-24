"""Signed evidence from the trusted model relay used by a remote worker."""

from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import datetime, timedelta, timezone
import hashlib
import json
from pathlib import Path
import re
import subprocess
import tempfile


MODEL_RELAY_ATTESTATION_SCHEMA_VERSION = "model-relay-attestation-v2"
MODEL_RELAY_ATTESTATION_NAMESPACE = "memorixbench-model-relay-v1"
MAX_MODEL_RELAY_ATTESTATION_LIFETIME = timedelta(hours=1)
MAX_MODEL_RELAY_CLOCK_SKEW = timedelta(minutes=2)
SHA256_PATTERN = re.compile(r"^[0-9a-f]{64}$")
IDENTIFIER_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")
MODEL_LABEL_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:/@+\-\[\]]{0,255}$")
NONCE_PATTERN = re.compile(r"^[0-9a-f]{32}$")


class ModelRelayAttestationError(ValueError):
    """Raised when a relay receipt cannot prove one configured model route."""


def _canonical_json(value: object) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode("ascii")


def _sha256(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def _required_text(value: object, *, label: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ModelRelayAttestationError(f"model relay {label} must be non-empty text")
    return value.strip()


def _require_sha256(value: object, *, label: str) -> str:
    text = _required_text(value, label=label)
    if not SHA256_PATTERN.fullmatch(text):
        raise ModelRelayAttestationError(f"model relay {label} must be a SHA-256 digest")
    return text


def _require_identifier(value: object, *, label: str) -> str:
    text = _required_text(value, label=label)
    if not IDENTIFIER_PATTERN.fullmatch(text):
        raise ModelRelayAttestationError(f"model relay {label} is invalid")
    return text


def validate_model_label(value: object, *, label: str) -> str:
    """Accept a bounded model identifier without accepting whitespace or control text."""

    text = _required_text(value, label=label)
    if not MODEL_LABEL_PATTERN.fullmatch(text):
        raise ModelRelayAttestationError(f"model relay {label} is invalid")
    return text


def _parse_timestamp(value: object, *, label: str) -> datetime:
    text = _required_text(value, label=label)
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError as error:
        raise ModelRelayAttestationError(f"model relay {label} is invalid") from error
    if parsed.tzinfo is None:
        raise ModelRelayAttestationError(f"model relay {label} must include a timezone")
    return parsed.astimezone(timezone.utc)


def _require_nonnegative_int(value: object, *, label: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise ModelRelayAttestationError(f"model relay {label} must be non-negative")
    return value


@dataclass(frozen=True)
class ModelRelayAttestation:
    """A relay-signed aggregate receipt; it contains no prompt or response text."""

    schema_version: str
    relay_policy_sha256: str
    route_id: str
    run_id: str
    job_sha256: str
    job_nonce: str
    requested_model: str
    actual_models: tuple[str, ...]
    request_count: int
    provider_request_ids_sha256: str
    input_tokens: int | None
    output_tokens: int | None
    issued_at: str
    expires_at: str
    worker_result_sha256: str | None = None

    def public_payload(self) -> dict[str, object]:
        payload = asdict(self)
        payload["actual_models"] = list(self.actual_models)
        return payload

    @property
    def payload_sha256(self) -> str:
        return _sha256(_canonical_json(self.public_payload()))

    def canonical_bytes(self) -> bytes:
        self.validate()
        return _canonical_json(self.public_payload())

    def validate(self) -> None:
        if self.schema_version != MODEL_RELAY_ATTESTATION_SCHEMA_VERSION:
            raise ModelRelayAttestationError("unsupported model relay attestation schema")
        _require_sha256(self.relay_policy_sha256, label="policy")
        _require_identifier(self.route_id, label="route id")
        _require_identifier(self.run_id, label="run id")
        _require_sha256(self.job_sha256, label="job")
        if not NONCE_PATTERN.fullmatch(self.job_nonce):
            raise ModelRelayAttestationError("model relay job nonce is invalid")
        validate_model_label(self.requested_model, label="requested model")
        if not self.actual_models or len(self.actual_models) != len(set(self.actual_models)):
            raise ModelRelayAttestationError("model relay actual models are invalid")
        for model in self.actual_models:
            validate_model_label(model, label="actual model")
        if self.request_count <= 0:
            raise ModelRelayAttestationError("model relay request count must be positive")
        _require_sha256(self.provider_request_ids_sha256, label="provider request ids")
        if self.worker_result_sha256 is not None:
            _require_sha256(self.worker_result_sha256, label="worker result")
        for value, label in ((self.input_tokens, "input tokens"), (self.output_tokens, "output tokens")):
            if value is not None:
                _require_nonnegative_int(value, label=label)
        issued_at = _parse_timestamp(self.issued_at, label="issued_at")
        expires_at = _parse_timestamp(self.expires_at, label="expires_at")
        if expires_at <= issued_at:
            raise ModelRelayAttestationError("model relay attestation expires before it is issued")
        if expires_at - issued_at > MAX_MODEL_RELAY_ATTESTATION_LIFETIME:
            raise ModelRelayAttestationError("model relay attestation lifetime exceeds the profile limit")

    @classmethod
    def from_public_payload(cls, value: object) -> "ModelRelayAttestation":
        if not isinstance(value, dict):
            raise ModelRelayAttestationError("model relay attestation must be an object")
        expected = {
            "schema_version",
            "relay_policy_sha256",
            "route_id",
            "run_id",
            "job_sha256",
            "job_nonce",
            "requested_model",
            "actual_models",
            "request_count",
            "provider_request_ids_sha256",
            "input_tokens",
            "output_tokens",
            "issued_at",
            "expires_at",
            "worker_result_sha256",
        }
        if set(value) != expected:
            raise ModelRelayAttestationError("model relay attestation has unexpected fields")
        raw_models = value.get("actual_models")
        if not isinstance(raw_models, list) or any(
            not isinstance(model, str) for model in raw_models
        ):
            raise ModelRelayAttestationError("model relay actual models are invalid")
        input_tokens = value.get("input_tokens")
        output_tokens = value.get("output_tokens")
        if input_tokens is not None:
            _require_nonnegative_int(input_tokens, label="input tokens")
        if output_tokens is not None:
            _require_nonnegative_int(output_tokens, label="output tokens")
        attestation = cls(
            schema_version=_required_text(value.get("schema_version"), label="schema version"),
            relay_policy_sha256=_required_text(value.get("relay_policy_sha256"), label="policy"),
            route_id=_required_text(value.get("route_id"), label="route id"),
            run_id=_required_text(value.get("run_id"), label="run id"),
            job_sha256=_required_text(value.get("job_sha256"), label="job"),
            job_nonce=_required_text(value.get("job_nonce"), label="job nonce"),
            requested_model=_required_text(value.get("requested_model"), label="requested model"),
            actual_models=tuple(raw_models),
            request_count=_require_nonnegative_int(value.get("request_count"), label="request count"),
            provider_request_ids_sha256=_required_text(
                value.get("provider_request_ids_sha256"),
                label="provider request ids",
            ),
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            issued_at=_required_text(value.get("issued_at"), label="issued_at"),
            expires_at=_required_text(value.get("expires_at"), label="expires_at"),
            worker_result_sha256=(
                None
                if value.get("worker_result_sha256") is None
                else _required_text(
                    value.get("worker_result_sha256"),
                    label="worker result",
                )
            ),
        )
        attestation.validate()
        return attestation


@dataclass(frozen=True)
class SignedModelRelayAttestation:
    signer_principal: str
    attestation: ModelRelayAttestation
    armored_signature: str

    @property
    def signature_sha256(self) -> str:
        return _sha256(self.armored_signature.encode("utf-8"))

    def public_payload(self) -> dict[str, object]:
        return {
            "schema_version": MODEL_RELAY_ATTESTATION_SCHEMA_VERSION,
            "signer_principal": self.signer_principal,
            "attestation": self.attestation.public_payload(),
            "armored_signature": self.armored_signature,
            "signature_sha256": self.signature_sha256,
        }

    def validate(self) -> None:
        _require_identifier(self.signer_principal, label="signer principal")
        self.attestation.validate()
        if not self.armored_signature.startswith("-----BEGIN SSH SIGNATURE-----"):
            raise ModelRelayAttestationError("model relay signature is not an OpenSSH signature")

    @classmethod
    def from_public_payload(cls, value: object) -> "SignedModelRelayAttestation":
        if not isinstance(value, dict):
            raise ModelRelayAttestationError("signed model relay attestation must be an object")
        expected = {
            "schema_version",
            "signer_principal",
            "attestation",
            "armored_signature",
            "signature_sha256",
        }
        if set(value) != expected or value.get("schema_version") != MODEL_RELAY_ATTESTATION_SCHEMA_VERSION:
            raise ModelRelayAttestationError("signed model relay attestation has unsupported fields")
        signature_value = value.get("armored_signature")
        if not isinstance(signature_value, str) or not signature_value.strip():
            raise ModelRelayAttestationError("model relay signature must be non-empty text")
        signature = signature_value
        signed = cls(
            signer_principal=_required_text(value.get("signer_principal"), label="signer principal"),
            attestation=ModelRelayAttestation.from_public_payload(value.get("attestation")),
            armored_signature=signature,
        )
        if value.get("signature_sha256") != signed.signature_sha256:
            raise ModelRelayAttestationError("model relay signature digest does not match")
        signed.validate()
        return signed


@dataclass(frozen=True)
class ModelRelayVerification:
    signer_principal: str
    attestation_payload_sha256: str
    signature_sha256: str
    verified_at: str


def sign_model_relay_attestation(
    attestation: ModelRelayAttestation,
    *,
    signer_principal: str,
    private_key: str | Path,
    ssh_keygen_binary: str = "ssh-keygen",
) -> SignedModelRelayAttestation:
    """Sign a relay receipt with a key unavailable to the agent worker."""

    attestation.validate()
    _require_identifier(signer_principal, label="signer principal")
    key_path = Path(private_key)
    if not key_path.is_file():
        raise ModelRelayAttestationError("model relay signing key is unavailable")
    with tempfile.TemporaryDirectory(prefix="memorixbench-model-relay-") as directory:
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
                    MODEL_RELAY_ATTESTATION_NAMESPACE,
                    str(payload_path),
                ],
                check=False,
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
            )
        except FileNotFoundError as error:
            raise ModelRelayAttestationError("ssh-keygen is unavailable for model relay signing") from error
        if completed.returncode != 0:
            raise ModelRelayAttestationError("model relay signing failed")
        signature_path = Path(str(payload_path) + ".sig")
        try:
            signature = signature_path.read_text(encoding="utf-8")
        except OSError as error:
            raise ModelRelayAttestationError("model relay signature was not created") from error
    signed = SignedModelRelayAttestation(
        signer_principal=signer_principal,
        attestation=attestation,
        armored_signature=signature,
    )
    signed.validate()
    return signed


def verify_model_relay_attestation(
    signed: SignedModelRelayAttestation,
    *,
    allowed_signers: str | Path,
    now: datetime | None = None,
    ssh_keygen_binary: str = "ssh-keygen",
) -> ModelRelayVerification:
    """Verify a short-lived relay receipt against a controller-owned signer file."""

    signed.validate()
    allowed_signers_path = Path(allowed_signers)
    if not allowed_signers_path.is_file():
        raise ModelRelayAttestationError("trusted model relay signers file is unavailable")
    verified_now = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
    issued_at = _parse_timestamp(signed.attestation.issued_at, label="issued_at")
    expires_at = _parse_timestamp(signed.attestation.expires_at, label="expires_at")
    if issued_at - verified_now > MAX_MODEL_RELAY_CLOCK_SKEW:
        raise ModelRelayAttestationError("model relay attestation is issued too far in the future")
    if expires_at <= verified_now:
        raise ModelRelayAttestationError("model relay attestation has expired")
    if verified_now - issued_at > MAX_MODEL_RELAY_ATTESTATION_LIFETIME + MAX_MODEL_RELAY_CLOCK_SKEW:
        raise ModelRelayAttestationError("model relay attestation is too old")
    with tempfile.TemporaryDirectory(prefix="memorixbench-model-relay-") as directory:
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
                    MODEL_RELAY_ATTESTATION_NAMESPACE,
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
            raise ModelRelayAttestationError("ssh-keygen is unavailable for model relay verification") from error
    if completed.returncode != 0:
        raise ModelRelayAttestationError("model relay signature verification failed")
    return ModelRelayVerification(
        signer_principal=signed.signer_principal,
        attestation_payload_sha256=signed.attestation.payload_sha256,
        signature_sha256=signed.signature_sha256,
        verified_at=verified_now.isoformat(),
    )


def validate_model_relay_binding(
    attestation: ModelRelayAttestation,
    *,
    relay_policy_sha256: str,
    route_id: str,
    run_id: str,
    job_sha256: str,
    job_nonce: str,
    requested_model: str,
    actual_model: str,
    worker_result_sha256: str | None = None,
) -> None:
    """Bind a valid relay signature to exactly one declared model for one job."""

    attestation.validate()
    expected = {
        "relay_policy_sha256": relay_policy_sha256,
        "route_id": route_id,
        "run_id": run_id,
        "job_sha256": job_sha256,
        "job_nonce": job_nonce,
        "requested_model": requested_model,
        "actual_models": (actual_model,),
    }
    if worker_result_sha256 is not None:
        expected["worker_result_sha256"] = worker_result_sha256
    for field, value in expected.items():
        if getattr(attestation, field) != value:
            raise ModelRelayAttestationError(
                f"model relay attestation does not bind the expected {field}"
            )
