from __future__ import annotations

from dataclasses import dataclass
from datetime import date
import hashlib
import json
from math import isfinite
from pathlib import Path
import re
from typing import Any
import zipfile


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
SHA256_PATTERN = re.compile(r"^[0-9a-f]{64}$")
GIT_COMMIT_PATTERN = re.compile(r"^[0-9a-f]{40}$")
IGNORED_TREE_PARTS = frozenset({".git", ".memorix", ".venv", "__pycache__", ".pytest_cache"})


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
    files = sorted(
        (
            (path.relative_to(root).as_posix(), path)
            for path in root.rglob("*")
            if path.is_file()
        ),
        key=lambda item: item[0],
    )
    for relative, path in files:
        if any(part in IGNORED_TREE_PARTS for part in path.parts):
            continue
        digest.update(relative.encode("utf-8"))
        digest.update(b"\0")
        digest.update(path.read_bytes())
        digest.update(b"\0")
    return digest.hexdigest()


def sha256_zip_tree(archive: Path, archive_root: str) -> str:
    """Hash a ZIP snapshot as the source tree rooted at ``archive_root``."""
    if not archive_root or "/" in archive_root or "\\" in archive_root:
        raise ValueError("source_archive_root must be one safe ZIP directory name")
    members: dict[str, zipfile.ZipInfo] = {}
    try:
        with zipfile.ZipFile(archive) as bundle:
            for info in bundle.infolist():
                name = info.filename
                if info.is_dir():
                    continue
                parts = name.split("/")
                if (
                    not name
                    or "\\" in name
                    or name.startswith("/")
                    or any(part in {"", ".", ".."} for part in parts)
                    or parts[0] != archive_root
                ):
                    raise ValueError("source_archive contains an unsafe or unexpected member path")
                if len(parts) == 1:
                    raise ValueError("source_archive contains a file at the archive root")
                mode = info.external_attr >> 16
                if mode and (mode & 0o170000) == 0o120000:
                    raise ValueError("source_archive must not contain symbolic links")
                relative = "/".join(parts[1:])
                if any(part in IGNORED_TREE_PARTS for part in parts[1:]):
                    continue
                if relative in members:
                    raise ValueError("source_archive contains duplicate member paths")
                members[relative] = info
            digest = hashlib.sha256()
            for relative, info in sorted(members.items()):
                digest.update(relative.encode("utf-8"))
                digest.update(b"\0")
                with bundle.open(info) as handle:
                    for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                        digest.update(chunk)
                digest.update(b"\0")
            return digest.hexdigest()
    except zipfile.BadZipFile as error:
        raise ValueError("source_archive must be a valid ZIP snapshot") from error


def _safe_relative(value: str, *, field: str) -> str:
    candidate = Path(value)
    if not value or candidate.is_absolute() or ".." in candidate.parts or "\0" in value:
        raise ValueError(f"{field} must be a non-empty relative path")
    return candidate.as_posix()


def _required_sha256(value: object, *, field: str) -> str:
    digest = str(value or "").strip().lower()
    if not SHA256_PATTERN.fullmatch(digest):
        raise ValueError(f"{field} must be a lowercase SHA-256 digest")
    return digest


def _required_git_commit(value: object, *, field: str) -> str:
    commit = str(value or "").strip().lower()
    if not GIT_COMMIT_PATTERN.fullmatch(commit):
        raise ValueError(f"{field} must be a 40-character lowercase Git commit")
    return commit


def _is_nonnegative_int(value: object) -> bool:
    return isinstance(value, int) and not isinstance(value, bool) and value >= 0


def _is_nonnegative_finite_number(value: object) -> bool:
    return (
        isinstance(value, (int, float))
        and not isinstance(value, bool)
        and isfinite(float(value))
        and float(value) >= 0
    )


