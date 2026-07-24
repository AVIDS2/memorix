from __future__ import annotations

import json
from dataclasses import replace
from pathlib import Path
import subprocess
from types import SimpleNamespace

import pytest

import memorixbench.native_client_capture as module
from memorixbench.native_client_capture import (
    NativeClientCaptureError,
    capture_native_client_session,
)
from memorixbench.schema import load_case_manifest


def _init_git(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True)
    subprocess.run(["git", "init", "--quiet"], cwd=path, check=True)


def _manifest(tmp_path: Path) -> tuple[Path, object]:
    research_root = tmp_path / "research-root"
    _init_git(research_root)
    case_root = research_root / "cases" / "development" / "native-client-capture-case"
    seed = case_root / "seed" / "src"
    seed.mkdir(parents=True)
    (seed / "sample.ts").write_text("export const marker = false;\n", encoding="utf-8")
    (case_root / "precursor.patch").write_text(
        """diff --git a/src/sample.ts b/src/sample.ts
--- a/src/sample.ts
+++ b/src/sample.ts
@@ -1 +1,2 @@
 export const marker = false;
+// Preserve raw marker before rendering.
""",
        encoding="utf-8",
    )
    (case_root / "case.toml").write_text(
        """
schema_version = "0.5"
id = "native-client-capture-case"
title = "Native client capture fixture"
split = "development"
dependency_strength = "low"
dependency_classification_status = "retrospective-development"
language = "typescript"
tags = ["native", "capture"]

[repository]
source_type = "local-fixture"
path = "seed"
base_revision = "fixture-base"

[precursor]
task = "Add the declared explanatory comment without changing executable code."
success_commands = ["git status --short"]
patch = "precursor.patch"

[transition]
kind = "none"
description = "No transfer transition is needed for the client-capture fixture."
apply_commands = []

[transfer]
task = "Continue the work."
success_commands = ["git status --short"]

[formation]
track = "native-session"

[formation.native_hook_capture]
path = "native-hook-capture.json"
schema_version = "native-hook-capture-v1"

[oracle]
visibility = "public"
required_start_files = ["src/sample.ts"]
relevant_evidence_ids = []
stale_evidence_ids = []
forbidden_actions = []
agent_writable_paths = ["src"]
""".strip(),
        encoding="utf-8",
    )
    return case_root, load_case_manifest(case_root / "case.toml")


def _install_fake_client(
    monkeypatch: pytest.MonkeyPatch,
    *,
    matching_edit: bool,
    hook_event_name: str = "PostToolUse",
) -> list[dict[str, object]]:
    calls: list[dict[str, object]] = []
    monkeypatch.setattr(
        module,
        "load_claude_provider_env",
        lambda _path: {
            "ANTHROPIC_BASE_URL": "https://provider.example.invalid",
            "ANTHROPIC_AUTH_TOKEN": "fixture-private-token",
        },
    )

    def fake_run_agent(**kwargs):
        calls.append(kwargs)
        workspace = Path(kwargs["workspace"])
        source = workspace / "src" / "sample.ts"
        old = source.read_text(encoding="utf-8")
        new = (
            old + "// Preserve raw marker before rendering.\n"
            if matching_edit
            else old + "// Unexpected captured edit.\n"
        )
        source.write_text(new, encoding="utf-8")
        private_root = Path(kwargs["artifact_dir"]).parent
        event_log = private_root / "raw" / "native-hook-events.jsonl"
        event_log.parent.mkdir(parents=True, exist_ok=True)
        event = {
            "session_id": "fixture-session",
            "cwd": str(workspace),
            "hook_event_name": hook_event_name,
        }
        if hook_event_name == "PostToolUse":
            event.update({
                "tool_name": "Edit",
                "tool_input": {
                    "file_path": str(source),
                    "old_string": old,
                    "new_string": new,
                },
                "tool_response": {"filePath": str(source), "success": True},
            })
        event_log.write_text(json.dumps(event) + "\n", encoding="utf-8")
        return SimpleNamespace(
            completed=True,
            returncode=0,
            timed_out=False,
            failure_reason=None,
            bash_commands=(),
            reported_models=("fixture-model",),
        )

    monkeypatch.setattr(module, "run_agent", fake_run_agent)
    monkeypatch.setattr(
        module,
        "ingest_memorix_native_hook_capture",
        lambda **_kwargs: {
            "formation_receipt": {"surface": "native-session", "record_count": 1},
        },
    )
    return calls


