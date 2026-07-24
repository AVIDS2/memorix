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
    event_text = "".join(json.dumps(record) + "\n" for record in records)
    events.write_bytes(event_text.encode("utf-8"))
    timeline.write_bytes(
        "".join(
            json.dumps({
                "sequence": index,
                "stream": "stdout",
                "elapsed_seconds": float(index),
                "line": json.dumps(record) + "\n",
            }) + "\n"
            for index, record in enumerate(records)
        ).encode("utf-8"),
    )
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
    assert receipt.timeline_binding == "stdout-concatenation-v1"
    assert receipt.timeline_record_count == 3
    assert "super-secret-value" not in text
    assert "API_KEY=" not in text
    assert workspace.as_posix() not in text
    assert "<WORKSPACE>" in text
    assert b"\r\n" not in output.read_bytes()
    assert b"\r\n" not in receipt_path.read_bytes()
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


def test_captures_a_pi_json_stream_with_paired_tool_events(tmp_path: Path) -> None:
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    records = [
        {"type": "session", "version": 3, "id": "session-1"},
        {"type": "agent_start"},
        {
            "type": "tool_execution_start",
            "toolCallId": "read-1",
            "toolName": "read",
            "args": {"path": "README.md"},
        },
        {
            "type": "tool_execution_end",
            "toolCallId": "read-1",
            "toolName": "read",
            "result": {"content": [{"type": "text", "text": "policy"}]},
            "isError": False,
        },
        {
            "type": "turn_end",
            "message": {
                "role": "assistant",
                "provider": "openrouter",
                "model": "qwen/qwen3-coder-30b-a3b-instruct",
                "content": [
                    {"type": "toolCall", "name": "read"},
                    {"type": "text", "text": "The policy is clear."},
                ],
            },
        },
        {"type": "agent_end", "messages": []},
    ]
    events = tmp_path / "events.jsonl"
    timeline = tmp_path / "timeline.jsonl"
    events.write_bytes("".join(json.dumps(record) + "\n" for record in records).encode("utf-8"))
    timeline.write_bytes("".join(
        json.dumps({
            "sequence": index,
            "stream": "stdout",
            "elapsed_seconds": float(index),
            "line": json.dumps(record) + "\n",
        }) + "\n"
        for index, record in enumerate(records)
    ).encode("utf-8"))

    receipt = capture_trace_from_streams(
        events_path=events,
        timeline_path=timeline,
        case_id="capture-case",
        agent="pi",
        prompt="Review the retained project policy.",
        output_path=tmp_path / "trace.json",
        receipt_path=tmp_path / "receipt.json",
        client_version="pi-0.79.0",
        workspace_snapshot_sha256="b" * 64,
        workspace_roots=(workspace,),
        capture_id="capture-test-pi",
    )

    payload = json.loads((tmp_path / "trace.json").read_text(encoding="utf-8"))
    assert receipt.reported_models == ("openrouter/qwen/qwen3-coder-30b-a3b-instruct",)
    assert [event["kind"] for event in payload["events"]] == [
        "message",
        "tool_call",
        "tool_result",
        "message",
    ]
    assert payload["events"][1]["tool_name"] == "read"
    assert dict(receipt.omitted_event_counts)["pi-content:toolCall"] == 1


def test_metadata_only_capture_omits_claude_tool_output(tmp_path: Path) -> None:
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
        workspace_snapshot_sha256="c" * 64,
        workspace_roots=(workspace,),
        capture_id="capture-test-metadata-only",
        tool_result_mode="metadata-only",
    )

    payload = json.loads(output.read_text(encoding="utf-8"))

    assert payload["normalization"] == "event-normalize-tool-results-omitted-v1"
    assert payload["events"][3]["content"] == "<tool output omitted from public trace>"
    assert dict(receipt.omitted_event_counts)["claude-tool-result-content"] == 1
    assert "super-secret-value" not in output.read_text(encoding="utf-8")


def test_capture_omits_a_duplicate_claude_terminal_result(tmp_path: Path) -> None:
    workspace, events, timeline, prompt = _write_capture_inputs(tmp_path, agent="claude")
    records = [
        {
            "type": "assistant",
            "message": {"content": [{"type": "text", "text": "Short handoff."}]},
        },
        {"type": "result", "result": "Short handoff."},
    ]
    events.write_bytes("".join(json.dumps(record) + "\n" for record in records).encode("utf-8"))
    timeline.write_bytes("".join(
        json.dumps({
            "sequence": index,
            "stream": "stdout",
            "elapsed_seconds": float(index),
            "line": json.dumps(record) + "\n",
        }) + "\n"
        for index, record in enumerate(records)
    ).encode("utf-8"))

    receipt = capture_trace_from_streams(
        events_path=events,
        timeline_path=timeline,
        case_id="capture-case",
        agent="claude",
        prompt=prompt.read_text(encoding="utf-8"),
        output_path=tmp_path / "trace.json",
        receipt_path=tmp_path / "receipt.json",
        client_version="test-client-1",
        workspace_snapshot_sha256="f" * 64,
        workspace_roots=(workspace,),
    )

    payload = json.loads((tmp_path / "trace.json").read_text(encoding="utf-8"))
    assert receipt.trace_event_count == 2
    assert dict(receipt.omitted_event_counts)["claude-result-duplicate"] == 1
    assert [event["content"] for event in payload["events"]] == [
        "Review the retained project policy.",
        "Short handoff.",
    ]


