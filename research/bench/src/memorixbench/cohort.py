from __future__ import annotations

from collections import Counter
from dataclasses import dataclass
from datetime import datetime, timezone
import json
from pathlib import Path
import re
from typing import Any
from uuid import uuid4

from .docker_runner import DEFAULT_DOCKER_IMAGE, DockerTrialRequest, _image_id, run_docker_trial
from .models import CASE_CLASSES, CaseSpec, OracleSpec, RouteSpec, compact_json, sha256_file, sha256_text, sha256_tree
from .review import REVIEW_AUDIT_SCHEMA
from .trial import agent_tools


COHORT_SCHEMA = "memorixbench-exploratory-cohort-v2"
_COHORT_ID_PATTERN = re.compile(r"^cohort-[0-9a-f]{12}$")
_SHA256_PATTERN = re.compile(r"^[0-9a-f]{64}$")
_CONDITIONS = ("no-memory", "raw-record", "memorix-native")
_REPETITIONS = 3
_MAX_STEPS = 24
_SURFACE_PROFILE = "canonical-information"
_EVIDENCE_POLICY = "fixed-index"
_MEMORIX_TIMEOUT_SECONDS = 120
_RUN_LEDGER_SCHEMA = "memorixbench-frozen-cohort-run-ledger-v1"


@dataclass(frozen=True)
class _CaseInput:
    case_path: Path
    oracle_path: Path
    receipt_entry: dict[str, object]


@dataclass(frozen=True)
class CohortReceipt:
    path: Path
    definition_sha256: str
    payload: dict[str, Any]

    @property
    def cohort_id(self) -> str:
        return str(self.payload["cohort_id"])

    @classmethod
    def load(cls, path: str | Path) -> "CohortReceipt":
        receipt_path = _artifact_path(path)
        payload = _read_object(receipt_path, label="cohort receipt")
        if payload.get("schema_version") != COHORT_SCHEMA or payload.get("status") != "frozen":
            raise ValueError("cohort receipt has an unsupported schema or status")
        cohort_id = str(payload.get("cohort_id", "")).strip()
        cases = payload.get("cases")
        routes = payload.get("routes")
        schedule = payload.get("schedule")
        if (
            not _COHORT_ID_PATTERN.fullmatch(cohort_id)
            or not isinstance(cases, list)
            or not isinstance(routes, list)
            or not isinstance(schedule, list)
            or payload.get("expected_row_count") != len(schedule)
        ):
            raise ValueError("cohort receipt is incomplete")
        if not all(isinstance(case, dict) for case in cases) or not all(
            isinstance(route, dict) for route in routes
        ):
            raise ValueError("cohort receipt cases and routes must be objects")
        if any(
            not _SHA256_PATTERN.fullmatch(str(route.get("action_calibration_receipt_sha256", "")))
            for route in routes
        ):
            raise ValueError("cohort receipt is missing action calibration evidence")
        try:
            expected_schedule = build_schedule(
                cohort_id=cohort_id,
                case_entries=cases,
                route_entries=routes,
            )
        except (KeyError, TypeError, ValueError) as error:
            raise ValueError("cohort receipt contains an invalid schedule definition") from error
        if schedule != expected_schedule:
            raise ValueError("cohort receipt schedule does not match its frozen inputs")
        return cls(
            path=receipt_path,
            definition_sha256=sha256_file(receipt_path),
            payload=payload,
        )


def _repository_root() -> Path:
    return Path(__file__).resolve().parents[4]


def _artifact_path(value: str | Path) -> Path:
    path = Path(value).resolve()
    allowed = (_repository_root() / "research" / "artifacts").resolve()
    if path != allowed and allowed not in path.parents:
        raise ValueError("cohort inputs and receipts must stay below research/artifacts")
    return path


def _read_object(path: Path, *, label: str) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as error:
        raise ValueError(f"{label} must be valid JSON") from error
    if not isinstance(value, dict):
        raise ValueError(f"{label} must be a JSON object")
    return value


