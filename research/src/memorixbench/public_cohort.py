"""Frozen, public reproducible cohort plans and result-matrix validation."""

from __future__ import annotations

from dataclasses import asdict, dataclass
import json
from pathlib import Path
import re
from typing import Any

from .agentmemory_adapter import AGENTMEMORY_PROVIDER_ID
from .mem0_adapter import MEM0_PROVIDER_ID
from .memorix_adapter import MEMORIX_CANONICAL_PROVIDER_ID
from .registry import CaseRegistry, validate_case_registry


PUBLIC_COHORT_PLAN_SCHEMA_VERSION = "public-reproducible-cohort-plan-v1"
SHA256_PATTERN = re.compile(r"^[0-9a-f]{64}$")
SUPPORTED_PUBLIC_CONDITIONS = frozenset({
    "no-memory",
    MEM0_PROVIDER_ID,
    AGENTMEMORY_PROVIDER_ID,
    MEMORIX_CANONICAL_PROVIDER_ID,
})


class PublicCohortPlanError(ValueError):
    """Raised when a public cohort plan or result matrix is not frozen."""


@dataclass(frozen=True)
class RepetitionSpec:
    repetition: int
    seed: int


@dataclass(frozen=True)
class PublicCohortPlan:
    schema_version: str
    plan_id: str
    registry_id: str
    registry_sha256: str
    agent: str
    model: str
    case_ids: tuple[str, ...]
    conditions: tuple[str, ...]
    repetitions: tuple[RepetitionSpec, ...]
    timeout_seconds: int
    max_budget_usd: float
    primary_treatment: str
    primary_control: str
    source_path: Path

    @property
    def expected_keys(self) -> tuple[tuple[str, str, int, int], ...]:
        return tuple(
            (case_id, condition, repeat.repetition, repeat.seed)
            for case_id in self.case_ids
            for condition in self.conditions
            for repeat in self.repetitions
        )


@dataclass(frozen=True)
class PublicCohortValidation:
    plan_id: str
    registry_id: str
    registry_sha256: str
    expected_rows: int
    observed_rows: int
    valid_rows: int
    invalid_rows: int
    task_success_rows: int
    full_tool_policy_sha256: str
    memorix_cli_sha256: str

    def public_payload(self) -> dict[str, object]:
        return asdict(self)


