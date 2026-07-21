from __future__ import annotations

from dataclasses import dataclass
import hashlib
from pathlib import Path
import subprocess
import time
from typing import Protocol

from .oracle_assets import OracleAssetSet
from .schema import CaseManifest
from .sealed_patch import SealedPatch, snapshot_sealed_patch
from .workspace import MaterializedWorkspace, materialize_case


class VaultError(ValueError):
    """Raised when a private-oracle operation violates the vault boundary."""


@dataclass(frozen=True)
class VaultGradeWorkspace:
    case_id: str
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
    stdout: str
    stderr: str


@dataclass(frozen=True)
class RedactedGradeReceipt:
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


def _sha256_text(value: str) -> tuple[str, int]:
    encoded = value.encode("utf-8")
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
            path=materialized.path,
            materialized=materialized,
            sealed_patch=sealed_patch,
        )
    except Exception:
        # Do not leave an ambiguous partial grade workspace after a failed seal/apply.
        import shutil

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
    """Grade a worker patch through a private verifier and return no private text."""

    workspace = prepare_vault_grade_workspace(
        manifest,
        assets,
        worker_patch,
        target_root,
        repository_cache=repository_cache,
    )
    assert assets.hidden_patch is not None
    assert assets.verifier_runtime is not None
    assert assets.verifier_image is not None
    started = time.monotonic()
    result = verifier(
        PrivateVerifierRequest(
            workspace=workspace.path,
            hidden_patch=assets.hidden_patch,
            verifier_runtime=assets.verifier_runtime,
            verifier_image=assets.verifier_image,
            verifier_command=assets.verifier_command,
            timeout_seconds=timeout_seconds,
        )
    )
    elapsed_seconds = max(result.elapsed_seconds, time.monotonic() - started)
    stdout_sha256, stdout_bytes = _sha256_text(result.stdout)
    stderr_sha256, stderr_bytes = _sha256_text(result.stderr)
    assert assets.verifier_runtime_sha256 is not None
    return RedactedGradeReceipt(
        case_id=manifest.case_id,
        sealed_patch_sha256=workspace.sealed_patch.sha256,
        public_case_definition_sha256=assets.public_contract_sha256,
        private_oracle_definition_sha256=assets.definition_sha256,
        verifier_runtime_sha256=assets.verifier_runtime_sha256,
        passed=result.passed,
        returncode=result.returncode,
        elapsed_seconds=elapsed_seconds,
        stdout_sha256=stdout_sha256,
        stderr_sha256=stderr_sha256,
        stdout_bytes=stdout_bytes,
        stderr_bytes=stderr_bytes,
    )