def _case_inputs(case_bank: Path) -> list[_CaseInput]:
    root = _artifact_path(case_bank)
    if not root.is_dir():
        raise ValueError("case bank must be an existing directory")
    inputs: list[_CaseInput] = []
    for case_dir in sorted(path for path in root.iterdir() if path.is_dir()):
        case_path = case_dir / "case.json"
        oracle_path = case_dir / "oracle" / "oracle.json"
        if not case_path.is_file() or not oracle_path.is_file():
            raise ValueError(f"case bank entry {case_dir.name} must contain case.json and oracle/oracle.json")
        case = CaseSpec.load(case_path)
        oracle = OracleSpec.load(oracle_path)
        if case.case_id != case_dir.name:
            raise ValueError("case bank directory name must match the frozen case id")
        if case.case_tier != "exploratory-source-backed":
            raise ValueError("frozen cohort cases must be exploratory source-backed")
        if (
            case.source_tree_sha256 is None
            or case.source_archive_sha256 is None
            or case.source_commit is None
            or oracle.assets_sha256 is None
        ):
            raise ValueError("frozen cohort cases require source and oracle integrity hashes")
        inputs.append(
            _CaseInput(
                case_path=case_path,
                oracle_path=oracle_path,
                receipt_entry={
                    "case_id": case.case_id,
                    "case_class": case.case_class,
                    "case_card_sha256": sha256_file(case_path),
                    "source_tree_sha256": case.source_tree_sha256,
                    "source_archive_sha256": case.source_archive_sha256,
                    "source_commit": case.source_commit,
                    "oracle_definition_sha256": oracle.definition_sha256,
                    "oracle_assets_sha256": oracle.assets_sha256,
                },
            )
        )
    expected_classes = Counter({case_class: 3 for case_class in CASE_CLASSES})
    actual_classes = Counter(str(item.receipt_entry["case_class"]) for item in inputs)
    if len(inputs) != 9 or actual_classes != expected_classes:
        raise ValueError("frozen cohort requires exactly three sealed cases from every case class")
    return inputs


def _case_entries(case_bank: Path) -> list[dict[str, object]]:
    return [item.receipt_entry for item in _case_inputs(case_bank)]


def _admitted_case_ids(review_audit_path: Path, case_entries: list[dict[str, object]]) -> str:
    audit_path = _artifact_path(review_audit_path)
    audit = _read_object(audit_path, label="review audit")
    if audit.get("schema_version") != REVIEW_AUDIT_SCHEMA:
        raise ValueError("review audit has an unsupported schema")
    if audit.get("all_cases_admitted") is not True:
        raise ValueError("review audit does not admit every candidate case")
    cases = audit.get("cases")
    if not isinstance(cases, list):
        raise ValueError("review audit cases are missing")
    admitted = {
        str(case.get("case_id", "")).strip()
        for case in cases
        if isinstance(case, dict) and case.get("admission_state") == "admitted"
    }
    expected = {str(entry["case_id"]) for entry in case_entries}
    if admitted != expected:
        raise ValueError("review audit admitted cases do not match the frozen case bank")
    return sha256_file(audit_path)


def _route_entries(
    route_paths: list[Path] | tuple[Path, ...],
    route_window_paths: list[Path] | tuple[Path, ...],
) -> list[dict[str, object]]:
    if len(route_paths) != 2 or len(route_window_paths) != 2:
        raise ValueError("frozen cohort requires exactly two route files and two route windows")
    windows: dict[str, tuple[Path, dict[str, Any]]] = {}
    for raw_window_path in route_window_paths:
        window_path = _artifact_path(raw_window_path)
        window = _read_object(window_path, label="route qualification window")
        route = window.get("route")
        attempts = window.get("attempts")
        if (
            window.get("schema_version") != "route-qualification-window-v1"
            or window.get("qualification_type") != "fixed-three-probe-transport-window"
            or window.get("attempt_count") != 3
            or window.get("all_passed") is not True
            or not isinstance(route, dict)
            or not isinstance(attempts, list)
            or len(attempts) != 3
            or any(not isinstance(attempt, dict) or attempt.get("status") != "passed" for attempt in attempts)
        ):
            raise ValueError("route window must be a passing fixed three-probe qualification")
        route_hash = str(route.get("definition_sha256", "")).strip().lower()
        if not route_hash or route_hash in windows:
            raise ValueError("route windows must name two distinct frozen route hashes")
        windows[route_hash] = (window_path, window)

    entries: list[dict[str, object]] = []
    route_ids: set[str] = set()
    for raw_route_path in route_paths:
        route_path = _artifact_path(raw_route_path)
        route = RouteSpec.load(route_path)
        if route.definition_sha256 not in windows:
            raise ValueError("every frozen route requires its matching passing qualification window")
        if route.requested_model in route_ids:
            raise ValueError("frozen route requested models must be distinct")
        route_ids.add(route.requested_model)
        window_path, _window = windows[route.definition_sha256]
        entries.append(
            {
                "route_id": route.requested_model,
                "route_definition_sha256": route.definition_sha256,
                "provider": route.provider,
                "expected_actual_model": route.expected_actual_model,
                "qualification_window_sha256": sha256_file(window_path),
            }
        )
    return sorted(entries, key=lambda entry: str(entry["route_id"]))


