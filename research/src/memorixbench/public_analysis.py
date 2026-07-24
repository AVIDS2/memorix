"""Fail-closed descriptive analysis for a frozen public cohort."""

from __future__ import annotations

from dataclasses import asdict, dataclass
import hashlib
import json
import os
from pathlib import Path
import random
import re
from typing import Literal

from .public_cohort import (
    PublicCohortPlan,
    PublicCohortPlanError,
    PublicCohortValidation,
    validate_public_cohort_results,
)
from .scoring import (
    PairedComparison,
    RunResult,
    cluster_sign_flip_p,
    collect_result_payloads,
    compare_conditions,
)


PUBLIC_COHORT_ANALYSIS_SCHEMA_VERSION = "public-reproducible-cohort-analysis-v1"
PUBLIC_COHORT_SUMMARY_SCHEMA_VERSION = "public-cohort-summary-v1"
SHA256_PATTERN = re.compile(r"^[0-9a-f]{64}$")
RESOURCE_METRICS: tuple[tuple[str, Literal["lower-is-better", "higher-is-better"]], ...] = (
    ("wall_seconds", "lower-is-better"),
    ("input_tokens", "lower-is-better"),
    ("output_tokens", "lower-is-better"),
    ("cost_usd", "lower-is-better"),
    ("tool_call_count", "lower-is-better"),
)


@dataclass(frozen=True)
class PublicResourceComparison:
    metric: str
    direction: Literal["lower-is-better", "higher-is-better"]
    clusters: int
    treatment_mean: float
    control_mean: float
    treatment_minus_control: float
    confidence_interval: tuple[float, float]
    descriptive_sign_flip_p: float
    treatment_favored_clusters: int
    control_favored_clusters: int

    def public_payload(self) -> dict[str, object]:
        return asdict(self)


@dataclass(frozen=True)
class PublicFailureSummary:
    condition: str
    valid_rows: int
    task_success_rows: int
    task_failure_rows: int
    failure_reason_counts: dict[str, int]

    def public_payload(self) -> dict[str, object]:
        return asdict(self)


@dataclass(frozen=True)
class PublicCohortAnalysis:
    plan_id: str
    registry_id: str
    registry_sha256: str
    evidence_tier: str
    inference_status: str
    result_validation: PublicCohortValidation
    primary_success: PairedComparison
    secondary_success: tuple[PairedComparison, ...]
    primary_resources: tuple[PublicResourceComparison, ...]
    failure_summaries: tuple[PublicFailureSummary, ...]

    def public_payload(self) -> dict[str, object]:
        return {
            "schema_version": PUBLIC_COHORT_ANALYSIS_SCHEMA_VERSION,
            "plan_id": self.plan_id,
            "registry_id": self.registry_id,
            "registry_sha256": self.registry_sha256,
            "evidence_tier": self.evidence_tier,
            "inference_status": self.inference_status,
            "result_validation": self.result_validation.public_payload(),
            "primary_success": asdict(self.primary_success),
            "secondary_success": [asdict(item) for item in self.secondary_success],
            "primary_resources": [item.public_payload() for item in self.primary_resources],
            "failure_summaries": [item.public_payload() for item in self.failure_summaries],
        }


def _bootstrap_difference(
    differences: tuple[float, ...],
    *,
    samples: int,
    seed: int,
) -> tuple[float, float]:
    if not differences:
        raise PublicCohortPlanError("public resource analysis requires at least one cluster")
    if samples < 100:
        raise PublicCohortPlanError("public resource bootstrap requires at least 100 samples")
    rng = random.Random(seed)
    size = len(differences)
    estimates = sorted(
        sum(differences[rng.randrange(size)] for _ in range(size)) / size
        for _ in range(samples)
    )
    return (
        estimates[int((samples - 1) * 0.025)],
        estimates[int((samples - 1) * 0.975)],
    )


