import json
from dataclasses import asdict
from pathlib import Path

import pytest

import memorixbench.vault as vault_module
from memorixbench.actions import write_action_ledger
from memorixbench.annotation import write_sanitized_action_ledger
from memorixbench.oracle_assets import resolve_oracle_assets
from memorixbench.schema import load_case_manifest
from memorixbench.sealed_patch import seal_patch, snapshot_sealed_patch
from memorixbench.vault import (
    VaultError,
    build_vault_blind_annotation_packet,
    prepare_development_vault_workspace,
)

from test_oracle_assets import _development_private_case, _private_case


def _worker_patch(tmp_path: Path) -> Path:
    patch = tmp_path / "worker.patch"
    patch.write_text(
        """diff --git a/value.txt b/value.txt
index df967b9..a0a6f7e 100644
--- a/value.txt
+++ b/value.txt
@@ -1 +1 @@
-broken
+candidate
""",
        encoding="utf-8",
    )
    return patch


def test_vault_snapshots_worker_patch_before_fresh_workspace(tmp_path: Path) -> None:
    manifest_path, overlay = _development_private_case(tmp_path)
    manifest = load_case_manifest(manifest_path)
    assets = resolve_oracle_assets(manifest, overlay)
    worker_patch = seal_patch(_worker_patch(tmp_path))

    prepared = prepare_development_vault_workspace(
        manifest,
        assets,
        worker_patch,
        tmp_path / "vault-grade",
    )

    assert prepared.path != worker_patch.path.parent
    assert prepared.sealed_patch.path.parent == tmp_path / "vault-grade"
    assert prepared.sealed_patch.sha256 == worker_patch.sha256
    assert (prepared.path / "value.txt").read_text(encoding="utf-8") == "candidate\n"
    assert not (prepared.root / "private-assets").exists()
    assert not (prepared.root / ".private-transition.patch").exists()


def test_snapshot_rejects_worker_patch_mutation_after_sealing(tmp_path: Path) -> None:
    source = _worker_patch(tmp_path)
    sealed = seal_patch(source)
    source.write_text("changed after worker seal\n", encoding="utf-8")

    with pytest.raises(Exception, match="changed after sealing"):
        snapshot_sealed_patch(sealed, tmp_path / "vault.patch")


def test_vault_materializes_private_transition_from_frozen_snapshot(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    manifest_path, overlay = _development_private_case(tmp_path)
    manifest = load_case_manifest(manifest_path)
    assets = resolve_oracle_assets(manifest, overlay)
    worker_patch = seal_patch(_worker_patch(tmp_path))
    assert assets.transition_patch is not None
    original_transition = assets.transition_patch
    original_materialize_case = vault_module.materialize_case

    def mutate_overlay_then_materialize(*args: object, **kwargs: object):
        snapshot_assets = kwargs["oracle_assets"]
        assert snapshot_assets.transition_patch != original_transition
        original_transition.write_text(
            "--- a/value.txt\n+++ b/value.txt\n@@ -1 +1 @@\n-base\n+tampered\n",
            encoding="utf-8",
        )
        return original_materialize_case(*args, **kwargs)

    monkeypatch.setattr(vault_module, "materialize_case", mutate_overlay_then_materialize)
    prepared = prepare_development_vault_workspace(
        manifest,
        assets,
        worker_patch,
        tmp_path / "vault-grade",
    )

    assert (prepared.path / "value.txt").read_text(encoding="utf-8") == "candidate\n"


def test_vault_redacts_private_transition_materialization_failure(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    manifest_path, overlay = _development_private_case(tmp_path)
    manifest = load_case_manifest(manifest_path)
    assets = resolve_oracle_assets(manifest, overlay)
    worker_patch = seal_patch(_worker_patch(tmp_path))

    def fail_materialization(*_args: object, **_kwargs: object):
        raise ValueError("private transition failed at C:\\vault\\oracle-secret.patch")

    monkeypatch.setattr(vault_module, "materialize_case", fail_materialization)

    with pytest.raises(VaultError, match="private transition could not be materialized") as error:
        prepare_development_vault_workspace(
            manifest,
            assets,
            worker_patch,
            tmp_path / "vault-grade",
        )

    assert "oracle-secret" not in str(error.value)
    assert not (tmp_path / "vault-grade").exists()


def test_local_vault_preparation_rejects_confirmatory_cases(tmp_path: Path) -> None:
    manifest_path, overlay = _private_case(tmp_path)
    manifest = load_case_manifest(manifest_path)
    assets = resolve_oracle_assets(manifest, overlay)
    worker_patch = seal_patch(_worker_patch(tmp_path))

    with pytest.raises(VaultError, match="development-only"):
        prepare_development_vault_workspace(
            manifest,
            assets,
            worker_patch,
            tmp_path / "vault-grade",
        )


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
