from __future__ import annotations

from dataclasses import dataclass
import json
import math
import os
from pathlib import Path
import random
import re
from typing import Iterable, Literal, Mapping


VALID_EVIDENCE_TIERS = {"unclassified", "development", "public-reproducible", "confirmatory"}
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
VALID_MODEL_PROFILES = {"single", "mixed", "unreported"}
VALID_ANNOTATION_STATUSES = {"pending-v1", "consensus-v1", "adjudicated-v1"}
SECONDARY_OUTCOME_STATUS = {"pending-v1", "annotated-v1", "no-correct-action-v1", "unrateable-v1"}
SHA256_PATTERN = re.compile(r"^[0-9a-f]{64}$")


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
    cost_usd: float | None = None
    tool_call_count: int | None = None
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
    native_hook_capture_sha256: str | None = None
    reported_models: tuple[str, ...] = ()
    model_profile: str = "unreported"
    case_definition_sha256: str | None = None
    oracle_definition_sha256: str | None = None
    registry_sha256: str | None = None

    @property
    def pair_key(self) -> tuple[str, str, str, int, int]:
        return (
            self.case_id,
            self.agent,
            self.actual_model_id,
            self.repetition,
            self.seed,
        )

    @property
    def cluster_key(self) -> tuple[str, str, str]:
        """The confirmatory unit; repetitions estimate stability within it."""

        return (self.case_id, self.agent, self.actual_model_id)

    @property
    def actual_model_id(self) -> str:
        """Use provider telemetry for inference; ``model`` can be a client alias."""

        if self.model_profile == "single" and len(self.reported_models) == 1:
            return self.reported_models[0]
        return self.model

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
        native_hook_capture_sha256 = _optional_sha256(
            data.get("native_hook_capture_sha256"),
            label="native_hook_capture_sha256",
        )
        reported_models = _reported_models(data.get("reported_models", ()))
        model_profile = str(data.get(
            "model_profile",
            "single" if len(reported_models) == 1 else "mixed" if reported_models else "unreported",
        ))
        case_definition_sha256 = _optional_identity(
            data.get("case_definition_sha256"),
            label="case_definition_sha256",
        )
        oracle_definition_sha256 = _optional_identity(
            data.get("oracle_definition_sha256"),
            label="oracle_definition_sha256",
        )
        registry_sha256 = _optional_sha256(
            data.get("registry_sha256"),
            label="registry_sha256",
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
        if model_profile not in VALID_MODEL_PROFILES:
            raise ValueError(f"unknown model_profile: {model_profile!r}")
        if model_profile == "single" and len(reported_models) != 1:
            raise ValueError("single model_profile requires exactly one reported model")
        if model_profile == "mixed" and len(reported_models) < 2:
            raise ValueError("mixed model_profile requires multiple reported models")
        if model_profile == "unreported" and reported_models:
            raise ValueError("unreported model_profile cannot include reported models")
        if study_track == "B" and formation_track != "seeded-canonical":
            raise ValueError("Track B results require seeded-canonical formation")
        if study_track == "C" and formation_track not in {"trace-replay", "native-session"}:
            raise ValueError("Track C results require trace-replay or native-session formation")
        if study_track == "C" and formation_track == "trace-replay" and not precursor_trace_sha256:
            raise ValueError("trace-replay Track C results require precursor_trace_sha256")
        if study_track == "C" and formation_track == "native-session" and not native_hook_capture_sha256:
            raise ValueError("native-session Track C results require native_hook_capture_sha256")
        if study_track == "C" and formation_track == "native-session" and precursor_trace_sha256:
            raise ValueError("native-session Track C results cannot carry precursor_trace_sha256")
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
        valid_run = data.get("valid_run", True)
        if not isinstance(valid_run, bool):
            raise ValueError("valid_run must be a boolean")
        failure_reason = (
            None if data.get("failure_reason") is None else str(data["failure_reason"])
        )
        if not valid_run and not failure_reason:
            raise ValueError("invalid runs require a failure_reason")
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
            cost_usd=_optional_float(data.get("cost_usd")),
            tool_call_count=_optional_int(data.get("tool_call_count")),
            stale_memory_errors=_optional_int(data.get("stale_memory_errors")),
            stale_memory_error_status=stale_memory_error_status,
            negative_control_intrusions=_optional_int(data.get("negative_control_intrusions")),
            negative_control_intrusion_status=negative_control_intrusion_status,
            annotation_status=annotation_status,
            valid_run=valid_run,
            failure_reason=failure_reason,
            evidence_tier=evidence_tier,
            predecessor_dependency=predecessor_dependency,
            dependency_classification_status=dependency_classification_status,
            study_track=study_track,
            formation_track=formation_track,
            precursor_trace_sha256=precursor_trace_sha256,
            native_hook_capture_sha256=native_hook_capture_sha256,
            reported_models=reported_models,
            model_profile=model_profile,
            case_definition_sha256=case_definition_sha256,
            oracle_definition_sha256=oracle_definition_sha256,
            registry_sha256=registry_sha256,
        )


