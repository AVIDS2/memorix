from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import platform
import re
import subprocess
import sys
import time
import uuid

from .agents import (
    AgentExecution,
    AgentName,
    ModelUsage,
    audit_bash_commands,
    load_claude_provider_env,
    run_agent,
    write_claude_settings,
)
from .baseline import BaselineRetrieval
from .case_bundle import archive_public_case_definition
from .agentmemory_adapter import AGENTMEMORY_PROVIDER_ID, AgentMemoryFullAdapter
from .mem0_adapter import MEM0_PROVIDER_ID, Mem0LocalAdapter
from .memorix_adapter import (
    MEMORIX_CANONICAL_PROVIDER_ID,
    ingest_memorix_trace,
    retrieve_memorix_canonical,
    seed_memorix_canonical_evidence,
)
from .native_mcp_gateway import (
    NativeMcpBudgetPolicy,
    NativeMcpGatewayReceipt,
    load_native_mcp_receipt,
    write_native_mcp_config,
)
from .oracle_assets import OracleAssetSet, resolve_oracle_assets
from .reporting import serialize_command_results, serialize_source_checks
from .schema import CaseManifest, load_case_manifest
from .trace import TraceView, ResolvedPrecursorTrace, render_trace_view, resolve_precursor_trace
from .workspace import (
    advance_case_to_transfer,
    materialize_case,
    phase_passed,
    remove_generated_workspace,
    reset_history_to_snapshot,
    run_transfer_evaluation,
)

MEMORIX_CONDITION_MODES = {
    "memorix-1.2.1-local": "full",
    "memorix-1.2.1-micro-local": "micro",
    "memorix-1.2.1-lite-local": "lite",
    "memorix-1.2.1-full-local": "full",
    MEMORIX_CANONICAL_PROVIDER_ID: "micro",
}
MEMORIX_CONDITIONS = set(MEMORIX_CONDITION_MODES)
NATIVE_MEMORIX_CONDITIONS = MEMORIX_CONDITIONS - {MEMORIX_CANONICAL_PROVIDER_ID}
MEM0_CONDITIONS = {MEM0_PROVIDER_ID}
AGENTMEMORY_CONDITIONS = {AGENTMEMORY_PROVIDER_ID}
CANONICAL_RETRIEVAL_CONDITIONS = (
    MEM0_CONDITIONS | AGENTMEMORY_CONDITIONS | {MEMORIX_CANONICAL_PROVIDER_ID}
)
SUPPORTED_CONDITIONS = {
    "no-memory",
    "last-n",
    *MEMORIX_CONDITIONS,
    *CANONICAL_RETRIEVAL_CONDITIONS,
}
CANONICAL_RETRIEVAL_TOP_K = 8
CANONICAL_RETRIEVAL_TOKEN_BUDGET = 512
NATIVE_MCP_CALL_BUDGET = 1
MEMORIX_ALLOWED_TOOLS = (
    "mcp__memorix__memorix_project_context",
)
INFRASTRUCTURE_FAILURE_REASONS = {
    "authentication",
    "quota",
    "mcp-startup",
    "agent-runtime",
    "missing-completion-event",
    "model-route-mismatch",
}
CLAUDE_BASE_ALLOWED_TOOLS = ("Read", "Edit", "Bash(git *)")
SHA256_PATTERN = re.compile(r"^[0-9a-f]{64}$")


@dataclass(frozen=True)
class TrialOutcome:
    schema_version: str
    run_id: str
    study_id: str
    case_id: str
    case_split: str
    predecessor_dependency: str
    dependency_classification_status: str
    evidence_tier: str
    condition: str
    agent: AgentName
    model: str
    reported_models: tuple[str, ...]
    model_usage: tuple[ModelUsage, ...]
    model_profile: str
    repetition: int
    seed: int
    valid_run: bool
    failure_reason: str | None
    task_success: bool
    agent_returncode: int
    timed_out: bool
    first_correct_action_seconds: float | None
    first_correct_action_status: str
    annotation_status: str
    annotation_summary_sha256: str | None
    input_tokens: int | None
    cached_input_tokens: int | None
    output_tokens: int | None
    reasoning_output_tokens: int | None
    wall_seconds: float
    cost_usd: float | None
    stale_memory_errors: int | None
    stale_memory_error_status: str
    negative_control_intrusions: int | None
    negative_control_intrusion_status: str
    command_count: int
    tool_call_count: int
    tool_names: tuple[str, ...]
    tool_call_names: tuple[str, ...]
    successful_tool_call_count: int
    successful_tool_names: tuple[str, ...]
    successful_tool_call_names: tuple[str, ...]
    agent_action_count: int
    agent_action_ledger_sha256: str
    agent_action_timing_source: str
    permission_denials: tuple[str, ...]
    unavailable_tool_attempts: tuple[str, ...]
    bash_commands: tuple[str, ...]
    command_contamination_violations: tuple[str, ...]
    memory_tool_attempt_count: int
    memory_tool_call_count: int
    memory_provider: str | None
    retrieved_context_tokens: int | None
    retrieved_context_record_count: int | None
    retrieved_context_truncated: bool | None
    retrieval_call_count: int | None
    retrieval_round_count: int | None
    native_mcp_policy_sha256: str | None
    native_mcp_call_budget: int | None
    native_mcp_receipt_status: str
    native_mcp_call_attempt_count: int | None
    native_mcp_served_call_count: int | None
    native_mcp_context_tokens: int | None
    native_mcp_context_truncated: bool | None
    raw_replay_context_tokens: int | None
    raw_replay_context_truncated: bool | None
    formation_track: str
    study_track: str
    precursor_trace_sha256: str | None
    precursor_trace_source_sha256: str | None
    precursor_trace_view_sha256: str | None
    precursor_trace_capture_id: str | None
    precursor_trace_selection: str | None
    precursor_trace_bundle_sha256: str | None
    formation_receipt: dict[str, object] | None
    memory_preparation_seconds: float | None
    memory_retrieval_seconds: float | None
    memorix_cli_sha256: str | None
    case_manifest_sha256: str
    case_definition_sha256: str
    precursor_transcript_sha256: str | None
    base_commit: str
    precursor_commit: str | None
    transfer_commit: str | None
    precursor_patch_sha256: str | None
    transition_patch_sha256: str | None
    hidden_test_patch_sha256: str | None
    source_check_violations: tuple[str, ...]
    agent_start_commit: str
    patch_sha256: str
    platform: str
    python_version: str
    started_at: str
    artifact_receipt_id: str
    workspace_isolation: str
    repository_transport: str
    repository_origin_sha256: str | None
    oracle_visibility: str
    oracle_definition_sha256: str
    verifier_runtime_sha256: str | None


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _receipt_id(*values: str | None) -> str:
    payload = "\0".join(value or "" for value in values)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _require_sha256(value: str | None, *, field: str) -> None:
    if value is None or not SHA256_PATTERN.fullmatch(value):
        raise ValueError(f"trial outcome has an invalid {field}")


