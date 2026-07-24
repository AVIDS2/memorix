"""Capture one real, isolated Claude Code hook session for local diagnostics.

The portable native-hook format is intentionally separate from the client that
produced it. This module joins those two steps without weakening the boundary:
it runs Claude in a disposable home/configuration, requires its edit to match a
predeclared precursor patch, and emits only the already-sanitized hook capture.
It is a local development diagnostic, never confirmatory provenance.
"""

from __future__ import annotations

from dataclasses import dataclass
import json
from pathlib import Path
import subprocess
from typing import Iterable
from uuid import uuid4

from .agents import (
    AgentExecution,
    apply_uniform_claude_role_model,
    audit_bash_commands,
    load_claude_provider_env,
    run_agent,
    write_claude_settings,
)
from .native_hook_capture import (
    NativeHookCapture,
    NativeHookCaptureError,
    ingest_memorix_native_hook_capture,
    write_native_hook_capture,
)
from .public_safety import PublicSafetyError, contains_sensitive_value, reject_public_json_payload
from .schema import CaseManifest
from .worker_protocol import WorkerProtocolError, workspace_snapshot_hash
from .workspace import materialize_case


CAPTURE_MODE = "local-diagnostic-v1"
CAPTURE_ID_PREFIX = "native-client"


class NativeClientCaptureError(ValueError):
    """Raised when an actual Claude hook capture is unsafe or non-reproducible."""


@dataclass(frozen=True)
class NativeClientCapture:
    case_id: str
    capture_id: str
    requested_model: str
    client_version: str
    workspace_snapshot_sha256: str
    workspace: Path
    expected_workspace: Path
    private_artifact_root: Path
    portable_capture_path: Path
    execution: AgentExecution
    capture: NativeHookCapture
    formation_receipt: dict[str, object]

    def public_payload(self) -> dict[str, object]:
        return {
            "case_id": self.case_id,
            "capture_id": self.capture_id,
            "agent": "claude",
            "requested_model": self.requested_model,
            "reported_models": list(self.execution.reported_models),
            "client_version": self.client_version,
            "capture_mode": self.capture.capture_mode,
            "workspace_snapshot_sha256": self.workspace_snapshot_sha256,
            "capture_source_sha256": self.capture.source_sha256,
            "capture_sha256": self.capture.canonical_sha256,
            "event_count": len(self.capture.events),
            "formation_surface": self.formation_receipt.get("surface"),
            "formation_record_count": self.formation_receipt.get("record_count"),
        }


def _paths_overlap(left: Path, right: Path) -> bool:
    return left == right or left in right.parents or right in left.parents


def _git_root(path: Path) -> Path:
    for candidate in (path.resolve(), *path.resolve().parents):
        if (candidate / ".git").exists():
            return candidate
    raise NativeClientCaptureError("case definition has no Git root")


def _capture_id(value: str | None) -> str:
    candidate = value or f"{CAPTURE_ID_PREFIX}-{uuid4().hex}"
    if not candidate or any(not (char.islower() or char.isdigit() or char == "-") for char in candidate):
        raise NativeClientCaptureError("capture id must be lowercase hyphenated text")
    if candidate.startswith("-") or candidate.endswith("-") or "--" in candidate:
        raise NativeClientCaptureError("capture id must be lowercase hyphenated text")
    return candidate


def _run_git(workspace: Path, *args: str) -> str:
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
        detail = (completed.stderr or completed.stdout or "git command failed").strip()
        raise NativeClientCaptureError(detail)
    return completed.stdout


def _commit_agent_workspace(workspace: Path) -> None:
    status = _run_git(
        workspace,
        "status",
        "--porcelain=v1",
        "--untracked-files=all",
        "--ignored=matching",
    )
    if not status.strip():
        raise NativeClientCaptureError("native precursor client did not edit the workspace")
    if any(line.startswith("!! ") for line in status.splitlines()):
        raise NativeClientCaptureError("native precursor workspace contains ignored residue")
    _run_git(workspace, "add", "--all")
    _run_git(workspace, "commit", "--quiet", "-m", "memorixbench: captured native precursor")


