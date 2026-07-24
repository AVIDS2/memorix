from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import datetime
import hashlib
import json
from pathlib import Path
import re
import stat


ADMISSION_REVIEW_SCHEMA_VERSION = "case-admission-review-v1"
ADMISSION_REVIEW_DRAFT_SCHEMA_VERSION = "case-admission-review-draft-v1"
IDENTIFIER_PATTERN = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
SHA256_PATTERN = re.compile(r"^[0-9a-f]{64}$")
COMMIT_SHA_PATTERN = re.compile(r"^[0-9a-f]{40}$")
VALID_DECISIONS = {"approved-for-development", "rejected"}
VALID_AUTHOR_HISTORY_ACCESS = {"provenance-only-v1", "public-solution-reviewed-v1"}
REQUIRED_APPROVAL_FINDINGS = {
    "independent-transition-v1",
    "not-public-solution-isomorphic-v1",
    "predecessor-dependency-reviewed-v1",
    "current-source-sufficiency-reviewed-v1",
}


class AdmissionReviewError(ValueError):
    """Raised when a case-admission receipt lacks an independent review boundary."""


@dataclass(frozen=True)
class CaseAdmissionReviewDraft:
    """Hash-only inputs for independent reviewers; not itself an approval."""

    schema_version: str
    receipt_schema_version: str
    candidate_id: str
    repository_url: str
    base_revision: str
    public_transition_revision: str
    author_id: str
    author_history_access: str
    private_transition_commitment_sha256: str
    private_task_brief_sha256: str
    public_history_comparison_sha256: str

    @property
    def sha256(self) -> str:
        payload = json.dumps(asdict(self), sort_keys=True, separators=(",", ":"))
        return hashlib.sha256(payload.encode("utf-8")).hexdigest()

    def public_payload(self) -> dict[str, object]:
        return {
            **asdict(self),
            "admission_review_draft_sha256": self.sha256,
            "review_template": {
                "schema_version": ADMISSION_REVIEW_SCHEMA_VERSION,
                "candidate_id": self.candidate_id,
                "repository_url": self.repository_url,
                "base_revision": self.base_revision,
                "public_transition_revision": self.public_transition_revision,
                "author_id": self.author_id,
                "author_history_access": self.author_history_access,
                "private_transition_commitment_sha256": self.private_transition_commitment_sha256,
                "private_task_brief_sha256": self.private_task_brief_sha256,
                "public_history_comparison_sha256": self.public_history_comparison_sha256,
                "reviewer_ids": [],
                "reviewer_kind": "independent-human-v1",
                "findings": [],
                "decision": "<approved-for-development|rejected>",
                "reviewed_at_utc": "<RFC3339 timestamp>",
            },
        }


@dataclass(frozen=True)
class CaseAdmissionReview:
    schema_version: str
    candidate_id: str
    repository_url: str
    base_revision: str
    public_transition_revision: str
    author_id: str
    author_history_access: str
    private_transition_commitment_sha256: str
    private_task_brief_sha256: str
    public_history_comparison_sha256: str
    reviewer_ids: tuple[str, ...]
    reviewer_kind: str
    findings: tuple[str, ...]
    decision: str
    reviewed_at_utc: str

    @property
    def sha256(self) -> str:
        payload = json.dumps(asdict(self), sort_keys=True, separators=(",", ":"))
        return hashlib.sha256(payload.encode("utf-8")).hexdigest()

    def public_payload(self) -> dict[str, object]:
        return {**asdict(self), "admission_review_sha256": self.sha256}


def _required_text(value: object, *, label: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise AdmissionReviewError(f"admission review {label} must be a non-empty string")
    return value.strip()


def _identifier(value: object, *, label: str) -> str:
    text = _required_text(value, label=label)
    if not IDENTIFIER_PATTERN.fullmatch(text):
        raise AdmissionReviewError(f"admission review {label} must be a lowercase hyphenated id")
    return text


def _sha256(value: object, *, label: str) -> str:
    text = _required_text(value, label=label)
    if not SHA256_PATTERN.fullmatch(text):
        raise AdmissionReviewError(f"admission review {label} must be a lowercase SHA-256")
    return text


def _commit(value: object, *, label: str) -> str:
    text = _required_text(value, label=label)
    if not COMMIT_SHA_PATTERN.fullmatch(text):
        raise AdmissionReviewError(f"admission review {label} must be a full lowercase commit SHA")
    return text


def _identifiers(value: object, *, label: str, minimum: int = 0) -> tuple[str, ...]:
    if not isinstance(value, list):
        raise AdmissionReviewError(f"admission review {label} must be a list")
    values = tuple(_identifier(item, label=label) for item in value)
    if len(values) < minimum:
        raise AdmissionReviewError(f"admission review {label} is incomplete")
    if len(values) != len(set(values)):
        raise AdmissionReviewError(f"admission review {label} cannot contain duplicates")
    return values


def _timestamp(value: object) -> str:
    text = _required_text(value, label="reviewed_at_utc")
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError as error:
        raise AdmissionReviewError("admission review reviewed_at_utc is invalid") from error
    if parsed.tzinfo is None:
        raise AdmissionReviewError("admission review reviewed_at_utc must include a timezone")
    return text


def _is_reparse_point(metadata: object) -> bool:
    attributes = getattr(metadata, "st_file_attributes", 0)
    flag = getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0x400)
    return bool(attributes & flag)


