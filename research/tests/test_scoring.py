import json
from pathlib import Path

import pytest

from memorixbench.scoring import (
    RunResult,
    collect_result_payloads,
    compare_conditions,
    exact_mcnemar_p,
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
