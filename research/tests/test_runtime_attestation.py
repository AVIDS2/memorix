from __future__ import annotations

from dataclasses import replace
from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
import shutil
import subprocess

import pytest

from memorixbench.attestation import REMOTE_WORKER_VAULT_PROFILE_ID
from memorixbench.runtime_attestation import (
    RUNTIME_ATTESTATION_SCHEMA_VERSION,
    RuntimeAttestation,
    RuntimeAttestationError,
    SignedRuntimeAttestation,
    load_signed_runtime_attestation,
    sign_runtime_attestation,
    validate_runtime_attestation_binding,
    verify_runtime_attestation,
)


def _digest(character: str) -> str:
    return character * 64


def _attestation(*, now: datetime | None = None) -> RuntimeAttestation:
    issued_at = now or datetime.now(timezone.utc)
    return RuntimeAttestation(
        schema_version=RUNTIME_ATTESTATION_SCHEMA_VERSION,
        profile_id=REMOTE_WORKER_VAULT_PROFILE_ID,
        run_id="run-001",
        job_sha256=_digest("1"),
        job_nonce="2" * 32,
        worker_result_sha256=_digest("3"),
        controller_policy_sha256=_digest("4"),
        runtime_measurement_policy_sha256=_digest("5"),
        worker_runtime_sha256=_digest("6"),
        agent_image="registry.example.invalid/memorix-agent@sha256:" + _digest("7"),
        agent_image_id="sha256:" + _digest("8"),
        tool_catalog_sha256=_digest("9"),
        container_inspection_sha256=_digest("a"),
        network_policy_id="model-relay-only-v1",
        isolation_measurement_sha256=_digest("b"),
        destruction_receipt_sha256=_digest("c"),
        issued_at=issued_at.isoformat(),
        expires_at=(issued_at + timedelta(minutes=15)).isoformat(),
    )


def test_runtime_attestation_round_trips_pinned_image_fields() -> None:
    attestation = _attestation()

    parsed = RuntimeAttestation.from_public_payload(attestation.public_payload())

    assert parsed == attestation


def test_runtime_attestation_requires_the_expected_execution_binding() -> None:
    attestation = _attestation()

    with pytest.raises(RuntimeAttestationError, match="expected worker_result_sha256"):
        validate_runtime_attestation_binding(
            attestation,
            controller_policy_sha256=_digest("4"),
            runtime_measurement_policy_sha256=_digest("5"),
            run_id="run-001",
            job_sha256=_digest("1"),
            job_nonce="2" * 32,
            worker_result_sha256=_digest("d"),
            worker_runtime_sha256=_digest("6"),
            agent_image=attestation.agent_image,
            agent_image_id=attestation.agent_image_id,
            tool_catalog_sha256=_digest("9"),
            container_inspection_sha256=_digest("a"),
        )


def test_signed_runtime_attestation_parser_rejects_a_forged_digest() -> None:
    attestation = _attestation()
    signed = SignedRuntimeAttestation(
        signer_principal="runtime-alpha",
        attestation=attestation,
        armored_signature="-----BEGIN SSH SIGNATURE-----\nplaceholder\n",
    )
    payload = signed.public_payload()
    payload["signature_sha256"] = _digest("0")

    with pytest.raises(RuntimeAttestationError, match="signature digest"):
        SignedRuntimeAttestation.from_public_payload(payload)


@pytest.mark.skipif(shutil.which("ssh-keygen") is None, reason="OpenSSH ssh-keygen is unavailable")
def test_runtime_attestation_uses_an_actual_independent_signature(tmp_path: Path) -> None:
    private_key = tmp_path / "runtime-key"
    completed = subprocess.run(
        ["ssh-keygen", "-q", "-t", "ed25519", "-N", "", "-f", str(private_key)],
        check=False,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    assert completed.returncode == 0
    allowed_signers = tmp_path / "allowed-runtime-signers"
    allowed_signers.write_text(
        "runtime-alpha " + private_key.with_suffix(".pub").read_text(encoding="utf-8").strip() + "\n",
        encoding="utf-8",
    )
    attestation = _attestation()
    signed = sign_runtime_attestation(
        attestation,
        signer_principal="runtime-alpha",
        private_key=private_key,
    )

    verification = verify_runtime_attestation(signed, allowed_signers=allowed_signers)

    assert verification.signer_principal == "runtime-alpha"
    assert verification.attestation_payload_sha256 == attestation.payload_sha256
    persisted = tmp_path / "signed-runtime-attestation.json"
    persisted.write_text(json.dumps(signed.public_payload()), encoding="utf-8")
    assert load_signed_runtime_attestation(persisted) == signed
    with pytest.raises(RuntimeAttestationError, match="signature verification failed"):
        verify_runtime_attestation(
            replace(signed, attestation=replace(attestation, run_id="run-002")),
            allowed_signers=allowed_signers,
        )
