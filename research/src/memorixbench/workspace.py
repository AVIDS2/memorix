from __future__ import annotations

from dataclasses import dataclass
import hashlib
import os
from pathlib import Path
import shutil
import stat
import subprocess
import time
from typing import Literal

from .oracle_assets import OracleAssetSet, public_oracle_assets
from .schema import CaseManifest, PhaseSpec, SourceCheckSpec

Stage = Literal["base", "precursor", "transfer"]


@dataclass(frozen=True)
class MaterializedWorkspace:
    case_id: str
    stage: Stage
    path: Path
    base_commit: str
    precursor_commit: str | None
    transfer_commit: str | None
    precursor_patch_sha256: str | None
    transition_patch_sha256: str | None
    repository_transport: str
    repository_origin: str | None


@dataclass(frozen=True)
class CommandResult:
    command: str
    returncode: int
    stdout: str
    stderr: str
    elapsed_seconds: float


@dataclass(frozen=True)
class SourceCheckResult:
    path: str
    passed: bool
    violations: tuple[str, ...]
    source_sha256: str | None
    scoped_source_sha256: str | None


@dataclass(frozen=True)
class TransferEvaluation:
    commands: tuple[CommandResult, ...]
    hidden_patch_sha256: str | None
    source_checks: tuple[SourceCheckResult, ...]
    source_check_phase: str

    @property
    def passed(self) -> bool:
        return phase_passed(list(self.commands)) and all(
            check.passed for check in self.source_checks
        )