@dataclass(frozen=True)
class CaseSpec:
    case_id: str
    title: str
    case_class: str
    case_tier: str
    task: str
    source_root: Path
    source_tree_sha256: str | None
    source_commit: str | None
    source_archive_path: Path | None
    source_archive_sha256: str | None
    source_archive_root: str | None
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
        if schema_version not in {1, 2, 3, 4}:
            raise ValueError("case schema_version must be 1, 2, 3, or 4")
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
        source_tree_sha256: str | None = None
        source_commit: str | None = None
        source_archive_path: Path | None = None
        source_archive_sha256: str | None = None
        source_archive_root: str | None = None
        if schema_version == 4:
            source_tree_sha256 = _required_sha256(
                data.get("source_tree_sha256"),
                field="source_tree_sha256",
            )
            source_commit = _required_git_commit(
                data.get("source_commit"),
                field="source_commit",
            )
            archive_relative = _safe_relative(
                str(data.get("source_archive", "")),
                field="source_archive",
            )
            source_archive_path = (manifest_path.parent / archive_relative).resolve()
            if (
                not source_archive_path.is_file()
                or source_archive_path == manifest_path.parent.resolve()
                or manifest_path.parent.resolve() not in source_archive_path.parents
            ):
                raise ValueError("source_archive must be a file below the case card")
            source_archive_sha256 = _required_sha256(
                data.get("source_archive_sha256"),
                field="source_archive_sha256",
            )
            if sha256_file(source_archive_path) != source_archive_sha256:
                raise ValueError("source_archive does not match source_archive_sha256")
            if sha256_tree(source_root) != source_tree_sha256:
                raise ValueError("source_root does not match source_tree_sha256")
            if schema_version == 4:
                source_archive_root = _safe_relative(
                    str(data.get("source_archive_root", "")),
                    field="source_archive_root",
                )
                if "/" in source_archive_root or source_root.name != source_archive_root:
                    raise ValueError("source_archive_root must match the source_root directory name")
                if sha256_zip_tree(source_archive_path, source_archive_root) != source_tree_sha256:
                    raise ValueError("source_archive contents do not match source_tree_sha256")
        elif case_tier in {"exploratory-source-backed", "confirmatory-held-out"}:
            raise ValueError("source-backed cases require schema_version 4 snapshot identity")
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
            source_tree_sha256=source_tree_sha256,
            source_commit=source_commit,
            source_archive_path=source_archive_path,
            source_archive_sha256=source_archive_sha256,
            source_archive_root=source_archive_root,
            writable_paths=writable_paths,
            predecessor_record=record,
            predecessor_observation_type=predecessor_observation_type,
            predecessor_files=predecessor_files,
            predecessor_concepts=predecessor_concepts,
            evidence_char_budget=evidence_char_budget,
        )


@dataclass(frozen=True)
class OracleAsset:
    relative_path: str
    path: Path
    sha256: str


@dataclass(frozen=True)
class OracleSpec:
    command: tuple[str, ...]
    timeout_seconds: int
    reveal_output: bool
    definition_sha256: str
    oracle_root: Path
    assets: tuple[OracleAsset, ...]
    assets_sha256: str | None

    @classmethod
    def load(cls, path: str | Path) -> "OracleSpec":
        oracle_path = Path(path).resolve()
        data: dict[str, Any] = json.loads(oracle_path.read_text(encoding="utf-8"))
        schema_version = data.get("schema_version", 1)
        if schema_version not in {1, 2}:
            raise ValueError("oracle schema_version must be 1 or 2")
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
        raw_assets = data.get("assets", [])
        if not isinstance(raw_assets, list):
            raise ValueError("oracle assets must be a list")
        if schema_version == 2 and not raw_assets:
            raise ValueError("oracle schema_version 2 requires at least one asset")
        assets: list[OracleAsset] = []
        seen_assets: set[str] = set()
        for raw_asset in raw_assets:
            if not isinstance(raw_asset, dict):
                raise ValueError("oracle asset must be an object")
            relative = _safe_relative(str(raw_asset.get("path", "")), field="oracle asset path")
            if relative in seen_assets:
                raise ValueError("oracle asset paths must be unique")
            seen_assets.add(relative)
            asset_path = (oracle_path.parent / relative).resolve()
            if asset_path == oracle_path.parent or oracle_path.parent not in asset_path.parents or not asset_path.is_file():
                raise ValueError("oracle asset must be a file below the oracle manifest")
            digest = _required_sha256(raw_asset.get("sha256"), field="oracle asset sha256")
            if sha256_file(asset_path) != digest:
                raise ValueError("oracle asset does not match its declared SHA-256")
            assets.append(OracleAsset(relative, asset_path, digest))
        assets_sha256 = (
            sha256_text(
                compact_json(
                    [
                        {"path": asset.relative_path, "sha256": asset.sha256}
                        for asset in assets
                    ]
                )
            )
            if assets
            else None
        )
        return cls(
            command=command,
            timeout_seconds=timeout_seconds,
            reveal_output=reveal_output,
            definition_sha256=sha256_file(oracle_path),
            oracle_root=oracle_path.parent,
            assets=tuple(assets),
            assets_sha256=assets_sha256,
        )

    def verify_integrity(self) -> None:
        for asset in self.assets:
            if not asset.path.is_file() or sha256_file(asset.path) != asset.sha256:
                raise RuntimeError("private oracle asset changed after manifest validation")

    def render_command(self, workspace: Path) -> list[str]:
        return [
            item.replace("{workspace}", str(workspace)).replace("{oracle_dir}", str(self.oracle_root))
            for item in self.command
        ]


