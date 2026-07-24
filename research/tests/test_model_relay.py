from dataclasses import replace
from datetime import datetime, timedelta, timezone
from pathlib import Path
import shutil
import subprocess

import pytest

from memorixbench.model_relay import (
    MODEL_RELAY_ATTESTATION_SCHEMA_VERSION,
    ModelRelayAttestation,
    ModelRelayAttestationError,
    SignedModelRelayAttestation,
    sign_model_relay_attestation,
    validate_model_relay_binding,
    verify_model_relay_attestation,
)


def _digest(character: str) -> str:
    return character * 64


def _attestation(*, now: datetime | None = None) -> ModelRelayAttestation:
    issued_at = now or datetime.now(timezone.utc)
    return ModelRelayAttestation(
        schema_version=MODEL_RELAY_ATTESTATION_SCHEMA_VERSION,
        relay_policy_sha256=_digest("a"),
        route_id="relay-model-x-v1",
        run_id="run-001",
        job_sha256=_digest("b"),
        job_nonce="c" * 32,
        requested_model="model-x",
        actual_models=("model-x",),
        request_count=3,
        provider_request_ids_sha256=_digest("d"),
        input_tokens=12,
        output_tokens=4,
        issued_at=issued_at.isoformat(),
        expires_at=(issued_at + timedelta(minutes=15)).isoformat(),
    )


def test_model_relay_binding_rejects_mixed_or_wrong_model() -> None:
    attestation = _attestation()

    validate_model_relay_binding(
        attestation,
        relay_policy_sha256=_digest("a"),
        route_id="relay-model-x-v1",
        run_id="run-001",
        job_sha256=_digest("b"),
        job_nonce="c" * 32,
        requested_model="model-x",
        actual_model="model-x",
    )

    with pytest.raises(ModelRelayAttestationError, match="actual_models"):
        validate_model_relay_binding(
            replace(attestation, actual_models=("model-x", "helper-model")),
            relay_policy_sha256=_digest("a"),
            route_id="relay-model-x-v1",
            run_id="run-001",
            job_sha256=_digest("b"),
            job_nonce="c" * 32,
            requested_model="model-x",
            actual_model="model-x",
        )


@pytest.mark.skipif(shutil.which("ssh-keygen") is None, reason="OpenSSH ssh-keygen is unavailable")
def test_model_relay_attestation_uses_a_separate_openssh_signature(tmp_path: Path) -> None:
    private_key = tmp_path / "relay-key"
    created = subprocess.run(
        ["ssh-keygen", "-q", "-t", "ed25519", "-N", "", "-f", str(private_key)],
        check=False,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    assert created.returncode == 0
    allowed_signers = tmp_path / "allowed-relay-signers"
    allowed_signers.write_text(
        "relay-alpha " + private_key.with_suffix(".pub").read_text(encoding="utf-8").strip() + "\n",
        encoding="utf-8",
    )
    attestation = _attestation()
    signed = sign_model_relay_attestation(
        attestation,
        signer_principal="relay-alpha",
        private_key=private_key,
    )

    verification = verify_model_relay_attestation(
        signed,
        allowed_signers=allowed_signers,
    )

    assert verification.signer_principal == "relay-alpha"
    assert verification.attestation_payload_sha256 == attestation.payload_sha256
    assert SignedModelRelayAttestation.from_public_payload(signed.public_payload()) == signed
    tampered_payload = signed.public_payload()
    tampered_payload["signature_sha256"] = _digest("0")
    with pytest.raises(ModelRelayAttestationError, match="signature digest"):
        SignedModelRelayAttestation.from_public_payload(tampered_payload)
    with pytest.raises(ModelRelayAttestationError, match="signature verification failed"):
        verify_model_relay_attestation(
            replace(signed, attestation=replace(attestation, route_id="other-route")),
            allowed_signers=allowed_signers,
        )
