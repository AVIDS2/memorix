from __future__ import annotations

from dataclasses import dataclass
import json
from pathlib import Path
import re
from uuid import uuid4

from .agents import (
    AgentExecution,
    AgentName,
    audit_bash_commands,
    load_claude_provider_env,
    run_agent,
    write_claude_settings,
)
from .public_safety import (
    PublicSafetyError,
    contains_sensitive_value,
    reject_public_json_payload,
)
from .schema import CaseManifest
from .trace_capture import TraceCaptureReceipt, capture_trace_from_streams
from .worker_protocol import WorkerProtocolError, workspace_snapshot_hash
from .workspace import materialize_case


CAPTURE_ID_PATTERN = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
CLAUDE_CAPTURE_ALLOWED_TOOLS = (
    "Read",
    "Bash(git status --short)",
    "Bash(git diff --check)",
    "Bash(git grep *)",
    "Bash(rg *)",
    "Bash(Get-ChildItem *)",
    "Bash(go test ./...)",
    "Bash(go test ./... *)",
)


class CaptureSessionError(ValueError):
    """Raised when a local precursor capture cannot form an auditable trace."""


@dataclass(frozen=True)
class PrecursorSessionCapture:
    case_id: str
    capture_id: str
    agent: AgentName
    requested_model: str | None
    client_version: str
    workspace_snapshot_sha256: str
    workspace: Path
    private_artifact_root: Path
    public_output_root: Path
    trace_path: Path
    receipt_path: Path
    execution: AgentExecution
    receipt: TraceCaptureReceipt

    def public_payload(self) -> dict[str, object]:
        return {
            "case_id": self.case_id,
            "capture_id": self.capture_id,
            "agent": self.agent,
            "requested_model": self.requested_model,
            "reported_models": list(self.execution.reported_models),
            "client_version": self.client_version,
            "capture_mode": self.receipt.capture_mode,
            "workspace_snapshot_sha256": self.workspace_snapshot_sha256,
            "completed": self.execution.completed,
            "returncode": self.execution.returncode,
            "timed_out": self.execution.timed_out,
            "failure_reason": self.execution.failure_reason,
            "event_count": self.execution.event_count,
            "tool_call_count": self.execution.tool_call_count,
            "action_count": self.execution.action_count,
            "trace_source_sha256": self.receipt.trace_source_sha256,
            "canonical_trace_sha256": self.receipt.canonical_trace_sha256,
        }


def _paths_overlap(left: Path, right: Path) -> bool:
    return left == right or left in right.parents or right in left.parents


def _capture_id(value: str | None) -> str:
    candidate = value or f"capture-{uuid4().hex}"
    if not CAPTURE_ID_PATTERN.fullmatch(candidate):
        raise CaptureSessionError("capture id must be a lowercase hyphenated identifier")
    return candidate


def _git_root(path: Path) -> Path:
    for candidate in (path.resolve(), *path.resolve().parents):
        if (candidate / ".git").exists():
            return candidate
    raise CaptureSessionError(f"case definition has no Git root: {path}")


def _validate_roots(
    *,
    private_artifact_root: Path,
    public_output_root: Path,
    workspace_root: Path,
    case_root: Path,
    capture_id: str,
) -> Path:
    roots = (private_artifact_root, public_output_root, workspace_root)
    if any(_paths_overlap(left, right) for index, left in enumerate(roots) for right in roots[index + 1:]):
        raise CaptureSessionError("private artifact, public output, and workspace roots must not overlap")
    if private_artifact_root.drive.casefold() != public_output_root.drive.casefold():
        raise CaptureSessionError("private artifact and public output roots must use one filesystem volume")
    if any(_paths_overlap(root, case_root) for root in roots):
        raise CaptureSessionError("capture roots must remain outside the case repository")
    if private_artifact_root.exists():
        raise CaptureSessionError(f"private capture artifact root already exists: {private_artifact_root}")
    if public_output_root.exists():
        raise CaptureSessionError(f"public capture output root already exists: {public_output_root}")
    workspace = workspace_root / capture_id / "workspace"
    if workspace.exists():
        raise CaptureSessionError(f"capture workspace already exists: {workspace}")
    return workspace


