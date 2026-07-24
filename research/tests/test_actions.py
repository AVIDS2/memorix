import json
from pathlib import Path

import pytest

from memorixbench.actions import (
    ActionLedgerError,
    TimedEvent,
    build_action_ledger,
    load_action_ledger,
    write_action_ledger,
)


def _write_timeline(path: Path, rows: list[dict[str, object]]) -> None:
    path.write_text(
        "".join(json.dumps(row) + "\n" for row in rows),
        encoding="utf-8",
    )


def test_claude_action_ledger_links_tool_results_and_preserves_time(tmp_path: Path) -> None:
    timeline = tmp_path / "timeline.jsonl"
    _write_timeline(timeline, [
        {
            "sequence": 0,
            "stream": "stdout",
            "elapsed_seconds": 1.5,
            "line": json.dumps({
                "type": "assistant",
                "message": {"content": [{
                    "type": "tool_use",
                    "id": "bash-1",
                    "name": "Bash",
                    "input": {"command": "npm test"},
                }]},
            }) + "\n",
        },
        {
            "sequence": 1,
            "stream": "stdout",
            "elapsed_seconds": 2.0,
            "line": json.dumps({
                "type": "user",
                "message": {"content": [{
                    "type": "tool_result",
                    "tool_use_id": "bash-1",
                    "is_error": False,
                    "content": "passed",
                }]},
            }) + "\n",
        },
        {
            "sequence": 2,
            "stream": "stdout",
            "elapsed_seconds": 3.0,
            "line": json.dumps({
                "type": "assistant",
                "message": {"content": [{
                    "type": "tool_use",
                    "id": "edit-1",
                    "name": "Edit",
                    "input": {"file_path": "src/retry.ts", "old_string": "old", "new_string": "new"},
                }]},
            }) + "\n",
        },
    ])

    ledger = write_action_ledger(
        agent="claude",
        timeline_path=timeline,
        path=tmp_path / "action-ledger.json",
    )

    assert [(action.action_id, action.kind, action.successful) for action in ledger.actions] == [
        ("a0001", "command", True),
        ("a0002", "edit", None),
    ]
    assert ledger.actions[0].elapsed_seconds == 1.5
    assert ledger.actions[0].detail == "npm test"
    assert len(ledger.actions[0].detail_sha256 or "") == 64
    assert load_action_ledger(tmp_path / "action-ledger.json") == ledger


def test_codex_action_ledger_records_command_and_mcp_actions() -> None:
    records = (
        TimedEvent(
            sequence=0,
            stream="stdout",
            elapsed_seconds=0.5,
            line=json.dumps({
                "type": "item.completed",
                "item": {"type": "command_execution", "command": "go test ./...", "exit_code": 0},
            }) + "\n",
        ),
        TimedEvent(
            sequence=1,
            stream="stdout",
            elapsed_seconds=1.5,
            line=json.dumps({
                "type": "item.completed",
                "item": {"type": "mcp_tool_call", "tool": "memorix_search", "arguments": {"query": "retry"}},
            }) + "\n",
        ),
    )

    ledger = build_action_ledger(
        agent="codex",
        records=records,
        timeline_sha256="a" * 64,
    )

    assert [(action.kind, action.tool_name) for action in ledger.actions] == [
        ("command", "Bash"),
        ("tool_call", "memorix_search"),
    ]
    assert all(action.successful is True for action in ledger.actions)


def test_pi_action_ledger_links_lowercase_tool_events() -> None:
    records = (
        TimedEvent(
            sequence=0,
            stream="stdout",
            elapsed_seconds=0.5,
            line=json.dumps({
                "type": "tool_execution_start",
                "toolCallId": "bash-1",
                "toolName": "bash",
                "args": {"command": "go test ./..."},
            }) + "\n",
        ),
        TimedEvent(
            sequence=1,
            stream="stdout",
            elapsed_seconds=1.0,
            line=json.dumps({
                "type": "tool_execution_end",
                "toolCallId": "bash-1",
                "toolName": "bash",
                "result": {"content": [{"type": "text", "text": "ok"}]},
                "isError": False,
            }) + "\n",
        ),
        TimedEvent(
            sequence=2,
            stream="stdout",
            elapsed_seconds=1.5,
            line=json.dumps({
                "type": "tool_execution_start",
                "toolCallId": "read-1",
                "toolName": "read",
                "args": {"path": "README.md"},
            }) + "\n",
        ),
    )

    ledger = build_action_ledger(
        agent="pi",
        records=records,
        timeline_sha256="b" * 64,
    )

    assert [(action.kind, action.tool_name, action.successful) for action in ledger.actions] == [
        ("command", "bash", True),
        ("read", "read", None),
    ]


def test_action_ledger_rejects_noncontiguous_timeline(tmp_path: Path) -> None:
    timeline = tmp_path / "timeline.jsonl"
    _write_timeline(timeline, [{
        "sequence": 2,
        "stream": "stdout",
        "elapsed_seconds": 1.0,
        "line": "{}\n",
    }])

    with pytest.raises(ActionLedgerError, match="contiguous"):
        write_action_ledger(
            agent="claude",
            timeline_path=timeline,
            path=tmp_path / "action-ledger.json",
        )