def _case_metric_means(
    results: tuple[RunResult, ...],
    *,
    condition: str,
    metric: str,
    expected_repetitions: int,
) -> dict[str, float]:
    grouped: dict[str, list[float]] = {}
    for result in results:
        if result.condition != condition:
            continue
        value = getattr(result, metric)
        if value is None:
            raise PublicCohortPlanError(
                f"public cohort result is missing {metric} for {result.case_id} / {condition}"
            )
        grouped.setdefault(result.case_id, []).append(float(value))
    if not grouped:
        raise PublicCohortPlanError(f"public cohort has no results for {condition}")
    for case_id, values in grouped.items():
        if len(values) != expected_repetitions:
            raise PublicCohortPlanError(
                f"public cohort has the wrong repetition count for {case_id} / {condition}"
            )
    return {case_id: sum(values) / len(values) for case_id, values in grouped.items()}


def _resource_comparison(
    results: tuple[RunResult, ...],
    *,
    treatment: str,
    control: str,
    metric: str,
    direction: Literal["lower-is-better", "higher-is-better"],
    expected_repetitions: int,
    bootstrap_samples: int,
    bootstrap_seed: int,
) -> PublicResourceComparison:
    treatment_means = _case_metric_means(
        results,
        condition=treatment,
        metric=metric,
        expected_repetitions=expected_repetitions,
    )
    control_means = _case_metric_means(
        results,
        condition=control,
        metric=metric,
        expected_repetitions=expected_repetitions,
    )
    if set(treatment_means) != set(control_means):
        raise PublicCohortPlanError("public resource comparison has unmatched case clusters")
    treatment_values = tuple(treatment_means[case_id] for case_id in sorted(treatment_means))
    control_values = tuple(control_means[case_id] for case_id in sorted(control_means))
    differences = tuple(
        treatment_value - control_value
        for treatment_value, control_value in zip(treatment_values, control_values, strict=True)
    )
    if direction == "lower-is-better":
        treatment_favored = sum(treatment_value < control_value for treatment_value, control_value in zip(treatment_values, control_values, strict=True))
        control_favored = sum(control_value < treatment_value for treatment_value, control_value in zip(treatment_values, control_values, strict=True))
    else:
        treatment_favored = sum(treatment_value > control_value for treatment_value, control_value in zip(treatment_values, control_values, strict=True))
        control_favored = sum(control_value > treatment_value for treatment_value, control_value in zip(treatment_values, control_values, strict=True))
    return PublicResourceComparison(
        metric=metric,
        direction=direction,
        clusters=len(differences),
        treatment_mean=sum(treatment_values) / len(treatment_values),
        control_mean=sum(control_values) / len(control_values),
        treatment_minus_control=sum(differences) / len(differences),
        confidence_interval=_bootstrap_difference(
            differences,
            samples=bootstrap_samples,
            seed=bootstrap_seed,
        ),
        descriptive_sign_flip_p=cluster_sign_flip_p(
            differences,
            samples=100_000,
            seed=bootstrap_seed,
        ),
        treatment_favored_clusters=treatment_favored,
        control_favored_clusters=control_favored,
    )


def _failure_summaries(
    results: tuple[RunResult, ...],
    *,
    conditions: tuple[str, ...],
) -> tuple[PublicFailureSummary, ...]:
    summaries: list[PublicFailureSummary] = []
    for condition in conditions:
        rows = [result for result in results if result.condition == condition]
        reasons: dict[str, int] = {}
        for result in rows:
            if result.task_success:
                continue
            reason = result.failure_reason or "no-agent-failure-reason-recorded"
            reasons[reason] = reasons.get(reason, 0) + 1
        summaries.append(PublicFailureSummary(
            condition=condition,
            valid_rows=len(rows),
            task_success_rows=sum(result.task_success for result in rows),
            task_failure_rows=sum(not result.task_success for result in rows),
            failure_reason_counts=dict(sorted(reasons.items())),
        ))
    return tuple(summaries)


