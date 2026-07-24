"""Auditable native Claude Code hook-session formation for MemorixBench.

This module deliberately does not call a normalized trace replay a native
session.  A native capture is a portable, redacted copy of the JSON payloads
that Claude Code actually supplies to command hooks.  The adapter rehydrates
only the declared workspace token, invokes the real ``memorix hook`` command
for every event, and proves that at least one stored observation is searchable
after formation.

The capture may be useful for local diagnostics or a future isolated worker,
but its schema alone never grants an isolated-worker or confirmatory claim.
"""

from __future__ import annotations

from dataclasses import dataclass, replace
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
from typing import Any

from .memorix_adapter import (
    MemorixAdapterError,
    _isolated_process_env,
    retrieve_memorix_canonical,
)
from .public_safety import PublicSafetyError, reject_public_json_payload, reject_public_text
from .worker_protocol import WorkerProtocolError, workspace_snapshot_hash


NATIVE_HOOK_CAPTURE_SCHEMA_VERSION = "native-hook-capture-v1"
NATIVE_HOOK_CAPTURE_AGENT = "claude"
NATIVE_HOOK_REDACTION_PROFILE = "workspace-token-v1"
PORTABLE_WORKSPACE_TOKEN = "<WORKSPACE>"
VALID_CAPTURE_MODES = {"local-diagnostic-v1", "isolated-worker-v1"}
VALID_CLAUDE_HOOK_EVENTS = {
    "SessionStart",
    "UserPromptSubmit",
    "PostToolUse",
    "PreCompact",
    "Stop",
    "SessionEnd",
}
MAX_CAPTURE_BYTES = 8 * 1024 * 1024
MAX_CAPTURE_EVENTS = 2_000
SHA256_PATTERN = re.compile(r"^[0-9a-f]{64}$")
CAPTURE_ID_PATTERN = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
PATH_FIELD_NAMES = {"cwd", "file_path", "filePath", "path"}


class NativeHookCaptureError(ValueError):
    """Raised when a portable native-hook capture is invalid or unsafe."""


@dataclass(frozen=True)
class NativeHookStorageProbe:
    query: str
    minimum_candidate_refs: int


@dataclass(frozen=True)
class NativeHookEvent:
    sequence: int
    event_name: str
    payload: dict[str, object]


@dataclass(frozen=True)
class NativeHookCapture:
    schema_version: str
    case_id: str
    capture_id: str
    agent: str
    client_version: str
    capture_mode: str
    workspace_snapshot_sha256: str
    redaction_profile: str
    storage_probe: NativeHookStorageProbe
    events: tuple[NativeHookEvent, ...]
    source_path: Path
    source_sha256: str
    canonical_sha256: str


def _sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def _sha256_payload(value: object) -> str:
    return _sha256_bytes(
        json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    )