def _committed_file_sha256(path: str | Path, *, label: str) -> str:
    source = Path(path)
    try:
        metadata = source.lstat()
    except OSError as error:
        raise AdmissionReviewError(f"admission review {label} cannot be read") from error
    if (
        source.is_symlink()
        or _is_reparse_point(metadata)
        or not stat.S_ISREG(metadata.st_mode)
    ):
        raise AdmissionReviewError(f"admission review {label} must be a regular file")
    try:
        return hashlib.sha256(source.read_bytes()).hexdigest()
    except OSError as error:
        raise AdmissionReviewError(f"admission review {label} cannot be read") from error


def write_admission_review_draft(
    *,
    candidate_id: str,
    repository_url: str,
    base_revision: str,
    public_transition_revision: str,
    author_id: str,
    author_history_access: str,
    private_transition: str | Path,
    private_task_brief: str | Path,
    public_history_comparison: str | Path,
    output: str | Path,
) -> CaseAdmissionReviewDraft:
    """Commit private review inputs by hash without publishing their contents."""

    author_access = _required_text(
        author_history_access,
        label="author_history_access",
    )
    if author_access not in VALID_AUTHOR_HISTORY_ACCESS:
        raise AdmissionReviewError("admission review author_history_access is unsupported")
    draft = CaseAdmissionReviewDraft(
        schema_version=ADMISSION_REVIEW_DRAFT_SCHEMA_VERSION,
        receipt_schema_version=ADMISSION_REVIEW_SCHEMA_VERSION,
        candidate_id=_identifier(candidate_id, label="candidate_id"),
        repository_url=_required_text(repository_url, label="repository_url"),
        base_revision=_commit(base_revision, label="base_revision"),
        public_transition_revision=_commit(
            public_transition_revision,
            label="public_transition_revision",
        ),
        author_id=_identifier(author_id, label="author_id"),
        author_history_access=author_access,
        private_transition_commitment_sha256=_committed_file_sha256(
            private_transition,
            label="private_transition",
        ),
        private_task_brief_sha256=_committed_file_sha256(
            private_task_brief,
            label="private_task_brief",
        ),
        public_history_comparison_sha256=_committed_file_sha256(
            public_history_comparison,
            label="public_history_comparison",
        ),
    )
    target = Path(output).resolve()
    if target.exists():
        raise AdmissionReviewError("admission review draft output already exists")
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(draft.public_payload(), indent=2) + "\n", encoding="utf-8")
    return draft


