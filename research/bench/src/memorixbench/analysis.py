from __future__ import annotations

from collections import Counter, defaultdict
from datetime import datetime, timezone
import hashlib
import json
import math
from pathlib import Path
import random
from statistics import median
from typing import Any

from .cohort import CohortReceipt, _artifact_path
from .models import sha256_file


ANALYSIS_SCHEMA = "memorixbench-cohort-analysis-v1"
_LEDGER_SCHEMA = "memorixbench-frozen-cohort-run-ledger-v1"
_RECEIPT_SCHEMA = "exploratory-sealed-local-v2"
_CONDITIONS = ("no-memory", "raw-record", "memorix-native")
_METRICS = (
    "input_tokens",
    "output_tokens",
    "total_tokens",
    "transfer_elapsed_ms",
    "tool_call_count",
    "ordinary_tool_call_count",
    "evidence_tool_call_count",
    "provider_reported_request_price_usd",
)
_BOOTSTRAP_SAMPLES = 10_000


def _read_object(path: Path, *, label: str) -> dict[str, Any]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as error:
        raise ValueError(f"{label} must be valid JSON") from error
    if not isinstance(payload, dict):
        raise ValueError(f"{label} must be a JSON object")
    return payload


def _safe_receipt_path(root: Path, filename: object) -> Path:
    if not isinstance(filename, str) or not filename or Path(filename).name != filename:
        raise ValueError("cohort ledger contains an unsafe receipt filename")
    path = (root / "receipts" / filename).resolve()
    receipts_root = (root / "receipts").resolve()
    if receipts_root not in path.parents:
        raise ValueError("cohort receipt escapes the artifact root")
    return path


def _number(value: object) -> int | float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    if isinstance(value, float) and not math.isfinite(value):
        raise ValueError("cohort receipt contains a non-finite resource value")
    return value


def _metric_summary(rows: list[dict[str, Any]]) -> dict[str, dict[str, int | float]]:
    summary: dict[str, dict[str, int | float]] = {}
    for metric in _METRICS:
        values = [
            value
            for row in rows
            if row["valid"]
            for value in (_number(row["resource_usage"].get(metric)),)
            if value is not None
        ]
        if values:
            summary[metric] = {
                "observed_rows": len(values),
                "sum": round(sum(values), 6),
                "median": round(float(median(values)), 6),
                "min": round(min(values), 6),
                "max": round(max(values), 6),
            }
    return summary


def _percentile(values: list[float], quantile: float) -> float:
    ordered = sorted(values)
    if not ordered:
        raise ValueError("cannot calculate a percentile of an empty collection")
    position = (len(ordered) - 1) * quantile
    lower = int(position)
    upper = min(lower + 1, len(ordered) - 1)
    fraction = position - lower
    return ordered[lower] + (ordered[upper] - ordered[lower]) * fraction


def _bootstrap_interval(values: list[float], *, seed_material: str) -> list[float] | None:
    if not values:
        return None
    seed = int(hashlib.sha256(seed_material.encode("utf-8")).hexdigest()[:16], 16)
    generator = random.Random(seed)
    sample_size = len(values)
    means = [
        sum(values[generator.randrange(sample_size)] for _ in range(sample_size)) / sample_size
        for _ in range(_BOOTSTRAP_SAMPLES)
    ]
    return [round(_percentile(means, 0.025), 6), round(_percentile(means, 0.975), 6)]


def _mean(values: list[float]) -> float | None:
    return round(sum(values) / len(values), 6) if values else None


def _route_expectations(cohort: CohortReceipt) -> dict[str, str]:
    expectations: dict[str, str] = {}
    for route in cohort.payload["routes"]:
        route_id = str(route.get("route_id", "")).strip()
        actual_model = str(route.get("expected_actual_model", "")).strip()
        if not route_id or not actual_model or route_id in expectations:
            raise ValueError("cohort route definitions are incomplete")
        expectations[route_id] = actual_model
    return expectations


