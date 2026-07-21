import hashlib
import json
from pathlib import Path
from types import SimpleNamespace

import pytest

from memorixbench.case_bundle import (
    archive_public_case_definition,
    public_case_definition_hash,
)
import memorixbench.cli as cli
from memorixbench.authoring import AuthoringGateResult, AuthoringVerification
from memorixbench.oracle_assets import (
    load_private_oracle_overlay,
    resolve_oracle_assets,
)
from memorixbench.reporting import (
    serialize_authoring_verification,
    serialize_command_results,
    serialize_source_checks,
)
from memorixbench.schema import load_case_manifest
from memorixbench.trial import ensure_trial_eligibility
from memorixbench.workspace import (
    CommandResult,
    SourceCheckResult,
    TransferEvaluation,
    apply_reference_patch,
    run_transfer_evaluation,
)


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _private_case(tmp_path: Path) -> tuple[Path, Path]:
    case_root = tmp_path / "case"
    seed = case_root / "seed"
    seed.mkdir(parents=True)
    (seed / "value.txt").write_text("base\n", encoding="utf-8")
    transition = case_root / "transition.patch"
    transition.write_text(
        "--- a/value.txt\n+++ b/value.txt\n@@ -1 +1 @@\n-base\n+transfer\n",
        encoding="utf-8",
    )
    manifest_path = case_root / "case.toml"
    manifest_path.write_text(
        """
schema_version = "0.5"
id = "private-oracle-case"
title = "Private oracle case"
split = "test"
dependency_strength = "high"
dependency_classification_status = "preregistered"
language = "text"
tags = ["private-oracle"]

[bundle]
public_paths = ["case.toml", "seed", "transition.patch"]

[repository]
source_type = "local-fixture"
path = "seed"
base_revision = "fixture-base"

[precursor]
task = "Inspect the precursor."
success_commands = ["git status --short"]

[transition]
kind = "code-change"
description = "Apply the public transfer transition."
apply_commands = []
patch = "transition.patch"

[transfer]
task = "Repair the transfer state."
success_commands = ["git status --short"]

[oracle]
visibility = "private"
required_isolation_profile = "remote-worker-vault-v1"
verifier_mode = "black-box-controller-v1"
required_start_files = ["value.txt"]
relevant_evidence_ids = []
stale_evidence_ids = []
forbidden_actions = []
""".strip(),
        encoding="utf-8",
    )
    manifest = load_case_manifest(manifest_path)
    overlay = tmp_path / "private-overlay"
    overlay.mkdir()
    hidden = overlay / "hidden-tests.patch"
    reference = overlay / "reference.patch"
    hidden.write_text("hidden\n", encoding="utf-8")
    reference.write_text("reference\n", encoding="utf-8")
    (overlay / "oracle.toml").write_text(
        f"""
schema_version = "0.1"
overlay_id = "opaque-test-1"
case_id = "{manifest.case_id}"
public_case_definition_sha256 = "{public_case_definition_hash(manifest)}"
base_commit = "{manifest.repository.base_revision}"
transition_patch_sha256 = "{_sha256(transition)}"
hidden_patch = "{hidden.name}"
hidden_patch_sha256 = "{_sha256(hidden)}"
reference_patch = "{reference.name}"
reference_patch_sha256 = "{_sha256(reference)}"
verifier_runtime_sha256 = "{'0' * 64}"
""".strip(),
        encoding="utf-8",
    )
    return manifest_path, overlay


def test_loads_private_oracle_bound_to_public_case_tree(tmp_path: Path) -> None:
    manifest_path, overlay = _private_case(tmp_path)
    manifest = load_case_manifest(manifest_path)

    assets = load_private_oracle_overlay(manifest, overlay)

    assert assets.visibility == "private"
    assert assets.overlay_id == "opaque-test-1"
    assert assets.hidden_patch and assets.hidden_patch.parent == overlay
    assert assets.reference_patch and assets.reference_patch.parent == overlay


def test_private_case_archives_only_declared_public_bundle_paths(tmp_path: Path) -> None:
    manifest_path, _overlay = _private_case(tmp_path)
    manifest = load_case_manifest(manifest_path)
    secret_file = manifest_path.parent / "unlisted-private-note.txt"
    secret_file.write_text("must-not-enter-public-bundle\n", encoding="utf-8")
    original_hash = public_case_definition_hash(manifest)

    archived_hash = archive_public_case_definition(manifest, tmp_path / "artifact")

    archive_root = tmp_path / "artifact" / "case-definition"
    assert archived_hash == original_hash
    assert (archive_root / "case.toml").is_file()
    assert (archive_root / "seed" / "value.txt").is_file()
    assert not (archive_root / secret_file.name).exists()


def test_rejects_private_overlay_with_wrong_public_contract(tmp_path: Path) -> None:
    manifest_path, overlay = _private_case(tmp_path)
    manifest = load_case_manifest(manifest_path)
    definition = overlay / "oracle.toml"
    definition.write_text(
        definition.read_text(encoding="utf-8").replace(
            public_case_definition_hash(manifest),
            "f" * 64,
        ),
        encoding="utf-8",
    )

    with pytest.raises(ValueError, match="public case definition"):
        load_private_oracle_overlay(manifest, overlay)


