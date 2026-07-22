from dataclasses import replace
import json
from pathlib import Path

import pytest

from memorixbench.scoring import (
    RunResult,
    collect_result_payloads,
    compare_conditions,
    exact_mcnemar_p,
    require_annotated_secondary,
    write_jsonl,
)


def run(case_id: str, condition: str, success: bool) -> RunResult:
    return RunResult(
        case_id=case_id,
        condition=condition,
        agent="codex",
        model="model-a",
        repetition=0,
        seed=7,
        task_success=success,
        evidence_tier="confirmatory",
        predecessor_dependency="high",
        dependency_classification_status="preregistered",
        study_track="C",
        formation_track="trace-replay",
        precursor_trace_sha256=f"trace-{case_id}",
        reported_models=("model-a",),
        case_definition_sha256=f"case-definition-{case_id}",
        oracle_definition_sha256=f"oracle-definition-{case_id}",
    )


def test_compares_only_matched_pairs() -> None:
    results = [
        run("case-a", "memorix-full", True),
        run("case-a", "no-memory", False),
        run("case-b", "memorix-full", True),
        run("case-b", "no-memory", True),
        run("unmatched", "memorix-full", True),
    ]
    comparison = compare_conditions(
        results,
        treatment="memorix-full",
        control="no-memory",
        bootstrap_samples=500,
        bootstrap_seed=11,
    )
    assert comparison.pairs == 2
    assert comparison.treatment_success_rate == 1.0
    assert comparison.control_success_rate == 0.5
    assert comparison.absolute_difference == 0.5
    assert comparison.treatment_only_successes == 1
    assert comparison.control_only_successes == 0
    assert comparison.unmatched_runs == 1
    assert comparison.excluded_invalid_runs == 0


def test_excludes_infrastructure_failures_from_pairs() -> None:
    invalid = RunResult(
        case_id="case-a",
        condition="memorix-full",
        agent="codex",
        model="model-a",
        repetition=0,
        seed=7,
        task_success=False,
        valid_run=False,
        failure_reason="authentication",
        evidence_tier="confirmatory",
        predecessor_dependency="high",
        dependency_classification_status="preregistered",
        study_track="C",
        formation_track="trace-replay",
        precursor_trace_sha256="trace-case-a",
        reported_models=("model-a",),
        case_definition_sha256="case-definition-case-a",
        oracle_definition_sha256="oracle-definition-case-a",
    )
    with pytest.raises(ValueError, match="no matched"):
        compare_conditions(
            [invalid, run("case-a", "no-memory", False)],
            treatment="memorix-full",
            control="no-memory",
            bootstrap_samples=100,
        )


def test_exact_mcnemar_is_two_sided() -> None:
    assert exact_mcnemar_p(0, 0) == 1.0
    assert exact_mcnemar_p(5, 0) == pytest.approx(0.0625)
    assert exact_mcnemar_p(3, 2) == 1.0


def test_rejects_duplicate_condition_pair() -> None:
    duplicate = run("case-a", "memorix-full", True)
    with pytest.raises(ValueError, match="duplicate run"):
        compare_conditions(
            [
                duplicate,
                duplicate,
                run("case-a", "no-memory", False),
            ],
            treatment="memorix-full",
            control="no-memory",
            bootstrap_samples=100,
        )


def test_rejects_track_c_pairs_with_different_precursor_traces() -> None:
    treatment = run("case-a", "memorix-full", True)
    control = replace(
        run("case-a", "no-memory", False),
        precursor_trace_sha256="different-trace",
    )

    with pytest.raises(ValueError, match="different precursor traces"):
        compare_conditions(
            [treatment, control],
            treatment="memorix-full",
            control="no-memory",
            bootstrap_samples=100,
        )


def test_confirmatory_comparison_rejects_track_b_seeded_evidence() -> None:
    treatment = replace(
        run("case-a", "memorix-full", True),
        study_track="B",
        formation_track="seeded-canonical",
        precursor_trace_sha256=None,
    )
    control = replace(
        run("case-a", "no-memory", False),
        study_track="B",
        formation_track="seeded-canonical",
        precursor_trace_sha256=None,
    )

    with pytest.raises(ValueError, match="require Track C"):
        compare_conditions(
            [treatment, control],
            treatment="memorix-full",
            control="no-memory",
            bootstrap_samples=100,
        )


def test_collects_and_writes_machine_readable_results(tmp_path: Path) -> None:
    nested = tmp_path / "study" / "case" / "run"
    nested.mkdir(parents=True)
    payload = {
        "case_id": "case-a",
        "condition": "no-memory",
        "agent": "claude",
        "model": "model-a",
        "repetition": 0,
        "seed": 1729,
        "task_success": False,
        "evidence_tier": "confirmatory",
        "predecessor_dependency": "high",
        "dependency_classification_status": "preregistered",
        "study_track": "C",
        "formation_track": "trace-replay",
        "precursor_trace_sha256": "trace-case-a",
        "reported_models": ["model-a"],
        "case_definition_sha256": "case-definition-case-a",
        "oracle_definition_sha256": "oracle-definition-case-a",
    }
    (nested / "result.json").write_text(json.dumps(payload), encoding="utf-8")

    rows = collect_result_payloads(tmp_path)
    destination = tmp_path / "results.jsonl"

    assert write_jsonl(destination, rows) == 1
    assert destination.read_text(encoding="utf-8").strip() == json.dumps(payload, sort_keys=True)


