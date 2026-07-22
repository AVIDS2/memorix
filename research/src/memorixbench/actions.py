from __future__ import annotations

from dataclasses import asdict, dataclass
import hashlib
import json
from pathlib import Path
from typing import Any, Iterable, Literal


ACTION_LEDGER_SCHEMA_VERSION = "0.1"
ACTION_TIMING_SOURCE = "stream-observed-monotonic-v1"
ActionKind = Literal["command", "edit", "read", "tool_call", "other"]


class ActionLedgerError(ValueError):
    """Raised when an agent event timeline cannot support auditable labeling."""


@dataclass(frozen=True)
class TimedEvent:
    sequence: int
    stream: Literal["stdout", "stderr"]
    elapsed_seconds: float
    line: str


@dataclass(frozen=True)
class AgentAction:
    action_id: str
    event_sequence: int
    elapsed_seconds: float
    kind: ActionKind
    tool_name: str | None
    detail: str | None
    detail_sha256: str | None
    successful: bool | None


@dataclass(frozen=True)
class ActionLedger:
    schema_version: str
    agent: str
    timing_source: str
    timeline_sha256: str
    actions: tuple[AgentAction, ...]

    @property
    def sha256(self) -> str:
        return _sha256_payload(asdict(self))


def _sha256_text(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _sha256_payload(value: object) -> str:
    return _sha256_text(json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False))


def _file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_timed_events(path: str | Path) -> tuple[TimedEvent, ...]:
    source = Path(path)
    records: list[TimedEvent] = []
    for number, line in enumerate(source.read_text(encoding="utf-8").splitlines(), 1):
        try:
            raw = json.loads(line)
        except json.JSONDecodeError as error:
            raise ActionLedgerError(f"event timeline line {number} is not JSON") from error
        if not isinstance(raw, dict):
            raise ActionLedgerError(f"event timeline line {number} must be an object")
        sequence = raw.get("sequence")
        elapsed = raw.get("elapsed_seconds")
        stream = raw.get("stream")
        content = raw.get("line")
        if isinstance(sequence, bool) or not isinstance(sequence, int) or sequence < 0:
            raise ActionLedgerError(f"event timeline line {number} has an invalid sequence")
        if isinstance(elapsed, bool) or not isinstance(elapsed, (int, float)) or elapsed < 0:
            raise ActionLedgerError(f"event timeline line {number} has an invalid elapsed time")
        if stream not in {"stdout", "stderr"}:
            raise ActionLedgerError(f"event timeline line {number} has an invalid stream")
        if not isinstance(content, str):
            raise ActionLedgerError(f"event timeline line {number} has an invalid line")
        records.append(TimedEvent(
            sequence=sequence,
            stream=stream,
            elapsed_seconds=float(elapsed),
            line=content,
        ))
    if [record.sequence for record in records] != list(range(len(records))):
        raise ActionLedgerError("event timeline sequences must be contiguous from zero")
    return tuple(records)


def _json_payload(record: TimedEvent) -> dict[str, object] | None:
    if record.stream != "stdout" or not record.line.strip():
        return None
    try:
        value = json.loads(record.line)
    except json.JSONDecodeError:
        return None
    return value if isinstance(value, dict) else None


def _detail(value: object) -> tuple[str | None, str | None]:
    if value is None:
        return None, None
    if isinstance(value, str):
        text = value
    else:
        text = json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
    return text, _sha256_text(text)


def _kind_for_tool(name: str) -> ActionKind:
    if name == "Bash":
        return "command"
    if name in {"Edit", "Write", "NotebookEdit", "apply_patch"}:
        return "edit"
    if name in {"Read", "Glob", "Grep", "Search"}:
        return "read"
    return "tool_call"


def _append_action(
    actions: list[dict[str, object]],
    *,
    record: TimedEvent,
    kind: ActionKind,
    tool_name: str | None,
    detail_value: object,
    successful: bool | None,
) -> None:
    detail, detail_sha256 = _detail(detail_value)
    actions.append({
        "event_sequence": record.sequence,
        "elapsed_seconds": record.elapsed_seconds,
        "kind": kind,
        "tool_name": tool_name,
        "detail": detail,
        "detail_sha256": detail_sha256,
        "successful": successful,
    })


