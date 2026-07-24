from dataclasses import replace
import json
from pathlib import Path
import sys

import pytest

from memorixbench.annotation import (
    AnnotationError,
    AnnotationSubmission,
    build_blind_packet,
    finalize_annotations,
    load_blind_packet,
    load_final_annotation,
    merge_annotation_into_result,
    write_blind_packet,
    write_final_annotation,
)
from memorixbench.actions import write_action_ledger
from memorixbench.annotation import write_sanitized_action_ledger
from memorixbench.scoring import collect_result_payloads
import memorixbench.cli as cli


def _write_json(path: Path, value: object) -> None:
    path.write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8")


def _packet(tmp_path: Path):
    timeline = tmp_path / "timeline.jsonl"
    rows = [
        {
            "sequence": 0,
            "stream": "stdout",
            "elapsed_seconds": 1.0,
            "line": json.dumps({
                "type": "assistant",
                "message": {"content": [{
                    "type": "tool_use",
                    "id": "command",
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
                "type": "assistant",
                "message": {"content": [{
                    "type": "tool_use",
                    "id": "memory",
                    "name": "mcp__memorix__memorix_search",
                    "input": {"query": "private memory content"},
                }]},
            }) + "\n",
        },
    ]
    timeline.write_text("".join(json.dumps(row) + "\n" for row in rows), encoding="utf-8")
    ledger_path = tmp_path / "action-ledger.json"
    ledger = write_action_ledger(agent="claude", timeline_path=timeline, path=ledger_path)
    sanitized_ledger_path = tmp_path / "sanitized-action-ledger.json"
    write_sanitized_action_ledger(ledger_path, sanitized_ledger_path)
    sanitized = sanitized_ledger_path.read_text(encoding="utf-8").casefold()
    result_path = tmp_path / "result.json"
    _write_json(result_path, {
        "run_id": "raw-run-id",
        "case_id": "case-a",
        "condition": "memorix-full",
        "agent": "claude",
        "model": "model-x",
        "repetition": 0,
        "seed": 7,
        "task_success": True,
        "memory_provider": "memorix",
        "agent_action_ledger_sha256": ledger.sha256,
    })
    packet = build_blind_packet(
        result_path=result_path,
        sanitized_action_ledger_path=sanitized_ledger_path,
        task="Repair the current retry regression.",
        rubric="Choose the first action that advances the declared repair.",
        blind_salt="private-vault-salt",
    )
    assert "mcp__memorix" not in sanitized
    assert "private memory content" not in sanitized
    return result_path, sanitized_ledger_path, packet


def _submission(packet_sha: str, rater: str, *, first: str | None = "a0001") -> AnnotationSubmission:
    return AnnotationSubmission(
        schema_version="0.1",
        packet_sha256=packet_sha,
        rater_id=rater,
        judge_kind="human",
        submitted_at="2026-07-22T12:00:00+00:00",
        first_correct_action_status="observed" if first else "none-observed",
        first_correct_action_id=first,
        stale_memory_error_status="rated",
        stale_episode_start_action_ids=(),
        negative_control_intrusion_status="rated",
        negative_intrusion_start_action_ids=(),
    )


def test_blind_packet_removes_run_condition_provider_and_memory_arguments(tmp_path: Path) -> None:
    _result, _ledger, packet = _packet(tmp_path)
    packet_path = write_blind_packet(packet, tmp_path / "packet.json")
    serialized = packet_path.read_text(encoding="utf-8").casefold()

    assert "raw-run-id" not in serialized
    assert "memorix-full" not in serialized
    assert "model-x" not in serialized
    assert "private memory content" not in serialized
    assert packet.actions[1].operation_summary == "[redacted memory operation]"
    assert load_blind_packet(packet_path) == packet


def test_matching_human_raters_produce_a_zero_count_annotation(tmp_path: Path) -> None:
    result_path, _ledger, packet = _packet(tmp_path)
    first = _submission(packet.sha256, "rater-alpha")
    second = _submission(packet.sha256, "rater-beta")

    annotation = finalize_annotations(packet, first, second)
    annotation_path = write_final_annotation(annotation, tmp_path / "final.json")
    merged = merge_annotation_into_result(result_path, load_final_annotation(annotation_path))

    assert annotation.status == "consensus-v1"
    assert annotation.first_correct_action_seconds == 1.0
    assert annotation.stale_memory_errors == 0
    assert annotation.negative_control_intrusions == 0
    assert annotation.stale_memory_error_status == "annotated-v1"
    assert merged["annotation_status"] == "consensus-v1"
    assert merged["stale_memory_errors"] == 0

    write_final_annotation(annotation, tmp_path / "outcome-annotation.json")
    collected = collect_result_payloads(tmp_path)
    assert collected[0]["negative_control_intrusions"] == 0
    assert collected[0]["annotation_status"] == "consensus-v1"


def test_disagreement_requires_independent_human_adjudication(tmp_path: Path) -> None:
    _result, _ledger, packet = _packet(tmp_path)
    first = _submission(packet.sha256, "rater-alpha", first="a0001")
    second = _submission(packet.sha256, "rater-beta", first=None)

    with pytest.raises(AnnotationError, match="require a blinded adjudication"):
        finalize_annotations(packet, first, second)

    adjudication = _submission(packet.sha256, "rater-gamma", first="a0002")
    annotation = finalize_annotations(packet, first, second, adjudication=adjudication)

    assert annotation.status == "adjudicated-v1"
    assert annotation.first_correct_action_id == "a0002"
    assert annotation.first_correct_action_seconds == 2.0


def test_annotation_rejects_unknown_actions_and_nonhuman_judges(tmp_path: Path) -> None:
    _result, _ledger, packet = _packet(tmp_path)
    bad_action = replace(_submission(packet.sha256, "rater-alpha"), first_correct_action_id="a9999")
    other = _submission(packet.sha256, "rater-beta")
    with pytest.raises(AnnotationError, match="known action"):
        finalize_annotations(packet, bad_action, other)

    nonhuman = replace(_submission(packet.sha256, "rater-alpha"), judge_kind="llm")
    with pytest.raises(AnnotationError, match="human"):
        finalize_annotations(packet, nonhuman, other)


def test_annotation_packet_cli_smoke(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    result_path, sanitized_ledger_path, _packet_value = _packet(tmp_path)
    task = tmp_path / "task.txt"
    rubric = tmp_path / "rubric.txt"
    salt = tmp_path / "salt.txt"
    output = tmp_path / "cli-packet.json"
    task.write_text("Repair the retry regression.\n", encoding="utf-8")
    rubric.write_text("Rate only the declared repair actions.\n", encoding="utf-8")
    salt.write_text("test-vault-salt\n", encoding="utf-8")
    monkeypatch.setattr(sys, "argv", [
        "memorixbench",
        "build-annotation-packet",
        str(result_path),
        str(sanitized_ledger_path),
        "--task-file",
        str(task),
        "--rubric-file",
        str(rubric),
        "--blind-salt-file",
        str(salt),
        "--output",
        str(output),
    ])

    assert cli.main() == 0
    assert load_blind_packet(output).actions
