from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from .oracle_assets import OracleAssetSet, public_oracle_assets
from .schema import CaseManifest
from .workspace import (
    CommandResult,
    SourceCheckResult,
    apply_reference_patch,
    evaluate_source_checks,
    materialize_case,
    phase_passed,
    run_phase_commands,
    run_transfer_evaluation,
)


@dataclass(frozen=True)
class AuthoringGateResult:
    name: str
    workspace: str
    repository_transport: str
    repository_origin: str | None
    passed: bool
    commands: tuple[CommandResult, ...]
    source_checks: tuple[SourceCheckResult, ...]
    hidden_patch_sha256: str | None = None
    reference_patch_sha256: str | None = None


@dataclass(frozen=True)
class AuthoringVerification:
    case_id: str
    target_root: str
    gates: tuple[AuthoringGateResult, ...]

    @property
    def passed(self) -> bool:
        return bool(self.gates) and all(gate.passed for gate in self.gates)


def _checks_passed(checks: tuple[SourceCheckResult, ...]) -> bool:
    return all(check.passed for check in checks)


def verify_case_authoring(
    manifest: CaseManifest,
    target_root: str | Path,
    *,
    timeout_seconds: int = 300,
    repository_cache: str | Path | None = None,
    oracle_assets: OracleAssetSet | None = None,
) -> AuthoringVerification:
    """Run the four deterministic gates required before a case reaches agents."""

    assets = oracle_assets or public_oracle_assets(manifest)
    if not assets.hidden_patch or not assets.reference_patch:
        raise ValueError(
            "authoring verification requires oracle.hidden_patch and oracle.reference_patch"
        )
    allow_development_private = (
        manifest.split == "development"
        and assets.visibility == "private"
        and assets.mode == "development-authoring-v1"
    )
    if assets.visibility == "private" and not allow_development_private:
        raise ValueError(
            "private-oracle authoring verification requires a development authoring overlay"
        )

    root = Path(target_root).resolve()
    if root.exists():
        raise ValueError(f"authoring target root already exists: {root}")
    root.mkdir(parents=True)

    precursor = materialize_case(
        manifest,
        root / "01-precursor",
        stage="precursor",
        repository_cache=repository_cache,
        oracle_assets=assets,
    )
    precursor_commands = tuple(
        run_phase_commands(
            manifest.precursor,
            precursor.path,
            timeout_seconds=timeout_seconds,
        )
    )

    public = materialize_case(
        manifest,
        root / "02-transfer-public",
        stage="transfer",
        repository_cache=repository_cache,
        oracle_assets=assets,
    )
    public_commands = tuple(
        run_phase_commands(
            manifest.transfer,
            public.path,
            timeout_seconds=timeout_seconds,
        )
    )
    hidden = materialize_case(
        manifest,
        root / "03-transfer-hidden",
        stage="transfer",
        repository_cache=repository_cache,
        oracle_assets=assets,
    )
    hidden_evaluation = run_transfer_evaluation(
        manifest,
        hidden.path,
        timeout_seconds=timeout_seconds,
        oracle_assets=assets,
        allow_development_private=allow_development_private,
    )
    if hidden_evaluation.hidden_patch_sha256 is None:
        raise ValueError("authoring verification did not mount the hidden patch")

    reference = materialize_case(
        manifest,
        root / "04-transfer-reference",
        stage="transfer",
        repository_cache=repository_cache,
        oracle_assets=assets,
    )
    reference_patch_sha256 = apply_reference_patch(
        manifest,
        reference.path,
        oracle_assets=assets,
        allow_development_private=allow_development_private,
    )
    reference_evaluation = run_transfer_evaluation(
        manifest,
        reference.path,
        timeout_seconds=timeout_seconds,
        oracle_assets=assets,
        allow_development_private=allow_development_private,
    )

    gates = (
        AuthoringGateResult(
            name="precursor-public",
            workspace=str(precursor.path),
            repository_transport=precursor.repository_transport,
            repository_origin=precursor.repository_origin,
            passed=phase_passed(list(precursor_commands)),
            commands=precursor_commands,
            source_checks=(),
        ),
        AuthoringGateResult(
            name="transfer-public",
            workspace=str(public.path),
            repository_transport=public.repository_transport,
            repository_origin=public.repository_origin,
            passed=phase_passed(list(public_commands)),
            commands=public_commands,
            source_checks=(),
        ),
        AuthoringGateResult(
            name="transfer-hidden-regression",
            workspace=str(hidden.path),
            repository_transport=hidden.repository_transport,
            repository_origin=hidden.repository_origin,
            passed=not phase_passed(list(hidden_evaluation.commands)),
            commands=hidden_evaluation.commands,
            source_checks=hidden_evaluation.source_checks,
            hidden_patch_sha256=hidden_evaluation.hidden_patch_sha256,
        ),
        AuthoringGateResult(
            name="transfer-reference",
            workspace=str(reference.path),
            repository_transport=reference.repository_transport,
            repository_origin=reference.repository_origin,
            passed=reference_evaluation.passed,
            commands=reference_evaluation.commands,
            source_checks=reference_evaluation.source_checks,
            hidden_patch_sha256=reference_evaluation.hidden_patch_sha256,
            reference_patch_sha256=reference_patch_sha256,
        ),
    )
    return AuthoringVerification(
        case_id=manifest.case_id,
        target_root=str(root),
        gates=gates,
    )
