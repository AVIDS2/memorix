from __future__ import annotations

import json
from pathlib import Path

import pytest

from memorixbench.admission import (
    AdmissionReviewError,
    load_admission_review_draft,
    load_admission_review,
    load_reviewer_worksheet,
    reviewer_worksheet_template,
    validate_admission_review,
    validate_admission_review_worksheets,
    write_admission_review_draft,
)


def _payload() -> dict[str, object]:
    return {
        "schema_version": "case-admission-review-v3",
        "candidate_id": "example-source",
        "repository_url": "https://github.com/example/project",
        "base_revision": "a" * 40,
        "public_transition_revision": "b" * 40,
        "author_id": "author-alpha",
        "author_history_access": "provenance-only-v1",
        "private_transition_commitment_sha256": "c" * 64,
        "private_task_brief_sha256": "d" * 64,
        "public_history_comparison_sha256": "e" * 64,
        "reviewer_ids": ["reviewer-beta", "reviewer-gamma"],
        "reviewer_kind": "independent-human-v1",
        "findings": [
            "independent-transition-v1",
            "not-public-solution-isomorphic-v1",
            "predecessor-dependency-reviewed-v1",
            "current-source-sufficiency-reviewed-v1",
        ],
        "reviewer_attestations": [
            {
                "reviewer_id": "reviewer-beta",
                "findings": [
                    "independent-transition-v1",
                    "not-public-solution-isomorphic-v1",
                    "predecessor-dependency-reviewed-v1",
                    "current-source-sufficiency-reviewed-v1",
                ],
                "reviewer_worksheet_sha256": "1" * 64,
            },
            {
                "reviewer_id": "reviewer-gamma",
                "findings": [
                    "independent-transition-v1",
                    "not-public-solution-isomorphic-v1",
                    "predecessor-dependency-reviewed-v1",
                    "current-source-sufficiency-reviewed-v1",
                ],
                "reviewer_worksheet_sha256": "2" * 64,
            },
        ],
        "decision": "approved-for-development",
        "reviewed_at_utc": "2026-07-23T00:00:00+00:00",
    }


def _write_review(tmp_path: Path, payload: dict[str, object] | None = None) -> Path:
    path = tmp_path / "review.json"
    path.write_text(json.dumps(payload or _payload(), indent=2) + "\n", encoding="utf-8")
    return path


def test_admission_review_binds_a_private_design_to_the_source_candidate(tmp_path: Path) -> None:
    review = load_admission_review(_write_review(tmp_path))

    validate_admission_review(
        review,
        candidate_id="example-source",
        repository_url="https://github.com/example/project.git",
        base_revision="a" * 40,
        public_transition_revision="b" * 40,
    )

    assert review.public_payload()["admission_review_sha256"] == review.sha256
    serialized = json.dumps(review.public_payload()).casefold()
    assert "private task body" not in serialized
    assert review.private_task_brief_sha256 in serialized


def test_admission_review_rejects_author_reviewer_overlap_or_missing_findings(tmp_path: Path) -> None:
    overlapping = _payload()
    overlapping["reviewer_ids"] = ["author-alpha", "reviewer-beta"]
    with pytest.raises(AdmissionReviewError, match="independent from the author"):
        load_admission_review(_write_review(tmp_path, overlapping))

    incomplete = _payload()
    incomplete["findings"] = ["independent-transition-v1"]
    attestations = incomplete["reviewer_attestations"]
    assert isinstance(attestations, list)
    for attestation in attestations:
        assert isinstance(attestation, dict)
        attestation["findings"] = ["independent-transition-v1"]
    with pytest.raises(AdmissionReviewError, match="missing required findings"):
        load_admission_review(_write_review(tmp_path, incomplete))


def test_admission_review_requires_each_reviewer_to_attest_required_findings(
    tmp_path: Path,
) -> None:
    payload = _payload()
    attestations = payload["reviewer_attestations"]
    assert isinstance(attestations, list)
    assert isinstance(attestations[1], dict)
    attestations[1]["findings"] = ["independent-transition-v1"]

    with pytest.raises(AdmissionReviewError, match="each reviewer to attest"):
        load_admission_review(_write_review(tmp_path, payload))