def _extract_claude_actions(records: Iterable[TimedEvent]) -> list[dict[str, object]]:
    actions: list[dict[str, object]] = []
    pending: dict[str, int] = {}
    for record in records:
        event = _json_payload(record)
        if event is None:
            continue
        message = event.get("message")
        if not isinstance(message, dict):
            continue
        content = message.get("content")
        if not isinstance(content, list):
            continue
        for item in content:
            if not isinstance(item, dict):
                continue
            if item.get("type") == "tool_use":
                name = item.get("name")
                tool_name = name if isinstance(name, str) and name else None
                tool_input = item.get("input")
                detail_value = (
                    tool_input.get("command")
                    if tool_name == "Bash" and isinstance(tool_input, dict)
                    else tool_input
                )
                _append_action(
                    actions,
                    record=record,
                    kind=_kind_for_tool(tool_name or ""),
                    tool_name=tool_name,
                    detail_value=detail_value,
                    successful=None,
                )
                tool_use_id = item.get("id")
                if isinstance(tool_use_id, str):
                    pending[tool_use_id] = len(actions) - 1
            elif item.get("type") == "tool_result":
                tool_use_id = item.get("tool_use_id")
                if isinstance(tool_use_id, str) and tool_use_id in pending:
                    actions[pending[tool_use_id]]["successful"] = not bool(item.get("is_error", False))
    return actions


def _codex_detail(item: dict[str, object]) -> object:
    for key in ("command", "input", "arguments", "path", "text"):
        value = item.get(key)
        if value is not None:
            return value
    return item


def _extract_codex_actions(records: Iterable[TimedEvent]) -> list[dict[str, object]]:
    actions: list[dict[str, object]] = []
    for record in records:
        event = _json_payload(record)
        if event is None or event.get("type") != "item.completed":
            continue
        item = event.get("item")
        if not isinstance(item, dict):
            continue
        item_type = item.get("type")
        if item_type == "command_execution":
            _append_action(
                actions,
                record=record,
                kind="command",
                tool_name="Bash",
                detail_value=_codex_detail(item),
                successful=item.get("exit_code") in {None, 0},
            )
        elif item_type in {"mcp_tool_call", "web_search"}:
            name = item.get("tool") or item.get("name")
            tool_name = name if isinstance(name, str) and name else None
            _append_action(
                actions,
                record=record,
                kind=_kind_for_tool(tool_name or ""),
                tool_name=tool_name,
                detail_value=_codex_detail(item),
                successful=True,
            )
        elif item_type in {"file_change", "file_edit"}:
            _append_action(
                actions,
                record=record,
                kind="edit",
                tool_name=None,
                detail_value=_codex_detail(item),
                successful=True,
            )
    return actions


def build_action_ledger(
    *,
    agent: str,
    records: Iterable[TimedEvent],
    timeline_sha256: str,
) -> ActionLedger:
    materialized = tuple(records)
    if agent == "claude":
        raw_actions = _extract_claude_actions(materialized)
    elif agent == "codex":
        raw_actions = _extract_codex_actions(materialized)
    else:
        raise ActionLedgerError(f"unsupported agent action format: {agent}")
    actions = tuple(
        AgentAction(action_id=f"a{index:04d}", **raw)
        for index, raw in enumerate(raw_actions, 1)
    )
    return ActionLedger(
        schema_version=ACTION_LEDGER_SCHEMA_VERSION,
        agent=agent,
        timing_source=ACTION_TIMING_SOURCE,
        timeline_sha256=timeline_sha256,
        actions=actions,
    )


