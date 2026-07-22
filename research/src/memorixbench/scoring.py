from __future__ import annotations

from dataclasses import dataclass
import json
import math
from pathlib import Path
import random
from typing import Iterable, Literal

from .annotation import AnnotationError, load_final_annotation, merge_annotation_into_result

VALID_EVIDENCE_TIERS = {"unclassified", "development", "confirmatory"}
VALID_DEPENDENCY_STRENGTHS = {"low", "medium", "high"}
VALID_DEPENDENCY_CLASSIFICATION_STATUS = {
    "unclassified",
    "retrospective-development",
    "preregistered",
}
VALID_STUDY_TRACKS = {"unclassified", "B", "C"}
VALID_FORMATION_TRACKS = {
    "unclassified",
    "seeded-canonical",
    "trace-replay",
    "native-session",
}
VALID_ANNOTATION_STATUSES = {"pending-v1", "consensus-v1", "adjudicated-v1"}
SECONDARY_OUTCOME_STATUS = {"pending-v1", "annotated-v1", "no-correct-action-v1", "unrateable-v1"}


@dataclass(frozen=True)
class RunResult:
    case_id: str
    condition: str
    agent: str
    model: str
    repetition: int
    seed: int
    task_success: bool
    first_correct_action_seconds: float | None = None
    first_correct_action_status: str = "pending-v1"
    input_tokens: int | None = None
    output_tokens: int | None = None
    wall_seconds: float | None = None
    stale_memory_errors: int | None = None
    stale_memory_error_status: str = "pending-v1"
    negative_control_intrusions: int | None = None
    negative_control_intrusion_status: str = "pending-v1"
    annotation_status: str = "pending-v1"
    valid_run: bool = True
    failure_reason: str | None = None
    evidence_tier: str = "unclassified"
    predecessor_dependency: str | None = None
    dependency_classification_status: str = "unclassified"
    study_track: str = "unclassified"
    formation_track: str = "unclassified"
    precursor_trace_sha256: str | None = None

    @property
    def pair_key(self) -> tuple[str, str, str, int, int]:
        return (self.case_id, self.agent, self.model, self.repetition, self.seed)

    @classmethod
    def from_dict(cls, data: dict[str, object]) -> "RunResult":
        required = {
            "case_id",
            "condition",
            "agent",
            "model",
            "repetition",
            "seed",
            "task_success",
        }
        missing = required - data.keys()
        if missing:
            raise ValueError("run result is missing: " + ", ".join(sorted(missing)))
        if not isinstance(data["task_success"], bool):
            raise ValueError("task_success must be a boolean")
        evidence_tier = str(data.get("evidence_tier", "unclassified"))
        predecessor_dependency = (
            None
            if data.get("predecessor_dependency") is None
            else str(data["predecessor_dependency"])
        )
        dependency_classification_status = str(
            data.get("dependency_classification_status", "unclassified")
        )
        study_track = str(data.get("study_track", "unclassified"))
        formation_track = str(data.get("formation_track", "unclassified"))
        precursor_trace_sha256 = (
            None
            if data.get("precursor_trace_sha256") is None
            else str(data["precursor_trace_sha256"])
        )
        annotation_status = str(data.get("annotation_status", "pending-v1"))
        first_correct_action_status = str(
            data.get("first_correct_action_status", "pending-v1")
        )
        stale_memory_error_status = str(
            data.get("stale_memory_error_status", "pending-v1")
        )
        negative_control_intrusion_status = str(
            data.get("negative_control_intrusion_status", "pending-v1")
        )
        if evidence_tier not in VALID_EVIDENCE_TIERS:
            raise ValueError(f"unknown evidence_tier: {evidence_tier!r}")
        if predecessor_dependency not in {None, *VALID_DEPENDENCY_STRENGTHS}:
            raise ValueError(
                f"unknown predecessor_dependency: {predecessor_dependency!r}"
            )
        if dependency_classification_status not in VALID_DEPENDENCY_CLASSIFICATION_STATUS:
            raise ValueError(
                "unknown dependency_classification_status: "
                f"{dependency_classification_status!r}"
            )
        if study_track not in VALID_STUDY_TRACKS:
            raise ValueError(f"unknown study_track: {study_track!r}")
        if formation_track not in VALID_FORMATION_TRACKS:
            raise ValueError(f"unknown formation_track: {formation_track!r}")
        if study_track == "B" and formation_track != "seeded-canonical":
            raise ValueError("Track B results require seeded-canonical formation")
        if study_track == "C" and formation_track not in {"trace-replay", "native-session"}:
            raise ValueError("Track C results require trace-replay or native-session formation")
        if study_track == "C" and not precursor_trace_sha256:
            raise ValueError("Track C results require precursor_trace_sha256")
        if annotation_status not in VALID_ANNOTATION_STATUSES:
            raise ValueError(f"unknown annotation_status: {annotation_status!r}")
        if any(
            status not in SECONDARY_OUTCOME_STATUS
            for status in (
                first_correct_action_status,
                stale_memory_error_status,
                negative_control_intrusion_status,
            )
        ):
            raise ValueError("unknown secondary outcome annotation status")
        if evidence_tier != "unclassified" and (
            predecessor_dependency is None
            or dependency_classification_status == "unclassified"
        ):
            raise ValueError(
                "classified results require predecessor_dependency and "
                "dependency_classification_status"
            )
        return cls(
            case_id=str(data["case_id"]),
            condition=str(data["condition"]),
            agent=str(data["agent"]),
            model=str(data["model"]),
            repetition=int(data["repetition"]),
            seed=int(data["seed"]),
            task_success=data["task_success"],
            first_correct_action_seconds=_optional_float(data.get("first_correct_action_seconds")),
            first_correct_action_status=first_correct_action_status,
            input_tokens=_optional_int(data.get("input_tokens")),
            output_tokens=_optional_int(data.get("output_tokens")),
            wall_seconds=_optional_float(data.get("wall_seconds")),
            stale_memory_errors=_optional_int(data.get("stale_memory_errors")),
            stale_memory_error_status=stale_memory_error_status,
            negative_control_intrusions=_optional_int(data.get("negative_control_intrusions")),
            negative_control_intrusion_status=negative_control_intrusion_status,
            annotation_status=annotation_status,
            valid_run=bool(data.get("valid_run", True)),
            failure_reason=(
                None if data.get("failure_reason") is None else str(data["failure_reason"])
            ),
            evidence_tier=evidence_tier,
            predecessor_dependency=predecessor_dependency,
            dependency_classification_status=dependency_classification_status,
            study_track=study_track,
            formation_track=formation_track,
            precursor_trace_sha256=precursor_trace_sha256,
        )


