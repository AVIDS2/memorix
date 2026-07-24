import hashlib
import json
from pathlib import Path
from types import SimpleNamespace

import pytest

from memorixbench.case_bundle import (
    archive_public_case_definition,
    hash_case_tree,
    public_case_definition_hash,
)
import memorixbench.case_bundle as case_bundle_module
import memorixbench.cli as cli
from memorixbench.authoring import (
    AuthoringGateResult,
    AuthoringVerification,
    verify_case_authoring,
)
from memorixbench.oracle_assets import (
    load_private_oracle_overlay,
    resolve_oracle_assets,
    verifier_runtime_hash,
)
from memorixbench.public_safety import PublicSafetyError
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
    materialize_case,
    run_transfer_evaluation,
)


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _private_case(tmp_path: Path) -> tuple[Path, Path]:
    case_root = tmp_path / "case"
    seed = case_root / "seed"
    seed.mkdir(parents=True)
    (seed / "value.txt").write_text("base\n", encoding="utf-8")
    overlay = tmp_path / "private-overlay"
    overlay.mkdir()
    transition = overlay / "transition.patch"
    transition.write_text(
        "--- a/value.txt\n+++ b/value.txt\n@@ -1 +1 @@\n-base\n+transfer\n",
        encoding="utf-8",
    )
    manifest_path = case_root / "case.toml"
    manifest_path.write_text(
        f"""
schema_version = "0.5"
id = "private-oracle-case"
title = "Private oracle case"
split = "test"
dependency_strength = "high"
dependency_classification_status = "preregistered"
language = "text"
tags = ["private-oracle"]

[bundle]
public_paths = ["case.toml", "seed"]

[repository]
source_type = "local-fixture"
path = "seed"
base_revision = "fixture-base"

[precursor]
task = "Inspect the precursor."
success_commands = ["git status --short"]

[transition]
kind = "code-change"
description = "Apply the sealed transfer transition."
apply_commands = []
visibility = "private"
commitment_sha256 = "{_sha256(transition)}"

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
    hidden = overlay / "hidden-tests.patch"
    reference = overlay / "reference.patch"
    annotation_rubric = overlay / "annotation-rubric.md"
    verifier = overlay / "verifier-runtime"
    verifier.mkdir()
    (verifier / "entrypoint.txt").write_text(
        "fixed private verifier runtime\n",
        encoding="utf-8",
    )
    hidden.write_text("hidden\n", encoding="utf-8")
    reference.write_text("reference\n", encoding="utf-8")
    annotation_rubric.write_text("Assess the declared repair actions only.\n", encoding="utf-8")
    (overlay / "oracle.toml").write_text(
        f"""
schema_version = "0.2"
mode = "black-box-controller-v1"
overlay_id = "opaque-test-1"
case_id = "{manifest.case_id}"
public_case_definition_sha256 = "{public_case_definition_hash(manifest)}"
base_commit = "{manifest.repository.base_revision}"
transition_patch = "{transition.name}"
transition_patch_sha256 = "{_sha256(transition)}"
hidden_patch = "{hidden.name}"
hidden_patch_sha256 = "{_sha256(hidden)}"
reference_patch = "{reference.name}"
reference_patch_sha256 = "{_sha256(reference)}"
annotation_rubric = "{annotation_rubric.name}"
annotation_rubric_sha256 = "{_sha256(annotation_rubric)}"
verifier_runtime = "{verifier.name}"
verifier_runtime_sha256 = "{verifier_runtime_hash(verifier)}"
verifier_image = "registry.example.invalid/memorix-verifier@sha256:{'1' * 64}"
verifier_command = ["/verifier/entrypoint"]
""".strip(),
        encoding="utf-8",
    )
    return manifest_path, overlay


def _development_private_case(tmp_path: Path) -> tuple[Path, Path]:
    case_root = tmp_path / "development-case"
    seed = case_root / "seed"
    seed.mkdir(parents=True)
    (seed / "value.txt").write_text("base\n", encoding="utf-8")
    (seed / "expected.txt").write_text("base\n", encoding="utf-8")
    (seed / "check.py").write_text(
        "from pathlib import Path\n"
        "raise SystemExit(\n"
        "    Path('value.txt').read_text(encoding='utf-8')\n"
        "    != Path('expected.txt').read_text(encoding='utf-8')\n"
        ")\n",
        encoding="utf-8",
    )
    overlay = tmp_path / "development-private-overlay"
    overlay.mkdir()
    transition = overlay / "transition.patch"
    transition.write_text(
        "--- a/value.txt\n+++ b/value.txt\n@@ -1 +1 @@\n-base\n+broken\n"
        "--- a/expected.txt\n+++ b/expected.txt\n@@ -1 +1 @@\n-base\n+broken\n",
        encoding="utf-8",
    )
    command = json.dumps("python check.py")
    manifest_path = case_root / "case.toml"
    manifest_path.write_text(
        "\n".join(
            (
                'schema_version = "0.5"',
                'id = "development-private-oracle-case"',
                'title = "Development private oracle case"',
                'split = "development"',
                'dependency_strength = "low"',
                'dependency_classification_status = "retrospective-development"',
                'language = "text"',
                'tags = ["private-oracle", "development"]',
                '',
                '[bundle]',
                'public_paths = ["case.toml", "seed"]',
                '',
                '[repository]',
                'source_type = "local-fixture"',
                'path = "seed"',
                'base_revision = "fixture-base"',
                '',
                '[precursor]',
                'task = "Inspect the precursor."',
                f'success_commands = [{command}]',
                '',
                '[transition]',
                'kind = "code-change"',
                'description = "Apply the sealed transfer transition."',
                'apply_commands = []',
                'visibility = "private"',
                f'commitment_sha256 = "{_sha256(transition)}"',
                '',
                '[transfer]',
                'task = "Repair the transfer state."',
                f'success_commands = [{command}]',
                '',
                '[oracle]',
                'visibility = "private"',
                'required_start_files = ["value.txt"]',
                'relevant_evidence_ids = []',
                'stale_evidence_ids = []',
                'forbidden_actions = []',
            )
        )
        + "\n",
        encoding="utf-8",
    )
    manifest = load_case_manifest(manifest_path)
    hidden = overlay / "hidden-tests.patch"
    reference = overlay / "reference.patch"
    hidden.write_text(
        "--- a/expected.txt\n+++ b/expected.txt\n@@ -1 +1 @@\n-broken\n+fixed\n",
        encoding="utf-8",
    )
    reference.write_text(
        "--- a/value.txt\n+++ b/value.txt\n@@ -1 +1 @@\n-broken\n+fixed\n",
        encoding="utf-8",
    )
    (overlay / "oracle.toml").write_text(
        "\n".join(
            (
                'schema_version = "0.2"',
                'mode = "development-authoring-v1"',
                'overlay_id = "development-private-1"',
                f'case_id = "{manifest.case_id}"',
                f'public_case_definition_sha256 = "{public_case_definition_hash(manifest)}"',
                f'base_commit = "{manifest.repository.base_revision}"',
                f'transition_patch = "{transition.name}"',
                f'transition_patch_sha256 = "{_sha256(transition)}"',
                f'hidden_patch = "{hidden.name}"',
                f'hidden_patch_sha256 = "{_sha256(hidden)}"',
                f'reference_patch = "{reference.name}"',
                f'reference_patch_sha256 = "{_sha256(reference)}"',
                '',
                '[[source_check]]',
                'path = "value.txt"',
                'required_literals = ["fixed"]',
            )
        )
        + "\n",
        encoding="utf-8",
    )
    return manifest_path, overlay


def test_loads_private_oracle_bound_to_public_case_tree(tmp_path: Path) -> None:
    manifest_path, overlay = _private_case(tmp_path)
    manifest = load_case_manifest(manifest_path)

    assets = load_private_oracle_overlay(manifest, overlay)

    assert assets.visibility == "private"
    assert assets.overlay_id == "opaque-test-1"
    assert assets.transition_patch and assets.transition_patch.parent == overlay
    assert assets.hidden_patch and assets.hidden_patch.parent == overlay
    assert assets.reference_patch and assets.reference_patch.parent == overlay
    assert assets.annotation_rubric == overlay / "annotation-rubric.md"
    assert assets.verifier_runtime == overlay / "verifier-runtime"
    assert assets.hidden_patch_sha256 == _sha256(assets.hidden_patch)
    assert assets.transition_patch_sha256 == _sha256(assets.transition_patch)
    assert assets.reference_patch_sha256 == _sha256(assets.reference_patch)
    assert len(assets.definition_sha256) == 64


def test_development_private_overlay_is_limited_to_authoring_verification(
    tmp_path: Path,
) -> None:
    manifest_path, overlay = _development_private_case(tmp_path)
    manifest = load_case_manifest(manifest_path)
    assets = resolve_oracle_assets(manifest, overlay)

    assert assets.mode == "development-authoring-v1"
    assert len(assets.source_checks) == 1
    verification = verify_case_authoring(
        manifest,
        tmp_path / "authoring-artifacts",
        oracle_assets=assets,
    )

    assert verification.passed
    with pytest.raises(ValueError, match="development private-oracle trials are disabled"):
        ensure_trial_eligibility(manifest, agent="claude", oracle_assets=assets)


def test_private_transition_requires_overlay_before_workspace_creation(
    tmp_path: Path,
) -> None:
    manifest_path, overlay = _development_private_case(tmp_path)
    manifest = load_case_manifest(manifest_path)
    target = tmp_path / "missing-overlay-workspace"

    with pytest.raises(ValueError, match="private transition requires a private oracle overlay"):
        materialize_case(manifest, target, stage="transfer")
    assert not target.exists()

    assets = resolve_oracle_assets(manifest, overlay)
    materialized = materialize_case(
        manifest,
        tmp_path / "sealed-workspace",
        stage="transfer",
        oracle_assets=assets,
    )
    assert materialized.transition_patch_sha256 == assets.transition_patch_sha256
    assert (materialized.path / "value.txt").read_text(encoding="utf-8") == "broken\n"


def test_private_case_rejects_unbundled_files(tmp_path: Path) -> None:
    manifest_path, _overlay = _private_case(tmp_path)
    manifest = load_case_manifest(manifest_path)
    secret_file = manifest_path.parent / "unlisted-private-note.txt"
    secret_file.write_text("must-not-enter-public-bundle\n", encoding="utf-8")

    with pytest.raises(ValueError, match="unbundled file"):
        archive_public_case_definition(manifest, tmp_path / "artifact")


@pytest.mark.parametrize(
    ("content", "message"),
    (
        (r"C:\\Users\\alice\\private", "absolute host path"),
        ("ghp_" + "a" * 36, "credential-like"),
    ),
)
def test_private_case_rejects_sensitive_public_bundle_content(
    tmp_path: Path,
    content: str,
    message: str,
) -> None:
    manifest_path, _overlay = _private_case(tmp_path)
    manifest = load_case_manifest(manifest_path)
    (manifest_path.parent / "seed" / "value.txt").write_text(content, encoding="utf-8")

    with pytest.raises(PublicSafetyError, match=message):
        archive_public_case_definition(manifest, tmp_path / "artifact")


def test_public_case_rejects_windows_reparse_paths(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    manifest_path, _overlay = _private_case(tmp_path)
    manifest = load_case_manifest(manifest_path)

    monkeypatch.setattr(
        case_bundle_module,
        "_is_reparse_point",
        lambda path: path.name == "seed",
    )

    with pytest.raises(ValueError, match="symbolic or reparse"):
        public_case_definition_hash(manifest)


def test_public_case_archive_freezes_validated_bytes(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    manifest_path, _overlay = _private_case(tmp_path)
    manifest = load_case_manifest(manifest_path)
    source_file = manifest_path.parent / "seed" / "value.txt"
    original_read = case_bundle_module._read_public_case_bytes

    def read_then_mutate(path: Path, *, root: Path | None = None) -> bytes:
        content = original_read(path, root=root)
        if path == source_file:
            path.write_text("ghp_" + "a" * 36, encoding="utf-8")
        return content

    monkeypatch.setattr(case_bundle_module, "_read_public_case_bytes", read_then_mutate)
    artifact = tmp_path / "artifact"
    definition_sha256 = archive_public_case_definition(manifest, artifact)
    archived = artifact / "case-definition"

    assert (archived / "seed" / "value.txt").read_text(encoding="utf-8") == "base\n"
    assert definition_sha256 == hash_case_tree(archived)


def test_private_case_rejects_reserved_oracle_assets_in_public_tree(tmp_path: Path) -> None:
    manifest_path, _overlay = _private_case(tmp_path)
    manifest = load_case_manifest(manifest_path)
    (manifest_path.parent / "hidden-tests.patch").write_text(
        "must stay outside the public tree\n",
        encoding="utf-8",
    )

    with pytest.raises(ValueError, match="reserved private-oracle asset"):
        public_case_definition_hash(manifest)


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


def test_rejects_private_overlay_with_changed_verifier_runtime(tmp_path: Path) -> None:
    manifest_path, overlay = _private_case(tmp_path)
    manifest = load_case_manifest(manifest_path)
    (overlay / "verifier-runtime" / "entrypoint.txt").write_text(
        "changed after commitment\n",
        encoding="utf-8",
    )

    with pytest.raises(ValueError, match="verifier runtime commitment"):
        load_private_oracle_overlay(manifest, overlay)


def test_confirmatory_private_overlay_requires_an_explicit_black_box_mode(tmp_path: Path) -> None:
    manifest_path, overlay = _private_case(tmp_path)
    manifest = load_case_manifest(manifest_path)
    definition = overlay / "oracle.toml"
    definition.write_text(
        definition.read_text(encoding="utf-8").replace(
            'mode = "black-box-controller-v1"\n',
            "",
        ),
        encoding="utf-8",
    )

    with pytest.raises(ValueError, match="requires mode = black-box-controller-v1"):
        load_private_oracle_overlay(manifest, overlay)


def test_rejects_unpinned_private_verifier_image(tmp_path: Path) -> None:
    manifest_path, overlay = _private_case(tmp_path)
    manifest = load_case_manifest(manifest_path)
    definition = overlay / "oracle.toml"
    definition.write_text(
        definition.read_text(encoding="utf-8").replace(
            "registry.example.invalid/memorix-verifier@sha256:" + "1" * 64,
            "registry.example.invalid/memorix-verifier:latest",
        ),
        encoding="utf-8",
    )

    with pytest.raises(ValueError, match="image must be pinned"):
        load_private_oracle_overlay(manifest, overlay)


def test_private_overlay_errors_do_not_disclose_the_overlay_path(tmp_path: Path) -> None:
    manifest_path, overlay = _private_case(tmp_path)
    manifest = load_case_manifest(manifest_path)
    (overlay / "oracle.toml").unlink()

    with pytest.raises(ValueError) as error:
        load_private_oracle_overlay(manifest, overlay)

    assert str(overlay) not in str(error.value)


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