def _receipt_observation(
    *,
    root: Path,
    cohort: CohortReceipt,
    row: dict[str, Any],
    record: dict[str, Any],
    expected_actual_model: str,
) -> dict[str, Any]:
    filename = record.get("receipt_filename")
    receipt_path = _safe_receipt_path(root, filename)
    if not receipt_path.is_file():
        raise ValueError("cohort ledger references a missing receipt")
    if record.get("receipt_sha256") != sha256_file(receipt_path):
        raise ValueError("cohort receipt hash does not match the ledger")
    receipt = _read_object(receipt_path, label="cohort trial receipt")
    if receipt.get("schema_version") != _RECEIPT_SCHEMA:
        raise ValueError("cohort receipt has an unsupported schema")
    if receipt.get("study_role") != "cohort":
        raise ValueError("cohort receipt is not explicitly labeled as a cohort row")
    if receipt.get("case_id") != row["case_id"] or receipt.get("condition") != row["condition"]:
        raise ValueError("cohort receipt does not match its scheduled case or condition")
    if receipt.get("requested_model") != row["route_id"]:
        raise ValueError("cohort receipt does not match its scheduled route")
    if receipt.get("surface_profile") != "canonical-information":
        raise ValueError("cohort receipt has an unsupported surface profile")
    evidence_policy = receipt.get("evidence_policy")
    if not isinstance(evidence_policy, dict) or evidence_policy.get("mode") != "fixed-index":
        raise ValueError("cohort receipt has an unsupported evidence policy")
    route = receipt.get("route")
    actual_models = receipt.get("actual_models")
    if (
        not isinstance(route, dict)
        or route.get("expected_actual_model") != expected_actual_model
        or actual_models != [expected_actual_model]
    ):
        raise ValueError("cohort receipt model identity does not match the frozen route")
    runner = receipt.get("runner")
    if not isinstance(runner, dict) or runner.get("source_tree_sha256") != cohort.payload.get(
        "runner_source_tree_sha256"
    ):
        raise ValueError("cohort receipt runner hash does not match the frozen cohort")
    execution_environment = receipt.get("execution_environment")
    if (
        not isinstance(execution_environment, dict)
        or execution_environment.get("mode") != "docker-named-volume"
        or execution_environment.get("docker_image") != cohort.payload.get("docker_image")
        or execution_environment.get("docker_image_id") != cohort.payload.get("docker_image_id")
    ):
        raise ValueError("cohort receipt was not run by the frozen Docker worker")
    case = receipt.get("case")
    if not isinstance(case, dict) or case.get("class") != row["case_class"]:
        raise ValueError("cohort receipt case class does not match the frozen cohort")
    if (
        receipt.get("status") != record.get("status")
        or receipt.get("task_success") != record.get("task_success")
        or receipt.get("invalid_reason") != record.get("invalid_reason")
    ):
        raise ValueError("cohort receipt result does not match the ledger")
    resource_usage = receipt.get("resource_usage")
    if not isinstance(resource_usage, dict):
        raise ValueError("cohort receipt resource usage is missing")
    valid = (
        receipt.get("status") == "completed"
        and receipt.get("invalid_reason") is None
        and isinstance(receipt.get("task_success"), bool)
    )
    return {
        "route_id": row["route_id"],
        "case_id": row["case_id"],
        "case_class": row["case_class"],
        "repetition": row["repetition"],
        "condition": row["condition"],
        "status": receipt.get("status"),
        "valid": valid,
        "task_success": receipt.get("task_success") if valid else None,
        "invalid_reason": receipt.get("invalid_reason"),
        "resource_usage": resource_usage,
    }


