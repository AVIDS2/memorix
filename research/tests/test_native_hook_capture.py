import json
from pathlib import Path
import subprocess

import pytest

from memorixbench.baseline import build_retrieval
from memorixbench.memorix_adapter import MemorixCanonicalRetrieval
from memorixbench.native_hook_capture import (
    NATIVE_HOOK_CAPTURE_SCHEMA_VERSION,
    NativeHookCaptureError,
    ingest_memorix_native_hook_capture,
    load_native_hook_capture,
    rehydrate_native_hook_payload,
    write_native_hook_capture,
)
from memorixbench.worker_protocol import workspace_snapshot_hash


def _capture_payload(snapshot_sha256: str = "a" * 64) -> dict[str, object]:
    return {
        "schema_version": NATIVE_HOOK_CAPTURE_SCHEMA_VERSION,
        "case_id": "native-hook-case",
        "capture_id": "capture-a",
        "agent": "claude",
        "client_version": "claude-code-test",
        "capture_mode": "local-diagnostic-v1",
        "workspace_snapshot_sha256": snapshot_sha256,
        "redaction_profile": "workspace-token-v1",
        "storage_probe": {
            "query": "native-hook-probe-marker",
            "minimum_candidate_refs": 1,
        },
        "events": [
            {
                "sequence": 0,
                "event_name": "PostToolUse",
                "payload": {
                    "session_id": "session-a",
                    "cwd": "<WORKSPACE>",
                    "hook_event_name": "PostToolUse",
                    "tool_name": "Write",
                    "tool_input": {
                        "file_path": "<WORKSPACE>/src/example.ts",
                        "content": "export const marker = 'native-hook-probe-marker';",
                    },
                    "tool_response": {"success": True},
                },
            }
        ],
    }


def _write_capture(path: Path, payload: dict[str, object] | None = None) -> Path:
    path.write_text(json.dumps(payload or _capture_payload()), encoding="utf-8")
    return path


def _git_workspace(path: Path) -> Path:
    path.mkdir()
    subprocess.run(["git", "init", "--quiet"], cwd=path, check=True)
    return path


def test_loads_portable_native_hook_capture(tmp_path: Path) -> None:
    capture = load_native_hook_capture(
        _write_capture(tmp_path / "capture.json"),
        case_id="native-hook-case",
    )

    assert capture.capture_id == "capture-a"
    assert capture.events[0].event_name == "PostToolUse"
    assert len(capture.canonical_sha256) == 64


def test_rejects_private_transcript_path_in_native_capture(tmp_path: Path) -> None:
    payload = _capture_payload()
    event = payload["events"][0]
    assert isinstance(event, dict)
    event_payload = event["payload"]
    assert isinstance(event_payload, dict)
    event_payload["transcript_path"] = "<WORKSPACE>/private.jsonl"

    with pytest.raises(NativeHookCaptureError, match="transcript paths"):
        load_native_hook_capture(_write_capture(tmp_path / "capture.json", payload))


def test_rejects_nonportable_workspace_path(tmp_path: Path) -> None:
    payload = _capture_payload()
    event = payload["events"][0]
    assert isinstance(event, dict)
    event_payload = event["payload"]
    assert isinstance(event_payload, dict)
    event_payload["cwd"] = "C:/private/workspace"

    with pytest.raises(NativeHookCaptureError, match="cwd must equal"):
        load_native_hook_capture(_write_capture(tmp_path / "capture.json", payload))


def test_rehydrates_workspace_token_only_inside_git_workspace(tmp_path: Path) -> None:
    capture = load_native_hook_capture(_write_capture(tmp_path / "capture.json"))
    workspace = _git_workspace(tmp_path / "workspace")

    payload = rehydrate_native_hook_payload(capture.events[0], workspace=workspace)

    assert payload["cwd"] == workspace.as_posix()
    tool_input = payload["tool_input"]
    assert isinstance(tool_input, dict)
    assert tool_input["file_path"] == f"{workspace.as_posix()}/src/example.ts"