def validate_trial_outcome(outcome: TrialOutcome) -> None:
    """Reject result artifacts that would invalidate a paired Track C analysis."""

    if (
        getattr(outcome, "failure_reason", None) == "model-route-mismatch"
        and getattr(outcome, "valid_run", True)
    ):
        raise ValueError("model-route mismatch cannot be a valid run")
    if outcome.study_track not in {"B", "C"}:
        raise ValueError("trial outcome has an invalid study track")
    if outcome.study_track == "B" and outcome.formation_track != "seeded-canonical":
        raise ValueError("Track B trial outcome must use seeded-canonical formation")
    if outcome.study_track == "C":
        if outcome.formation_track != "trace-replay":
            raise ValueError("executable Track C trial outcome must use trace-replay formation")
        _require_sha256(outcome.precursor_trace_sha256, field="precursor trace hash")
        _require_sha256(outcome.precursor_trace_source_sha256, field="precursor trace source hash")
        if outcome.precursor_trace_capture_id is None:
            if any(
                value is not None
                for value in (
                    outcome.precursor_trace_selection,
                    outcome.precursor_trace_bundle_sha256,
                )
            ):
                raise ValueError("direct precursor trace cannot carry bundle selection metadata")
        else:
            if outcome.precursor_trace_selection != "hash-bucket-v1":
                raise ValueError("captured trace bundle has an invalid selection")
            _require_sha256(
                outcome.precursor_trace_bundle_sha256,
                field="precursor trace bundle hash",
            )
        if outcome.precursor_transcript_sha256 is not None:
            raise ValueError("Track C trial outcome must not carry a raw precursor transcript")
    if outcome.condition == "last-n" and outcome.study_track == "C":
        _require_sha256(outcome.precursor_trace_view_sha256, field="raw replay view hash")
        if outcome.raw_replay_context_tokens is None or (
            outcome.raw_replay_context_tokens > CANONICAL_RETRIEVAL_TOKEN_BUDGET
        ):
            raise ValueError("Track C raw replay exceeded or omitted its token budget")
    if outcome.condition in MEMORIX_CONDITIONS | MEM0_CONDITIONS | AGENTMEMORY_CONDITIONS:
        if not isinstance(outcome.formation_receipt, dict):
            raise ValueError("memory condition has no formation receipt")
        expected_surface = "trace-replay" if outcome.study_track == "C" else "seeded-canonical"
        if outcome.formation_receipt.get("surface") != expected_surface:
            raise ValueError("memory condition formation receipt uses the wrong surface")
        if outcome.study_track == "C" and (
            outcome.formation_receipt.get("trace_sha256") != outcome.precursor_trace_sha256
        ):
            raise ValueError("memory condition formation receipt is bound to a different trace")
    if outcome.retrieval_call_count is not None:
        if outcome.retrieval_call_count <= 0 or outcome.retrieval_round_count is None:
            raise ValueError("retrieval receipt has an invalid call or round count")
        if outcome.retrieval_round_count <= 0 or (
            outcome.retrieval_round_count > outcome.retrieval_call_count
        ):
            raise ValueError("retrieval receipt has an invalid call or round count")
    if outcome.condition in NATIVE_MEMORIX_CONDITIONS:
        _require_sha256(outcome.native_mcp_policy_sha256, field="native MCP policy hash")
        if outcome.native_mcp_call_budget != NATIVE_MCP_CALL_BUDGET:
            raise ValueError("native MCP condition has an invalid call budget")
        if outcome.native_mcp_receipt_status == "recorded-v1":
            attempts = outcome.native_mcp_call_attempt_count
            served = outcome.native_mcp_served_call_count
            if attempts is None or served is None or attempts < 0 or served < 0 or served > attempts:
                raise ValueError("native MCP receipt has invalid call accounting")
            if served > outcome.native_mcp_call_budget:
                raise ValueError("native MCP receipt exceeded its call budget")
            if served == 0:
                if outcome.native_mcp_context_tokens is not None or outcome.native_mcp_context_truncated is not None:
                    raise ValueError("unused native MCP receipt contains context evidence")
            elif (
                outcome.native_mcp_context_tokens is None
                or outcome.native_mcp_context_tokens > CANONICAL_RETRIEVAL_TOKEN_BUDGET
                or outcome.native_mcp_context_truncated is None
            ):
                raise ValueError("native MCP receipt has invalid bounded context evidence")
        elif outcome.native_mcp_receipt_status == "not-started-v1":
            if any(
                value is not None
                for value in (
                    outcome.native_mcp_call_attempt_count,
                    outcome.native_mcp_served_call_count,
                    outcome.native_mcp_context_tokens,
                    outcome.native_mcp_context_truncated,
                )
            ):
                raise ValueError("unstarted native MCP gateway must not report usage")
        elif outcome.native_mcp_receipt_status == "missing-after-attempt-v1":
            if outcome.valid_run:
                raise ValueError("missing native MCP receipt cannot be a valid run")
        else:
            raise ValueError("trial outcome has an invalid native MCP receipt status")
    elif any(
        value is not None
        for value in (
            outcome.native_mcp_policy_sha256,
            outcome.native_mcp_call_budget,
            outcome.native_mcp_call_attempt_count,
            outcome.native_mcp_served_call_count,
            outcome.native_mcp_context_tokens,
            outcome.native_mcp_context_truncated,
        )
    ) or outcome.native_mcp_receipt_status != "not-applicable-v1":
        raise ValueError("non-Memorix condition has native MCP evidence")
    if outcome.memory_tool_attempt_count > outcome.tool_call_count:
        raise ValueError("memory tool attempts exceed total tool calls")
    if outcome.memory_tool_call_count > outcome.successful_tool_call_count:
        raise ValueError("successful memory tool calls exceed successful tool calls")
    _require_sha256(outcome.agent_action_ledger_sha256, field="action ledger hash")
    if outcome.agent_action_count < 0:
        raise ValueError("trial outcome has an invalid action count")
    if outcome.annotation_status == "pending-v1":
        if any(
            value is not None
            for value in (
                outcome.first_correct_action_seconds,
                outcome.stale_memory_errors,
                outcome.negative_control_intrusions,
                outcome.annotation_summary_sha256,
            )
        ) or any(
            status != "pending-v1"
            for status in (
                outcome.first_correct_action_status,
                outcome.stale_memory_error_status,
                outcome.negative_control_intrusion_status,
            )
        ):
            raise ValueError("pending annotation outcomes must remain null")
        return
    if outcome.annotation_status not in {"consensus-v1", "adjudicated-v1"}:
        raise ValueError("trial outcome has an invalid annotation status")
    _require_sha256(outcome.annotation_summary_sha256, field="annotation summary hash")
    if outcome.first_correct_action_status == "annotated-v1":
        if outcome.first_correct_action_seconds is None:
            raise ValueError("annotated first correct action requires an elapsed time")
    elif outcome.first_correct_action_status in {"no-correct-action-v1", "unrateable-v1"}:
        if outcome.first_correct_action_seconds is not None:
            raise ValueError("non-observed first correct action must not have an elapsed time")
    else:
        raise ValueError("trial outcome has an invalid first-action annotation status")
    for value, status in (
        (outcome.stale_memory_errors, outcome.stale_memory_error_status),
        (outcome.negative_control_intrusions, outcome.negative_control_intrusion_status),
    ):
        if status == "annotated-v1":
            if value is None or value < 0:
                raise ValueError("annotated episode count must be non-negative")
        elif status == "unrateable-v1":
            if value is not None:
                raise ValueError("unrateable episode count must remain null")
        else:
            raise ValueError("trial outcome has an invalid episode annotation status")


