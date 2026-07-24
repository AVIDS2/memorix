"""Private, reproducible handoff packets for independent case admission review."""

from __future__ import annotations

from dataclasses import asdict, dataclass
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import shutil
import stat
import subprocess
import tempfile

from .admission import (
    CaseAdmissionReviewDraft,
    load_admission_review_draft,
    reviewer_worksheet_template,
)
from .pre_admission import (
    PRIVATE_DRAFT_FILENAMES,
    audit_private_draft,
    write_pre_admission_audit,
)
from .public_safety import PublicSafetyError, reject_public_json_payload, reject_public_text
from .source_ledger import SourceLedger, SourceLedgerEntry


REVIEWER_HANDOFF_PACKET_SCHEMA_VERSION = "case-admission-reviewer-handoff-packet-v1"
PUBLIC_HISTORY_DOSSIER_SCHEMA_VERSION = "public-history-review-dossier-v1"
MAX_LISTED_PUBLIC_HISTORY_PATHS = 200
SHA256_PATTERN = re.compile(r"^[0-9a-f]{64}$")


class ReviewerPacketError(ValueError):
    """Raised when a private reviewer packet cannot be built safely."""


@dataclass(frozen=True)
class PublicHistoryDossier:
    """Public-source context that helps a human inspect overlap without deciding it."""

    schema_version: str
    candidate_id: str
    repository_url: str
    base_revision: str
    public_transition_revision: str
    source_urls: tuple[str, ...]
    causal_chain: str
    public_solution_exists: bool
    changed_path_count: int
    listed_changed_paths: tuple[str, ...]
    changed_paths_truncated: bool
    decision_boundary: str
    reviewer_instruction: str

    @property
    def sha256(self) -> str:
        encoded = json.dumps(asdict(self), sort_keys=True, separators=(",", ":"), ensure_ascii=True)
        return hashlib.sha256(encoded.encode("ascii")).hexdigest()

    def public_payload(self) -> dict[str, object]:
        return {
            "schema_version": self.schema_version,
            "candidate_id": self.candidate_id,
            "repository_url": self.repository_url,
            "base_revision": self.base_revision,
            "public_transition_revision": self.public_transition_revision,
            "source_urls": list(self.source_urls),
            "causal_chain": self.causal_chain,
            "public_solution_exists": self.public_solution_exists,
            "changed_path_count": self.changed_path_count,
            "listed_changed_paths": list(self.listed_changed_paths),
            "changed_paths_truncated": self.changed_paths_truncated,
            "decision_boundary": self.decision_boundary,
            "reviewer_instruction": self.reviewer_instruction,
            "public_history_dossier_sha256": self.sha256,
        }


@dataclass(frozen=True)
class ReviewerHandoffPacket:
    """An external private packet; its manifest carries commitments, not conclusions."""

    schema_version: str
    packet_id: str
    candidate_id: str
    admission_review_draft_sha256: str
    pre_admission_audit_sha256: str
    public_history_dossier_sha256: str
    files: tuple[tuple[str, str], ...]
    disposition: str

    def _payload_without_hash(self) -> dict[str, object]:
        return {
            "schema_version": self.schema_version,
            "packet_id": self.packet_id,
            "candidate_id": self.candidate_id,
            "admission_review_draft_sha256": self.admission_review_draft_sha256,
            "pre_admission_audit_sha256": self.pre_admission_audit_sha256,
            "public_history_dossier_sha256": self.public_history_dossier_sha256,
            "files": [
                {"path": relative_path, "sha256": digest}
                for relative_path, digest in self.files
            ],
            "disposition": self.disposition,
        }

    @property
    def sha256(self) -> str:
        encoded = json.dumps(
            self._payload_without_hash(),
            sort_keys=True,
            separators=(",", ":"),
            ensure_ascii=True,
        )
        return hashlib.sha256(encoded.encode("ascii")).hexdigest()

    def public_payload(self) -> dict[str, object]:
        return {
            **self._payload_without_hash(),
            "reviewer_handoff_packet_sha256": self.sha256,
        }


def _is_reparse_point(metadata: object) -> bool:
    attributes = getattr(metadata, "st_file_attributes", 0)
    flag = getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0x400)
    return bool(attributes & flag)


