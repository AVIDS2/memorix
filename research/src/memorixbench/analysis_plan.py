"""Frozen confirmatory analysis manifests for paired comparison families."""

from __future__ import annotations

from dataclasses import asdict, dataclass
import hashlib
import json
from pathlib import Path
import re
from typing import Iterable

from .scoring import RunResult


CONFIRMATORY_ANALYSIS_PLAN_SCHEMA_VERSION = "confirmatory-analysis-plan-v1"
SHA256_PATTERN = re.compile(r"^[0-9a-f]{64}$")
IDENTIFIER_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")


class ConfirmatoryAnalysisPlanError(ValueError):
    """Raised when a frozen analysis plan cannot support confirmatory inference."""


def _canonical_sha256(payload: dict[str, object]) -> str:
    encoded = json.dumps(
        payload,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=True,
    ).encode("ascii")
    return hashlib.sha256(encoded).hexdigest()


def _require_identifier(value: object, *, label: str) -> str:
    if not isinstance(value, str) or not IDENTIFIER_PATTERN.fullmatch(value):
        raise ConfirmatoryAnalysisPlanError(f"{label} is invalid")
    return value


def _require_sha256(value: object, *, label: str) -> str:
    if not isinstance(value, str) or not SHA256_PATTERN.fullmatch(value):
        raise ConfirmatoryAnalysisPlanError(f"{label} must be a lowercase SHA-256 digest")
    return value


