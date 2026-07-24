from __future__ import annotations

import json
from pathlib import Path

import pytest

from memorixbench import pre_admission, reviewer_packet
from memorixbench.admission import write_admission_review_draft
from memorixbench.pre_admission import PreAdmissionAuditError
from memorixbench.reviewer_packet import (
    ReviewerPacketError,
    audit_reviewer_handoff_packet,
    build_reviewer_handoff_packet,
    load_reviewer_handoff_packet,
)
from memorixbench.source_ledger import SourceAudit, load_source_ledger


RESEARCH_ROOT = Path(__file__).parents[1]
LEDGER_PATH = RESEARCH_ROOT / "cases" / "CANDIDATE-SOURCES.toml"
GUIDE_PATH = RESEARCH_ROOT / "ADMISSION-REVIEWER-GUIDE.md"


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
            entry for entry in ledger.entries  # type: ignore[attr-defined]
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


def test_reviewer_packet_keeps_private_material_out_of_its_manifest(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _stub_source_audit(monkeypatch)
    monkeypatch.setattr(
        reviewer_packet,
        "_git_paths",
        lambda *_args, **_kwargs: ("src/click/core.py", "tests/test_core.py"),
    )
    draft_root = _draft_bundle(tmp_path)
    cache = tmp_path / "source-cache"
    cache.mkdir()
    output = tmp_path / "reviewer-packet"

    packet = build_reviewer_handoff_packet(
        ledger=load_source_ledger(LEDGER_PATH),
        candidate_id="click-help-parameter",
        draft_root=draft_root,
        repository_cache=cache,
        reviewer_guide=GUIDE_PATH,
        packet_id="click-admission-review-v1",
        output=output,
        audited_at_utc="2026-07-24T00:00:00Z",
    )

    manifest = json.loads((output / "PACKET-MANIFEST.json").read_text(encoding="utf-8"))
    assert manifest["reviewer_handoff_packet_sha256"] == packet.sha256
    assert manifest["disposition"] == "private-human-review-only-v1"
    serialized = json.dumps(manifest)
    assert "private transition specification" not in serialized
    assert "private task brief" not in serialized
    assert (output / "PRIVATE-REVIEW-BUNDLE" / "PRIVATE-TRANSITION.md").is_file()
    assert (output / "REVIEWER-WORKSHEET.template.json").is_file()
    dossier = json.loads((output / "PUBLIC-HISTORY-DOSSIER.json").read_text(encoding="utf-8"))
    assert dossier["decision_boundary"] == "non-decisional-public-history-context-v1"
    assert dossier["listed_changed_paths"] == ["src/click/core.py", "tests/test_core.py"]
    assert audit_reviewer_handoff_packet(output) == packet

    (output / "unexpected.txt").write_text("not declared\n", encoding="utf-8")
    with pytest.raises(ReviewerPacketError, match="file tree does not match"):
        audit_reviewer_handoff_packet(output)


def test_reviewer_packet_rejects_duplicate_manifest_paths(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _stub_source_audit(monkeypatch)
    monkeypatch.setattr(
        reviewer_packet,
        "_git_paths",
        lambda *_args, **_kwargs: ("src/click/core.py",),
    )
    draft_root = _draft_bundle(tmp_path)
    cache = tmp_path / "source-cache"
    cache.mkdir()
    output = tmp_path / "reviewer-packet"
    build_reviewer_handoff_packet(
        ledger=load_source_ledger(LEDGER_PATH),
        candidate_id="click-help-parameter",
        draft_root=draft_root,
        repository_cache=cache,
        reviewer_guide=GUIDE_PATH,
        packet_id="click-admission-review-v1",
        output=output,
        audited_at_utc="2026-07-24T00:00:00Z",
    )

    manifest_path = output / "PACKET-MANIFEST.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    files = manifest["files"]
    assert isinstance(files, list) and files
    files.append({"path": files[0]["path"], "sha256": "f" * 64})
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")

    with pytest.raises(ReviewerPacketError, match="contain duplicates"):
        load_reviewer_handoff_packet(manifest_path)


def test_reviewer_packet_rejects_an_output_inside_the_private_draft(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _stub_source_audit(monkeypatch)
    draft_root = _draft_bundle(tmp_path)
    cache = tmp_path / "source-cache"
    cache.mkdir()

    with pytest.raises(ReviewerPacketError, match="outside research, draft, and source trees"):
        build_reviewer_handoff_packet(
            ledger=load_source_ledger(LEDGER_PATH),
            candidate_id="click-help-parameter",
            draft_root=draft_root,
            repository_cache=cache,
            reviewer_guide=GUIDE_PATH,
            packet_id="click-admission-review-v1",
            output=draft_root / "unsafe-output",
        )


def test_reviewer_packet_rejects_an_output_inside_the_research_checkout(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _stub_source_audit(monkeypatch)
    draft_root = _draft_bundle(tmp_path)
    cache = tmp_path / "source-cache"
    cache.mkdir()
    unsafe_output = RESEARCH_ROOT / "reviewer-packet-must-not-be-created"
    assert not unsafe_output.exists()

    with pytest.raises(ReviewerPacketError, match="outside research, draft, and source trees"):
        build_reviewer_handoff_packet(
            ledger=load_source_ledger(LEDGER_PATH),
            candidate_id="click-help-parameter",
            draft_root=draft_root,
            repository_cache=cache,
            reviewer_guide=GUIDE_PATH,
            packet_id="click-admission-review-v1",
            output=unsafe_output,
        )
