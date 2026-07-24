from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import datetime
import hashlib
import json
from pathlib import Path
import re
import stat


ADMISSION_REVIEW_SCHEMA_VERSION = "case-admission-review-v3"
ADMISSION_REVIEW_DRAFT_SCHEMA_VERSION = "case-admission-review-draft-v3"
REVIEWER_WORKSHEET_SCHEMA_VERSION = "case-admission-reviewer-worksheet-v1"
IDENTIFIER_PATTERN = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
SHA256_PATTERN = re.compile(r"^[0-9a-f]{64}$")
COMMIT_SHA_PATTERN = re.compile(r"^[0-9a-f]{40}$")
VALID_DECISIONS = {"approved-for-development", "rejected"}
VALID_AUTHOR_HISTORY_ACCESS = {"provenance-only-v1", "public-solution-reviewed-v1"}
VALID_CONFIDENCE = {"low", "medium", "high"}
VALID_CALIBRATION_CLASSIFICATIONS = {
    "predecessor-dependent",
    "current-source-sufficient",
    "needs-redraft",
}
VALID_FINDING_VERDICTS = {"affirmed", "not-affirmed"}
REQUIRED_APPROVAL_FINDINGS = {
    "independent-transition-v1",
    "not-public-solution-isomorphic-v1",
    "predecessor-dependency-reviewed-v1",
    "current-source-sufficiency-reviewed-v1",
}
REVIEWER_CALIBRATION_SCENARIOS = (
    "public-answer-restatement-v1",
    "durable-predecessor-constraint-v1",
    "ambiguous-current-source-v1",
)
REVIEWER_CALIBRATION_EXPECTATIONS = {
    "public-answer-restatement-v1": "current-source-sufficient",
    "durable-predecessor-constraint-v1": "predecessor-dependent",
    "ambiguous-current-source-v1": "needs-redraft",
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
                "reviewer_attestations": [],
                "reviewer_attestation_template": {
                    "reviewer_id": "<independent reviewer pseudonym>",
                    "findings": ["<finding code>"],
                    "reviewer_worksheet_sha256": "<private worksheet SHA-256>",
                },
                "decision": "<approved-for-development|rejected>",
                "reviewed_at_utc": "<RFC3339 timestamp>",
            },
        }


@dataclass(frozen=True)
class ReviewerAttestation:
    """One reviewer's non-narrative assertion over the committed private bundle."""

    reviewer_id: str
    findings: tuple[str, ...]
    reviewer_worksheet_sha256: str


@dataclass(frozen=True)
class CalibrationResponse:
    """One private calibration response recorded before a real admission decision."""

    scenario_id: str
    classification: str
    confidence: str
    rationale: str


@dataclass(frozen=True)
class FindingAssessment:
    """One private, reviewer-authored rationale for an admission finding."""

    finding_code: str
    verdict: str
    confidence: str
    rationale: str


@dataclass(frozen=True)
class ReviewerWorksheet:
    """Private reviewer work product bound by hash from the public receipt."""

    schema_version: str
    candidate_id: str
    admission_review_draft_sha256: str
    reviewer_id: str
    reviewer_kind: str
    calibration_responses: tuple[CalibrationResponse, ...]
    finding_assessments: tuple[FindingAssessment, ...]
    reviewed_at_utc: str

    @property
    def affirmed_findings(self) -> tuple[str, ...]:
        return tuple(
            assessment.finding_code
            for assessment in self.finding_assessments
            if assessment.verdict == "affirmed"
        )

    @property
    def sha256(self) -> str:
        payload = json.dumps(asdict(self), sort_keys=True, separators=(",", ":"))
        return hashlib.sha256(payload.encode("utf-8")).hexdigest()


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
    reviewer_attestations: tuple[ReviewerAttestation, ...]
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


