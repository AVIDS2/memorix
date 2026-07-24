from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import stat

from .admission import (
    AdmissionReviewError,
    CaseAdmissionReviewDraft,
    load_admission_review_draft,
)
from .public_safety import PublicSafetyError, reject_public_json_payload, reject_public_text
from .source_ledger import (
    SourceAudit,
    SourceLedger,
    SourceLedgerEntry,
    audit_source_candidate,
    validate_source_ledger,
)


PRE_ADMISSION_AUDIT_SCHEMA_VERSION = "candidate-pre-admission-audit-v1"
AUTOMATED_REVIEW_KIND = "automated-pre-review-only-v1"
PRIVATE_DRAFT_FILENAMES = (
    "ADMISSION-REVIEW-DRAFT.json",
    "PUBLIC-HISTORY-COMPARISON.md",
    "PRIVATE-TASK-BRIEF.md",
    "PRIVATE-TRANSITION.md",
)
PRIVATE_DRAFT_COMMITMENTS = (
    ("PRIVATE-TRANSITION.md", "private_transition_commitment_sha256"),
    ("PRIVATE-TASK-BRIEF.md", "private_task_brief_sha256"),
    ("PUBLIC-HISTORY-COMPARISON.md", "public_history_comparison_sha256"),
)
REMAINING_ADMISSION_GATES = (
    "independent-human-review-required-v1",
    "benchmark-overlap-review-required-v1",
    "public-case-and-private-oracle-authoring-required-v1",
    "independent-precursor-traces-required-v1",
    "isolated-confirmatory-permit-required-v1",
)


class PreAdmissionAuditError(ValueError):
    """Raised when a private design draft fails a mechanical pre-review gate."""


@dataclass(frozen=True)
class PreAdmissionAudit:
    """A hash-only mechanical audit that deliberately cannot admit a case."""

    schema_version: str
    audit_kind: str
    candidate_id: str
    source_ledger_sha256: str
    source_status: str
    environment_readiness: str
    transition_plan: str
    benchmark_overlap: str
    author_id: str
    author_history_access: str
    admission_review_draft_sha256: str
    private_transition_commitment_sha256: str
    private_task_brief_sha256: str
    public_history_comparison_sha256: str
    private_bundle_sha256: str
    source_audit: SourceAudit
    automated_checks: tuple[str, ...]
    admission_decision: str
    remaining_admission_gates: tuple[str, ...]
    audited_at_utc: str

    @property
    def sha256(self) -> str:
        payload = json.dumps(asdict(self), sort_keys=True, separators=(",", ":"))
        return hashlib.sha256(payload.encode("utf-8")).hexdigest()

    def public_payload(self) -> dict[str, object]:
        return {**asdict(self), "pre_admission_audit_sha256": self.sha256}


def _is_reparse_point(metadata: object) -> bool:
    attributes = getattr(metadata, "st_file_attributes", 0)
    flag = getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0x400)
    return bool(attributes & flag)


def _require_regular_directory(path: Path, *, label: str) -> None:
    try:
        metadata = path.lstat()
    except OSError as error:
        raise PreAdmissionAuditError(f"{label} cannot be read") from error
    if path.is_symlink() or _is_reparse_point(metadata) or not stat.S_ISDIR(metadata.st_mode):
        raise PreAdmissionAuditError(f"{label} must be a regular directory")


def _read_regular_utf8(path: Path, *, label: str) -> tuple[str, str]:
    try:
        metadata = path.lstat()
    except OSError as error:
        raise PreAdmissionAuditError(f"{label} cannot be read") from error
    if path.is_symlink() or _is_reparse_point(metadata) or not stat.S_ISREG(metadata.st_mode):
        raise PreAdmissionAuditError(f"{label} must be a regular file")
    try:
        raw = path.read_bytes()
        text = raw.decode("utf-8")
    except (OSError, UnicodeDecodeError) as error:
        raise PreAdmissionAuditError(f"{label} must be readable UTF-8 text") from error
    try:
        reject_public_text(text)
    except PublicSafetyError as error:
        raise PreAdmissionAuditError(f"{label} failed the private-draft safety scan") from error
    return text, hashlib.sha256(raw).hexdigest()


def _find_candidate(ledger: SourceLedger, candidate_id: str) -> SourceLedgerEntry:
    candidate = next(
        (entry for entry in ledger.entries if entry.candidate_id == candidate_id),
        None,
    )
    if candidate is None:
        raise PreAdmissionAuditError(f"unknown source candidate: {candidate_id}")
    return candidate


def _require_draft_binding(
    draft: CaseAdmissionReviewDraft,
    candidate: SourceLedgerEntry,
) -> None:
    observed = (
        draft.candidate_id,
        draft.repository_url.rstrip("/").removesuffix(".git"),
        draft.base_revision,
        draft.public_transition_revision,
    )
    expected = (
        candidate.candidate_id,
        candidate.repository_url.rstrip("/").removesuffix(".git"),
        candidate.base_revision,
        candidate.public_transition_revision,
    )
    if observed != expected:
        raise PreAdmissionAuditError("admission review draft does not bind the source-ledger candidate")
    if draft.author_history_access != "provenance-only-v1":
        raise PreAdmissionAuditError("private draft author history access is not provenance-only")