def _require_regular_directory(path: Path, *, label: str) -> Path:
    try:
        metadata = path.lstat()
    except OSError as error:
        raise ReviewerPacketError(f"{label} cannot be read") from error
    if path.is_symlink() or _is_reparse_point(metadata) or not stat.S_ISDIR(metadata.st_mode):
        raise ReviewerPacketError(f"{label} must be a regular directory")
    return path.resolve()


def _require_regular_file(path: Path, *, label: str) -> Path:
    try:
        metadata = path.lstat()
    except OSError as error:
        raise ReviewerPacketError(f"{label} cannot be read") from error
    if path.is_symlink() or _is_reparse_point(metadata) or not stat.S_ISREG(metadata.st_mode):
        raise ReviewerPacketError(f"{label} must be a regular file")
    return path


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _candidate(ledger: SourceLedger, candidate_id: str) -> SourceLedgerEntry:
    candidate = next((item for item in ledger.entries if item.candidate_id == candidate_id), None)
    if candidate is None:
        raise ReviewerPacketError(f"unknown source candidate: {candidate_id}")
    return candidate


def _git_paths(repository_cache: Path, *, base_revision: str, public_transition_revision: str) -> tuple[str, ...]:
    try:
        completed = subprocess.run(
            [
                "git",
                "-C",
                str(repository_cache),
                "diff",
                "--name-only",
                "--no-renames",
                "-z",
                f"{base_revision}..{public_transition_revision}",
            ],
            check=False,
            capture_output=True,
        )
    except OSError as error:
        raise ReviewerPacketError("public history cannot be inspected") from error
    if completed.returncode != 0:
        raise ReviewerPacketError("public history cannot be inspected")
    try:
        paths = tuple(
            sorted(
                item.decode("utf-8")
                for item in completed.stdout.split(b"\0")
                if item
            )
        )
    except UnicodeDecodeError as error:
        raise ReviewerPacketError("public history paths are not UTF-8") from error
    if not paths:
        raise ReviewerPacketError("public transition has no changed paths")
    return paths


def build_public_history_dossier(
    candidate: SourceLedgerEntry,
    *,
    repository_cache: str | Path,
) -> PublicHistoryDossier:
    """Summarize public diff paths only; semantic overlap remains a human decision."""

    cache = _require_regular_directory(Path(repository_cache), label="source repository cache")
    paths = _git_paths(
        cache,
        base_revision=candidate.base_revision,
        public_transition_revision=candidate.public_transition_revision,
    )
    return PublicHistoryDossier(
        schema_version=PUBLIC_HISTORY_DOSSIER_SCHEMA_VERSION,
        candidate_id=candidate.candidate_id,
        repository_url=candidate.repository_url,
        base_revision=candidate.base_revision,
        public_transition_revision=candidate.public_transition_revision,
        source_urls=candidate.source_urls,
        causal_chain=candidate.causal_chain,
        public_solution_exists=candidate.public_solution_exists,
        changed_path_count=len(paths),
        listed_changed_paths=paths[:MAX_LISTED_PUBLIC_HISTORY_PATHS],
        changed_paths_truncated=len(paths) > MAX_LISTED_PUBLIC_HISTORY_PATHS,
        decision_boundary="non-decisional-public-history-context-v1",
        reviewer_instruction=(
            "This dossier lists public history paths only. It does not establish semantic novelty, "
            "behavioral non-isomorphism, predecessor dependence, or current-source insufficiency. "
            "Reviewers must inspect the full public history and the committed private bundle themselves."
        ),
    )


def _write_json(path: Path, payload: dict[str, object], *, label: str) -> None:
    try:
        reject_public_json_payload(payload)
    except PublicSafetyError as error:
        raise ReviewerPacketError(f"{label} is unsafe") from error
    path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def _private_readme(draft: CaseAdmissionReviewDraft) -> str:
    return "\n".join((
        "# Private Admission Review Packet",
        "",
        "This directory contains private case-design material for independent human review.",
        "It is not a public artifact, a benchmark case, or evidence that Memorix helps an agent.",
        "Do not upload this directory, its private bundle, or reviewer rationales to a public issue,",
        "repository, paper supplement, or model prompt.",
        "",
        f"Candidate: `{draft.candidate_id}`",
        f"Admission draft SHA-256: `{draft.sha256}`",
        "",
        "Each reviewer works independently, completes a private worksheet, and then gives the",
        "organizer only the worksheet SHA-256 plus a public receipt finding. A receipt approval",
        "permits later case authoring only; it never creates confirmatory evidence.",
        "",
    ))


