from __future__ import annotations

from dataclasses import dataclass
import json
from pathlib import Path
import shutil
from typing import Any

from .admission import write_review_packet
from .models import CaseSpec, SHA256_PATTERN, sha256_file
from .review import ReviewForm, write_review_form


REVISION_SCHEMA = "memorixbench-case-bank-revision-v1"
REVISION_RECEIPT_SCHEMA = "memorixbench-case-bank-revision-receipt-v1"


@dataclass(frozen=True)
class _TaskRevision:
    case_id: str
    base_case_card_sha256: str
    task: str
    rationale: str


def _repository_root() -> Path:
    return Path(__file__).resolve().parents[4]


def _repository_relative_path(value: object, *, field: str) -> Path:
    raw = str(value or "").strip()
    candidate = Path(raw)
    root = _repository_root()
    if not raw or candidate.is_absolute() or ".." in candidate.parts:
        raise ValueError(f"{field} must be a non-empty repository-relative path")
    resolved = (root / candidate).resolve()
    if resolved != root and root not in resolved.parents:
        raise ValueError(f"{field} must stay inside the repository")
    return resolved


def _artifact_path(value: object, *, field: str) -> Path:
    path = _repository_relative_path(value, field=field)
    root = (_repository_root() / "research" / "artifacts").resolve()
    if path != root and root not in path.parents:
        raise ValueError(f"{field} must stay below research/artifacts")
    return path


def _read_object(path: Path, *, label: str) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as error:
        raise ValueError(f"{label} must be valid JSON") from error
    if not isinstance(value, dict):
        raise ValueError(f"{label} must be a JSON object")
    return value