def _action_calibration_entries(
    *,
    route_entries: list[dict[str, object]],
    action_calibration_paths: list[Path] | tuple[Path, ...],
    runner_source_tree_sha256: str,
    docker_image: str,
    docker_image_id: str,
) -> list[dict[str, object]]:
    """Bind one successful, current-runner Docker action calibration to each route."""
    if len(action_calibration_paths) != len(route_entries):
        raise ValueError("frozen cohort requires exactly one action calibration per route")
    expected = {str(route["route_id"]): route for route in route_entries}
    expected_tool_schema_sha256 = sha256_text(
        compact_json(agent_tools("no-memory", _SURFACE_PROFILE))
    )
    calibration_hashes: dict[str, str] = {}
    for raw_path in action_calibration_paths:
        path = _artifact_path(raw_path)
        receipt = _read_object(path, label="action calibration receipt")
        if receipt.get("schema_version") != "exploratory-sealed-local-v2":
            raise ValueError("action calibration receipt has an unsupported schema")
        if receipt.get("study_role") != "action-calibration":
            raise ValueError("action calibration receipt must be explicitly labeled action-calibration")
        if (
            receipt.get("status") != "completed"
            or receipt.get("task_success") is not True
            or receipt.get("invalid_reason") is not None
            or receipt.get("condition") != "no-memory"
            or receipt.get("surface_profile") != _SURFACE_PROFILE
            or receipt.get("tool_schema_sha256") != expected_tool_schema_sha256
        ):
            raise ValueError("action calibration did not pass the frozen repair-loop contract")
        evidence_policy = receipt.get("evidence_policy")
        if not isinstance(evidence_policy, dict) or evidence_policy.get("mode") != _EVIDENCE_POLICY:
            raise ValueError("action calibration has an unsupported evidence policy")
        runner = receipt.get("runner")
        if not isinstance(runner, dict) or runner.get("source_tree_sha256") != runner_source_tree_sha256:
            raise ValueError("action calibration runner hash does not match the current cohort runner")
        execution_environment = receipt.get("execution_environment")
        if (
            not isinstance(execution_environment, dict)
            or execution_environment.get("mode") != "docker-named-volume"
            or execution_environment.get("docker_image") != docker_image
            or execution_environment.get("docker_image_id") != docker_image_id
        ):
            raise ValueError("action calibration was not run by the frozen Docker worker")
        route_id = receipt.get("requested_model")
        if not isinstance(route_id, str) or route_id not in expected or route_id in calibration_hashes:
            raise ValueError("action calibrations must cover each frozen route exactly once")
        route = expected[route_id]
        route_payload = receipt.get("route")
        actual_models = receipt.get("actual_models")
        if (
            not isinstance(route_payload, dict)
            or route_payload.get("definition_sha256") != route["route_definition_sha256"]
            or route_payload.get("expected_actual_model") != route["expected_actual_model"]
            or actual_models != [route["expected_actual_model"]]
        ):
            raise ValueError("action calibration route identity does not match the frozen route")
        action = receipt.get("agent_action")
        verification_count = action.get("agent_verification_call_count") if isinstance(action, dict) else None
        if (
            not isinstance(action, dict)
            or action.get("max_steps") != _MAX_STEPS
            or action.get("verification_required_before_finish") is not True
            or action.get("source_changed") is not True
            or action.get("source_edit_succeeded") is not True
            or isinstance(verification_count, bool)
            or not isinstance(verification_count, int)
            or verification_count < 1
        ):
            raise ValueError("action calibration did not prove a verified source repair")
        calibration_hashes[route_id] = sha256_file(path)
    if set(calibration_hashes) != set(expected):
        raise ValueError("action calibrations do not match the frozen route set")
    return [
        {
            **route,
            "action_calibration_receipt_sha256": calibration_hashes[str(route["route_id"])],
        }
        for route in sorted(route_entries, key=lambda entry: str(entry["route_id"]))
    ]