def _capture_allowed_tools(manifest: CaseManifest) -> tuple[str, ...]:
    tools = [
        "Read",
        "Edit",
        "Bash(git status --short)",
        "Bash(git diff --check)",
        "Bash(git grep *)",
        "Bash(rg *)",
        "Bash(Get-ChildItem *)",
    ]
    tools.extend(f"Bash({command})" for command in manifest.precursor.success_commands)
    return tuple(dict.fromkeys(tools))


def _write_native_capture_settings(
    *,
    path: Path,
    denied_roots: Iterable[Path],
    allowed_tools: Iterable[str],
    forwarder: Path,
    memorix_cli: Path,
    event_log: Path,
    data_dir: Path,
    home_dir: Path,
) -> Path:
    target = write_claude_settings(
        path,
        denied_roots=denied_roots,
        allowed_tools=allowed_tools,
    )
    payload = json.loads(target.read_text(encoding="utf-8"))
    command = subprocess.list2cmdline([
        "powershell.exe",
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        str(forwarder),
        "-MemorixCli",
        str(memorix_cli),
        "-EventLog",
        str(event_log),
        "-DataDir",
        str(data_dir),
        "-HomeDir",
        str(home_dir),
        "-Agent",
        "claude",
    ])
    payload["hooks"] = {
        "PostToolUse": [{
            "matcher": "Write|Edit",
            "hooks": [{
                "type": "command",
                "command": command,
                "timeout": 10,
            }],
        }],
    }
    target.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    return target


def _isolated_provider_env(provider_env: dict[str, str], private_root: Path) -> dict[str, str]:
    home = private_root / "control" / "agent-home"
    temp = private_root / "control" / "agent-temp"
    appdata = home / "AppData" / "Roaming"
    local_appdata = home / "AppData" / "Local"
    claude_config = home / "claude-config"
    for directory in (home, temp, appdata, local_appdata, claude_config):
        directory.mkdir(parents=True, exist_ok=True)
    environment = dict(provider_env)
    environment.update({
        "HOME": str(home),
        "USERPROFILE": str(home),
        "APPDATA": str(appdata),
        "LOCALAPPDATA": str(local_appdata),
        "CLAUDE_CONFIG_DIR": str(claude_config),
        "TEMP": str(temp),
        "TMP": str(temp),
    })
    return environment


def _require_manifest_ready(manifest: CaseManifest) -> None:
    if manifest.split != "development":
        raise NativeClientCaptureError(
            "native client capture is restricted to development diagnostics"
        )
    if manifest.formation_track != "native-session" or manifest.native_hook_capture is None:
        raise NativeClientCaptureError("native client capture requires native-session formation")
    if not manifest.precursor.patch:
        raise NativeClientCaptureError(
            "native client capture requires a predeclared precursor.patch"
        )
    if not manifest.oracle.agent_writable_paths:
        raise NativeClientCaptureError("native client capture requires writable source paths")


def _validate_roots(
    *,
    manifest: CaseManifest,
    private_root: Path,
    portable_output: Path,
    workspace_root: Path,
    capture_id: str,
) -> tuple[Path, Path]:
    case_root = _git_root(manifest.source_path.parent)
    expected_workspace = workspace_root / f"{capture_id}-expected"
    workspace = workspace_root / capture_id
    roots = (private_root, portable_output, workspace_root)
    for index, left in enumerate(roots):
        for right in roots[index + 1:]:
            if _paths_overlap(left, right):
                raise NativeClientCaptureError(
                    "private artifact, portable output, and workspace roots must not overlap"
                )
    if any(_paths_overlap(root, case_root) for root in roots):
        raise NativeClientCaptureError("native capture roots must stay outside the case repository")
    if private_root.exists() or portable_output.exists() or workspace.exists() or expected_workspace.exists():
        raise NativeClientCaptureError("native capture output paths must be fresh")
    return workspace, expected_workspace


def _secret_values(provider_env: dict[str, str]) -> tuple[str, ...]:
    return tuple(
        value
        for key, value in provider_env.items()
        if key in {"ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"} and value
    )