def _model_profile(model_usage: tuple[ModelUsage, ...]) -> str:
    if not model_usage:
        return "unreported"
    if len(model_usage) == 1:
        return "single"
    return "mixed"


def _matches_required_single_model(
    required_model: str | None,
    *,
    reported_models: tuple[str, ...],
    model_usage: tuple[ModelUsage, ...],
) -> bool:
    if required_model is None:
        return True
    return (
        reported_models == (required_model,)
        and _model_profile(model_usage) == "single"
    )


def is_valid_execution(
    failure_reason: str | None,
    *,
    environment_violation: bool,
) -> bool:
    """Keep fixed-budget and timeout outcomes as task failures, not exclusions."""
    return not environment_violation and failure_reason not in INFRASTRUCTURE_FAILURE_REASONS


def is_task_success(
    evaluation_passed: bool,
    *,
    completed: bool,
    timed_out: bool,
    failure_reason: str | None,
) -> bool:
    """A correct patch only counts when the agent finished within its budget."""

    return evaluation_passed and completed and not timed_out and failure_reason is None


def _trial_run_directory(artifact_root: Path, run_id: str) -> Path:
    """Keep artifact paths short on Windows; identity is committed in result.json."""

    return artifact_root / "runs" / run_id


def _resolve_case_asset(manifest: CaseManifest, relative: str) -> Path:
    root = manifest.source_path.parent.resolve()
    candidate = (root / relative).resolve()
    if candidate != root and root not in candidate.parents:
        raise ValueError(f"case asset escapes its directory: {relative}")
    if not candidate.is_file():
        raise ValueError(f"case asset is missing: {candidate}")
    return candidate


def _trace_view_metadata(view: TraceView | None) -> dict[str, object] | None:
    if view is None:
        return None
    return {
        "renderer": view.renderer,
        "trace_sha256": view.trace_sha256,
        "token_budget": view.token_budget,
        "token_count": view.token_count,
        "retained_event_ids": list(view.retained_event_ids),
        "dropped_event_ids": list(view.dropped_event_ids),
        "truncated": view.truncated,
        "view_sha256": view.sha256,
    }


def _require_formation_receipt(result: dict[str, object]) -> dict[str, object]:
    receipt = result.get("formation_receipt")
    if not isinstance(receipt, dict):
        raise RuntimeError("memory formation adapter returned no auditable receipt")
    for field in (
        "surface",
        "write_operation_count",
        "transport_call_count",
        "maintenance_call_count",
        "record_count",
    ):
        if field not in receipt:
            raise RuntimeError(f"memory formation receipt is missing {field}")
    return receipt


def build_condition_prompt(
    manifest: CaseManifest,
    condition: str,
    *,
    retrieved_context: str | None = None,
    trace_view: TraceView | None = None,
) -> str:
    if condition not in SUPPORTED_CONDITIONS:
        raise ValueError(
            f"condition {condition!r} is not executable yet; supported: {sorted(SUPPORTED_CONDITIONS)}"
        )
    parts: list[str] = []
    if condition == "last-n":
        if manifest.study_track == "C":
            if trace_view is None:
                raise ValueError("Track C last-n requires a prepared bounded trace view")
            parts.extend([
                "Here is the bounded normalized record from the previous project session:",
                "<prior_session>",
                trace_view.context,
                "</prior_session>",
                "",
            ])
        else:
            if not manifest.precursor.transcript:
                raise ValueError("last-n requires precursor.transcript")
            transcript = _resolve_case_asset(
                manifest,
                manifest.precursor.transcript,
            ).read_text(encoding="utf-8")
            parts.extend([
                "Here is the bounded record from the previous project session:",
                "<prior_session>",
                transcript.strip(),
                "</prior_session>",
                "",
            ])
    if condition in CANONICAL_RETRIEVAL_CONDITIONS:
        if not retrieved_context or not retrieved_context.strip():
            raise ValueError(f"{condition} requires retrieved context")
        parts.extend([
            "<retrieved_memory>",
            retrieved_context.strip(),
            "</retrieved_memory>",
            "",
        ])
    verification_commands = tuple(
        f"`{command}`" for command in manifest.transfer.success_commands
    )
    verification_instruction = (
        f"Trusted verification command for this case: {verification_commands[0]}"
        if len(verification_commands) == 1
        else "Trusted verification commands for this case: " + ", ".join(verification_commands)
    )
    parts.extend([
        manifest.transfer.task,
        "",
        "Use any configured project-context or memory capability when it would help, but verify it against the current source.",
        "This is an isolated workspace. You are already in the repository; use `git ls-files` directly to enumerate project files and do not inspect parent or sibling directories.",
        "Use normal source-inspection and verification commands only inside this workspace. Do not read, write, or execute outside it, and do not use network or installation commands.",
        "Repository history is intentionally a single transfer snapshot; do not look for precursor commits. Use current files and any configured memory only.",
        verification_instruction,
        "Work directly in the repository. Inspect the current source before editing, make the smallest correct change, and run the relevant tests. Do not ask for confirmation.",
    ])
    return "\n".join(parts)


