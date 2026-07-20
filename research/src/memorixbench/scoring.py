from __future__ import annotations

from dataclasses import dataclass
import json
import math
from pathlib import Path
import random
from typing import Iterable


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
    input_tokens: int | None = None
    output_tokens: int | None = None
    wall_seconds: float | None = None
    stale_memory_errors: int = 0
    negative_control_intrusions: int = 0
    valid_run: bool = True
    failure_reason: str | None = None

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
        return cls(
            case_id=str(data["case_id"]),
            condition=str(data["condition"]),
            agent=str(data["agent"]),
            model=str(data["model"]),
            repetition=int(data["repetition"]),
            seed=int(data["seed"]),
            task_success=data["task_success"],
            first_correct_action_seconds=_optional_float(data.get("first_correct_action_seconds")),
            input_tokens=_optional_int(data.get("input_tokens")),
            output_tokens=_optional_int(data.get("output_tokens")),
            wall_seconds=_optional_float(data.get("wall_seconds")),
            stale_memory_errors=int(data.get("stale_memory_errors", 0)),
            negative_control_intrusions=int(data.get("negative_control_intrusions", 0)),
            valid_run=bool(data.get("valid_run", True)),
            failure_reason=(
                None if data.get("failure_reason") is None else str(data["failure_reason"])
            ),
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
) -> PairedComparison:
    candidates = [item for item in results if item.condition in {treatment, control}]
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
