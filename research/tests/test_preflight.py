from __future__ import annotations

from pathlib import Path

import pytest

from memorixbench.preflight import (
    PreflightError,
    load_environment_preflight_receipt,
    write_environment_preflight_receipt,
)


def test_writes_and_loads_a_passing_offline_preflight_receipt(tmp_path: Path) -> None:
    bootstrap_log = tmp_path / "bootstrap.log"
    offline_log = tmp_path / "offline.log"
    output = tmp_path / "receipt.json"
    bootstrap_log.write_text("bootstrap passed\n", encoding="utf-8")
    offline_log.write_text("offline passed\n", encoding="utf-8")

    receipt = write_environment_preflight_receipt(
        path=output,
        candidate_id="cobra-completion-os-args",
        base_revision="a" * 40,
        public_transition_revision="b" * 40,
        bootstrap_command="go test ./...",
        bootstrap_exit_code=0,
        bootstrap_log=bootstrap_log,
        offline_command="go test ./...",
        offline_exit_code=0,
        offline_log=offline_log,
        runtime="go1.25.5 windows-amd64",
        offline_policy="go-proxy-off-v1",
        observed_at_utc="2026-07-22T00:00:00+00:00",
    )

    loaded = load_environment_preflight_receipt(output)

    assert receipt.passed is True
    assert loaded == receipt


def test_preflight_rejects_inconsistent_pass_state(tmp_path: Path) -> None:
    bootstrap_log = tmp_path / "bootstrap.log"
    offline_log = tmp_path / "offline.log"
    bootstrap_log.write_text("bootstrap passed\n", encoding="utf-8")
    offline_log.write_text("offline failed\n", encoding="utf-8")
    output = tmp_path / "receipt.json"

    receipt = write_environment_preflight_receipt(
        path=output,
        candidate_id="cobra-completion-os-args",
        base_revision="a" * 40,
        public_transition_revision="b" * 40,
        bootstrap_command="go test ./...",
        bootstrap_exit_code=0,
        bootstrap_log=bootstrap_log,
        offline_command="go test ./...",
        offline_exit_code=1,
        offline_log=offline_log,
        runtime="go1.25.5 windows-amd64",
        offline_policy="go-proxy-off-v1",
    )
    assert receipt.passed is False

    payload = output.read_text(encoding="utf-8").replace('"passed": false', '"passed": true')
    output.write_text(payload, encoding="utf-8")

    with pytest.raises(PreflightError, match="inconsistent"):
        load_environment_preflight_receipt(output)