def test_capture_rejects_unsafe_tool_metadata(tmp_path: Path) -> None:
    workspace, events, timeline, prompt = _write_capture_inputs(tmp_path, agent="claude")
    records = [
        {
            "type": "assistant",
            "message": {
                "content": [{
                    "type": "tool_use",
                    "id": "tool-1",
                    "name": "C:\\Users\\private\\tool",
                    "input": {},
                }],
            },
        },
    ]
    events.write_bytes("".join(json.dumps(record) + "\n" for record in records).encode("utf-8"))
    timeline.write_bytes("".join(
        json.dumps({
            "sequence": index,
            "stream": "stdout",
            "elapsed_seconds": float(index),
            "line": json.dumps(record) + "\n",
        }) + "\n"
        for index, record in enumerate(records)
    ).encode("utf-8"))

    with pytest.raises(TraceCaptureError, match="tool_name is unsafe"):
        capture_trace_from_streams(
            events_path=events,
            timeline_path=timeline,
            case_id="capture-case",
            agent="claude",
            prompt=prompt.read_text(encoding="utf-8"),
            output_path=tmp_path / "trace.json",
            receipt_path=tmp_path / "receipt.json",
            client_version="test-client-1",
            workspace_snapshot_sha256="0" * 64,
            workspace_roots=(workspace,),
        )


def test_standalone_capture_cannot_self_label_as_isolated(tmp_path: Path) -> None:
    workspace, events, timeline, prompt = _write_capture_inputs(tmp_path, agent="claude")

    with pytest.raises(TraceCaptureError, match="only emit local diagnostic"):
        capture_trace_from_streams(
            events_path=events,
            timeline_path=timeline,
            case_id="capture-case",
            agent="claude",
            prompt=prompt.read_text(encoding="utf-8"),
            output_path=tmp_path / "trace.json",
            receipt_path=tmp_path / "receipt.json",
            client_version="test-client-1",
            workspace_snapshot_sha256="1" * 64,
            workspace_roots=(workspace,),
            capture_mode="isolated-worker-v1",
        )


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


def test_capture_rejects_a_timeline_that_does_not_reconstruct_stdout(tmp_path: Path) -> None:
    workspace, events, timeline, prompt = _write_capture_inputs(tmp_path, agent="claude")
    timeline.write_text(
        json.dumps({
            "sequence": 0,
            "stream": "stdout",
            "elapsed_seconds": 0.0,
            "line": "{}\n",
        }) + "\n",
        encoding="utf-8",
    )

    with pytest.raises(TraceCaptureError, match="does not reconstruct"):
        capture_trace_from_streams(
            events_path=events,
            timeline_path=timeline,
            case_id="capture-case",
            agent="claude",
            prompt=prompt.read_text(encoding="utf-8"),
            output_path=tmp_path / "trace.json",
            receipt_path=tmp_path / "receipt.json",
            client_version="test-client-1",
            workspace_snapshot_sha256="d" * 64,
            workspace_roots=(workspace,),
        )


def test_capture_redacts_full_windows_and_unc_paths(tmp_path: Path) -> None:
    workspace, events, timeline, prompt = _write_capture_inputs(tmp_path, agent="claude")
    record = {
        "type": "assistant",
        "message": {
            "model": "test-model",
            "content": [{
                "type": "text",
                "text": "Inspect C:\\Users\\Alice Example\\repo and \\\\server\\share\\secret.txt.",
            }],
        },
    }
    events.write_bytes((json.dumps(record) + "\n").encode("utf-8"))
    timeline.write_bytes(
        (json.dumps({
            "sequence": 0,
            "stream": "stdout",
            "elapsed_seconds": 0.0,
            "line": json.dumps(record) + "\n",
        }) + "\n").encode("utf-8")
    )
    output = tmp_path / "trace.json"

    capture_trace_from_streams(
        events_path=events,
        timeline_path=timeline,
        case_id="capture-case",
        agent="claude",
        prompt=prompt.read_text(encoding="utf-8"),
        output_path=output,
        receipt_path=tmp_path / "receipt.json",
        client_version="test-client-1",
        workspace_snapshot_sha256="e" * 64,
        workspace_roots=(workspace,),
    )

    payload = output.read_text(encoding="utf-8")
    assert "Alice Example" not in payload
    assert "server\\share" not in payload
    assert "<ABSOLUTE_PATH>" in payload
