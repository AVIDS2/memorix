"""Frozen public-release layout for the reproducible MemorixBench cohort."""

from __future__ import annotations

from pathlib import Path

from .case_bundle import public_case_bundle_relative_paths, public_case_definition_hash
from .public_artifact import PublicArtifactManifest, build_public_artifact_manifest
from .registry import load_case_registry, validate_case_registry
from .schema import load_case_manifest


PUBLIC_RELEASE_V2_ID = "memorixbench-public-cohort-v2"
PUBLIC_RELEASE_V2_TIER = "public-reproducible-summary-v1"
PUBLIC_RELEASE_V2_STATIC_PATHS = (
    "BASELINE_PROTOCOL.md",
    "ADMISSION-REVIEWER-GUIDE.md",
    "CASE-REGISTRY-CONTRACT.md",
    "CASE-ADMISSION-REVIEW-CONTRACT.md",
    "CLAIMS.md",
    "CONFIRMATORY-EXECUTION-ARCHITECTURE.md",
    "EVIDENCE-STATUS.md",
    "LITERATURE.md",
    "LOCAL-AGENT-UX-DIAGNOSTIC.md",
    "NATIVE-DIAGNOSTIC-EXECUTION-QUEUE.md",
    "NATIVE-MCP-BUDGET-CONTRACT.md",
    "NATIVE-SESSION-FORMATION-CONTRACT.md",
    "PRIVATE-ORACLE-CONTRACT.md",
    "PUBLIC-CROSS-MODEL-REPLICATION-CONTRACT.md",
    "PROTOCOL.md",
    "PUBLIC-ARTIFACT-CONTRACT.md",
    "PUBLIC-REPRODUCIBLE-STUDY-CONTRACT.md",
    "README.md",
    "RESULTS-PILOT.md",
    "RUNTIME-MEASUREMENT-CONTRACT.md",
    "SOURCE-LEDGER-CONTRACT.md",
    "AUTOMATED-PRE-ADMISSION-AUDIT-CONTRACT.md",
    "SUBMISSION-READINESS.md",
    "cases/REGISTRY.toml",
    "paper/README.md",
    "paper/main.tex",
    "paper/references.bib",
    "paper/sections/abstract.tex",
    "paper/sections/benchmark.tex",
    "paper/sections/evaluation.tex",
    "paper/sections/introduction.tex",
    "paper/sections/method.tex",
    "paper/sections/public-cohort.tex",
    "paper/sections/public-results.tex",
    "paper/sections/related-work.tex",
    "paper/sections/status.tex",
    "public-cohort-plans/memorixbench-public-cohort-v1.json",
    "public-cohort-plans/memorixbench-public-cross-model-deepseek-v1.json",
    "public-summary/README.md",
    "public-summary/public-cross-model-deepseek-v1.json",
    "public-summary/public-cohort-v1.json",
    "public-tests/test_public_release.py",
    "public-tests/test_public_native_hook_capture_contract.py",
    "pyproject.toml",
    "scripts/build-public-release.ps1",
    "scripts/native-hook-forwarder.ps1",
    "scripts/run-native-diagnostic-trial.ps1",
    "scripts/run-public-cohort-repeat.ps1",
    "src/memorixbench/__init__.py",
    "src/memorixbench/actions.py",
    "src/memorixbench/admission.py",
    "src/memorixbench/agentmemory_adapter.py",
    "src/memorixbench/agents.py",
    "src/memorixbench/analysis_plan.py",
    "src/memorixbench/annotation.py",
    "src/memorixbench/attestation.py",
    "src/memorixbench/authoring.py",
    "src/memorixbench/baseline.py",
    "src/memorixbench/baseline_preflight.py",
    "src/memorixbench/blackbox.py",
    "src/memorixbench/capture_session.py",
    "src/memorixbench/case_bundle.py",
    "src/memorixbench/cli.py",
    "src/memorixbench/isolation.py",
    "src/memorixbench/mem0_adapter.py",
    "src/memorixbench/mem0_worker.py",
    "src/memorixbench/memorix_adapter.py",
    "src/memorixbench/microvm.py",
    "src/memorixbench/model_relay.py",
    "src/memorixbench/model_route_preflight.py",
    "src/memorixbench/native_client_capture.py",
    "src/memorixbench/native_hook_capture.py",
    "src/memorixbench/native_mcp_gateway.py",
    "src/memorixbench/oracle_assets.py",
    "src/memorixbench/pre_admission.py",
    "src/memorixbench/permit.py",
    "src/memorixbench/power.py",
    "src/memorixbench/preflight.py",
    "src/memorixbench/public_analysis.py",
    "src/memorixbench/public_artifact.py",
    "src/memorixbench/public_cohort.py",
    "src/memorixbench/public_release.py",
    "src/memorixbench/public_safety.py",
    "src/memorixbench/registry.py",
    "src/memorixbench/reporting.py",
    "src/memorixbench/runtime_attestation.py",
    "src/memorixbench/runtime_measurement.py",
    "src/memorixbench/schema.py",
    "src/memorixbench/scoring.py",
    "src/memorixbench/sealed_patch.py",
    "src/memorixbench/source_ledger.py",
    "src/memorixbench/trace.py",
    "src/memorixbench/trace_capture.py",
    "src/memorixbench/trial.py",
    "src/memorixbench/vault.py",
    "src/memorixbench/worker_protocol.py",
    "src/memorixbench/workspace.py",
    "uv.lock",
)