def test_writes_portable_capture_from_private_hook_jsonl(tmp_path: Path) -> None:
    workspace = _git_workspace(tmp_path / "workspace")
    raw_events = tmp_path / "private-events.jsonl"
    raw_events.write_text(
        json.dumps({
            "session_id": "session-a",
            "cwd": str(workspace),
            "transcript_path": str(workspace / ".claude" / "private.jsonl"),
            "hook_event_name": "PostToolUse",
            "tool_name": "Write",
            "tool_input": {
                "file_path": str(workspace / "src" / "example.ts"),
                "content": "export const marker = 'native-hook-probe-marker';",
            },
            "tool_response": {"filePath": str(workspace / "src" / "example.ts"), "success": True},
        }) + "\n",
        encoding="utf-8",
    )

    capture = write_native_hook_capture(
        events_path=raw_events,
        output_path=tmp_path / "portable-capture.json",
        case_id="native-hook-case",
        capture_id="capture-a",
        client_version="claude-code-test",
        capture_mode="local-diagnostic-v1",
        workspace=workspace,
        workspace_snapshot_sha256=workspace_snapshot_hash(workspace),
        storage_probe_query="native-hook-probe-marker",
    )

    payload = capture.events[0].payload
    assert payload["cwd"] == "<WORKSPACE>"
    assert "transcript_path" not in payload
    tool_input = payload["tool_input"]
    assert isinstance(tool_input, dict)
    assert tool_input["file_path"] == "<WORKSPACE>/src/example.ts"
    assert str(workspace) not in (tmp_path / "portable-capture.json").read_text(encoding="utf-8")


def test_rejects_private_hook_event_with_outside_workspace_path(tmp_path: Path) -> None:
    workspace = _git_workspace(tmp_path / "workspace")
    raw_events = tmp_path / "private-events.jsonl"
    raw_events.write_text(
        json.dumps({
            "session_id": "session-a",
            "cwd": str(workspace),
            "hook_event_name": "PostToolUse",
            "tool_name": "Write",
            "tool_input": {"file_path": str(tmp_path / "outside.ts"), "content": "marker"},
            "tool_response": {"success": True},
        }) + "\n",
        encoding="utf-8",
    )

    with pytest.raises(NativeHookCaptureError, match="escapes the capture workspace"):
        write_native_hook_capture(
            events_path=raw_events,
            output_path=tmp_path / "portable-capture.json",
            case_id="native-hook-case",
            capture_id="capture-a",
            client_version="claude-code-test",
            capture_mode="local-diagnostic-v1",
            workspace=workspace,
            workspace_snapshot_sha256=workspace_snapshot_hash(workspace),
            storage_probe_query="native-hook-probe-marker",
        )