def _reviewer_attestations(
    value: object,
    *,
    reviewer_ids: tuple[str, ...],
) -> tuple[ReviewerAttestation, ...]:
    if not isinstance(value, list):
        raise AdmissionReviewError("admission review reviewer_attestations must be a list")
    attestations: list[ReviewerAttestation] = []
    for item in value:
        if not isinstance(item, dict) or set(item) != {
            "reviewer_id",
            "findings",
            "reviewer_worksheet_sha256",
        }:
            raise AdmissionReviewError("admission review reviewer attestation has an unsupported schema")
        attestations.append(ReviewerAttestation(
            reviewer_id=_identifier(item.get("reviewer_id"), label="reviewer_attestation.reviewer_id"),
            findings=_identifiers(
                item.get("findings"),
                label="reviewer_attestation.findings",
                minimum=1,
            ),
            reviewer_worksheet_sha256=_sha256(
                item.get("reviewer_worksheet_sha256"),
                label="reviewer_attestation.reviewer_worksheet_sha256",
            ),
        ))
    observed_ids = tuple(item.reviewer_id for item in attestations)
    if observed_ids != reviewer_ids:
        raise AdmissionReviewError(
            "admission review reviewer attestations must match reviewer_ids in order"
        )
    worksheet_hashes = [item.reviewer_worksheet_sha256 for item in attestations]
    if len(worksheet_hashes) != len(set(worksheet_hashes)):
        raise AdmissionReviewError("admission review reviewer worksheets must be distinct")
    return tuple(attestations)


def _timestamp(value: object) -> str:
    text = _required_text(value, label="reviewed_at_utc")
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError as error:
        raise AdmissionReviewError("admission review reviewed_at_utc is invalid") from error
    if parsed.tzinfo is None:
        raise AdmissionReviewError("admission review reviewed_at_utc must include a timezone")
    return text


def _choice(value: object, *, label: str, allowed: set[str]) -> str:
    text = _required_text(value, label=label)
    if text not in allowed:
        raise AdmissionReviewError(f"admission review {label} is unsupported")
    return text


def _rationale(value: object, *, label: str) -> str:
    text = _required_text(value, label=label)
    if len(text) < 20:
        raise AdmissionReviewError(f"admission review {label} must explain the judgment")
    return text


def _calibration_responses(value: object) -> tuple[CalibrationResponse, ...]:
    if not isinstance(value, list):
        raise AdmissionReviewError("admission review calibration_responses must be a list")
    responses: list[CalibrationResponse] = []
    for item in value:
        if not isinstance(item, dict) or set(item) != {
            "scenario_id",
            "classification",
            "confidence",
            "rationale",
        }:
            raise AdmissionReviewError("admission review calibration response has an unsupported schema")
        scenario_id = _required_text(item.get("scenario_id"), label="calibration.scenario_id")
        if scenario_id not in REVIEWER_CALIBRATION_SCENARIOS:
            raise AdmissionReviewError("admission review calibration scenario is unsupported")
        responses.append(CalibrationResponse(
            scenario_id=scenario_id,
            classification=_choice(
                item.get("classification"),
                label="calibration.classification",
                allowed=VALID_CALIBRATION_CLASSIFICATIONS,
            ),
            confidence=_choice(
                item.get("confidence"),
                label="calibration.confidence",
                allowed=VALID_CONFIDENCE,
            ),
            rationale=_rationale(item.get("rationale"), label="calibration.rationale"),
        ))
    observed = tuple(item.scenario_id for item in responses)
    if observed != REVIEWER_CALIBRATION_SCENARIOS:
        raise AdmissionReviewError("admission review calibration responses must cover each scenario in order")
    for response in responses:
        if response.classification != REVIEWER_CALIBRATION_EXPECTATIONS[response.scenario_id]:
            raise AdmissionReviewError("admission review calibration response does not apply the rubric")
    return tuple(responses)


def _finding_assessments(value: object) -> tuple[FindingAssessment, ...]:
    if not isinstance(value, list):
        raise AdmissionReviewError("admission review finding_assessments must be a list")
    assessments: list[FindingAssessment] = []
    for item in value:
        if not isinstance(item, dict) or set(item) != {
            "finding_code",
            "verdict",
            "confidence",
            "rationale",
        }:
            raise AdmissionReviewError("admission review finding assessment has an unsupported schema")
        finding_code = _identifier(item.get("finding_code"), label="finding_assessment.finding_code")
        if finding_code not in REQUIRED_APPROVAL_FINDINGS:
            raise AdmissionReviewError("admission review finding assessment is unsupported")
        assessments.append(FindingAssessment(
            finding_code=finding_code,
            verdict=_choice(
                item.get("verdict"),
                label="finding_assessment.verdict",
                allowed=VALID_FINDING_VERDICTS,
            ),
            confidence=_choice(
                item.get("confidence"),
                label="finding_assessment.confidence",
                allowed=VALID_CONFIDENCE,
            ),
            rationale=_rationale(item.get("rationale"), label="finding_assessment.rationale"),
        ))
    observed = tuple(item.finding_code for item in assessments)
    if len(observed) != len(set(observed)) or set(observed) != REQUIRED_APPROVAL_FINDINGS:
        raise AdmissionReviewError("admission review findings must assess every required code exactly once")
    return tuple(assessments)


