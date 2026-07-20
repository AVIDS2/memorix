from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import platform
import subprocess
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
from .agentmemory_adapter import AGENTMEMORY_PROVIDER_ID, AgentMemoryFullAdapter
from .mem0_adapter import MEM0_PROVIDER_ID, Mem0LocalAdapter
from .memorix_adapter import (
    refresh_memorix_project,
    seed_memorix_project,
    write_claude_mcp_config,
)
from .schema import CaseManifest, load_case_manifest
from .workspace import (
    CommandResult,
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
}
MEMORIX_CONDITIONS = set(MEMORIX_CONDITION_MODES)
MEM0_CONDITIONS = {MEM0_PROVIDER_ID}
AGENTMEMORY_CONDITIONS = {AGENTMEMORY_PROVIDER_ID}
CANONICAL_RETRIEVAL_CONDITIONS = MEM0_CONDITIONS | AGENTMEMORY_CONDITIONS
SUPPORTED_CONDITIONS = {
    "no-memory",
    "last-n",
    *MEMORIX_CONDITIONS,
    *CANONICAL_RETRIEVAL_CONDITIONS,
}
CANONICAL_RETRIEVAL_TOP_K = 8
CANONICAL_RETRIEVAL_TOKEN_BUDGET = 180
MEMORIX_ALLOWED_TOOLS = (
    "mcp__memorix__memorix_project_context",
    "mcp__memorix__memorix_context_pack",
    "mcp__memorix__memorix_graph_context",
    "mcp__memorix__memorix_search",
    "mcp__memorix__memorix_detail",
    "mcp__memorix__memorix_store",
    "mcp__memorix__memorix_resolve",
)
INFRASTRUCTURE_FAILURE_REASONS = {
    "authentication",
    "quota",
    "mcp-startup",
    "agent-runtime",
    "missing-completion-event",
}
CLAUDE_BASE_ALLOWED_TOOLS = ("Read", "Edit", "Bash")


@dataclass(frozen=True)
class TrialOutcome:
    schema_version: str
    run_id: str
    study_id: str
    case_id: str
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
    input_tokens: int | None
    cached_input_tokens: int | None
    output_tokens: int | None
    reasoning_output_tokens: int | None
    wall_seconds: float
    cost_usd: float | None
    stale_memory_errors: int
    negative_control_intrusions: int
    command_count: int
    tool_call_count: int
    tool_names: tuple[str, ...]
    successful_tool_call_count: int
    successful_tool_names: tuple[str, ...]
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
    memory_preparation_seconds: float | None
    memory_retrieval_seconds: float | None
    memorix_cli_sha256: str | None
    case_manifest_sha256: str
    precursor_transcript_sha256: str | None
    base_commit: str
    precursor_commit: str | None
    transfer_commit: str | None
    precursor_patch_sha256: str | None
    transition_patch_sha256: str | None
    hidden_test_patch_sha256: str | None
    agent_start_commit: str
    patch_sha256: str
    platform: str
    python_version: str
    started_at: str
    artifact_dir: str
    workspace_isolation: str


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _model_profile(model_usage: tuple[ModelUsage, ...]) -> str:
    if not model_usage:
        return "unreported"
    if len(model_usage) == 1:
        return "single"
    return "mixed"


def is_valid_execution(
    failure_reason: str | None,
    *,
    environment_violation: bool,
) -> bool:
    """Keep fixed-budget and timeout outcomes as task failures, not exclusions."""
    return not environment_violation and failure_reason not in INFRASTRUCTURE_FAILURE_REASONS


def _resolve_case_asset(manifest: CaseManifest, relative: str) -> Path:
    root = manifest.source_path.parent.resolve()
    candidate = (root / relative).resolve()
    if candidate != root and root not in candidate.parents:
        raise ValueError(f"case asset escapes its directory: {relative}")
    if not candidate.is_file():
        raise ValueError(f"case asset is missing: {candidate}")
    return candidate


def build_condition_prompt(
    manifest: CaseManifest,
    condition: str,
    *,
    retrieved_context: str | None = None,
) -> str:
    if condition not in SUPPORTED_CONDITIONS:
        raise ValueError(
            f"condition {condition!r} is not executable yet; supported: {sorted(SUPPORTED_CONDITIONS)}"
        )
    parts: list[str] = []
    if condition == "last-n":
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
    memory_tools = MEMORIX_ALLOWED_TOOLS if condition in MEMORIX_CONDITIONS else ()
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


