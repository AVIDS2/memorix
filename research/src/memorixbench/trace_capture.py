from __future__ import annotations

from collections import Counter
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
from typing import Iterable, Literal
from uuid import uuid4

from .actions import ActionLedgerError, load_timed_events
from .public_safety import PublicSafetyError, reject_public_text, sanitize_public_text
from .trace import PrecursorEvent, TraceError, canonical_trace_sha256, write_canonical_trace


TRACE_CAPTURE_RECEIPT_SCHEMA_VERSION = "captured-trace-receipt-v2"
VALID_AGENTS = {"claude", "codex"}
VALID_CAPTURE_MODES = {"local-diagnostic-v1", "isolated-worker-v1"}
VALID_TOOL_RESULT_MODES = {"verbatim", "metadata-only"}
IDENTIFIER_PATTERN = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
SHA256_PATTERN = re.compile(r"^[0-9a-f]{64}$")
TIMELINE_BINDING = "stdout-concatenation-v1"
CLAUDE_SYSTEM_SUBTYPES = {"init", "thinking_tokens"}
CODEX_NON_CONTENT_EVENT_TYPES = {
    "thread.started",
    "turn.started",
    "turn.completed",
    "item.started",
}
TOOL_RESULT_CONTENT_OMITTED = "<tool output omitted from public trace>"


class TraceCaptureError(ValueError):
    """Raised when raw client events cannot become a safe captured trace."""


@dataclass(frozen=True)
class CapturedEvent:
    role: Literal["user", "assistant", "tool"]
    kind: Literal["message", "tool_call", "tool_result"]
    content: str
    tool_name: str | None = None
    tool_call_id: str | None = None


@dataclass(frozen=True)
class TraceCaptureReceipt:
    schema_version: str
    capture_id: str
    case_id: str
    agent: str
    requested_model: str | None
    reported_models: tuple[str, ...]
    client_version: str
    capture_mode: str
    workspace_snapshot_sha256: str
    raw_events_sha256: str
    raw_timeline_sha256: str
    timeline_record_count: int
    timeline_binding: str
    canonical_trace_sha256: str
    trace_source_sha256: str
    raw_event_count: int
    raw_event_type_counts: tuple[tuple[str, int], ...]
    omitted_event_counts: tuple[tuple[str, int], ...]
    trace_event_count: int
    redaction_count: int
    captured_at_utc: str

    def public_payload(self) -> dict[str, object]:
        payload = asdict(self)
        payload["raw_event_type_counts"] = dict(self.raw_event_type_counts)
        payload["omitted_event_counts"] = dict(self.omitted_event_counts)
        return payload


def _required_text(value: object, *, label: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise TraceCaptureError(f"trace capture {label} must be a non-empty string")
    return value.strip()


def _identifier(value: object, *, label: str) -> str:
    text = _required_text(value, label=label)
    if not IDENTIFIER_PATTERN.fullmatch(text):
        raise TraceCaptureError(f"trace capture {label} must be a lowercase hyphenated id")
    return text


def _sha256(value: object, *, label: str) -> str:
    text = _required_text(value, label=label)
    if not SHA256_PATTERN.fullmatch(text):
        raise TraceCaptureError(f"trace capture {label} must be a lowercase SHA-256")
    return text


def _json_text(value: object) -> str:
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":"))


def _content_text(value: object) -> str:
    if isinstance(value, str):
        return value
    if isinstance(value, list):
        pieces: list[str] = []
        for item in value:
            if isinstance(item, dict) and isinstance(item.get("text"), str):
                pieces.append(str(item["text"]))
            else:
                pieces.append(_json_text(item))
        return "\n".join(pieces)
    return _json_text(value)


def _same_captured_text(left: str, right: str) -> bool:
    """Compare terminal client text without treating formatting drift as content."""

    return left.replace("\r\n", "\n").replace("\r", "\n").strip() == (
        right.replace("\r\n", "\n").replace("\r", "\n").strip()
    )