def build_claude_allowed_tools(manifest: CaseManifest, condition: str) -> tuple[str, ...]:
    if condition not in SUPPORTED_CONDITIONS:
        raise ValueError(f"unsupported condition for Claude allowlist: {condition}")
    verification_tools = tuple(
        f"Bash({command})" for command in manifest.transfer.success_commands
    )
    memory_tools = MEMORIX_ALLOWED_TOOLS if condition in NATIVE_MEMORIX_CONDITIONS else ()
    return tuple(dict.fromkeys((*CLAUDE_BASE_ALLOWED_TOOLS, *verification_tools, *memory_tools)))


def _git_version() -> str:
    completed = subprocess.run(
        ["git", "--version"],
        check=True,
        capture_output=True,
        text=True,
        encoding="utf-8",
    )
    return completed.stdout.strip()


def _git_root(path: Path) -> Path:
    completed = subprocess.run(
        ["git", "-C", str(path), "rev-parse", "--show-toplevel"],
        check=True,
        capture_output=True,
        text=True,
        encoding="utf-8",
    )
    return Path(completed.stdout.strip()).resolve()


def _paths_overlap(left: Path, right: Path) -> bool:
    return left == right or left in right.parents or right in left.parents


def ensure_development_case(manifest: CaseManifest) -> None:
    if manifest.split != "development":
        raise ValueError(
            "only development cases are executable until private-oracle overlays "
            "and agent read-isolation preflight are implemented"
        )


def ensure_trial_eligibility(
    manifest: CaseManifest,
    *,
    agent: AgentName,
    oracle_assets: OracleAssetSet,
) -> str:
    if manifest.split == "development":
        if oracle_assets.visibility != "public":
            raise ValueError("development cases must use public oracle assets")
        return "development"
    if oracle_assets.visibility != "private":
        raise ValueError("validation and test cases require private oracle assets")
    if manifest.dependency_classification_status != "preregistered":
        raise ValueError("confirmatory cases require preregistered dependency classification")
    if agent == "codex":
        raise ValueError(
            "Codex private-oracle trials are disabled pending adversarial read-isolation preflight"
        )
    raise ValueError(
        "private-oracle trials are disabled pending an external sandbox isolation certificate"
    )


