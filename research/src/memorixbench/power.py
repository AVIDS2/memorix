"""Conservative, preregistration-time power planning for paired clusters."""

from __future__ import annotations

from dataclasses import asdict, dataclass
import hashlib
import json
import math
from pathlib import Path

from .scoring import exact_mcnemar_p


CONSERVATIVE_POWER_PLAN_SCHEMA_VERSION = "conservative-cluster-power-plan-v3"
MAX_PLAN_POINTS = 200


class PowerPlanningError(ValueError):
    """Raised when a conservative power plan is not well-defined."""


def _canonical_sha256(payload: dict[str, object]) -> str:
    encoded = json.dumps(
        payload,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=True,
    ).encode("ascii")
    return hashlib.sha256(encoded).hexdigest()


def _require_probability(value: float, *, label: str, allow_zero: bool = True) -> float:
    normalized = float(value)
    if not math.isfinite(normalized) or normalized < 0 or normalized > 1:
        raise PowerPlanningError(f"{label} must be a finite probability between zero and one")
    if not allow_zero and normalized == 0:
        raise PowerPlanningError(f"{label} must be greater than zero")
    return normalized


def _require_positive_int(value: int, *, label: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
        raise PowerPlanningError(f"{label} must be a positive integer")
    return value


def _require_identifier(value: str, *, label: str) -> str:
    normalized = value.strip()
    if not normalized:
        raise PowerPlanningError(f"{label} must be non-empty")
    return normalized


def _term_log_probability(count: int, probability: float) -> float:
    if count == 0:
        return 0.0
    if probability == 0:
        return float("-inf")
    return count * math.log(probability)


def _multinomial_probability(
    *,
    clusters: int,
    treatment_only: int,
    control_only: int,
    treatment_only_probability: float,
    control_only_probability: float,
) -> float:
    ties = clusters - treatment_only - control_only
    tie_probability = 1.0 - treatment_only_probability - control_only_probability
    log_probability = (
        math.lgamma(clusters + 1)
        - math.lgamma(treatment_only + 1)
        - math.lgamma(control_only + 1)
        - math.lgamma(ties + 1)
        + _term_log_probability(treatment_only, treatment_only_probability)
        + _term_log_probability(control_only, control_only_probability)
        + _term_log_probability(ties, tie_probability)
    )
    return 0.0 if log_probability == float("-inf") else math.exp(log_probability)


def exact_paired_binary_power(
    *,
    clusters: int,
    treatment_only_probability: float,
    control_only_probability: float,
    alpha: float = 0.05,
) -> float:
    """Return exact two-sided McNemar power for independent paired clusters.

    This deliberately models one effective paired Bernoulli outcome per
    ``case x agent x actual-model`` cluster. The final analysis remains the
    cluster sign-flip test; under the planning assumption that repeated runs
    within a cluster are perfectly correlated, its non-zero cluster signs are
    exactly the same paired-binary signs tested here.
    """

    cluster_count = _require_positive_int(clusters, label="clusters")
    alpha_value = _require_probability(alpha, label="alpha", allow_zero=False)
    treatment_probability = _require_probability(
        treatment_only_probability,
        label="treatment_only_probability",
    )
    control_probability = _require_probability(
        control_only_probability,
        label="control_only_probability",
    )
    if treatment_probability + control_probability > 1:
        raise PowerPlanningError(
            "treatment_only_probability plus control_only_probability must not exceed one"
        )

    rejected_probability = 0.0
    for treatment_only in range(cluster_count + 1):
        for control_only in range(cluster_count - treatment_only + 1):
            if exact_mcnemar_p(treatment_only, control_only) > alpha_value:
                continue
            rejected_probability += _multinomial_probability(
                clusters=cluster_count,
                treatment_only=treatment_only,
                control_only=control_only,
                treatment_only_probability=treatment_probability,
                control_only_probability=control_probability,
            )
    return min(1.0, max(0.0, rejected_probability))


@dataclass(frozen=True)
class PowerPoint:
    clusters: int
    exact_power: float


@dataclass(frozen=True)
class DiscordanceScenario:
    expected_discordance: float
    treatment_only_probability: float
    control_only_probability: float
    points: tuple[PowerPoint, ...]
    required_clusters: int | None

    def public_payload(self) -> dict[str, object]:
        payload = asdict(self)
        payload["points"] = [asdict(point) for point in self.points]
        return payload


@dataclass(frozen=True)
class ConservativePowerPlan:
    planning_id: str
    treatment_condition: str
    control_condition: str
    absolute_minimum_detectable_difference: float
    alpha: float
    family_size: int
    per_comparison_alpha: float
    target_power: float
    repetitions_per_cluster: int
    min_clusters: int
    max_clusters: int
    step: int
    scenarios: tuple[DiscordanceScenario, ...]
    required_clusters: int | None

    def public_payload(self) -> dict[str, object]:
        payload: dict[str, object] = {
            "schema_version": CONSERVATIVE_POWER_PLAN_SCHEMA_VERSION,
            "planning_id": self.planning_id,
            "status": "planning-only-not-an-experimental-result",
            "comparison": {
                "treatment_condition": self.treatment_condition,
                "control_condition": self.control_condition,
            },
            "analysis_unit": "case-agent-actual-model-cluster-v1",
            "primary_analysis": "two-sided-paired-cluster-sign-flip-v1",
            "planning_test": "two-sided-exact-mcnemar-v1",
            "planning_assumption": {
                "effective_paired_observations_per_cluster": 1,
                "repetitions_per_cluster": self.repetitions_per_cluster,
                "assumed_within_cluster_correlation": 1.0,
                "repeat_precision_credit": "none",
                "reason": (
                    "Repeated runs measure stability but are not counted as "
                    "independent case-agent-model evidence for planning."
                ),
            },
            "absolute_minimum_detectable_difference": self.absolute_minimum_detectable_difference,
            "alpha": self.alpha,
            "multiplicity_planning": {
                "method": "bonferroni-conservative-v1",
                "family_size": self.family_size,
                "family_alpha": self.alpha,
                "per_comparison_alpha": self.per_comparison_alpha,
                "reason": (
                    "The final H1/H2 analysis uses Holm adjustment; planning "
                    "uses the stricter Bonferroni threshold rather than "
                    "claiming unmodeled joint Holm power."
                ),
            },
            "target_power": self.target_power,
            "cluster_search": {
                "min_clusters": self.min_clusters,
                "max_clusters": self.max_clusters,
                "step": self.step,
            },
            "scenarios": [scenario.public_payload() for scenario in self.scenarios],
            "required_clusters": self.required_clusters,
        }
        payload["plan_sha256"] = _canonical_sha256(payload)
        return payload


def build_conservative_power_plan(
    *,
    planning_id: str,
    treatment_condition: str,
    control_condition: str,
    absolute_minimum_detectable_difference: float,
    expected_discordances: tuple[float, ...],
    alpha: float = 0.05,
    family_size: int = 1,
    target_power: float = 0.8,
    repetitions_per_cluster: int = 3,
    min_clusters: int = 50,
    max_clusters: int = 300,
    step: int = 5,
) -> ConservativePowerPlan:
    """Plan cluster count from an outcome-independent discordance envelope.

    ``expected_discordances`` should be chosen before confirmatory outcome
    labels are read. The returned plan takes the largest required cluster count
    across that envelope, so a favorable scenario cannot shrink the cohort.
    """

    normalized_id = _require_identifier(planning_id, label="planning_id")
    treatment = _require_identifier(
        treatment_condition,
        label="treatment_condition",
    )
    control = _require_identifier(
        control_condition,
        label="control_condition",
    )
    if treatment == control:
        raise PowerPlanningError(
            "treatment_condition and control_condition must differ"
        )
    minimum_difference = _require_probability(
        absolute_minimum_detectable_difference,
        label="absolute_minimum_detectable_difference",
        allow_zero=False,
    )
    alpha_value = _require_probability(alpha, label="alpha", allow_zero=False)
    normalized_family_size = _require_positive_int(family_size, label="family_size")
    per_comparison_alpha = alpha_value / normalized_family_size
    target_power_value = _require_probability(
        target_power,
        label="target_power",
        allow_zero=False,
    )
    repetition_count = _require_positive_int(
        repetitions_per_cluster,
        label="repetitions_per_cluster",
    )
    minimum_clusters = _require_positive_int(min_clusters, label="min_clusters")
    maximum_clusters = _require_positive_int(max_clusters, label="max_clusters")
    cluster_step = _require_positive_int(step, label="step")
    if minimum_clusters > maximum_clusters:
        raise PowerPlanningError("min_clusters must not exceed max_clusters")
    cluster_counts = tuple(range(minimum_clusters, maximum_clusters + 1, cluster_step))
    if cluster_counts[-1] != maximum_clusters:
        cluster_counts += (maximum_clusters,)
    if len(cluster_counts) > MAX_PLAN_POINTS:
        raise PowerPlanningError(
            f"cluster search has more than {MAX_PLAN_POINTS} points; increase step"
        )
    if not expected_discordances:
        raise PowerPlanningError("expected_discordances must contain at least one scenario")
    discordances = tuple(sorted({
        _require_probability(value, label="expected_discordance", allow_zero=False)
        for value in expected_discordances
    }))

    scenarios: list[DiscordanceScenario] = []
    for discordance in discordances:
        if minimum_difference > discordance:
            raise PowerPlanningError(
                "absolute_minimum_detectable_difference must not exceed every expected_discordance"
            )
        treatment_only_probability = (discordance + minimum_difference) / 2.0
        control_only_probability = (discordance - minimum_difference) / 2.0
        points = tuple(
            PowerPoint(
                clusters=clusters,
                exact_power=exact_paired_binary_power(
                    clusters=clusters,
                    treatment_only_probability=treatment_only_probability,
                    control_only_probability=control_only_probability,
                    alpha=per_comparison_alpha,
                ),
            )
            for clusters in cluster_counts
        )
        required_clusters = next(
            (point.clusters for point in points if point.exact_power >= target_power_value),
            None,
        )
        scenarios.append(
            DiscordanceScenario(
                expected_discordance=discordance,
                treatment_only_probability=treatment_only_probability,
                control_only_probability=control_only_probability,
                points=points,
                required_clusters=required_clusters,
            )
        )

    required_counts = [scenario.required_clusters for scenario in scenarios]
    required_clusters = (
        max(count for count in required_counts if count is not None)
        if all(count is not None for count in required_counts)
        else None
    )
    return ConservativePowerPlan(
        planning_id=normalized_id,
        treatment_condition=treatment,
        control_condition=control,
        absolute_minimum_detectable_difference=minimum_difference,
        alpha=alpha_value,
        family_size=normalized_family_size,
        per_comparison_alpha=per_comparison_alpha,
        target_power=target_power_value,
        repetitions_per_cluster=repetition_count,
        min_clusters=minimum_clusters,
        max_clusters=maximum_clusters,
        step=cluster_step,
        scenarios=tuple(scenarios),
        required_clusters=required_clusters,
    )


def write_conservative_power_plan(
    path: str | Path,
    plan: ConservativePowerPlan,
) -> Path:
    target = Path(path).resolve()
    if target.exists():
        raise PowerPlanningError("power-plan output must not already exist")
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(
        json.dumps(plan.public_payload(), indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    return target
