from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import datetime
import hashlib
import hmac
import json
from pathlib import Path
import re
from typing import Iterable, Literal

from .actions import AgentAction, load_action_ledger


ANNOTATION_SCHEMA_VERSION = "0.1"
JUDGE_KIND = "human"
FIRST_ACTION_STATUSES = {"observed", "none-observed", "unrateable"}
COUNT_STATUSES = {"rated", "unrateable"}
MEMORY_MARKER = re.compile(
    r"(?i)memorix|agentmemory|\bmem0\b|mcp(?:__|\b)|anthropic|openai|claude|codex"
)
ABSOLUTE_PATH_MARKER = re.compile(r"(?i)(?:[a-z]:[\\/]|/Users/|/home/|\\\\)[^\s\"'`;&|<>]*")
SECRET_MARKER = re.compile(
    r"(?i)(?:api[_-]?key|auth[_-]?token|password|secret)\s*[:=]\s*\S+"
)
MAX_ACTION_SUMMARY_CHARS = 600


class AnnotationError(ValueError):
    """Raised when a blinded human-annotation artifact is invalid."""


@dataclass(frozen=True)
class BlindAction:
    action_id: str
    action_index: int
    elapsed_seconds: float
    kind: str
    operation_summary: str
    successful: bool | None


@dataclass(frozen=True)
class SanitizedActionLedger:
    schema_version: str
    source_action_ledger_sha256: str
    actions: tuple[BlindAction, ...]

    @property
    def sha256(self) -> str:
        return _sha256_payload(asdict(self))


@dataclass(frozen=True)
class BlindAnnotationPacket:
    schema_version: str
    blind_run_id: str
    result_sha256: str
    action_ledger_sha256: str
    task: str
    rubric: str
    actions: tuple[BlindAction, ...]

    @property
    def sha256(self) -> str:
        return _sha256_payload(asdict(self))


@dataclass(frozen=True)
class AnnotationSubmission:
    schema_version: str
    packet_sha256: str
    rater_id: str
    judge_kind: str
    submitted_at: str
    first_correct_action_status: str
    first_correct_action_id: str | None
    stale_memory_error_status: str
    stale_episode_start_action_ids: tuple[str, ...]
    negative_control_intrusion_status: str
    negative_intrusion_start_action_ids: tuple[str, ...]

    def decision_payload(self) -> dict[str, object]:
        return {
            "first_correct_action_status": self.first_correct_action_status,
            "first_correct_action_id": self.first_correct_action_id,
            "stale_memory_error_status": self.stale_memory_error_status,
            "stale_episode_start_action_ids": list(self.stale_episode_start_action_ids),
            "negative_control_intrusion_status": self.negative_control_intrusion_status,
            "negative_intrusion_start_action_ids": list(self.negative_intrusion_start_action_ids),
        }


@dataclass(frozen=True)
class FinalAnnotation:
    schema_version: str
    result_sha256: str
    packet_sha256: str
    action_ledger_sha256: str
    status: str
    first_correct_action_id: str | None
    first_correct_action_seconds: float | None
    first_correct_action_status: str
    stale_memory_errors: int | None
    stale_memory_error_status: str
    negative_control_intrusions: int | None
    negative_control_intrusion_status: str
    labels_commitment_sha256: str

    @property
    def sha256(self) -> str:
        return _sha256_payload(asdict(self))


def _sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def _sha256_payload(value: object) -> str:
    return _sha256_bytes(
        json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    )


def _file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _load_json_object(path: Path, *, kind: str) -> dict[str, object]:
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise AnnotationError(f"{kind} cannot be read") from error
    if not isinstance(raw, dict):
        raise AnnotationError(f"{kind} must be an object")
    return raw


def _blind_id(salt: str, value: str) -> str:
    if not salt:
        raise AnnotationError("blind packet salt must be non-empty")
    return hmac.new(salt.encode("utf-8"), value.encode("utf-8"), hashlib.sha256).hexdigest()[:24]