def build_schedule(
    *,
    cohort_id: str,
    case_entries: list[dict[str, object]],
    route_entries: list[dict[str, object]],
) -> list[dict[str, object]]:
    if not _COHORT_ID_PATTERN.fullmatch(cohort_id):
        raise ValueError("cohort_id is invalid")
    rows: list[dict[str, object]] = []
    for route in sorted(route_entries, key=lambda entry: str(entry["route_id"])):
        for case in sorted(case_entries, key=lambda entry: str(entry["case_id"])):
            for repetition in range(1, _REPETITIONS + 1):
                for condition in _CONDITIONS:
                    descriptor = "|".join(
                        (
                            cohort_id,
                            str(route["route_id"]),
                            str(case["case_id"]),
                            str(repetition),
                            condition,
                        )
                    )
                    rows.append(
                        {
                            "row_id": sha256_text(descriptor),
                            "route_id": route["route_id"],
                            "case_id": case["case_id"],
                            "case_class": case["case_class"],
                            "repetition": repetition,
                            "condition": condition,
                        }
                    )
    return sorted(rows, key=lambda row: str(row["row_id"]))


def freeze_cohort(
    *,
    case_bank: str | Path,
    review_audit_path: str | Path,
    route_paths: list[Path] | tuple[Path, ...],
    route_window_paths: list[Path] | tuple[Path, ...],
    action_calibration_paths: list[Path] | tuple[Path, ...],
    analysis_plan_path: str | Path,
    output_path: str | Path,
    docker_image: str = DEFAULT_DOCKER_IMAGE,
) -> Path:
    output = _artifact_path(output_path)
    if output.exists():
        raise ValueError("cohort receipt already exists and must not be overwritten")
    case_entries = _case_entries(Path(case_bank))
    review_audit_sha256 = _admitted_case_ids(Path(review_audit_path), case_entries)
    docker_image_id = _image_id("docker", docker_image)
    runner_source_tree_sha256 = sha256_tree(Path(__file__).resolve().parent)
    routes = _action_calibration_entries(
        route_entries=_route_entries(route_paths, route_window_paths),
        action_calibration_paths=action_calibration_paths,
        runner_source_tree_sha256=runner_source_tree_sha256,
        docker_image=docker_image,
        docker_image_id=docker_image_id,
    )
    analysis_plan = Path(analysis_plan_path).resolve()
    if not analysis_plan.is_file():
        raise ValueError("analysis plan must be an existing file")
    cohort_id = f"cohort-{uuid4().hex[:12]}"
    schedule = build_schedule(cohort_id=cohort_id, case_entries=case_entries, route_entries=routes)
    expected_row_count = len(case_entries) * len(routes) * len(_CONDITIONS) * _REPETITIONS
    if len(schedule) != expected_row_count:
        raise RuntimeError("cohort schedule cardinality is inconsistent")
    payload = {
        "schema_version": COHORT_SCHEMA,
        "status": "frozen",
        "cohort_id": cohort_id,
        "frozen_at": datetime.now(timezone.utc).isoformat(),
        "analysis_plan_sha256": sha256_file(analysis_plan),
        "review_audit_sha256": review_audit_sha256,
        "runner_source_tree_sha256": runner_source_tree_sha256,
        "docker_image": docker_image,
        "docker_image_id": docker_image_id,
        "execution": {
            "surface_profile": _SURFACE_PROFILE,
            "evidence_policy": _EVIDENCE_POLICY,
            "max_steps": _MAX_STEPS,
            "memorix_timeout_seconds": _MEMORIX_TIMEOUT_SECONDS,
            "conditions": list(_CONDITIONS),
            "repetitions": _REPETITIONS,
        },
        "cases": sorted(case_entries, key=lambda entry: str(entry["case_id"])),
        "routes": routes,
        "expected_row_count": expected_row_count,
        "schedule": schedule,
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(payload, indent=2, ensure_ascii=True) + "\n", encoding="utf-8")
    return output