@dataclass(frozen=True)
class PairedComparison:
    treatment: str
    control: str
    pairs: int
    clusters: int
    analysis_unit: str
    treatment_success_rate: float
    control_success_rate: float
    absolute_difference: float
    confidence_interval: tuple[float, float]
    treatment_favored_clusters: int
    control_favored_clusters: int
    cluster_sign_flip_p: float
    unmatched_runs: int
    excluded_invalid_runs: int


def _optional_float(value: object) -> float | None:
    return None if value is None else float(value)


def _optional_int(value: object) -> int | None:
    return None if value is None else int(value)


def _reported_models(value: object) -> tuple[str, ...]:
    if not isinstance(value, (list, tuple)):
        raise ValueError("reported_models must be a sequence")
    models: list[str] = []
    for item in value:
        if not isinstance(item, str) or not item.strip():
            raise ValueError("reported_models must contain non-empty strings")
        models.append(item.strip())
    return tuple(sorted(set(models)))


def _optional_identity(value: object, *, label: str) -> str | None:
    if value is None:
        return None
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{label} must be a non-empty string when present")
    return value.strip()


def _optional_sha256(value: object, *, label: str) -> str | None:
    if value is None:
        return None
    if not isinstance(value, str) or not SHA256_PATTERN.fullmatch(value):
        raise ValueError(f"{label} must be a lowercase SHA-256 digest when present")
    return value


def _assert_pair_compatible(
    treatment: RunResult,
    control: RunResult,
    *,
    allow_mixed_models: bool,
) -> None:
    if not treatment.reported_models or not control.reported_models:
        raise ValueError("paired runs must report their actual model identity")
    if treatment.reported_models != control.reported_models:
        raise ValueError("paired runs report different actual models")
    if treatment.model_profile != control.model_profile:
        raise ValueError("paired runs report different model profiles")
    if not allow_mixed_models and (
        treatment.model_profile != "single" or len(treatment.reported_models) != 1
    ):
        raise ValueError(
            "paired runs require a single actual model; mixed or unreported "
            "routes need an explicit diagnostic override"
        )
    for label, treatment_value, control_value in (
        (
            "case definition",
            treatment.case_definition_sha256,
            control.case_definition_sha256,
        ),
        (
            "oracle definition",
            treatment.oracle_definition_sha256,
            control.oracle_definition_sha256,
        ),
    ):
        if treatment_value is None or control_value is None:
            raise ValueError(f"paired runs are missing a {label} identity")
        if treatment_value != control_value:
            raise ValueError(f"paired runs use different {label}s")
    if treatment.study_track != control.study_track:
        raise ValueError("paired runs use different study tracks")
    if treatment.formation_track != control.formation_track:
        raise ValueError("paired runs use different formation tracks")
    if treatment.study_track == "C" and treatment.formation_track == "trace-replay" and (
        treatment.precursor_trace_sha256 != control.precursor_trace_sha256
    ):
        raise ValueError("paired trace-replay Track C runs use different precursor traces")
    if treatment.study_track == "C" and treatment.formation_track == "native-session" and (
        treatment.native_hook_capture_sha256 != control.native_hook_capture_sha256
    ):
        raise ValueError("paired native-session Track C runs use different hook captures")


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


def _result_paths(base: Path) -> tuple[Path, ...]:
    """Find stable run receipts without descending into mutable agent caches."""

    runs_root = base / "runs"
    if runs_root.is_dir():
        try:
            entries = sorted(runs_root.iterdir())
        except OSError:
            return ()
        results: list[Path] = []
        for entry in entries:
            try:
                candidate = entry / "result.json"
                if entry.is_dir() and candidate.is_file():
                    results.append(candidate)
            except OSError:
                continue
        return tuple(results)

    results = []
    for directory, _subdirectories, filenames in os.walk(
        base,
        topdown=True,
        followlinks=False,
        onerror=lambda _error: None,
    ):
        if "result.json" in filenames:
            results.append(Path(directory) / "result.json")
    return tuple(sorted(results))


