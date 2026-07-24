from __future__ import annotations

from dataclasses import replace
from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
import sys

import pytest

from memorixbench.attestation import REMOTE_WORKER_VAULT_PROFILE_ID
from memorixbench import cli
from memorixbench.runtime_measurement import (
    REQUIRED_MEASUREMENTS,
    REQUIRED_NETWORK_POLICY_ID,
    REQUIRED_SUBJECT_ISOLATION_PROFILE,
    RUNTIME_MEASUREMENT_POLICY_SCHEMA_VERSION,
    RUNTIME_MEASUREMENT_RECEIPT_SCHEMA_VERSION,
    RuntimeMeasurementError,
    RuntimeMeasurementEvidence,
    RuntimeMeasurementPolicy,
    RuntimeMeasurementReceipt,
    load_runtime_measurement_policy,
    validate_runtime_measurement_receipt_binding,
)


def _digest(character: str) -> str:
    return character * 64


def _policy() -> RuntimeMeasurementPolicy:
    return RuntimeMeasurementPolicy(
        schema_version=RUNTIME_MEASUREMENT_POLICY_SCHEMA_VERSION,
        policy_id="remote-kvm-runtime-v1",
        profile_id=REMOTE_WORKER_VAULT_PROFILE_ID,
        subject_isolation_profile=REQUIRED_SUBJECT_ISOLATION_PROFILE,
        network_policy_id=REQUIRED_NETWORK_POLICY_ID,
        required_measurements=REQUIRED_MEASUREMENTS,
        maximum_receipt_age_seconds=300,
    )


def _receipt(
    policy: RuntimeMeasurementPolicy,
    *,
    now: datetime | None = None,
) -> RuntimeMeasurementReceipt:
    observed_at = now or datetime.now(timezone.utc)
    return RuntimeMeasurementReceipt(
        schema_version=RUNTIME_MEASUREMENT_RECEIPT_SCHEMA_VERSION,
        policy_sha256=policy.sha256,
        profile_id=policy.profile_id,
        subject_isolation_profile=policy.subject_isolation_profile,
        network_policy_id=policy.network_policy_id,
        run_id="run-001",
        job_sha256=_digest("1"),
        job_nonce="2" * 32,
        worker_result_sha256=_digest("3"),
        evidence=tuple(
            RuntimeMeasurementEvidence(measurement_id=item, evidence_sha256=_digest(str(index)))
            for index, item in enumerate(REQUIRED_MEASUREMENTS, start=4)
        ),
        destruction_receipt_sha256=_digest("9"),
        observed_at=observed_at.isoformat(),
    )


def test_runtime_measurement_policy_round_trips_canonically() -> None:
    policy = _policy()

    parsed = RuntimeMeasurementPolicy.from_public_payload(policy.public_payload())

    assert parsed == policy
    assert parsed.sha256 == policy.sha256


def test_runtime_measurement_policy_loader_requires_a_valid_document(tmp_path: Path) -> None:
    policy = _policy()
    path = tmp_path / "runtime-measurement-policy.json"
    path.write_text(json.dumps(policy.public_payload()), encoding="utf-8")

    assert load_runtime_measurement_policy(path) == policy


def test_runtime_measurement_policy_rejects_an_incomplete_evidence_set() -> None:
    with pytest.raises(RuntimeMeasurementError, match="evidence set"):
        replace(_policy(), required_measurements=REQUIRED_MEASUREMENTS[:-1]).validate()


def test_runtime_measurement_receipt_binds_exact_run_and_is_fresh() -> None:
    now = datetime(2026, 7, 23, tzinfo=timezone.utc)
    policy = _policy()
    receipt = _receipt(policy, now=now)

    validate_runtime_measurement_receipt_binding(
        receipt,
        policy=policy,
        run_id="run-001",
        job_sha256=_digest("1"),
        job_nonce="2" * 32,
        worker_result_sha256=_digest("3"),
        destruction_receipt_sha256=_digest("9"),
        now=now,
    )
    with pytest.raises(RuntimeMeasurementError, match="expected worker_result_sha256"):
        validate_runtime_measurement_receipt_binding(
            receipt,
            policy=policy,
            run_id="run-001",
            job_sha256=_digest("1"),
            job_nonce="2" * 32,
            worker_result_sha256=_digest("a"),
            destruction_receipt_sha256=_digest("9"),
            now=now,
        )
    with pytest.raises(RuntimeMeasurementError, match="too old"):
        _receipt(policy, now=now - timedelta(seconds=301)).validate(policy, now=now)


def test_runtime_measurement_receipt_parser_rejects_extra_fields() -> None:
    policy = _policy()
    payload = _receipt(policy).public_payload()
    payload["untrusted"] = True

    with pytest.raises(RuntimeMeasurementError, match="unsupported fields"):
        RuntimeMeasurementReceipt.from_public_payload(payload, policy=policy)


def test_runtime_measurement_cli_prints_hash_only_summary(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    policy = _policy()
    receipt = _receipt(policy)
    policy_path = tmp_path / "runtime-measurement-policy.json"
    receipt_path = tmp_path / "runtime-measurement-receipt.json"
    policy_path.write_text(json.dumps(policy.public_payload()), encoding="utf-8")
    receipt_path.write_text(json.dumps(receipt.public_payload()), encoding="utf-8")
    monkeypatch.setattr(
        sys,
        "argv",
        ["memorixbench", "validate-runtime-measurement", str(policy_path), str(receipt_path)],
    )

    assert cli.main() == 0

    summary = json.loads(capsys.readouterr().out)
    assert summary["policy_sha256"] == policy.sha256
    assert summary["receipt_sha256"] == receipt.sha256
    assert summary["measurement_ids"] == list(REQUIRED_MEASUREMENTS)
