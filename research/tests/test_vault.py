from pathlib import Path

from memorixbench.oracle_assets import resolve_oracle_assets
from memorixbench.schema import load_case_manifest
from memorixbench.sealed_patch import seal_patch, snapshot_sealed_patch
from memorixbench.vault import (
    PrivateVerifierRequest,
    PrivateVerifierResult,
    grade_sealed_patch,
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
        assert request.hidden_patch.parent == overlay
        assert request.verifier_runtime.parent == overlay
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
    assert private_detail not in str(receipt)
    assert len(receipt.stdout_sha256) == 64