def _claude_control_settings(
    *,
    artifact_root: Path,
    manifest: CaseManifest,
    workspace: Path,
) -> Path:
    return write_claude_settings(
        artifact_root / "control" / "claude-settings.json",
        denied_roots=(
            artifact_root,
            _git_root(manifest.source_path.parent),
            Path.home(),
            workspace / ".git",
        ),
        # These are intentionally read-oriented. The post-run content snapshot
        # is a second check, not a claim of OS-level isolation.
        allowed_tools=CLAUDE_CAPTURE_ALLOWED_TOOLS,
    )


def _require_unchanged_snapshot(workspace: Path, expected: str) -> None:
    try:
        observed = workspace_snapshot_hash(workspace)
    except WorkerProtocolError as error:
        raise CaptureSessionError(
            "precursor capture changed the workspace; raw diagnostics were retained but no trace was admitted"
        ) from error
    if observed != expected:
        raise CaptureSessionError(
            "precursor capture changed the workspace snapshot; raw diagnostics were retained but no trace was admitted"
        )


def _provider_secret_values(environment: dict[str, str] | None) -> tuple[str, ...]:
    if not environment:
        return ()
    return tuple(
        value
        for key, value in environment.items()
        if key in {"ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"} and value
    )


def _quarantine_staged_output(staging_root: Path, private_root: Path) -> None:
    if not staging_root.exists():
        return
    quarantine = private_root / "quarantine-public-output"
    if quarantine.exists():
        raise CaptureSessionError("capture public staging could not be quarantined safely")
    staging_root.replace(quarantine)


def _release_staged_public_output(
    *,
    staging_root: Path,
    public_output_root: Path,
    sensitive_values: tuple[str, ...],
) -> None:
    trace_path = staging_root / "trace.json"
    receipt_path = staging_root / "receipt.json"

    def validate_sensitive_value(value: object) -> None:
        if isinstance(value, str):
            if contains_sensitive_value(value, sensitive_values):
                raise PublicSafetyError("public artifact contains an injected secret value")
            return
        if isinstance(value, dict):
            for nested in value.values():
                validate_sensitive_value(nested)
            return
        if isinstance(value, list):
            for nested in value:
                validate_sensitive_value(nested)

    try:
        for path in (trace_path, receipt_path):
            payload = json.loads(path.read_text(encoding="utf-8"))
            reject_public_json_payload(payload)
            validate_sensitive_value(payload)
    except (OSError, UnicodeDecodeError, json.JSONDecodeError, PublicSafetyError) as error:
        _quarantine_staged_output(staging_root, staging_root.parent)
        raise CaptureSessionError(
            "sanitized trace failed the public safety scan; staged output was quarantined"
        ) from error
    public_output_root.parent.mkdir(parents=True, exist_ok=True)
    staging_root.replace(public_output_root)


