from __future__ import annotations

from dataclasses import asdict, dataclass
import hashlib
import json
from pathlib import Path
import shutil
import stat
import subprocess
from typing import Any

from .annotation import write_sanitized_action_ledger
from .agents import AgentExecution, AgentName, ModelUsage, run_agent
from .sealed_patch import SealedPatch, seal_patch


WORKER_JOB_SCHEMA_VERSION = "0.1"
WORKER_RESULT_SCHEMA_VERSION = "0.1"
WORKER_FORBIDDEN_FIELDS = {
    "private_oracle_root",
    "oracle_overlay",
    "hidden_patch",
    "reference_patch",
    "vault_root",
}


class WorkerProtocolError(ValueError):
    """Raised when a public worker job violates the worker/vault boundary."""


@dataclass(frozen=True)
class WorkerJob:
    schema_version: str
    run_id: str
    case_id: str
    condition: str
    agent: AgentName
    model: str | None
    prompt: str
    prompt_sha256: str
    public_case_definition_sha256: str
    workspace_snapshot_sha256: str
    timeout_seconds: int
    max_budget_usd: float | None
    allowed_tools: tuple[str, ...]
    config_overrides: tuple[str, ...]

    @property
    def job_sha256(self) -> str:
        payload = json.dumps(asdict(self), sort_keys=True, separators=(",", ":"))
        return hashlib.sha256(payload.encode("utf-8")).hexdigest()

    def public_payload(self) -> dict[str, object]:
        return asdict(self)


@dataclass(frozen=True)
class WorkerResult:
    schema_version: str
    run_id: str
    job_sha256: str
    case_id: str
    condition: str
    agent: AgentName
    model: str | None
    workspace_snapshot_sha256: str
    sealed_patch_sha256: str
    sealed_patch_bytes: int
    changed_paths: tuple[str, ...]
    agent_returncode: int
    timed_out: bool
    completed: bool
    failure_reason: str | None
    wall_seconds: float
    input_tokens: int | None
    cached_input_tokens: int | None
    output_tokens: int | None
    reasoning_output_tokens: int | None
    cost_usd: float | None
    reported_models: tuple[str, ...]
    model_usage: tuple[ModelUsage, ...]
    model_profile: str
    event_count: int
    command_count: int
    tool_call_count: int
    successful_tool_call_count: int
    action_ledger_sha256: str
    sanitized_action_ledger_sha256: str
    action_count: int
    action_timing_source: str

    def public_payload(self) -> dict[str, object]:
        return asdict(self)


def _sha256_text(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _git_output(workspace: Path, *args: str) -> str:
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
        raise WorkerProtocolError("worker workspace Git operation failed")
    return completed.stdout


def _is_reparse_point(path: Path) -> bool:
    attributes = getattr(path.lstat(), "st_file_attributes", 0)
    return bool(attributes & getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0x400))


def _hash_workspace_tree(root: Path) -> str:
    """Hash every visible workspace path without inheriting temporary Git commits."""

    digest = hashlib.sha256()
    digest.update(b"memorixbench-workspace-tree-v2\0")

    def visit(directory: Path) -> None:
        for child in sorted(directory.iterdir(), key=lambda item: item.name.casefold()):
            relative = child.relative_to(root).as_posix()
            if relative == ".git" or relative.startswith(".git/"):
                continue
            if child.is_symlink() or _is_reparse_point(child):
                raise WorkerProtocolError(
                    f"worker workspace cannot contain symbolic or reparse paths: {relative}"
                )
            metadata = child.lstat()
            if stat.S_ISDIR(metadata.st_mode):
                digest.update(b"D\0")
                digest.update(relative.encode("utf-8"))
                digest.update(b"\0")
                visit(child)
                continue
            if not stat.S_ISREG(metadata.st_mode):
                raise WorkerProtocolError(
                    f"worker workspace contains an unsupported filesystem entry: {relative}"
                )
            digest.update(b"F\0")
            digest.update(relative.encode("utf-8"))
            digest.update(b"\0")
            digest.update(str(stat.S_IMODE(metadata.st_mode)).encode("ascii"))
            digest.update(b"\0")
            with child.open("rb") as handle:
                for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                    digest.update(chunk)
    visit(root)
    return digest.hexdigest()


def _validated_workspace_root(workspace: str | Path) -> Path:
    requested = Path(workspace)
    try:
        metadata = requested.lstat()
    except OSError as error:
        raise WorkerProtocolError("worker workspace cannot be inspected") from error
    if requested.is_symlink() or _is_reparse_point(requested):
        raise WorkerProtocolError("worker workspace root cannot be a symbolic or reparse path")
    if not stat.S_ISDIR(metadata.st_mode):
        raise WorkerProtocolError("worker workspace root must be a directory")
    root = requested.resolve()
    git_metadata = root / ".git"
    try:
        git_stat = git_metadata.lstat()
    except OSError as error:
        raise WorkerProtocolError("worker workspace must use a regular .git directory") from error
    if (
        git_metadata.is_symlink()
        or _is_reparse_point(git_metadata)
        or not stat.S_ISDIR(git_stat.st_mode)
    ):
        raise WorkerProtocolError("worker workspace must use a regular .git directory")
    return root