def _operation_summary(action: AgentAction) -> str:
    detail = action.detail or ""
    if MEMORY_MARKER.search(action.tool_name or "") or MEMORY_MARKER.search(detail):
        return "[redacted memory operation]"
    if action.kind == "command":
        if not detail:
            return "source command"
        return SECRET_MARKER.sub("<redacted-secret>", ABSOLUTE_PATH_MARKER.sub("<path>", detail))[
            :MAX_ACTION_SUMMARY_CHARS
        ]
    if action.kind == "edit":
        if detail:
            try:
                payload = json.loads(detail)
            except json.JSONDecodeError:
                payload = None
            if isinstance(payload, dict):
                path = payload.get("file_path") or payload.get("path")
                if isinstance(path, str) and path.strip():
                    return f"source edit: {path.strip()}"
        return "source edit"
    if action.kind == "read":
        return "source inspection"
    if action.kind == "tool_call":
        return "tool invocation"
    return "agent action"


def build_sanitized_action_ledger(
    action_ledger_path: str | Path,
) -> SanitizedActionLedger:
    ledger = load_action_ledger(action_ledger_path)
    return SanitizedActionLedger(
        schema_version=ANNOTATION_SCHEMA_VERSION,
        source_action_ledger_sha256=ledger.sha256,
        actions=tuple(
            BlindAction(
                action_id=action.action_id,
                action_index=index,
                elapsed_seconds=action.elapsed_seconds,
                kind=action.kind,
                operation_summary=_operation_summary(action),
                successful=action.successful,
            )
            for index, action in enumerate(ledger.actions, 1)
        ),
    )