def _read_jsonl(path: Path) -> tuple[bytes, list[dict[str, object]]]:
    try:
        raw = path.read_bytes()
    except OSError as error:
        raise TraceCaptureError("raw client event stream cannot be read") from error
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError as error:
        raise TraceCaptureError("raw client event stream must be UTF-8") from error
    events: list[dict[str, object]] = []
    for line_number, line in enumerate(text.splitlines(), start=1):
        if not line.strip():
            continue
        try:
            event = json.loads(line)
        except json.JSONDecodeError as error:
            raise TraceCaptureError(
                f"raw client event line {line_number} is not JSON"
            ) from error
        if not isinstance(event, dict):
            raise TraceCaptureError(f"raw client event line {line_number} is not an object")
        events.append(event)
    if not events:
        raise TraceCaptureError("raw client event stream is empty")
    return raw, events


def _claude_events(
    events: Iterable[dict[str, object]],
    prompt: str,
    *,
    tool_result_mode: str,
) -> tuple[tuple[CapturedEvent, ...], tuple[str, ...], tuple[tuple[str, int], ...]]:
    captured: list[CapturedEvent] = [CapturedEvent("user", "message", prompt)]
    tool_names: dict[str, str] = {}
    reported_models: set[str] = set()
    omitted = Counter[str]()
    for event in events:
        raw_model = event.get("model")
        if isinstance(raw_model, str) and raw_model.strip():
            reported_models.add(raw_model.strip())
        message = event.get("message")
        if isinstance(message, dict):
            model = message.get("model")
            if isinstance(model, str) and model.strip():
                reported_models.add(model.strip())
        raw_model_usage = event.get("modelUsage")
        if isinstance(raw_model_usage, dict):
            reported_models.update(
                str(model).strip()
                for model in raw_model_usage
                if isinstance(model, str) and model.strip()
            )
        event_type = event.get("type")
        if event_type == "system":
            subtype = event.get("subtype")
            if subtype not in CLAUDE_SYSTEM_SUBTYPES:
                raise TraceCaptureError(f"unsupported Claude system event subtype: {subtype!r}")
            omitted[f"claude-system:{subtype}"] += 1
            continue
        if event_type == "result":
            result = event.get("result")
            if isinstance(result, str) and result.strip():
                if (
                    captured
                    and captured[-1].role == "assistant"
                    and captured[-1].kind == "message"
                    and _same_captured_text(captured[-1].content, result)
                ):
                    omitted["claude-result-duplicate"] += 1
                else:
                    captured.append(CapturedEvent("assistant", "message", result))
            else:
                omitted["claude-result-empty"] += 1
            continue
        if event_type not in {"assistant", "user"}:
            raise TraceCaptureError(f"unsupported Claude raw event type: {event_type!r}")
        if not isinstance(message, dict):
            raise TraceCaptureError("Claude assistant or user event has no message object")
        content = message.get("content")
        if not isinstance(content, list):
            raise TraceCaptureError("Claude assistant or user event has no content list")
        for item in content:
            if not isinstance(item, dict):
                raise TraceCaptureError("Claude message content item is not an object")
            item_type = item.get("type")
            if item_type == "text" and isinstance(item.get("text"), str) and item["text"].strip():
                role: Literal["user", "assistant"] = "assistant" if event_type == "assistant" else "user"
                text = str(item["text"])
                captured.append(CapturedEvent(role, "message", text))
                continue
            if item_type == "thinking":
                omitted["claude-content:thinking"] += 1
                continue
            if item_type == "tool_use":
                tool_name = _required_text(item.get("name"), label="Claude tool name")
                tool_call_id = _required_text(item.get("id"), label="Claude tool call id")
                if tool_call_id in tool_names:
                    raise TraceCaptureError("Claude raw stream repeats a tool call id")
                tool_names[tool_call_id] = tool_name
                captured.append(CapturedEvent(
                    "assistant",
                    "tool_call",
                    _json_text(item.get("input", {})),
                    tool_name=tool_name,
                    tool_call_id=tool_call_id,
                ))
                continue
            if item_type == "tool_result":
                tool_call_id = _required_text(item.get("tool_use_id"), label="Claude tool result id")
                if tool_call_id not in tool_names:
                    raise TraceCaptureError("Claude tool result has no preceding tool call")
                if tool_result_mode == "metadata-only":
                    tool_result_content = TOOL_RESULT_CONTENT_OMITTED
                    omitted["claude-tool-result-content"] += 1
                else:
                    tool_result_content = _content_text(item.get("content", "<empty tool result>"))
                captured.append(CapturedEvent(
                    "tool",
                    "tool_result",
                    tool_result_content,
                    tool_call_id=tool_call_id,
                ))
                continue
            raise TraceCaptureError(f"unsupported Claude content item type: {item_type!r}")
    return (
        tuple(captured),
        tuple(sorted(reported_models)),
        tuple(sorted(omitted.items())),
    )