@dataclass(frozen=True)
class ToolCall:
    call_id: str
    name: str
    arguments: dict[str, Any]
    raw_arguments: str | None = None
    argument_error: str | None = None


@dataclass(frozen=True)
class ModelReply:
    content: str | None
    tool_calls: tuple[ToolCall, ...]
    model: str | None
    response_id: str | None
    input_tokens: int | None
    output_tokens: int | None
    cost_usd: float | None
    cost_accounting: str | None = None
    reasoning_content: str | None = None


@dataclass(frozen=True)
class CostPolicy:
    """How a route accounts for cost without conflating estimates and invoices."""

    kind: str
    input_cache_miss_usd_per_million_tokens: float | None = None
    output_usd_per_million_tokens: float | None = None
    pricing_source: str | None = None
    pricing_verified_on: str | None = None
    subscription_name: str | None = None
    usage_source: str | None = None

    @classmethod
    def provider_reported(cls) -> "CostPolicy":
        return cls(kind="provider-reported")

    @classmethod
    def load_deepseek(cls, value: object) -> "CostPolicy":
        if not isinstance(value, dict):
            raise ValueError("deepseek route cost_policy must be an object")
        kind = str(value.get("kind", "")).strip()
        if kind != "frozen-rate-card-conservative":
            raise ValueError("deepseek route cost_policy kind must be frozen-rate-card-conservative")
        input_rate = value.get("input_cache_miss_usd_per_million_tokens")
        output_rate = value.get("output_usd_per_million_tokens")
        if not _is_nonnegative_finite_number(input_rate) or float(input_rate) <= 0:
            raise ValueError("deepseek route input_cache_miss_usd_per_million_tokens must be positive")
        if not _is_nonnegative_finite_number(output_rate) or float(output_rate) <= 0:
            raise ValueError("deepseek route output_usd_per_million_tokens must be positive")
        pricing_source = str(value.get("pricing_source", "")).strip()
        if not pricing_source.startswith("https://api-docs.deepseek.com/"):
            raise ValueError("deepseek route pricing_source must be an official DeepSeek API docs URL")
        pricing_verified_on = str(value.get("pricing_verified_on", "")).strip()
        try:
            date.fromisoformat(pricing_verified_on)
        except ValueError as error:
            raise ValueError("deepseek route pricing_verified_on must be an ISO date") from error
        return cls(
            kind=kind,
            input_cache_miss_usd_per_million_tokens=float(input_rate),
            output_usd_per_million_tokens=float(output_rate),
            pricing_source=pricing_source,
            pricing_verified_on=pricing_verified_on,
        )

    @classmethod
    def load_opencode_go(cls, value: object) -> "CostPolicy":
        if not isinstance(value, dict):
            raise ValueError("OpenCode Go route cost_policy must be an object")
        kind = str(value.get("kind", "")).strip()
        if kind != "subscription-quota":
            raise ValueError("OpenCode Go route cost_policy kind must be subscription-quota")
        subscription_name = str(value.get("subscription_name", "")).strip()
        if subscription_name != "OpenCode Go":
            raise ValueError("OpenCode Go route subscription_name must be OpenCode Go")
        usage_source = str(value.get("usage_source", "")).strip()
        if not usage_source.startswith("https://opencode.ai/"):
            raise ValueError("OpenCode Go route usage_source must be an official OpenCode URL")
        return cls(
            kind=kind,
            subscription_name=subscription_name,
            usage_source=usage_source,
        )

    def estimate_cost_usd(self, input_tokens: int | None, output_tokens: int | None) -> float | None:
        if self.kind != "frozen-rate-card-conservative":
            return None
        if not _is_nonnegative_int(input_tokens) or not _is_nonnegative_int(output_tokens):
            return None
        if (
            self.input_cache_miss_usd_per_million_tokens is None
            or self.output_usd_per_million_tokens is None
        ):
            return None
        return (
            input_tokens * self.input_cache_miss_usd_per_million_tokens
            + output_tokens * self.output_usd_per_million_tokens
        ) / 1_000_000

    def receipt_payload(self) -> dict[str, object]:
        payload: dict[str, object] = {"kind": self.kind}
        if self.kind == "frozen-rate-card-conservative":
            payload.update(
                {
                    "input_cache_miss_usd_per_million_tokens": self.input_cache_miss_usd_per_million_tokens,
                    "output_usd_per_million_tokens": self.output_usd_per_million_tokens,
                    "pricing_source": self.pricing_source,
                    "pricing_verified_on": self.pricing_verified_on,
                    "interpretation": "upper-bound estimate using all prompt tokens at the cache-miss rate",
                }
            )
        elif self.kind == "subscription-quota":
            payload.update(
                {
                    "subscription_name": self.subscription_name,
                    "usage_source": self.usage_source,
                    "interpretation": (
                        "token use is measured; any provider request-price field is retained as "
                        "non-invoice telemetry and is not treated as a billable USD cost"
                    ),
                }
            )
        return payload