class PublicReleaseError(ValueError):
    """Raised when the frozen public-release layout no longer matches its source tree."""


def _assert_static_source_layout(root: Path) -> None:
    declared = {
        path.removeprefix("src/memorixbench/")
        for path in PUBLIC_RELEASE_V2_STATIC_PATHS
        if path.startswith("src/memorixbench/")
    }
    observed = {
        path.relative_to(root / "src" / "memorixbench").as_posix()
        for path in (root / "src" / "memorixbench").glob("*.py")
    }
    if declared != observed:
        raise PublicReleaseError("public release source whitelist is stale")


def public_release_v2_paths(root: str | Path) -> tuple[str, ...]:
    """Expand only the frozen static list and registry-bound public bundles."""

    release_root = Path(root).resolve()
    if not release_root.is_dir():
        raise PublicReleaseError("public release root is unavailable")
    _assert_static_source_layout(release_root)
    paths = set(PUBLIC_RELEASE_V2_STATIC_PATHS)
    registry_path = release_root / "cases" / "REGISTRY.toml"
    registry = load_case_registry(registry_path)
    validation = validate_case_registry(registry, cases_root=release_root / "cases")
    if validation.confirmatory_count or validation.development_pilot_count:
        raise PublicReleaseError("public release registry must contain only public-reproducible cases")
    for entry in registry.entries:
        if entry.enrollment != "public-reproducible":
            raise PublicReleaseError("public release encountered a non-public case")
        case_path = release_root / "cases" / Path(entry.path)
        manifest = load_case_manifest(case_path)
        if public_case_definition_hash(manifest) != entry.case_definition_sha256:
            raise PublicReleaseError("public release case definition hash is stale")
        case_prefix = Path(entry.path).parent
        for asset in public_case_bundle_relative_paths(manifest):
            paths.add((Path("cases") / case_prefix / Path(asset)).as_posix())
    return tuple(sorted(paths))


def build_public_release_v2_manifest(
    *,
    root: str | Path,
    created_at: str | None = None,
) -> PublicArtifactManifest:
    return build_public_artifact_manifest(
        root=root,
        release_id=PUBLIC_RELEASE_V2_ID,
        evidence_tier=PUBLIC_RELEASE_V2_TIER,
        paths=public_release_v2_paths(root),
        created_at=created_at,
    )