def collect_result_payloads(root: str | Path) -> list[dict[str, object]]:
    base = Path(root).resolve()
    payloads: list[dict[str, object]] = []
    for path in _result_paths(base):
        try:
            value = json.loads(path.read_text(encoding="utf-8"))
        except FileNotFoundError:
            continue
        except json.JSONDecodeError as error:
            raise ValueError(f"invalid result JSON at {path}: {error}") from error
        if not isinstance(value, dict):
            raise ValueError(f"result JSON must contain an object: {path}")
        annotation_path = path.with_name("outcome-annotation.json")
        if annotation_path.is_file():
            from .annotation import AnnotationError, load_final_annotation, merge_annotation_into_result

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
    metric: Literal[
        "first-correct-action",
        "stale-memory-errors",
        "stale-claim-conflict-actions",
        "negative-control-intrusions",
    ],
) -> list[RunResult]:
    selected = list(results)
    if metric == "first-correct-action":
        eligible = {"annotated-v1", "no-correct-action-v1"}
        statuses = {item.first_correct_action_status for item in selected}
    elif metric in {"stale-memory-errors", "stale-claim-conflict-actions"}:
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


def holm_adjust_p_values(p_values: Mapping[str, float]) -> dict[str, float]:
    """Return two-sided Holm-adjusted p values keyed by frozen comparison id."""

    if not p_values:
        raise ValueError("Holm adjustment requires at least one comparison")
    normalized: dict[str, float] = {}
    for comparison_id, raw_value in p_values.items():
        if not isinstance(comparison_id, str) or not comparison_id.strip():
            raise ValueError("Holm comparison ids must be non-empty strings")
        value = float(raw_value)
        if not math.isfinite(value) or value < 0 or value > 1:
            raise ValueError("Holm p values must be finite probabilities between zero and one")
        normalized[comparison_id] = value

    ordered = sorted(normalized.items(), key=lambda item: (item[1], item[0]))
    adjusted: dict[str, float] = {}
    running_maximum = 0.0
    total = len(ordered)
    for index, (comparison_id, value) in enumerate(ordered):
        running_maximum = max(running_maximum, min(1.0, (total - index) * value))
        adjusted[comparison_id] = running_maximum
    return {comparison_id: adjusted[comparison_id] for comparison_id in normalized}


def _cluster_bootstrap_difference(
    clusters: list[tuple[float, float]],
    *,
    samples: int,
    seed: int,
) -> tuple[float, float]:
    if not clusters:
        raise ValueError("at least one matched cluster is required")
    if samples < 100:
        raise ValueError("bootstrap samples must be at least 100")
    rng = random.Random(seed)
    differences: list[float] = []
    for _ in range(samples):
        sampled = [clusters[rng.randrange(len(clusters))] for _ in clusters]
        treatment_rate = sum(item[0] for item in sampled) / len(sampled)
        control_rate = sum(item[1] for item in sampled) / len(sampled)
        differences.append(treatment_rate - control_rate)
    differences.sort()
    lower = differences[math.floor(0.025 * (samples - 1))]
    upper = differences[math.ceil(0.975 * (samples - 1))]
    return (lower, upper)


def _cluster_signature(result: RunResult) -> tuple[object, ...]:
    """Fields that cannot change across retries of one case/model unit."""

    return (
        result.reported_models,
        result.model_profile,
        result.case_definition_sha256,
        result.oracle_definition_sha256,
        result.evidence_tier,
        result.predecessor_dependency,
        result.dependency_classification_status,
        result.study_track,
        result.formation_track,
        result.precursor_trace_sha256,
        result.native_hook_capture_sha256,
    )


def _aggregate_clustered_pairs(
    pairs: list[tuple[RunResult, RunResult]],
) -> list[tuple[float, float]]:
    """Average repetitions before inference so a case cannot inflate its weight."""

    by_cluster: dict[tuple[str, str, str], list[tuple[RunResult, RunResult]]] = {}
    for treatment, control in pairs:
        if treatment.cluster_key != control.cluster_key:
            raise ValueError("matched runs do not belong to the same analysis cluster")
        by_cluster.setdefault(treatment.cluster_key, []).append((treatment, control))

    clusters: list[tuple[float, float]] = []
    for key in sorted(by_cluster):
        cluster_pairs = by_cluster[key]
        signature = _cluster_signature(cluster_pairs[0][0])
        for treatment, control in cluster_pairs:
            if _cluster_signature(treatment) != signature or _cluster_signature(control) != signature:
                raise ValueError(
                    "repetitions within one analysis cluster use different frozen evidence"
                )
        count = len(cluster_pairs)
        clusters.append((
            sum(float(treatment.task_success) for treatment, _ in cluster_pairs) / count,
            sum(float(control.task_success) for _, control in cluster_pairs) / count,
        ))
    return clusters