def write_sanitized_action_ledger(
    action_ledger_path: str | Path,
    path: str | Path,
) -> SanitizedActionLedger:
    ledger = build_sanitized_action_ledger(action_ledger_path)
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps({
        **asdict(ledger),
        "sanitized_ledger_sha256": ledger.sha256,
    }, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return ledger


def load_sanitized_action_ledger(path: str | Path) -> SanitizedActionLedger:
    raw = _load_json_object(Path(path), kind="sanitized action ledger")
    expected = {
        "schema_version",
        "source_action_ledger_sha256",
        "actions",
        "sanitized_ledger_sha256",
    }
    if set(raw) != expected:
        raise AnnotationError("sanitized action ledger has unexpected fields")
    if raw.get("schema_version") != ANNOTATION_SCHEMA_VERSION:
        raise AnnotationError("unsupported sanitized action ledger schema")
    source_hash = raw.get("source_action_ledger_sha256")
    if not isinstance(source_hash, str) or len(source_hash) != 64:
        raise AnnotationError("sanitized action ledger has invalid source hash")
    raw_actions = raw.get("actions")
    if not isinstance(raw_actions, list):
        raise AnnotationError("sanitized action ledger actions must be an array")
    actions: list[BlindAction] = []
    for index, value in enumerate(raw_actions, 1):
        if not isinstance(value, dict):
            raise AnnotationError("sanitized action ledger action must be an object")
        if value.get("action_id") != f"a{index:04d}" or value.get("action_index") != index:
            raise AnnotationError("sanitized action ledger actions must be ordered")
        elapsed = value.get("elapsed_seconds")
        summary = value.get("operation_summary")
        successful = value.get("successful")
        if isinstance(elapsed, bool) or not isinstance(elapsed, (int, float)) or elapsed < 0:
            raise AnnotationError("sanitized action ledger action has invalid elapsed time")
        if value.get("kind") not in {"command", "edit", "read", "tool_call", "other"}:
            raise AnnotationError("sanitized action ledger action has invalid kind")
        if not isinstance(summary, str) or not summary:
            raise AnnotationError("sanitized action ledger action has invalid summary")
        if successful is not None and not isinstance(successful, bool):
            raise AnnotationError("sanitized action ledger action has invalid success state")
        actions.append(BlindAction(
            action_id=f"a{index:04d}",
            action_index=index,
            elapsed_seconds=float(elapsed),
            kind=value["kind"],
            operation_summary=summary,
            successful=successful,
        ))
    ledger = SanitizedActionLedger(
        schema_version=ANNOTATION_SCHEMA_VERSION,
        source_action_ledger_sha256=source_hash,
        actions=tuple(actions),
    )
    if raw.get("sanitized_ledger_sha256") != ledger.sha256:
        raise AnnotationError("sanitized action ledger commitment does not match")
    return ledger


def _assert_safe_packet_text(value: str, forbidden_values: Iterable[str]) -> None:
    for forbidden in forbidden_values:
        if forbidden and forbidden.casefold() in value.casefold():
            raise AnnotationError("blind packet would reveal a forbidden run identifier")


def build_blind_packet(
    *,
    result_path: str | Path,
    sanitized_action_ledger_path: str | Path,
    task: str,
    rubric: str,
    blind_salt: str,
    forbidden_strings: Iterable[str] = (),
) -> BlindAnnotationPacket:
    result_source = Path(result_path)
    result = _load_json_object(result_source, kind="trial result")
    ledger = load_sanitized_action_ledger(sanitized_action_ledger_path)
    result_ledger_sha = result.get("agent_action_ledger_sha256")
    if result_ledger_sha != ledger.source_action_ledger_sha256:
        raise AnnotationError("trial result does not commit to the supplied action ledger")
    run_id = result.get("run_id")
    if not isinstance(run_id, str) or not run_id:
        raise AnnotationError("trial result has no run id")
    if not task.strip() or not rubric.strip():
        raise AnnotationError("blind packet task and rubric must be non-empty")
    actions = ledger.actions
    packet = BlindAnnotationPacket(
        schema_version=ANNOTATION_SCHEMA_VERSION,
        blind_run_id=_blind_id(blind_salt, run_id),
        result_sha256=_file_sha256(result_source),
        action_ledger_sha256=ledger.source_action_ledger_sha256,
        task=task.strip(),
        rubric=rubric.strip(),
        actions=actions,
    )
    forbidden = tuple(str(value) for value in forbidden_strings if str(value)) + tuple(
        str(result.get(key) or "")
        for key in ("condition", "model", "agent", "memory_provider")
    )
    serialized = json.dumps(asdict(packet), ensure_ascii=False)
    _assert_safe_packet_text(serialized, forbidden)
    return packet


def write_blind_packet(packet: BlindAnnotationPacket, path: str | Path) -> Path:
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps({
        **asdict(packet),
        "packet_sha256": packet.sha256,
    }, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return target


def load_blind_packet(path: str | Path) -> BlindAnnotationPacket:
    raw = _load_json_object(Path(path), kind="blind annotation packet")
    expected = {
        "schema_version",
        "blind_run_id",
        "result_sha256",
        "action_ledger_sha256",
        "task",
        "rubric",
        "actions",
        "packet_sha256",
    }
    if set(raw) != expected:
        raise AnnotationError("blind annotation packet has unexpected fields")
    if raw.get("schema_version") != ANNOTATION_SCHEMA_VERSION:
        raise AnnotationError("unsupported blind annotation packet schema")
    strings = ("blind_run_id", "result_sha256", "action_ledger_sha256", "task", "rubric")
    if any(not isinstance(raw.get(key), str) or not str(raw[key]).strip() for key in strings):
        raise AnnotationError("blind annotation packet has an invalid required field")
    raw_actions = raw.get("actions")
    if not isinstance(raw_actions, list):
        raise AnnotationError("blind annotation packet actions must be an array")
    actions: list[BlindAction] = []
    for index, value in enumerate(raw_actions, 1):
        if not isinstance(value, dict):
            raise AnnotationError("blind annotation packet action must be an object")
        if value.get("action_index") != index or value.get("action_id") != f"a{index:04d}":
            raise AnnotationError("blind annotation packet actions must be ordered")
        elapsed = value.get("elapsed_seconds")
        if isinstance(elapsed, bool) or not isinstance(elapsed, (int, float)) or elapsed < 0:
            raise AnnotationError("blind annotation packet action has invalid elapsed time")
        if value.get("kind") not in {"command", "edit", "read", "tool_call", "other"}:
            raise AnnotationError("blind annotation packet action has invalid kind")
        summary = value.get("operation_summary")
        successful = value.get("successful")
        if not isinstance(summary, str) or not summary:
            raise AnnotationError("blind annotation packet action has invalid summary")
        if successful is not None and not isinstance(successful, bool):
            raise AnnotationError("blind annotation packet action has invalid success state")
        actions.append(BlindAction(
            action_id=f"a{index:04d}",
            action_index=index,
            elapsed_seconds=float(elapsed),
            kind=value["kind"],
            operation_summary=summary,
            successful=successful,
        ))
    packet = BlindAnnotationPacket(
        schema_version=ANNOTATION_SCHEMA_VERSION,
        blind_run_id=str(raw["blind_run_id"]),
        result_sha256=str(raw["result_sha256"]),
        action_ledger_sha256=str(raw["action_ledger_sha256"]),
        task=str(raw["task"]),
        rubric=str(raw["rubric"]),
        actions=tuple(actions),
    )
    if raw.get("packet_sha256") != packet.sha256:
        raise AnnotationError("blind annotation packet commitment does not match")
    return packet


def _clean_action_ids(values: Iterable[str], packet: BlindAnnotationPacket) -> tuple[str, ...]:
    known = {action.action_id for action in packet.actions}
    ids = tuple(values)
    if any(value not in known for value in ids):
        raise AnnotationError("annotation references an unknown action")
    if len(set(ids)) != len(ids):
        raise AnnotationError("annotation action ids must not repeat")
    expected_order = {action.action_id: action.action_index for action in packet.actions}
    if tuple(sorted(ids, key=expected_order.__getitem__)) != ids:
        raise AnnotationError("annotation action ids must use observed order")
    return ids


def validate_submission(
    packet: BlindAnnotationPacket,
    submission: AnnotationSubmission,
) -> AnnotationSubmission:
    if submission.schema_version != ANNOTATION_SCHEMA_VERSION:
        raise AnnotationError("unsupported annotation submission schema")
    if submission.packet_sha256 != packet.sha256:
        raise AnnotationError("annotation submission is bound to a different packet")
    if submission.judge_kind != JUDGE_KIND:
        raise AnnotationError("annotation submissions must be human judgments")
    if not re.fullmatch(r"[a-z0-9][a-z0-9_.-]{1,63}", submission.rater_id):
        raise AnnotationError("annotation rater id must be a pseudonym")
    try:
        datetime.fromisoformat(submission.submitted_at.replace("Z", "+00:00"))
    except ValueError as error:
        raise AnnotationError("annotation submission timestamp is invalid") from error
    if submission.first_correct_action_status not in FIRST_ACTION_STATUSES:
        raise AnnotationError("annotation first-correct-action status is invalid")
    known = {action.action_id for action in packet.actions}
    if submission.first_correct_action_status == "observed":
        if submission.first_correct_action_id not in known:
            raise AnnotationError("observed first-correct-action needs a known action id")
    elif submission.first_correct_action_id is not None:
        raise AnnotationError("non-observed first-correct-action must not name an action")
    if submission.stale_memory_error_status not in COUNT_STATUSES:
        raise AnnotationError("annotation stale-memory status is invalid")
    if submission.negative_control_intrusion_status not in COUNT_STATUSES:
        raise AnnotationError("annotation negative-control status is invalid")
    stale_ids = _clean_action_ids(submission.stale_episode_start_action_ids, packet)
    negative_ids = _clean_action_ids(submission.negative_intrusion_start_action_ids, packet)
    if submission.stale_memory_error_status == "unrateable" and stale_ids:
        raise AnnotationError("unrateable stale-memory judgment must not name episodes")
    if submission.negative_control_intrusion_status == "unrateable" and negative_ids:
        raise AnnotationError("unrateable negative-control judgment must not name episodes")
    return submission


def write_submission(submission: AnnotationSubmission, path: str | Path) -> Path:
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(asdict(submission), indent=2) + "\n", encoding="utf-8")
    return target


def load_submission(path: str | Path) -> AnnotationSubmission:
    raw = _load_json_object(Path(path), kind="annotation submission")
    expected = {
        "schema_version",
        "packet_sha256",
        "rater_id",
        "judge_kind",
        "submitted_at",
        "first_correct_action_status",
        "first_correct_action_id",
        "stale_memory_error_status",
        "stale_episode_start_action_ids",
        "negative_control_intrusion_status",
        "negative_intrusion_start_action_ids",
    }
    if set(raw) != expected:
        raise AnnotationError("annotation submission has unexpected fields")
    for field in ("stale_episode_start_action_ids", "negative_intrusion_start_action_ids"):
        if not isinstance(raw.get(field), list) or any(not isinstance(value, str) for value in raw[field]):
            raise AnnotationError("annotation submission action ids are invalid")
    first = raw.get("first_correct_action_id")
    if first is not None and not isinstance(first, str):
        raise AnnotationError("annotation submission first action is invalid")
    return AnnotationSubmission(
        schema_version=str(raw["schema_version"]),
        packet_sha256=str(raw["packet_sha256"]),
        rater_id=str(raw["rater_id"]),
        judge_kind=str(raw["judge_kind"]),
        submitted_at=str(raw["submitted_at"]),
        first_correct_action_status=str(raw["first_correct_action_status"]),
        first_correct_action_id=first,
        stale_memory_error_status=str(raw["stale_memory_error_status"]),
        stale_episode_start_action_ids=tuple(raw["stale_episode_start_action_ids"]),
        negative_control_intrusion_status=str(raw["negative_control_intrusion_status"]),
        negative_intrusion_start_action_ids=tuple(raw["negative_intrusion_start_action_ids"]),
    )


def _decisions_match(first: AnnotationSubmission, second: AnnotationSubmission) -> bool:
    return first.decision_payload() == second.decision_payload()


def _final_action_status(submission: AnnotationSubmission) -> tuple[str, str | None]:
    if submission.first_correct_action_status == "observed":
        return "annotated-v1", submission.first_correct_action_id
    if submission.first_correct_action_status == "none-observed":
        return "no-correct-action-v1", None
    return "unrateable-v1", None


def _count_status(status: str, action_ids: tuple[str, ...]) -> tuple[str, int | None]:
    return ("annotated-v1", len(action_ids)) if status == "rated" else ("unrateable-v1", None)


def finalize_annotations(
    packet: BlindAnnotationPacket,
    first: AnnotationSubmission,
    second: AnnotationSubmission,
    *,
    adjudication: AnnotationSubmission | None = None,
) -> FinalAnnotation:
    first = validate_submission(packet, first)
    second = validate_submission(packet, second)
    if first.rater_id == second.rater_id:
        raise AnnotationError("two independent raters are required")
    selected: AnnotationSubmission
    status: Literal["consensus-v1", "adjudicated-v1"]
    if _decisions_match(first, second):
        if adjudication is not None:
            raise AnnotationError("matching raters do not require adjudication")
        selected = first
        status = "consensus-v1"
    else:
        if adjudication is None:
            raise AnnotationError("disagreeing raters require a blinded adjudication")
        adjudication = validate_submission(packet, adjudication)
        if adjudication.rater_id in {first.rater_id, second.rater_id}:
            raise AnnotationError("adjudicator must be independent from both raters")
        selected = adjudication
        status = "adjudicated-v1"
    action_times = {action.action_id: action.elapsed_seconds for action in packet.actions}
    first_status, first_id = _final_action_status(selected)
    stale_status, stale_count = _count_status(
        selected.stale_memory_error_status,
        selected.stale_episode_start_action_ids,
    )
    negative_status, negative_count = _count_status(
        selected.negative_control_intrusion_status,
        selected.negative_intrusion_start_action_ids,
    )
    labels_commitment = _sha256_payload({
        "status": status,
        "decision": selected.decision_payload(),
        "first_rater": first.decision_payload(),
        "second_rater": second.decision_payload(),
    })
    return FinalAnnotation(
        schema_version=ANNOTATION_SCHEMA_VERSION,
        result_sha256=packet.result_sha256,
        packet_sha256=packet.sha256,
        action_ledger_sha256=packet.action_ledger_sha256,
        status=status,
        first_correct_action_id=first_id,
        first_correct_action_seconds=action_times[first_id] if first_id else None,
        first_correct_action_status=first_status,
        stale_memory_errors=stale_count,
        stale_memory_error_status=stale_status,
        negative_control_intrusions=negative_count,
        negative_control_intrusion_status=negative_status,
        labels_commitment_sha256=labels_commitment,
    )


def write_final_annotation(annotation: FinalAnnotation, path: str | Path) -> Path:
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps({
        **asdict(annotation),
        "annotation_sha256": annotation.sha256,
    }, indent=2) + "\n", encoding="utf-8")
    return target