def test_private_oracle_execution_remains_blocked_without_external_sandbox(
    tmp_path: Path,
) -> None:
    manifest_path, overlay = _private_case(tmp_path)
    manifest = load_case_manifest(manifest_path)
    assets = resolve_oracle_assets(manifest, overlay)

    with pytest.raises(ValueError, match="external sandbox isolation certificate"):
        ensure_trial_eligibility(manifest, agent="claude", oracle_assets=assets)
    with pytest.raises(ValueError, match="Codex private-oracle"):
        ensure_trial_eligibility(manifest, agent="codex", oracle_assets=assets)


def test_private_oracle_cannot_use_the_agent_workspace_grader(tmp_path: Path) -> None:
    manifest_path, overlay = _private_case(tmp_path)
    manifest = load_case_manifest(manifest_path)
    assets = resolve_oracle_assets(manifest, overlay)

    with pytest.raises(ValueError, match="vault grader"):
        run_transfer_evaluation(manifest, tmp_path, oracle_assets=assets)
    with pytest.raises(ValueError, match="vault grader"):
        apply_reference_patch(manifest, tmp_path, oracle_assets=assets)


def test_private_oracle_reports_redact_hidden_verifier_details() -> None:
    secret = "private-policy-detail-must-not-leak"
    command = CommandResult(
        command="python hidden-verifier.py",
        returncode=1,
        stdout=f"failure: {secret}",
        stderr=secret,
        elapsed_seconds=0.1,
    )
    check = SourceCheckResult(
        path="internal-policy.py",
        passed=False,
        violations=(secret,),
        source_sha256="a" * 64,
        scoped_source_sha256="b" * 64,
    )

    command_payload = serialize_command_results([command], private_oracle=True)
    check_payload = serialize_source_checks([check], private_oracle=True)
    verification = AuthoringVerification(
        case_id="private-oracle-case",
        target_root="C:/verification",
        gates=(
            AuthoringGateResult(
                name="transfer-hidden-regression",
                workspace="C:/verification/hidden",
                repository_transport="local-fixture",
                repository_origin=None,
                passed=False,
                commands=(command,),
                source_checks=(check,),
            ),
        ),
    )
    verification_payload = serialize_authoring_verification(
        verification,
        private_oracle=True,
    )

    assert "command" not in command_payload[0]
    assert "violations" not in check_payload[0]
    assert secret not in json.dumps(command_payload)
    assert secret not in json.dumps(check_payload)
    assert secret not in json.dumps(verification_payload)


def test_private_oracle_grade_cli_redacts_hidden_output(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    manifest_path, overlay = _private_case(tmp_path)
    manifest = load_case_manifest(manifest_path)
    secret = "private-grade-output-must-not-reach-cli"
    evaluation = TransferEvaluation(
        commands=(
            CommandResult(
                command="python hidden-verifier.py",
                returncode=1,
                stdout=secret,
                stderr=secret,
                elapsed_seconds=0.1,
            ),
        ),
        hidden_patch_sha256="c" * 64,
        source_checks=(),
        source_check_phase="pre-hidden",
    )
    monkeypatch.setattr(cli, "run_transfer_evaluation", lambda *args, **kwargs: evaluation)

    result = cli._grade(
        SimpleNamespace(
            allow_case_commands=True,
            case=manifest_path,
            private_oracle_root=overlay,
            reference=False,
            phase="transfer",
            workspace=tmp_path / "workspace",
            timeout_seconds=10,
        )
    )

    assert result == 1
    output = capsys.readouterr().out
    assert manifest.case_id in output
    assert secret not in output


def test_private_oracle_verify_cli_redacts_hidden_output(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    manifest_path, overlay = _private_case(tmp_path)
    secret = "private-verification-output-must-not-reach-cli"
    verification = AuthoringVerification(
        case_id="private-oracle-case",
        target_root="C:/verification",
        gates=(
            AuthoringGateResult(
                name="transfer-hidden-regression",
                workspace="C:/verification/hidden",
                repository_transport="local-fixture",
                repository_origin=None,
                passed=False,
                commands=(
                    CommandResult(
                        command="python hidden-verifier.py",
                        returncode=1,
                        stdout=secret,
                        stderr=secret,
                        elapsed_seconds=0.1,
                    ),
                ),
                source_checks=(),
            ),
        ),
    )
    monkeypatch.setattr(cli, "verify_case_authoring", lambda *args, **kwargs: verification)

    result = cli._verify_case(
        SimpleNamespace(
            allow_case_commands=True,
            case=manifest_path,
            target_root=tmp_path / "verification",
            timeout_seconds=10,
            repository_cache=None,
            private_oracle_root=overlay,
        )
    )

    assert result == 1
    assert secret not in capsys.readouterr().out
