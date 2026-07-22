from __future__ import annotations

import json
from pathlib import Path
import subprocess
from types import SimpleNamespace

import pytest

import memorixbench.capture_session as module
from memorixbench.capture_session import CaptureSessionError, capture_precursor_session
from memorixbench.schema import load_case_manifest


def _manifest(tmp_path: Path):
    case_root = tmp_path / "case-repo"
    case_root.mkdir()
    subprocess.run(["git", "init", "--quiet"], cwd=case_root, check=True)
    seed = case_root / "seed"
    seed.mkdir(parents=True)
    (seed / "value.txt").write_text("base\n", encoding="utf-8")
    manifest_path = case_root / "case.toml"
    manifest_path.write_text(
        """
schema_version = "0.5"
id = "capture-session-case"
title = "Capture session case"
split = "development"
dependency_strength = "medium"
dependency_classification_status = "retrospective-development"
language = "text"
tags = ["capture"]

[repository]
source_type = "local-fixture"
path = "seed"
base_revision = "fixture-base"

[precursor]
task = "Review the predecessor state."
success_commands = ["git status --short"]

[transition]
kind = "none"
description = "No transfer transition is needed for this capture fixture."
apply_commands = []

[transfer]
task = "Continue the work."
success_commands = ["git status --short"]

[oracle]
visibility = "public"
required_start_files = ["value.txt"]
relevant_evidence_ids = []
stale_evidence_ids = []
forbidden_actions = []
""".strip(),
        encoding="utf-8",
    )
    return load_case_manifest(manifest_path)


def _install_fake_claude(
    monkeypatch: pytest.MonkeyPatch,
    *,
    mutate_workspace: bool = False,
    expose_secret: bool = False,
) -> None:
    monkeypatch.setattr(
        module,
        "load_claude_provider_env",
        lambda _path: {
            "ANTHROPIC_BASE_URL": "https://provider.example.invalid",
            "ANTHROPIC_API_KEY": "sensitive-fixture-token-value",
        },
    )

    def write_settings(path: str | Path, **_kwargs) -> Path:
        target = Path(path)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text("{}\n", encoding="utf-8")
        return target

    monkeypatch.setattr(module, "write_claude_settings", write_settings)

    def fake_run_agent(**kwargs):
        artifact_dir = Path(kwargs["artifact_dir"])
        artifact_dir.mkdir(parents=True, exist_ok=True)
        events_path = artifact_dir / "events.jsonl"
        events = [
            {
                "type": "assistant",
                "message": {
                    "model": "fixture-claude",
                    "content": [{
                        "type": "text",
                        "text": (
                            "The caller owns the input slice. sensitive-fixture-token-value"
                            if expose_secret
                            else "The caller owns the input slice."
                        ),
                    }],
                },
            },
            {"type": "result", "result": "Keep the ownership invariant in the handoff."},
        ]
        events_path.write_bytes(
            "".join(json.dumps(event) + "\n" for event in events).encode("utf-8")
        )
        timeline_path = artifact_dir / "event-timeline.jsonl"
        timeline_path.write_bytes(
            "".join(
                json.dumps({
                    "sequence": index,
                    "stream": "stdout",
                    "elapsed_seconds": float(index),
                    "line": json.dumps(event) + "\n",
                }) + "\n"
                for index, event in enumerate(events)
            ).encode("utf-8"),
        )
        if mutate_workspace:
            (Path(kwargs["workspace"]) / "changed.txt").write_text("changed\n", encoding="utf-8")
        return SimpleNamespace(
            completed=True,
            returncode=0,
            timed_out=False,
            failure_reason=None,
            events_path=events_path,
            timeline_path=timeline_path,
            reported_models=("fixture-claude",),
            event_count=len(events),
            tool_call_count=0,
            action_count=0,
            bash_commands=(),
        )

    monkeypatch.setattr(module, "run_agent", fake_run_agent)


def test_capture_session_materializes_and_sanitizes_a_read_only_precursor(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _install_fake_claude(monkeypatch)

    capture = capture_precursor_session(
        manifest=_manifest(tmp_path),
        prompt="Review the retained ownership behavior and leave a concise handoff. Do not edit files.",
        artifact_root=tmp_path / "artifacts",
        public_output_root=tmp_path / "public-output",
        workspace_root=tmp_path / "workspaces",
        agent="claude",
        client_version="fixture-claude-1",
        capture_id="capture-fixture-one",
        claude_provider_settings=tmp_path / "provider-settings.json",
    )

    assert capture.receipt.capture_mode == "local-diagnostic-v1"
    assert capture.trace_path.is_file()
    assert capture.receipt_path.is_file()
    assert not (capture.private_artifact_root / "staged-public").exists()
    assert capture.workspace_snapshot_sha256 == capture.receipt.workspace_snapshot_sha256
    assert capture.public_payload()["reported_models"] == ["fixture-claude"]


def test_capture_session_refuses_a_workspace_mutation(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _install_fake_claude(monkeypatch, mutate_workspace=True)

    with pytest.raises(CaptureSessionError, match="changed the workspace"):
        capture_precursor_session(
            manifest=_manifest(tmp_path),
            prompt="Review without edits.",
            artifact_root=tmp_path / "artifacts",
            public_output_root=tmp_path / "public-output",
            workspace_root=tmp_path / "workspaces",
            agent="claude",
            client_version="fixture-claude-1",
            capture_id="capture-fixture-two",
            claude_provider_settings=tmp_path / "provider-settings.json",
        )


def test_capture_session_requires_separate_artifact_and_workspace_roots(tmp_path: Path) -> None:
    with pytest.raises(CaptureSessionError, match="must not overlap"):
        capture_precursor_session(
            manifest=_manifest(tmp_path),
            prompt="Review without edits.",
            artifact_root=tmp_path / "shared",
            public_output_root=tmp_path / "public-output",
            workspace_root=tmp_path / "shared",
            agent="codex",
            client_version="fixture-codex-1",
            capture_id="capture-fixture-three",
        )


def test_capture_session_rejects_roots_inside_the_case_repository(tmp_path: Path) -> None:
    manifest = _manifest(tmp_path)

    with pytest.raises(CaptureSessionError, match="outside the case repository"):
        capture_precursor_session(
            manifest=manifest,
            prompt="Review without edits.",
            artifact_root=manifest.source_path.parent / "private-capture",
            public_output_root=tmp_path / "public-output",
            workspace_root=tmp_path / "workspaces",
            agent="codex",
            client_version="fixture-codex-1",
            capture_id="capture-fixture-inside-case",
        )


def test_capture_session_quarantines_a_bare_provider_secret(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _install_fake_claude(monkeypatch, expose_secret=True)
    artifact_root = tmp_path / "artifacts"

    with pytest.raises(CaptureSessionError, match="public safety scan"):
        capture_precursor_session(
            manifest=_manifest(tmp_path),
            prompt="Review without edits.",
            artifact_root=artifact_root,
            public_output_root=tmp_path / "public-output",
            workspace_root=tmp_path / "workspaces",
            agent="claude",
            client_version="fixture-claude-1",
            capture_id="capture-fixture-four",
            claude_provider_settings=tmp_path / "provider-settings.json",
        )

    assert (artifact_root / "quarantine-public-output").is_dir()
    assert not (tmp_path / "public-output").exists()
