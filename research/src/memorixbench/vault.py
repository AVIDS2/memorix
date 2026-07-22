from __future__ import annotations

from dataclasses import dataclass
import hashlib
from pathlib import Path
import shutil
import subprocess
import time
from typing import Protocol

from .annotation import BlindAnnotationPacket, build_blind_packet
from .oracle_assets import OracleAssetSet, load_private_oracle_overlay, verifier_runtime_hash
from .schema import CaseManifest
from .sealed_patch import SealedPatch, snapshot_sealed_patch
from .workspace import MaterializedWorkspace, materialize_case


class VaultError(ValueError):
    """Raised when a private-oracle operation violates the vault boundary."""


@dataclass(frozen=True)
class VaultGradeWorkspace:
    case_id: str
    root: Path
    path: Path
    materialized: MaterializedWorkspace
    sealed_patch: SealedPatch


@dataclass(frozen=True)
class PrivateVerifierRequest:
    """Private-only request. Never serialize or pass this object to a worker."""

    workspace: Path
    hidden_patch: Path
    verifier_runtime: Path
    verifier_image: str
    verifier_command: tuple[str, ...]
    timeout_seconds: int


@dataclass(frozen=True)
class PrivateVerifierResult:
    passed: bool
    returncode: int
    elapsed_seconds: float
    stdout: str | bytes
    stderr: str | bytes


@dataclass(frozen=True)
class RedactedGradeReceipt:
    evidence_tier: str
    grade_mode: str
    case_id: str
    sealed_patch_sha256: str
    public_case_definition_sha256: str
    private_oracle_definition_sha256: str
    verifier_runtime_sha256: str
    passed: bool
    returncode: int
    elapsed_seconds: float
    stdout_sha256: str
    stderr_sha256: str
    stdout_bytes: int
    stderr_bytes: int


class PrivateVerifier(Protocol):
    def __call__(self, request: PrivateVerifierRequest) -> PrivateVerifierResult: ...


@dataclass(frozen=True)
class VaultPrivateAssetSnapshot:
    root: Path
    hidden_patch: Path
    verifier_runtime: Path
    verifier_image: str
    verifier_command: tuple[str, ...]
    definition_sha256: str
    verifier_runtime_sha256: str


def _sha256_output(value: str | bytes) -> tuple[str, int]:
    encoded = value.encode("utf-8") if isinstance(value, str) else value
    if not isinstance(encoded, bytes):
        raise VaultError("private verifier output must be text or bytes")
    return hashlib.sha256(encoded).hexdigest(), len(encoded)


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
        raise VaultError("vault grading requires private-oracle case assets")
    if assets.hidden_patch is None or assets.verifier_runtime is None:
        raise VaultError("private oracle has no complete verifier runtime")
    if assets.verifier_runtime_sha256 is None:
        raise VaultError("private oracle verifier runtime is not committed")
    if assets.hidden_patch_sha256 is None:
        raise VaultError("private oracle hidden patch is not committed")


def _refresh_private_assets(manifest: CaseManifest, assets: OracleAssetSet) -> OracleAssetSet:
    """Reject a private overlay that changed after its initial commitment check."""

    refreshed = load_private_oracle_overlay(manifest, assets.root)
    if refreshed.definition_sha256 != assets.definition_sha256:
        raise VaultError("private oracle changed after its initial commitment check")
    return refreshed


def _copy_committed_file(source: Path, target: Path, expected_sha256: str) -> None:
    if _sha256_output(source.read_bytes())[0] != expected_sha256:
        raise VaultError("private oracle asset changed before vault snapshot")
    shutil.copy2(source, target)
    if _sha256_output(target.read_bytes())[0] != expected_sha256:
        raise VaultError("private oracle asset changed during vault snapshot")