def _write_object(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n", encoding="utf-8", newline="\n")


def _revision(value: object) -> _TaskRevision:
    if not isinstance(value, dict):
        raise ValueError("revision entries must be JSON objects")
    case_id = str(value.get("case_id", "")).strip()
    digest = str(value.get("base_case_card_sha256", "")).strip().lower()
    task = str(value.get("task", "")).strip()
    rationale = str(value.get("rationale", "")).strip()
    if not case_id or not task or len(rationale) < 30:
        raise ValueError("every revision requires a case_id, task, and specific rationale")
    if not SHA256_PATTERN.fullmatch(digest):
        raise ValueError("base_case_card_sha256 must be a lowercase SHA-256 digest")
    return _TaskRevision(
        case_id=case_id,
        base_case_card_sha256=digest,
        task=task,
        rationale=rationale,
    )


def _reviewer_codes(value: object) -> tuple[str, ...]:
    if not isinstance(value, list) or len(value) not in {2, 3}:
        raise ValueError("reviewer_codes must contain two or three reviewer codes")
    codes = tuple(str(item).strip() for item in value)
    if len(set(codes)) != len(codes) or any(not code for code in codes):
        raise ValueError("reviewer_codes must be distinct and non-empty")
    return codes


def _case_dirs(case_bank: Path) -> list[Path]:
    if not case_bank.is_dir():
        raise ValueError("parent case bank must be an existing directory")
    directories = sorted(path for path in case_bank.iterdir() if path.is_dir())
    if not directories:
        raise ValueError("parent case bank has no case directories")
    for directory in directories:
        if not (directory / "case.json").is_file() or not (directory / "admission.json").is_file():
            raise ValueError(f"parent case {directory.name} is missing case.json or admission.json")
        case = CaseSpec.load(directory / "case.json")
        if case.case_id != directory.name:
            raise ValueError("parent case directory name must match the case card id")
    return directories


def _relative_to_repository(path: Path) -> str:
    return path.resolve().relative_to(_repository_root()).as_posix()


def prepare_case_revision(*, manifest_path: str | Path) -> dict[str, object]:
    """Create an immutable revised case-bank review set before any outcomes exist."""
    manifest_file = Path(manifest_path).resolve()
    repository = _repository_root()
    if manifest_file != repository and repository not in manifest_file.parents:
        raise ValueError("revision manifest must stay inside the repository")
    manifest = _read_object(manifest_file, label="revision manifest")
    if manifest.get("schema_version") != REVISION_SCHEMA:
        raise ValueError("revision manifest has an unsupported schema")

    revision_id = str(manifest.get("revision_id", "")).strip()
    if not revision_id:
        raise ValueError("revision manifest requires revision_id")
    reviewers = _reviewer_codes(manifest.get("reviewer_codes"))
    parent = manifest.get("parent")
    output = manifest.get("output")
    revisions_value = manifest.get("revisions")
    if not isinstance(parent, dict) or not isinstance(output, dict) or not isinstance(revisions_value, list):
        raise ValueError("revision manifest requires parent, output, and revisions objects")

    parent_case_bank = _artifact_path(parent.get("case_bank"), field="parent.case_bank")
    parent_packets = _artifact_path(parent.get("review_packets"), field="parent.review_packets")
    parent_forms = _artifact_path(parent.get("review_forms"), field="parent.review_forms")
    output_case_bank = _artifact_path(output.get("case_bank"), field="output.case_bank")
    output_packets = _artifact_path(output.get("review_packets"), field="output.review_packets")
    output_forms = _artifact_path(output.get("review_forms"), field="output.review_forms")
    output_receipt = _artifact_path(output.get("receipt"), field="output.receipt")
    outputs = (output_case_bank, output_packets, output_forms, output_receipt)
    if any(path.exists() for path in outputs):
        raise ValueError("revision output already exists; immutable revision artifacts are never overwritten")
    if not parent_packets.is_dir() or not parent_forms.is_dir():
        raise ValueError("parent review packets and forms must be existing directories")

    revisions = tuple(_revision(item) for item in revisions_value)
    revision_by_case = {item.case_id: item for item in revisions}
    if len(revision_by_case) != len(revisions):
        raise ValueError("each case may be revised at most once")

    case_dirs = _case_dirs(parent_case_bank)
    case_ids = {directory.name for directory in case_dirs}
    if not set(revision_by_case).issubset(case_ids):
        raise ValueError("revision manifest names a case absent from the parent case bank")

    for case_id, revision in revision_by_case.items():
        case_path = parent_case_bank / case_id / "case.json"
        if sha256_file(case_path) != revision.base_case_card_sha256:
            raise ValueError(f"base case card hash does not match for {case_id}")

    for code in reviewers:
        for case_dir in case_dirs:
            packet = parent_packets / f"{case_dir.name}.json"
            form = parent_forms / code / packet.name
            if not packet.is_file() or not form.is_file():
                raise ValueError(f"parent review set is incomplete for {code}/{case_dir.name}")
            review = ReviewForm.load(form, packet_path=packet)
            if review.reviewer_code != code:
                raise ValueError(f"parent review form reviewer code does not match {code}/{case_dir.name}")

    output_case_bank.parent.mkdir(parents=True, exist_ok=True)
    for case_dir in case_dirs:
        shutil.copytree(case_dir, output_case_bank / case_dir.name)

    for case_id, revision in revision_by_case.items():
        case_path = output_case_bank / case_id / "case.json"
        case = _read_object(case_path, label=f"copied case card {case_id}")
        case["task"] = revision.task
        _write_object(case_path, case)

    case_receipts: list[dict[str, object]] = []
    for case_dir in case_dirs:
        case_id = case_dir.name
        parent_case_path = parent_case_bank / case_id / "case.json"
        revised_case_path = output_case_bank / case_id / "case.json"
        CaseSpec.load(revised_case_path)
        parent_packet = parent_packets / f"{case_id}.json"
        revised_packet = write_review_packet(
            case_path=revised_case_path,
            admission_path=output_case_bank / case_id / "admission.json",
            output_path=output_packets / parent_packet.name,
        )
        revised = revision_by_case.get(case_id)
        if revised is None and parent_packet.read_bytes() != revised_packet.read_bytes():
            raise ValueError(f"unrevised review packet drifted for {case_id}")

        form_status = "pending-re-review" if revised is not None else "reused"
        for code in reviewers:
            parent_form = parent_forms / code / parent_packet.name
            revised_form = output_forms / code / parent_packet.name
            if revised is None:
                revised_form.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(parent_form, revised_form)
                ReviewForm.load(revised_form, packet_path=revised_packet)
            else:
                write_review_form(
                    packet_path=revised_packet,
                    reviewer_code=code,
                    output_path=revised_form,
                )
        case_receipts.append(
            {
                "case_id": case_id,
                "status": "revised" if revised is not None else "preserved",
                "base_case_card_sha256": sha256_file(parent_case_path),
                "revised_case_card_sha256": sha256_file(revised_case_path),
                "base_packet_sha256": sha256_file(parent_packet),
                "revised_packet_sha256": sha256_file(revised_packet),
                "review_form_status": form_status,
            }
        )

    receipt = {
        "schema_version": REVISION_RECEIPT_SCHEMA,
        "revision_id": revision_id,
        "outcomes_seen": False,
        "manifest_sha256": sha256_file(manifest_file),
        "reviewer_codes": list(reviewers),
        "parent": {
            "case_bank": _relative_to_repository(parent_case_bank),
            "review_packets": _relative_to_repository(parent_packets),
            "review_forms": _relative_to_repository(parent_forms),
        },
        "output": {
            "case_bank": _relative_to_repository(output_case_bank),
            "review_packets": _relative_to_repository(output_packets),
            "review_forms": _relative_to_repository(output_forms),
        },
        "cases": case_receipts,
    }
    _write_object(output_receipt, receipt)
    return {
        "revision_id": revision_id,
        "case_count": len(case_receipts),
        "revised_case_count": len(revision_by_case),
        "pending_re_review_case_ids": sorted(revision_by_case),
        "receipt": str(output_receipt),
    }