def _load_observations(*, cohort: CohortReceipt, artifact_root: Path) -> list[dict[str, Any]]:
    ledger_path = artifact_root / "cohort-run-ledger.json"
    if not ledger_path.is_file():
        raise ValueError("cohort run ledger is missing")
    ledger = _read_object(ledger_path, label="cohort run ledger")
    if (
        ledger.get("schema_version") != _LEDGER_SCHEMA
        or ledger.get("cohort_id") != cohort.cohort_id
        or ledger.get("cohort_receipt_sha256") != cohort.definition_sha256
        or not isinstance(ledger.get("rows"), dict)
    ):
        raise ValueError("cohort run ledger does not match the frozen cohort")
    schedule = cohort.payload["schedule"]
    expected = {str(row["row_id"]): row for row in schedule}
    records = ledger["rows"]
    if set(records) != set(expected):
        raise ValueError("cohort run ledger is incomplete or contains unexpected rows")
    routes = _route_expectations(cohort)
    observations: list[dict[str, Any]] = []
    for row_id, row in expected.items():
        record = records[row_id]
        if not isinstance(record, dict) or record.get("state") != "finalized":
            raise ValueError("cohort run ledger contains an unfinished row")
        for field in ("case_id", "route_id", "repetition", "condition"):
            if record.get(field) != row[field]:
                raise ValueError("cohort run ledger row does not match the frozen schedule")
        if record.get("status") == "infrastructure-error":
            observations.append(
                {
                    "route_id": row["route_id"],
                    "case_id": row["case_id"],
                    "case_class": row["case_class"],
                    "repetition": row["repetition"],
                    "condition": row["condition"],
                    "status": "infrastructure-error",
                    "valid": False,
                    "task_success": None,
                    "invalid_reason": f"infrastructure:{record.get('failure_type', 'unknown')}",
                    "resource_usage": {},
                }
            )
            continue
        observations.append(
            _receipt_observation(
                root=artifact_root,
                cohort=cohort,
                row=row,
                record=record,
                expected_actual_model=routes[str(row["route_id"])],
            )
        )
    return observations


def _condition_summaries(observations: list[dict[str, Any]]) -> list[dict[str, Any]]:
    groups: dict[tuple[str, str, str], list[dict[str, Any]]] = defaultdict(list)
    for row in observations:
        groups[(row["route_id"], row["case_class"], row["condition"])].append(row)
    summaries: list[dict[str, Any]] = []
    for (route_id, case_class, condition), rows in sorted(groups.items()):
        valid_rows = [row for row in rows if row["valid"]]
        failures = [row for row in valid_rows if row["task_success"] is False]
        invalid_rows = [row for row in rows if not row["valid"]]
        reasons = Counter(str(row["invalid_reason"] or row["status"]) for row in invalid_rows)
        summaries.append(
            {
                "route_id": route_id,
                "case_class": case_class,
                "condition": condition,
                "planned_rows": len(rows),
                "valid_rows": len(valid_rows),
                "task_success_rows": sum(row["task_success"] is True for row in valid_rows),
                "task_failure_rows": len(failures),
                "invalid_rows": len(invalid_rows),
                "invalid_reason_counts": dict(sorted(reasons.items())),
                "resource_usage": _metric_summary(rows),
            }
        )
    return summaries


def _invalidity_table(observations: list[dict[str, Any]]) -> list[dict[str, Any]]:
    counts: Counter[tuple[str, str, str, str, str]] = Counter()
    for row in observations:
        if not row["valid"]:
            counts[
                (
                    str(row["route_id"]),
                    str(row["case_id"]),
                    str(row["case_class"]),
                    str(row["condition"]),
                    str(row["invalid_reason"] or row["status"]),
                )
            ] += 1
    return [
        {
            "route_id": route_id,
            "case_id": case_id,
            "case_class": case_class,
            "condition": condition,
            "reason": reason,
            "row_count": count,
        }
        for (route_id, case_id, case_class, condition, reason), count in sorted(counts.items())
    ]