def _timestamp(value: str | None) -> str:
    if value is None:
        return datetime.now(timezone.utc).isoformat()
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as error:
        raise PreAdmissionAuditError("audited_at_utc is invalid") from error
    if parsed.tzinfo is None:
        raise PreAdmissionAuditError("audited_at_utc must include a timezone")
    return parsed.astimezone(timezone.utc).isoformat()


def _bundle_sha256(file_hashes: dict[str, str]) -> str:
    payload = json.dumps(file_hashes, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def audit_private_draft(
    *,
    ledger: SourceLedger,
    candidate_id: str,
    draft_root: str | Path,
    repository_cache: str | Path,
    audited_at_utc: str | None = None,
) -> PreAdmissionAudit:
    """Mechanically verify a private draft without judging novelty or utility."""

    validate_source_ledger(ledger)
    candidate = _find_candidate(ledger, candidate_id)
    if candidate.status != "screening":
        raise PreAdmissionAuditError("private draft audit requires a screening source candidate")
    if candidate.environment_readiness != "offline-ready":
        raise PreAdmissionAuditError("private draft audit requires an offline-ready candidate")
    if candidate.transition_plan != "private-post-snapshot":
        raise PreAdmissionAuditError("private draft audit requires a private post-snapshot plan")

    _require_regular_directory(Path(repository_cache), label="source repository cache")
    source_audit = audit_source_candidate(
        ledger,
        candidate_id=candidate_id,
        repository_cache=repository_cache,
    )

    root = Path(draft_root)
    _require_regular_directory(root, label="private draft root")
    entries = {entry.name: entry for entry in root.iterdir()}
    if set(entries) != set(PRIVATE_DRAFT_FILENAMES):
        raise PreAdmissionAuditError("private draft root must contain exactly the committed draft files")

    file_hashes: dict[str, str] = {}
    file_text: dict[str, str] = {}
    for filename in PRIVATE_DRAFT_FILENAMES:
        text, digest = _read_regular_utf8(entries[filename], label=filename)
        file_text[filename] = text
        file_hashes[filename] = digest

    try:
        draft_payload = json.loads(file_text["ADMISSION-REVIEW-DRAFT.json"])
        reject_public_json_payload(draft_payload)
        draft = load_admission_review_draft(entries["ADMISSION-REVIEW-DRAFT.json"])
    except (json.JSONDecodeError, AdmissionReviewError, PublicSafetyError) as error:
        raise PreAdmissionAuditError("admission review draft is invalid") from error
    _require_draft_binding(draft, candidate)

    for filename, field in PRIVATE_DRAFT_COMMITMENTS:
        if file_hashes[filename] != getattr(draft, field):
            raise PreAdmissionAuditError(f"{filename} does not match its admission-draft commitment")

    try:
        ledger_sha256 = hashlib.sha256(ledger.source_path.read_bytes()).hexdigest()
    except OSError as error:
        raise PreAdmissionAuditError("source ledger cannot be hashed") from error
    return PreAdmissionAudit(
        schema_version=PRE_ADMISSION_AUDIT_SCHEMA_VERSION,
        audit_kind=AUTOMATED_REVIEW_KIND,
        candidate_id=candidate.candidate_id,
        source_ledger_sha256=ledger_sha256,
        source_status=candidate.status,
        environment_readiness=candidate.environment_readiness,
        transition_plan=candidate.transition_plan,
        benchmark_overlap=candidate.benchmark_overlap,
        author_id=draft.author_id,
        author_history_access=draft.author_history_access,
        admission_review_draft_sha256=draft.sha256,
        private_transition_commitment_sha256=draft.private_transition_commitment_sha256,
        private_task_brief_sha256=draft.private_task_brief_sha256,
        public_history_comparison_sha256=draft.public_history_comparison_sha256,
        private_bundle_sha256=_bundle_sha256(file_hashes),
        source_audit=source_audit,
        automated_checks=(
            "source-ledger-and-offline-preflight-valid-v1",
            "source-cache-origin-parent-license-valid-v1",
            "private-draft-boundary-valid-v1",
            "private-draft-hash-commitments-valid-v1",
            "private-draft-safety-scan-valid-v1",
        ),
        admission_decision="not-issued",
        remaining_admission_gates=REMAINING_ADMISSION_GATES,
        audited_at_utc=_timestamp(audited_at_utc),
    )


def write_pre_admission_audit(
    audit: PreAdmissionAudit,
    *,
    output: str | Path,
) -> Path:
    """Write a hash-only receipt once; the output is safe to share for review."""

    target = Path(output)
    if target.exists():
        raise PreAdmissionAuditError("pre-admission audit output already exists")
    payload = json.loads(json.dumps(audit.public_payload()))
    try:
        reject_public_json_payload(payload)
    except PublicSafetyError as error:
        raise PreAdmissionAuditError("pre-admission audit payload is unsafe") from error
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    return target
