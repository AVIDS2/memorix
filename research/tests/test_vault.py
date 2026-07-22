import json
from dataclasses import asdict
from pathlib import Path

from memorixbench.actions import write_action_ledger
from memorixbench.annotation import write_sanitized_action_ledger
from memorixbench.oracle_assets import resolve_oracle_assets
from memorixbench.schema import load_case_manifest
from memorixbench.sealed_patch import seal_patch, snapshot_sealed_patch
from memorixbench.vault import (
    PrivateVerifierRequest,
    PrivateVerifierResult,
    grade_sealed_patch,
    build_vault_blind_annotation_packet,
    prepare_vault_grade_workspace,
)

from test_oracle_assets import _private_case


def _worker_patch(tmp_path: Path) -> Path:
    patch = tmp_path / "worker.patch"
    patch.write_text(
        """diff --git a/value.txt b/value.txt
index df967b9..a0a6f7e 100644
--- a/value.txt
+++ b/value.txt
@@ -1 +1 @@
-transfer
+candidate
""",
        encoding="utf-8",
    )
    return patch


def test_vault_snapshots_worker_patch_before_fresh_workspace(tmp_path: Path) -> None:
    manifest_path, overlay = _private_case(tmp_path)
    manifest = load_case_manifest(manifest_path)
    assets = resolve_oracle_assets(manifest, overlay)
    worker_patch = seal_patch(_worker_patch(tmp_path))

    prepared = prepare_vault_grade_workspace(
        manifest,
        assets,
        worker_patch,
        tmp_path / "vault-grade",
    )

    assert prepared.path != worker_patch.path.parent
    assert prepared.sealed_patch.path.parent == tmp_path / "vault-grade"
    assert prepared.sealed_patch.sha256 == worker_patch.sha256
    assert (prepared.path / "value.txt").read_text(encoding="utf-8") == "candidate\n"
    assert not (prepared.path / "hidden-tests.patch").exists()


def test_snapshot_rejects_worker_patch_mutation_after_sealing(tmp_path: Path) -> None:
    source = _worker_patch(tmp_path)
    sealed = seal_patch(source)
    source.write_text("changed after worker seal\n", encoding="utf-8")

    try:
        snapshot_sealed_patch(sealed, tmp_path / "vault.patch")
    except Exception as error:
        assert "changed after sealing" in str(error)
    else:
        raise AssertionError("mutated worker patch was accepted")


def test_vault_receipt_redacts_private_verifier_output(tmp_path: Path) -> None:
    manifest_path, overlay = _private_case(tmp_path)
    manifest = load_case_manifest(manifest_path)
    assets = resolve_oracle_assets(manifest, overlay)
    worker_patch = seal_patch(_worker_patch(tmp_path))
    private_detail = "hidden verifier detail must not leave the vault"
    requests: list[PrivateVerifierRequest] = []

    def verifier(request: PrivateVerifierRequest) -> PrivateVerifierResult:
        requests.append(request)
        assert (request.workspace / "value.txt").read_text(encoding="utf-8") == "candidate\n"
        assert request.hidden_patch.parent.name == "private-assets"
        assert request.hidden_patch.parent != overlay
        assert request.verifier_runtime.parent == request.hidden_patch.parent
        assert request.verifier_image.startswith("registry.example.invalid/")
        assert request.verifier_command == ("/verifier/entrypoint",)
        return PrivateVerifierResult(
            passed=True,
            returncode=0,
            elapsed_seconds=0.01,
            stdout=private_detail,
            stderr=private_detail,
        )

    receipt = grade_sealed_patch(
        manifest,
        assets,
        worker_patch,
        tmp_path / "vault-grade",
        verifier,
    )

    assert len(requests) == 1
    assert receipt.passed
    assert receipt.evidence_tier == "diagnostic"
    assert receipt.grade_mode == "private-verifier-hook-diagnostic-v1"
    assert private_detail not in str(receipt)
    assert len(receipt.stdout_sha256) == 64
    assert not (tmp_path / "vault-grade" / "private-assets").exists()


def test_vault_builds_blind_packet_from_committed_private_rubric(tmp_path: Path) -> None:
    manifest_path, overlay = _private_case(tmp_path)
    manifest = load_case_manifest(manifest_path)
    assets = resolve_oracle_assets(manifest, overlay)
    timeline = tmp_path / "timeline.jsonl"
    timeline.write_text(json.dumps({
        "sequence": 0,
        "stream": "stdout",
        "elapsed_seconds": 1.0,
        "line": json.dumps({
            "type": "assistant",
            "message": {"content": [{
                "type": "tool_use",
                "id": "call",
                "name": "Bash",
                "input": {"command": "git status --short"},
            }]},
        }) + "\n",
    }) + "\n", encoding="utf-8")
    ledger_path = tmp_path / "action-ledger.json"
    ledger = write_action_ledger(agent="claude", timeline_path=timeline, path=ledger_path)
    sanitized_ledger_path = tmp_path / "sanitized-action-ledger.json"
    write_sanitized_action_ledger(ledger_path, sanitized_ledger_path)
    result_path = tmp_path / "result.json"
    result_path.write_text(json.dumps({
        "run_id": "private-run",
        "condition": "memorix-full",
        "agent": "claude",
        "model": "model-x",
        "memory_provider": "memorix",
        "agent_action_ledger_sha256": ledger.sha256,
    }), encoding="utf-8")

    packet = build_vault_blind_annotation_packet(
        manifest,
        assets,
        result_path=result_path,
        sanitized_action_ledger_path=sanitized_ledger_path,
        blind_salt="vault-only-salt",
    )

    serialized = json.dumps(asdict(packet)).casefold()
    assert "opaque-test-1" not in serialized
    assert str(overlay).casefold() not in serialized
    assert "memorix-full" not in serialized


def test_vault_rejects_an_overlay_mutated_after_initial_resolution(tmp_path: Path) -> None:
    manifest_path, overlay = _private_case(tmp_path)
    manifest = load_case_manifest(manifest_path)
    assets = resolve_oracle_assets(manifest, overlay)
    worker_patch = seal_patch(_worker_patch(tmp_path))
    assert assets.hidden_patch is not None
    assets.hidden_patch.write_text("changed after resolution\n", encoding="utf-8")

    def verifier(_request: PrivateVerifierRequest) -> PrivateVerifierResult:
        raise AssertionError("mutated private assets must not reach the verifier")

    try:
        grade_sealed_patch(
            manifest,
            assets,
            worker_patch,
            tmp_path / "vault-grade",
            verifier,
        )
    except ValueError as error:
        assert "hidden patch commitment" in str(error)
    else:
        raise AssertionError("mutated private overlay was accepted")
    assert not (tmp_path / "vault-grade" / "private-assets").exists()


def test_vault_receipt_hashes_private_output_as_original_bytes(tmp_path: Path) -> None:
    manifest_path, overlay = _private_case(tmp_path)
    manifest = load_case_manifest(manifest_path)
    assets = resolve_oracle_assets(manifest, overlay)
    worker_patch = seal_patch(_worker_patch(tmp_path))

    def verifier(_request: PrivateVerifierRequest) -> PrivateVerifierResult:
        return PrivateVerifierResult(
            passed=False,
            returncode=1,
            elapsed_seconds=0.01,
            stdout=b"\xff\x00",
            stderr=b"\x80",
        )

    receipt = grade_sealed_patch(
        manifest,
        assets,
        worker_patch,
        tmp_path / "vault-grade",
        verifier,
    )

    assert receipt.stdout_bytes == 2
    assert receipt.stderr_bytes == 1
    assert len(receipt.stdout_sha256) == 64
