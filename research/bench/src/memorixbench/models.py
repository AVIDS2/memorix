from __future__ import annotations

from dataclasses import dataclass
import hashlib
import json
from pathlib import Path
from typing import Any


CASE_CLASSES = frozenset(
    {
        "source-sufficient-control",
        "durable-decision-dependency",
        "stale-conflict",
    }
)
CASE_TIERS = frozenset(
    {
        "synthetic-engineering-smoke",
        "exploratory-source-backed",
        "confirmatory-held-out",
    }
)

OBSERVATION_TYPES = frozenset(
    {
        "session-request",
        "gotcha",
        "problem-solution",
        "how-it-works",
        "what-changed",
        "discovery",
        "why-it-exists",
        "decision",
        "trade-off",
        "reasoning",
        "probe",
    }
)


def sha256_text(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def sha256_tree(root: Path) -> str:
    digest = hashlib.sha256()
    for path in sorted(candidate for candidate in root.rglob("*") if candidate.is_file()):
        if any(part in {".git", ".memorix", ".venv", "__pycache__", ".pytest_cache"} for part in path.parts):
            continue
        relative = path.relative_to(root).as_posix()
        digest.update(relative.encode("utf-8"))
        digest.update(b"\0")
        digest.update(path.read_bytes())
        digest.update(b"\0")
    return digest.hexdigest()


def _safe_relative(value: str, *, field: str) -> str:
    candidate = Path(value)
    if not value or candidate.is_absolute() or ".." in candidate.parts or "\0" in value:
        raise ValueError(f"{field} must be a non-empty relative path")
    return candidate.as_posix()


@dataclass(frozen=True)
class CaseSpec:
    case_id: str
    title: str
    case_class: str
    case_tier: str
    task: str
    source_root: Path
    writable_paths: tuple[str, ...]
    predecessor_record: str
    predecessor_observation_type: str
    predecessor_files: tuple[str, ...]
    predecessor_concepts: tuple[str, ...]
    evidence_char_budget: int

    @classmethod
    def load(cls, path: str | Path) -> "CaseSpec":
        manifest_path = Path(path).resolve()
        data = json.loads(manifest_path.read_text(encoding="utf-8"))
        schema_version = data.get("schema_version")
        if schema_version not in {1, 2}:
            raise ValueError("case schema_version must be 1 or 2")
        case_id = str(data.get("id", "")).strip()
        title = str(data.get("title", "")).strip()
        case_class = str(data.get("case_class", "")).strip()
        case_tier = str(data.get("case_tier", "")).strip()
        task = str(data.get("task", "")).strip()
        record = str(data.get("predecessor_record", "")).strip()
        if not case_id or not title or not task or not record:
            raise ValueError("case id, title, task, and predecessor_record are required")
        if case_class not in CASE_CLASSES:
            choices = ", ".join(sorted(CASE_CLASSES))
            raise ValueError(f"case_class must be one of: {choices}")
        if case_tier not in CASE_TIERS:
            choices = ", ".join(sorted(CASE_TIERS))
            raise ValueError(f"case_tier must be one of: {choices}")
        try:
            evidence_char_budget = int(data.get("evidence_char_budget"))
        except (TypeError, ValueError) as error:
            raise ValueError("evidence_char_budget must be an integer") from error
        if evidence_char_budget < 256 or evidence_char_budget > 24_000:
            raise ValueError("evidence_char_budget must be between 256 and 24000")
        source_relative = _safe_relative(str(data.get("source_root", "")), field="source_root")
        source_root = (manifest_path.parent / source_relative).resolve()
        if not source_root.is_dir() or source_root == manifest_path.parent.resolve() or manifest_path.parent.resolve() not in source_root.parents:
            raise ValueError("source_root must be a directory below the case card")
        raw_writable = data.get("writable_paths")
        if not isinstance(raw_writable, list) or not raw_writable:
            raise ValueError("writable_paths must contain at least one relative path")
        writable_paths = tuple(
            _safe_relative(str(item), field="writable_paths item") for item in raw_writable
        )
        predecessor_memory = data.get("predecessor_memory")
        if schema_version == 1:
            predecessor_observation_type = "discovery"
            predecessor_files: tuple[str, ...] = ()
            predecessor_concepts: tuple[str, ...] = ()
        else:
            if not isinstance(predecessor_memory, dict):
                raise ValueError("schema_version 2 requires a predecessor_memory object")
            predecessor_observation_type = str(predecessor_memory.get("type", "")).strip()
            if predecessor_observation_type not in OBSERVATION_TYPES:
                choices = ", ".join(sorted(OBSERVATION_TYPES))
                raise ValueError(f"predecessor_memory.type must be one of: {choices}")
            raw_files = predecessor_memory.get("files")
            if not isinstance(raw_files, list) or not raw_files:
                raise ValueError("predecessor_memory.files must contain at least one source-relative file")
            predecessor_files = tuple(
                _safe_relative(str(item), field="predecessor_memory.files item") for item in raw_files
            )
            for relative in predecessor_files:
                if not (source_root / relative).is_file():
                    raise ValueError("predecessor_memory.files must name files in source_root")
            raw_concepts = predecessor_memory.get("concepts", [])
            if not isinstance(raw_concepts, list) or any(not isinstance(item, str) or not item.strip() for item in raw_concepts):
                raise ValueError("predecessor_memory.concepts must be a list of non-empty strings")
            predecessor_concepts = tuple(item.strip() for item in raw_concepts)
        return cls(
            case_id=case_id,
            title=title,
            case_class=case_class,
            case_tier=case_tier,
            task=task,
            source_root=source_root,
            writable_paths=writable_paths,
            predecessor_record=record,
            predecessor_observation_type=predecessor_observation_type,
            predecessor_files=predecessor_files,
            predecessor_concepts=predecessor_concepts,
            evidence_char_budget=evidence_char_budget,
        )


@dataclass(frozen=True)
class OracleSpec:
    command: tuple[str, ...]
    timeout_seconds: int
    reveal_output: bool
    definition_sha256: str

    @classmethod
    def load(cls, path: str | Path) -> "OracleSpec":
        oracle_path = Path(path).resolve()
        data: dict[str, Any] = json.loads(oracle_path.read_text(encoding="utf-8"))
        raw_command = data.get("command")
        if not isinstance(raw_command, list) or not raw_command:
            raise ValueError("oracle command must be a non-empty list")
        command = tuple(str(item) for item in raw_command)
        if any(not item or "\0" in item for item in command):
            raise ValueError("oracle command contains an invalid item")
        timeout_seconds = int(data.get("timeout_seconds", 60))
        if timeout_seconds < 1 or timeout_seconds > 600:
            raise ValueError("oracle timeout_seconds must be between 1 and 600")
        reveal_output = bool(data.get("reveal_output", False))
        return cls(
            command=command,
            timeout_seconds=timeout_seconds,
            reveal_output=reveal_output,
            definition_sha256=sha256_file(oracle_path),
        )


@dataclass(frozen=True)
class ToolCall:
    call_id: str
    name: str
    arguments: dict[str, Any]


@dataclass(frozen=True)
class ModelReply:
    content: str | None
    tool_calls: tuple[ToolCall, ...]
    model: str | None
    response_id: str | None
    input_tokens: int | None
    output_tokens: int | None
    cost_usd: float | None


@dataclass(frozen=True)
class ToolEvent:
    name: str
    path: str | None
    success: bool
    content_sha256: str | None = None
    exit_code: int | None = None


def compact_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=True, separators=(",", ":"))