def _verify_portable_output(path: Path, *, sensitive_values: tuple[str, ...]) -> None:
    try:
        raw = path.read_text(encoding="utf-8")
        payload = json.loads(raw)
        reject_public_json_payload(payload)
    except (OSError, UnicodeDecodeError, json.JSONDecodeError, PublicSafetyError) as error:
        path.unlink(missing_ok=True)
        raise NativeClientCaptureError("portable native hook capture failed safety validation") from error
    if contains_sensitive_value(raw, sensitive_values):
        path.unlink(missing_ok=True)
        raise NativeClientCaptureError("portable native hook capture contains a provider credential")


def _require_edit_or_write_hook(capture: NativeHookCapture, *, output_path: Path) -> None:
    unexpected_events = [
        event
        for event in capture.events
        if event.event_name != "PostToolUse"
        or event.payload.get("tool_name") not in {"Edit", "Write"}
    ]
    if not unexpected_events:
        return
    output_path.unlink(missing_ok=True)
    raise NativeClientCaptureError(
        "native precursor client capture contains a non-Edit/Write PostToolUse event"
    )


def capture_native_client_session(
    *,
    manifest: CaseManifest,
    prompt: str,
    artifact_root: str | Path,
    portable_output: str | Path,
    workspace_root: str | Path,
    memorix_cli: str | Path,
    claude_provider_settings: str | Path,
    client_version: str,
    storage_probe_query: str,
    capture_id: str | None = None,
    model: str | None = None,
    timeout_seconds: int = 240,
    max_budget_usd: float | None = None,
    repository_cache: str | Path | None = None,
) -> NativeClientCapture:
    """Capture and validate a real Claude native-hook precursor session.

    All mutable client files and raw events remain under ``artifact_root``.
    ``portable_output`` is safe only after its explicit public-safety scan and
    can then be reviewed before it is copied into a public case definition.
    """

    _require_manifest_ready(manifest)
    if not prompt.strip():
        raise NativeClientCaptureError("native capture prompt must be non-empty")
    selected_model = (model or "").strip()
    if not selected_model:
        raise NativeClientCaptureError("native capture requires an exact requested model")
    if not client_version.strip():
        raise NativeClientCaptureError("native capture client version must be non-empty")
    if not storage_probe_query.strip():
        raise NativeClientCaptureError("native capture storage probe query must be non-empty")
    if timeout_seconds <= 0:
        raise NativeClientCaptureError("native capture timeout must be positive")
    if max_budget_usd is not None and max_budget_usd <= 0:
        raise NativeClientCaptureError("native capture max budget must be positive")

    selected_capture_id = _capture_id(capture_id)
    private_root = Path(artifact_root).resolve()
    output_path = Path(portable_output).resolve()
    workspace_base = Path(workspace_root).resolve()
    cli_path = Path(memorix_cli).resolve()
    forwarder = Path(__file__).parents[2] / "scripts" / "native-hook-forwarder.ps1"
    if not cli_path.is_file():
        raise NativeClientCaptureError("native capture Memorix CLI is unavailable")
    if not forwarder.is_file():
        raise NativeClientCaptureError("native capture hook forwarder is unavailable")

    workspace, expected_workspace = _validate_roots(
        manifest=manifest,
        private_root=private_root,
        portable_output=output_path,
        workspace_root=workspace_base,
        capture_id=selected_capture_id,
    )
    provider_env = load_claude_provider_env(claude_provider_settings)
    apply_uniform_claude_role_model(provider_env, selected_model)
    private_root.mkdir(parents=True)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    workspace_base.mkdir(parents=True, exist_ok=True)

    materialize_case(
        manifest,
        workspace,
        stage="base",
        repository_cache=repository_cache,
    )
    materialize_case(
        manifest,
        expected_workspace,
        stage="precursor",
        repository_cache=repository_cache,
    )
    try:
        expected_snapshot = workspace_snapshot_hash(expected_workspace)
    except WorkerProtocolError as error:
        raise NativeClientCaptureError("expected precursor workspace cannot be attested") from error

    hook_event_log = private_root / "raw" / "native-hook-events.jsonl"
    data_dir = private_root / "memorix-data"
    memorix_home = private_root / "memorix-home"
    environment = _isolated_provider_env(provider_env, private_root)
    allowed_tools = _capture_allowed_tools(manifest)
    settings_path = _write_native_capture_settings(
        path=private_root / "control" / "claude-settings.json",
        denied_roots=(private_root, _git_root(manifest.source_path.parent), Path.home()),
        allowed_tools=allowed_tools,
        forwarder=forwarder,
        memorix_cli=cli_path,
        event_log=hook_event_log,
        data_dir=data_dir,
        home_dir=memorix_home,
    )
    execution = run_agent(
        agent="claude",
        workspace=workspace,
        prompt=prompt,
        artifact_dir=private_root / "agent",
        model=selected_model,
        timeout_seconds=timeout_seconds,
        max_budget_usd=max_budget_usd,
        environment=environment,
        allowed_tools=allowed_tools,
        settings_path=settings_path,
        controlled=True,
        claude_bare=False,
        claude_setting_sources="user",
        claude_permission_mode="acceptEdits",
    )
    if not execution.completed or execution.returncode != 0 or execution.timed_out:
        raise NativeClientCaptureError(
            "native precursor client did not complete successfully; raw diagnostics were retained"
        )
    if set(execution.reported_models) != {selected_model}:
        raise NativeClientCaptureError(
            "native precursor client did not retain the requested single-model route"
        )
    command_violations = audit_bash_commands(execution.bash_commands, workspace=workspace)
    if command_violations:
        raise NativeClientCaptureError(
            "native precursor client attempted a disallowed command: "
            + "; ".join(command_violations)
        )
    _commit_agent_workspace(workspace)
    try:
        observed_snapshot = workspace_snapshot_hash(workspace)
    except WorkerProtocolError as error:
        raise NativeClientCaptureError("captured precursor workspace cannot be attested") from error
    if observed_snapshot != expected_snapshot:
        raise NativeClientCaptureError(
            "native precursor edit does not match the predeclared precursor patch"
        )
    if not hook_event_log.is_file() or not hook_event_log.read_bytes().strip():
        raise NativeClientCaptureError("native precursor client produced no captured hook events")

    try:
        capture = write_native_hook_capture(
            events_path=hook_event_log,
            output_path=output_path,
            case_id=manifest.case_id,
            capture_id=selected_capture_id,
            client_version=client_version,
            capture_mode=CAPTURE_MODE,
            workspace=workspace,
            workspace_snapshot_sha256=observed_snapshot,
            storage_probe_query=storage_probe_query,
        )
    except NativeHookCaptureError as error:
        raise NativeClientCaptureError("native hook event capture is invalid") from error
    _verify_portable_output(output_path, sensitive_values=_secret_values(provider_env))
    _require_edit_or_write_hook(capture, output_path=output_path)
    try:
        formation = ingest_memorix_native_hook_capture(
            capture=capture,
            workspace=workspace,
            cli_path=cli_path,
            data_dir=private_root / "replay-memorix-data",
            home_dir=private_root / "replay-memorix-home",
            artifact_dir=private_root / "replay-artifacts",
        )
    except NativeHookCaptureError as error:
        raise NativeClientCaptureError("native hook capture did not form searchable Memorix state") from error
    receipt = formation.get("formation_receipt")
    if not isinstance(receipt, dict) or receipt.get("surface") != "native-session":
        raise NativeClientCaptureError("native hook formation returned an invalid receipt")
    return NativeClientCapture(
        case_id=manifest.case_id,
        capture_id=selected_capture_id,
        requested_model=selected_model,
        client_version=client_version,
        workspace_snapshot_sha256=observed_snapshot,
        workspace=workspace,
        expected_workspace=expected_workspace,
        private_artifact_root=private_root,
        portable_capture_path=output_path,
        execution=execution,
        capture=capture,
        formation_receipt=receipt,
    )
