from __future__ import annotations

from dataclasses import dataclass, replace
import hashlib
from pathlib import Path
import shutil
import subprocess

from .annotation import BlindAnnotationPacket, build_blind_packet
from .oracle_assets import OracleAssetSet, load_private_oracle_overlay
from .schema import CaseManifest
from .sealed_patch import SealedPatch, snapshot_sealed_patch
from .workspace import MaterializedWorkspace, materialize_case


class VaultError(ValueError):
    """Raised when a private-oracle operation violates the vault boundary."""


@dataclass(frozen=True)
class DevelopmentVaultWorkspace:
    case_id: str
    root: Path
    path: Path
    materialized: MaterializedWorkspace
    sealed_patch: SealedPatch


def _sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def _apply_sealed_patch(workspace: Path, patch: SealedPatch) -> None:
    for args in (
        ("apply", "--check", "--whitespace=nowarn", str(patch.path)),
        ("apply", "--whitespace=nowarn", str(patch.path)),
    ):
        completed = subprocess.run(
            ["git", *args],
            cwd=workspace,
            check=False,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
        )
        if completed.returncode != 0:
            raise VaultError("sealed worker patch cannot be applied to a fresh vault workspace")


def _require_private_vault(manifest: CaseManifest, assets: OracleAssetSet) -> None:
    if manifest.oracle.visibility != "private" or assets.visibility != "private":
        raise VaultError("vault preparation requires private-oracle case assets")
    if assets.transition_patch is None or assets.transition_patch_sha256 is None:
        raise VaultError("private oracle has no committed transition")
    if assets.transition_patch_sha256 != manifest.transition.commitment_sha256:
        raise VaultError("private oracle transition does not match the public commitment")


def _refresh_private_assets(manifest: CaseManifest, assets: OracleAssetSet) -> OracleAssetSet:
    """Reject a private overlay that changed after its initial commitment check."""

    refreshed = load_private_oracle_overlay(manifest, assets.root)
    if refreshed.definition_sha256 != assets.definition_sha256:
        raise VaultError("private oracle changed after its initial commitment check")
    return refreshed


def _snapshot_committed_file(source: Path, target: Path, expected_sha256: str) -> None:
    """Freeze bytes once, then verify the exact bytes written into this vault run."""

    try:
        data = source.read_bytes()
    except OSError as error:
        raise VaultError("private oracle asset cannot be read for vault snapshot") from error
    if _sha256_bytes(data) != expected_sha256:
        raise VaultError("private oracle asset changed before vault snapshot")
    target.write_bytes(data)
    if _sha256_bytes(target.read_bytes()) != expected_sha256:
        raise VaultError("private oracle asset changed during vault snapshot")


def _snapshot_private_transition(assets: OracleAssetSet, vault_root: Path) -> Path:
    assert assets.transition_patch is not None
    assert assets.transition_patch_sha256 is not None
    target = vault_root / ".private-transition.patch"
    if target.exists():
        raise VaultError("private transition snapshot target already exists")
    _snapshot_committed_file(
        assets.transition_patch,
        target,
        assets.transition_patch_sha256,
    )
    return target


def build_vault_blind_annotation_packet(
    manifest: CaseManifest,
    assets: OracleAssetSet,
    *,
    result_path: str | Path,
    sanitized_action_ledger_path: str | Path,
    blind_salt: str,
) -> BlindAnnotationPacket:
    """Build a rater packet inside the vault without revealing the overlay identity."""

    assets = _refresh_private_assets(manifest, assets)
    _require_private_vault(manifest, assets)
    if assets.annotation_rubric is None:
        raise VaultError("private oracle has no committed annotation rubric")
    if assets.annotation_rubric_sha256 is None:
        raise VaultError("private annotation rubric is not committed")
    try:
        rubric_bytes = assets.annotation_rubric.read_bytes()
    except OSError as error:
        raise VaultError("private annotation rubric cannot be read") from error
    if _sha256_bytes(rubric_bytes) != assets.annotation_rubric_sha256:
        raise VaultError("private annotation rubric changed after its commitment check")
    try:
        rubric = rubric_bytes.decode("utf-8").strip()
    except UnicodeDecodeError as error:
        raise VaultError("private annotation rubric cannot be read") from error
    if not rubric:
        raise VaultError("private annotation rubric is empty")
    return build_blind_packet(
        result_path=result_path,
        sanitized_action_ledger_path=sanitized_action_ledger_path,
        task=manifest.transfer.task,
        rubric=rubric,
        blind_salt=blind_salt,
        forbidden_strings=(
            assets.overlay_id or "",
            str(assets.root),
            str(assets.annotation_rubric),
        ),
    )


def prepare_development_vault_workspace(
    manifest: CaseManifest,
    assets: OracleAssetSet,
    worker_patch: SealedPatch,
    target_root: str | Path,
    *,
    repository_cache: str | Path | None = None,
) -> DevelopmentVaultWorkspace:
    """Prepare a public transfer workspace without executing candidate code locally.

    The private transition is copied into a short-lived vault snapshot before
    materialization. The returned tree contains only the public workspace and
    a sealed worker patch. Local callback-based private grading is deliberately
    absent: it cannot provide the process boundary required for a result.
    """

    if manifest.split != "development":
        raise VaultError(
            "local vault preparation is development-only; confirmatory cases require a remote controller"
        )
    _require_private_vault(manifest, assets)
    assets = _refresh_private_assets(manifest, assets)
    root = Path(target_root).resolve()
    if root.exists():
        raise VaultError("vault grade target already exists")
    root.mkdir(parents=True)
    try:
        sealed_patch = snapshot_sealed_patch(worker_patch, root / "sealed-worker.patch")
        transition_snapshot = _snapshot_private_transition(assets, root)
        snapshot_assets = replace(assets, transition_patch=transition_snapshot)
        try:
            materialized = materialize_case(
                manifest,
                root / "workspace",
                stage="transfer",
                repository_cache=repository_cache,
                oracle_assets=snapshot_assets,
            )
        except Exception:
            raise VaultError("private transition could not be materialized") from None
        finally:
            transition_snapshot.unlink(missing_ok=True)
        _apply_sealed_patch(materialized.path, sealed_patch)
        return DevelopmentVaultWorkspace(
            case_id=manifest.case_id,
            root=root,
            path=materialized.path,
            materialized=materialized,
            sealed_patch=sealed_patch,
        )
    except VaultError:
        shutil.rmtree(root, ignore_errors=True)
        raise
    except Exception:
        shutil.rmtree(root, ignore_errors=True)
        raise VaultError("vault workspace preparation failed") from None