def run_trial(
    *,
    case_path: str | Path,
    artifact_root: str | Path,
    study_id: str,
    condition: str,
    agent: AgentName,
    model: str | None,
    repetition: int,
    seed: int,
    timeout_seconds: int = 900,
    max_budget_usd: float | None = None,
    memorix_cli: str | Path | None = None,
    mem0_python: str | Path | None = None,
    agentmemory_runtime: str | Path | None = None,
    workspace_root: str | Path | None = None,
    claude_provider_settings: str | Path | None = None,
    repository_cache: str | Path | None = None,
    private_oracle_root: str | Path | None = None,
    required_single_model: str | None = None,
) -> TrialOutcome:
    if required_single_model is not None:
        required_single_model = required_single_model.strip()
        if not required_single_model:
            raise ValueError("required_single_model must be non-empty when provided")
    manifest = load_case_manifest(case_path)
    if manifest.formation_track == "native-session":
        raise ValueError(
            "native-session formation is not executable until provider-native "
            "formation adapters and their audit contract are implemented"
        )
    resolved_trace: ResolvedPrecursorTrace | None = (
        resolve_precursor_trace(
            manifest,
            seed=seed,
            repetition=repetition,
        )
        if manifest.formation_track == "trace-replay"
        else None
    )
    precursor_trace = resolved_trace.trace if resolved_trace else None
    trace_truncation = (
        manifest.precursor_trace.truncation
        if manifest.precursor_trace is not None
        else manifest.precursor_trace_bundle.truncation
        if manifest.precursor_trace_bundle is not None
        else None
    )
    trace_view = (
        render_trace_view(
            precursor_trace,
            token_budget=CANONICAL_RETRIEVAL_TOKEN_BUDGET,
            truncation=trace_truncation or "event-suffix-v1",
        )
        if condition == "last-n" and precursor_trace is not None
        else None
    )
    oracle_assets = resolve_oracle_assets(manifest, private_oracle_root)
    evidence_tier = ensure_trial_eligibility(
        manifest,
        agent=agent,
        oracle_assets=oracle_assets,
    )
    run_id = str(uuid.uuid4())
    model_label = model or "client-default"
    artifact_root_path = Path(artifact_root).resolve()
    run_dir = _trial_run_directory(artifact_root_path, run_id)
    workspace_isolation = "artifact-local"
    workspace_run_root: Path | None = None
    workspace_root_path: Path | None = None
    provider_env: dict[str, str] | None = None
    if agent == "claude":
        if workspace_root is None:
            raise ValueError("controlled Claude runs require --workspace-root")
        if claude_provider_settings is None:
            raise ValueError("controlled Claude runs require --claude-provider-settings")
        workspace_root_path = Path(workspace_root).resolve()
        if _paths_overlap(workspace_root_path, artifact_root_path):
            raise ValueError("Claude workspace root must be separate from the artifact root")
        workspace_run_root = workspace_root_path / run_id
        workspace_dir = workspace_run_root / "workspace"
        workspace_isolation = "separate-root+bare+permissions-v1"
        provider_env = load_claude_provider_env(claude_provider_settings)
    else:
        workspace_dir = run_dir / "workspace"
    agent_dir = run_dir / "agent"
    run_dir.mkdir(parents=True, exist_ok=False)
    case_definition_sha256 = archive_public_case_definition(manifest, run_dir)
    started_at = datetime.now(timezone.utc).isoformat()
    is_memorix = condition in MEMORIX_CONDITIONS
    is_native_memorix = condition in NATIVE_MEMORIX_CONDITIONS
    is_memorix_canonical = condition == MEMORIX_CANONICAL_PROVIDER_ID
    is_canonical_retrieval = condition in CANONICAL_RETRIEVAL_CONDITIONS
    memorix_mode = MEMORIX_CONDITION_MODES.get(condition)
    if is_native_memorix and agent != "claude":
        raise ValueError("the budgeted native Memorix MCP track currently supports Claude only")
    materialized = materialize_case(
        manifest,
        workspace_dir,
        stage="precursor" if is_memorix or is_canonical_retrieval else "transfer",
        repository_cache=repository_cache,
    )

    transfer_commit = materialized.transfer_commit
    transition_patch_sha256 = materialized.transition_patch_sha256
    mcp_config: Path | None = None
    claude_settings: Path | None = None
    memorix_cli_sha256: str | None = None
    retrieval: BaselineRetrieval | None = None
    memory_preparation_seconds: float | None = None
    memory_retrieval_seconds: float | None = None
    formation_receipt: dict[str, object] | None = None
    native_mcp_policy: NativeMcpBudgetPolicy | None = None
    native_mcp_receipt_path: Path | None = None
    native_mcp_receipt: NativeMcpGatewayReceipt | None = None
    native_mcp_receipt_status = "not-applicable-v1"
    condition_metadata: dict[str, object] = {
        "condition": condition,
        "study_track": manifest.study_track,
        "formation_track": manifest.formation_track,
        "precursor_trace": {
            "canonical_sha256": precursor_trace.canonical_sha256,
            "source_sha256": precursor_trace.source_sha256,
            "capture_id": resolved_trace.capture_id if resolved_trace else None,
            "selection": resolved_trace.selection if resolved_trace else None,
            "bundle_sha256": resolved_trace.bundle_sha256 if resolved_trace else None,
        }
        if precursor_trace
        else None,
        "raw_replay_view": _trace_view_metadata(trace_view),
        "memory_provider": None,
    }
    if is_memorix:
        if memorix_cli is None:
            raise ValueError("Memorix conditions require --memorix-cli")
        memorix_cli_path = Path(memorix_cli).resolve()
        if not memorix_cli_path.is_file():
            raise ValueError(f"Memorix CLI does not exist: {memorix_cli_path}")
        memory_dir = run_dir / "memory"
        data_dir = memory_dir / "data"
        home_dir = memory_dir / "home"
        adapter_dir = memory_dir / "adapter"
        preparation_started = time.monotonic()
        if precursor_trace is None:
            seed_result = seed_memorix_canonical_evidence(
                manifest=manifest,
                workspace=workspace_dir,
                cli_path=memorix_cli_path,
                data_dir=data_dir,
                home_dir=home_dir,
                artifact_dir=adapter_dir,
                mode=memorix_mode or "full",
            )
        else:
            seed_result = ingest_memorix_trace(
                trace=precursor_trace,
                workspace=workspace_dir,
                cli_path=memorix_cli_path,
                data_dir=data_dir,
                home_dir=home_dir,
                artifact_dir=adapter_dir,
                mode=memorix_mode or "full",
            )
        formation_receipt = _require_formation_receipt(seed_result)
        maintenance_receipt = seed_result.get("maintenance")
        if not isinstance(maintenance_receipt, dict):
            raise RuntimeError("Memorix formation did not return a maintenance receipt")
        memory_preparation_seconds = time.monotonic() - preparation_started
        transfer_commit, transition_patch_sha256 = advance_case_to_transfer(
            manifest,
            workspace_dir,
        )
        agent_start_commit = reset_history_to_snapshot(workspace_dir)
        memorix_cli_sha256 = _sha256(memorix_cli_path)
        condition_metadata = {
            "condition": condition,
            "study_track": manifest.study_track,
            "formation_track": manifest.formation_track,
            "memory_provider": "memorix",
            "formation_source": "precursor-trace" if precursor_trace else "memory-seed",
            "precursor_trace_sha256": precursor_trace.sha256 if precursor_trace else None,
            "memorix_cli": str(memorix_cli_path),
            "memorix_cli_sha256": memorix_cli_sha256,
            "formation_tool_profile": memorix_mode,
            "llm": "off",
            "embedding": "off",
            "seed_maintenance": maintenance_receipt,
            "formation_receipt": formation_receipt,
            "preparation_seconds": memory_preparation_seconds,
        }
        if is_memorix_canonical:
            retrieval_started = time.monotonic()
            canonical = retrieve_memorix_canonical(
                workspace=workspace_dir,
                cli_path=memorix_cli_path,
                data_dir=data_dir,
                home_dir=home_dir,
                artifact_dir=adapter_dir,
                query=manifest.transfer.task,
                top_k=CANONICAL_RETRIEVAL_TOP_K,
                token_budget=CANONICAL_RETRIEVAL_TOKEN_BUDGET,
            )
            retrieval = canonical.retrieval
            memory_retrieval_seconds = time.monotonic() - retrieval_started
            condition_metadata.update({
                "interaction_track": "canonical-retrieval-v1",
                "retrieval": {
                    "query": retrieval.query,
                    "top_k": CANONICAL_RETRIEVAL_TOP_K,
                    "token_budget": retrieval.token_budget,
                    "token_count": retrieval.token_count,
                    "truncated": retrieval.truncated,
                    "logical_call_count": retrieval.retrieval_call_count,
                    "logical_round_count": retrieval.retrieval_round_count,
                    "transport_call_count": canonical.transport_call_count,
                    "candidate_refs": list(canonical.candidate_refs),
                    "detail_redaction_count": canonical.detail_redaction_count,
                },
                "retrieval_seconds": memory_retrieval_seconds,
            })
        else:
            native_mcp_policy = NativeMcpBudgetPolicy(
                task=manifest.transfer.task,
                call_budget=NATIVE_MCP_CALL_BUDGET,
                token_budget=CANONICAL_RETRIEVAL_TOKEN_BUDGET,
                refresh="never",
            )
            native_mcp_receipt_path = memory_dir / "native-mcp-gateway-receipt.json"
            mcp_config = write_native_mcp_config(
                path=memory_dir / "claude-mcp.json",
                python_executable=Path(sys.executable),
                memorix_cli=memorix_cli_path,
                workspace=workspace_dir,
                data_dir=data_dir,
                home_dir=home_dir,
                log_dir=adapter_dir / "native-mcp-control-plane",
                receipt_path=native_mcp_receipt_path,
                task=native_mcp_policy.task,
                call_budget=native_mcp_policy.call_budget,
                token_budget=native_mcp_policy.token_budget,
                refresh=native_mcp_policy.refresh,
            )
            condition_metadata.update({
                "interaction_track": "native-mcp-budgeted-v1",
                "gateway_underlying_tool_profile": "micro",
                "native_mcp_policy": native_mcp_policy.public_payload(),
            })
    elif condition == MEM0_PROVIDER_ID:
        if mem0_python is None:
            raise ValueError(f"{MEM0_PROVIDER_ID} requires --mem0-python")
        mem0_python_path = Path(mem0_python).resolve()
        memory_dir = run_dir / "memory"
        runtime_data_dir = (
            artifact_root_path.parent / "runtime-data" / "mem0" / run_id
        )
        adapter = Mem0LocalAdapter(
            python_path=mem0_python_path,
            data_dir=runtime_data_dir,
            artifact_dir=memory_dir / "adapter",
            model_cache_root=artifact_root_path.parent / "caches",
            collection_name=f"memorixbench_{run_id.replace('-', '_')}",
        )
        project_id = f"memorixbench-{run_id}"
        preparation_started = time.monotonic()
        preflight = adapter.preflight()
        seed_result = (
            adapter.ingest_trace(precursor_trace, project_id=project_id)
            if precursor_trace is not None
            else adapter.seed_canonical_evidence(manifest, project_id=project_id)
        )
        formation_receipt = _require_formation_receipt(seed_result)
        memory_preparation_seconds = time.monotonic() - preparation_started
        transfer_commit, transition_patch_sha256 = advance_case_to_transfer(
            manifest,
            workspace_dir,
        )
        agent_start_commit = reset_history_to_snapshot(workspace_dir)
        retrieval_started = time.monotonic()
        retrieval = adapter.retrieve(
            project_id=project_id,
            query=manifest.transfer.task,
            top_k=CANONICAL_RETRIEVAL_TOP_K,
            token_budget=CANONICAL_RETRIEVAL_TOKEN_BUDGET,
        )
        memory_retrieval_seconds = time.monotonic() - retrieval_started
        condition_metadata = {
            "condition": condition,
            "study_track": manifest.study_track,
            "formation_track": manifest.formation_track,
            "memory_provider": "mem0",
            "formation_source": "precursor-trace" if precursor_trace else "memory-seed",
            "precursor_trace_sha256": precursor_trace.sha256 if precursor_trace else None,
            "provider_id": MEM0_PROVIDER_ID,
            "python": str(mem0_python_path),
            "embedding_model": adapter.embedding_model,
            "embedding_dimensions": adapter.embedding_dimensions,
            "model_cache_root": str(adapter.model_cache_root),
            "network": "offline",
            "collection_name": adapter.collection_name,
            "project_id": project_id,
            "data_dir": str(adapter.data_dir),
            "preflight": preflight,
            "seed": seed_result,
            "formation_receipt": formation_receipt,
            "retrieval": {
                "query": retrieval.query,
                "top_k": CANONICAL_RETRIEVAL_TOP_K,
                "token_budget": retrieval.token_budget,
                "token_count": retrieval.token_count,
                "truncated": retrieval.truncated,
                "call_count": retrieval.retrieval_call_count,
                "round_count": retrieval.retrieval_round_count,
                "records": [
                    {"memory_id": record.memory_id, "score": record.score}
                    for record in retrieval.records
                ],
            },
            "preparation_seconds": memory_preparation_seconds,
            "retrieval_seconds": memory_retrieval_seconds,
        }
    elif condition == AGENTMEMORY_PROVIDER_ID:
        if agentmemory_runtime is None:
            raise ValueError(f"{AGENTMEMORY_PROVIDER_ID} requires --agentmemory-runtime")
        runtime_root = Path(agentmemory_runtime).resolve()
        memory_dir = run_dir / "memory"
        runtime_data_dir = (
            artifact_root_path.parent / "runtime-data" / "agentmemory" / run_id
        )
        project_id = f"memorixbench-{run_id}"
        compose_project = "memorixbench_am_" + run_id.replace("-", "")[:16]
        adapter = AgentMemoryFullAdapter(
            runtime_root=runtime_root,
            data_dir=runtime_data_dir,
            artifact_dir=memory_dir / "adapter",
            project_name=compose_project,
            lock_path=(
                artifact_root_path.parent
                / "runtime-locks"
                / "agentmemory-3111.lock"
            ),
        )
        preparation_started = time.monotonic()
        with adapter:
            preflight = adapter.preflight(project_id=project_id)
            seed_result = (
                adapter.ingest_trace(precursor_trace, project_id=project_id)
                if precursor_trace is not None
                else adapter.seed_canonical_evidence(manifest, project_id=project_id)
            )
            formation_receipt = _require_formation_receipt(seed_result)
            memory_preparation_seconds = time.monotonic() - preparation_started
            transfer_commit, transition_patch_sha256 = advance_case_to_transfer(
                manifest,
                workspace_dir,
            )
            agent_start_commit = reset_history_to_snapshot(workspace_dir)
            retrieval_started = time.monotonic()
            retrieval = adapter.retrieve(
                project_id=project_id,
                query=manifest.transfer.task,
                top_k=CANONICAL_RETRIEVAL_TOP_K,
                token_budget=CANONICAL_RETRIEVAL_TOKEN_BUDGET,
            )
            memory_retrieval_seconds = time.monotonic() - retrieval_started
        condition_metadata = {
            "condition": condition,
            "study_track": manifest.study_track,
            "formation_track": manifest.formation_track,
            "memory_provider": "agentmemory",
            "formation_source": "precursor-trace" if precursor_trace else "memory-seed",
            "precursor_trace_sha256": precursor_trace.sha256 if precursor_trace else None,
            "provider_id": AGENTMEMORY_PROVIDER_ID,
            "runtime_root": str(runtime_root),
            "project_name": compose_project,
            "port": adapter.port,
            "data_dir": str(adapter.data_dir),
            "full_service": True,
            "preflight": preflight,
            "seed": seed_result,
            "formation_receipt": formation_receipt,
            "retrieval": {
                "query": retrieval.query,
                "top_k": CANONICAL_RETRIEVAL_TOP_K,
                "token_budget": retrieval.token_budget,
                "token_count": retrieval.token_count,
                "truncated": retrieval.truncated,
                "call_count": retrieval.retrieval_call_count,
                "round_count": retrieval.retrieval_round_count,
                "records": [
                    {"memory_id": record.memory_id, "score": record.score}
                    for record in retrieval.records
                ],
            },
            "preparation_seconds": memory_preparation_seconds,
            "retrieval_seconds": memory_retrieval_seconds,
        }
    else:
        agent_start_commit = reset_history_to_snapshot(workspace_dir)

    condition_metadata["study_track"] = manifest.study_track
    condition_metadata["formation_track"] = manifest.formation_track
    condition_metadata["precursor_trace"] = {
        "canonical_sha256": precursor_trace.canonical_sha256,
        "source_sha256": precursor_trace.source_sha256,
        "capture_id": resolved_trace.capture_id if resolved_trace else None,
        "selection": resolved_trace.selection if resolved_trace else None,
        "bundle_sha256": resolved_trace.bundle_sha256 if resolved_trace else None,
    } if precursor_trace else None
    condition_metadata["raw_replay_view"] = _trace_view_metadata(trace_view)
    if formation_receipt is not None:
        condition_metadata["formation_receipt"] = formation_receipt

    prompt = build_condition_prompt(
        manifest,
        condition,
        retrieved_context=retrieval.context if retrieval else None,
        trace_view=trace_view,
    )
    allowed_tools = build_claude_allowed_tools(manifest, condition)
    if agent == "claude":
        assert workspace_root_path is not None
        denied_roots = {
            artifact_root_path,
            Path.home(),
            _git_root(manifest.source_path.parent),
        }
        claude_settings = write_claude_settings(
            run_dir / "control" / "claude-settings.json",
            denied_roots=denied_roots,
            allowed_tools=allowed_tools,
        )

    config_overrides: list[str] = []
    if agent == "codex":
        config_overrides.append("project_doc_max_bytes=0")
    execution: AgentExecution = run_agent(
        agent=agent,
        workspace=workspace_dir,
        prompt=prompt,
        artifact_dir=agent_dir,
        model=model,
        timeout_seconds=timeout_seconds,
        config_overrides=config_overrides,
        mcp_config=mcp_config,
        max_budget_usd=max_budget_usd,
        allowed_tools=allowed_tools,
        settings_path=claude_settings,
        environment=provider_env,
    )
    if is_native_memorix:
        assert native_mcp_policy is not None
        assert native_mcp_receipt_path is not None
        if native_mcp_receipt_path.is_file():
            native_mcp_receipt = load_native_mcp_receipt(native_mcp_receipt_path)
            if native_mcp_receipt.policy_sha256 != native_mcp_policy.sha256:
                raise RuntimeError("native MCP gateway receipt is bound to a different policy")
            if native_mcp_receipt.served_call_count > native_mcp_policy.call_budget:
                raise RuntimeError("native MCP gateway receipt exceeded its call budget")
            native_mcp_receipt_status = "recorded-v1"
        elif any("memorix" in name.lower() for name in execution.tool_call_names):
            native_mcp_receipt_status = "missing-after-attempt-v1"
        else:
            native_mcp_receipt_status = "not-started-v1"
        condition_metadata["native_mcp_receipt_status"] = native_mcp_receipt_status
        condition_metadata["native_mcp_receipt"] = (
            native_mcp_receipt.public_payload() if native_mcp_receipt else None
        )
    evaluation = run_transfer_evaluation(
        manifest,
        workspace_dir,
        timeout_seconds=min(timeout_seconds, 300),
        oracle_assets=oracle_assets,
    )
    grade_results = list(evaluation.commands)
    source_check_violations = tuple(
        f"{check.path}: {violation}"
        for check in evaluation.source_checks
        for violation in check.violations
    )
    patch_sha = _sha256(execution.patch_path)
    transcript_sha: str | None = None
    if manifest.precursor.transcript:
        transcript_sha = _sha256(
            _resolve_case_asset(manifest, manifest.precursor.transcript)
        )
    precursor_trace_sha = precursor_trace.canonical_sha256 if precursor_trace else None
    precursor_trace_source_sha = precursor_trace.source_sha256 if precursor_trace else None

    memory_tool_attempt_count = sum(
        "memorix" in name.lower() for name in execution.tool_call_names
    )
    memory_tool_call_count = sum(
        "memorix" in name.lower() for name in execution.successful_tool_call_names
    )
    model_route_matched = _matches_required_single_model(
        required_single_model,
        reported_models=execution.reported_models,
        model_usage=execution.model_usage,
    )
    condition_metadata.update({
        "required_single_model": required_single_model,
        "model_route_matched": model_route_matched,
    })
    command_contamination_violations = audit_bash_commands(
        execution.bash_commands,
        workspace=workspace_dir,
    )
    environment_violation = bool(
        execution.permission_denials
        or command_contamination_violations
        or native_mcp_receipt_status == "missing-after-attempt-v1"
        or not model_route_matched
    )
    valid_run = is_valid_execution(
        execution.failure_reason,
        environment_violation=environment_violation,
    )
    failure_reason = (
        "permission-denied"
        if execution.permission_denials
        else "command-contamination"
        if command_contamination_violations
        else "mcp-budget-receipt-missing"
        if native_mcp_receipt_status == "missing-after-attempt-v1"
        else "model-route-mismatch"
        if not model_route_matched
        else execution.failure_reason
    )
    native_mcp_attempt_count = (
        native_mcp_receipt.call_attempt_count if native_mcp_receipt else None
    )
    native_mcp_served_call_count = (
        native_mcp_receipt.served_call_count if native_mcp_receipt else None
    )
    native_mcp_context_tokens = (
        native_mcp_receipt.emitted_context_tokens if native_mcp_receipt else None
    )
    native_mcp_context_truncated = (
        native_mcp_receipt.context_truncated if native_mcp_receipt else None
    )
    outcome = TrialOutcome(
        schema_version="1.5",
        run_id=run_id,
        study_id=study_id,
        case_id=manifest.case_id,
        case_split=manifest.split,
        predecessor_dependency=manifest.dependency_strength,
        dependency_classification_status=manifest.dependency_classification_status,
        evidence_tier=evidence_tier,
        condition=condition,
        agent=agent,
        model=model_label,
        reported_models=execution.reported_models,
        model_usage=execution.model_usage,
        model_profile=_model_profile(execution.model_usage),
        repetition=repetition,
        seed=seed,
        valid_run=valid_run,
        failure_reason=failure_reason,
        task_success=is_task_success(
            evaluation.passed,
            completed=execution.completed,
            timed_out=execution.timed_out,
            failure_reason=failure_reason,
        ),
        agent_returncode=execution.returncode,
        timed_out=execution.timed_out,
        first_correct_action_seconds=None,
        first_correct_action_status="pending-v1",
        annotation_status="pending-v1",
        annotation_summary_sha256=None,
        input_tokens=execution.input_tokens,
        cached_input_tokens=execution.cached_input_tokens,
        output_tokens=execution.output_tokens,
        reasoning_output_tokens=execution.reasoning_output_tokens,
        wall_seconds=execution.wall_seconds,
        cost_usd=execution.cost_usd,
        stale_memory_errors=None,
        stale_memory_error_status="pending-v1",
        negative_control_intrusions=None,
        negative_control_intrusion_status="pending-v1",
        command_count=execution.command_count,
        tool_call_count=execution.tool_call_count,
        tool_names=execution.tool_names,
        tool_call_names=execution.tool_call_names,
        successful_tool_call_count=execution.successful_tool_call_count,
        successful_tool_names=execution.successful_tool_names,
        successful_tool_call_names=execution.successful_tool_call_names,
        agent_action_count=execution.action_count,
        agent_action_ledger_sha256=execution.action_ledger_sha256,
        agent_action_timing_source=execution.action_timing_source,
        permission_denials=execution.permission_denials,
        unavailable_tool_attempts=execution.unavailable_tool_attempts,
        bash_commands=execution.bash_commands,
        command_contamination_violations=command_contamination_violations,
        memory_tool_attempt_count=memory_tool_attempt_count,
        memory_tool_call_count=memory_tool_call_count,
        memory_provider=str(condition_metadata["memory_provider"])
        if condition_metadata["memory_provider"] is not None
        else None,
        retrieved_context_tokens=(
            retrieval.token_count
            if retrieval
            else native_mcp_context_tokens
        ),
        retrieved_context_record_count=(
            len(retrieval.records)
            if retrieval
            else 1
            if native_mcp_served_call_count
            else None
        ),
        retrieved_context_truncated=(
            retrieval.truncated
            if retrieval
            else native_mcp_context_truncated
        ),
        retrieval_call_count=(
            retrieval.retrieval_call_count
            if retrieval
            else native_mcp_served_call_count
            if native_mcp_served_call_count
            else None
        ),
        retrieval_round_count=(
            retrieval.retrieval_round_count
            if retrieval
            else native_mcp_served_call_count
            if native_mcp_served_call_count
            else None
        ),
        native_mcp_policy_sha256=(
            native_mcp_policy.sha256 if native_mcp_policy else None
        ),
        native_mcp_call_budget=(
            native_mcp_policy.call_budget if native_mcp_policy else None
        ),
        native_mcp_receipt_status=native_mcp_receipt_status,
        native_mcp_call_attempt_count=native_mcp_attempt_count,
        native_mcp_served_call_count=native_mcp_served_call_count,
        native_mcp_context_tokens=native_mcp_context_tokens,
        native_mcp_context_truncated=native_mcp_context_truncated,
        raw_replay_context_tokens=trace_view.token_count if trace_view else None,
        raw_replay_context_truncated=trace_view.truncated if trace_view else None,
        formation_track=manifest.formation_track,
        study_track=manifest.study_track,
        precursor_trace_sha256=precursor_trace_sha,
        precursor_trace_source_sha256=precursor_trace_source_sha,
        precursor_trace_view_sha256=trace_view.sha256 if trace_view else None,
        precursor_trace_capture_id=resolved_trace.capture_id if resolved_trace else None,
        precursor_trace_selection=resolved_trace.selection if resolved_trace else None,
        precursor_trace_bundle_sha256=resolved_trace.bundle_sha256 if resolved_trace else None,
        formation_receipt=formation_receipt,
        memory_preparation_seconds=memory_preparation_seconds,
        memory_retrieval_seconds=memory_retrieval_seconds,
        memorix_cli_sha256=memorix_cli_sha256,
        case_manifest_sha256=_sha256(manifest.source_path),
        case_definition_sha256=case_definition_sha256,
        precursor_transcript_sha256=transcript_sha,
        base_commit=materialized.base_commit,
        precursor_commit=materialized.precursor_commit,
        transfer_commit=transfer_commit,
        precursor_patch_sha256=materialized.precursor_patch_sha256,
        transition_patch_sha256=transition_patch_sha256,
        hidden_test_patch_sha256=evaluation.hidden_patch_sha256,
        source_check_violations=source_check_violations,
        agent_start_commit=agent_start_commit,
        patch_sha256=patch_sha,
        platform=platform.platform(),
        python_version=platform.python_version(),
        started_at=started_at,
        artifact_receipt_id=_receipt_id(
            run_id,
            case_definition_sha256,
            patch_sha,
        ),
        workspace_isolation=workspace_isolation,
        repository_transport=materialized.repository_transport,
        repository_origin_sha256=(
            _receipt_id(materialized.repository_origin)
            if materialized.repository_origin
            else None
        ),
        oracle_visibility=oracle_assets.visibility,
        oracle_definition_sha256=oracle_assets.definition_sha256,
        verifier_runtime_sha256=oracle_assets.verifier_runtime_sha256,
    )
    validate_trial_outcome(outcome)
    (run_dir / "prompt.txt").write_text(prompt, encoding="utf-8")
    (run_dir / "grade.json").write_text(
        json.dumps(
            {
                "passed": outcome.task_success,
                "commands": serialize_command_results(
                    grade_results,
                    private_oracle=oracle_assets.visibility == "private",
                ),
                "source_checks": serialize_source_checks(
                    evaluation.source_checks,
                    private_oracle=oracle_assets.visibility == "private",
                ),
                "source_check_phase": evaluation.source_check_phase,
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    (run_dir / "environment.json").write_text(
        json.dumps(
            {
                "platform": outcome.platform,
                "python": outcome.python_version,
                "git": _git_version(),
                "workspace_isolation": workspace_isolation,
                "claude_bare": agent == "claude",
                "claude_provider_env_keys": sorted(provider_env) if provider_env else [],
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    (run_dir / "condition.json").write_text(
        json.dumps(condition_metadata, indent=2),
        encoding="utf-8",
    )
    (run_dir / "command-audit.json").write_text(
        json.dumps(
            {
                "commands": list(execution.bash_commands),
                "violations": list(command_contamination_violations),
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    (run_dir / "result.json").write_text(
        json.dumps(asdict(outcome), indent=2),
        encoding="utf-8",
    )
    if workspace_run_root is not None and workspace_root_path is not None:
        remove_generated_workspace(workspace_run_root, workspace_root=workspace_root_path)
    return outcome
