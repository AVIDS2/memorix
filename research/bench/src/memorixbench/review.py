from __future__ import annotations

from dataclasses import dataclass
from datetime import date
import json
from pathlib import Path
import re
from typing import Any
from collections import Counter

from .admission import PACKET_SCHEMA
from .models import CASE_CLASSES, SHA256_PATTERN, sha256_file


REVIEW_SCHEMA = "memorixbench-outcome-blind-review-v1"
REVIEW_AUDIT_SCHEMA = "memorixbench-outcome-blind-admission-audit-v1"
_REVIEWER_CODE_PATTERN = re.compile(r"^[A-Za-z][A-Za-z0-9_-]{0,31}$")
_SOURCE_ASSESSMENTS = frozenset(
    {
        "source-sufficient",
        "predecessor-material",
        "stale-record-recoverable",
        "unclear",
    }
)
_PATCH_LEAK_LEVELS = frozenset({"none", "possible", "clear"})
_DECISIONS = frozenset({"admit", "revise", "reject"})
_FORBIDDEN_REVIEW_KEYS = frozenset(
    {
        "oracle",
        "oracle_path",
        "reference_repair",
        "reference_patch",
        "model_output",
        "receipt",
        "receipt_path",
        "response_id",
        "provider_response",
        "outcome",
    }
)
_ATTESTATION = "I reviewed this packet without seeing model outcomes or private oracle material."
_REVIEW_FIELDS = frozenset(
    {
        "schema_version",
        "reviewer_code",
        "reviewer_is_owner",
        "outcomes_seen",
        "reviewed_on",
        "packet_sha256",
        "case_id",
        "proposed_class",
        "reviewer_selected_class",
        "current_source_assessment",
        "patch_answer_leak",
        "provenance_and_scope_adequate",
        "decision",
        "rationale",
        "attestation",
    }
)


def _artifact_path(value: str | Path) -> Path:
    path = Path(value).resolve()
    repository_root = Path(__file__).resolve().parents[4]
    allowed = (repository_root / "research" / "artifacts").resolve()
    if path != allowed and allowed not in path.parents:
        raise ValueError("review forms must stay below research/artifacts in the repository")
    return path


def _reject_forbidden_keys(value: object) -> None:
    if isinstance(value, dict):
        for key, child in value.items():
            if str(key).strip().lower() in _FORBIDDEN_REVIEW_KEYS:
                raise ValueError("review form must not contain oracle, repair, receipt, or model-output fields")
            _reject_forbidden_keys(child)
    elif isinstance(value, list):
        for child in value:
            _reject_forbidden_keys(child)


def _packet(path: str | Path) -> tuple[Path, dict[str, Any]]:
    packet_path = Path(path).resolve()
    data: dict[str, Any] = json.loads(packet_path.read_text(encoding="utf-8"))
    if data.get("schema") != PACKET_SCHEMA:
        raise ValueError("review packet has an unsupported schema")
    candidate = data.get("candidate")
    if not isinstance(candidate, dict):
        raise ValueError("review packet candidate is missing")
    case_id = str(candidate.get("id", "")).strip()
    proposed_class = str(candidate.get("proposed_class", "")).strip()
    if not case_id or proposed_class not in CASE_CLASSES:
        raise ValueError("review packet candidate is incomplete")
    return packet_path, data


def _reviewer_code(value: object) -> str:
    code = str(value or "").strip()
    if not _REVIEWER_CODE_PATTERN.fullmatch(code):
        raise ValueError("reviewer_code must be a non-identifying 1-32 character code")
    return code


def write_review_form(
    *,
    packet_path: str | Path,
    reviewer_code: str,
    output_path: str | Path,
) -> Path:
    packet_file, packet_data = _packet(packet_path)
    output = _artifact_path(output_path)
    candidate = packet_data["candidate"]
    payload = {
        "schema_version": REVIEW_SCHEMA,
        "reviewer_code": _reviewer_code(reviewer_code),
        "reviewer_is_owner": False,
        "outcomes_seen": False,
        "reviewed_on": None,
        "packet_sha256": sha256_file(packet_file),
        "case_id": candidate["id"],
        "proposed_class": candidate["proposed_class"],
        "reviewer_selected_class": None,
        "current_source_assessment": None,
        "patch_answer_leak": None,
        "provenance_and_scope_adequate": None,
        "decision": None,
        "rationale": None,
        "attestation": _ATTESTATION,
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(payload, indent=2, ensure_ascii=True) + "\n", encoding="utf-8")
    return output