def _atomic_write(path: Path, payload: dict[str, Any]) -> None:
    temporary = path.with_name(f".{path.name}.{uuid4().hex}.tmp")
    temporary.write_text(json.dumps(payload, indent=2, ensure_ascii=True) + "\n", encoding="utf-8")
    temporary.replace(path)


def _private_case_inputs(
    *,
    cohort: CohortReceipt,
    case_bank: str | Path,
) -> dict[str, _CaseInput]:
    inputs = {str(item.receipt_entry["case_id"]): item for item in _case_inputs(Path(case_bank))}
    expected = {str(item["case_id"]): item for item in cohort.payload["cases"]}
    if set(inputs) != set(expected):
        raise ValueError("private case bank does not match the frozen cohort cases")
    for case_id, expected_entry in expected.items():
        if inputs[case_id].receipt_entry != expected_entry:
            raise ValueError("private case bank hashes do not match the frozen cohort receipt")
    return inputs


def _private_routes(
    *,
    cohort: CohortReceipt,
    route_paths: list[Path] | tuple[Path, ...],
) -> dict[str, Path]:
    routes: dict[str, Path] = {}
    for raw_path in route_paths:
        path = _artifact_path(raw_path)
        route = RouteSpec.load(path)
        if route.requested_model in routes:
            raise ValueError("private route files must have distinct requested models")
        routes[route.requested_model] = path
    expected = {str(item["route_id"]): item for item in cohort.payload["routes"]}
    if set(routes) != set(expected):
        raise ValueError("private route files do not match the frozen cohort routes")
    for route_id, expected_entry in expected.items():
        if RouteSpec.load(routes[route_id]).definition_sha256 != expected_entry["route_definition_sha256"]:
            raise ValueError("private route hash does not match the frozen cohort receipt")
    return routes


def _load_or_create_ledger(*, cohort: CohortReceipt, root: Path) -> tuple[Path, dict[str, Any]]:
    ledger_path = root / "cohort-run-ledger.json"
    if not ledger_path.exists():
        payload = {
            "schema_version": _RUN_LEDGER_SCHEMA,
            "cohort_id": cohort.cohort_id,
            "cohort_receipt_sha256": cohort.definition_sha256,
            "rows": {},
        }
        _atomic_write(ledger_path, payload)
        return ledger_path, payload
    payload = _read_object(ledger_path, label="cohort run ledger")
    if (
        payload.get("schema_version") != _RUN_LEDGER_SCHEMA
        or payload.get("cohort_id") != cohort.cohort_id
        or payload.get("cohort_receipt_sha256") != cohort.definition_sha256
        or not isinstance(payload.get("rows"), dict)
    ):
        raise ValueError("existing cohort run ledger does not match the frozen cohort")
    return ledger_path, payload


