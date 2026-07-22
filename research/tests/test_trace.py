import json
from pathlib import Path

import pytest

from memorixbench.schema import load_case_manifest
from memorixbench.trace import (
    PrecursorEvent,
    TraceError,
    canonical_trace_sha256,
    load_precursor_trace,
    render_trace_view,
    trace_records,
    write_canonical_trace,
)


def _trace_case(tmp_path: Path) -> tuple[Path, Path]:
    case = tmp_path / "case"
    case.mkdir()
    (case / "seed").mkdir()
    (case / "seed" / "value.txt").write_text("base\n", encoding="utf-8")
    trace_path = case / "precursor-trace.json"
    manifest_path = case / "case.toml"
    manifest_path.write_text(
        """
schema_version = "0.5"
id = "trace-case"
title = "Trace case"
split = "development"
dependency_strength = "medium"
dependency_classification_status = "retrospective-development"
language = "text"
tags = ["trace"]

[repository]
source_type = "local-fixture"
path = "seed"
base_revision = "fixture-base"

[precursor]
task = "Review the policy."
success_commands = ["git status --short"]

[formation]
track = "trace-replay"

[formation.precursor_trace]
path = "precursor-trace.json"
schema_version = "precursor-trace-v1"
provenance = "captured-session-v1"
normalization = "event-normalize-v1"
truncation = "event-suffix-v1"

[transition]
kind = "none"
description = "No transition."
apply_commands = []

[transfer]
task = "Continue the policy task."
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
    write_canonical_trace(
        path=trace_path,
        case_id="trace-case",
        provenance="captured-session-v1",
        normalization="event-normalize-v1",
        events=(
            PrecursorEvent(
                event_id="e1",
                session_id="s1",
                sequence=0,
                turn=0,
                role="user",
                kind="message",
                content="The policy must remain deterministic.",
            ),
            PrecursorEvent(
                event_id="e2",
                session_id="s1",
                sequence=1,
                turn=1,
                role="assistant",
                kind="message",
                content="I will verify the current source and tests.",
            ),
        ),
    )
    return manifest_path, trace_path


def test_loads_canonical_trace_and_preserves_order(tmp_path: Path) -> None:
    manifest_path, _ = _trace_case(tmp_path)
    trace = load_precursor_trace(load_case_manifest(manifest_path))

    assert trace.case_id == "trace-case"
    assert trace.session_ids == ("s1",)
    assert len(trace.sha256) == 64
    assert len(trace.source_sha256) == 64
    assert trace.sha256 == trace.canonical_sha256
    assert trace_records(trace)[0].memory_id == "trace:e1"


def test_trace_rejects_secret_and_absolute_path_content(tmp_path: Path) -> None:
    manifest_path, trace_path = _trace_case(tmp_path)
    payload = json.loads(trace_path.read_text(encoding="utf-8"))
    payload["events"][0]["content"] = "API_KEY=secret-value"
    trace_path.write_text(json.dumps(payload), encoding="utf-8")

    with pytest.raises(TraceError, match="credential"):
        load_precursor_trace(load_case_manifest(manifest_path))


def test_trace_rejects_noncanonical_sequence(tmp_path: Path) -> None:
    manifest_path, trace_path = _trace_case(tmp_path)
    payload = json.loads(trace_path.read_text(encoding="utf-8"))
    payload["events"][1]["sequence"] = 3
    trace_path.write_text(json.dumps(payload), encoding="utf-8")

    with pytest.raises(TraceError, match="contiguous"):
        load_precursor_trace(load_case_manifest(manifest_path))


def test_trace_view_uses_a_suffix_without_cutting_an_event(tmp_path: Path) -> None:
    manifest_path, trace_path = _trace_case(tmp_path)
    payload = json.loads(trace_path.read_text(encoding="utf-8"))
    payload["events"].append(
        {
            "id": "e3",
            "session_id": "s1",
            "sequence": 2,
            "turn": 2,
            "role": "assistant",
            "kind": "message",
            "content": "The final event must remain whole when the context is bounded.",
        }
    )
    trace_path.write_text(json.dumps(payload), encoding="utf-8")
    trace = load_precursor_trace(load_case_manifest(manifest_path))

    view = render_trace_view(trace, token_budget=75)

    assert view.token_count <= view.token_budget
    assert view.retained_event_ids == ("e2", "e3")
    assert view.dropped_event_ids == ("e1",)
    assert "final event must remain whole" in view.context
    assert "The policy must remain deterministic" not in view.context
    assert len(view.sha256) == 64


def test_trace_rejects_unmatched_tool_result(tmp_path: Path) -> None:
    manifest_path, trace_path = _trace_case(tmp_path)
    payload = json.loads(trace_path.read_text(encoding="utf-8"))
    payload["events"].append(
        {
            "id": "e3",
            "session_id": "s1",
            "sequence": 2,
            "turn": 2,
            "role": "tool",
            "kind": "tool_result",
            "tool_call_id": "missing-call",
            "content": "No matching call exists.",
        }
    )
    trace_path.write_text(json.dumps(payload), encoding="utf-8")

    with pytest.raises(TraceError, match="earlier tool_call"):
        load_precursor_trace(load_case_manifest(manifest_path))


def test_canonical_hash_ignores_newline_encoding_but_records_source_hash(tmp_path: Path) -> None:
    manifest_path, trace_path = _trace_case(tmp_path)
    first = load_precursor_trace(load_case_manifest(manifest_path))
    trace_path.write_bytes(trace_path.read_bytes().replace(b"\n", b"\r\n"))

    second = load_precursor_trace(load_case_manifest(manifest_path))

    assert first.canonical_sha256 == second.canonical_sha256
    assert first.source_sha256 != second.source_sha256


def test_canonical_trace_commitment_matches_loaded_trace(tmp_path: Path) -> None:
    manifest_path, _ = _trace_case(tmp_path)
    trace = load_precursor_trace(load_case_manifest(manifest_path))

    commitment = canonical_trace_sha256(
        case_id=trace.case_id,
        provenance=trace.provenance,
        normalization=trace.normalization,
        events=trace.events,
    )

    assert commitment == trace.canonical_sha256


def test_writer_normalizes_crlf_before_committing_trace(tmp_path: Path) -> None:
    manifest_path, trace_path = _trace_case(tmp_path)
    write_canonical_trace(
        path=trace_path,
        case_id="trace-case",
        provenance="captured-session-v1",
        normalization="event-normalize-v1",
        events=(
            PrecursorEvent(
                event_id="e1",
                session_id="s1",
                sequence=0,
                turn=0,
                role="user",
                kind="message",
                content="first line\r\nsecond line  ",
            ),
        ),
    )

    trace = load_precursor_trace(load_case_manifest(manifest_path))

    assert trace.canonical_sha256 == canonical_trace_sha256(
        case_id=trace.case_id,
        provenance=trace.provenance,
        normalization=trace.normalization,
        events=trace.events,
    )
    assert trace.events[0].content == "first line\nsecond line"