def _organizer_checklist() -> str:
    return "\n".join((
        "# Review Organizer Checklist",
        "",
        "1. Give each reviewer a separate copy before either reviewer sees the other's view.",
        "2. Verify both reviewers are independent humans and neither is the case author.",
        "3. Require a completed private worksheet from each reviewer before collecting a receipt.",
        "4. Validate each worksheet against `ADMISSION-REVIEW-DRAFT.json`.",
        "5. Build the public hash-only receipt only when both worksheets affirm every required finding.",
        "6. Treat any disagreement, low-confidence finding, or current-source-sufficient judgment as no approval.",
        "7. Keep worksheets and private rationales with the organizer; publish only the hash-only receipt.",
        "",
    ))


def _calibration_cards() -> str:
    return "\n".join((
        "# Rubric Calibration Cards",
        "",
        "These are teaching cases, not benchmark tasks and not evidence.",
        "",
        "## public-answer-restatement-v1",
        "A proposed private task asks for the exact observable behavior already stated in a public test",
        "and the current source plus that test fully reveals the fix. Classify it as `current-source-sufficient`.",
        "",
        "## durable-predecessor-constraint-v1",
        "A precursor discovered a compatibility constraint through an allowed investigation. The later private",
        "task requires preserving that constraint after adjacent source evolves, while neither current source nor",
        "public tests reveal the constraint. Classify it as `predecessor-dependent`.",
        "",
        "## ambiguous-current-source-v1",
        "A draft says it depends on prior work but does not establish whether current source or public tests already",
        "reveal the answer. Classify it as `needs-redraft`, not as a positive memory-dependent case.",
        "",
    ))


def _target_directory(
    output: str | Path,
    *,
    research_root: Path,
    draft_root: Path,
    repository_cache: Path,
) -> Path:
    target = Path(output).resolve()
    forbidden_roots = (research_root.resolve(), draft_root.resolve(), repository_cache.resolve())
    if any(target == root or root in target.parents for root in forbidden_roots):
        raise ReviewerPacketError("reviewer packet output must be outside research, draft, and source trees")
    if target.exists():
        raise ReviewerPacketError("reviewer packet output already exists")
    target.parent.mkdir(parents=True, exist_ok=True)
    _require_regular_directory(target.parent, label="reviewer packet parent")
    return target


def _research_root(ledger: SourceLedger) -> Path:
    source_ledger = _require_regular_file(ledger.source_path, label="source ledger")
    cases_root = source_ledger.parent.resolve()
    research_root = cases_root.parent
    if cases_root.name != "cases" or not (research_root / "src" / "memorixbench").is_dir():
        raise ReviewerPacketError("source ledger must belong to a MemorixBench research checkout")
    return research_root


def _packet_files(root: Path) -> tuple[tuple[str, str], ...]:
    files: list[tuple[str, str]] = []
    for path in sorted(root.rglob("*")):
        if not path.is_file():
            continue
        relative = path.relative_to(root).as_posix()
        if relative == "PACKET-MANIFEST.json":
            continue
        _require_regular_file(path, label="reviewer packet file")
        files.append((relative, _sha256(path)))
    return tuple(files)


def _packet_file_entries(value: object) -> tuple[tuple[str, str], ...]:
    if not isinstance(value, list) or not value:
        raise ReviewerPacketError("reviewer packet files must be a non-empty list")
    entries: list[tuple[str, str]] = []
    for item in value:
        if not isinstance(item, dict) or set(item) != {"path", "sha256"}:
            raise ReviewerPacketError("reviewer packet file entry has an unsupported schema")
        relative = item.get("path")
        digest = item.get("sha256")
        if not isinstance(relative, str) or not relative:
            raise ReviewerPacketError("reviewer packet file path is invalid")
        path = PurePosixPath(relative)
        if path.is_absolute() or any(part in {"", ".", ".."} for part in path.parts):
            raise ReviewerPacketError("reviewer packet file path escapes the packet")
        if not isinstance(digest, str) or not SHA256_PATTERN.fullmatch(digest):
            raise ReviewerPacketError("reviewer packet file hash is invalid")
        entries.append((path.as_posix(), digest))
    relative_paths = [relative_path for relative_path, _digest in entries]
    if len(relative_paths) != len(set(relative_paths)):
        raise ReviewerPacketError("reviewer packet file entries contain duplicates")
    return tuple(entries)