def test_admission_review_rejects_mismatched_aggregate_or_reviewer_attestations(
    tmp_path: Path,
) -> None:
    payload = _payload()
    payload["findings"] = ["independent-transition-v1"]

    with pytest.raises(AdmissionReviewError, match="must equal the union"):
        load_admission_review(_write_review(tmp_path, payload))


def test_admission_review_rejects_the_pre_attestation_schema(tmp_path: Path) -> None:
    payload = _payload()
    payload["schema_version"] = "case-admission-review-v1"

    with pytest.raises(AdmissionReviewError, match="unsupported schema"):
        load_admission_review(_write_review(tmp_path, payload))


def test_admission_review_rejects_a_mismatched_source_binding(tmp_path: Path) -> None:
    review = load_admission_review(_write_review(tmp_path))
    with pytest.raises(AdmissionReviewError, match="does not bind"):
        validate_admission_review(
            review,
            candidate_id="other-source",
            repository_url="https://github.com/example/project",
            base_revision="a" * 40,
            public_transition_revision="b" * 40,
        )


def test_admission_draft_commits_private_inputs_without_writing_their_content(
    tmp_path: Path,
) -> None:
    transition = tmp_path / "transition.patch"
    brief = tmp_path / "task-brief.md"
    comparison = tmp_path / "history-comparison.md"
    transition.write_text("private transition body\n", encoding="utf-8")
    brief.write_text("private task brief body\n", encoding="utf-8")
    comparison.write_text("private comparison body\n", encoding="utf-8")
    output = tmp_path / "draft.json"

    draft = write_admission_review_draft(
        candidate_id="example-source",
        repository_url="https://github.com/example/project",
        base_revision="a" * 40,
        public_transition_revision="b" * 40,
        author_id="author-alpha",
        author_history_access="provenance-only-v1",
        private_transition=transition,
        private_task_brief=brief,
        public_history_comparison=comparison,
        output=output,
    )

    serialized = output.read_text(encoding="utf-8")
    assert "private transition body" not in serialized
    assert "private task brief body" not in serialized
    assert "private comparison body" not in serialized
    assert draft.private_transition_commitment_sha256 in serialized
    assert '"reviewer_ids": []' in serialized
    assert '"receipt_schema_version": "case-admission-review-v3"' in serialized
    assert '"reviewer_worksheet_sha256": "<private worksheet SHA-256>"' in serialized

    loaded = load_admission_review_draft(output)
    assert loaded == draft


def test_admission_draft_rejects_a_tampered_commitment(tmp_path: Path) -> None:
    transition = tmp_path / "transition.patch"
    brief = tmp_path / "task-brief.md"
    comparison = tmp_path / "history-comparison.md"
    transition.write_text("private transition body\n", encoding="utf-8")
    brief.write_text("private task brief body\n", encoding="utf-8")
    comparison.write_text("private comparison body\n", encoding="utf-8")
    output = tmp_path / "draft.json"
    write_admission_review_draft(
        candidate_id="example-source",
        repository_url="https://github.com/example/project",
        base_revision="a" * 40,
        public_transition_revision="b" * 40,
        author_id="author-alpha",
        author_history_access="provenance-only-v1",
        private_transition=transition,
        private_task_brief=brief,
        public_history_comparison=comparison,
        output=output,
    )
    payload = json.loads(output.read_text(encoding="utf-8"))
    payload["private_transition_commitment_sha256"] = "0" * 64
    output.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")

    with pytest.raises(AdmissionReviewError, match="commitment"):
        load_admission_review_draft(output)


def test_admission_draft_refuses_to_overwrite_existing_output(tmp_path: Path) -> None:
    source = tmp_path / "private.txt"
    source.write_text("private\n", encoding="utf-8")
    output = tmp_path / "draft.json"
    output.write_text("existing\n", encoding="utf-8")

    with pytest.raises(AdmissionReviewError, match="output already exists"):
        write_admission_review_draft(
            candidate_id="example-source",
            repository_url="https://github.com/example/project",
            base_revision="a" * 40,
            public_transition_revision="b" * 40,
            author_id="author-alpha",
            author_history_access="provenance-only-v1",
            private_transition=source,
            private_task_brief=source,
            public_history_comparison=source,
            output=output,
        )


