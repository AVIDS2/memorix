from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
from typing import Iterable, Literal
from uuid import uuid4

from .trace import PrecursorEvent, TraceError, canonical_trace_sha256, write_canonical_trace


TRACE_CAPTURE_RECEIPT_SCHEMA_VERSION = "captured-trace-receipt-v1"
VALID_AGENTS = {"claude", "codex"}
VALID_CAPTURE_MODES = {"local-diagnostic-v1", "isolated-worker-v1"}
IDENTIFIER_PATTERN = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
SHA256_PATTERN = re.compile(r"^[0-9a-f]{64}$")
SECRET_REDACTIONS = (
    (
        re.compile(r"(?i)(?:api[_-]?key|auth[_-]?token|password|secret)\s*[:=]\s*\S+"),
        "[REDACTED_SECRET]",
    ),
    (re.compile(r"(?i)bearer\s+[a-z0-9._~+/=-]{16,}"), "Bearer [REDACTED]"),
    (re.compile(r"-----BEGIN [A-Z ]+-----"), "[REDACTED_PRIVATE_KEY]"),
    (re.compile(r"(?<![A-Za-z0-9])sk-[A-Za-z0-9_-]{20,}"), "[REDACTED_SECRET]"),
)
ABSOLUTE_PATH_PATTERN = re.compile(r"(?i)(?:[a-z]:[\\/]|\\\\|/Users/|/home/)")


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
    canonical_trace_sha256: str
    trace_source_sha256: str
    raw_event_count: int
    trace_event_count: int
    redaction_count: int
    captured_at_utc: str

    def public_payload(self) -> dict[str, object]:
        return asdict(self)


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


def _claude_events(events: Iterable[dict[str, object]], prompt: str) -> tuple[tuple[CapturedEvent, ...], tuple[str, ...]]:
    captured: list[CapturedEvent] = [CapturedEvent("user", "message", prompt)]
    tool_names: dict[str, str] = {}
    reported_models: set[str] = set()
    assistant_texts: set[str] = set()
    for event in events:
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
        if event_type == "result":
            result = event.get("result")
            if isinstance(result, str) and result.strip() and result not in assistant_texts:
                captured.append(CapturedEvent("assistant", "message", result))
                assistant_texts.add(result)
            continue
        if event_type not in {"assistant", "user"} or not isinstance(message, dict):
            continue
        content = message.get("content")
        if not isinstance(content, list):
            continue
        for item in content:
            if not isinstance(item, dict):
                continue
            item_type = item.get("type")
            if item_type == "text" and isinstance(item.get("text"), str) and item["text"].strip():
                role: Literal["user", "assistant"] = "assistant" if event_type == "assistant" else "user"
                text = str(item["text"])
                captured.append(CapturedEvent(role, "message", text))
                if role == "assistant":
                    assistant_texts.add(text)
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
                captured.append(CapturedEvent(
                    "tool",
                    "tool_result",
                    _content_text(item.get("content", "<empty tool result>")),
                    tool_call_id=tool_call_id,
                ))
    return tuple(captured), tuple(sorted(reported_models))


def _codex_events(events: Iterable[dict[str, object]], prompt: str) -> tuple[tuple[CapturedEvent, ...], tuple[str, ...]]:
    captured: list[CapturedEvent] = [CapturedEvent("user", "message", prompt)]
    reported_models: set[str] = set()
    tool_index = 0
    assistant_texts: set[str] = set()
    for event in events:
        model = event.get("model")
        if isinstance(model, str) and model.strip():
            reported_models.add(model.strip())
        if event.get("type") != "item.completed":
            continue
        item = event.get("item")
        if not isinstance(item, dict):
            continue
        item_type = item.get("type")
        if item_type == "agent_message":
            text = item.get("text")
            if isinstance(text, str) and text.strip():
                captured.append(CapturedEvent("assistant", "message", text))
                assistant_texts.add(text)
            continue
        if item_type not in {"command_execution", "mcp_tool_call", "web_search"}:
            continue
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
        captured.append(CapturedEvent(
            "tool",
            "tool_result",
            _content_text(tool_output),
            tool_call_id=tool_call_id,
        ))
    return tuple(captured), tuple(sorted(reported_models))


