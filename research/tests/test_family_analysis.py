import json
from pathlib import Path
from types import SimpleNamespace

import pytest

from memorixbench.analysis_plan import (
    ConfirmatoryAnalysisPlan,
    PlannedComparison,
    PlannedPair,
    write_confirmatory_analysis_plan,
)
from memorixbench.cli import _compare, _compare_family, _parse_family_comparison
from memorixbench.scoring import RunResult, write_jsonl


def _run(case_id: str, condition: str, success: bool) -> RunResult:
    return RunResult(
        case_id=case_id,
        condition=condition,
        agent="claude",
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
        model_profile="single",
        case_definition_sha256=f"case-{case_id}",
        oracle_definition_sha256=f"oracle-{case_id}",
        registry_sha256="a" * 64,
    )


def test_compare_family_writes_holm_adjusted_immutable_output(tmp_path: Path) -> None:
    results = tmp_path / "results.jsonl"
    rows: list[dict[str, object]] = []
    for index in range(6):
        case_id = f"case-{index}"
        for result in (
            _run(case_id, "memorix-canonical", True),
            _run(case_id, "no-memory", False),
            _run(case_id, "last-n", True),
        ):
            rows.append(result.__dict__)
    write_jsonl(results, rows)
    plan = ConfirmatoryAnalysisPlan(
        plan_id="canonical-primary-test-v1",
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
        planned_pairs=tuple(
            PlannedPair(
                case_id=f"case-{index}",
                agent="claude",
                actual_model="model-a",
                repetition=0,
                seed=7,
            )
            for index in range(6)
        ),
    )
    analysis_plan = tmp_path / "analysis-plan.json"
    write_confirmatory_analysis_plan(analysis_plan, plan)
    output = tmp_path / "family.json"
    args = SimpleNamespace(
        results=results,
        family_id="canonical-primary-v1",
        comparison=[
            "H1:memorix-canonical:no-memory",
            "H2:memorix-canonical:last-n",
        ],
        output=output,
        analysis_plan=analysis_plan,
        alpha=0.05,
        bootstrap_samples=100,
        bootstrap_seed=1729,
        allow_development=False,
        include_low_dependency=False,
        allow_mixed_models=False,
    )

    assert _compare_family(args) == 0
    payload = json.loads(output.read_text(encoding="utf-8"))
    assert payload["schema_version"] == "paired-comparison-family-v1"
    assert payload["status"] == "confirmatory-analysis-output"
    assert payload["analysis_plan_id"] == plan.plan_id
    assert len(payload["analysis_plan_sha256"]) == 64
    assert payload["evidence_policy"] == {
        "require_confirmatory": True,
        "include_low_dependency": False,
        "allow_mixed_models": False,
    }
    assert payload["multiplicity_method"] == "holm-bonferroni-v1"
    assert len(payload["family_result_sha256"]) == 64
    assert payload["comparisons"][0]["comparison_id"] == "H1"
    assert payload["comparisons"][0]["raw_p_value"] == pytest.approx(0.03125)
    assert payload["comparisons"][0]["holm_adjusted_p_value"] == pytest.approx(0.0625)
    assert payload["comparisons"][0]["reject_at_alpha"] is False
    assert payload["comparisons"][1]["raw_p_value"] == 1.0

    with pytest.raises(ValueError, match="must not already exist"):
        _compare_family(args)


def test_compare_family_specification_rejects_ambiguous_or_self_pairs() -> None:
    assert _parse_family_comparison("H1:memory:no-memory") == (
        "H1",
        "memory",
        "no-memory",
    )
    with pytest.raises(ValueError, match="must use"):
        _parse_family_comparison("H1:memory")
    with pytest.raises(ValueError, match="must differ"):
        _parse_family_comparison("H1:memory:memory")


def test_single_comparison_command_refuses_to_create_confirmatory_output() -> None:
    with pytest.raises(ValueError, match="compare-family with --analysis-plan"):
        _compare(SimpleNamespace(allow_development=False))