def _require_probability(value: object, *, label: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ConfirmatoryAnalysisPlanError(f"{label} must be a probability")
    normalized = float(value)
    if not 0 < normalized <= 1:
        raise ConfirmatoryAnalysisPlanError(f"{label} must be greater than zero and at most one")
    return normalized


def _require_nonnegative_int(value: object, *, label: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise ConfirmatoryAnalysisPlanError(f"{label} must be a non-negative integer")
    return value


def _require_positive_int(value: object, *, label: str) -> int:
    normalized = _require_nonnegative_int(value, label=label)
    if normalized == 0:
        raise ConfirmatoryAnalysisPlanError(f"{label} must be a positive integer")
    return normalized


@dataclass(frozen=True)
class PlannedPair:
    case_id: str
    agent: str
    actual_model: str
    repetition: int
    seed: int

    @property
    def key(self) -> tuple[str, str, str, int, int]:
        return (
            self.case_id,
            self.agent,
            self.actual_model,
            self.repetition,
            self.seed,
        )

    def validate(self) -> None:
        _require_identifier(self.case_id, label="planned case id")
        if self.agent not in {"claude", "codex"}:
            raise ConfirmatoryAnalysisPlanError("planned agent is unsupported")
        _require_identifier(self.actual_model, label="planned actual model")
        _require_nonnegative_int(self.repetition, label="planned repetition")
        _require_nonnegative_int(self.seed, label="planned seed")

    def public_payload(self) -> dict[str, object]:
        return asdict(self)


@dataclass(frozen=True)
class PlannedComparison:
    comparison_id: str
    treatment_condition: str
    control_condition: str
    power_plan_sha256: str
    required_clusters: int

    def validate(self) -> None:
        _require_identifier(self.comparison_id, label="comparison id")
        _require_identifier(self.treatment_condition, label="treatment condition")
        _require_identifier(self.control_condition, label="control condition")
        if self.treatment_condition == self.control_condition:
            raise ConfirmatoryAnalysisPlanError(
                "planned treatment and control conditions must differ"
            )
        _require_sha256(self.power_plan_sha256, label="power plan")
        _require_positive_int(self.required_clusters, label="required clusters")

    def public_payload(self) -> dict[str, object]:
        return asdict(self)


@dataclass(frozen=True)
class ConfirmatoryAnalysisPlan:
    plan_id: str
    registry_sha256: str
    family_id: str
    alpha: float
    comparisons: tuple[PlannedComparison, ...]
    planned_pairs: tuple[PlannedPair, ...]
    missing_pair_policy: str = "fail-closed-v1"

    def validate(self) -> None:
        _require_identifier(self.plan_id, label="analysis plan id")
        _require_sha256(self.registry_sha256, label="analysis registry")
        _require_identifier(self.family_id, label="analysis family id")
        _require_probability(self.alpha, label="analysis alpha")
        if self.missing_pair_policy != "fail-closed-v1":
            raise ConfirmatoryAnalysisPlanError("analysis plan has an unsupported missing-pair policy")
        if not self.comparisons:
            raise ConfirmatoryAnalysisPlanError("analysis plan requires at least one comparison")
        for comparison in self.comparisons:
            comparison.validate()
        comparison_ids = [comparison.comparison_id for comparison in self.comparisons]
        if len(comparison_ids) != len(set(comparison_ids)):
            raise ConfirmatoryAnalysisPlanError("analysis plan has duplicate comparison ids")
        if not self.planned_pairs:
            raise ConfirmatoryAnalysisPlanError("analysis plan requires planned pairs")
        for pair in self.planned_pairs:
            pair.validate()
        pair_keys = [pair.key for pair in self.planned_pairs]
        if len(pair_keys) != len(set(pair_keys)):
            raise ConfirmatoryAnalysisPlanError("analysis plan has duplicate planned pairs")
        cohorts = {(pair.agent, pair.actual_model) for pair in self.planned_pairs}
        if len(cohorts) != 1:
            raise ConfirmatoryAnalysisPlanError(
                "analysis plan must contain one agent and actual-model cohort"
            )
        cluster_count = len({(pair.case_id, pair.agent, pair.actual_model) for pair in self.planned_pairs})
        for comparison in self.comparisons:
            if cluster_count < comparison.required_clusters:
                raise ConfirmatoryAnalysisPlanError(
                    "analysis plan has fewer planned clusters than its power plan requires"
                )

    def public_payload(self) -> dict[str, object]:
        self.validate()
        return {
            "schema_version": CONFIRMATORY_ANALYSIS_PLAN_SCHEMA_VERSION,
            "plan_id": self.plan_id,
            "registry_sha256": self.registry_sha256,
            "family_id": self.family_id,
            "alpha": self.alpha,
            "missing_pair_policy": self.missing_pair_policy,
            "comparisons": [item.public_payload() for item in self.comparisons],
            "planned_pairs": [item.public_payload() for item in self.planned_pairs],
        }

    @property
    def sha256(self) -> str:
        return _canonical_sha256(self.public_payload())

    @classmethod
    def from_public_payload(cls, value: object) -> "ConfirmatoryAnalysisPlan":
        if not isinstance(value, dict):
            raise ConfirmatoryAnalysisPlanError("analysis plan must be an object")
        expected = {
            "schema_version",
            "plan_id",
            "registry_sha256",
            "family_id",
            "alpha",
            "missing_pair_policy",
            "comparisons",
            "planned_pairs",
        }
        if set(value) != expected or value.get("schema_version") != CONFIRMATORY_ANALYSIS_PLAN_SCHEMA_VERSION:
            raise ConfirmatoryAnalysisPlanError("analysis plan has unsupported fields")
        raw_comparisons = value.get("comparisons")
        raw_pairs = value.get("planned_pairs")
        if not isinstance(raw_comparisons, list) or not isinstance(raw_pairs, list):
            raise ConfirmatoryAnalysisPlanError("analysis plan comparisons and pairs must be lists")
        try:
            comparisons = tuple(
                PlannedComparison(
                    comparison_id=_require_identifier(
                        item.get("comparison_id") if isinstance(item, dict) else None,
                        label="comparison id",
                    ),
                    treatment_condition=_require_identifier(
                        item.get("treatment_condition") if isinstance(item, dict) else None,
                        label="treatment condition",
                    ),
                    control_condition=_require_identifier(
                        item.get("control_condition") if isinstance(item, dict) else None,
                        label="control condition",
                    ),
                    power_plan_sha256=_require_sha256(
                        item.get("power_plan_sha256") if isinstance(item, dict) else None,
                        label="power plan",
                    ),
                    required_clusters=_require_positive_int(
                        item.get("required_clusters") if isinstance(item, dict) else None,
                        label="required clusters",
                    ),
                )
                for item in raw_comparisons
            )
            pairs = tuple(
                PlannedPair(
                    case_id=_require_identifier(
                        item.get("case_id") if isinstance(item, dict) else None,
                        label="planned case id",
                    ),
                    agent=_require_identifier(
                        item.get("agent") if isinstance(item, dict) else None,
                        label="planned agent",
                    ),
                    actual_model=_require_identifier(
                        item.get("actual_model") if isinstance(item, dict) else None,
                        label="planned actual model",
                    ),
                    repetition=_require_nonnegative_int(
                        item.get("repetition") if isinstance(item, dict) else None,
                        label="planned repetition",
                    ),
                    seed=_require_nonnegative_int(
                        item.get("seed") if isinstance(item, dict) else None,
                        label="planned seed",
                    ),
                )
                for item in raw_pairs
            )
            plan = cls(
                plan_id=_require_identifier(value.get("plan_id"), label="analysis plan id"),
                registry_sha256=_require_sha256(value.get("registry_sha256"), label="analysis registry"),
                family_id=_require_identifier(value.get("family_id"), label="analysis family id"),
                alpha=_require_probability(value.get("alpha"), label="analysis alpha"),
                comparisons=comparisons,
                planned_pairs=pairs,
                missing_pair_policy=_require_identifier(
                    value.get("missing_pair_policy"),
                    label="missing-pair policy",
                ),
            )
        except ConfirmatoryAnalysisPlanError:
            raise
        except (AttributeError, TypeError, ValueError) as error:
            raise ConfirmatoryAnalysisPlanError("analysis plan fields are invalid") from error
        plan.validate()
        return plan


def load_confirmatory_analysis_plan(path: str | Path) -> ConfirmatoryAnalysisPlan:
    try:
        payload = json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise ConfirmatoryAnalysisPlanError("analysis plan cannot be read") from error
    return ConfirmatoryAnalysisPlan.from_public_payload(payload)


def write_confirmatory_analysis_plan(
    path: str | Path,
    plan: ConfirmatoryAnalysisPlan,
) -> Path:
    target = Path(path).resolve()
    if target.exists():
        raise ConfirmatoryAnalysisPlanError("analysis-plan output must not already exist")
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(
        json.dumps(plan.public_payload(), indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    return target


def validate_confirmatory_results(
    plan: ConfirmatoryAnalysisPlan,
    *,
    family_id: str,
    comparisons: Iterable[tuple[str, str, str]],
    results: Iterable[RunResult],
) -> list[RunResult]:
    """Select one frozen cohort and reject missing, extra, or invalid pairs."""

    plan.validate()
    if family_id != plan.family_id:
        raise ConfirmatoryAnalysisPlanError("analysis family id does not match the frozen plan")
    supplied = tuple(comparisons)
    frozen = tuple(
        (item.comparison_id, item.treatment_condition, item.control_condition)
        for item in plan.comparisons
    )
    if supplied != frozen:
        raise ConfirmatoryAnalysisPlanError("analysis comparisons do not match the frozen plan")
    conditions = {
        condition
        for _comparison_id, treatment, control in frozen
        for condition in (treatment, control)
    }
    expected_pairs = {pair.key for pair in plan.planned_pairs}
    expected_rows = {
        (*pair.key, condition)
        for pair in plan.planned_pairs
        for condition in conditions
    }
    cohort = next(iter({(pair.agent, pair.actual_model) for pair in plan.planned_pairs}))
    selected = [
        result
        for result in results
        if (result.agent, result.actual_model_id) == cohort and result.condition in conditions
    ]
    actual_rows: dict[tuple[str, str, str, int, int, str], RunResult] = {}
    for result in selected:
        if result.evidence_tier != "confirmatory":
            raise ConfirmatoryAnalysisPlanError("frozen analysis contains a non-confirmatory result")
        if result.registry_sha256 != plan.registry_sha256:
            raise ConfirmatoryAnalysisPlanError(
                "frozen analysis result does not bind the planned registry"
            )
        if result.pair_key not in expected_pairs:
            raise ConfirmatoryAnalysisPlanError("frozen analysis contains an unplanned result pair")
        key = (*result.pair_key, result.condition)
        if key in actual_rows:
            raise ConfirmatoryAnalysisPlanError("frozen analysis contains a duplicate result row")
        actual_rows[key] = result
    missing = expected_rows - set(actual_rows)
    extras = set(actual_rows) - expected_rows
    if missing or extras:
        raise ConfirmatoryAnalysisPlanError("frozen analysis has missing or extra result rows")
    invalid = [result for result in actual_rows.values() if not result.valid_run]
    if invalid:
        raise ConfirmatoryAnalysisPlanError(
            "frozen analysis contains invalid infrastructure rows under fail-closed policy"
        )
    return [actual_rows[key] for key in sorted(actual_rows)]