def workspace_snapshot_hash(workspace: str | Path) -> str:
    """Commit a stable, clean public workspace tree without exposing contents.

    The hash intentionally excludes `.git` metadata: materialized fixture commits
    have local timestamps, while the tree that an agent can inspect must retain
    one stable identity across independent captures.
    """

    root = _validated_workspace_root(workspace)
    status = _git_output(
        root,
        "status",
        "--porcelain=v1",
        "--untracked-files=all",
        "--ignored=matching",
    )
    if status.strip():
        raise WorkerProtocolError("worker workspace must start clean, including ignored files")
    return _hash_workspace_tree(root)


def _capture_workspace_patch(workspace: Path, target: Path) -> SealedPatch:
    untracked = _git_output(workspace, "ls-files", "--others", "--exclude-standard")
    paths = tuple(line for line in untracked.splitlines() if line.strip())
    if paths:
        staged = subprocess.run(
            ["git", "add", "--intent-to-add", "--", *paths],
            cwd=workspace,
            check=False,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
        )
        if staged.returncode != 0:
            raise WorkerProtocolError("worker could not seal untracked workspace files")
    patch = _git_output(workspace, "diff", "--no-ext-diff", "--binary")
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(patch, encoding="utf-8")
    return seal_patch(target)


def create_worker_job(
    *,
    run_id: str,
    case_id: str,
    condition: str,
    agent: AgentName,
    model: str | None,
    prompt: str,
    public_case_definition_sha256: str,
    workspace: str | Path,
    timeout_seconds: int,
    max_budget_usd: float | None,
    allowed_tools: tuple[str, ...] = (),
    config_overrides: tuple[str, ...] = (),
) -> WorkerJob:
    if agent not in {"claude", "codex"}:
        raise WorkerProtocolError("unsupported worker agent")
    if not prompt.strip():
        raise WorkerProtocolError("worker job prompt must be non-empty")
    if timeout_seconds <= 0:
        raise WorkerProtocolError("worker timeout must be positive")
    return WorkerJob(
        schema_version=WORKER_JOB_SCHEMA_VERSION,
        run_id=run_id,
        case_id=case_id,
        condition=condition,
        agent=agent,
        model=model,
        prompt=prompt,
        prompt_sha256=_sha256_text(prompt),
        public_case_definition_sha256=public_case_definition_sha256,
        workspace_snapshot_sha256=workspace_snapshot_hash(workspace),
        timeout_seconds=timeout_seconds,
        max_budget_usd=max_budget_usd,
        allowed_tools=allowed_tools,
        config_overrides=config_overrides,
    )


def write_worker_job(job: WorkerJob, path: str | Path) -> Path:
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(job.public_payload(), indent=2), encoding="utf-8")
    return target


def load_worker_job(path: str | Path) -> WorkerJob:
    try:
        raw = json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise WorkerProtocolError("worker job cannot be read") from error
    if not isinstance(raw, dict):
        raise WorkerProtocolError("worker job must be a JSON object")
    forbidden = WORKER_FORBIDDEN_FIELDS & raw.keys()
    if forbidden:
        raise WorkerProtocolError("worker job contains private-oracle fields")
    expected = {
        "schema_version",
        "run_id",
        "case_id",
        "condition",
        "agent",
        "model",
        "prompt",
        "prompt_sha256",
        "public_case_definition_sha256",
        "workspace_snapshot_sha256",
        "timeout_seconds",
        "max_budget_usd",
        "allowed_tools",
        "config_overrides",
    }
    if set(raw) != expected:
        raise WorkerProtocolError("worker job has unexpected fields")
    if raw.get("schema_version") != WORKER_JOB_SCHEMA_VERSION:
        raise WorkerProtocolError("unsupported worker job schema version")
    agent = raw.get("agent")
    if agent not in {"claude", "codex"}:
        raise WorkerProtocolError("worker job has unsupported agent")
    prompt = raw.get("prompt")
    if not isinstance(prompt, str) or not prompt.strip():
        raise WorkerProtocolError("worker job prompt must be non-empty")
    if raw.get("prompt_sha256") != _sha256_text(prompt):
        raise WorkerProtocolError("worker job prompt commitment does not match")
    for key in ("allowed_tools", "config_overrides"):
        if not isinstance(raw.get(key), list) or any(
            not isinstance(item, str) or not item.strip() for item in raw[key]
        ):
            raise WorkerProtocolError(f"worker job {key} is invalid")
    try:
        timeout_seconds = int(raw["timeout_seconds"])
    except (KeyError, TypeError, ValueError) as error:
        raise WorkerProtocolError("worker job timeout is invalid") from error
    if timeout_seconds <= 0:
        raise WorkerProtocolError("worker job timeout is invalid")
    max_budget = raw["max_budget_usd"]
    if max_budget is not None:
        try:
            max_budget = float(max_budget)
        except (TypeError, ValueError) as error:
            raise WorkerProtocolError("worker job budget is invalid") from error
    return WorkerJob(
        schema_version=WORKER_JOB_SCHEMA_VERSION,
        run_id=str(raw["run_id"]),
        case_id=str(raw["case_id"]),
        condition=str(raw["condition"]),
        agent=agent,
        model=None if raw["model"] is None else str(raw["model"]),
        prompt=prompt,
        prompt_sha256=str(raw["prompt_sha256"]),
        public_case_definition_sha256=str(raw["public_case_definition_sha256"]),
        workspace_snapshot_sha256=str(raw["workspace_snapshot_sha256"]),
        timeout_seconds=timeout_seconds,
        max_budget_usd=max_budget,
        allowed_tools=tuple(raw["allowed_tools"]),
        config_overrides=tuple(raw["config_overrides"]),
    )