def _worksheet_payload(draft: object, *, reviewer_id: str, confidence: str = "medium") -> dict[str, object]:
    template = reviewer_worksheet_template(draft)  # type: ignore[arg-type]
    template["reviewer_id"] = reviewer_id
    calibration = template["calibration_responses"]
    assert isinstance(calibration, list)
    classifications = {
        "public-answer-restatement-v1": "current-source-sufficient",
        "durable-predecessor-constraint-v1": "predecessor-dependent",
        "ambiguous-current-source-v1": "needs-redraft",
    }
    for response in calibration:
        assert isinstance(response, dict)
        scenario_id = response["scenario_id"]
        assert isinstance(scenario_id, str)
        response["classification"] = classifications[scenario_id]
        response["confidence"] = "high"
        response["rationale"] = "This calibration rationale applies the shared review rubric."
    assessments = template["finding_assessments"]
    assert isinstance(assessments, list)
    for assessment in assessments:
        assert isinstance(assessment, dict)
        assessment["verdict"] = "affirmed"
        assessment["confidence"] = confidence
        assessment["rationale"] = "This private rationale records the evidence considered by the reviewer."
    template["reviewed_at_utc"] = "2026-07-23T00:00:00+00:00"
    return template


def test_private_reviewer_worksheets_bind_to_the_public_receipt(tmp_path: Path) -> None:
    transition = tmp_path / "transition.patch"
    brief = tmp_path / "task-brief.md"
    comparison = tmp_path / "history-comparison.md"
    for path in (transition, brief, comparison):
        path.write_text("private review material\n", encoding="utf-8")
    draft_path = tmp_path / "draft.json"
    draft = write_admission_review_draft(
        candidate_id="example-source",
        repository_url="https://github.com/example/project",
        base_revision="a" * 40,
        public_transition_revision="b" * 40,
        author_id="author-alpha",
        author_history_access="provenance-only-v1",
        private_transition=transition,
        private_task_brief=brief,
        public_history_comparison=comparison,
        output=draft_path,
    )
    worksheets = []
    for reviewer_id in ("reviewer-beta", "reviewer-gamma"):
        worksheet_path = tmp_path / f"{reviewer_id}.json"
        worksheet_path.write_text(
            json.dumps(_worksheet_payload(draft, reviewer_id=reviewer_id), indent=2) + "\n",
            encoding="utf-8",
        )
        worksheets.append(load_reviewer_worksheet(worksheet_path, draft=draft))

    payload = _payload()
    payload["private_transition_commitment_sha256"] = draft.private_transition_commitment_sha256
    payload["private_task_brief_sha256"] = draft.private_task_brief_sha256
    payload["public_history_comparison_sha256"] = draft.public_history_comparison_sha256
    attestations = payload["reviewer_attestations"]
    assert isinstance(attestations, list)
    for attestation, worksheet in zip(attestations, worksheets):
        assert isinstance(attestation, dict)
        attestation["reviewer_worksheet_sha256"] = worksheet.sha256
    review = load_admission_review(_write_review(tmp_path, payload))
    validate_admission_review_worksheets(review, draft=draft, worksheets=tuple(worksheets))

    low_confidence_path = tmp_path / "reviewer-beta-low.json"
    low_confidence_path.write_text(
        json.dumps(_worksheet_payload(draft, reviewer_id="reviewer-beta", confidence="low"), indent=2) + "\n",
        encoding="utf-8",
    )
    low_confidence = load_reviewer_worksheet(low_confidence_path, draft=draft)
    attestations[0]["reviewer_worksheet_sha256"] = low_confidence.sha256
    review = load_admission_review(_write_review(tmp_path, payload))
    with pytest.raises(AdmissionReviewError, match="at least medium confidence"):
        validate_admission_review_worksheets(
            review,
            draft=draft,
            worksheets=(low_confidence, worksheets[1]),
        )