def load_admission_review_draft(path: str | Path) -> CaseAdmissionReviewDraft:
    """Load a hash-only reviewer template without treating it as an approval."""

    source = Path(path)
    _committed_file_sha256(source, label="admission_review_draft")
    try:
        raw = json.loads(source.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise AdmissionReviewError("admission review draft cannot be read") from error
    if not isinstance(raw, dict):
        raise AdmissionReviewError("admission review draft must be an object")
    expected = {
        "schema_version",
        "receipt_schema_version",
        "candidate_id",
        "repository_url",
        "base_revision",
        "public_transition_revision",
        "author_id",
        "author_history_access",
        "private_transition_commitment_sha256",
        "private_task_brief_sha256",
        "public_history_comparison_sha256",
        "admission_review_draft_sha256",
        "review_template",
    }
    if set(raw) != expected:
        raise AdmissionReviewError("admission review draft has an unsupported schema")
    author_history_access = _required_text(
        raw.get("author_history_access"),
        label="author_history_access",
    )
    if author_history_access not in VALID_AUTHOR_HISTORY_ACCESS:
        raise AdmissionReviewError("admission review draft author_history_access is unsupported")
    draft = CaseAdmissionReviewDraft(
        schema_version=_required_text(raw.get("schema_version"), label="schema_version"),
        receipt_schema_version=_required_text(
            raw.get("receipt_schema_version"),
            label="receipt_schema_version",
        ),
        candidate_id=_identifier(raw.get("candidate_id"), label="candidate_id"),
        repository_url=_required_text(raw.get("repository_url"), label="repository_url"),
        base_revision=_commit(raw.get("base_revision"), label="base_revision"),
        public_transition_revision=_commit(
            raw.get("public_transition_revision"),
            label="public_transition_revision",
        ),
        author_id=_identifier(raw.get("author_id"), label="author_id"),
        author_history_access=author_history_access,
        private_transition_commitment_sha256=_sha256(
            raw.get("private_transition_commitment_sha256"),
            label="private_transition_commitment_sha256",
        ),
        private_task_brief_sha256=_sha256(
            raw.get("private_task_brief_sha256"),
            label="private_task_brief_sha256",
        ),
        public_history_comparison_sha256=_sha256(
            raw.get("public_history_comparison_sha256"),
            label="public_history_comparison_sha256",
        ),
    )
    if (
        draft.schema_version != ADMISSION_REVIEW_DRAFT_SCHEMA_VERSION
        or draft.receipt_schema_version != ADMISSION_REVIEW_SCHEMA_VERSION
        or raw != draft.public_payload()
    ):
        raise AdmissionReviewError("admission review draft commitment does not match its contents")
    return draft


def load_admission_review(path: str | Path) -> CaseAdmissionReview:
    source = Path(path).resolve()
    try:
        raw = json.loads(source.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise AdmissionReviewError("admission review cannot be read") from error
    if not isinstance(raw, dict):
        raise AdmissionReviewError("admission review must be an object")
    expected = {
        "schema_version",
        "candidate_id",
        "repository_url",
        "base_revision",
        "public_transition_revision",
        "author_id",
        "author_history_access",
        "private_transition_commitment_sha256",
        "private_task_brief_sha256",
        "public_history_comparison_sha256",
        "reviewer_ids",
        "reviewer_kind",
        "findings",
        "decision",
        "reviewed_at_utc",
    }
    if set(raw) != expected or raw.get("schema_version") != ADMISSION_REVIEW_SCHEMA_VERSION:
        raise AdmissionReviewError("admission review has an unsupported schema")
    author_history_access = _required_text(
        raw.get("author_history_access"),
        label="author_history_access",
    )
    if author_history_access not in VALID_AUTHOR_HISTORY_ACCESS:
        raise AdmissionReviewError("admission review author_history_access is unsupported")
    decision = _required_text(raw.get("decision"), label="decision")
    if decision not in VALID_DECISIONS:
        raise AdmissionReviewError("admission review decision is unsupported")
    review = CaseAdmissionReview(
        schema_version=ADMISSION_REVIEW_SCHEMA_VERSION,
        candidate_id=_identifier(raw.get("candidate_id"), label="candidate_id"),
        repository_url=_required_text(raw.get("repository_url"), label="repository_url"),
        base_revision=_commit(raw.get("base_revision"), label="base_revision"),
        public_transition_revision=_commit(
            raw.get("public_transition_revision"),
            label="public_transition_revision",
        ),
        author_id=_identifier(raw.get("author_id"), label="author_id"),
        author_history_access=author_history_access,
        private_transition_commitment_sha256=_sha256(
            raw.get("private_transition_commitment_sha256"),
            label="private_transition_commitment_sha256",
        ),
        private_task_brief_sha256=_sha256(
            raw.get("private_task_brief_sha256"),
            label="private_task_brief_sha256",
        ),
        public_history_comparison_sha256=_sha256(
            raw.get("public_history_comparison_sha256"),
            label="public_history_comparison_sha256",
        ),
        reviewer_ids=_identifiers(raw.get("reviewer_ids"), label="reviewer_ids", minimum=2),
        reviewer_kind=_required_text(raw.get("reviewer_kind"), label="reviewer_kind"),
        findings=_identifiers(raw.get("findings"), label="findings"),
        decision=decision,
        reviewed_at_utc=_timestamp(raw.get("reviewed_at_utc")),
    )
    if review.reviewer_kind != "independent-human-v1":
        raise AdmissionReviewError("admission review requires independent human reviewers")
    if review.author_id in review.reviewer_ids:
        raise AdmissionReviewError("admission reviewers must be independent from the author")
    if review.decision == "approved-for-development":
        if review.author_history_access != "provenance-only-v1":
            raise AdmissionReviewError(
                "approved admission requires provenance-only author history access"
            )
        if not REQUIRED_APPROVAL_FINDINGS <= set(review.findings):
            raise AdmissionReviewError("approved admission is missing required findings")
    return review


def validate_admission_review(
    review: CaseAdmissionReview,
    *,
    candidate_id: str,
    repository_url: str,
    base_revision: str,
    public_transition_revision: str,
) -> None:
    """Bind a private-task review receipt to the immutable source-ledger entry."""

    expected = (
        candidate_id,
        repository_url.rstrip("/").removesuffix(".git"),
        base_revision,
        public_transition_revision,
    )
    observed = (
        review.candidate_id,
        review.repository_url.rstrip("/").removesuffix(".git"),
        review.base_revision,
        review.public_transition_revision,
    )
    if observed != expected:
        raise AdmissionReviewError("admission review does not bind the source-ledger candidate")