def reviewer_worksheet_template(draft: CaseAdmissionReviewDraft) -> dict[str, object]:
    """Return a private worksheet template; it is never a public receipt."""

    return {
        "schema_version": REVIEWER_WORKSHEET_SCHEMA_VERSION,
        "candidate_id": draft.candidate_id,
        "admission_review_draft_sha256": draft.sha256,
        "reviewer_id": "<reviewer-pseudonym>",
        "reviewer_kind": "independent-human-v1",
        "calibration_responses": [
            {
                "scenario_id": scenario_id,
                "classification": "<predecessor-dependent|current-source-sufficient|needs-redraft>",
                "confidence": "<low|medium|high>",
                "rationale": "<private rationale>",
            }
            for scenario_id in REVIEWER_CALIBRATION_SCENARIOS
        ],
        "finding_assessments": [
            {
                "finding_code": finding_code,
                "verdict": "<affirmed|not-affirmed>",
                "confidence": "<low|medium|high>",
                "rationale": "<private rationale>",
            }
            for finding_code in sorted(REQUIRED_APPROVAL_FINDINGS)
        ],
        "reviewed_at_utc": "<RFC3339 timestamp>",
    }


def load_reviewer_worksheet(
    path: str | Path,
    *,
    draft: CaseAdmissionReviewDraft,
) -> ReviewerWorksheet:
    """Load one private human worksheet and bind it to an immutable draft."""

    source = Path(path)
    _committed_file_sha256(source, label="reviewer_worksheet")
    try:
        raw = json.loads(source.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise AdmissionReviewError("admission review worksheet cannot be read") from error
    if not isinstance(raw, dict):
        raise AdmissionReviewError("admission review worksheet must be an object")
    expected = {
        "schema_version",
        "candidate_id",
        "admission_review_draft_sha256",
        "reviewer_id",
        "reviewer_kind",
        "calibration_responses",
        "finding_assessments",
        "reviewed_at_utc",
    }
    if set(raw) != expected or raw.get("schema_version") != REVIEWER_WORKSHEET_SCHEMA_VERSION:
        raise AdmissionReviewError("admission review worksheet has an unsupported schema")
    reviewer_id = _identifier(raw.get("reviewer_id"), label="reviewer_worksheet.reviewer_id")
    if reviewer_id == draft.author_id:
        raise AdmissionReviewError("admission worksheet reviewer must be independent from the author")
    reviewer_kind = _required_text(raw.get("reviewer_kind"), label="reviewer_worksheet.reviewer_kind")
    if reviewer_kind != "independent-human-v1":
        raise AdmissionReviewError("admission worksheet requires an independent human reviewer")
    worksheet = ReviewerWorksheet(
        schema_version=REVIEWER_WORKSHEET_SCHEMA_VERSION,
        candidate_id=_identifier(raw.get("candidate_id"), label="reviewer_worksheet.candidate_id"),
        admission_review_draft_sha256=_sha256(
            raw.get("admission_review_draft_sha256"),
            label="reviewer_worksheet.admission_review_draft_sha256",
        ),
        reviewer_id=reviewer_id,
        reviewer_kind=reviewer_kind,
        calibration_responses=_calibration_responses(raw.get("calibration_responses")),
        finding_assessments=_finding_assessments(raw.get("finding_assessments")),
        reviewed_at_utc=_timestamp(raw.get("reviewed_at_utc")),
    )
    if worksheet.candidate_id != draft.candidate_id or worksheet.admission_review_draft_sha256 != draft.sha256:
        raise AdmissionReviewError("admission review worksheet does not bind the committed draft")
    return worksheet


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
        "reviewer_attestations",
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
    author_id = _identifier(raw.get("author_id"), label="author_id")
    reviewer_ids = _identifiers(raw.get("reviewer_ids"), label="reviewer_ids", minimum=2)
    reviewer_kind = _required_text(raw.get("reviewer_kind"), label="reviewer_kind")
    if reviewer_kind != "independent-human-v1":
        raise AdmissionReviewError("admission review requires independent human reviewers")
    if author_id in reviewer_ids:
        raise AdmissionReviewError("admission reviewers must be independent from the author")
    decision = _required_text(raw.get("decision"), label="decision")
    if decision not in VALID_DECISIONS:
        raise AdmissionReviewError("admission review decision is unsupported")
    findings = _identifiers(raw.get("findings"), label="findings")
    reviewer_attestations = _reviewer_attestations(
        raw.get("reviewer_attestations"),
        reviewer_ids=reviewer_ids,
    )
    attested_findings = {
        finding
        for attestation in reviewer_attestations
        for finding in attestation.findings
    }
    if set(findings) != attested_findings:
        raise AdmissionReviewError(
            "admission review findings must equal the union of reviewer attestations"
        )
    review = CaseAdmissionReview(
        schema_version=ADMISSION_REVIEW_SCHEMA_VERSION,
        candidate_id=_identifier(raw.get("candidate_id"), label="candidate_id"),
        repository_url=_required_text(raw.get("repository_url"), label="repository_url"),
        base_revision=_commit(raw.get("base_revision"), label="base_revision"),
        public_transition_revision=_commit(
            raw.get("public_transition_revision"),
            label="public_transition_revision",
        ),
        author_id=author_id,
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
        reviewer_ids=reviewer_ids,
        reviewer_kind=reviewer_kind,
        findings=findings,
        reviewer_attestations=reviewer_attestations,
        decision=decision,
        reviewed_at_utc=_timestamp(raw.get("reviewed_at_utc")),
    )
    if review.decision == "approved-for-development":
        if review.author_history_access != "provenance-only-v1":
            raise AdmissionReviewError(
                "approved admission requires provenance-only author history access"
            )
        if not REQUIRED_APPROVAL_FINDINGS <= set(review.findings):
            raise AdmissionReviewError("approved admission is missing required findings")
        for attestation in review.reviewer_attestations:
            if not REQUIRED_APPROVAL_FINDINGS <= set(attestation.findings):
                raise AdmissionReviewError(
                    "approved admission requires each reviewer to attest every required finding"
                )
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


def validate_admission_review_worksheets(
    review: CaseAdmissionReview,
    *,
    draft: CaseAdmissionReviewDraft,
    worksheets: tuple[ReviewerWorksheet, ...],
) -> None:
    """Bind private reviewer reasoning to the public hash-only receipt.

    The worksheet content stays with the review organizer. This check proves
    only that the public receipt names the same reviewer work products and that
    their recorded verdicts agree; it cannot replace independent human review.
    """

    review_binding = (
        review.candidate_id,
        review.repository_url.rstrip("/").removesuffix(".git"),
        review.base_revision,
        review.public_transition_revision,
        review.author_id,
        review.author_history_access,
        review.private_transition_commitment_sha256,
        review.private_task_brief_sha256,
        review.public_history_comparison_sha256,
    )
    draft_binding = (
        draft.candidate_id,
        draft.repository_url.rstrip("/").removesuffix(".git"),
        draft.base_revision,
        draft.public_transition_revision,
        draft.author_id,
        draft.author_history_access,
        draft.private_transition_commitment_sha256,
        draft.private_task_brief_sha256,
        draft.public_history_comparison_sha256,
    )
    if review_binding != draft_binding:
        raise AdmissionReviewError("admission review worksheets do not bind the committed draft")
    if tuple(item.reviewer_id for item in worksheets) != review.reviewer_ids:
        raise AdmissionReviewError("admission review worksheets must match reviewer ids in order")
    if len(worksheets) != len(review.reviewer_attestations):
        raise AdmissionReviewError("admission review worksheet coverage is incomplete")
    for attestation, worksheet in zip(review.reviewer_attestations, worksheets):
        if worksheet.reviewer_id != attestation.reviewer_id:
            raise AdmissionReviewError("admission review worksheet reviewer does not match attestation")
        if worksheet.sha256 != attestation.reviewer_worksheet_sha256:
            raise AdmissionReviewError("admission review worksheet hash does not match attestation")
        if set(worksheet.affirmed_findings) != set(attestation.findings):
            raise AdmissionReviewError("admission review worksheet verdicts do not match attestation")
    if review.decision == "approved-for-development":
        for worksheet in worksheets:
            if any(
                assessment.confidence == "low"
                for assessment in worksheet.finding_assessments
            ):
                raise AdmissionReviewError(
                    "approved admission needs at least medium confidence for every finding"
                )