def _model_profile(execution: AgentExecution) -> str:
    if not execution.model_usage:
        return "unreported"
    return "single" if len(execution.model_usage) == 1 else "mixed"


def run_worker_job(
    job: WorkerJob,
    *,
    workspace: str | Path,
    output_root: str | Path,
    environment: dict[str, str] | None = None,
    mcp_config: str | Path | None = None,
    settings_path: str | Path | None = None,
) -> WorkerResult:
    root = Path(workspace).resolve()
    if workspace_snapshot_hash(root) != job.workspace_snapshot_sha256:
        raise WorkerProtocolError("worker workspace snapshot does not match the public job")
    output = Path(output_root).resolve()
    if output.exists():
        raise WorkerProtocolError("worker output root already exists")
    output.mkdir(parents=True)
    internal_root = output.parent / (output.name + ".internal")
    if internal_root.exists():
        raise WorkerProtocolError("worker internal root already exists")
    internal_root.mkdir(parents=True)
    try:
        execution = run_agent(
            agent=job.agent,
            workspace=root,
            prompt=job.prompt,
            artifact_dir=internal_root,
            model=job.model,
            timeout_seconds=job.timeout_seconds,
            config_overrides=job.config_overrides,
            mcp_config=None if mcp_config is None else Path(mcp_config),
            max_budget_usd=job.max_budget_usd,
            allowed_tools=job.allowed_tools,
            settings_path=None if settings_path is None else Path(settings_path),
            environment=environment,
        )
        sealed_patch = _capture_workspace_patch(root, output / "sealed.patch")
        sanitized_actions = write_sanitized_action_ledger(
            execution.action_ledger_path,
            output / "action-ledger.json",
        )
    finally:
        shutil.rmtree(internal_root, ignore_errors=True)
    result = WorkerResult(
        schema_version=WORKER_RESULT_SCHEMA_VERSION,
        run_id=job.run_id,
        job_sha256=job.job_sha256,
        case_id=job.case_id,
        condition=job.condition,
        agent=job.agent,
        model=job.model,
        workspace_snapshot_sha256=job.workspace_snapshot_sha256,
        sealed_patch_sha256=sealed_patch.sha256,
        sealed_patch_bytes=sealed_patch.byte_count,
        changed_paths=sealed_patch.changed_paths,
        agent_returncode=execution.returncode,
        timed_out=execution.timed_out,
        completed=execution.completed,
        failure_reason=execution.failure_reason,
        wall_seconds=execution.wall_seconds,
        input_tokens=execution.input_tokens,
        cached_input_tokens=execution.cached_input_tokens,
        output_tokens=execution.output_tokens,
        reasoning_output_tokens=execution.reasoning_output_tokens,
        cost_usd=execution.cost_usd,
        reported_models=execution.reported_models,
        model_usage=execution.model_usage,
        model_profile=_model_profile(execution),
        event_count=execution.event_count,
        command_count=execution.command_count,
        tool_call_count=execution.tool_call_count,
        successful_tool_call_count=execution.successful_tool_call_count,
        action_ledger_sha256=execution.action_ledger_sha256,
        sanitized_action_ledger_sha256=sanitized_actions.sha256,
        action_count=execution.action_count,
        action_timing_source=execution.action_timing_source,
    )
    (output / "worker-result.json").write_text(
        json.dumps(result.public_payload(), indent=2),
        encoding="utf-8",
    )
    return result