def capture_precursor_session(
    *,
    manifest: CaseManifest,
    prompt: str,
    artifact_root: str | Path,
    public_output_root: str | Path,
    workspace_root: str | Path,
    agent: AgentName,
    client_version: str,
    capture_id: str | None = None,
    model: str | None = None,
    timeout_seconds: int = 240,
    max_budget_usd: float | None = None,
    repository_cache: str | Path | None = None,
    claude_provider_settings: str | Path | None = None,
) -> PrecursorSessionCapture:
    """Capture one local diagnostic precursor session from a fixed snapshot.

    This is intentionally local-diagnostic evidence. It does not grant an
    isolated-worker provenance label or an oracle result.
    """

    if agent not in {"claude", "codex"}:
        raise CaptureSessionError(f"unsupported capture agent: {agent}")
    if not prompt.strip():
        raise CaptureSessionError("capture prompt must be non-empty")
    if not client_version.strip():
        raise CaptureSessionError("capture client version must be non-empty")
    if timeout_seconds <= 0:
        raise CaptureSessionError("capture timeout must be positive")
    if max_budget_usd is not None and max_budget_usd <= 0:
        raise CaptureSessionError("capture max budget must be positive")
    if agent == "claude" and claude_provider_settings is None:
        raise CaptureSessionError("Claude precursor capture requires provider settings")

    selected_capture_id = _capture_id(capture_id)
    private_artifact_path = Path(artifact_root).resolve()
    public_output_path = Path(public_output_root).resolve()
    workspace_base = Path(workspace_root).resolve()
    case_root = _git_root(manifest.source_path.parent)
    workspace = _validate_roots(
        private_artifact_root=private_artifact_path,
        public_output_root=public_output_path,
        workspace_root=workspace_base,
        case_root=case_root,
        capture_id=selected_capture_id,
    )
    private_artifact_path.mkdir(parents=True)
    workspace.parent.mkdir(parents=True, exist_ok=True)

    materialize_case(
        manifest,
        workspace,
        stage="precursor",
        repository_cache=repository_cache,
    )
    snapshot_sha256 = workspace_snapshot_hash(workspace)

    environment: dict[str, str] | None = None
    settings_path: Path | None = None
    if agent == "claude":
        assert claude_provider_settings is not None
        environment = load_claude_provider_env(claude_provider_settings)
        settings_path = _claude_control_settings(
            artifact_root=private_artifact_path,
            manifest=manifest,
            workspace=workspace,
        )

    execution = run_agent(
        agent=agent,
        workspace=workspace,
        prompt=prompt,
        artifact_dir=private_artifact_path / "raw",
        model=model,
        timeout_seconds=timeout_seconds,
        max_budget_usd=max_budget_usd,
        environment=environment,
        allowed_tools=CLAUDE_CAPTURE_ALLOWED_TOOLS if agent == "claude" else (),
        settings_path=settings_path,
        controlled=True,
    )
    if not execution.completed or execution.returncode != 0 or execution.timed_out:
        raise CaptureSessionError(
            "precursor client did not complete successfully; raw diagnostics were retained but no trace was admitted"
        )

    _require_unchanged_snapshot(workspace, snapshot_sha256)
    violations = audit_bash_commands(execution.bash_commands, workspace=workspace)
    if violations:
        raise CaptureSessionError(
            "precursor capture attempted a disallowed command: " + "; ".join(violations)
        )

    staging_root = private_artifact_path / "staged-public"
    receipt = capture_trace_from_streams(
        events_path=execution.events_path,
        timeline_path=execution.timeline_path,
        case_id=manifest.case_id,
        agent=agent,
        prompt=prompt,
        output_path=staging_root / "trace.json",
        receipt_path=staging_root / "receipt.json",
        client_version=client_version,
        workspace_snapshot_sha256=snapshot_sha256,
        workspace_roots=(workspace,),
        requested_model=model,
        capture_id=selected_capture_id,
        capture_mode="local-diagnostic-v1",
        tool_result_mode="metadata-only",
    )
    _release_staged_public_output(
        staging_root=staging_root,
        public_output_root=public_output_path,
        sensitive_values=_provider_secret_values(environment),
    )
    return PrecursorSessionCapture(
        case_id=manifest.case_id,
        capture_id=selected_capture_id,
        agent=agent,
        requested_model=model,
        client_version=client_version,
        workspace_snapshot_sha256=snapshot_sha256,
        workspace=workspace,
        private_artifact_root=private_artifact_path,
        public_output_root=public_output_path,
        trace_path=public_output_path / "trace.json",
        receipt_path=public_output_path / "receipt.json",
        execution=execution,
        receipt=receipt,
    )
