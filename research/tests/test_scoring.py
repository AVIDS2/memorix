from dataclasses import replace
import json
from pathlib import Path

import pytest

import memorixbench.scoring as scoring
from memorixbench.scoring import (
    RunResult,
    cluster_sign_flip_p,
    collect_result_payloads,
    compare_conditions,
    exact_mcnemar_p,
    holm_adjust_p_values,
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
        model_profile="single",
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
    assert comparison.clusters == 2
    assert comparison.analysis_unit == "case-within-agent-actual-model-cohort-v1"
    assert comparison.treatment_favored_clusters == 1
    assert comparison.control_favored_clusters == 0
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
        model_profile="single",
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


def test_holm_adjustment_is_order_invariant_and_monotone_for_ties() -> None:
    adjusted = holm_adjust_p_values({"H2": 0.04, "H1": 0.01, "H3": 0.03})

    assert adjusted == {
        "H2": pytest.approx(0.06),
        "H1": pytest.approx(0.03),
        "H3": pytest.approx(0.06),
    }
    tied = holm_adjust_p_values({"b": 0.02, "a": 0.02})
    assert tied == {"b": pytest.approx(0.04), "a": pytest.approx(0.04)}


def test_holm_adjustment_rejects_empty_or_invalid_input() -> None:
    with pytest.raises(ValueError, match="at least one"):
        holm_adjust_p_values({})
    with pytest.raises(ValueError, match="finite probabilities"):
        holm_adjust_p_values({"H1": 1.1})


def test_clustered_inference_does_not_count_retries_as_independent_cases() -> None:
    case_a = [
        replace(run("case-a", "memorix-full", True), repetition=index, seed=index)
        for index in range(3)
    ] + [
        replace(run("case-a", "no-memory", False), repetition=index, seed=index)
        for index in range(3)
    ]
    case_b = [
        run("case-b", "memorix-full", False),
        run("case-b", "no-memory", True),
    ]

    comparison = compare_conditions(
        [*case_a, *case_b],
        treatment="memorix-full",
        control="no-memory",
        bootstrap_samples=100,
        permutation_samples=100,
    )

    assert comparison.pairs == 4
    assert comparison.clusters == 2
    assert comparison.treatment_success_rate == 0.5
    assert comparison.control_success_rate == 0.5
    assert comparison.absolute_difference == 0.0
    assert comparison.treatment_favored_clusters == 1
    assert comparison.control_favored_clusters == 1
    assert comparison.cluster_sign_flip_p == 1.0


def test_clustered_sign_flip_is_exact_for_small_cluster_counts() -> None:
    assert cluster_sign_flip_p([1.0, -1.0]) == 1.0
    assert cluster_sign_flip_p([1.0, 1.0, 1.0]) == pytest.approx(0.25)


def test_actual_model_telemetry_defines_pair_and_cluster_identity() -> None:
    alias_a = replace(
        run("case-a", "memorix-full", True),
        model="client-alias-a",
        reported_models=("actual-model",),
    )
    alias_b = replace(
        run("case-a", "no-memory", False),
        model="client-alias-b",
        reported_models=("actual-model",),
    )

    assert alias_a.pair_key == alias_b.pair_key
    assert alias_a.cluster_key == alias_b.cluster_key


def test_native_session_results_require_and_pair_on_native_capture() -> None:
    payload = {
        "case_id": "case-native",
        "condition": "memorix-1.2.1-native-autopilot-local",
        "agent": "claude",
        "model": "model-a",
        "repetition": 0,
        "seed": 7,
        "task_success": True,
        "evidence_tier": "development",
        "predecessor_dependency": "medium",
        "dependency_classification_status": "retrospective-development",
        "study_track": "C",
        "formation_track": "native-session",
        "native_hook_capture_sha256": "a" * 64,
        "case_definition_sha256": "b" * 64,
        "oracle_definition_sha256": "c" * 64,
        "reported_models": ["model-a"],
        "model_profile": "single",
    }
    treatment = RunResult.from_dict(payload)
    control = RunResult.from_dict({**payload, "condition": "no-memory", "task_success": False})

    comparison = compare_conditions(
        [treatment, control],
        treatment="memorix-1.2.1-native-autopilot-local",
        control="no-memory",
        bootstrap_samples=100,
        require_confirmatory=False,
    )

    assert comparison.pairs == 1
    with pytest.raises(ValueError, match="native_hook_capture_sha256"):
        RunResult.from_dict({key: value for key, value in payload.items() if key != "native_hook_capture_sha256"})


def test_confirmatory_comparison_rejects_pooled_agent_or_actual_model_cohorts() -> None:
    claude_treatment = replace(run("case-b", "memorix-full", True), agent="claude")
    claude_control = replace(run("case-b", "no-memory", False), agent="claude")

    with pytest.raises(ValueError, match="one agent and actual-model cohort"):
        compare_conditions(
            [
                run("case-a", "memorix-full", True),
                run("case-a", "no-memory", False),
                claude_treatment,
                claude_control,
            ],
            treatment="memorix-full",
            control="no-memory",
            bootstrap_samples=100,
        )


def test_run_result_rejects_string_boolean_or_invalid_failure_metadata() -> None:
    payload = {
        "case_id": "case-a",
        "condition": "no-memory",
        "agent": "claude",
        "model": "model-a",
        "repetition": 0,
        "seed": 7,
        "task_success": False,
        "valid_run": "false",
    }
    with pytest.raises(ValueError, match="valid_run must be a boolean"):
        RunResult.from_dict(payload)
    payload["valid_run"] = False
    with pytest.raises(ValueError, match="require a failure_reason"):
        RunResult.from_dict(payload)


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


def test_collects_direct_run_results_without_recursing_agent_caches(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    run_dir = tmp_path / "runs" / "run-a"
    run_dir.mkdir(parents=True)
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
    (run_dir / "result.json").write_text(json.dumps(payload), encoding="utf-8")

    def fail_recursive_scan(*_args: object, **_kwargs: object) -> object:
        raise AssertionError("direct run collection must not recurse into agent caches")

    monkeypatch.setattr(scoring.Path, "rglob", fail_recursive_scan)

    assert collect_result_payloads(tmp_path) == [payload]


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
        model_profile="single",
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
        model_profile="single",
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
        model_profile="single",
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
        model_profile="single",
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


def test_rejects_mixed_models_without_a_development_diagnostic_override() -> None:
    treatment = replace(
        run("case-a", "memorix-full", True),
        reported_models=("model-a", "model-b"),
        model_profile="mixed",
    )
    control = replace(
        run("case-a", "no-memory", False),
        reported_models=("model-a", "model-b"),
        model_profile="mixed",
    )

    with pytest.raises(ValueError, match="single actual model"):
        compare_conditions(
            [treatment, control],
            treatment="memorix-full",
            control="no-memory",
            bootstrap_samples=100,
        )

    comparison = compare_conditions(
        [treatment, control],
        treatment="memorix-full",
        control="no-memory",
        bootstrap_samples=100,
        require_confirmatory=False,
        allow_mixed_models=True,
    )

    assert comparison.pairs == 1


def test_rejects_an_inconsistent_model_profile() -> None:
    with pytest.raises(ValueError, match="single model_profile"):
        RunResult.from_dict({
            "case_id": "case-a",
            "condition": "no-memory",
            "agent": "claude",
            "model": "model-a",
            "repetition": 0,
            "seed": 7,
            "task_success": False,
            "reported_models": ["model-a", "model-b"],
            "model_profile": "single",
        })


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
    assert require_annotated_secondary(
        [annotated],
        metric="stale-claim-conflict-actions",
    ) == [annotated]