def _codex_events(
    events: Iterable[dict[str, object]],
    prompt: str,
    *,
    tool_result_mode: str,
) -> tuple[tuple[CapturedEvent, ...], tuple[str, ...], tuple[tuple[str, int], ...]]:
    captured: list[CapturedEvent] = [CapturedEvent("user", "message", prompt)]
    reported_models: set[str] = set()
    tool_index = 0
    omitted = Counter[str]()
    for event in events:
        model = event.get("model")
        if isinstance(model, str) and model.strip():
            reported_models.add(model.strip())
        event_type = event.get("type")
        if event_type in CODEX_NON_CONTENT_EVENT_TYPES:
            omitted[f"codex-event:{event_type}"] += 1
            continue
        if event_type != "item.completed":
            raise TraceCaptureError(f"unsupported Codex raw event type: {event_type!r}")
        item = event.get("item")
        if not isinstance(item, dict):
            raise TraceCaptureError("Codex completed event has no item object")
        item_type = item.get("type")
        if item_type == "agent_message":
            text = item.get("text")
            if isinstance(text, str) and text.strip():
                captured.append(CapturedEvent("assistant", "message", text))
            else:
                omitted["codex-item:agent-message-empty"] += 1
            continue
        if item_type == "reasoning":
            omitted["codex-item:reasoning"] += 1
            continue
        if item_type not in {
            "command_execution",
            "mcp_tool_call",
            "web_search",
            "file_change",
            "file_edit",
        }:
            raise TraceCaptureError(f"unsupported Codex completed item type: {item_type!r}")
        tool_index += 1
        tool_call_id = f"codex-tool-{tool_index}"
        if item_type == "command_execution":
            tool_name = "shell"
            tool_input: object = {"command": item.get("command", "<omitted command>")}
            tool_output: object = {
                "output": item.get("aggregated_output", item.get("output", "<completed>")),
                "exit_code": item.get("exit_code"),
            }
        else:
            raw_name = item.get("tool") or item.get("name")
            tool_name = str(raw_name) if isinstance(raw_name, str) and raw_name else item_type
            tool_input = item.get("arguments", item.get("input", {}))
            tool_output = item.get("result", item.get("output", "<completed>"))
        captured.append(CapturedEvent(
            "assistant",
            "tool_call",
            _json_text(tool_input),
            tool_name=tool_name,
            tool_call_id=tool_call_id,
        ))
        if tool_result_mode == "metadata-only":
            tool_result_content = TOOL_RESULT_CONTENT_OMITTED
            omitted["codex-tool-result-content"] += 1
        else:
            tool_result_content = _content_text(tool_output)
        captured.append(CapturedEvent(
            "tool",
            "tool_result",
            tool_result_content,
            tool_call_id=tool_call_id,
        ))
    return (
        tuple(captured),
        tuple(sorted(reported_models)),
        tuple(sorted(omitted.items())),
    )


def _sanitize_content(content: str, *, workspace_roots: Iterable[Path]) -> tuple[str, int]:
    try:
        return sanitize_public_text(content, workspace_roots=workspace_roots)
    except PublicSafetyError as error:
        raise TraceCaptureError(str(error)) from error


def _safe_metadata(value: str | None, *, label: str) -> str | None:
    if value is None:
        return None
    try:
        reject_public_text(value)
    except PublicSafetyError as error:
        raise TraceCaptureError(f"trace capture {label} is unsafe") from error
    return value


