from dataclasses import replace
from pathlib import Path

import pytest

from memorixbench.analysis_plan import (
    ConfirmatoryAnalysisPlan,
    ConfirmatoryAnalysisPlanError,
    PlannedComparison,
    PlannedPair,
    load_confirmatory_analysis_plan,
    validate_confirmatory_results,
    write_confirmatory_analysis_plan,
)
from memorixbench.scoring import RunResult


def _plan() -> ConfirmatoryAnalysisPlan:
    pairs = tuple(
        PlannedPair(
            case_id=f"case-{index}",
            agent="claude",
            actual_model="actual-model",
            repetition=0,
            seed=17,
        )
        for index in range(6)
    )
    return ConfirmatoryAnalysisPlan(
        plan_id="canonical-family-v1",
        registry_sha256="a" * 64,
        family_id="canonical-primary-v1",
        alpha=0.05,
        comparisons=(
            PlannedComparison(
                comparison_id="H1",
                treatment_condition="memorix-canonical",
                control_condition="no-memory",
                power_plan_sha256="b" * 64,
                required_clusters=6,
            ),
            PlannedComparison(
                comparison_id="H2",
                treatment_condition="memorix-canonical",
                control_condition="last-n",
                power_plan_sha256="c" * 64,
                required_clusters=6,
            ),
        ),
        planned_pairs=pairs,
    )


def _result(pair: PlannedPair, condition: str) -> RunResult:
    return RunResult(
        case_id=pair.case_id,
        condition=condition,
        agent=pair.agent,
        model="client-route-alias",
        repetition=pair.repetition,
        seed=pair.seed,
        task_success=condition != "no-memory",
        evidence_tier="confirmatory",
        predecessor_dependency="high",
        dependency_classification_status="preregistered",
        study_track="C",
        formation_track="trace-replay",
        precursor_trace_sha256=f"trace-{pair.case_id}",
        reported_models=(pair.actual_model,),
        model_profile="single",
        case_definition_sha256=f"case-definition-{pair.case_id}",
        oracle_definition_sha256=f"oracle-definition-{pair.case_id}",
        registry_sha256="a" * 64,
    )


def test_analysis_plan_round_trips_and_selects_exact_frozen_rows(tmp_path: Path) -> None:
    plan = _plan()
    path = tmp_path / "analysis-plan.json"
    assert write_confirmatory_analysis_plan(path, plan) == path
    loaded = load_confirmatory_analysis_plan(path)
    assert loaded == plan
    assert len(loaded.sha256) == 64

    rows = [
        _result(pair, condition)
        for pair in plan.planned_pairs
        for condition in ("memorix-canonical", "no-memory", "last-n")
    ]
    selected = validate_confirmatory_results(
        plan,
        family_id="canonical-primary-v1",
        comparisons=(
            ("H1", "memorix-canonical", "no-memory"),
            ("H2", "memorix-canonical", "last-n"),
        ),
        results=rows,
    )
    assert len(selected) == 18
    assert {item.actual_model_id for item in selected} == {"actual-model"}


def test_analysis_plan_rejects_missing_invalid_or_multi_cohort_rows() -> None:
    plan = _plan()
    rows = [
        _result(pair, condition)
        for pair in plan.planned_pairs
        for condition in ("memorix-canonical", "no-memory", "last-n")
    ]
    with pytest.raises(ConfirmatoryAnalysisPlanError, match="missing or extra"):
        validate_confirmatory_results(
            plan,
            family_id=plan.family_id,
            comparisons=(
                ("H1", "memorix-canonical", "no-memory"),
                ("H2", "memorix-canonical", "last-n"),
            ),
            results=rows[:-1],
        )

    invalid = [*rows]
    invalid[0] = replace(invalid[0], valid_run=False, failure_reason="timeout")
    with pytest.raises(ConfirmatoryAnalysisPlanError, match="invalid infrastructure"):
        validate_confirmatory_results(
            plan,
            family_id=plan.family_id,
            comparisons=(
                ("H1", "memorix-canonical", "no-memory"),
                ("H2", "memorix-canonical", "last-n"),
            ),
            results=invalid,
        )

    with pytest.raises(ConfirmatoryAnalysisPlanError, match="one agent and actual-model cohort"):
        replace(
            plan,
            planned_pairs=(
                *plan.planned_pairs,
                PlannedPair(
                    case_id="case-other",
                    agent="codex",
                    actual_model="other-model",
                    repetition=0,
                    seed=17,
                ),
            ),
        ).validate()