def test_native_hook_ingestion_invokes_real_hook_shape_and_requires_probe(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import memorixbench.native_hook_capture as module

    workspace = _git_workspace(tmp_path / "workspace")
    capture = load_native_hook_capture(
        _write_capture(
            tmp_path / "capture.json",
            _capture_payload(workspace_snapshot_hash(workspace)),
        )
    )
    cli = tmp_path / "cli.js"
    cli.write_text("placeholder", encoding="utf-8")
    seen: list[dict[str, object]] = []

    def fake_run(command, **kwargs):
        assert command[-3:] == ["hook", "--agent", "claude"]
        seen.append(json.loads(kwargs["input"]))
        return subprocess.CompletedProcess(
            command,
            0,
            stdout=json.dumps({"continue": True, "systemMessage": "[CHANGE] Memorix saved: Changed example.ts"}),
            stderr="",
        )

    def fake_retrieval(**_kwargs):
        return MemorixCanonicalRetrieval(
            retrieval=build_retrieval(
                provider="memorix-1.2.1-canonical-local",
                provider_version=None,
                query="native-hook-probe-marker",
                records=(),
                token_budget=512,
                retrieval_call_count=1,
                retrieval_round_count=1,
            ),
            candidate_refs=("obs:1@project",),
            transport_call_count=2,
        )

    monkeypatch.setattr(module.shutil, "which", lambda _name: "node")
    monkeypatch.setattr(module, "_require_workspace_snapshot", lambda *_args: None)
    monkeypatch.setattr(module.subprocess, "run", fake_run)
    monkeypatch.setattr(module, "retrieve_memorix_canonical", fake_retrieval)

    result = ingest_memorix_native_hook_capture(
        capture=capture,
        workspace=workspace,
        cli_path=cli,
        data_dir=tmp_path / "data",
        home_dir=tmp_path / "home",
        artifact_dir=tmp_path / "artifact",
    )

    assert seen[0]["cwd"] == workspace.as_posix()
    assert result["formation_receipt"]["surface"] == "native-session"
    assert result["formation_receipt"]["write_operation_count"] == 1
    assert result["formation_receipt"]["record_count"] == 1
    assert len(str(result["formation_receipt"]["hook_event_audit_sha256"])) == 64
    assert result["maintenance"]["mode"] == "deferred-after-synchronous-hook-v1"
    assert (tmp_path / "artifact" / "native-hook-formation-receipt.json").is_file()


def test_native_hook_ingestion_rejects_empty_storage_probe(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import memorixbench.native_hook_capture as module

    workspace = _git_workspace(tmp_path / "workspace")
    capture = load_native_hook_capture(
        _write_capture(
            tmp_path / "capture.json",
            _capture_payload(workspace_snapshot_hash(workspace)),
        )
    )
    cli = tmp_path / "cli.js"
    cli.write_text("placeholder", encoding="utf-8")

    monkeypatch.setattr(module.shutil, "which", lambda _name: "node")
    monkeypatch.setattr(module, "_require_workspace_snapshot", lambda *_args: None)
    monkeypatch.setattr(
        module.subprocess,
        "run",
        lambda command, **_kwargs: subprocess.CompletedProcess(command, 0, stdout='{"continue":true}', stderr=""),
    )
    monkeypatch.setattr(
        module,
        "retrieve_memorix_canonical",
        lambda **_kwargs: MemorixCanonicalRetrieval(
            retrieval=build_retrieval(
                provider="memorix-1.2.1-canonical-local",
                provider_version=None,
                query="native-hook-probe-marker",
                records=(),
                token_budget=512,
                retrieval_call_count=1,
                retrieval_round_count=1,
            ),
            candidate_refs=(),
            transport_call_count=1,
        ),
    )

    with pytest.raises(NativeHookCaptureError, match="too few observations"):
        ingest_memorix_native_hook_capture(
            capture=capture,
            workspace=workspace,
            cli_path=cli,
            data_dir=tmp_path / "data",
            home_dir=tmp_path / "home",
            artifact_dir=tmp_path / "artifact",
        )


def test_rejects_workspace_snapshot_mismatch_before_writing_capture(tmp_path: Path) -> None:
    workspace = _git_workspace(tmp_path / "workspace")
    raw_events = tmp_path / "private-events.jsonl"
    raw_events.write_text(
        json.dumps({
            "session_id": "session-a",
            "cwd": str(workspace),
            "hook_event_name": "SessionStart",
        }) + "\n",
        encoding="utf-8",
    )

    with pytest.raises(NativeHookCaptureError, match="snapshot does not match"):
        write_native_hook_capture(
            events_path=raw_events,
            output_path=tmp_path / "portable-capture.json",
            case_id="native-hook-case",
            capture_id="capture-a",
            client_version="claude-code-test",
            capture_mode="local-diagnostic-v1",
            workspace=workspace,
            workspace_snapshot_sha256="a" * 64,
            storage_probe_query="native-hook-probe-marker",
        )