@dataclass(frozen=True)
class ReviewForm:
    reviewer_code: str
    case_id: str
    proposed_class: str
    reviewer_selected_class: str
    decision: str
    definition_sha256: str

    @classmethod
    def load(cls, path: str | Path, *, packet_path: str | Path) -> "ReviewForm":
        form_path = _artifact_path(path)
        packet_file, packet_data = _packet(packet_path)
        data: dict[str, Any] = json.loads(form_path.read_text(encoding="utf-8"))
        if set(data) != _REVIEW_FIELDS:
            unknown = sorted(set(data) - _REVIEW_FIELDS)
            missing = sorted(_REVIEW_FIELDS - set(data))
            detail = ", ".join([*unknown, *missing])
            raise ValueError(f"review form fields do not match the frozen schema: {detail}")
        _reject_forbidden_keys(data)
        if data.get("schema_version") != REVIEW_SCHEMA:
            raise ValueError("review form has an unsupported schema")
        reviewer_code = _reviewer_code(data.get("reviewer_code"))
        if data.get("reviewer_is_owner") is not False:
            raise ValueError("reviewer_is_owner must be false")
        if data.get("outcomes_seen") is not False:
            raise ValueError("outcomes_seen must be false")
        reviewed_on = str(data.get("reviewed_on", "")).strip()
        try:
            date.fromisoformat(reviewed_on)
        except ValueError as error:
            raise ValueError("reviewed_on must be an ISO date") from error
        packet_sha256 = str(data.get("packet_sha256", "")).strip().lower()
        if not SHA256_PATTERN.fullmatch(packet_sha256) or packet_sha256 != sha256_file(packet_file):
            raise ValueError("packet_sha256 must match the reviewed packet")
        candidate = packet_data["candidate"]
        case_id = str(data.get("case_id", "")).strip()
        proposed_class = str(data.get("proposed_class", "")).strip()
        if case_id != candidate["id"] or proposed_class != candidate["proposed_class"]:
            raise ValueError("review form case metadata must match the packet")
        selected_class = str(data.get("reviewer_selected_class", "")).strip()
        if selected_class not in CASE_CLASSES:
            raise ValueError("reviewer_selected_class must be a supported case class")
        assessment = str(data.get("current_source_assessment", "")).strip()
        if assessment not in _SOURCE_ASSESSMENTS:
            raise ValueError("current_source_assessment is invalid")
        patch_leak = str(data.get("patch_answer_leak", "")).strip()
        if patch_leak not in _PATCH_LEAK_LEVELS:
            raise ValueError("patch_answer_leak is invalid")
        if not isinstance(data.get("provenance_and_scope_adequate"), bool):
            raise ValueError("provenance_and_scope_adequate must be boolean")
        decision = str(data.get("decision", "")).strip()
        if decision not in _DECISIONS:
            raise ValueError("decision must be admit, revise, or reject")
        rationale = str(data.get("rationale", "")).strip()
        if len(rationale) < 30 or len(rationale) > 600:
            raise ValueError("rationale must be between 30 and 600 characters")
        if data.get("attestation") != _ATTESTATION:
            raise ValueError("review form attestation is invalid")
        return cls(
            reviewer_code=reviewer_code,
            case_id=case_id,
            proposed_class=proposed_class,
            reviewer_selected_class=selected_class,
            decision=decision,
            definition_sha256=sha256_file(form_path),
        )


def _audit_reviewer_codes(values: list[str] | tuple[str, ...]) -> tuple[str, ...]:
    reviewers = tuple(_reviewer_code(value) for value in values)
    if len(reviewers) not in {2, 3} or len(set(reviewers)) != len(reviewers):
        raise ValueError("review audit requires two or three distinct reviewer codes")
    return reviewers


def _review_signature(data: dict[str, Any]) -> tuple[str, str, str, str, bool]:
    return (
        str(data["decision"]),
        str(data["reviewer_selected_class"]),
        str(data["current_source_assessment"]),
        str(data["patch_answer_leak"]),
        bool(data["provenance_and_scope_adequate"]),
    )


def write_review_audit(
    *,
    packet_dir: str | Path,
    review_root: str | Path,
    reviewer_codes: list[str] | tuple[str, ...],
    output_path: str | Path,
) -> Path:
    """Validate a completed review set and write a sanitized admission ledger."""
    reviewers = _audit_reviewer_codes(reviewer_codes)
    packets_root = _artifact_path(packet_dir)
    forms_root = _artifact_path(review_root)
    output = _artifact_path(output_path)
    packets = sorted(packets_root.glob("*.json"))
    if not packets:
        raise ValueError("review audit requires at least one generated review packet")

    cases: list[dict[str, object]] = []
    for packet in packets:
        packet_file, packet_data = _packet(packet)
        candidate = packet_data["candidate"]
        reviews: list[dict[str, object]] = []
        signatures: list[tuple[str, str, str, str, bool]] = []
        for reviewer_code in reviewers:
            form_path = forms_root / reviewer_code / packet.name
            review = ReviewForm.load(form_path, packet_path=packet_file)
            if review.reviewer_code != reviewer_code:
                raise ValueError(f"reviewer code does not match form location for {packet.name}")
            form_data: dict[str, Any] = json.loads(form_path.read_text(encoding="utf-8"))
            signature = _review_signature(form_data)
            signatures.append(signature)
            reviews.append(
                {
                    "reviewer_code": reviewer_code,
                    "decision": signature[0],
                    "reviewer_selected_class": signature[1],
                    "current_source_assessment": signature[2],
                    "patch_answer_leak": signature[3],
                    "provenance_and_scope_adequate": signature[4],
                    "form_sha256": review.definition_sha256,
                }
            )

        signature, count = Counter(signatures).most_common(1)[0]
        needed = 2 if len(reviewers) == 3 else len(reviewers)
        if count < needed:
            admission_state = "needs-third-review"
            reason = "reviewer-disagreement"
        elif signature[0] == "admit" and signature[3] == "none" and signature[4]:
            admission_state = "admitted"
            reason = "consensus-admit"
        else:
            admission_state = "not-admitted"
            reason = "consensus-not-admit"
        cases.append(
            {
                "case_id": candidate["id"],
                "proposed_class": candidate["proposed_class"],
                "packet_sha256": sha256_file(packet_file),
                "admission_state": admission_state,
                "reason": reason,
                "reviews": reviews,
            }
        )

    payload = {
        "schema_version": REVIEW_AUDIT_SCHEMA,
        "reviewer_codes": list(reviewers),
        "packet_count": len(cases),
        "all_cases_admitted": all(case["admission_state"] == "admitted" for case in cases),
        "cases": cases,
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(payload, indent=2, ensure_ascii=True) + "\n", encoding="utf-8")
    return output