def _to_trace_events(
    captured: Iterable[CapturedEvent],
    *,
    capture_id: str,
    workspace_roots: Iterable[Path],
) -> tuple[tuple[PrecursorEvent, ...], int]:
    trace_events: list[PrecursorEvent] = []
    redaction_count = 0
    turn = 0
    for index, event in enumerate(captured):
        if index and event.role == "user" and event.kind == "message":
            turn += 1
        content, redactions = _sanitize_content(event.content, workspace_roots=workspace_roots)
        redaction_count += redactions
        tool_name = _safe_metadata(event.tool_name, label="tool_name")
        tool_call_id = _safe_metadata(event.tool_call_id, label="tool_call_id")
        trace_events.append(PrecursorEvent(
            event_id=f"{capture_id}-event-{index + 1}",
            session_id=capture_id,
            sequence=index,
            turn=turn,
            role=event.role,
            kind=event.kind,
            content=content,
            tool_name=tool_name,
            tool_call_id=tool_call_id,
        ))
    return tuple(trace_events), redaction_count


def _read_and_validate_timeline(
    path: Path,
    *,
    raw_events: bytes,
) -> tuple[bytes, int]:
    try:
        raw_timeline = path.read_bytes()
    except OSError as error:
        raise TraceCaptureError("raw client timeline cannot be read") from error
    try:
        records = load_timed_events(path)
    except ActionLedgerError as error:
        raise TraceCaptureError(f"raw client timeline is invalid: {error}") from error
    if not records:
        raise TraceCaptureError("raw client timeline is empty")
    if any(
        later.elapsed_seconds < earlier.elapsed_seconds
        for earlier, later in zip(records, records[1:])
    ):
        raise TraceCaptureError("raw client timeline elapsed times must be non-decreasing")
    try:
        expected_stdout = raw_events.decode("utf-8")
    except UnicodeDecodeError as error:
        raise TraceCaptureError("raw client event stream must be UTF-8") from error
    observed_stdout = "".join(record.line for record in records if record.stream == "stdout")
    if observed_stdout != expected_stdout:
        raise TraceCaptureError(
            "raw client timeline stdout does not reconstruct the captured event stream"
        )
    return raw_timeline, len(records)