def _text(value: object, *, field: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise NativeHookCaptureError(f"native hook capture {field} must be a non-empty string")
    return value.strip()


def _sha256(value: object, *, field: str) -> str:
    digest = _text(value, field=field)
    if not SHA256_PATTERN.fullmatch(digest):
        raise NativeHookCaptureError(f"native hook capture {field} must be a lowercase SHA-256")
    return digest


def _non_negative_int(value: object, *, field: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise NativeHookCaptureError(f"native hook capture {field} must be a non-negative integer")
    return value


def _positive_int(value: object, *, field: str) -> int:
    parsed = _non_negative_int(value, field=field)
    if parsed == 0:
        raise NativeHookCaptureError(f"native hook capture {field} must be positive")
    return parsed


def _reject_unsafe_payload(payload: dict[str, object]) -> None:
    if "transcript_path" in payload or "transcriptPath" in payload:
        raise NativeHookCaptureError(
            "portable native hook captures must remove private transcript paths"
        )
    try:
        reject_public_json_payload(payload)
    except PublicSafetyError as error:
        raise NativeHookCaptureError("native hook payload is not safe for portable capture") from error


def _event(raw: object, *, index: int) -> NativeHookEvent:
    if not isinstance(raw, dict):
        raise NativeHookCaptureError(f"native hook capture event {index} must be an object")
    if set(raw) != {"sequence", "event_name", "payload"}:
        raise NativeHookCaptureError(f"native hook capture event {index} has unexpected fields")
    sequence = _non_negative_int(raw.get("sequence"), field=f"event {index}.sequence")
    event_name = _text(raw.get("event_name"), field=f"event {index}.event_name")
    if event_name not in VALID_CLAUDE_HOOK_EVENTS:
        raise NativeHookCaptureError(f"native hook capture event {index} has unsupported hook event")
    payload = raw.get("payload")
    if not isinstance(payload, dict):
        raise NativeHookCaptureError(f"native hook capture event {index}.payload must be an object")
    copied_payload = dict(payload)
    if _text(copied_payload.get("hook_event_name"), field=f"event {index}.payload.hook_event_name") != event_name:
        raise NativeHookCaptureError(f"native hook capture event {index} event name disagrees with payload")
    _text(copied_payload.get("session_id"), field=f"event {index}.payload.session_id")
    if copied_payload.get("cwd") != PORTABLE_WORKSPACE_TOKEN:
        raise NativeHookCaptureError(
            f"native hook capture event {index}.payload.cwd must equal {PORTABLE_WORKSPACE_TOKEN}"
        )
    if event_name == "PostToolUse":
        _text(copied_payload.get("tool_name"), field=f"event {index}.payload.tool_name")
        if not isinstance(copied_payload.get("tool_input"), dict):
            raise NativeHookCaptureError(
                f"native hook capture event {index}.payload.tool_input must be an object"
            )
    _reject_unsafe_payload(copied_payload)
    return NativeHookEvent(sequence=sequence, event_name=event_name, payload=copied_payload)


def _canonical_payload(capture: NativeHookCapture) -> dict[str, object]:
    return {
        "schema_version": capture.schema_version,
        "case_id": capture.case_id,
        "capture_id": capture.capture_id,
        "agent": capture.agent,
        "client_version": capture.client_version,
        "capture_mode": capture.capture_mode,
        "workspace_snapshot_sha256": capture.workspace_snapshot_sha256,
        "redaction_profile": capture.redaction_profile,
        "storage_probe": {
            "query": capture.storage_probe.query,
            "minimum_candidate_refs": capture.storage_probe.minimum_candidate_refs,
        },
        "events": [
            {
                "sequence": event.sequence,
                "event_name": event.event_name,
                "payload": event.payload,
            }
            for event in capture.events
        ],
    }


def load_native_hook_capture(
    path: str | Path,
    *,
    case_id: str | None = None,
) -> NativeHookCapture:
    """Load a portable Claude Code hook capture without accepting raw paths."""

    source = Path(path).resolve()
    if not source.is_file():
        raise NativeHookCaptureError("native hook capture path is unavailable")
    raw_bytes = source.read_bytes()
    if len(raw_bytes) > MAX_CAPTURE_BYTES:
        raise NativeHookCaptureError("native hook capture exceeds the size limit")
    try:
        raw = json.loads(raw_bytes.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise NativeHookCaptureError("native hook capture must be UTF-8 JSON") from error
    if not isinstance(raw, dict):
        raise NativeHookCaptureError("native hook capture must be an object")
    expected_fields = {
        "schema_version",
        "case_id",
        "capture_id",
        "agent",
        "client_version",
        "capture_mode",
        "workspace_snapshot_sha256",
        "redaction_profile",
        "storage_probe",
        "events",
    }
    if set(raw) != expected_fields:
        raise NativeHookCaptureError("native hook capture has unexpected fields")
    schema_version = _text(raw.get("schema_version"), field="schema_version")
    if schema_version != NATIVE_HOOK_CAPTURE_SCHEMA_VERSION:
        raise NativeHookCaptureError("native hook capture schema version is unsupported")
    parsed_case_id = _text(raw.get("case_id"), field="case_id")
    if case_id is not None and parsed_case_id != case_id:
        raise NativeHookCaptureError("native hook capture case id does not match the case")
    capture_id = _text(raw.get("capture_id"), field="capture_id")
    if not CAPTURE_ID_PATTERN.fullmatch(capture_id):
        raise NativeHookCaptureError("native hook capture id must be lowercase kebab-case")
    agent = _text(raw.get("agent"), field="agent")
    if agent != NATIVE_HOOK_CAPTURE_AGENT:
        raise NativeHookCaptureError("native hook capture currently supports Claude Code only")
    client_version = _text(raw.get("client_version"), field="client_version")
    capture_mode = _text(raw.get("capture_mode"), field="capture_mode")
    if capture_mode not in VALID_CAPTURE_MODES:
        raise NativeHookCaptureError("native hook capture mode is unsupported")
    snapshot = _sha256(raw.get("workspace_snapshot_sha256"), field="workspace_snapshot_sha256")
    redaction_profile = _text(raw.get("redaction_profile"), field="redaction_profile")
    if redaction_profile != NATIVE_HOOK_REDACTION_PROFILE:
        raise NativeHookCaptureError("native hook capture redaction profile is unsupported")
    raw_probe = raw.get("storage_probe")
    if not isinstance(raw_probe, dict) or set(raw_probe) != {"query", "minimum_candidate_refs"}:
        raise NativeHookCaptureError("native hook capture storage_probe has unexpected fields")
    probe_query = _text(raw_probe.get("query"), field="storage_probe.query")
    try:
        reject_public_text(probe_query)
    except PublicSafetyError as error:
        raise NativeHookCaptureError("native hook capture storage probe is not public-safe") from error
    storage_probe = NativeHookStorageProbe(
        query=probe_query,
        minimum_candidate_refs=_positive_int(
            raw_probe.get("minimum_candidate_refs"),
            field="storage_probe.minimum_candidate_refs",
        ),
    )
    raw_events = raw.get("events")
    if not isinstance(raw_events, list) or not raw_events:
        raise NativeHookCaptureError("native hook capture requires at least one event")
    if len(raw_events) > MAX_CAPTURE_EVENTS:
        raise NativeHookCaptureError("native hook capture has too many events")
    events = tuple(_event(item, index=index) for index, item in enumerate(raw_events, start=1))
    if [event.sequence for event in events] != list(range(len(events))):
        raise NativeHookCaptureError("native hook capture event sequences must start at zero and be contiguous")
    capture = NativeHookCapture(
        schema_version=schema_version,
        case_id=parsed_case_id,
        capture_id=capture_id,
        agent=agent,
        client_version=client_version,
        capture_mode=capture_mode,
        workspace_snapshot_sha256=snapshot,
        redaction_profile=redaction_profile,
        storage_probe=storage_probe,
        events=events,
        source_path=source,
        source_sha256=_sha256_bytes(raw_bytes),
        canonical_sha256="",
    )
    return replace(
        capture,
        canonical_sha256=_sha256_payload(_canonical_payload(capture)),
    )


def _same_path(left: Path, right: Path) -> bool:
    if os.name == "nt":
        return str(left).casefold() == str(right).casefold()
    return left == right


def _is_under_workspace(candidate: Path, workspace: Path) -> bool:
    resolved = candidate.resolve()
    return _same_path(resolved, workspace) or any(
        _same_path(parent, workspace) for parent in resolved.parents
    )


def _portable_workspace_path(value: str, *, workspace: Path, key: str) -> str:
    candidate = Path(value)
    if not candidate.is_absolute():
        raise NativeHookCaptureError(f"native hook payload {key} must be an absolute workspace path")
    resolved = candidate.resolve()
    if not _is_under_workspace(resolved, workspace):
        raise NativeHookCaptureError(f"native hook payload {key} escapes the capture workspace")
    relative = os.path.relpath(resolved, workspace).replace("\\", "/")
    return PORTABLE_WORKSPACE_TOKEN if relative == "." else f"{PORTABLE_WORKSPACE_TOKEN}/{relative}"


def _portable_value(value: object, *, workspace: Path, key: str | None = None) -> object:
    if isinstance(value, str):
        if key in PATH_FIELD_NAMES:
            return _portable_workspace_path(value, workspace=workspace, key=key)
        return value
    if isinstance(value, list):
        return [_portable_value(item, workspace=workspace) for item in value]
    if isinstance(value, dict):
        return {
            str(item_key): _portable_value(item_value, workspace=workspace, key=str(item_key))
            for item_key, item_value in value.items()
            if item_key not in {"transcript_path", "transcriptPath"}
        }
    return value


def _require_workspace_snapshot(workspace: Path, expected_sha256: str) -> None:
    try:
        observed_sha256 = workspace_snapshot_hash(workspace)
    except WorkerProtocolError as error:
        raise NativeHookCaptureError("native hook workspace snapshot cannot be attested") from error
    if observed_sha256 != expected_sha256:
        raise NativeHookCaptureError("native hook capture workspace snapshot does not match")


def write_native_hook_capture(
    *,
    events_path: str | Path,
    output_path: str | Path,
    case_id: str,
    capture_id: str,
    client_version: str,
    capture_mode: str,
    workspace: str | Path,
    workspace_snapshot_sha256: str,
    storage_probe_query: str,
    minimum_candidate_refs: int = 1,
) -> NativeHookCapture:
    """Sanitize private Claude hook JSONL into one portable capture file.

    Each input line is either an original Claude hook payload or a wrapper
    object containing exactly ``sequence`` and ``payload``. The raw JSONL is
    never copied to the output. This converter is intentionally a local
    controller operation; callers must keep its source event file private.
    """

    source = Path(events_path).resolve()
    target = Path(output_path).resolve()
    workspace_path = Path(workspace).resolve()
    if not source.is_file():
        raise NativeHookCaptureError("native hook event stream is unavailable")
    if target.exists():
        raise NativeHookCaptureError("native hook capture output already exists")
    if not workspace_path.is_dir() or not (workspace_path / ".git").exists():
        raise NativeHookCaptureError("native hook capture requires a Git workspace")
    _require_workspace_snapshot(workspace_path, workspace_snapshot_sha256)
    raw_bytes = source.read_bytes()
    if len(raw_bytes) > MAX_CAPTURE_BYTES:
        raise NativeHookCaptureError("native hook event stream exceeds the size limit")
    try:
        raw_text = raw_bytes.decode("utf-8")
    except UnicodeDecodeError as error:
        raise NativeHookCaptureError("native hook event stream must be UTF-8 JSONL") from error
    raw_events: list[dict[str, object]] = []
    for line_number, line in enumerate(raw_text.splitlines(), start=1):
        if not line.strip():
            continue
        try:
            line_payload = json.loads(line)
        except json.JSONDecodeError as error:
            raise NativeHookCaptureError(
                f"native hook event stream line {line_number} is not JSON"
            ) from error
        if not isinstance(line_payload, dict):
            raise NativeHookCaptureError(
                f"native hook event stream line {line_number} must be an object"
            )
        if set(line_payload) == {"sequence", "payload"}:
            sequence = _non_negative_int(
                line_payload.get("sequence"),
                field=f"event stream line {line_number}.sequence",
            )
            payload = line_payload.get("payload")
            if not isinstance(payload, dict):
                raise NativeHookCaptureError(
                    f"native hook event stream line {line_number}.payload must be an object"
                )
        else:
            sequence = len(raw_events)
            payload = line_payload
        portable = _portable_value(payload, workspace=workspace_path)
        if not isinstance(portable, dict):
            raise NativeHookCaptureError("portable native hook payload is invalid")
        event_name = _text(
            portable.get("hook_event_name"),
            field=f"event stream line {line_number}.hook_event_name",
        )
        raw_events.append({
            "sequence": sequence,
            "event_name": event_name,
            "payload": portable,
        })
    if not raw_events:
        raise NativeHookCaptureError("native hook event stream has no events")
    payload: dict[str, object] = {
        "schema_version": NATIVE_HOOK_CAPTURE_SCHEMA_VERSION,
        "case_id": case_id,
        "capture_id": capture_id,
        "agent": NATIVE_HOOK_CAPTURE_AGENT,
        "client_version": client_version,
        "capture_mode": capture_mode,
        "workspace_snapshot_sha256": workspace_snapshot_sha256,
        "redaction_profile": NATIVE_HOOK_REDACTION_PROFILE,
        "storage_probe": {
            "query": storage_probe_query,
            "minimum_candidate_refs": minimum_candidate_refs,
        },
        "events": raw_events,
    }
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    try:
        return load_native_hook_capture(target, case_id=case_id)
    except NativeHookCaptureError:
        target.unlink(missing_ok=True)
        raise


def _rehydrate_value(value: object, *, workspace: Path, key: str | None = None) -> object:
    if isinstance(value, str):
        hydrated = value.replace(PORTABLE_WORKSPACE_TOKEN, workspace.as_posix())
        if key in PATH_FIELD_NAMES and Path(hydrated).is_absolute():
            if not _is_under_workspace(Path(hydrated), workspace):
                raise NativeHookCaptureError("rehydrated native hook path escapes the workspace")
        return hydrated
    if isinstance(value, list):
        return [_rehydrate_value(item, workspace=workspace) for item in value]
    if isinstance(value, dict):
        return {
            str(item_key): _rehydrate_value(item_value, workspace=workspace, key=str(item_key))
            for item_key, item_value in value.items()
        }
    return value


def rehydrate_native_hook_payload(event: NativeHookEvent, *, workspace: str | Path) -> dict[str, object]:
    """Substitute the only permitted path token into a validated hook payload."""

    workspace_path = Path(workspace).resolve()
    if not workspace_path.is_dir() or not (workspace_path / ".git").exists():
        raise NativeHookCaptureError("native hook formation requires a Git workspace")
    hydrated = _rehydrate_value(event.payload, workspace=workspace_path)
    if not isinstance(hydrated, dict):
        raise NativeHookCaptureError("rehydrated native hook payload is invalid")
    raw_cwd = hydrated.get("cwd")
    if not isinstance(raw_cwd, str) or not _same_path(Path(raw_cwd).resolve(), workspace_path):
        raise NativeHookCaptureError("rehydrated native hook cwd does not match the workspace")
    return hydrated


def _parse_hook_output(value: str, *, sequence: int) -> dict[str, object]:
    try:
        payload = json.loads(value)
    except json.JSONDecodeError as error:
        raise NativeHookCaptureError(
            f"native hook event {sequence} produced non-JSON stdout"
        ) from error
    if not isinstance(payload, dict) or payload.get("continue") is not True:
        raise NativeHookCaptureError(f"native hook event {sequence} did not acknowledge continuation")
    return payload


def ingest_memorix_native_hook_capture(
    *,
    capture: NativeHookCapture,
    workspace: str | Path,
    cli_path: str | Path,
    data_dir: str | Path,
    home_dir: str | Path,
    artifact_dir: str | Path,
    hook_timeout_seconds: int = 10,
) -> dict[str, object]:
    """Form Memorix state by invoking the real CLI hook for each captured event."""

    if hook_timeout_seconds <= 0:
        raise NativeHookCaptureError("native hook timeout must be positive")
    workspace_path = Path(workspace).resolve()
    cli = Path(cli_path).resolve()
    data = Path(data_dir).resolve()
    home = Path(home_dir).resolve()
    artifacts = Path(artifact_dir).resolve()
    if not cli.is_file():
        raise NativeHookCaptureError("native hook formation CLI is unavailable")
    if not workspace_path.is_dir() or not (workspace_path / ".git").exists():
        raise NativeHookCaptureError("native hook formation requires a Git workspace")
    _require_workspace_snapshot(workspace_path, capture.workspace_snapshot_sha256)
    node = shutil.which("node")
    if not node:
        raise FileNotFoundError("node is required for native hook formation")
    data.mkdir(parents=True, exist_ok=True)
    home.mkdir(parents=True, exist_ok=True)
    artifacts.mkdir(parents=True, exist_ok=True)
    environment = _isolated_process_env(None)
    environment.update({
        "MEMORIX_DATA_DIR": str(data),
        "MEMORIX_EMBEDDING": "off",
        "HOME": str(home),
        "USERPROFILE": str(home),
    })
    creationflags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
    event_audit: list[dict[str, object]] = []
    saved_signal_count = 0
    for event in capture.events:
        payload = rehydrate_native_hook_payload(event, workspace=workspace_path)
        completed = subprocess.run(
            [node, str(cli), "hook", "--agent", capture.agent],
            cwd=workspace_path,
            env=environment,
            input=json.dumps(payload, ensure_ascii=False),
            text=True,
            encoding="utf-8",
            capture_output=True,
            timeout=hook_timeout_seconds,
            check=False,
            creationflags=creationflags,
        )
        if completed.returncode != 0:
            raise NativeHookCaptureError(
                f"native hook event {event.sequence} exited with {completed.returncode}"
            )
        output = _parse_hook_output(completed.stdout, sequence=event.sequence)
        system_message = output.get("systemMessage")
        if isinstance(system_message, str) and "Memorix saved:" in system_message:
            saved_signal_count += 1
        event_audit.append({
            "sequence": event.sequence,
            "event_name": event.event_name,
            "stdout_sha256": _sha256_bytes(completed.stdout.encode("utf-8")),
            "stderr_sha256": _sha256_bytes(completed.stderr.encode("utf-8")),
            "saved_signal": isinstance(system_message, str) and "Memorix saved:" in system_message,
        })
    try:
        verification = retrieve_memorix_canonical(
            workspace=workspace_path,
            cli_path=cli,
            data_dir=data,
            home_dir=home,
            artifact_dir=artifacts,
            query=capture.storage_probe.query,
            top_k=max(1, capture.storage_probe.minimum_candidate_refs),
            token_budget=512,
        )
    except (MemorixAdapterError, OSError, RuntimeError, TimeoutError, ValueError) as error:
        raise NativeHookCaptureError("native hook formation storage probe failed") from error
    candidate_count = len(verification.candidate_refs)
    if candidate_count < capture.storage_probe.minimum_candidate_refs:
        raise NativeHookCaptureError("native hook formation storage probe found too few observations")
    event_audit_text = json.dumps(event_audit, indent=2)
    receipt: dict[str, object] = {
        "surface": "native-session",
        "capture_schema_version": capture.schema_version,
        "capture_source_sha256": capture.source_sha256,
        "capture_sha256": capture.canonical_sha256,
        "capture_id": capture.capture_id,
        "capture_mode": capture.capture_mode,
        "agent": capture.agent,
        "client_version": capture.client_version,
        "workspace_snapshot_sha256": capture.workspace_snapshot_sha256,
        "event_count": len(capture.events),
        "hook_event_audit_sha256": _sha256_bytes(event_audit_text.encode("utf-8")),
        "write_operation_count": saved_signal_count,
        "transport_call_count": len(capture.events) + verification.transport_call_count,
        "maintenance_call_count": 0,
        "record_count": candidate_count,
        "storage_probe_query_sha256": _sha256_bytes(capture.storage_probe.query.encode("utf-8")),
        "storage_probe_candidate_count": candidate_count,
    }
    (artifacts / "native-hook-event-audit.json").write_text(
        event_audit_text, encoding="utf-8"
    )
    (artifacts / "native-hook-formation-receipt.json").write_text(
        json.dumps(receipt, indent=2), encoding="utf-8"
    )
    return {
        "capture": {
            "capture_id": capture.capture_id,
            "capture_sha256": capture.canonical_sha256,
            "capture_source_sha256": capture.source_sha256,
            "capture_mode": capture.capture_mode,
        },
        "maintenance": {
            "poll_count": 0,
            "settled_for_retrieval": True,
            "mode": "deferred-after-synchronous-hook-v1",
        },
        "formation_receipt": receipt,
    }