def _paired_contrasts(*, cohort: CohortReceipt, observations: list[dict[str, Any]]) -> list[dict[str, Any]]:
    by_case: dict[tuple[str, str, str], list[dict[str, Any]]] = defaultdict(list)
    for row in observations:
        by_case[(row["route_id"], row["case_class"], row["case_id"])].append(row)
    grouped_effects: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
    for (route_id, case_class, _case_id), rows in sorted(by_case.items()):
        by_repetition: dict[int, dict[str, dict[str, Any]]] = defaultdict(dict)
        for row in rows:
            by_repetition[int(row["repetition"])][str(row["condition"])] = row
        paired = [
            condition_rows
            for condition_rows in by_repetition.values()
            if set(condition_rows) == set(_CONDITIONS) and all(entry["valid"] for entry in condition_rows.values())
        ]
        if not paired:
            continue
        means = {
            condition: sum(float(item[condition]["task_success"]) for item in paired) / len(paired)
            for condition in _CONDITIONS
        }
        grouped_effects[(route_id, case_class)].append(
            {
                "paired_repetitions": len(paired),
                "native_minus_no_memory": means["memorix-native"] - means["no-memory"],
                "raw_minus_no_memory": means["raw-record"] - means["no-memory"],
                "native_minus_raw": means["memorix-native"] - means["raw-record"],
            }
        )
    contrasts: list[dict[str, Any]] = []
    for (route_id, case_class), effects in sorted(grouped_effects.items()):
        native_none = [float(item["native_minus_no_memory"]) for item in effects]
        raw_none = [float(item["raw_minus_no_memory"]) for item in effects]
        native_raw = [float(item["native_minus_raw"]) for item in effects]
        seed_prefix = f"{cohort.cohort_id}|{route_id}|{case_class}"
        contrasts.append(
            {
                "route_id": route_id,
                "case_class": case_class,
                "paired_case_count": len(effects),
                "paired_repetition_count": sum(int(item["paired_repetitions"]) for item in effects),
                "mean_native_minus_no_memory": _mean(native_none),
                "mean_raw_minus_no_memory": _mean(raw_none),
                "mean_native_minus_raw": _mean(native_raw),
                "bootstrap_95_native_minus_no_memory": _bootstrap_interval(
                    native_none,
                    seed_material=f"{seed_prefix}|native-none",
                ),
                "bootstrap_95_raw_minus_no_memory": _bootstrap_interval(
                    raw_none,
                    seed_material=f"{seed_prefix}|raw-none",
                ),
                "bootstrap_95_native_minus_raw": _bootstrap_interval(
                    native_raw,
                    seed_material=f"{seed_prefix}|native-raw",
                ),
            }
        )
    return contrasts


def analyze_frozen_cohort(*, cohort_path: str | Path, artifact_root: str | Path) -> dict[str, Any]:
    """Return a sanitized complete-cohort analysis or fail before reading partial data."""
    cohort = CohortReceipt.load(cohort_path)
    root = _artifact_path(artifact_root)
    observations = _load_observations(cohort=cohort, artifact_root=root)
    valid_rows = [row for row in observations if row["valid"]]
    return {
        "schema_version": ANALYSIS_SCHEMA,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "cohort": {
            "cohort_id": cohort.cohort_id,
            "receipt_sha256": cohort.definition_sha256,
            "analysis_plan_sha256": cohort.payload.get("analysis_plan_sha256"),
        },
        "row_accounting": {
            "planned_rows": len(observations),
            "finalized_rows": len(observations),
            "valid_rows": len(valid_rows),
            "invalid_rows": len(observations) - len(valid_rows),
            "task_success_rows": sum(row["task_success"] is True for row in valid_rows),
            "task_failure_rows": sum(row["task_success"] is False for row in valid_rows),
        },
        "condition_summaries": _condition_summaries(observations),
        "invalidity_table": _invalidity_table(observations),
        "paired_contrasts": _paired_contrasts(cohort=cohort, observations=observations),
    }


def write_cohort_analysis(
    *,
    cohort_path: str | Path,
    artifact_root: str | Path,
    output_path: str | Path,
) -> Path:
    output = _artifact_path(output_path)
    if output.exists():
        raise ValueError("cohort analysis already exists and must not be overwritten")
    payload = analyze_frozen_cohort(cohort_path=cohort_path, artifact_root=artifact_root)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(payload, indent=2, ensure_ascii=True) + "\n", encoding="utf-8")
    return output