def _require_single_confirmatory_cohort(
    pairs: Iterable[tuple[RunResult, RunResult]],
) -> None:
    cohorts = {
        (treatment.agent, treatment.actual_model_id)
        for treatment, _control in pairs
    }
    if len(cohorts) != 1:
        raise ValueError(
            "confirmatory comparisons must analyze one agent and actual-model cohort at a time"
        )


def cluster_sign_flip_p(
    differences: Iterable[float],
    *,
    samples: int = 100_000,
    seed: int = 1729,
) -> float:
    """Conditional sign-flip reference p value; exact enumeration needs exchangeability."""

    nonzero = [float(value) for value in differences if not math.isclose(value, 0.0)]
    if not nonzero:
        return 1.0
    if samples < 100:
        raise ValueError("permutation samples must be at least 100")
    observed = abs(sum(nonzero))
    if len(nonzero) <= 18:
        totals = [0.0]
        for difference in nonzero:
            totals = [total + sign * difference for total in totals for sign in (-1.0, 1.0)]
        extreme = sum(abs(total) >= observed - 1e-12 for total in totals)
        return extreme / len(totals)
    rng = random.Random(seed)
    extreme = 0
    for _ in range(samples):
        total = sum(
            difference if rng.randrange(2) else -difference
            for difference in nonzero
        )
        if abs(total) >= observed - 1e-12:
            extreme += 1
    return (extreme + 1) / (samples + 1)


def compare_conditions(
    results: Iterable[RunResult],
    *,
    treatment: str,
    control: str,
    bootstrap_samples: int = 10_000,
    bootstrap_seed: int = 1729,
    permutation_samples: int = 100_000,
    require_confirmatory: bool = True,
    include_low_dependency: bool = False,
    allow_mixed_models: bool = False,
) -> PairedComparison:
    if allow_mixed_models and require_confirmatory:
        raise ValueError("mixed-model override is available only for development diagnostics")
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
        treatment_models: dict[tuple[str, str, int, int], set[str]] = {}
        control_models: dict[tuple[str, str, int, int], set[str]] = {}
        for item in by_condition[treatment].values():
            treatment_models.setdefault(
                (item.case_id, item.agent, item.repetition, item.seed),
                set(),
            ).add(item.actual_model_id)
        for item in by_condition[control].values():
            control_models.setdefault(
                (item.case_id, item.agent, item.repetition, item.seed),
                set(),
            ).add(item.actual_model_id)
        if any(
            treatment_models[key] != control_models[key]
            for key in set(treatment_models) & set(control_models)
        ):
            raise ValueError("paired runs report different actual models")
        raise ValueError("no matched treatment/control runs")
    pairs = [
        (by_condition[treatment][key], by_condition[control][key])
        for key in matched_keys
    ]
    for treatment_run, control_run in pairs:
        _assert_pair_compatible(
            treatment_run,
            control_run,
            allow_mixed_models=allow_mixed_models,
        )
    if require_confirmatory:
        _require_single_confirmatory_cohort(pairs)
    clusters = _aggregate_clustered_pairs(pairs)
    treatment_rate = sum(item[0] for item in clusters) / len(clusters)
    control_rate = sum(item[1] for item in clusters) / len(clusters)
    treatment_favored = sum(treatment_value > control_value for treatment_value, control_value in clusters)
    control_favored = sum(control_value > treatment_value for treatment_value, control_value in clusters)
    unmatched = len(selected) - 2 * len(pairs)
    return PairedComparison(
        treatment=treatment,
        control=control,
        pairs=len(pairs),
        clusters=len(clusters),
        analysis_unit="case-within-agent-actual-model-cohort-v1",
        treatment_success_rate=treatment_rate,
        control_success_rate=control_rate,
        absolute_difference=treatment_rate - control_rate,
        confidence_interval=_cluster_bootstrap_difference(
            clusters,
            samples=bootstrap_samples,
            seed=bootstrap_seed,
        ),
        treatment_favored_clusters=treatment_favored,
        control_favored_clusters=control_favored,
        cluster_sign_flip_p=cluster_sign_flip_p(
            (treatment_value - control_value for treatment_value, control_value in clusters),
            samples=permutation_samples,
            seed=bootstrap_seed,
        ),
        unmatched_runs=unmatched,
        excluded_invalid_runs=excluded_invalid,
    )