def _serialize_commands(results: list[CommandResult]) -> list[dict[str, object]]:
    return [asdict(result) for result in results]


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
) -> TrialOutcome:
    manifest = load_case_manifest(case_path)
    run_id = str(uuid.uuid4())
    model_label = model or "client-default"
    artifact_root_path = Path(artifact_root).resolve()
    run_dir = (
        artifact_root_path
        / study_id
        / manifest.case_id
        / agent
        / model_label.replace("/", "_")
        / condition
        / f"r{repetition}-s{seed}-{run_id}"
    )
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
    started_at = datetime.now(timezone.utc).isoformat()
    is_memorix = condition in MEMORIX_CONDITIONS
    is_canonical_retrieval = condition in CANONICAL_RETRIEVAL_CONDITIONS
    memorix_mode = MEMORIX_CONDITION_MODES.get(condition)
    if is_memorix and agent != "claude":
        raise ValueError("the first controlled Memorix adapter currently supports Claude only")
    materialized = materialize_case(
        manifest,
        workspace_dir,
        stage="precursor" if is_memorix or is_canonical_retrieval else "transfer",
    )

    transfer_commit = materialized.transfer_commit
    transition_patch_sha256 = materialized.transition_patch_sha256
    mcp_config: Path | None = None
    claude_settings: Path | None = None
    memorix_cli_sha256: str | None = None
    retrieval: BaselineRetrieval | None = None
    memory_preparation_seconds: float | None = None
    memory_retrieval_seconds: float | None = None
    condition_metadata: dict[str, object] = {
        "condition": condition,
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
        seed_result = seed_memorix_project(
            manifest=manifest,
            workspace=workspace_dir,
            cli_path=memorix_cli_path,
            data_dir=data_dir,
            home_dir=home_dir,
            artifact_dir=adapter_dir,
            mode=memorix_mode or "full",
        )
        transfer_commit, transition_patch_sha256 = advance_case_to_transfer(
            manifest,
            workspace_dir,
        )
        agent_start_commit = reset_history_to_snapshot(workspace_dir)
        refresh_result = refresh_memorix_project(
            manifest=manifest,
            workspace=workspace_dir,
            cli_path=memorix_cli_path,
            data_dir=data_dir,
            home_dir=home_dir,
            artifact_dir=adapter_dir,
            project_id=str(seed_result["project_id"]),
            mode=memorix_mode or "full",
        )
        mcp_config = write_claude_mcp_config(
            path=memory_dir / "claude-mcp.json",
            cli_path=memorix_cli_path,
            workspace=workspace_dir,
            data_dir=data_dir,
            home_dir=home_dir,
            mode=memorix_mode or "full",
        )
        memorix_cli_sha256 = _sha256(memorix_cli_path)
        condition_metadata = {
            "condition": condition,
            "memory_provider": "memorix",
            "memorix_cli": str(memorix_cli_path),
            "memorix_cli_sha256": memorix_cli_sha256,
            "tool_profile": memorix_mode,
            "llm": "off",
            "embedding": "off",
            "seed_maintenance": seed_result["maintenance"]["summary"],
            "refresh_maintenance": refresh_result["maintenance"]["summary"],
            "final_workset": refresh_result["final"]["workset"],
        }
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
        seed_result = adapter.seed(manifest, project_id=project_id)
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
            "memory_provider": "mem0",
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
            "retrieval": {
                "query": retrieval.query,
                "top_k": CANONICAL_RETRIEVAL_TOP_K,
                "token_budget": retrieval.token_budget,
                "token_count": retrieval.token_count,
                "truncated": retrieval.truncated,
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
            seed_result = adapter.seed(manifest, project_id=project_id)
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
            "memory_provider": "agentmemory",
            "provider_id": AGENTMEMORY_PROVIDER_ID,
            "runtime_root": str(runtime_root),
            "project_name": compose_project,
            "port": adapter.port,
            "data_dir": str(adapter.data_dir),
            "full_service": True,
            "preflight": preflight,
            "seed": seed_result,
            "retrieval": {
                "query": retrieval.query,
                "top_k": CANONICAL_RETRIEVAL_TOP_K,
                "token_budget": retrieval.token_budget,
                "token_count": retrieval.token_count,
                "truncated": retrieval.truncated,
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

    prompt = build_condition_prompt(
        manifest,
        condition,
        retrieved_context=retrieval.context if retrieval else None,
    )
    allowed_tools = build_claude_allowed_tools(manifest, condition)
    if agent == "claude":
        assert workspace_root_path is not None
        denied_roots = {
            artifact_root_path,
            Path(artifact_root_path.anchor),
            Path(Path.home().anchor),
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
    evaluation = run_transfer_evaluation(
        manifest,
        workspace_dir,
        timeout_seconds=min(timeout_seconds, 300),
    )
    grade_results = list(evaluation.commands)
    patch_sha = _sha256(execution.patch_path)
    transcript_sha: str | None = None
    if manifest.precursor.transcript:
        transcript_sha = _sha256(
            _resolve_case_asset(manifest, manifest.precursor.transcript)
        )

    memory_tool_attempt_count = sum("memorix" in name.lower() for name in execution.tool_names)
    memory_tool_call_count = sum(
        "memorix" in name.lower() for name in execution.successful_tool_names
    )
    command_contamination_violations = audit_bash_commands(
        execution.bash_commands,
        workspace=workspace_dir,
    )
    environment_violation = bool(
        execution.permission_denials or command_contamination_violations
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
        else execution.failure_reason
    )
    outcome = TrialOutcome(
        schema_version="0.7",
        run_id=run_id,
        study_id=study_id,
        case_id=manifest.case_id,
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
        task_success=phase_passed(grade_results),
        agent_returncode=execution.returncode,
        timed_out=execution.timed_out,
        first_correct_action_seconds=None,
        input_tokens=execution.input_tokens,
        cached_input_tokens=execution.cached_input_tokens,
        output_tokens=execution.output_tokens,
        reasoning_output_tokens=execution.reasoning_output_tokens,
        wall_seconds=execution.wall_seconds,
        cost_usd=execution.cost_usd,
        stale_memory_errors=0,
        negative_control_intrusions=0,
        command_count=execution.command_count,
        tool_call_count=execution.tool_call_count,
        tool_names=execution.tool_names,
        successful_tool_call_count=execution.successful_tool_call_count,
        successful_tool_names=execution.successful_tool_names,
        permission_denials=execution.permission_denials,
        unavailable_tool_attempts=execution.unavailable_tool_attempts,
        bash_commands=execution.bash_commands,
        command_contamination_violations=command_contamination_violations,
        memory_tool_attempt_count=memory_tool_attempt_count,
        memory_tool_call_count=memory_tool_call_count,
        memory_provider=str(condition_metadata["memory_provider"])
        if condition_metadata["memory_provider"] is not None
        else None,
        retrieved_context_tokens=retrieval.token_count if retrieval else None,
        retrieved_context_record_count=len(retrieval.records) if retrieval else None,
        retrieved_context_truncated=retrieval.truncated if retrieval else None,
        memory_preparation_seconds=memory_preparation_seconds,
        memory_retrieval_seconds=memory_retrieval_seconds,
        memorix_cli_sha256=memorix_cli_sha256,
        case_manifest_sha256=_sha256(manifest.source_path),
        precursor_transcript_sha256=transcript_sha,
        base_commit=materialized.base_commit,
        precursor_commit=materialized.precursor_commit,
        transfer_commit=transfer_commit,
        precursor_patch_sha256=materialized.precursor_patch_sha256,
        transition_patch_sha256=transition_patch_sha256,
        hidden_test_patch_sha256=evaluation.hidden_patch_sha256,
        agent_start_commit=agent_start_commit,
        patch_sha256=patch_sha,
        platform=platform.platform(),
        python_version=platform.python_version(),
        started_at=started_at,
        artifact_dir=str(run_dir),
        workspace_isolation=workspace_isolation,
    )
    (run_dir / "prompt.txt").write_text(prompt, encoding="utf-8")
    (run_dir / "grade.json").write_text(
        json.dumps(
            {
                "passed": outcome.task_success,
                "commands": _serialize_commands(grade_results),
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