def load_reviewer_handoff_packet(path: str | Path) -> ReviewerHandoffPacket:
    """Load and hash-verify the manifest for one private reviewer packet."""

    manifest = _require_regular_file(Path(path), label="reviewer packet manifest")
    try:
        raw = json.loads(manifest.read_text(encoding="utf-8"))
        reject_public_json_payload(raw)
    except (OSError, UnicodeDecodeError, json.JSONDecodeError, PublicSafetyError) as error:
        raise ReviewerPacketError("reviewer packet manifest cannot be read safely") from error
    if not isinstance(raw, dict):
        raise ReviewerPacketError("reviewer packet manifest must be an object")
    expected = {
        "schema_version",
        "packet_id",
        "candidate_id",
        "admission_review_draft_sha256",
        "pre_admission_audit_sha256",
        "public_history_dossier_sha256",
        "files",
        "disposition",
        "reviewer_handoff_packet_sha256",
    }
    if set(raw) != expected or raw.get("schema_version") != REVIEWER_HANDOFF_PACKET_SCHEMA_VERSION:
        raise ReviewerPacketError("reviewer packet manifest has an unsupported schema")
    scalar_fields = (
        "packet_id",
        "candidate_id",
        "admission_review_draft_sha256",
        "pre_admission_audit_sha256",
        "public_history_dossier_sha256",
        "disposition",
        "reviewer_handoff_packet_sha256",
    )
    if any(not isinstance(raw.get(name), str) or not raw[name] for name in scalar_fields):
        raise ReviewerPacketError("reviewer packet manifest has invalid scalar fields")
    for name in (
        "admission_review_draft_sha256",
        "pre_admission_audit_sha256",
        "public_history_dossier_sha256",
        "reviewer_handoff_packet_sha256",
    ):
        if not SHA256_PATTERN.fullmatch(raw[name]):
            raise ReviewerPacketError("reviewer packet manifest has an invalid commitment")
    packet = ReviewerHandoffPacket(
        schema_version=REVIEWER_HANDOFF_PACKET_SCHEMA_VERSION,
        packet_id=raw["packet_id"],
        candidate_id=raw["candidate_id"],
        admission_review_draft_sha256=raw["admission_review_draft_sha256"],
        pre_admission_audit_sha256=raw["pre_admission_audit_sha256"],
        public_history_dossier_sha256=raw["public_history_dossier_sha256"],
        files=_packet_file_entries(raw.get("files")),
        disposition=raw["disposition"],
    )
    if packet.sha256 != raw["reviewer_handoff_packet_sha256"]:
        raise ReviewerPacketError("reviewer packet manifest hash does not match its contents")
    return packet


def audit_reviewer_handoff_packet(root: str | Path) -> ReviewerHandoffPacket:
    """Fail closed on missing, changed, or undeclared packet files."""

    packet_root = _require_regular_directory(Path(root), label="reviewer packet root")
    packet = load_reviewer_handoff_packet(packet_root / "PACKET-MANIFEST.json")
    observed = _packet_files(packet_root)
    if observed != packet.files:
        raise ReviewerPacketError("reviewer packet file tree does not match its manifest")
    return packet


