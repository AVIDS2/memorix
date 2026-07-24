from __future__ import annotations

from dataclasses import asdict, dataclass, replace
import hashlib
import json
from pathlib import Path
import secrets
import shutil
import stat
import subprocess
import tempfile
import re
from typing import Any

from .annotation import write_sanitized_action_ledger
from .agents import AgentExecution, AgentName, ModelUsage, run_agent
from .sealed_patch import SealedPatch, SealedPatchError, seal_patch, snapshot_sealed_patch


WORKER_JOB_SCHEMA_VERSION = "0.3"
WORKER_RESULT_SCHEMA_VERSION = "0.3"
SHA256_PATTERN = re.compile(r"^[0-9a-f]{64}$")
JOB_NONCE_PATTERN = re.compile(r"^[0-9a-f]{32}$")
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
    public_bundle_sha256: str
    memory_snapshot_sha256: str
    subject_protocol_sha256: str
    controller_policy_sha256: str
    job_nonce: str
    workspace_snapshot_sha256: str
    timeout_seconds: int
    max_budget_usd: float | None
    allowed_tools: tuple[str, ...]
    config_overrides: tuple[str, ...]
    runtime_config_sha256: str | None = None

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
    public_bundle_sha256: str
    memory_snapshot_sha256: str
    subject_protocol_sha256: str
    controller_policy_sha256: str
    job_nonce: str
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
    runtime_config_sha256: str | None = None
    final_workspace_sha256: str | None = None
    model_request_count: int | None = None
    provider_request_ids_sha256: str | None = None

    def public_payload(self) -> dict[str, object]:
        return asdict(self)

    @property
    def result_sha256(self) -> str:
        payload = json.dumps(
            self.public_payload(),
            sort_keys=True,
            separators=(",", ":"),
            ensure_ascii=True,
        ).encode("ascii")
        return hashlib.sha256(payload).hexdigest()


