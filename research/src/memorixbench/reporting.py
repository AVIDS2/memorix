from __future__ import annotations

from dataclasses import asdict
import hashlib
from typing import Sequence

from .authoring import AuthoringVerification
from .workspace import CommandResult, SourceCheckResult


def _output_digest(value: str) -> tuple[str, int]:
    encoded = value.encode("utf-8")
    return hashlib.sha256(encoded).hexdigest(), len(encoded)


def serialize_command_results(
    results: Sequence[CommandResult],
    *,
    private_oracle: bool,
) -> list[dict[str, object]]:
    """Return command evidence without exposing private-verifier output."""

    if not private_oracle:
        return [asdict(result) for result in results]
    payloads: list[dict[str, object]] = []
    for index, result in enumerate(results, 1):
        stdout_sha256, stdout_bytes = _output_digest(result.stdout)
        stderr_sha256, stderr_bytes = _output_digest(result.stderr)
        payloads.append(
            {
                "id": f"private-verification-{index}",
                "returncode": result.returncode,
                "elapsed_seconds": result.elapsed_seconds,
                "stdout_sha256": stdout_sha256,
                "stderr_sha256": stderr_sha256,
                "stdout_bytes": stdout_bytes,
                "stderr_bytes": stderr_bytes,
            }
        )
    return payloads


def serialize_source_checks(
    checks: Sequence[SourceCheckResult],
    *,
    private_oracle: bool,
) -> list[dict[str, object]]:
    if not private_oracle:
        return [asdict(check) for check in checks]
    return [
        {
            "id": f"private-source-check-{index}",
            "passed": check.passed,
            "source_sha256": check.source_sha256,
            "scoped_source_sha256": check.scoped_source_sha256,
            "violation_count": len(check.violations),
        }
        for index, check in enumerate(checks, 1)
    ]


def serialize_authoring_verification(
    verification: AuthoringVerification,
    *,
    private_oracle: bool,
) -> dict[str, object]:
    """Serialize maintainer verification evidence with private output redacted."""

    return {
        "case_id": verification.case_id,
        "target_root": verification.target_root,
        "private_oracle": private_oracle,
        "passed": verification.passed,
        "gates": [
            {
                "name": gate.name,
                "workspace": gate.workspace,
                "repository_transport": gate.repository_transport,
                "repository_origin": gate.repository_origin,
                "passed": gate.passed,
                "commands": serialize_command_results(
                    gate.commands,
                    private_oracle=private_oracle,
                ),
                "source_checks": serialize_source_checks(
                    gate.source_checks,
                    private_oracle=private_oracle,
                ),
                "hidden_patch_sha256": gate.hidden_patch_sha256,
                "reference_patch_sha256": gate.reference_patch_sha256,
            }
            for gate in verification.gates
        ],
    }
