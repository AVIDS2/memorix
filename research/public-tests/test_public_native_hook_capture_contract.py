import json
from pathlib import Path

from memorixbench.native_hook_capture import (
    NATIVE_HOOK_CAPTURE_SCHEMA_VERSION,
    PORTABLE_WORKSPACE_TOKEN,
    load_native_hook_capture,
)


def test_public_native_hook_capture_contract_is_portable(tmp_path: Path) -> None:
    path = tmp_path / "native-hook-capture.json"
    path.write_text(json.dumps({
        "schema_version": NATIVE_HOOK_CAPTURE_SCHEMA_VERSION,
        "case_id": "public-native-hook-contract",
        "capture_id": "capture-a",
        "agent": "claude",
        "client_version": "claude-code-public-contract",
        "capture_mode": "local-diagnostic-v1",
        "workspace_snapshot_sha256": "a" * 64,
        "redaction_profile": "workspace-token-v1",
        "storage_probe": {
            "query": "public-native-hook-marker",
            "minimum_candidate_refs": 1,
        },
        "events": [{
            "sequence": 0,
            "event_name": "PostToolUse",
            "payload": {
                "session_id": "public-session",
                "cwd": PORTABLE_WORKSPACE_TOKEN,
                "hook_event_name": "PostToolUse",
                "tool_name": "Write",
                "tool_input": {
                    "file_path": f"{PORTABLE_WORKSPACE_TOKEN}/src/example.ts",
                    "content": "export const publicNativeHookMarker = true;",
                },
                "tool_response": {"success": True},
            },
        }],
    }), encoding="utf-8")

    capture = load_native_hook_capture(path, case_id="public-native-hook-contract")

    assert capture.agent == "claude"
    assert capture.events[0].payload["cwd"] == PORTABLE_WORKSPACE_TOKEN
    assert len(capture.canonical_sha256) == 64