def _snapshot_private_assets(
    manifest: CaseManifest,
    assets: OracleAssetSet,
    vault_root: Path,
) -> VaultPrivateAssetSnapshot:
    """Copy committed private inputs into this vault run before any verifier sees them."""

    refreshed = _refresh_private_assets(manifest, assets)
    _require_private_vault(manifest, refreshed)
    assert refreshed.hidden_patch is not None
    assert refreshed.hidden_patch_sha256 is not None
    assert refreshed.verifier_runtime is not None
    assert refreshed.verifier_runtime_sha256 is not None
    assert refreshed.verifier_image is not None
    snapshot_root = vault_root / "private-assets"
    if snapshot_root.exists():
        raise VaultError("private vault snapshot target already exists")
    snapshot_root.mkdir()
    try:
        hidden_patch = snapshot_root / "hidden-tests.patch"
        _copy_committed_file(
            refreshed.hidden_patch,
            hidden_patch,
            refreshed.hidden_patch_sha256,
        )
        if verifier_runtime_hash(refreshed.verifier_runtime) != refreshed.verifier_runtime_sha256:
            raise VaultError("private verifier runtime changed before vault snapshot")
        verifier_runtime = snapshot_root / "verifier-runtime"
        shutil.copytree(refreshed.verifier_runtime, verifier_runtime, symlinks=True)
        if verifier_runtime_hash(verifier_runtime) != refreshed.verifier_runtime_sha256:
            raise VaultError("private verifier runtime changed during vault snapshot")
        return VaultPrivateAssetSnapshot(
            root=snapshot_root,
            hidden_patch=hidden_patch,
            verifier_runtime=verifier_runtime,
            verifier_image=refreshed.verifier_image,
            verifier_command=refreshed.verifier_command,
            definition_sha256=refreshed.definition_sha256,
            verifier_runtime_sha256=refreshed.verifier_runtime_sha256,
        )
    except Exception:
        shutil.rmtree(snapshot_root, ignore_errors=True)
        raise


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
    if _sha256_output(rubric_bytes)[0] != assets.annotation_rubric_sha256:
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


def prepare_vault_grade_workspace(
    manifest: CaseManifest,
    assets: OracleAssetSet,
    worker_patch: SealedPatch,
    target_root: str | Path,
    *,
    repository_cache: str | Path | None = None,
) -> VaultGradeWorkspace:
    """Materialize a fresh public transfer state and apply only a sealed patch."""

    _require_private_vault(manifest, assets)
    root = Path(target_root).resolve()
    if root.exists():
        raise VaultError("vault grade target already exists")
    root.mkdir(parents=True)
    try:
        sealed_patch = snapshot_sealed_patch(worker_patch, root / "sealed-worker.patch")
        materialized = materialize_case(
            manifest,
            root / "workspace",
            stage="transfer",
            repository_cache=repository_cache,
        )
        _apply_sealed_patch(materialized.path, sealed_patch)
        return VaultGradeWorkspace(
            case_id=manifest.case_id,
            root=root,
            path=materialized.path,
            materialized=materialized,
            sealed_patch=sealed_patch,
        )
    except Exception:
        # Do not leave an ambiguous partial grade workspace after a failed seal/apply.
        shutil.rmtree(root, ignore_errors=True)
        raise


def grade_sealed_patch(
    manifest: CaseManifest,
    assets: OracleAssetSet,
    worker_patch: SealedPatch,
    target_root: str | Path,
    verifier: PrivateVerifier,
    *,
    timeout_seconds: int = 300,
    repository_cache: str | Path | None = None,
) -> RedactedGradeReceipt:
    """Run a diagnostic-only private verifier and return no private text."""

    workspace = prepare_vault_grade_workspace(
        manifest,
        assets,
        worker_patch,
        target_root,
        repository_cache=repository_cache,
    )
    try:
        private_assets = _snapshot_private_assets(manifest, assets, workspace.root)
    except Exception:
        shutil.rmtree(workspace.root, ignore_errors=True)
        raise
    started = time.monotonic()
    try:
        result = verifier(
            PrivateVerifierRequest(
                workspace=workspace.path,
                hidden_patch=private_assets.hidden_patch,
                verifier_runtime=private_assets.verifier_runtime,
                verifier_image=private_assets.verifier_image,
                verifier_command=private_assets.verifier_command,
                timeout_seconds=timeout_seconds,
            )
        )
    finally:
        shutil.rmtree(private_assets.root, ignore_errors=True)
    elapsed_seconds = max(result.elapsed_seconds, time.monotonic() - started)
    stdout_sha256, stdout_bytes = _sha256_output(result.stdout)
    stderr_sha256, stderr_bytes = _sha256_output(result.stderr)
    return RedactedGradeReceipt(
        evidence_tier="diagnostic",
        grade_mode="private-verifier-hook-diagnostic-v1",
        case_id=manifest.case_id,
        sealed_patch_sha256=workspace.sealed_patch.sha256,
        public_case_definition_sha256=assets.public_contract_sha256,
        private_oracle_definition_sha256=private_assets.definition_sha256,
        verifier_runtime_sha256=private_assets.verifier_runtime_sha256,
        passed=result.passed,
        returncode=result.returncode,
        elapsed_seconds=elapsed_seconds,
        stdout_sha256=stdout_sha256,
        stderr_sha256=stderr_sha256,
        stdout_bytes=stdout_bytes,
        stderr_bytes=stderr_bytes,
    )