def analyze_public_cohort(
    plan: PublicCohortPlan,
    *,
    results_root: str | Path,
    bootstrap_samples: int = 10_000,
    bootstrap_seed: int = 1729,
) -> PublicCohortAnalysis:
    validation = validate_public_cohort_results(plan, results_root=results_root)
    if validation.invalid_rows:
        raise PublicCohortPlanError("public cohort analysis requires zero invalid rows")
    results = tuple(RunResult.from_dict(payload) for payload in collect_result_payloads(results_root))
    success = compare_conditions(
        results,
        treatment=plan.primary_treatment,
        control=plan.primary_control,
        bootstrap_samples=bootstrap_samples,
        bootstrap_seed=bootstrap_seed,
        require_confirmatory=False,
        include_low_dependency=True,
    )
    secondary_success = tuple(
        compare_conditions(
            results,
            treatment=condition,
            control=plan.primary_control,
            bootstrap_samples=bootstrap_samples,
            bootstrap_seed=bootstrap_seed,
            require_confirmatory=False,
            include_low_dependency=True,
        )
        for condition in plan.conditions
        if condition not in {plan.primary_control, plan.primary_treatment}
    )
    resources = tuple(
        _resource_comparison(
            results,
            treatment=plan.primary_treatment,
            control=plan.primary_control,
            metric=metric,
            direction=direction,
            expected_repetitions=len(plan.repetitions),
            bootstrap_samples=bootstrap_samples,
            bootstrap_seed=bootstrap_seed,
        )
        for metric, direction in RESOURCE_METRICS
    )
    return PublicCohortAnalysis(
        plan_id=plan.plan_id,
        registry_id=plan.registry_id,
        registry_sha256=plan.registry_sha256,
        evidence_tier="public-reproducible",
        inference_status="descriptive-public-cohort-not-confirmatory-v1",
        result_validation=validation,
        primary_success=success,
        secondary_success=secondary_success,
        primary_resources=resources,
        failure_summaries=_failure_summaries(results, conditions=plan.conditions),
    )


def write_public_cohort_analysis(path: str | Path, analysis: PublicCohortAnalysis) -> Path:
    target = Path(path).resolve()
    if target.exists():
        raise PublicCohortPlanError("public cohort analysis output must not already exist")
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(
        json.dumps(analysis.public_payload(), indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    return target


def public_cohort_summary_payload(analysis: PublicCohortAnalysis) -> dict[str, object]:
    analysis_payload = analysis.public_payload()
    canonical = json.dumps(
        analysis_payload,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=True,
    ).encode("ascii")
    return {
        "schema_version": PUBLIC_COHORT_SUMMARY_SCHEMA_VERSION,
        "evidence_tier": "public-reproducible",
        "analysis_sha256": hashlib.sha256(canonical).hexdigest(),
        "analysis": analysis_payload,
    }


def write_public_cohort_summary(
    path: str | Path,
    analysis: PublicCohortAnalysis,
    *,
    replace_expected_analysis_sha256: str | None = None,
) -> Path:
    target = Path(path).resolve()
    if replace_expected_analysis_sha256 is not None and not SHA256_PATTERN.fullmatch(
        replace_expected_analysis_sha256
    ):
        raise PublicCohortPlanError("public cohort replacement hash must be a SHA-256")
    if target.exists():
        if replace_expected_analysis_sha256 is None:
            raise PublicCohortPlanError("public cohort summary output must not already exist")
        try:
            existing = json.loads(target.read_text(encoding="utf-8"))
        except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
            raise PublicCohortPlanError("existing public cohort summary cannot be read") from error
        if not isinstance(existing, dict) or (
            existing.get("analysis_sha256") != replace_expected_analysis_sha256
        ):
            raise PublicCohortPlanError("existing public cohort summary hash does not match")
    target.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(public_cohort_summary_payload(analysis), indent=2, sort_keys=True) + "\n"
    replacement = target.with_name(target.name + ".replacement")
    if replacement.exists():
        raise PublicCohortPlanError("public cohort summary replacement path already exists")
    try:
        replacement.write_text(payload, encoding="utf-8")
        os.replace(replacement, target)
    except OSError as error:
        try:
            replacement.unlink(missing_ok=True)
        except OSError:
            pass
        raise PublicCohortPlanError("public cohort summary cannot be written") from error
    return target