def run_frozen_cohort(
    *,
    cohort_path: str | Path,
    case_bank: str | Path,
    route_paths: list[Path] | tuple[Path, ...],
    artifact_root: str | Path,
    max_rows: int | None = None,
) -> dict[str, object]:
    """Run the next frozen rows once, with a durable start marker before every call."""
    cohort = CohortReceipt.load(cohort_path)
    if cohort.payload.get("runner_source_tree_sha256") != sha256_tree(Path(__file__).resolve().parent):
        raise RuntimeError("current runner source does not match the frozen cohort receipt")
    execution = cohort.payload.get("execution")
    if not isinstance(execution, dict):
        raise ValueError("cohort execution contract is missing")
    if (
        execution.get("surface_profile") != _SURFACE_PROFILE
        or execution.get("evidence_policy") != _EVIDENCE_POLICY
        or execution.get("max_steps") != _MAX_STEPS
        or execution.get("memorix_timeout_seconds") != _MEMORIX_TIMEOUT_SECONDS
        or execution.get("conditions") != list(_CONDITIONS)
        or execution.get("repetitions") != _REPETITIONS
    ):
        raise ValueError("cohort execution contract is unsupported")
    if _image_id("docker", str(cohort.payload["docker_image"])) != cohort.payload["docker_image_id"]:
        raise RuntimeError("current Docker image ID does not match the frozen cohort receipt")
    inputs = _private_case_inputs(cohort=cohort, case_bank=case_bank)
    routes = _private_routes(cohort=cohort, route_paths=route_paths)
    root = _artifact_path(artifact_root)
    root.mkdir(parents=True, exist_ok=True)
    if max_rows is not None and (isinstance(max_rows, bool) or max_rows < 1):
        raise ValueError("max_rows must be a positive integer when provided")
    lock_path = root / "cohort-run.lock"
    try:
        with lock_path.open("x", encoding="utf-8") as lock:
            lock.write(cohort.definition_sha256 + "\n")
    except FileExistsError as error:
        raise RuntimeError("cohort run lock exists; inspect the prior run before resuming") from error
    try:
        ledger_path, ledger = _load_or_create_ledger(cohort=cohort, root=root)
        records: dict[str, Any] = ledger["rows"]
        unresolved = [
            row_id
            for row_id, record in records.items()
            if isinstance(record, dict) and record.get("state") == "started"
        ]
        if unresolved:
            raise RuntimeError("cohort has a started row without a final receipt; do not rerun it")
        pending = [row for row in cohort.payload["schedule"] if row["row_id"] not in records]
        if max_rows is not None:
            pending = pending[:max_rows]
        for row in pending:
            row_id = str(row["row_id"])
            records[row_id] = {
                "state": "started",
                "started_at": datetime.now(timezone.utc).isoformat(),
                "case_id": row["case_id"],
                "route_id": row["route_id"],
                "repetition": row["repetition"],
                "condition": row["condition"],
            }
            _atomic_write(ledger_path, ledger)
            try:
                outcome = run_docker_trial(
                    DockerTrialRequest(
                        case_path=inputs[str(row["case_id"])].case_path,
                        oracle_path=inputs[str(row["case_id"])].oracle_path,
                        route_path=routes[str(row["route_id"])],
                        condition=str(row["condition"]),
                        artifact_root=root,
                        max_steps=_MAX_STEPS,
                        surface_profile=_SURFACE_PROFILE,
                        evidence_policy=_EVIDENCE_POLICY,
                        study_role="cohort",
                        memorix_timeout_seconds=_MEMORIX_TIMEOUT_SECONDS,
                        image=str(cohort.payload["docker_image"]),
                    )
                )
            except Exception as error:
                records[row_id].update(
                    {
                        "state": "finalized",
                        "status": "infrastructure-error",
                        "failure_type": type(error).__name__,
                        "finished_at": datetime.now(timezone.utc).isoformat(),
                    }
                )
            else:
                receipt_path = Path(outcome["receipt_path"])
                receipt = outcome["payload"]
                records[row_id].update(
                    {
                        "state": "finalized",
                        "status": receipt["status"],
                        "task_success": receipt["task_success"],
                        "invalid_reason": receipt["invalid_reason"],
                        "receipt_filename": receipt_path.name,
                        "receipt_sha256": sha256_file(receipt_path),
                        "finished_at": datetime.now(timezone.utc).isoformat(),
                    }
                )
            _atomic_write(ledger_path, ledger)
        finalized = sum(
            1
            for record in records.values()
            if isinstance(record, dict) and record.get("state") == "finalized"
        )
        return {
            "ledger_path": ledger_path,
            "completed_rows": finalized,
            "remaining_rows": len(cohort.payload["schedule"]) - finalized,
        }
    finally:
        lock_path.unlink(missing_ok=True)