def _sanitize_content(content: str, *, workspace_roots: Iterable[Path]) -> tuple[str, int]:
    if "\0" in content:
        raise TraceCaptureError("raw client event content contains a NUL byte")
    sanitized = content.replace("\r\n", "\n").replace("\r", "\n")
    redaction_count = 0
    for root in workspace_roots:
        resolved = root.resolve()
        variants = {str(resolved), resolved.as_posix()}
        for variant in sorted((item for item in variants if item), key=len, reverse=True):
            sanitized, count = re.subn(re.escape(variant), "<WORKSPACE>", sanitized, flags=re.IGNORECASE)
            redaction_count += count
    for pattern, replacement in SECRET_REDACTIONS:
        sanitized, count = pattern.subn(replacement, sanitized)
        redaction_count += count
    sanitized, count = ABSOLUTE_PATH_PATTERN.subn("<ABSOLUTE_PATH>", sanitized)
    redaction_count += count
    if not sanitized.strip():
        raise TraceCaptureError("captured event became empty after redaction")
    return sanitized, redaction_count


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
        trace_events.append(PrecursorEvent(
            event_id=f"{capture_id}-event-{index + 1}",
            session_id=capture_id,
            sequence=index,
            turn=turn,
            role=event.role,
            kind=event.kind,
            content=content,
            tool_name=event.tool_name,
            tool_call_id=event.tool_call_id,
        ))
    return tuple(trace_events), redaction_count


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
    captured_at_utc: str | None = None,
) -> TraceCaptureReceipt:
    if agent not in VALID_AGENTS:
        raise TraceCaptureError("trace capture agent is unsupported")
    if capture_mode not in VALID_CAPTURE_MODES:
        raise TraceCaptureError("trace capture mode is unsupported")
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
    try:
        raw_timeline = Path(timeline_path).resolve().read_bytes()
    except OSError as error:
        raise TraceCaptureError("raw client timeline cannot be read") from error
    if agent == "claude":
        captured, reported_models = _claude_events(raw_records, prompt)
    else:
        captured, reported_models = _codex_events(raw_records, prompt)
    trace_events, redaction_count = _to_trace_events(
        captured,
        capture_id=selected_capture_id,
        workspace_roots=roots,
    )
    canonical_sha256 = canonical_trace_sha256(
        case_id=case_id,
        provenance="captured-session-v1",
        normalization="event-normalize-v1",
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
        normalization="event-normalize-v1",
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
        canonical_trace_sha256=canonical_sha256,
        trace_source_sha256=trace_source_sha256,
        raw_event_count=len(raw_records),
        trace_event_count=len(trace_events),
        redaction_count=redaction_count,
        captured_at_utc=captured_at_utc or datetime.now(timezone.utc).isoformat(),
    )
    receipt_target.parent.mkdir(parents=True, exist_ok=True)
    receipt_target.write_text(
        json.dumps(receipt.public_payload(), indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    return receipt


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
        "canonical_trace_sha256",
        "trace_source_sha256",
        "raw_event_count",
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
    counts = ("raw_event_count", "trace_event_count", "redaction_count")
    for label in counts:
        if isinstance(raw.get(label), bool) or not isinstance(raw.get(label), int) or raw[label] < 0:
            raise TraceCaptureError(f"trace capture receipt {label} is invalid")
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
        canonical_trace_sha256=_sha256(raw.get("canonical_trace_sha256"), label="canonical_trace_sha256"),
        trace_source_sha256=_sha256(raw.get("trace_source_sha256"), label="trace_source_sha256"),
        raw_event_count=int(raw["raw_event_count"]),
        trace_event_count=int(raw["trace_event_count"]),
        redaction_count=int(raw["redaction_count"]),
        captured_at_utc=_required_text(raw.get("captured_at_utc"), label="captured_at_utc"),
    )