@dataclass(frozen=True)
class PairedComparison:
    treatment: str
    control: str
    pairs: int
    treatment_success_rate: float
    control_success_rate: float
    absolute_difference: float
    confidence_interval: tuple[float, float]
    treatment_only_successes: int
    control_only_successes: int
    mcnemar_exact_p: float
    unmatched_runs: int
    excluded_invalid_runs: int


def _optional_float(value: object) -> float | None:
    return None if value is None else float(value)


def _optional_int(value: object) -> int | None:
    return None if value is None else int(value)


def _assert_pair_compatible(treatment: RunResult, control: RunResult) -> None:
    if treatment.study_track != control.study_track:
        raise ValueError("paired runs use different study tracks")
    if treatment.formation_track != control.formation_track:
        raise ValueError("paired runs use different formation tracks")
    if treatment.study_track == "C" and (
        treatment.precursor_trace_sha256 != control.precursor_trace_sha256
    ):
        raise ValueError("paired Track C runs use different precursor traces")


def load_jsonl(path: str | Path) -> list[RunResult]:
    results: list[RunResult] = []
    for line_number, line in enumerate(Path(path).read_text(encoding="utf-8").splitlines(), 1):
        if not line.strip():
            continue
        try:
            payload = json.loads(line)
        except json.JSONDecodeError as error:
            raise ValueError(f"invalid JSON on line {line_number}: {error}") from error
        if not isinstance(payload, dict):
            raise ValueError(f"line {line_number} must contain a JSON object")
        results.append(RunResult.from_dict(payload))
    return results


def collect_result_payloads(root: str | Path) -> list[dict[str, object]]:
    base = Path(root).resolve()
    payloads: list[dict[str, object]] = []
    for path in sorted(base.rglob("result.json")):
        try:
            value = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as error:
            raise ValueError(f"invalid result JSON at {path}: {error}") from error
        if not isinstance(value, dict):
            raise ValueError(f"result JSON must contain an object: {path}")
        annotation_path = path.with_name("outcome-annotation.json")
        if annotation_path.is_file():
            try:
                value = merge_annotation_into_result(
                    path,
                    load_final_annotation(annotation_path),
                )
            except AnnotationError as error:
                raise ValueError(f"invalid outcome annotation at {annotation_path}: {error}") from error
        RunResult.from_dict(value)
        payloads.append(value)
    return sorted(
        payloads,
        key=lambda item: (
            str(item.get("study_id", "")),
            str(item["case_id"]),
            str(item["agent"]),
            str(item["model"]),
            str(item["condition"]),
            int(item["repetition"]),
            int(item["seed"]),
            str(item.get("run_id", "")),
        ),
    )


def write_jsonl(path: str | Path, payloads: Iterable[dict[str, object]]) -> int:
    target = Path(path).resolve()
    rows = list(payloads)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(
        "".join(json.dumps(row, sort_keys=True) + "\n" for row in rows),
        encoding="utf-8",
    )
    return len(rows)


def require_annotated_secondary(
    results: Iterable[RunResult],
    *,
    metric: Literal["first-correct-action", "stale-memory-errors", "negative-control-intrusions"],
) -> list[RunResult]:
    selected = list(results)
    if metric == "first-correct-action":
        eligible = {"annotated-v1", "no-correct-action-v1"}
        statuses = {item.first_correct_action_status for item in selected}
    elif metric == "stale-memory-errors":
        eligible = {"annotated-v1"}
        statuses = {item.stale_memory_error_status for item in selected}
    else:
        eligible = {"annotated-v1"}
        statuses = {item.negative_control_intrusion_status for item in selected}
    invalid = sorted(statuses - eligible)
    if invalid:
        raise ValueError(
            f"{metric} analysis requires adjudicated human labels; found: " + ", ".join(invalid)
        )
    if any(item.annotation_status not in {"consensus-v1", "adjudicated-v1"} for item in selected):
        raise ValueError(f"{metric} analysis requires final annotation summaries")
    return selected