def load_final_annotation(path: str | Path) -> FinalAnnotation:
    raw = _load_json_object(Path(path), kind="final annotation")
    expected = {
        "schema_version",
        "result_sha256",
        "packet_sha256",
        "action_ledger_sha256",
        "status",
        "first_correct_action_id",
        "first_correct_action_seconds",
        "first_correct_action_status",
        "stale_memory_errors",
        "stale_memory_error_status",
        "negative_control_intrusions",
        "negative_control_intrusion_status",
        "labels_commitment_sha256",
        "annotation_sha256",
    }
    if set(raw) != expected:
        raise AnnotationError("final annotation has unexpected fields")
    if raw.get("schema_version") != ANNOTATION_SCHEMA_VERSION:
        raise AnnotationError("unsupported final annotation schema")
    if raw.get("status") not in {"consensus-v1", "adjudicated-v1"}:
        raise AnnotationError("final annotation has invalid status")
    first_id = raw.get("first_correct_action_id")
    first_seconds = raw.get("first_correct_action_seconds")
    if first_id is not None and not isinstance(first_id, str):
        raise AnnotationError("final annotation has invalid first action id")
    if first_seconds is not None and (
        isinstance(first_seconds, bool) or not isinstance(first_seconds, (int, float)) or first_seconds < 0
    ):
        raise AnnotationError("final annotation has invalid first action time")
    def count(name: str) -> int | None:
        value = raw.get(name)
        if value is None:
            return None
        if isinstance(value, bool) or not isinstance(value, int) or value < 0:
            raise AnnotationError("final annotation has an invalid count")
        return value
    annotation = FinalAnnotation(
        schema_version=ANNOTATION_SCHEMA_VERSION,
        result_sha256=str(raw["result_sha256"]),
        packet_sha256=str(raw["packet_sha256"]),
        action_ledger_sha256=str(raw["action_ledger_sha256"]),
        status=str(raw["status"]),
        first_correct_action_id=first_id,
        first_correct_action_seconds=None if first_seconds is None else float(first_seconds),
        first_correct_action_status=str(raw["first_correct_action_status"]),
        stale_memory_errors=count("stale_memory_errors"),
        stale_memory_error_status=str(raw["stale_memory_error_status"]),
        negative_control_intrusions=count("negative_control_intrusions"),
        negative_control_intrusion_status=str(raw["negative_control_intrusion_status"]),
        labels_commitment_sha256=str(raw["labels_commitment_sha256"]),
    )
    if raw.get("annotation_sha256") != annotation.sha256:
        raise AnnotationError("final annotation commitment does not match")
    return annotation


def merge_annotation_into_result(
    result_path: str | Path,
    annotation: FinalAnnotation,
) -> dict[str, object]:
    source = Path(result_path)
    result = _load_json_object(source, kind="trial result")
    if _file_sha256(source) != annotation.result_sha256:
        raise AnnotationError("final annotation is bound to a different trial result")
    if result.get("agent_action_ledger_sha256") != annotation.action_ledger_sha256:
        raise AnnotationError("final annotation is bound to a different action ledger")
    merged = dict(result)
    merged.update({
        "first_correct_action_seconds": annotation.first_correct_action_seconds,
        "first_correct_action_status": annotation.first_correct_action_status,
        "stale_memory_errors": annotation.stale_memory_errors,
        "stale_memory_error_status": annotation.stale_memory_error_status,
        "negative_control_intrusions": annotation.negative_control_intrusions,
        "negative_control_intrusion_status": annotation.negative_control_intrusion_status,
        "annotation_status": annotation.status,
        "annotation_summary_sha256": annotation.sha256,
    })
    return merged
