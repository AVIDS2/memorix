from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

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
) -> AuthoringVerification:
    """Run the four deterministic gates required before a case reaches agents."""

    if not manifest.oracle.hidden_patch or not manifest.oracle.reference_patch:
        raise ValueError(
            "authoring verification requires oracle.hidden_patch and oracle.reference_patch"
        )

    root = Path(target_root).resolve()
    if root.exists():
        raise ValueError(f"authoring target root already exists: {root}")
    root.mkdir(parents=True)

    precursor = materialize_case(manifest, root / "01-precursor", stage="precursor")
    precursor_commands = tuple(
        run_phase_commands(
            manifest.precursor,
            precursor.path,
            timeout_seconds=timeout_seconds,
        )
    )

    public = materialize_case(manifest, root / "02-transfer-public", stage="transfer")
    public_commands = tuple(
        run_phase_commands(
            manifest.transfer,
            public.path,
            timeout_seconds=timeout_seconds,
        )
    )
    public_checks = evaluate_source_checks(manifest, public.path)

    hidden = materialize_case(manifest, root / "03-transfer-hidden", stage="transfer")
    hidden_evaluation = run_transfer_evaluation(
        manifest,
        hidden.path,
        timeout_seconds=timeout_seconds,
    )
    if hidden_evaluation.hidden_patch_sha256 is None:
        raise ValueError("authoring verification did not mount the hidden patch")

    reference = materialize_case(manifest, root / "04-transfer-reference", stage="transfer")
    reference_patch_sha256 = apply_reference_patch(manifest, reference.path)
    reference_evaluation = run_transfer_evaluation(
        manifest,
        reference.path,
        timeout_seconds=timeout_seconds,
    )

    gates = (
        AuthoringGateResult(
            name="precursor-public",
            workspace=str(precursor.path),
            passed=phase_passed(list(precursor_commands)),
            commands=precursor_commands,
            source_checks=(),
        ),
        AuthoringGateResult(
            name="transfer-public",
            workspace=str(public.path),
            passed=(
                phase_passed(list(public_commands))
                and _checks_passed(public_checks)
            ),
            commands=public_commands,
            source_checks=public_checks,
        ),
        AuthoringGateResult(
            name="transfer-hidden-regression",
            workspace=str(hidden.path),
            passed=(
                not phase_passed(list(hidden_evaluation.commands))
                and _checks_passed(hidden_evaluation.source_checks)
            ),
            commands=hidden_evaluation.commands,
            source_checks=hidden_evaluation.source_checks,
            hidden_patch_sha256=hidden_evaluation.hidden_patch_sha256,
        ),
        AuthoringGateResult(
            name="transfer-reference",
            workspace=str(reference.path),
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
