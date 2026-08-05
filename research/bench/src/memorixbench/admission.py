from __future__ import annotations

from dataclasses import dataclass
import json
from pathlib import Path
import re
from typing import Any

from .models import CASE_CLASSES, CaseSpec, GIT_COMMIT_PATTERN, sha256_file


ADMISSION_SCHEMA_VERSION = 1
PACKET_SCHEMA = "memorixbench-outcome-blind-admission-packet-v1"
_LICENSE_PATTERN = re.compile(r"^[A-Za-z0-9.+-]+$")
_GITHUB_REPOSITORY_PATTERN = re.compile(r"^https://github\.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$")
_FORBIDDEN_MANIFEST_KEYS = frozenset(
    {
        "oracle",
        "oracle_path",
        "oracle_command",
        "reference",
        "reference_patch",
        "reference_repair",
        "receipt",
        "receipt_path",
        "model_output",
        "outcome",
        "result",
    }
)


def _required_text(value: object, *, field: str) -> str:
    text = str(value or "").strip()
    if not text:
        raise ValueError(f"{field} is required")
    return text


def _required_commit(value: object, *, field: str) -> str:
    commit = _required_text(value, field=field).lower()
    if not GIT_COMMIT_PATTERN.fullmatch(commit):
        raise ValueError(f"{field} must be a 40-character lowercase Git commit")
    return commit


def _reject_forbidden_keys(value: object) -> None:
    if isinstance(value, dict):
        for key, child in value.items():
            if str(key).strip().lower() in _FORBIDDEN_MANIFEST_KEYS:
                raise ValueError("admission manifest must not contain private oracle, repair, or outcome fields")
            _reject_forbidden_keys(child)
    elif isinstance(value, list):
        for child in value:
            _reject_forbidden_keys(child)


def _source_relative_file(case: CaseSpec, value: object, *, field: str) -> str:
    raw = _required_text(value, field=field)
    candidate = Path(raw)
    if candidate.is_absolute() or ".." in candidate.parts or "\0" in raw:
        raise ValueError(f"{field} must be a source-relative file")
    resolved = (case.source_root / candidate).resolve()
    if case.source_root not in resolved.parents or not resolved.is_file():
        raise ValueError(f"{field} must name a file in the frozen source tree")
    return resolved.relative_to(case.source_root).as_posix()


def _source_relative_entry(case: CaseSpec, value: object, *, field: str) -> str:
    raw = _required_text(value, field=field)
    candidate = Path(raw)
    if candidate.is_absolute() or ".." in candidate.parts or "\0" in raw:
        raise ValueError(f"{field} must be a source-relative path")
    resolved = (case.source_root / candidate).resolve()
    if case.source_root not in resolved.parents or not resolved.exists():
        raise ValueError(f"{field} must name an entry in the frozen source tree")
    return resolved.relative_to(case.source_root).as_posix()