def capture_trace_from_streams(
    *,
    events_path: str | Path,
    timeline_path: str | Path,
    case_id: str,
    agent: str,
    prompt: str,
    output_path: str | Path,
    receipt_path: str | Path,
    client_version: str,
    workspace_snapshot_sha256: str,
    workspace_roots: Iterable[str | Path],
    requested_model: str | None = None,
    capture_id: str | None = None,
    capture_mode: str = "local-diagnostic-v1",
    tool_result_mode: str = "verbatim",
    captured_at_utc: str | None = None,
) -> TraceCaptureReceipt:
    if agent not in VALID_AGENTS:
        raise TraceCaptureError("trace capture agent is unsupported")
    if capture_mode not in VALID_CAPTURE_MODES:
        raise TraceCaptureError("trace capture mode is unsupported")
    if capture_mode != "local-diagnostic-v1":
        raise TraceCaptureError(
            "standalone trace capture can only emit local diagnostic receipts"
        )
    if tool_result_mode not in VALID_TOOL_RESULT_MODES:
        raise TraceCaptureError("trace capture tool_result_mode is unsupported")
    case_id = _identifier(case_id, label="case_id")
    selected_capture_id = _identifier(capture_id or f"capture-{uuid4().hex}", label="capture_id")
    prompt = _required_text(prompt, label="prompt")
    client_version = _required_text(client_version, label="client_version")
    workspace_snapshot_sha256 = _sha256(
        workspace_snapshot_sha256,
        label="workspace_snapshot_sha256",
    )
    if requested_model is not None:
        requested_model = _required_text(requested_model, label="requested_model")
    roots = tuple(Path(root).resolve() for root in workspace_roots)
    if not roots:
        raise TraceCaptureError("trace capture needs at least one workspace root")
    raw_events, raw_records = _read_jsonl(Path(events_path).resolve())
    raw_timeline, timeline_record_count = _read_and_validate_timeline(
        Path(timeline_path).resolve(),
        raw_events=raw_events,
    )
    raw_event_type_counts = Counter[str]()
    for event in raw_records:
        event_type = event.get("type")
        if not isinstance(event_type, str) or not event_type.strip():
            raise TraceCaptureError("raw client event has no supported type")
        raw_event_type_counts[event_type] += 1
    if agent == "claude":
        captured, reported_models, omitted_event_counts = _claude_events(
            raw_records,
            prompt,
            tool_result_mode=tool_result_mode,
        )
    else:
        captured, reported_models, omitted_event_counts = _codex_events(
            raw_records,
            prompt,
            tool_result_mode=tool_result_mode,
        )
    trace_events, redaction_count = _to_trace_events(
        captured,
        capture_id=selected_capture_id,
        workspace_roots=roots,
    )
    normalization = (
        "event-normalize-v1"
        if tool_result_mode == "verbatim"
        else "event-normalize-tool-results-omitted-v1"
    )
    canonical_sha256 = canonical_trace_sha256(
        case_id=case_id,
        provenance="captured-session-v1",
        normalization=normalization,
        events=trace_events,
    )
    output = Path(output_path).resolve()
    receipt_target = Path(receipt_path).resolve()
    if output.exists() or receipt_target.exists():
        raise TraceCaptureError("trace capture output or receipt path already exists")
    write_canonical_trace(
        path=output,
        case_id=case_id,
        provenance="captured-session-v1",
        normalization=normalization,
        events=trace_events,
    )
    trace_source_sha256 = hashlib.sha256(output.read_bytes()).hexdigest()
    receipt = TraceCaptureReceipt(
        schema_version=TRACE_CAPTURE_RECEIPT_SCHEMA_VERSION,
        capture_id=selected_capture_id,
        case_id=case_id,
        agent=agent,
        requested_model=requested_model,
        reported_models=reported_models,
        client_version=client_version,
        capture_mode=capture_mode,
        workspace_snapshot_sha256=workspace_snapshot_sha256,
        raw_events_sha256=hashlib.sha256(raw_events).hexdigest(),
        raw_timeline_sha256=hashlib.sha256(raw_timeline).hexdigest(),
        timeline_record_count=timeline_record_count,
        timeline_binding=TIMELINE_BINDING,
        canonical_trace_sha256=canonical_sha256,
        trace_source_sha256=trace_source_sha256,
        raw_event_count=len(raw_records),
        raw_event_type_counts=tuple(sorted(raw_event_type_counts.items())),
        omitted_event_counts=omitted_event_counts,
        trace_event_count=len(trace_events),
        redaction_count=redaction_count,
        captured_at_utc=captured_at_utc or datetime.now(timezone.utc).isoformat(),
    )
    receipt_target.parent.mkdir(parents=True, exist_ok=True)
    with receipt_target.open("w", encoding="utf-8", newline="\n") as handle:
        handle.write(json.dumps(receipt.public_payload(), indent=2, ensure_ascii=False) + "\n")
    return receipt


def _count_map(
    value: object,
    *,
    label: str,
    allow_empty: bool = False,
) -> tuple[tuple[str, int], ...]:
    if not isinstance(value, dict) or (not value and not allow_empty):
        raise TraceCaptureError(f"trace capture receipt {label} is invalid")
    counts: list[tuple[str, int]] = []
    for key, count in value.items():
        if not isinstance(key, str) or not key.strip():
            raise TraceCaptureError(f"trace capture receipt {label} has an invalid key")
        if isinstance(count, bool) or not isinstance(count, int) or count < 0:
            raise TraceCaptureError(f"trace capture receipt {label} has an invalid count")
        counts.append((key, count))
    return tuple(sorted(counts))


