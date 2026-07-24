import json
from pathlib import Path

import pytest

from memorixbench.memorix_adapter import MEMORIX_CANONICAL_PROVIDER_ID
from memorixbench.public_analysis import (
    analyze_public_cohort,
    write_public_cohort_analysis,
    write_public_cohort_summary,
)
from memorixbench.public_cohort import (
    PUBLIC_COHORT_PLAN_SCHEMA_VERSION,
    PublicCohortPlan,
    PublicCohortPlanError,
    RepetitionSpec,
    load_public_cohort_plan,
    validate_public_cohort_results,
)


MODEL = "qwen/qwen3-coder-30b-a3b-instruct"


def _plan(tmp_path: Path) -> PublicCohortPlan:
    return PublicCohortPlan(
        schema_version=PUBLIC_COHORT_PLAN_SCHEMA_VERSION,
        plan_id="test-public-cohort",
        registry_id="test-registry",
        registry_sha256="a" * 64,
        agent="openrouter",
        model=MODEL,
        case_ids=("case-a",),
        conditions=("no-memory", MEMORIX_CANONICAL_PROVIDER_ID),
        repetitions=(RepetitionSpec(repetition=1, seed=101),),
        timeout_seconds=300,
        max_budget_usd=0.1,
        primary_treatment=MEMORIX_CANONICAL_PROVIDER_ID,
        primary_control="no-memory",
        source_path=tmp_path / "plan.json",
    )


def _row(condition: str) -> dict[str, object]:
    return {
        "study_id": "test-public-cohort",
        "case_id": "case-a",
        "condition": condition,
        "repetition": 1,
        "seed": 101,
        "evidence_tier": "public-reproducible",
        "case_registry_id": "test-registry",
        "case_registry_sha256": "a" * 64,
        "agent": "openrouter",
        "model": MODEL,
        "reported_models": [MODEL],
        "model_profile": "single",
        "valid_run": True,
        "task_success": condition == MEMORIX_CANONICAL_PROVIDER_ID,
        "predecessor_dependency": "medium",
        "dependency_classification_status": "preregistered",
        "study_track": "B",
        "formation_track": "seeded-canonical",
        "case_definition_sha256": "b" * 64,
        "oracle_definition_sha256": "c" * 64,
        "full_tool_policy_sha256": "d" * 64,
        "memorix_cli_sha256": "e" * 64 if condition == MEMORIX_CANONICAL_PROVIDER_ID else None,
        "wall_seconds": 12.0 if condition == MEMORIX_CANONICAL_PROVIDER_ID else 18.0,
        "input_tokens": 200 if condition == MEMORIX_CANONICAL_PROVIDER_ID else 400,
        "output_tokens": 50 if condition == MEMORIX_CANONICAL_PROVIDER_ID else 80,
        "cost_usd": 0.002 if condition == MEMORIX_CANONICAL_PROVIDER_ID else 0.004,
        "tool_call_count": 5 if condition == MEMORIX_CANONICAL_PROVIDER_ID else 9,
    }


def test_load_public_cohort_plan_requires_the_primary_contrast(tmp_path: Path) -> None:
    path = tmp_path / "plan.json"
    path.write_text(json.dumps({
        "schema_version": PUBLIC_COHORT_PLAN_SCHEMA_VERSION,
        "plan_id": "test-public-cohort",
        "registry_id": "test-registry",
        "registry_sha256": "a" * 64,
        "agent": "openrouter",
        "model": MODEL,
        "case_ids": ["case-a"],
        "conditions": [MEMORIX_CANONICAL_PROVIDER_ID],
        "repetitions": [{"repetition": 1, "seed": 101}],
        "timeout_seconds": 300,
        "max_budget_usd": 0.1,
        "primary_treatment": MEMORIX_CANONICAL_PROVIDER_ID,
        "primary_control": "no-memory",
    }), encoding="utf-8")

    with pytest.raises(PublicCohortPlanError, match="requires no-memory"):
        load_public_cohort_plan(path)


def test_public_cohort_result_matrix_requires_every_frozen_row(tmp_path: Path) -> None:
    plan = _plan(tmp_path)
    root = tmp_path / "results"
    run = root / "runs" / "one"
    run.mkdir(parents=True)
    (run / "result.json").write_text(
        json.dumps(_row("no-memory")),
        encoding="utf-8",
    )

    with pytest.raises(PublicCohortPlanError, match="incomplete"):
        validate_public_cohort_results(plan, results_root=root)

    second = root / "runs" / "two"
    second.mkdir(parents=True)
    (second / "result.json").write_text(
        json.dumps(_row(MEMORIX_CANONICAL_PROVIDER_ID)),
        encoding="utf-8",
    )

    validation = validate_public_cohort_results(plan, results_root=root)

    assert validation.expected_rows == 2
    assert validation.valid_rows == 2
    assert validation.task_success_rows == 1
    assert validation.full_tool_policy_sha256 == "d" * 64
    assert validation.memorix_cli_sha256 == "e" * 64

    canonical_path = second / "result.json"
    canonical = json.loads(canonical_path.read_text(encoding="utf-8"))
    canonical["study_id"] = "wrong-study"
    canonical_path.write_text(json.dumps(canonical), encoding="utf-8")
    with pytest.raises(PublicCohortPlanError, match="study id"):
        validate_public_cohort_results(plan, results_root=root)

    canonical["study_id"] = "test-public-cohort"
    canonical["memorix_cli_sha256"] = None
    canonical_path.write_text(json.dumps(canonical), encoding="utf-8")
    with pytest.raises(PublicCohortPlanError, match="memorix_cli_sha256"):
        validate_public_cohort_results(plan, results_root=root)


def test_public_cohort_analysis_clusters_repetitions_and_writes_immutable_output(tmp_path: Path) -> None:
    plan = _plan(tmp_path)
    root = tmp_path / "results"
    for index, condition in enumerate(("no-memory", MEMORIX_CANONICAL_PROVIDER_ID), 1):
        run = root / "runs" / str(index)
        run.mkdir(parents=True)
        (run / "result.json").write_text(json.dumps(_row(condition)), encoding="utf-8")

    analysis = analyze_public_cohort(plan, results_root=root, bootstrap_samples=100)

    assert analysis.primary_success.clusters == 1
    assert analysis.primary_success.absolute_difference == 1.0
    assert analysis.secondary_success == ()
    assert analysis.primary_resources[0].metric == "wall_seconds"
    assert analysis.primary_resources[0].treatment_minus_control == -6.0
    assert analysis.failure_summaries[0].task_failure_rows == 1
    output = write_public_cohort_analysis(tmp_path / "analysis.json", analysis)
    assert json.loads(output.read_text(encoding="utf-8"))["inference_status"] == (
        "descriptive-public-cohort-not-confirmatory-v1"
    )
    with pytest.raises(PublicCohortPlanError, match="must not already exist"):
        write_public_cohort_analysis(output, analysis)

    summary = write_public_cohort_summary(tmp_path / "public-cohort.json", analysis)
    payload = json.loads(summary.read_text(encoding="utf-8"))
    assert payload["schema_version"] == "public-cohort-summary-v1"
    assert payload["evidence_tier"] == "public-reproducible"
    assert payload["analysis"]["primary_success"]["absolute_difference"] == 1.0
    write_public_cohort_summary(
        summary,
        analysis,
        replace_expected_analysis_sha256=payload["analysis_sha256"],
    )
    with pytest.raises(PublicCohortPlanError, match="hash does not match"):
        write_public_cohort_summary(
            summary,
            analysis,
            replace_expected_analysis_sha256="f" * 64,
        )