@dataclass(frozen=True)
class AdmissionSpec:
    candidate_id: str
    repository_url: str
    license_spdx: str
    transfer_base_commit: str
    provenance_kind: str
    public_history_url: str | None
    public_history_note: str
    classification_rationale: str
    frozen_source_scope: tuple[str, ...]
    relevant_current_source_files: tuple[str, ...]
    definition_sha256: str

    @classmethod
    def load(cls, path: str | Path, *, case: CaseSpec) -> "AdmissionSpec":
        manifest_path = Path(path).resolve()
        data: dict[str, Any] = json.loads(manifest_path.read_text(encoding="utf-8"))
        _reject_forbidden_keys(data)
        if data.get("schema_version") != ADMISSION_SCHEMA_VERSION:
            raise ValueError("admission schema_version must be 1")
        candidate_id = _required_text(data.get("candidate_id"), field="candidate_id")
        if candidate_id != case.case_id:
            raise ValueError("admission candidate_id must match case id")
        repository_url = _required_text(data.get("repository_url"), field="repository_url")
        if not _GITHUB_REPOSITORY_PATTERN.fullmatch(repository_url):
            raise ValueError("repository_url must be a canonical GitHub repository URL")
        license_spdx = _required_text(data.get("license_spdx"), field="license_spdx")
        if not _LICENSE_PATTERN.fullmatch(license_spdx):
            raise ValueError("license_spdx must be a SPDX-like identifier")
        transfer_base_commit = _required_commit(
            data.get("transfer_base_commit"), field="transfer_base_commit"
        )
        if transfer_base_commit != case.source_commit:
            raise ValueError("transfer_base_commit must match the frozen source commit")
        provenance_kind = _required_text(data.get("provenance_kind"), field="provenance_kind")
        if provenance_kind not in {"upstream-commit", "benchmark-authored-transition"}:
            raise ValueError("provenance_kind must be upstream-commit or benchmark-authored-transition")
        raw_history_url = data.get("public_history_url")
        public_history_url = None
        if raw_history_url is not None:
            public_history_url = _required_text(raw_history_url, field="public_history_url")
            if not public_history_url.startswith("https://github.com/"):
                raise ValueError("public_history_url must be a GitHub HTTPS URL")
        if provenance_kind == "upstream-commit" and public_history_url is None:
            raise ValueError("upstream-commit provenance requires public_history_url")
        public_history_note = _required_text(
            data.get("public_history_note"), field="public_history_note"
        )
        classification_rationale = _required_text(
            data.get("classification_rationale"), field="classification_rationale"
        )
        raw_scope = data.get("frozen_source_scope")
        if not isinstance(raw_scope, list) or not raw_scope:
            raise ValueError("frozen_source_scope must be a non-empty list")
        frozen_source_scope = tuple(
            _source_relative_entry(case, item, field="frozen_source_scope item")
            for item in raw_scope
        )
        if len(set(frozen_source_scope)) != len(frozen_source_scope):
            raise ValueError("frozen_source_scope must be unique")
        raw_files = data.get("relevant_current_source_files")
        if not isinstance(raw_files, list) or not raw_files:
            raise ValueError("relevant_current_source_files must be a non-empty list")
        files = tuple(
            _source_relative_file(case, item, field="relevant_current_source_files item")
            for item in raw_files
        )
        if len(set(files)) != len(files):
            raise ValueError("relevant_current_source_files must be unique")
        return cls(
            candidate_id=candidate_id,
            repository_url=repository_url,
            license_spdx=license_spdx,
            transfer_base_commit=transfer_base_commit,
            provenance_kind=provenance_kind,
            public_history_url=public_history_url,
            public_history_note=public_history_note,
            classification_rationale=classification_rationale,
            frozen_source_scope=frozen_source_scope,
            relevant_current_source_files=files,
            definition_sha256=sha256_file(manifest_path),
        )

    def packet_payload(self, *, case: CaseSpec) -> dict[str, object]:
        if case.case_class not in CASE_CLASSES:
            raise ValueError("case has an unsupported class")
        return {
            "schema": PACKET_SCHEMA,
            "candidate": {
                "id": case.case_id,
                "title": case.title,
                "proposed_class": case.case_class,
                "tier": case.case_tier,
            },
            "provenance": {
                "repository_url": self.repository_url,
                "license_spdx": self.license_spdx,
                "transfer_base_commit": self.transfer_base_commit,
                "source_tree_sha256": case.source_tree_sha256,
                "source_archive_sha256": case.source_archive_sha256,
                "frozen_source_scope": list(self.frozen_source_scope),
                "provenance_kind": self.provenance_kind,
                "public_history_url": self.public_history_url,
                "public_history_note": self.public_history_note,
            },
            "transfer": {
                "task": case.task,
                "predecessor_record": case.predecessor_record,
                "predecessor_memory": {
                    "type": case.predecessor_observation_type,
                    "files": list(case.predecessor_files),
                    "concepts": list(case.predecessor_concepts),
                },
                "relevant_current_source_files": list(self.relevant_current_source_files),
                "writable_paths": list(case.writable_paths),
                "evidence_char_budget": case.evidence_char_budget,
                "classification_rationale": self.classification_rationale,
            },
            "review_form": {
                "classification": "Select source-sufficient-control, durable-decision-dependency, stale-conflict, or reject.",
                "questions": [
                    "Does the frozen source provide a recoverable reason to accept, ignore, or reject the predecessor record?",
                    "Does the task or predecessor record leak a patch-shaped answer?",
                    "Are provenance, license, source boundary, and writable scope adequate?",
                ],
                "decision": "Record admit, revise, or reject with a short rationale before any outcome is read.",
            },
            "integrity": {
                "case_card_sha256": None,
                "admission_manifest_sha256": self.definition_sha256,
            },
        }


def write_review_packet(
    *, case_path: str | Path, admission_path: str | Path, output_path: str | Path
) -> Path:
    case_file = Path(case_path).resolve()
    case = CaseSpec.load(case_file)
    if case.case_tier == "synthetic-engineering-smoke":
        raise ValueError("admission packets are only for source-backed cases")
    admission = AdmissionSpec.load(admission_path, case=case)
    payload = admission.packet_payload(case=case)
    payload["integrity"]["case_card_sha256"] = sha256_file(case_file)
    rendered = json.dumps(payload, indent=2, sort_keys=True) + "\n"
    output = Path(output_path).resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(rendered, encoding="utf-8", newline="\n")
    return output
