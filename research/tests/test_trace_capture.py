from __future__ import annotations

import json
from pathlib import Path

import pytest

from memorixbench.trace_capture import (
    TraceCaptureError,
    capture_trace_from_streams,
    load_trace_capture_receipt,
)


def _write_capture_inputs(tmp_path: Path, *, agent: str) -> tuple[Path, Path, Path, Path]:
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    events = tmp_path / "events.jsonl"
    timeline = tmp_path / "timeline.jsonl"
    prompt = tmp_path / "prompt.txt"
    if agent == "claude":
        records = [
            {
                "type": "assistant",
                "message": {
                    "model": "test-model",
                    "content": [
                        {"type": "text", "text": f"Inspect {workspace} before editing."},
                        {
                            "type": "tool_use",
                            "id": "tool-1",
                            "name": "Bash",
                            "input": {"command": f"rg token {workspace}"},
                        },
                    ],
                },
            },
            {
                "type": "user",
                "message": {
                    "content": [
                        {
                            "type": "tool_result",
                            "tool_use_id": "tool-1",
                            "content": "API_KEY=super-secret-value",
                        },
                    ],
                },
            },
            {"type": "result", "result": "The retained policy is now clear."},
        ]
    else:
        records = [
            {
                "type": "item.completed",
                "model": "test-model",
                "item": {
                    "type": "command_execution",
                    "command": f"git -C {workspace} status --short",
                    "aggregated_output": "clean",
                    "exit_code": 0,
                },
            },
            {
                "type": "item.completed",
                "item": {"type": "agent_message", "text": "The workspace is clean."},
            },
        ]
    events.write_text(
        "".join(json.dumps(record) + "\n" for record in records),
        encoding="utf-8",
    )
    timeline.write_text("{\"private\":\"timeline\"}\n", encoding="utf-8")
    prompt.write_text("Review the retained project policy.", encoding="utf-8")
    return workspace, events, timeline, prompt


def test_captures_and_redacts_a_claude_stream(tmp_path: Path) -> None:
    workspace, events, timeline, prompt = _write_capture_inputs(tmp_path, agent="claude")
    output = tmp_path / "trace.json"
    receipt_path = tmp_path / "receipt.json"

    receipt = capture_trace_from_streams(
        events_path=events,
        timeline_path=timeline,
        case_id="capture-case",
        agent="claude",
        prompt=prompt.read_text(encoding="utf-8"),
        output_path=output,
        receipt_path=receipt_path,
        client_version="test-client-1",
        workspace_snapshot_sha256="a" * 64,
        workspace_roots=(workspace,),
        requested_model="test-model",
        capture_id="capture-test-one",
        captured_at_utc="2026-07-22T00:00:00+00:00",
    )

    payload = json.loads(output.read_text(encoding="utf-8"))
    text = json.dumps(payload)
    loaded = load_trace_capture_receipt(receipt_path)

    assert receipt.canonical_trace_sha256 == loaded.canonical_trace_sha256
    assert receipt.redaction_count >= 2
    assert receipt.trace_event_count == 5
    assert "super-secret-value" not in text
    assert "API_KEY=" not in text
    assert workspace.as_posix() not in text
    assert "<WORKSPACE>" in text
    assert payload["events"][2]["kind"] == "tool_call"
    assert payload["events"][3]["kind"] == "tool_result"


def test_captures_a_codex_stream_with_paired_tool_events(tmp_path: Path) -> None:
    workspace, events, timeline, prompt = _write_capture_inputs(tmp_path, agent="codex")
    output = tmp_path / "trace.json"
    receipt_path = tmp_path / "receipt.json"

    receipt = capture_trace_from_streams(
        events_path=events,
        timeline_path=timeline,
        case_id="capture-case",
        agent="codex",
        prompt=prompt.read_text(encoding="utf-8"),
        output_path=output,
        receipt_path=receipt_path,
        client_version="test-client-1",
        workspace_snapshot_sha256="b" * 64,
        workspace_roots=(workspace,),
        capture_id="capture-test-two",
    )

    payload = json.loads(output.read_text(encoding="utf-8"))

    assert receipt.trace_event_count == 4
    assert [event["kind"] for event in payload["events"]] == [
        "message",
        "tool_call",
        "tool_result",
        "message",
    ]
    assert payload["events"][1]["tool_name"] == "shell"


def test_capture_rejects_non_json_raw_events(tmp_path: Path) -> None:
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    events = tmp_path / "events.jsonl"
    timeline = tmp_path / "timeline.jsonl"
    events.write_text("not json\n", encoding="utf-8")
    timeline.write_text("{}\n", encoding="utf-8")

    with pytest.raises(TraceCaptureError, match="not JSON"):
        capture_trace_from_streams(
            events_path=events,
            timeline_path=timeline,
            case_id="capture-case",
            agent="claude",
            prompt="Review the policy.",
            output_path=tmp_path / "trace.json",
            receipt_path=tmp_path / "receipt.json",
            client_version="test-client-1",
            workspace_snapshot_sha256="c" * 64,
            workspace_roots=(workspace,),
            capture_id="capture-test-three",
        )
