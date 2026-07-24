import json
from pathlib import Path

import pytest

from memorixbench.power import (
    CONSERVATIVE_POWER_PLAN_SCHEMA_VERSION,
    PowerPlanningError,
    build_conservative_power_plan,
    exact_paired_binary_power,
    write_conservative_power_plan,
)


def test_exact_paired_binary_power_respects_exact_mcnemar_threshold() -> None:
    assert exact_paired_binary_power(
        clusters=5,
        treatment_only_probability=1.0,
        control_only_probability=0.0,
    ) == 0.0
    assert exact_paired_binary_power(
        clusters=6,
        treatment_only_probability=1.0,
        control_only_probability=0.0,
    ) == 1.0


def test_power_plan_uses_the_largest_requirement_across_predeclared_scenarios() -> None:
    plan = build_conservative_power_plan(
        planning_id="test-envelope",
        treatment_condition="memorix-canonical",
        control_condition="no-memory",
        absolute_minimum_detectable_difference=0.3,
        expected_discordances=(0.3, 0.6),
        min_clusters=6,
        max_clusters=120,
        step=2,
    )

    requirements = [scenario.required_clusters for scenario in plan.scenarios]
    assert all(requirement is not None for requirement in requirements)
    assert plan.required_clusters == max(requirements)
    assert plan.scenarios[0].treatment_only_probability == pytest.approx(0.3)
    assert plan.scenarios[0].control_only_probability == pytest.approx(0.0)
    assert plan.per_comparison_alpha == pytest.approx(0.05)
    assert plan.required_clusters is not None
    assert plan.required_clusters >= 6


def test_power_plan_fails_closed_when_the_declared_search_range_cannot_reach_target() -> None:
    plan = build_conservative_power_plan(
        planning_id="too-small",
        treatment_condition="memorix-canonical",
        control_condition="no-memory",
        absolute_minimum_detectable_difference=0.1,
        expected_discordances=(0.5,),
        min_clusters=10,
        max_clusters=20,
        step=5,
    )

    assert plan.required_clusters is None
    assert plan.scenarios[0].required_clusters is None


def test_power_plan_rejects_an_invalid_difference_and_refuses_overwrite(tmp_path: Path) -> None:
    with pytest.raises(PowerPlanningError, match="must not exceed"):
        build_conservative_power_plan(
            planning_id="invalid",
            treatment_condition="memorix-canonical",
            control_condition="no-memory",
            absolute_minimum_detectable_difference=0.4,
            expected_discordances=(0.3,),
        )

    plan = build_conservative_power_plan(
        planning_id="write-test",
        treatment_condition="memorix-canonical",
        control_condition="no-memory",
        absolute_minimum_detectable_difference=0.2,
        expected_discordances=(0.2,),
        min_clusters=6,
        max_clusters=10,
        step=2,
    )
    output = tmp_path / "power-plan.json"
    assert write_conservative_power_plan(output, plan) == output
    payload = json.loads(output.read_text(encoding="utf-8"))
    assert payload["schema_version"] == CONSERVATIVE_POWER_PLAN_SCHEMA_VERSION
    assert payload["status"] == "planning-only-not-an-experimental-result"
    assert payload["planning_assumption"]["repeat_precision_credit"] == "none"
    assert payload["multiplicity_planning"]["method"] == "bonferroni-conservative-v1"
    assert payload["comparison"] == {
        "treatment_condition": "memorix-canonical",
        "control_condition": "no-memory",
    }
    assert len(payload["plan_sha256"]) == 64

    with pytest.raises(PowerPlanningError, match="must not already exist"):
        write_conservative_power_plan(output, plan)


def test_power_plan_rejects_a_self_comparison() -> None:
    with pytest.raises(PowerPlanningError, match="must differ"):
        build_conservative_power_plan(
            planning_id="self-comparison",
            treatment_condition="no-memory",
            control_condition="no-memory",
            absolute_minimum_detectable_difference=0.2,
            expected_discordances=(0.2,),
        )


def test_power_plan_uses_a_conservative_bonferroni_threshold_for_a_family() -> None:
    plan = build_conservative_power_plan(
        planning_id="family-plan",
        treatment_condition="memorix-canonical",
        control_condition="no-memory",
        absolute_minimum_detectable_difference=0.3,
        expected_discordances=(0.3,),
        family_size=2,
        min_clusters=6,
        max_clusters=120,
        step=2,
    )

    assert plan.family_size == 2
    assert plan.per_comparison_alpha == pytest.approx(0.025)