def _text(value: object, *, label: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise PublicCohortPlanError(f"public cohort plan {label} must be a non-empty string")
    return value.strip()


def _sha256(value: object, *, label: str) -> str:
    text = _text(value, label=label)
    if not SHA256_PATTERN.fullmatch(text):
        raise PublicCohortPlanError(f"public cohort plan {label} must be a SHA-256")
    return text


def _positive_int(value: object, *, label: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
        raise PublicCohortPlanError(f"public cohort plan {label} must be a positive integer")
    return value


def _positive_float(value: object, *, label: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or value <= 0:
        raise PublicCohortPlanError(f"public cohort plan {label} must be positive")
    return float(value)


def _strings(value: object, *, label: str) -> tuple[str, ...]:
    if not isinstance(value, list) or not value:
        raise PublicCohortPlanError(f"public cohort plan {label} must be a non-empty array")
    values = tuple(_text(item, label=label) for item in value)
    if len(set(values)) != len(values):
        raise PublicCohortPlanError(f"public cohort plan {label} contains duplicates")
    return values


def _repetitions(value: object) -> tuple[RepetitionSpec, ...]:
    if not isinstance(value, list) or not value:
        raise PublicCohortPlanError("public cohort plan repetitions must be a non-empty array")
    repetitions: list[RepetitionSpec] = []
    for item in value:
        if not isinstance(item, dict) or set(item) != {"repetition", "seed"}:
            raise PublicCohortPlanError("public cohort repetition must contain repetition and seed")
        repetition = _positive_int(item.get("repetition"), label="repetition")
        seed = item.get("seed")
        if isinstance(seed, bool) or not isinstance(seed, int):
            raise PublicCohortPlanError("public cohort plan seed must be an integer")
        repetitions.append(RepetitionSpec(repetition=repetition, seed=seed))
    identities = {(item.repetition, item.seed) for item in repetitions}
    if len(identities) != len(repetitions):
        raise PublicCohortPlanError("public cohort plan repetitions contain duplicates")
    return tuple(repetitions)


def load_public_cohort_plan(path: str | Path) -> PublicCohortPlan:
    source = Path(path).resolve()
    try:
        raw = json.loads(source.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise PublicCohortPlanError("public cohort plan cannot be read") from error
    if not isinstance(raw, dict):
        raise PublicCohortPlanError("public cohort plan must be a JSON object")
    expected = {
        "schema_version",
        "plan_id",
        "registry_id",
        "registry_sha256",
        "agent",
        "model",
        "case_ids",
        "conditions",
        "repetitions",
        "timeout_seconds",
        "max_budget_usd",
        "primary_treatment",
        "primary_control",
    }
    if set(raw) != expected:
        raise PublicCohortPlanError("public cohort plan has unexpected fields")
    if raw.get("schema_version") != PUBLIC_COHORT_PLAN_SCHEMA_VERSION:
        raise PublicCohortPlanError("unsupported public cohort plan schema")
    agent = _text(raw.get("agent"), label="agent")
    if agent != "openrouter":
        raise PublicCohortPlanError("public cohort plans currently require agent=openrouter")
    conditions = _strings(raw.get("conditions"), label="conditions")
    if not set(conditions) <= SUPPORTED_PUBLIC_CONDITIONS:
        raise PublicCohortPlanError("public cohort plan declares an unsupported condition")
    if "no-memory" not in conditions or MEMORIX_CANONICAL_PROVIDER_ID not in conditions:
        raise PublicCohortPlanError("public cohort plan requires no-memory and Memorix canonical")
    primary_treatment = _text(raw.get("primary_treatment"), label="primary_treatment")
    primary_control = _text(raw.get("primary_control"), label="primary_control")
    if primary_treatment != MEMORIX_CANONICAL_PROVIDER_ID or primary_control != "no-memory":
        raise PublicCohortPlanError("public cohort primary contrast must be Memorix canonical versus no-memory")
    if primary_treatment not in conditions or primary_control not in conditions:
        raise PublicCohortPlanError("public cohort primary contrast is not in conditions")
    return PublicCohortPlan(
        schema_version=PUBLIC_COHORT_PLAN_SCHEMA_VERSION,
        plan_id=_text(raw.get("plan_id"), label="plan_id"),
        registry_id=_text(raw.get("registry_id"), label="registry_id"),
        registry_sha256=_sha256(raw.get("registry_sha256"), label="registry_sha256"),
        agent=agent,
        model=_text(raw.get("model"), label="model"),
        case_ids=_strings(raw.get("case_ids"), label="case_ids"),
        conditions=conditions,
        repetitions=_repetitions(raw.get("repetitions")),
        timeout_seconds=_positive_int(raw.get("timeout_seconds"), label="timeout_seconds"),
        max_budget_usd=_positive_float(raw.get("max_budget_usd"), label="max_budget_usd"),
        primary_treatment=primary_treatment,
        primary_control=primary_control,
        source_path=source,
    )


def validate_public_cohort_plan(
    plan: PublicCohortPlan,
    *,
    registry: CaseRegistry,
    cases_root: str | Path,
) -> None:
    validation = validate_case_registry(registry, cases_root=cases_root)
    if plan.registry_id != validation.registry_id:
        raise PublicCohortPlanError("public cohort plan registry id does not match")
    if plan.registry_sha256 != validation.registry_sha256:
        raise PublicCohortPlanError("public cohort plan registry hash does not match")
    public_case_ids = tuple(sorted(
        entry.case_id for entry in registry.entries
        if entry.enrollment == "public-reproducible"
    ))
    if tuple(sorted(plan.case_ids)) != public_case_ids:
        raise PublicCohortPlanError("public cohort plan case ids do not match frozen registry")


def _result_rows(root: Path) -> tuple[dict[str, Any], ...]:
    if not root.is_dir():
        raise PublicCohortPlanError("public cohort results root is unavailable")
    rows: list[dict[str, Any]] = []
    for path in sorted(root.rglob("result.json")):
        try:
            raw = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as error:
            raise PublicCohortPlanError("public cohort result cannot be read") from error
        if not isinstance(raw, dict):
            raise PublicCohortPlanError("public cohort result must be an object")
        rows.append(raw)
    return tuple(rows)


def validate_public_cohort_results(
    plan: PublicCohortPlan,
    *,
    results_root: str | Path,
) -> PublicCohortValidation:
    rows = _result_rows(Path(results_root).resolve())
    expected = set(plan.expected_keys)
    observed: set[tuple[str, str, int, int]] = set()
    valid_rows = 0
    task_success_rows = 0
    tool_policy_hashes: set[str] = set()
    memorix_cli_hashes: set[str] = set()
    case_definition_hashes: dict[str, set[str]] = {}
    oracle_definition_hashes: dict[str, set[str]] = {}
    for row in rows:
        try:
            key = (
                _text(row.get("case_id"), label="result.case_id"),
                _text(row.get("condition"), label="result.condition"),
                _positive_int(row.get("repetition"), label="result.repetition"),
                row.get("seed"),
            )
        except PublicCohortPlanError as error:
            raise PublicCohortPlanError("public cohort result key is invalid") from error
        if isinstance(key[3], bool) or not isinstance(key[3], int):
            raise PublicCohortPlanError("public cohort result seed is invalid")
        if key in observed:
            raise PublicCohortPlanError("public cohort results contain a duplicate planned row")
        observed.add(key)
        if key not in expected:
            raise PublicCohortPlanError("public cohort results contain an unplanned row")
        if row.get("evidence_tier") != "public-reproducible":
            raise PublicCohortPlanError("public cohort result has the wrong evidence tier")
        if row.get("study_id") != plan.plan_id:
            raise PublicCohortPlanError("public cohort result study id does not match")
        if row.get("case_registry_id") != plan.registry_id:
            raise PublicCohortPlanError("public cohort result registry id does not match")
        if row.get("case_registry_sha256") != plan.registry_sha256:
            raise PublicCohortPlanError("public cohort result registry hash does not match")
        if row.get("agent") != plan.agent or row.get("model") != plan.model:
            raise PublicCohortPlanError("public cohort result agent or model does not match")
        reported_models = row.get("reported_models")
        if reported_models != [plan.model] or row.get("model_profile") != "single":
            raise PublicCohortPlanError("public cohort result does not bind one exact model")
        tool_policy_hashes.add(_sha256(
            row.get("full_tool_policy_sha256"),
            label="result.full_tool_policy_sha256",
        ))
        if key[1] == MEMORIX_CANONICAL_PROVIDER_ID:
            memorix_cli_hashes.add(_sha256(
                row.get("memorix_cli_sha256"),
                label="result.memorix_cli_sha256",
            ))
        case_definition_hashes.setdefault(key[0], set()).add(_sha256(
            row.get("case_definition_sha256"),
            label="result.case_definition_sha256",
        ))
        oracle_definition_hashes.setdefault(key[0], set()).add(_sha256(
            row.get("oracle_definition_sha256"),
            label="result.oracle_definition_sha256",
        ))
        if row.get("valid_run") is True:
            valid_rows += 1
        if row.get("task_success") is True:
            task_success_rows += 1
    if observed != expected:
        missing = sorted(expected - observed)
        raise PublicCohortPlanError(f"public cohort results are incomplete: missing={len(missing)}")
    if len(tool_policy_hashes) != 1:
        raise PublicCohortPlanError("public cohort results use multiple tool policies")
    if len(memorix_cli_hashes) != 1:
        raise PublicCohortPlanError("public cohort results use multiple Memorix CLI builds")
    if any(len(hashes) != 1 for hashes in case_definition_hashes.values()):
        raise PublicCohortPlanError("public cohort results change a case definition across conditions")
    if any(len(hashes) != 1 for hashes in oracle_definition_hashes.values()):
        raise PublicCohortPlanError("public cohort results change an oracle definition across conditions")
    return PublicCohortValidation(
        plan_id=plan.plan_id,
        registry_id=plan.registry_id,
        registry_sha256=plan.registry_sha256,
        expected_rows=len(expected),
        observed_rows=len(rows),
        valid_rows=valid_rows,
        invalid_rows=len(rows) - valid_rows,
        task_success_rows=task_success_rows,
        full_tool_policy_sha256=next(iter(tool_policy_hashes)),
        memorix_cli_sha256=next(iter(memorix_cli_hashes)),
    )
