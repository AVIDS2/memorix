from __future__ import annotations

from pathlib import Path

import pytest

from memorixbench.admission import write_admission_review_draft
from memorixbench import pre_admission
from memorixbench.pre_admission import (
    PreAdmissionAuditError,
    audit_private_draft,
    write_pre_admission_audit,
)
from memorixbench.source_ledger import SourceAudit, load_source_ledger


RESEARCH_ROOT = Path(__file__).parents[1]
LEDGER_PATH = RESEARCH_ROOT / "cases" / "CANDIDATE-SOURCES.toml"


def _draft_bundle(tmp_path: Path, *, candidate_id: str = "click-help-parameter") -> Path:
    root = tmp_path / "private-draft"
    root.mkdir()
    transition = root / "PRIVATE-TRANSITION.md"
    brief = root / "PRIVATE-TASK-BRIEF.md"
    comparison = root / "PUBLIC-HISTORY-COMPARISON.md"
    transition.write_text("private transition specification\n", encoding="utf-8")
    brief.write_text("private task brief\n", encoding="utf-8")
    comparison.write_text("private public-history comparison\n", encoding="utf-8")
    ledger = load_source_ledger(LEDGER_PATH)
    candidate = next(entry for entry in ledger.entries if entry.candidate_id == candidate_id)
    write_admission_review_draft(
        candidate_id=candidate.candidate_id,
        repository_url=candidate.repository_url,
        base_revision=candidate.base_revision,
        public_transition_revision=candidate.public_transition_revision,
        author_id="benchmark-author",
        author_history_access="provenance-only-v1",
        private_transition=transition,
        private_task_brief=brief,
        public_history_comparison=comparison,
        output=root / "ADMISSION-REVIEW-DRAFT.json",
    )
    return root


def _stub_source_audit(monkeypatch: pytest.MonkeyPatch) -> None:
    def fake_audit(ledger: object, *, candidate_id: str, repository_cache: Path) -> SourceAudit:
        candidate = next(
            entry
            for entry in ledger.entries  # type: ignore[attr-defined]
            if entry.candidate_id == candidate_id
        )
        return SourceAudit(
            candidate_id=candidate.candidate_id,
            repository_origin=candidate.repository_url,
            base_revision=candidate.base_revision,
            public_transition_revision=candidate.public_transition_revision,
            license_path=candidate.license_path,
            license_sha256=candidate.license_sha256,
            origin_matches=True,
            base_matches_public_parent=True,
            license_matches=True,
        )

    monkeypatch.setattr(pre_admission, "audit_source_candidate", fake_audit)


def test_private_draft_audit_binds_hashes_and_keeps_human_gate(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    ledger = load_source_ledger(LEDGER_PATH)
    root = _draft_bundle(tmp_path)
    _stub_source_audit(monkeypatch)
    cache = tmp_path / "cache"
    cache.mkdir()

    audit = audit_private_draft(
        ledger=ledger,
        candidate_id="click-help-parameter",
        draft_root=root,
        repository_cache=cache,
        audited_at_utc="2026-07-24T00:00:00Z",
    )
    assert audit.audit_kind == "automated-pre-review-only-v1"
    assert audit.admission_decision == "not-issued"
    assert "independent-human-review-required-v1" in audit.remaining_admission_gates
    output = write_pre_admission_audit(audit, output=tmp_path / "receipt.json")
    serialized = output.read_text(encoding="utf-8")
    assert "private transition specification" not in serialized
    assert "private task brief" not in serialized


def test_private_draft_audit_rejects_tampered_private_file_before_source_execution(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    root = _draft_bundle(tmp_path)
    (root / "PRIVATE-TRANSITION.md").write_text("tampered\n", encoding="utf-8")
    ledger = load_source_ledger(LEDGER_PATH)
    _stub_source_audit(monkeypatch)
    cache = tmp_path / "cache"
    cache.mkdir()

    with pytest.raises(PreAdmissionAuditError, match="PRIVATE-TRANSITION.md does not match"):
        audit_private_draft(
            ledger=ledger,
            candidate_id="click-help-parameter",
            draft_root=root,
            repository_cache=cache,
        )


def test_private_draft_audit_rejects_credential_like_text(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    root = _draft_bundle(tmp_path)
    (root / "PRIVATE-TASK-BRIEF.md").write_text("api_key = leaked-value\n", encoding="utf-8")
    ledger = load_source_ledger(LEDGER_PATH)
    _stub_source_audit(monkeypatch)
    cache = tmp_path / "cache"
    cache.mkdir()

    with pytest.raises(PreAdmissionAuditError, match="PRIVATE-TASK-BRIEF.md failed"):
        audit_private_draft(
            ledger=ledger,
            candidate_id="click-help-parameter",
            draft_root=root,
            repository_cache=cache,
        )


def test_private_draft_audit_requires_a_regular_source_cache(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    root = _draft_bundle(tmp_path)
    _stub_source_audit(monkeypatch)

    with pytest.raises(PreAdmissionAuditError, match="source repository cache cannot be read"):
        audit_private_draft(
            ledger=load_source_ledger(LEDGER_PATH),
            candidate_id="click-help-parameter",
            draft_root=root,
            repository_cache=tmp_path / "missing-cache",
        )


def test_private_draft_audit_rejects_uncommitted_bundle_files(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    root = _draft_bundle(tmp_path)
    (root / "EXTRA.md").write_text("uncommitted\n", encoding="utf-8")
    cache = tmp_path / "cache"
    cache.mkdir()
    _stub_source_audit(monkeypatch)

    with pytest.raises(PreAdmissionAuditError, match="exactly the committed draft files"):
        audit_private_draft(
            ledger=load_source_ledger(LEDGER_PATH),
            candidate_id="click-help-parameter",
            draft_root=root,
            repository_cache=cache,
        )