def write_action_ledger(
    *,
    agent: str,
    timeline_path: str | Path,
    path: str | Path,
) -> ActionLedger:
    source = Path(timeline_path)
    ledger = build_action_ledger(
        agent=agent,
        records=load_timed_events(source),
        timeline_sha256=_file_sha256(source),
    )
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps({
        **asdict(ledger),
        "sha256": ledger.sha256,
    }, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return ledger


def load_action_ledger(path: str | Path) -> ActionLedger:
    source = Path(path)
    try:
        raw = json.loads(source.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise ActionLedgerError("action ledger cannot be read") from error
    if not isinstance(raw, dict):
        raise ActionLedgerError("action ledger must be an object")
    expected = {
        "schema_version",
        "agent",
        "timing_source",
        "timeline_sha256",
        "actions",
        "sha256",
    }
    if set(raw) != expected:
        raise ActionLedgerError("action ledger has unexpected fields")
    if raw.get("schema_version") != ACTION_LEDGER_SCHEMA_VERSION:
        raise ActionLedgerError("unsupported action ledger schema version")
    if raw.get("timing_source") != ACTION_TIMING_SOURCE:
        raise ActionLedgerError("unsupported action ledger timing source")
    if raw.get("agent") not in {"claude", "codex"}:
        raise ActionLedgerError("action ledger has an unsupported agent")
    timeline_sha256 = raw.get("timeline_sha256")
    if not isinstance(timeline_sha256, str) or len(timeline_sha256) != 64:
        raise ActionLedgerError("action ledger has an invalid timeline hash")
    raw_actions = raw.get("actions")
    if not isinstance(raw_actions, list):
        raise ActionLedgerError("action ledger actions must be an array")
    actions: list[AgentAction] = []
    for index, value in enumerate(raw_actions, 1):
        if not isinstance(value, dict):
            raise ActionLedgerError("action ledger action must be an object")
        expected_id = f"a{index:04d}"
        if value.get("action_id") != expected_id:
            raise ActionLedgerError("action ledger action ids must be contiguous")
        sequence = value.get("event_sequence")
        elapsed = value.get("elapsed_seconds")
        kind = value.get("kind")
        tool_name = value.get("tool_name")
        detail = value.get("detail")
        detail_sha256 = value.get("detail_sha256")
        successful = value.get("successful")
        if isinstance(sequence, bool) or not isinstance(sequence, int) or sequence < 0:
            raise ActionLedgerError("action ledger has an invalid event sequence")
        if isinstance(elapsed, bool) or not isinstance(elapsed, (int, float)) or elapsed < 0:
            raise ActionLedgerError("action ledger has an invalid elapsed time")
        if kind not in {"command", "edit", "read", "tool_call", "other"}:
            raise ActionLedgerError("action ledger has an invalid action kind")
        if tool_name is not None and not isinstance(tool_name, str):
            raise ActionLedgerError("action ledger has an invalid tool name")
        if detail is not None and not isinstance(detail, str):
            raise ActionLedgerError("action ledger has an invalid detail")
        if detail is None:
            if detail_sha256 is not None:
                raise ActionLedgerError("action ledger detail hash does not match a missing detail")
        elif not isinstance(detail_sha256, str) or detail_sha256 != _sha256_text(detail):
            raise ActionLedgerError("action ledger detail hash does not match")
        if successful is not None and not isinstance(successful, bool):
            raise ActionLedgerError("action ledger has an invalid success state")
        actions.append(AgentAction(
            action_id=expected_id,
            event_sequence=sequence,
            elapsed_seconds=float(elapsed),
            kind=kind,
            tool_name=tool_name,
            detail=detail,
            detail_sha256=detail_sha256,
            successful=successful,
        ))
    if any(
        later.event_sequence < earlier.event_sequence
        or later.elapsed_seconds < earlier.elapsed_seconds
        for earlier, later in zip(actions, actions[1:])
    ):
        raise ActionLedgerError("action ledger actions must remain in observed order")
    ledger = ActionLedger(
        schema_version=ACTION_LEDGER_SCHEMA_VERSION,
        agent=raw["agent"],
        timing_source=ACTION_TIMING_SOURCE,
        timeline_sha256=timeline_sha256,
        actions=tuple(actions),
    )
    if raw.get("sha256") != ledger.sha256:
        raise ActionLedgerError("action ledger commitment does not match")
    return ledger