def exact_mcnemar_p(treatment_only: int, control_only: int) -> float:
    discordant = treatment_only + control_only
    if discordant == 0:
        return 1.0
    tail = min(treatment_only, control_only)
    cumulative = sum(math.comb(discordant, k) for k in range(tail + 1)) / (2**discordant)
    return min(1.0, 2.0 * cumulative)


def _bootstrap_difference(
    pairs: list[tuple[RunResult, RunResult]],
    *,
    samples: int,
    seed: int,
) -> tuple[float, float]:
    if not pairs:
        raise ValueError("at least one matched pair is required")
    if samples < 100:
        raise ValueError("bootstrap samples must be at least 100")
    rng = random.Random(seed)
    differences: list[float] = []
    for _ in range(samples):
        sampled = [pairs[rng.randrange(len(pairs))] for _ in pairs]
        treatment_rate = sum(item[0].task_success for item in sampled) / len(sampled)
        control_rate = sum(item[1].task_success for item in sampled) / len(sampled)
        differences.append(treatment_rate - control_rate)
    differences.sort()
    lower = differences[math.floor(0.025 * (samples - 1))]
    upper = differences[math.ceil(0.975 * (samples - 1))]
    return (lower, upper)


def compare_conditions(
    results: Iterable[RunResult],
    *,
    treatment: str,
    control: str,
    bootstrap_samples: int = 10_000,
    bootstrap_seed: int = 1729,
    require_confirmatory: bool = True,
    include_low_dependency: bool = False,
) -> PairedComparison:
    candidates = [item for item in results if item.condition in {treatment, control}]
    if require_confirmatory:
        non_confirmatory = sorted({
            item.evidence_tier
            for item in candidates
            if item.evidence_tier != "confirmatory"
        })
        if non_confirmatory:
            raise ValueError(
                "non-confirmatory results require an explicit development override: "
                + ", ".join(non_confirmatory)
            )
        non_preregistered = sorted({
            item.dependency_classification_status
            for item in candidates
            if item.dependency_classification_status != "preregistered"
        })
        if non_preregistered:
            raise ValueError(
                "non-preregistered results cannot enter a confirmatory comparison: "
                + ", ".join(non_preregistered)
            )
        non_track_c = sorted({item.study_track for item in candidates if item.study_track != "C"})
        if non_track_c:
            raise ValueError(
                "confirmatory comparisons require Track C results: "
                + ", ".join(non_track_c)
            )
    if not include_low_dependency:
        ineligible_dependencies = sorted({
            "missing" if item.predecessor_dependency is None else item.predecessor_dependency
            for item in candidates
            if item.predecessor_dependency not in {"medium", "high"}
        })
        if ineligible_dependencies:
            raise ValueError(
                "low or unclassified dependency results require an explicit override: "
                + ", ".join(ineligible_dependencies)
            )
    excluded_invalid = sum(not item.valid_run for item in candidates)
    selected = [item for item in candidates if item.valid_run]
    by_condition: dict[str, dict[tuple[str, str, str, int, int], RunResult]] = {
        treatment: {},
        control: {},
    }
    for item in selected:
        bucket = by_condition[item.condition]
        if item.pair_key in bucket:
            raise ValueError(
                f"duplicate run for condition {item.condition!r} and pair {item.pair_key!r}"
            )
        bucket[item.pair_key] = item

    matched_keys = sorted(set(by_condition[treatment]) & set(by_condition[control]))
    if not matched_keys:
        raise ValueError("no matched treatment/control runs")
    pairs = [
        (by_condition[treatment][key], by_condition[control][key])
        for key in matched_keys
    ]
    for treatment_run, control_run in pairs:
        _assert_pair_compatible(treatment_run, control_run)
    treatment_rate = sum(item[0].task_success for item in pairs) / len(pairs)
    control_rate = sum(item[1].task_success for item in pairs) / len(pairs)
    treatment_only = sum(
        item[0].task_success and not item[1].task_success for item in pairs
    )
    control_only = sum(
        item[1].task_success and not item[0].task_success for item in pairs
    )
    unmatched = len(selected) - 2 * len(pairs)
    return PairedComparison(
        treatment=treatment,
        control=control,
        pairs=len(pairs),
        treatment_success_rate=treatment_rate,
        control_success_rate=control_rate,
        absolute_difference=treatment_rate - control_rate,
        confidence_interval=_bootstrap_difference(
            pairs,
            samples=bootstrap_samples,
            seed=bootstrap_seed,
        ),
        treatment_only_successes=treatment_only,
        control_only_successes=control_only,
        mcnemar_exact_p=exact_mcnemar_p(treatment_only, control_only),
        unmatched_runs=unmatched,
        excluded_invalid_runs=excluded_invalid,
    )
