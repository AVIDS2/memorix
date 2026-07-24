from __future__ import annotations

from dataclasses import replace
from datetime import datetime, timedelta, timezone
from pathlib import Path
import shutil
import subprocess

import pytest

from memorixbench.attestation import (
    AttestationError,
    REMOTE_WORKER_VAULT_PROFILE_ID,
    WORKER_ATTESTATION_SCHEMA_VERSION,
    SignedWorkerAttestation,
    WorkerAttestation,
    WorkerIsolationSummary,
    sign_worker_attestation,
    validate_attestation_binding,
    verify_worker_attestation,
)


def _digest(character: str) -> str:
    return character * 64


def _attestation(*, now: datetime | None = None) -> WorkerAttestation:
    issued_at = now or datetime.now(timezone.utc)
    return WorkerAttestation(
        schema_version=WORKER_ATTESTATION_SCHEMA_VERSION,
        profile_id=REMOTE_WORKER_VAULT_PROFILE_ID,
        run_id="run-001",
        case_id="case-001",
        condition="memorix-full",
        agent="claude",
        job_sha256=_digest("1"),
        public_case_definition_sha256=_digest("2"),
        public_bundle_sha256=_digest("3"),
        prompt_sha256=_digest("4"),
        memory_snapshot_sha256=_digest("5"),
        workspace_snapshot_sha256=_digest("6"),
        sealed_patch_sha256=_digest("7"),
        sealed_patch_bytes=123,
        worker_runtime_sha256=_digest("8"),
        subject_protocol_sha256=_digest("b"),
        controller_policy_sha256=_digest("c"),
        job_nonce="d" * 32,
        agent_image="registry.example.invalid/memorix-agent@sha256:" + _digest("9"),
        agent_image_id="sha256:" + _digest("a"),
        tool_catalog_sha256=_digest("b"),
        container_inspection_sha256=_digest("c"),
        model_relay_policy_sha256=_digest("d"),
        environment_allowlist_sha256=_digest("e"),
        sentinel_suite_sha256=_digest("f"),
        isolation=WorkerIsolationSummary(
            network_policy_id="model-relay-only-v1",
            privileged=False,
            read_only_rootfs=True,
            dropped_capabilities=("ALL",),
            no_new_privileges=True,
            host_pid_namespace=False,
            host_ipc_namespace=False,
            host_uts_namespace=False,
            host_user_namespace=False,
            host_network=False,
            workspace_mount_count=1,
            runtime_config_mount_count=1,
            oracle_mount_count=0,
            socket_mount_count=0,
            device_mount_count=0,
            credential_mount_count=0,
            unexpected_mount_count=0,
            agent_container_destroyed=True,
            destruction_receipt_sha256=_digest("0"),
        ),
        issued_at=issued_at.isoformat(),
        expires_at=(issued_at + timedelta(minutes=15)).isoformat(),
    )


def test_attestation_rejects_a_forbidden_worker_mount() -> None:
    attestation = _attestation()
    unsafe = replace(
        attestation,
        isolation=replace(attestation.isolation, oracle_mount_count=1),
    )

    with pytest.raises(AttestationError, match="forbidden mount"):
        unsafe.validate()


def test_attestation_rejects_a_stale_or_unbound_statement() -> None:
    now = datetime(2026, 7, 22, tzinfo=timezone.utc)
    stale = _attestation(now=now - timedelta(hours=2))
    signed = SignedWorkerAttestation(
        signer_principal="worker-alpha",
        attestation=stale,
        armored_signature="-----BEGIN SSH SIGNATURE-----\nplaceholder\n",
    )

    with pytest.raises(AttestationError, match="expired"):
        verify_worker_attestation(
            signed,
            allowed_signers=Path(__file__),
            now=now,
            ssh_keygen_binary="missing-ssh-keygen",
        )

    with pytest.raises(AttestationError, match="expected sealed_patch_sha256"):
        validate_attestation_binding(
            _attestation(now=now),
            run_id="run-001",
            case_id="case-001",
            condition="memorix-full",
            agent="claude",
            job_sha256=_digest("1"),
            public_case_definition_sha256=_digest("2"),
            workspace_snapshot_sha256=_digest("6"),
            sealed_patch_sha256=_digest("a"),
            sealed_patch_bytes=123,
            subject_protocol_sha256=_digest("b"),
            controller_policy_sha256=_digest("c"),
            job_nonce="d" * 32,
        )

    with pytest.raises(AttestationError, match="expected subject_protocol_sha256"):
        validate_attestation_binding(
            _attestation(now=now),
            run_id="run-001",
            case_id="case-001",
            condition="memorix-full",
            agent="claude",
            job_sha256=_digest("1"),
            public_case_definition_sha256=_digest("2"),
            workspace_snapshot_sha256=_digest("6"),
            sealed_patch_sha256=_digest("7"),
            sealed_patch_bytes=123,
            subject_protocol_sha256=_digest("c"),
            controller_policy_sha256=_digest("c"),
            job_nonce="d" * 32,
        )

    with pytest.raises(AttestationError, match="expected job_nonce"):
        validate_attestation_binding(
            _attestation(now=now),
            run_id="run-001",
            case_id="case-001",
            condition="memorix-full",
            agent="claude",
            job_sha256=_digest("1"),
            public_case_definition_sha256=_digest("2"),
            workspace_snapshot_sha256=_digest("6"),
            sealed_patch_sha256=_digest("7"),
            sealed_patch_bytes=123,
            subject_protocol_sha256=_digest("b"),
            controller_policy_sha256=_digest("c"),
            job_nonce="e" * 32,
        )


def test_attestation_payload_parser_rejects_type_coercion() -> None:
    payload = _attestation().public_payload()
    isolation = payload["isolation"]
    assert isinstance(isolation, dict)
    isolation["privileged"] = "false"

    with pytest.raises(AttestationError, match="must be boolean"):
        WorkerAttestation.from_public_payload(payload)


@pytest.mark.skipif(shutil.which("ssh-keygen") is None, reason="OpenSSH ssh-keygen is unavailable")
def test_worker_attestation_uses_an_actual_openssh_signature(tmp_path: Path) -> None:
    private_key = tmp_path / "worker-key"
    completed = subprocess.run(
        ["ssh-keygen", "-q", "-t", "ed25519", "-N", "", "-f", str(private_key)],
        check=False,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    assert completed.returncode == 0
    public_key = private_key.with_suffix(".pub").read_text(encoding="utf-8").strip()
    allowed_signers = tmp_path / "allowed-signers"
    allowed_signers.write_text(f"worker-alpha {public_key}\n", encoding="utf-8")
    attestation = _attestation()

    signed = sign_worker_attestation(
        attestation,
        signer_principal="worker-alpha",
        private_key=private_key,
    )
    verification = verify_worker_attestation(signed, allowed_signers=allowed_signers)

    assert verification.signer_principal == "worker-alpha"
    assert verification.attestation_payload_sha256 == attestation.payload_sha256

    tampered = replace(signed, attestation=replace(attestation, condition="baseline"))
    with pytest.raises(AttestationError, match="signature verification failed"):
        verify_worker_attestation(tampered, allowed_signers=allowed_signers)