def test_rejects_development_results_without_explicit_override() -> None:
    development = RunResult(
        case_id="case-a",
        condition="memorix-full",
        agent="claude",
        model="model-a",
        repetition=0,
        seed=7,
        task_success=True,
        evidence_tier="development",
        predecessor_dependency="high",
        dependency_classification_status="retrospective-development",
        reported_models=("model-a",),
        case_definition_sha256="case-definition-case-a",
        oracle_definition_sha256="oracle-definition-case-a",
    )
    control = RunResult(
        case_id="case-a",
        condition="no-memory",
        agent="claude",
        model="model-a",
        repetition=0,
        seed=7,
        task_success=False,
        evidence_tier="development",
        predecessor_dependency="high",
        dependency_classification_status="retrospective-development",
        reported_models=("model-a",),
        case_definition_sha256="case-definition-case-a",
        oracle_definition_sha256="oracle-definition-case-a",
    )

    with pytest.raises(ValueError, match="explicit development override"):
        compare_conditions(
            [development, control],
            treatment="memorix-full",
            control="no-memory",
            bootstrap_samples=100,
        )

    comparison = compare_conditions(
        [development, control],
        treatment="memorix-full",
        control="no-memory",
        bootstrap_samples=100,
        require_confirmatory=False,
    )
    assert comparison.pairs == 1


def test_rejects_low_dependency_without_explicit_override() -> None:
    low_treatment = RunResult(
        case_id="case-a",
        condition="memorix-full",
        agent="claude",
        model="model-a",
        repetition=0,
        seed=7,
        task_success=True,
        evidence_tier="confirmatory",
        predecessor_dependency="low",
        dependency_classification_status="preregistered",
        study_track="C",
        formation_track="trace-replay",
        precursor_trace_sha256="trace-case-a",
        reported_models=("model-a",),
        case_definition_sha256="case-definition-case-a",
        oracle_definition_sha256="oracle-definition-case-a",
    )
    low_control = RunResult(
        case_id="case-a",
        condition="no-memory",
        agent="claude",
        model="model-a",
        repetition=0,
        seed=7,
        task_success=False,
        evidence_tier="confirmatory",
        predecessor_dependency="low",
        dependency_classification_status="preregistered",
        study_track="C",
        formation_track="trace-replay",
        precursor_trace_sha256="trace-case-a",
        reported_models=("model-a",),
        case_definition_sha256="case-definition-case-a",
        oracle_definition_sha256="oracle-definition-case-a",
    )

    with pytest.raises(ValueError, match="low or unclassified dependency"):
        compare_conditions(
            [low_treatment, low_control],
            treatment="memorix-full",
            control="no-memory",
            bootstrap_samples=100,
        )

    comparison = compare_conditions(
        [low_treatment, low_control],
        treatment="memorix-full",
        control="no-memory",
        bootstrap_samples=100,
        include_low_dependency=True,
    )
    assert comparison.pairs == 1


def test_rejects_invalid_result_classification() -> None:
    payload = {
        "case_id": "case-a",
        "condition": "no-memory",
        "agent": "claude",
        "model": "model-a",
        "repetition": 0,
        "seed": 7,
        "task_success": True,
        "evidence_tier": "development",
        "predecessor_dependency": "high",
        "dependency_classification_status": "unknown",
    }

    with pytest.raises(ValueError, match="dependency_classification_status"):
        RunResult.from_dict(payload)


def test_rejects_pairs_with_mismatched_actual_models_or_definitions() -> None:
    treatment = run("case-a", "memorix-full", True)
    mismatched_model = replace(
        run("case-a", "no-memory", False),
        reported_models=("model-b",),
    )
    with pytest.raises(ValueError, match="different actual models"):
        compare_conditions(
            [treatment, mismatched_model],
            treatment="memorix-full",
            control="no-memory",
            bootstrap_samples=100,
        )

    mismatched_case = replace(
        run("case-a", "no-memory", False),
        case_definition_sha256="different-case-definition",
    )
    with pytest.raises(ValueError, match="different case definitions"):
        compare_conditions(
            [treatment, mismatched_case],
            treatment="memorix-full",
            control="no-memory",
            bootstrap_samples=100,
        )


def test_result_keeps_pending_secondary_outcomes_as_null() -> None:
    result = RunResult.from_dict({
        "case_id": "case-a",
        "condition": "no-memory",
        "agent": "claude",
        "model": "model-a",
        "repetition": 0,
        "seed": 7,
        "task_success": True,
        "stale_memory_errors": None,
        "stale_memory_error_status": "pending-v1",
        "negative_control_intrusions": None,
        "negative_control_intrusion_status": "pending-v1",
    })

    assert result.stale_memory_errors is None
    assert result.negative_control_intrusions is None


def test_secondary_analysis_rejects_pending_and_accepts_final_human_labels() -> None:
    pending = run("case-a", "memorix-full", True)
    with pytest.raises(ValueError, match="adjudicated human labels"):
        require_annotated_secondary([pending], metric="stale-memory-errors")

    annotated = replace(
        pending,
        annotation_status="consensus-v1",
        stale_memory_errors=0,
        stale_memory_error_status="annotated-v1",
    )
    assert require_annotated_secondary(
        [annotated],
        metric="stale-memory-errors",
    ) == [annotated]
