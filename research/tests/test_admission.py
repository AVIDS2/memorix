from __future__ import annotations

import json
from pathlib import Path

import pytest

from memorixbench.admission import (
    AdmissionReviewError,
    load_admission_review_draft,
    load_admission_review,
    validate_admission_review,
    write_admission_review_draft,
)


def _payload() -> dict[str, object]:
    return {
        "schema_version": "case-admission-review-v1",
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
    with pytest.raises(AdmissionReviewError, match="missing required findings"):
        load_admission_review(_write_review(tmp_path, incomplete))


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