def load_trace_capture_receipt(path: str | Path) -> TraceCaptureReceipt:
    source = Path(path).resolve()
    try:
        raw = json.loads(source.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise TraceCaptureError("trace capture receipt cannot be read") from error
    if not isinstance(raw, dict):
        raise TraceCaptureError("trace capture receipt must be an object")
    expected = {
        "schema_version",
        "capture_id",
        "case_id",
        "agent",
        "requested_model",
        "reported_models",
        "client_version",
        "capture_mode",
        "workspace_snapshot_sha256",
        "raw_events_sha256",
        "raw_timeline_sha256",
        "timeline_record_count",
        "timeline_binding",
        "canonical_trace_sha256",
        "trace_source_sha256",
        "raw_event_count",
        "raw_event_type_counts",
        "omitted_event_counts",
        "trace_event_count",
        "redaction_count",
        "captured_at_utc",
    }
    if set(raw) != expected or raw.get("schema_version") != TRACE_CAPTURE_RECEIPT_SCHEMA_VERSION:
        raise TraceCaptureError("trace capture receipt has an unsupported schema")
    agent = _required_text(raw.get("agent"), label="agent")
    if agent not in VALID_AGENTS:
        raise TraceCaptureError("trace capture receipt agent is unsupported")
    capture_mode = _required_text(raw.get("capture_mode"), label="capture_mode")
    if capture_mode not in VALID_CAPTURE_MODES:
        raise TraceCaptureError("trace capture receipt mode is unsupported")
    raw_models = raw.get("reported_models")
    if not isinstance(raw_models, list) or any(not isinstance(item, str) or not item.strip() for item in raw_models):
        raise TraceCaptureError("trace capture receipt reported_models is invalid")
    requested_model = raw.get("requested_model")
    if requested_model is not None and not isinstance(requested_model, str):
        raise TraceCaptureError("trace capture receipt requested_model is invalid")
    counts = ("timeline_record_count", "raw_event_count", "trace_event_count", "redaction_count")
    for label in counts:
        if isinstance(raw.get(label), bool) or not isinstance(raw.get(label), int) or raw[label] < 0:
            raise TraceCaptureError(f"trace capture receipt {label} is invalid")
    timeline_binding = _required_text(raw.get("timeline_binding"), label="timeline_binding")
    if timeline_binding != TIMELINE_BINDING:
        raise TraceCaptureError("trace capture receipt timeline binding is unsupported")
    return TraceCaptureReceipt(
        schema_version=TRACE_CAPTURE_RECEIPT_SCHEMA_VERSION,
        capture_id=_identifier(raw.get("capture_id"), label="capture_id"),
        case_id=_identifier(raw.get("case_id"), label="case_id"),
        agent=agent,
        requested_model=(
            _required_text(requested_model, label="requested_model")
            if requested_model is not None
            else None
        ),
        reported_models=tuple(sorted(str(item).strip() for item in raw_models)),
        client_version=_required_text(raw.get("client_version"), label="client_version"),
        capture_mode=capture_mode,
        workspace_snapshot_sha256=_sha256(raw.get("workspace_snapshot_sha256"), label="workspace_snapshot_sha256"),
        raw_events_sha256=_sha256(raw.get("raw_events_sha256"), label="raw_events_sha256"),
        raw_timeline_sha256=_sha256(raw.get("raw_timeline_sha256"), label="raw_timeline_sha256"),
        timeline_record_count=int(raw["timeline_record_count"]),
        timeline_binding=timeline_binding,
        canonical_trace_sha256=_sha256(raw.get("canonical_trace_sha256"), label="canonical_trace_sha256"),
        trace_source_sha256=_sha256(raw.get("trace_source_sha256"), label="trace_source_sha256"),
        raw_event_count=int(raw["raw_event_count"]),
        raw_event_type_counts=_count_map(raw.get("raw_event_type_counts"), label="raw_event_type_counts"),
        omitted_event_counts=_count_map(
            raw.get("omitted_event_counts"),
            label="omitted_event_counts",
            allow_empty=True,
        ),
        trace_event_count=int(raw["trace_event_count"]),
        redaction_count=int(raw["redaction_count"]),
        captured_at_utc=_required_text(raw.get("captured_at_utc"), label="captured_at_utc"),
    )