def test_captures_declared_native_client_edit_in_an_isolated_workspace(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    case_root, manifest = _manifest(tmp_path)
    calls = _install_fake_client(monkeypatch, matching_edit=True)
    cli = tmp_path / "memorix-cli.js"
    cli.write_text("placeholder", encoding="utf-8")

    capture = capture_native_client_session(
        manifest=manifest,
        prompt="Add the declared raw marker comment, then run the focused check.",
        artifact_root=tmp_path / "private-artifacts",
        portable_output=tmp_path / "portable" / "capture.json",
        workspace_root=tmp_path / "workspaces",
        memorix_cli=cli,
        claude_provider_settings=tmp_path / "provider.json",
        client_version="fixture-claude-1",
        storage_probe_query="raw marker rendering",
        capture_id="native-client-fixture-a",
        model="fixture-model",
    )

    portable = json.loads(capture.portable_capture_path.read_text(encoding="utf-8"))
    assert capture.workspace_snapshot_sha256
    assert capture.formation_receipt["record_count"] == 1
    assert portable["case_id"] == manifest.case_id
    assert portable["events"][0]["payload"]["cwd"] == "<WORKSPACE>"
    assert str(capture.workspace) not in capture.portable_capture_path.read_text(encoding="utf-8")
    assert "fixture-private-token" not in capture.portable_capture_path.read_text(encoding="utf-8")
    settings = json.loads(
        (capture.private_artifact_root / "control" / "claude-settings.json").read_text(
            encoding="utf-8"
        )
    )
    assert settings["hooks"]["PostToolUse"][0]["matcher"] == "Write|Edit"
    assert calls[0]["claude_bare"] is False
    assert calls[0]["claude_setting_sources"] == "user"
    assert calls[0]["claude_permission_mode"] == "acceptEdits"
    assert case_root not in capture.private_artifact_root.parents


def test_rejects_a_native_client_edit_that_does_not_match_the_declared_patch(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _, manifest = _manifest(tmp_path)
    _install_fake_client(monkeypatch, matching_edit=False)
    cli = tmp_path / "memorix-cli.js"
    cli.write_text("placeholder", encoding="utf-8")

    with pytest.raises(NativeClientCaptureError, match="does not match"):
        capture_native_client_session(
            manifest=manifest,
            prompt="Add the declared raw marker comment.",
            artifact_root=tmp_path / "private-artifacts",
            portable_output=tmp_path / "portable" / "capture.json",
            workspace_root=tmp_path / "workspaces",
            memorix_cli=cli,
            claude_provider_settings=tmp_path / "provider.json",
            client_version="fixture-claude-1",
            storage_probe_query="raw marker rendering",
            capture_id="native-client-fixture-b",
            model="fixture-model",
        )

    assert not (tmp_path / "portable" / "capture.json").exists()


def test_rejects_a_native_capture_when_the_client_reports_another_model(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _, manifest = _manifest(tmp_path)
    _install_fake_client(monkeypatch, matching_edit=True)
    cli = tmp_path / "memorix-cli.js"
    cli.write_text("placeholder", encoding="utf-8")

    with pytest.raises(NativeClientCaptureError, match="single-model route"):
        capture_native_client_session(
            manifest=manifest,
            prompt="Add the declared raw marker comment.",
            artifact_root=tmp_path / "private-artifacts",
            portable_output=tmp_path / "portable" / "capture.json",
            workspace_root=tmp_path / "workspaces",
            memorix_cli=cli,
            claude_provider_settings=tmp_path / "provider.json",
            client_version="fixture-claude-1",
            storage_probe_query="raw marker rendering",
            capture_id="native-client-fixture-c",
            model="expected-model",
        )

    assert not (tmp_path / "portable" / "capture.json").exists()


def test_rejects_a_native_capture_without_an_edit_or_write_post_tool_event(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _, manifest = _manifest(tmp_path)
    _install_fake_client(
        monkeypatch,
        matching_edit=True,
        hook_event_name="SessionStart",
    )
    cli = tmp_path / "memorix-cli.js"
    cli.write_text("placeholder", encoding="utf-8")

    with pytest.raises(NativeClientCaptureError, match="non-Edit/Write PostToolUse"):
        capture_native_client_session(
            manifest=manifest,
            prompt="Add the declared raw marker comment.",
            artifact_root=tmp_path / "private-artifacts",
            portable_output=tmp_path / "portable" / "capture.json",
            workspace_root=tmp_path / "workspaces",
            memorix_cli=cli,
            claude_provider_settings=tmp_path / "provider.json",
            client_version="fixture-claude-1",
            storage_probe_query="raw marker rendering",
            capture_id="native-client-fixture-session-start",
            model="fixture-model",
        )

    assert not (tmp_path / "portable" / "capture.json").exists()


def test_rejects_a_non_development_case_before_running_a_client(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _, manifest = _manifest(tmp_path)
    calls = _install_fake_client(monkeypatch, matching_edit=True)
    cli = tmp_path / "memorix-cli.js"
    cli.write_text("placeholder", encoding="utf-8")

    with pytest.raises(NativeClientCaptureError, match="development diagnostics"):
        capture_native_client_session(
            manifest=replace(manifest, split="public-evaluation"),
            prompt="Add the declared raw marker comment.",
            artifact_root=tmp_path / "private-artifacts",
            portable_output=tmp_path / "portable" / "capture.json",
            workspace_root=tmp_path / "workspaces",
            memorix_cli=cli,
            claude_provider_settings=tmp_path / "provider.json",
            client_version="fixture-claude-1",
            storage_probe_query="raw marker rendering",
            capture_id="native-client-fixture-d",
            model="fixture-model",
        )

    assert calls == []
    assert not (tmp_path / "portable" / "capture.json").exists()


def test_rejects_a_native_capture_without_an_exact_model_before_running_a_client(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _, manifest = _manifest(tmp_path)
    calls = _install_fake_client(monkeypatch, matching_edit=True)
    cli = tmp_path / "memorix-cli.js"
    cli.write_text("placeholder", encoding="utf-8")

    with pytest.raises(NativeClientCaptureError, match="exact requested model"):
        capture_native_client_session(
            manifest=manifest,
            prompt="Add the declared raw marker comment.",
            artifact_root=tmp_path / "private-artifacts",
            portable_output=tmp_path / "portable" / "capture.json",
            workspace_root=tmp_path / "workspaces",
            memorix_cli=cli,
            claude_provider_settings=tmp_path / "provider.json",
            client_version="fixture-claude-1",
            storage_probe_query="raw marker rendering",
            capture_id="native-client-fixture-e",
        )

    assert calls == []
    assert not (tmp_path / "portable" / "capture.json").exists()