@dataclass(frozen=True)
class RouteSpec:
    provider: str
    requested_model: str
    expected_actual_model: str
    provider_timeout_seconds: int
    max_output_tokens: int
    max_cost_usd: float | None
    temperature: float
    tool_choice: str
    cost_policy: CostPolicy
    definition_sha256: str
    max_total_tokens: int | None = None
    thinking_mode: str | None = None
    reasoning_effort: str | None = None
    preserve_reasoning_content: bool = False

    @classmethod
    def load(cls, path: str | Path) -> "RouteSpec":
        manifest_path = Path(path).resolve()
        data: dict[str, Any] = json.loads(manifest_path.read_text(encoding="utf-8"))
        schema_version = data.get("schema_version")
        if schema_version not in {1, 2, 3, 4, 5}:
            raise ValueError("route schema_version must be 1, 2, 3, 4, or 5")
        provider = str(data.get("provider", "")).strip()
        thinking_mode: str | None = None
        reasoning_effort: str | None = None
        preserve_reasoning_content = False
        if schema_version == 1:
            if provider != "openrouter":
                raise ValueError("route schema_version 1 provider must be openrouter")
            cost_policy = CostPolicy.provider_reported()
        elif schema_version == 2:
            if provider != "deepseek":
                raise ValueError("route schema_version 2 provider must be deepseek")
            cost_policy = CostPolicy.load_deepseek(data.get("cost_policy"))
        elif schema_version == 3:
            if provider != "deepseek":
                raise ValueError("route schema_version 3 provider must be deepseek")
            cost_policy = CostPolicy.load_deepseek(data.get("cost_policy"))
            thinking = data.get("thinking")
            if not isinstance(thinking, dict):
                raise ValueError("deepseek route thinking must be an object")
            thinking_mode = str(thinking.get("type", "")).strip()
            if thinking_mode not in {"enabled", "disabled"}:
                raise ValueError("deepseek route thinking type must be enabled or disabled")
            raw_effort = data.get("reasoning_effort")
            if thinking_mode == "enabled":
                reasoning_effort = str(raw_effort or "").strip()
                if reasoning_effort not in {"low", "high", "max"}:
                    raise ValueError("deepseek route reasoning_effort must be low, high, or max when thinking is enabled")
            elif raw_effort is not None:
                raise ValueError("deepseek route reasoning_effort must be omitted when thinking is disabled")
            preserve_reasoning_content = True
        else:
            if provider != "opencode-go":
                raise ValueError("OpenCode Go route provider must be opencode-go")
            cost_policy = CostPolicy.load_opencode_go(data.get("cost_policy"))
            raw_effort = data.get("reasoning_effort")
            if raw_effort is not None:
                reasoning_effort = str(raw_effort).strip()
                if reasoning_effort not in {"minimal", "low", "medium", "high", "xhigh", "max"}:
                    raise ValueError("OpenCode Go reasoning_effort must be a supported frozen level")
            preserve = data.get("preserve_reasoning_content")
            if not isinstance(preserve, bool):
                raise ValueError("OpenCode Go preserve_reasoning_content must be boolean")
            preserve_reasoning_content = preserve
        requested_model = str(data.get("requested_model", "")).strip()
        expected_actual_model = str(data.get("expected_actual_model", "")).strip()
        if not requested_model or not expected_actual_model:
            raise ValueError("route requested_model and expected_actual_model are required")
        timeout_seconds = data.get("provider_timeout_seconds")
        if not _is_nonnegative_int(timeout_seconds):
            raise ValueError("route provider_timeout_seconds must be an integer")
        if timeout_seconds < 1 or timeout_seconds > 600:
            raise ValueError("route provider_timeout_seconds must be between 1 and 600")
        max_output_tokens = data.get("max_output_tokens")
        if not _is_nonnegative_int(max_output_tokens):
            raise ValueError("route max_output_tokens must be an integer")
        if max_output_tokens < 1 or max_output_tokens > 4096:
            raise ValueError("route max_output_tokens must be between 1 and 4096")
        raw_max_cost_usd = data.get("max_cost_usd")
        if cost_policy.kind == "subscription-quota":
            if raw_max_cost_usd is not None:
                raise ValueError("OpenCode Go subscription routes must omit max_cost_usd")
            max_cost_usd = None
        else:
            if not _is_nonnegative_finite_number(raw_max_cost_usd):
                raise ValueError("route max_cost_usd must be numeric")
            max_cost_usd = float(raw_max_cost_usd)
            if not 0 < max_cost_usd <= 100:
                raise ValueError("route max_cost_usd must be between 0 and 100")
        max_total_tokens: int | None = None
        raw_max_total_tokens = data.get("max_total_tokens")
        if schema_version == 5:
            if not _is_nonnegative_int(raw_max_total_tokens):
                raise ValueError("OpenCode Go max_total_tokens must be an integer")
            if raw_max_total_tokens < 1_000 or raw_max_total_tokens > 500_000:
                raise ValueError("OpenCode Go max_total_tokens must be between 1000 and 500000")
            max_total_tokens = raw_max_total_tokens
        elif raw_max_total_tokens is not None:
            raise ValueError("max_total_tokens requires route schema_version 5")
        temperature = data.get("temperature")
        if not _is_nonnegative_finite_number(temperature):
            raise ValueError("route temperature must be numeric")
        temperature = float(temperature)
        if temperature != 0:
            raise ValueError("route temperature must be exactly 0 for matched trials")
        tool_choice = str(data.get("tool_choice", "")).strip()
        if tool_choice != "auto":
            raise ValueError("route tool_choice must be auto")
        return cls(
            provider=provider,
            requested_model=requested_model,
            expected_actual_model=expected_actual_model,
            provider_timeout_seconds=timeout_seconds,
            max_output_tokens=max_output_tokens,
            max_cost_usd=max_cost_usd,
            temperature=temperature,
            tool_choice=tool_choice,
            cost_policy=cost_policy,
            definition_sha256=sha256_file(manifest_path),
            max_total_tokens=max_total_tokens,
            thinking_mode=thinking_mode,
            reasoning_effort=reasoning_effort,
            preserve_reasoning_content=preserve_reasoning_content,
        )

    def receipt_payload(self) -> dict[str, object]:
        return {
            "definition_sha256": self.definition_sha256,
            "provider": self.provider,
            "requested_model": self.requested_model,
            "expected_actual_model": self.expected_actual_model,
            "provider_timeout_seconds": self.provider_timeout_seconds,
            "max_output_tokens": self.max_output_tokens,
            "max_total_tokens": self.max_total_tokens,
            "max_cost_usd": self.max_cost_usd,
            "temperature": self.temperature,
            "tool_choice": self.tool_choice,
            "cost_policy": self.cost_policy.receipt_payload(),
            "thinking": {"type": self.thinking_mode} if self.thinking_mode is not None else None,
            "reasoning_effort": self.reasoning_effort,
            "preserve_reasoning_content": self.preserve_reasoning_content,
        }

    def reply_violation(
        self,
        reply: ModelReply,
        total_cost_usd: float | None,
        total_tokens: int | None = None,
    ) -> str | None:
        if reply.model != self.expected_actual_model:
            return "actual-model-mismatch"
        if reply.input_tokens is None or reply.output_tokens is None:
            return "provider-usage-missing"
        if reply.cost_accounting != self.cost_policy.kind:
            return "cost-accounting-mismatch"
        if (
            not _is_nonnegative_int(reply.input_tokens)
            or not _is_nonnegative_int(reply.output_tokens)
        ):
            return "provider-usage-invalid"
        if self.cost_policy.kind != "subscription-quota":
            if reply.cost_usd is None or total_cost_usd is None:
                return "provider-usage-missing"
            if (
                not _is_nonnegative_finite_number(reply.cost_usd)
                or not _is_nonnegative_finite_number(total_cost_usd)
            ):
                return "provider-usage-invalid"
        elif reply.cost_usd is not None and not _is_nonnegative_finite_number(reply.cost_usd):
            return "provider-usage-invalid"
        if reply.output_tokens > self.max_output_tokens:
            return "output-budget-exceeded"
        if self.max_total_tokens is not None:
            if not _is_nonnegative_int(total_tokens):
                return "aggregate-token-usage-missing"
            if total_tokens > self.max_total_tokens:
                return "total-token-budget-exceeded"
        if self.max_cost_usd is not None and total_cost_usd is not None and total_cost_usd > self.max_cost_usd:
            return "cost-budget-exceeded"
        return None


@dataclass(frozen=True)
class ToolEvent:
    name: str
    path: str | None
    success: bool
    content_sha256: str | None = None
    exit_code: int | None = None


def compact_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=True, separators=(",", ":"))