def _verify_private_bundle(stage: Path, *, draft: CaseAdmissionReviewDraft) -> None:
    expected = {
        "PRIVATE-TRANSITION.md": draft.private_transition_commitment_sha256,
        "PRIVATE-TASK-BRIEF.md": draft.private_task_brief_sha256,
        "PUBLIC-HISTORY-COMPARISON.md": draft.public_history_comparison_sha256,
    }
    private_bundle = stage / "PRIVATE-REVIEW-BUNDLE"
    for filename, digest in expected.items():
        copied = _require_regular_file(private_bundle / filename, label="copied private draft file")
        if _sha256(copied) != digest:
            raise ReviewerPacketError("private draft changed while the reviewer packet was built")
    try:
        copied_draft = load_admission_review_draft(private_bundle / "ADMISSION-REVIEW-DRAFT.json")
    except ValueError as error:
        raise ReviewerPacketError("copied admission review draft is invalid") from error
    if copied_draft != draft:
        raise ReviewerPacketError("private draft changed while the reviewer packet was built")


def build_reviewer_handoff_packet(
    *,
    ledger: SourceLedger,
    candidate_id: str,
    draft_root: str | Path,
    repository_cache: str | Path,
    reviewer_guide: str | Path,
    packet_id: str,
    output: str | Path,
    audited_at_utc: str | None = None,
) -> ReviewerHandoffPacket:
    """Create one external private packet after mechanical pre-admission passes."""

    candidate = _candidate(ledger, candidate_id)
    draft_directory = _require_regular_directory(Path(draft_root), label="private draft root")
    cache = _require_regular_directory(Path(repository_cache), label="source repository cache")
    guide_path = _require_regular_file(Path(reviewer_guide), label="reviewer guide")
    try:
        guide_text = guide_path.read_text(encoding="utf-8")
        reject_public_text(guide_text)
    except (OSError, UnicodeDecodeError, PublicSafetyError) as error:
        raise ReviewerPacketError("reviewer guide is unsafe") from error
    target = _target_directory(
        output,
        research_root=_research_root(ledger),
        draft_root=draft_directory,
        repository_cache=cache,
    )
    audit = audit_private_draft(
        ledger=ledger,
        candidate_id=candidate_id,
        draft_root=draft_directory,
        repository_cache=cache,
        audited_at_utc=audited_at_utc,
    )
    draft = load_admission_review_draft(draft_directory / "ADMISSION-REVIEW-DRAFT.json")
    dossier = build_public_history_dossier(candidate, repository_cache=cache)

    stage = Path(tempfile.mkdtemp(prefix=".memorixbench-reviewer-packet-", dir=target.parent))
    try:
        private_bundle = stage / "PRIVATE-REVIEW-BUNDLE"
        private_bundle.mkdir()
        for filename in PRIVATE_DRAFT_FILENAMES:
            source = _require_regular_file(draft_directory / filename, label="private draft file")
            shutil.copyfile(source, private_bundle / filename)
        _verify_private_bundle(stage, draft=draft)
        (stage / "README.md").write_text(_private_readme(draft), encoding="utf-8")
        (stage / "REVIEW-ORGANIZER-CHECKLIST.md").write_text(
            _organizer_checklist(),
            encoding="utf-8",
        )
        (stage / "RUBRIC-CALIBRATION-CARDS.md").write_text(
            _calibration_cards(),
            encoding="utf-8",
        )
        (stage / "ADMISSION-REVIEWER-GUIDE.md").write_text(guide_text, encoding="utf-8")
        _write_json(
            stage / "PUBLIC-HISTORY-DOSSIER.json",
            dossier.public_payload(),
            label="public history dossier",
        )
        _write_json(
            stage / "REVIEWER-WORKSHEET.template.json",
            reviewer_worksheet_template(draft),
            label="reviewer worksheet template",
        )
        write_pre_admission_audit(audit, output=stage / "PRE-ADMISSION-AUDIT.json")

        packet = ReviewerHandoffPacket(
            schema_version=REVIEWER_HANDOFF_PACKET_SCHEMA_VERSION,
            packet_id=packet_id,
            candidate_id=candidate_id,
            admission_review_draft_sha256=draft.sha256,
            pre_admission_audit_sha256=audit.sha256,
            public_history_dossier_sha256=dossier.sha256,
            files=_packet_files(stage),
            disposition="private-human-review-only-v1",
        )
        _write_json(stage / "PACKET-MANIFEST.json", packet.public_payload(), label="packet manifest")
        stage.rename(target)
    except BaseException:
        shutil.rmtree(stage, ignore_errors=True)
        raise
    return packet