def _sha256_text(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _runtime_file_sha256(path: str | Path | None, *, label: str) -> str | None:
    if path is None:
        return None
    candidate = Path(path)
    try:
        metadata = candidate.lstat()
    except OSError as error:
        raise WorkerProtocolError(f"worker {label} is unavailable") from error
    if candidate.is_symlink() or not stat.S_ISREG(metadata.st_mode):
        raise WorkerProtocolError(f"worker {label} must be a regular file")
    try:
        return hashlib.sha256(candidate.read_bytes()).hexdigest()
    except OSError as error:
        raise WorkerProtocolError(f"worker {label} cannot be read") from error


def runtime_configuration_sha256(
    *,
    environment: dict[str, str] | None,
    mcp_config: str | Path | None,
    settings_path: str | Path | None,
) -> str:
    """Commit exact runtime inputs without serializing environment secrets."""

    environment_hashes: dict[str, str] = {}
    for key, value in sorted((environment or {}).items()):
        if not isinstance(key, str) or not key or not isinstance(value, str):
            raise WorkerProtocolError("worker environment must contain non-empty string keys and values")
        environment_hashes[key] = _sha256_text(value)
    payload = {
        "schema_version": "worker-runtime-config-v1",
        "environment_value_sha256": environment_hashes,
        "mcp_config_sha256": _runtime_file_sha256(mcp_config, label="MCP config"),
        "settings_path_sha256": _runtime_file_sha256(settings_path, label="settings file"),
    }
    encoded = json.dumps(
        payload,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=True,
    ).encode("ascii")
    return hashlib.sha256(encoded).hexdigest()


def bind_worker_relay_evidence(
    result: WorkerResult,
    *,
    model_request_count: int,
    provider_request_ids_sha256: str,
) -> WorkerResult:
    """Attach relay-observed request commitments before the worker signs its result.

    A future isolated worker obtains these values from its controller-owned relay
    completion channel. The confirmatory permit independently verifies the same
    values in the relay signature, so this helper alone is not evidence.
    """

    if isinstance(model_request_count, bool) or not isinstance(model_request_count, int):
        raise WorkerProtocolError("worker model request count must be a positive integer")
    if model_request_count <= 0:
        raise WorkerProtocolError("worker model request count must be a positive integer")
    _require_sha256(provider_request_ids_sha256, label="provider request ids")
    return replace(
        result,
        model_request_count=model_request_count,
        provider_request_ids_sha256=provider_request_ids_sha256,
    )


def create_controller_job_nonce() -> str:
    """Return a controller-generated nonce for one remote worker job."""

    return secrets.token_hex(16)


def _require_sha256(value: object, *, label: str) -> str:
    if not isinstance(value, str) or not SHA256_PATTERN.fullmatch(value):
        raise WorkerProtocolError(f"worker job {label} must be a lowercase SHA-256")
    return value


def _require_job_nonce(value: object) -> str:
    if not isinstance(value, str) or not JOB_NONCE_PATTERN.fullmatch(value):
        raise WorkerProtocolError("worker job nonce must be a 128-bit lowercase hexadecimal value")
    return value


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


def _workspace_head(workspace: Path) -> str:
    head = _git_output(workspace, "rev-parse", "--verify", "HEAD").strip()
    if not re.fullmatch(r"[0-9a-f]{40}", head):
        raise WorkerProtocolError("worker workspace must have one immutable Git HEAD")
    return head


def _capture_workspace_patch(
    workspace: Path,
    target: Path,
    *,
    expected_head: str,
) -> tuple[SealedPatch, str]:
    if _workspace_head(workspace) != expected_head:
        raise WorkerProtocolError("worker changed the public workspace Git HEAD")
    status = _git_output(
        workspace,
        "status",
        "--porcelain=v1",
        "--untracked-files=all",
        "--ignored=matching",
    )
    if any(line.startswith("!! ") for line in status.splitlines()):
        raise WorkerProtocolError("worker workspace contains ignored files after execution")
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
    patch = _git_output(workspace, "diff", "--no-ext-diff", "--binary", "HEAD")
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(patch, encoding="utf-8")
    return seal_patch(target), _hash_workspace_tree(workspace)


def reconstruct_sealed_patch_in_vault(
    *,
    workspace: str | Path,
    worker_patch: SealedPatch,
    expected_workspace_snapshot_sha256: str,
    expected_final_workspace_sha256: str,
) -> str:
    """Apply a sealed worker patch to a clean disposable vault checkout.

    The caller owns this checkout and must discard it after grading. This
    function deliberately verifies only public tree reconstruction; it never
    mounts an oracle or starts an agent.
    """

    _require_sha256(expected_workspace_snapshot_sha256, label="workspace snapshot")
    _require_sha256(expected_final_workspace_sha256, label="final workspace")
    root = Path(workspace).resolve()
    if workspace_snapshot_hash(root) != expected_workspace_snapshot_sha256:
        raise WorkerProtocolError("vault workspace snapshot does not match the worker baseline")
    initial_head = _workspace_head(root)
    with tempfile.TemporaryDirectory(prefix="memorixbench-vault-patch-") as directory:
        try:
            frozen_patch = snapshot_sealed_patch(
                worker_patch,
                Path(directory) / "sealed-worker.patch",
            )
        except SealedPatchError as error:
            raise WorkerProtocolError("sealed worker patch changed before vault reconstruction") from error
        patch_path = frozen_patch.path
        try:
            checked = subprocess.run(
                ["git", "apply", "--check", "--whitespace=error", str(patch_path)],
                cwd=root,
                check=False,
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
            )
        except OSError as error:
            raise WorkerProtocolError("vault could not check the sealed worker patch") from error
        if checked.returncode != 0:
            raise WorkerProtocolError("sealed worker patch cannot be applied to the vault baseline")
        applied = subprocess.run(
            ["git", "apply", "--whitespace=error", str(patch_path)],
            cwd=root,
            check=False,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
        )
        if applied.returncode != 0:
            raise WorkerProtocolError("vault could not apply the sealed worker patch")
    if _workspace_head(root) != initial_head:
        raise WorkerProtocolError("sealed worker patch changed the vault Git HEAD")
    status = _git_output(
        root,
        "status",
        "--porcelain=v1",
        "--untracked-files=all",
        "--ignored=matching",
    )
    if any(line.startswith("!! ") for line in status.splitlines()):
        raise WorkerProtocolError("sealed worker patch reconstructs ignored workspace files")
    final_hash = _hash_workspace_tree(root)
    if final_hash != expected_final_workspace_sha256:
        raise WorkerProtocolError("sealed worker patch does not reconstruct the expected final tree")
    return final_hash


def create_worker_job(
    *,
    run_id: str,
    case_id: str,
    condition: str,
    agent: AgentName,
    model: str | None,
    prompt: str,
    public_case_definition_sha256: str,
    public_bundle_sha256: str,
    memory_snapshot_sha256: str,
    subject_protocol_sha256: str,
    controller_policy_sha256: str,
    job_nonce: str,
    workspace: str | Path,
    timeout_seconds: int,
    max_budget_usd: float | None,
    allowed_tools: tuple[str, ...] = (),
    config_overrides: tuple[str, ...] = (),
    runtime_config_sha256: str | None = None,
) -> WorkerJob:
    if agent not in {"claude", "codex"}:
        raise WorkerProtocolError("unsupported worker agent")
    if not prompt.strip():
        raise WorkerProtocolError("worker job prompt must be non-empty")
    if timeout_seconds <= 0:
        raise WorkerProtocolError("worker timeout must be positive")
    public_case_definition_sha256 = _require_sha256(
        public_case_definition_sha256,
        label="public case definition",
    )
    public_bundle_sha256 = _require_sha256(public_bundle_sha256, label="public bundle")
    memory_snapshot_sha256 = _require_sha256(memory_snapshot_sha256, label="memory snapshot")
    subject_protocol_sha256 = _require_sha256(subject_protocol_sha256, label="subject protocol")
    controller_policy_sha256 = _require_sha256(
        controller_policy_sha256,
        label="controller policy",
    )
    job_nonce = _require_job_nonce(job_nonce)
    if runtime_config_sha256 is not None:
        runtime_config_sha256 = _require_sha256(
            runtime_config_sha256,
            label="runtime configuration",
        )
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
        public_bundle_sha256=public_bundle_sha256,
        memory_snapshot_sha256=memory_snapshot_sha256,
        subject_protocol_sha256=subject_protocol_sha256,
        controller_policy_sha256=controller_policy_sha256,
        job_nonce=job_nonce,
        workspace_snapshot_sha256=workspace_snapshot_hash(workspace),
        timeout_seconds=timeout_seconds,
        max_budget_usd=max_budget_usd,
        allowed_tools=allowed_tools,
        config_overrides=config_overrides,
        runtime_config_sha256=runtime_config_sha256,
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
        "public_bundle_sha256",
        "memory_snapshot_sha256",
        "subject_protocol_sha256",
        "controller_policy_sha256",
        "job_nonce",
        "workspace_snapshot_sha256",
        "timeout_seconds",
        "max_budget_usd",
            "allowed_tools",
            "config_overrides",
            "runtime_config_sha256",
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
    public_case_definition_sha256 = _require_sha256(
        raw.get("public_case_definition_sha256"),
        label="public case definition",
    )
    public_bundle_sha256 = _require_sha256(raw.get("public_bundle_sha256"), label="public bundle")
    memory_snapshot_sha256 = _require_sha256(raw.get("memory_snapshot_sha256"), label="memory snapshot")
    subject_protocol_sha256 = _require_sha256(raw.get("subject_protocol_sha256"), label="subject protocol")
    controller_policy_sha256 = _require_sha256(
        raw.get("controller_policy_sha256"),
        label="controller policy",
    )
    job_nonce = _require_job_nonce(raw.get("job_nonce"))
    runtime_config_sha256 = raw.get("runtime_config_sha256")
    if runtime_config_sha256 is not None:
        runtime_config_sha256 = _require_sha256(
            runtime_config_sha256,
            label="runtime configuration",
        )
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
        public_case_definition_sha256=public_case_definition_sha256,
        public_bundle_sha256=public_bundle_sha256,
        memory_snapshot_sha256=memory_snapshot_sha256,
        subject_protocol_sha256=subject_protocol_sha256,
        controller_policy_sha256=controller_policy_sha256,
        job_nonce=job_nonce,
        workspace_snapshot_sha256=str(raw["workspace_snapshot_sha256"]),
        timeout_seconds=timeout_seconds,
        max_budget_usd=max_budget,
        allowed_tools=tuple(raw["allowed_tools"]),
        config_overrides=tuple(raw["config_overrides"]),
        runtime_config_sha256=runtime_config_sha256,
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
    initial_head = _workspace_head(root)
    observed_runtime_config_sha256 = runtime_configuration_sha256(
        environment=environment,
        mcp_config=mcp_config,
        settings_path=settings_path,
    )
    if (
        job.runtime_config_sha256 is not None
        and observed_runtime_config_sha256 != job.runtime_config_sha256
    ):
        raise WorkerProtocolError("worker runtime configuration does not match the public job")
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
        sealed_patch, final_workspace_sha256 = _capture_workspace_patch(
            root,
            output / "sealed.patch",
            expected_head=initial_head,
        )
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
        public_bundle_sha256=job.public_bundle_sha256,
        memory_snapshot_sha256=job.memory_snapshot_sha256,
        subject_protocol_sha256=job.subject_protocol_sha256,
        controller_policy_sha256=job.controller_policy_sha256,
        job_nonce=job.job_nonce,
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
        runtime_config_sha256=observed_runtime_config_sha256,
        final_workspace_sha256=final_workspace_sha256,
    )
    (output / "worker-result.json").write_text(
        json.dumps(result.public_payload(), indent=2),
        encoding="utf-8",
    )
    return result