def _run_git(cwd: Path, *args: str) -> str:
    completed = subprocess.run(
        ["git", *args],
        cwd=cwd,
        check=True,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    return completed.stdout.strip()


def _resolve_asset(manifest: CaseManifest, relative: str) -> Path:
    root = manifest.source_path.parent.resolve()
    candidate = (root / relative).resolve()
    if candidate != root and root not in candidate.parents:
        raise ValueError(f"case asset escapes its directory: {relative}")
    if not candidate.exists():
        raise ValueError(f"case asset does not exist: {candidate}")
    return candidate


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _commit_all(repo: Path, message: str) -> str:
    _run_git(repo, "add", "--all")
    _run_git(repo, "commit", "--quiet", "-m", message)
    return _run_git(repo, "rev-parse", "HEAD")


def _remove_readonly(func, path: str, _error_info) -> None:
    os.chmod(path, stat.S_IWRITE)
    func(path)


def _apply_patch(repo: Path, patch: Path, message: str) -> str:
    try:
        _run_git(repo, "apply", "--whitespace=nowarn", str(patch))
    except subprocess.CalledProcessError as error:
        details = (error.stderr or error.stdout or "git apply failed").strip()
        shutil.rmtree(repo, ignore_errors=True)
        raise ValueError(f"failed to apply {patch.name}: {details}") from error
    return _commit_all(repo, message)


def _normalized_git_url(value: str) -> str:
    return value.rstrip("/").removesuffix(".git")


def _verified_cache_source(
    manifest: CaseManifest,
    cache_root: str | Path,
) -> tuple[Path, str]:
    if manifest.repository.source_type != "git":
        raise ValueError("repository_cache is only valid for git repository cases")
    assert manifest.repository.url is not None
    cache = Path(cache_root).resolve()
    if not cache.is_dir():
        raise ValueError(f"repository cache does not exist: {cache}")
    try:
        origin = _run_git(cache, "remote", "get-url", "origin")
        _run_git(cache, "cat-file", "-e", f"{manifest.repository.base_revision}^{{commit}}")
    except subprocess.CalledProcessError as error:
        details = (error.stderr or error.stdout or "invalid repository cache").strip()
        raise ValueError(f"invalid repository cache {cache}: {details}") from error
    if _normalized_git_url(origin) != _normalized_git_url(manifest.repository.url):
        raise ValueError(
            "repository cache origin does not match manifest URL: "
            f"{origin!r} != {manifest.repository.url!r}"
        )
    return cache, origin


def materialize_case(
    manifest: CaseManifest,
    target: str | Path,
    *,
    stage: Stage = "transfer",
    repository_cache: str | Path | None = None,
) -> MaterializedWorkspace:
    if stage not in {"base", "precursor", "transfer"}:
        raise ValueError(f"unsupported materialization stage: {stage}")
    target_path = Path(target).resolve()
    if target_path.exists():
        raise ValueError(f"target already exists: {target_path}")
    target_path.parent.mkdir(parents=True, exist_ok=True)

    repository_transport = "local-fixture"
    repository_origin: str | None = None
    if manifest.repository.source_type == "local-fixture":
        if repository_cache is not None:
            raise ValueError("repository_cache is only valid for git repository cases")
        assert manifest.repository.path is not None
        source = _resolve_asset(manifest, manifest.repository.path)
        if not source.is_dir():
            raise ValueError(f"local fixture is not a directory: {source}")
        shutil.copytree(source, target_path)
    else:
        assert manifest.repository.url is not None
        clone_source = manifest.repository.url
        repository_origin = manifest.repository.url
        if repository_cache is not None:
            cache, cache_origin = _verified_cache_source(manifest, repository_cache)
            clone_source = str(cache)
            repository_origin = cache_origin
            repository_transport = "pinned-local-cache"
        else:
            repository_transport = "remote"
        subprocess.run(
            ["git", "clone", "--quiet", "--no-checkout", clone_source, str(target_path)],
            check=True,
        )
        _run_git(target_path, "checkout", "--quiet", manifest.repository.base_revision)

    if not (target_path / ".git").exists():
        _run_git(target_path, "init", "--quiet")
    _run_git(target_path, "config", "user.name", "MemorixBench")
    _run_git(target_path, "config", "user.email", "memorixbench@example.invalid")
    if _run_git(target_path, "status", "--porcelain"):
        base_commit = _commit_all(target_path, "memorixbench: base fixture")
    else:
        base_commit = _run_git(target_path, "rev-parse", "HEAD")
    if manifest.repository.source_type == "git" and base_commit != manifest.repository.base_revision:
        raise ValueError(
            "materialized Git revision does not match the manifest commit: "
            f"{base_commit} != {manifest.repository.base_revision}"
        )

    precursor_commit: str | None = None
    transfer_commit: str | None = None
    precursor_sha: str | None = None
    transition_sha: str | None = None

    if stage in {"precursor", "transfer"} and manifest.precursor.patch:
        precursor_patch = _resolve_asset(manifest, manifest.precursor.patch)
        precursor_sha = _sha256(precursor_patch)
        precursor_commit = _apply_patch(
            target_path,
            precursor_patch,
            "memorixbench: apply precursor outcome",
        )

    if stage == "transfer" and manifest.transition.patch:
        transition_patch = _resolve_asset(manifest, manifest.transition.patch)
        transition_sha = _sha256(transition_patch)
        transfer_commit = _apply_patch(
            target_path,
            transition_patch,
            "memorixbench: apply between-session transition",
        )

    return MaterializedWorkspace(
        case_id=manifest.case_id,
        stage=stage,
        path=target_path,
        base_commit=base_commit,
        precursor_commit=precursor_commit,
        transfer_commit=transfer_commit,
        precursor_patch_sha256=precursor_sha,
        transition_patch_sha256=transition_sha,
        repository_transport=repository_transport,
        repository_origin=repository_origin,
    )


def run_phase_commands(
    phase: PhaseSpec,
    workspace: str | Path,
    *,
    timeout_seconds: int = 300,
) -> list[CommandResult]:
    cwd = Path(workspace).resolve()
    results: list[CommandResult] = []
    for command in phase.success_commands:
        started = time.monotonic()
        try:
            completed = subprocess.run(
                command,
                cwd=cwd,
                shell=True,
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=timeout_seconds,
            )
            result = CommandResult(
                command=command,
                returncode=completed.returncode,
                stdout=completed.stdout,
                stderr=completed.stderr,
                elapsed_seconds=time.monotonic() - started,
            )
        except subprocess.TimeoutExpired as error:
            result = CommandResult(
                command=command,
                returncode=124,
                stdout=(error.stdout or "") if isinstance(error.stdout, str) else "",
                stderr=(error.stderr or "") if isinstance(error.stderr, str) else "timeout",
                elapsed_seconds=time.monotonic() - started,
            )
        results.append(result)
    return results


def phase_passed(results: list[CommandResult]) -> bool:
    return bool(results) and all(result.returncode == 0 for result in results)


def advance_case_to_transfer(
    manifest: CaseManifest,
    workspace: str | Path,
) -> tuple[str | None, str | None]:
    if manifest.transition.kind == "none":
        return None, None
    if not manifest.transition.patch:
        raise ValueError("incremental transfer currently requires transition.patch")
    repo = Path(workspace).resolve()
    patch = _resolve_asset(manifest, manifest.transition.patch)
    patch_sha = _sha256(patch)
    commit = _apply_patch(
        repo,
        patch,
        "memorixbench: apply between-session transition",
    )
    return commit, patch_sha


def reset_history_to_snapshot(
    workspace: str | Path,
    *,
    message: str = "memorixbench: isolated transfer snapshot",
) -> str:
    repo = Path(workspace).resolve()
    git_dir = (repo / ".git").resolve()
    if git_dir.parent != repo or not git_dir.exists():
        raise ValueError(f"workspace has no removable Git metadata: {repo}")
    shutil.rmtree(git_dir, onerror=_remove_readonly)
    _run_git(repo, "init", "--quiet")
    _run_git(repo, "config", "user.name", "MemorixBench")
    _run_git(repo, "config", "user.email", "memorixbench@example.invalid")
    return _commit_all(repo, message)


def apply_reference_patch(
    manifest: CaseManifest,
    workspace: str | Path,
    *,
    oracle_assets: OracleAssetSet | None = None,
) -> str:
    """Mount the maintainer-only known-good repair before hidden-test grading."""
    assets = oracle_assets or public_oracle_assets(manifest)
    if assets.visibility == "private":
        raise ValueError("private oracle reference patches require the vault grader")
    if assets.reference_patch is None:
        raise ValueError(f"case has no oracle reference patch: {manifest.case_id}")
    repo = Path(workspace).resolve()
    patch = assets.reference_patch
    try:
        _run_git(repo, "apply", "--whitespace=nowarn", str(patch))
    except subprocess.CalledProcessError as error:
        details = (error.stderr or error.stdout or "git apply failed").strip()
        raise ValueError(f"failed to apply oracle reference patch: {details}") from error
    return _sha256(patch)


def _source_check_region(
    source: str,
    check: SourceCheckSpec,
) -> tuple[str | None, tuple[str, ...]]:
    if not check.scope_start:
        return source, ()
    start = source.find(check.scope_start)
    if start < 0:
        return None, (f"scope_start not found: {check.scope_start!r}",)
    if not check.scope_end:
        return source[start:], ()
    end = source.find(check.scope_end, start + len(check.scope_start))
    if end < 0:
        return None, (f"scope_end not found: {check.scope_end!r}",)
    return source[start:end], ()


def evaluate_source_checks(
    manifest: CaseManifest,
    workspace: str | Path,
) -> tuple[SourceCheckResult, ...]:
    root = Path(workspace).resolve()
    results: list[SourceCheckResult] = []
    for check in manifest.oracle.source_checks:
        candidate = (root / check.path).resolve()
        if candidate != root and root not in candidate.parents:
            raise ValueError(f"source check path escapes workspace: {check.path}")
        if not candidate.is_file():
            results.append(SourceCheckResult(
                path=check.path,
                passed=False,
                violations=("source file is missing",),
                source_sha256=None,
                scoped_source_sha256=None,
            ))
            continue
        source = candidate.read_text(encoding="utf-8", errors="replace")
        source_sha256 = hashlib.sha256(source.encode("utf-8")).hexdigest()
        region, violations = _source_check_region(source, check)
        if region is None:
            results.append(SourceCheckResult(
                path=check.path,
                passed=False,
                violations=violations,
                source_sha256=source_sha256,
                scoped_source_sha256=None,
            ))
            continue
        issues = list(violations)
        issues.extend(
            f"required literal is missing: {literal!r}"
            for literal in check.required_literals
            if literal not in region
        )
        issues.extend(
            f"forbidden literal is present: {literal!r}"
            for literal in check.forbidden_literals
            if literal in region
        )
        results.append(SourceCheckResult(
            path=check.path,
            passed=not issues,
            violations=tuple(issues),
            source_sha256=source_sha256,
            scoped_source_sha256=hashlib.sha256(
                region.encode("utf-8")
            ).hexdigest(),
        ))
    return tuple(results)


def remove_generated_workspace(path: str | Path, *, workspace_root: str | Path) -> None:
    target = Path(path).resolve()
    root = Path(workspace_root).resolve()
    if target == root or root not in target.parents:
        raise ValueError(f"refusing to remove path outside generated workspace root: {target}")
    if target.exists():
        shutil.rmtree(target, onerror=_remove_readonly)


def run_transfer_evaluation(
    manifest: CaseManifest,
    workspace: str | Path,
    *,
    timeout_seconds: int = 300,
    oracle_assets: OracleAssetSet | None = None,
) -> TransferEvaluation:
    repo = Path(workspace).resolve()
    assets = oracle_assets or public_oracle_assets(manifest)
    if assets.visibility == "private":
        raise ValueError("private oracle evaluation requires the vault grader")
    # Inspect the agent-authored source before a maintainer-only hidden patch can alter it.
    source_checks = evaluate_source_checks(manifest, repo)
    hidden_patch_sha256: str | None = None
    if assets.hidden_patch:
        patch = assets.hidden_patch
        hidden_patch_sha256 = _sha256(patch)
        try:
            _run_git(repo, "apply", "--whitespace=nowarn", str(patch))
        except subprocess.CalledProcessError as error:
            details = (error.stderr or error.stdout or "git apply failed").strip()
            raise ValueError(f"failed to mount hidden evaluation patch: {details}") from error
    return TransferEvaluation(
        commands=tuple(
            run_phase_commands(
                manifest.transfer,
                repo,
                timeout_seconds=timeout_seconds,
            )
        ),
        hidden_patch_sha256=hidden_patch_sha256,
        source_checks=source_checks,
        source_check_phase="pre-hidden-patch",
    )
