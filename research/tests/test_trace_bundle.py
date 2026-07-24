from __future__ import annotations

import hashlib
import json
from pathlib import Path

import pytest

from memorixbench.schema import load_case_manifest
from memorixbench.trace import load_trace_bundle, resolve_precursor_trace, write_trace_bundle
from memorixbench.trace_capture import capture_trace_from_streams


def _write_case(path: Path) -> Path:
    seed = path / "seed"
    seed.mkdir(parents=True)
    (seed / "value.txt").write_text("base\n", encoding="utf-8")
    manifest = path / "case.toml"
    manifest.write_text(
        """
schema_version = "0.5"
id = "bundle-case"
title = "Trace bundle case"
split = "development"
dependency_strength = "high"
dependency_classification_status = "retrospective-development"
language = "text"
tags = ["trace", "bundle"]

[repository]
source_type = "local-fixture"
path = "seed"
base_revision = "fixture-base"

[precursor]
task = "Review the retained policy."
success_commands = ["git status --short"]

[formation]
track = "trace-replay"

[formation.trace_bundle]
path = "trace-bundle.json"
schema_version = "precursor-trace-bundle-v1"
selection = "hash-bucket-v1"
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
    return manifest


def _capture(
    path: Path,
    *,
    capture_id: str,
    text: str,
    tool_result_mode: str = "verbatim",
) -> tuple[Path, Path]:
    events = path / f"{capture_id}-events.jsonl"
    timeline = path / f"{capture_id}-timeline.jsonl"
    trace = path / "traces" / f"{capture_id}.json"
    receipt = path / "traces" / f"{capture_id}-receipt.json"
    event = {
        "type": "assistant",
        "message": {
            "model": "bundle-test-model",
            "content": [{"type": "text", "text": text}],
        },
    }
    events.write_bytes((json.dumps(event) + "\n").encode("utf-8"))
    timeline.write_bytes(
        (json.dumps({
            "sequence": 0,
            "stream": "stdout",
            "elapsed_seconds": 0.0,
            "line": json.dumps(event) + "\n",
        }) + "\n").encode("utf-8")
    )
    capture_trace_from_streams(
        events_path=events,
        timeline_path=timeline,
        case_id="bundle-case",
        agent="claude",
        prompt="Review the retained policy.",
        output_path=trace,
        receipt_path=receipt,
        client_version="bundle-test-client",
        workspace_snapshot_sha256="d" * 64,
        workspace_roots=(path / "seed",),
        capture_id=capture_id,
        captured_at_utc="2026-07-22T00:00:00+00:00",
        tool_result_mode=tool_result_mode,
    )
    return trace, receipt


def _bundle_entry(capture_id: str, trace: Path, receipt: Path, root: Path) -> dict[str, str]:
    trace_bytes = trace.read_bytes()
    receipt_bytes = receipt.read_bytes()
    trace_payload = json.loads(trace_bytes)
    return {
        "capture_id": capture_id,
        "trace_path": trace.relative_to(root).as_posix(),
        "trace_source_sha256": hashlib.sha256(trace_bytes).hexdigest(),
        "canonical_trace_sha256": hashlib.sha256(
            json.dumps({
                "schema_version": trace_payload["schema_version"],
                "case_id": trace_payload["case_id"],
                "provenance": trace_payload["provenance"],
                "normalization": trace_payload["normalization"],
                "events": trace_payload["events"],
            },
            sort_keys=True,
            separators=(",", ":"),
            ensure_ascii=False,
            ).encode("utf-8")
        ).hexdigest(),
        "receipt_path": receipt.relative_to(root).as_posix(),
        "receipt_sha256": hashlib.sha256(receipt_bytes).hexdigest(),
    }


def test_bundle_binds_two_captures_and_selects_deterministically(tmp_path: Path) -> None:
    case = tmp_path / "case"
    manifest_path = _write_case(case)
    first_trace, first_receipt = _capture(
        case,
        capture_id="capture-one",
        text="The policy retains the first decision.",
    )
    second_trace, second_receipt = _capture(
        case,
        capture_id="capture-two",
        text="The policy retains the second decision.",
    )
    write_trace_bundle(
        path=case / "trace-bundle.json",
        case_root=case,
        case_id="bundle-case",
        trace_paths=(first_trace, second_trace),
        receipt_paths=(first_receipt, second_receipt),
    )
    manifest = load_case_manifest(manifest_path)

    loaded = load_trace_bundle(manifest)
    first = resolve_precursor_trace(manifest, seed=1729, repetition=1)
    second = resolve_precursor_trace(manifest, seed=1729, repetition=1)

    assert len(loaded.entries) == 2
    assert loaded.normalization == "event-normalize-v1"
    assert first.capture_id in {"capture-one", "capture-two"}
    assert first.capture_id == second.capture_id
    assert first.trace.canonical_sha256 == second.trace.canonical_sha256
    assert first.selection == "hash-bucket-v1"
    assert first.bundle_sha256 == loaded.source_sha256


def test_bundle_binds_metadata_only_normalization(tmp_path: Path) -> None:
    case = tmp_path / "case"
    manifest_path = _write_case(case)
    first_trace, first_receipt = _capture(
        case,
        capture_id="capture-one",
        text="The policy retains the first decision.",
        tool_result_mode="metadata-only",
    )
    second_trace, second_receipt = _capture(
        case,
        capture_id="capture-two",
        text="The policy retains the second decision.",
        tool_result_mode="metadata-only",
    )
    write_trace_bundle(
        path=case / "trace-bundle.json",
        case_root=case,
        case_id="bundle-case",
        trace_paths=(first_trace, second_trace),
        receipt_paths=(first_receipt, second_receipt),
    )

    payload = json.loads((case / "trace-bundle.json").read_text(encoding="utf-8"))
    loaded = load_trace_bundle(load_case_manifest(manifest_path))

    assert payload["normalization"] == "event-normalize-tool-results-omitted-v1"
    assert loaded.normalization == "event-normalize-tool-results-omitted-v1"
    assert {entry.trace.normalization for entry in loaded.entries} == {
        "event-normalize-tool-results-omitted-v1"
    }


def test_bundle_loads_legacy_v1_without_explicit_normalization(tmp_path: Path) -> None:
    case = tmp_path / "case"
    manifest_path = _write_case(case)
    first_trace, first_receipt = _capture(
        case,
        capture_id="capture-one",
        text="The policy retains the first decision.",
    )
    second_trace, second_receipt = _capture(
        case,
        capture_id="capture-two",
        text="The policy retains the second decision.",
    )
    bundle_path = case / "trace-bundle.json"
    write_trace_bundle(
        path=bundle_path,
        case_root=case,
        case_id="bundle-case",
        trace_paths=(first_trace, second_trace),
        receipt_paths=(first_receipt, second_receipt),
    )
    legacy = json.loads(bundle_path.read_text(encoding="utf-8"))
    legacy.pop("normalization")
    bundle_path.write_bytes((json.dumps(legacy, indent=2) + "\n").encode("utf-8"))

    loaded = load_trace_bundle(load_case_manifest(manifest_path))

    assert loaded.normalization == "event-normalize-v1"


def test_bundle_rejects_mixed_trace_normalizations(tmp_path: Path) -> None:
    case = tmp_path / "case"
    _write_case(case)
    first_trace, first_receipt = _capture(
        case,
        capture_id="capture-one",
        text="The policy retains the first decision.",
    )
    second_trace, second_receipt = _capture(
        case,
        capture_id="capture-two",
        text="The policy retains the second decision.",
        tool_result_mode="metadata-only",
    )

    with pytest.raises(ValueError, match="share one normalization"):
        write_trace_bundle(
            path=case / "trace-bundle.json",
            case_root=case,
            case_id="bundle-case",
            trace_paths=(first_trace, second_trace),
            receipt_paths=(first_receipt, second_receipt),
        )


def test_bundle_rejects_a_tampered_receipt_commitment(tmp_path: Path) -> None:
    case = tmp_path / "case"
    manifest_path = _write_case(case)
    first_trace, first_receipt = _capture(
        case,
        capture_id="capture-one",
        text="The policy retains the first decision.",
    )
    second_trace, second_receipt = _capture(
        case,
        capture_id="capture-two",
        text="The policy retains the second decision.",
    )
    first = _bundle_entry("capture-one", first_trace, first_receipt, case)
    first["receipt_sha256"] = "0" * 64
    bundle = {
        "schema_version": "precursor-trace-bundle-v1",
        "case_id": "bundle-case",
        "selection": "hash-bucket-v1",
        "captures": [
            first,
            _bundle_entry("capture-two", second_trace, second_receipt, case),
        ],
    }
    (case / "trace-bundle.json").write_text(json.dumps(bundle), encoding="utf-8")

    try:
        load_trace_bundle(load_case_manifest(manifest_path))
    except ValueError as error:
        assert "receipt hash" in str(error)
    else:
        raise AssertionError("tampered trace-bundle receipt commitment was accepted")
