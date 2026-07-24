"""Fail-closed manifest and audit helpers for public research artifacts."""

from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import stat

from .public_safety import PublicSafetyError, reject_public_json_text, reject_public_text


PUBLIC_ARTIFACT_MANIFEST_SCHEMA_VERSION = "public-artifact-manifest-v1"
PUBLIC_RELEASE_TIERS = frozenset({"design-only-v1", "public-reproducible-summary-v1"})
PUBLIC_REPRODUCIBLE_SUMMARY_PATH = "public-summary/public-cohort-v1.json"
ALLOWED_SUFFIXES = frozenset({
    ".bib", ".go", ".json", ".lock", ".md", ".mjs", ".mod", ".ps1", ".py", ".tex", ".toml",
})
FORBIDDEN_PATH_COMPONENTS = frozenset(
    {".git", ".pytest_cache", ".venv", "__pycache__", "artifacts", "cache", "private", "raw", "results"}
)
MAX_ENTRY_BYTES = 2 * 1024 * 1024
SHA256_PATTERN = re.compile(r"^[0-9a-f]{64}$")
IDENTIFIER_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")


class PublicArtifactError(ValueError):
    """Raised when a requested public release contains unsafe or stale files."""


def _canonical_json(value: object) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode("ascii")


def _sha256(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def _require_sha256(value: object, *, label: str) -> str:
    if not isinstance(value, str) or not SHA256_PATTERN.fullmatch(value):
        raise PublicArtifactError(f"public artifact {label} must be a SHA-256 digest")
    return value


def _parse_timestamp(value: object, *, label: str) -> str:
    if not isinstance(value, str):
        raise PublicArtifactError(f"public artifact {label} must be text")
    try:
        timestamp = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as error:
        raise PublicArtifactError(f"public artifact {label} is invalid") from error
    if timestamp.tzinfo is None:
        raise PublicArtifactError(f"public artifact {label} must include a timezone")
    return timestamp.astimezone(timezone.utc).isoformat()


def _relative_path(value: object) -> str:
    if not isinstance(value, str) or not value or "\\" in value or ":" in value:
        raise PublicArtifactError("public artifact path must be a non-empty POSIX relative path")
    try:
        reject_public_text(value)
    except PublicSafetyError as error:
        raise PublicArtifactError("public artifact path contains sensitive text") from error
    candidate = PurePosixPath(value)
    if candidate.is_absolute() or any(part in {"", ".", ".."} for part in candidate.parts):
        raise PublicArtifactError("public artifact path escapes the release root")
    if any(part.casefold() in FORBIDDEN_PATH_COMPONENTS for part in candidate.parts):
        raise PublicArtifactError("public artifact path is not releasable")
    if candidate.suffix.casefold() not in ALLOWED_SUFFIXES:
        raise PublicArtifactError("public artifact file type is not releasable")
    return candidate.as_posix()


def _is_reparse_point(path: Path) -> bool:
    try:
        details = os.lstat(path)
    except OSError:
        return False
    attributes = getattr(details, "st_file_attributes", 0)
    reparse_flag = getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0)
    return path.is_symlink() or bool(attributes & reparse_flag)


def _resolve_entry(root: Path, relative_path: str) -> Path:
    candidate = root / Path(relative_path)
    current = root
    for component in PurePosixPath(relative_path).parts:
        current = current / component
        if _is_reparse_point(current):
            raise PublicArtifactError("public artifact path contains a symlink or reparse point")
    resolved = candidate.resolve()
    if resolved == root or root not in resolved.parents:
        raise PublicArtifactError("public artifact path escapes the release root")
    try:
        metadata = os.lstat(resolved)
    except OSError as error:
        raise PublicArtifactError("public artifact entry cannot be inspected") from error
    if not stat.S_ISREG(metadata.st_mode) or _is_reparse_point(resolved):
        raise PublicArtifactError("public artifact entry is not a regular file")
    if metadata.st_nlink != 1:
        raise PublicArtifactError("public artifact entry must not be a hard link")
    return resolved


def _category(relative_path: str) -> str:
    path = PurePosixPath(relative_path)
    if path.parts and path.parts[0] == "public-summary":
        return "public-result-summary"
    if path.parts and path.parts[0] == "paper":
        return "paper-source"
    if path.parts and path.parts[0] == "src":
        return "source"
    if path.parts and path.parts[0] == "cases":
        return "case-metadata"
    if path.suffix == ".md":
        return "documentation"
    return "metadata"


def _validate_public_reproducible_summary(text: str) -> None:
    try:
        payload = json.loads(text)
    except json.JSONDecodeError as error:
        raise PublicArtifactError("public cohort summary is not valid JSON") from error
    if not isinstance(payload, dict) or set(payload) != {
        "schema_version", "evidence_tier", "analysis_sha256", "analysis"
    }:
        raise PublicArtifactError("public cohort summary has an unsupported schema")
    if payload.get("schema_version") != "public-cohort-summary-v1":
        raise PublicArtifactError("public cohort summary schema is unsupported")
    if payload.get("evidence_tier") != "public-reproducible":
        raise PublicArtifactError("public cohort summary has the wrong evidence tier")
    analysis_sha256 = _require_sha256(payload.get("analysis_sha256"), label="summary analysis hash")
    analysis = payload.get("analysis")
    if not isinstance(analysis, dict) or not {
        "schema_version",
        "plan_id",
        "result_validation",
        "primary_success",
        "failure_summaries",
    } <= set(analysis):
        raise PublicArtifactError("public cohort summary lacks analysis fields")
    if analysis.get("schema_version") != "public-reproducible-cohort-analysis-v1":
        raise PublicArtifactError("public cohort summary analysis schema is unsupported")
    if analysis_sha256 != _sha256(_canonical_json(analysis)):
        raise PublicArtifactError("public cohort summary analysis hash does not match its analysis")


def _read_releasable_text(root: Path, relative_path: str) -> tuple[bytes, str]:
    source = _resolve_entry(root, relative_path)
    try:
        content = source.read_bytes()
    except OSError as error:
        raise PublicArtifactError("public artifact entry cannot be read") from error
    if len(content) > MAX_ENTRY_BYTES:
        raise PublicArtifactError("public artifact entry exceeds the size limit")
    try:
        text = content.decode("utf-8")
    except UnicodeDecodeError as error:
        raise PublicArtifactError("public artifact entry is not UTF-8 text") from error
    try:
        reject_public_text(text)
        if PurePosixPath(relative_path).suffix == ".json":
            reject_public_json_text(text)
    except PublicSafetyError as error:
        raise PublicArtifactError("public artifact entry contains sensitive text") from error
    return content, text


@dataclass(frozen=True)
class PublicArtifactEntry:
    path: str
    category: str
    sha256: str
    byte_count: int

    def public_payload(self) -> dict[str, object]:
        return asdict(self)

    def validate(self) -> None:
        relative_path = _relative_path(self.path)
        if self.category != _category(relative_path):
            raise PublicArtifactError("public artifact entry category is inconsistent")
        _require_sha256(self.sha256, label="entry hash")
        if isinstance(self.byte_count, bool) or not isinstance(self.byte_count, int) or not 0 < self.byte_count <= MAX_ENTRY_BYTES:
            raise PublicArtifactError("public artifact entry byte count is invalid")


@dataclass(frozen=True)
class PublicArtifactManifest:
    schema_version: str
    release_id: str
    evidence_tier: str
    created_at: str
    entries: tuple[PublicArtifactEntry, ...]

    def public_payload(self) -> dict[str, object]:
        payload = asdict(self)
        payload["entries"] = [entry.public_payload() for entry in self.entries]
        return payload

    @property
    def sha256(self) -> str:
        self.validate()
        return _sha256(_canonical_json(self.public_payload()))

    def validate(self) -> None:
        if self.schema_version != PUBLIC_ARTIFACT_MANIFEST_SCHEMA_VERSION:
            raise PublicArtifactError("public artifact manifest schema is unsupported")
        if not IDENTIFIER_PATTERN.fullmatch(self.release_id):
            raise PublicArtifactError("public artifact release id is invalid")
        try:
            reject_public_text(self.release_id)
        except PublicSafetyError as error:
            raise PublicArtifactError("public artifact release id contains sensitive text") from error
        if self.evidence_tier not in PUBLIC_RELEASE_TIERS:
            raise PublicArtifactError("public artifact evidence tier is unsupported")
        _parse_timestamp(self.created_at, label="created_at")
        if not self.entries:
            raise PublicArtifactError("public artifact manifest must contain entries")
        paths = tuple(entry.path for entry in self.entries)
        if paths != tuple(sorted(paths)) or len(set(paths)) != len(paths):
            raise PublicArtifactError("public artifact entries must be unique and sorted")
        for entry in self.entries:
            entry.validate()
        if self.evidence_tier == "public-reproducible-summary-v1" and (
            PUBLIC_REPRODUCIBLE_SUMMARY_PATH not in paths
        ):
            raise PublicArtifactError("public reproducible release requires its cohort summary")

    @classmethod
    def from_public_payload(cls, value: object) -> "PublicArtifactManifest":
        if not isinstance(value, dict):
            raise PublicArtifactError("public artifact manifest must be an object")
        expected = {"schema_version", "release_id", "evidence_tier", "created_at", "entries"}
        if set(value) != expected:
            raise PublicArtifactError("public artifact manifest has unsupported fields")
        raw_entries = value.get("entries")
        if not isinstance(raw_entries, list):
            raise PublicArtifactError("public artifact entries are invalid")
        entries: list[PublicArtifactEntry] = []
        for raw_entry in raw_entries:
            if not isinstance(raw_entry, dict) or set(raw_entry) != {"path", "category", "sha256", "byte_count"}:
                raise PublicArtifactError("public artifact entry is invalid")
            entries.append(
                PublicArtifactEntry(
                    path=raw_entry.get("path"),
                    category=raw_entry.get("category"),
                    sha256=raw_entry.get("sha256"),
                    byte_count=raw_entry.get("byte_count"),
                )
            )
        manifest = cls(
            schema_version=value.get("schema_version"),
            release_id=value.get("release_id"),
            evidence_tier=value.get("evidence_tier"),
            created_at=value.get("created_at"),
            entries=tuple(entries),
        )
        manifest.validate()
        return manifest


@dataclass(frozen=True)
class PublicArtifactAudit:
    release_id: str
    manifest_sha256: str
    entry_count: int
    evidence_tier: str

    def public_payload(self) -> dict[str, object]:
        return asdict(self)


@dataclass(frozen=True)
class MaterializedPublicArtifact:
    release_id: str
    manifest_sha256: str
    entry_count: int

    def public_payload(self) -> dict[str, object]:
        return asdict(self)


def build_public_artifact_manifest(
    *,
    root: str | Path,
    release_id: str,
    evidence_tier: str,
    paths: tuple[str, ...],
    created_at: str | None = None,
) -> PublicArtifactManifest:
    release_root = Path(root).resolve()
    if not release_root.is_dir() or _is_reparse_point(Path(root)):
        raise PublicArtifactError("public artifact root is invalid")
    entries: list[PublicArtifactEntry] = []
    for raw_path in sorted(paths):
        relative_path = _relative_path(raw_path)
        content, text = _read_releasable_text(release_root, relative_path)
        if (
            evidence_tier == "public-reproducible-summary-v1"
            and relative_path == PUBLIC_REPRODUCIBLE_SUMMARY_PATH
        ):
            _validate_public_reproducible_summary(text)
        entries.append(
            PublicArtifactEntry(
                path=relative_path,
                category=_category(relative_path),
                sha256=_sha256(content),
                byte_count=len(content),
            )
        )
    manifest = PublicArtifactManifest(
        schema_version=PUBLIC_ARTIFACT_MANIFEST_SCHEMA_VERSION,
        release_id=release_id,
        evidence_tier=evidence_tier,
        created_at=_parse_timestamp(
            created_at or datetime.now(timezone.utc).isoformat(),
            label="created_at",
        ),
        entries=tuple(entries),
    )
    manifest.validate()
    return manifest


def write_public_artifact_manifest(
    manifest: PublicArtifactManifest,
    path: str | Path,
) -> Path:
    manifest.validate()
    target = Path(path)
    if target.exists():
        raise PublicArtifactError("public artifact manifest output already exists")
    target.parent.mkdir(parents=True, exist_ok=True)
    try:
        target.write_text(
            json.dumps(manifest.public_payload(), indent=2, ensure_ascii=False) + "\n",
            encoding="utf-8",
            newline="\n",
        )
    except OSError as error:
        raise PublicArtifactError("public artifact manifest cannot be written") from error
    return target


def load_public_artifact_manifest(path: str | Path) -> PublicArtifactManifest:
    source = Path(path)
    try:
        if _is_reparse_point(source) or not source.is_file():
            raise OSError("not a regular file")
        payload = json.loads(source.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise PublicArtifactError("public artifact manifest cannot be read") from error
    return PublicArtifactManifest.from_public_payload(payload)


def audit_public_artifact_manifest(
    manifest: PublicArtifactManifest,
    *,
    root: str | Path,
    require_exact_tree: bool = False,
) -> PublicArtifactAudit:
    manifest.validate()
    release_root = Path(root).resolve()
    if not release_root.is_dir() or _is_reparse_point(Path(root)):
        raise PublicArtifactError("public artifact root is invalid")
    for entry in manifest.entries:
        content, text = _read_releasable_text(release_root, entry.path)
        if (
            manifest.evidence_tier == "public-reproducible-summary-v1"
            and entry.path == PUBLIC_REPRODUCIBLE_SUMMARY_PATH
        ):
            _validate_public_reproducible_summary(text)
        if len(content) != entry.byte_count or _sha256(content) != entry.sha256:
            raise PublicArtifactError("public artifact entry does not match the manifest")
    if require_exact_tree:
        _assert_exact_materialized_tree(release_root, manifest)
    return PublicArtifactAudit(
        release_id=manifest.release_id,
        manifest_sha256=manifest.sha256,
        entry_count=len(manifest.entries),
        evidence_tier=manifest.evidence_tier,
    )


def _assert_exact_materialized_tree(
    root: Path,
    manifest: PublicArtifactManifest,
) -> None:
    expected = {entry.path for entry in manifest.entries}
    observed: set[str] = set()
    for directory, child_directories, filenames in os.walk(root, topdown=True, followlinks=False):
        directory_path = Path(directory)
        for name in child_directories:
            candidate = directory_path / name
            if _is_reparse_point(candidate):
                raise PublicArtifactError("public artifact tree contains a symlink or reparse point")
        for name in filenames:
            candidate = directory_path / name
            if _is_reparse_point(candidate):
                raise PublicArtifactError("public artifact tree contains a symlink or reparse point")
            try:
                metadata = os.lstat(candidate)
            except OSError as error:
                raise PublicArtifactError("public artifact tree entry cannot be inspected") from error
            if not stat.S_ISREG(metadata.st_mode) or metadata.st_nlink != 1:
                raise PublicArtifactError("public artifact tree contains an unsupported file entry")
            observed.add(candidate.relative_to(root).as_posix())
    if observed != expected:
        raise PublicArtifactError("public artifact tree contains unlisted or missing entries")


def materialize_public_artifact(
    manifest: PublicArtifactManifest,
    *,
    root: str | Path,
    target: str | Path,
) -> MaterializedPublicArtifact:
    """Copy only the audited whitelist into a fresh release staging directory."""

    audit_public_artifact_manifest(manifest, root=root)
    release_root = Path(root).resolve()
    staging_root = Path(target)
    if staging_root.exists() or _is_reparse_point(staging_root):
        raise PublicArtifactError("public artifact staging target already exists")
    try:
        staging_root.mkdir(parents=True)
        for entry in manifest.entries:
            source = _resolve_entry(release_root, entry.path)
            destination = staging_root / Path(entry.path)
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, destination)
            content = destination.read_bytes()
            if len(content) != entry.byte_count or _sha256(content) != entry.sha256:
                raise PublicArtifactError("public artifact staging copy does not match the manifest")
        audit_public_artifact_manifest(manifest, root=staging_root, require_exact_tree=True)
    except PublicArtifactError:
        shutil.rmtree(staging_root, ignore_errors=True)
        raise
    except OSError as error:
        shutil.rmtree(staging_root, ignore_errors=True)
        raise PublicArtifactError("public artifact staging copy failed") from error
    return MaterializedPublicArtifact(
        release_id=manifest.release_id,
        manifest_sha256=manifest.sha256,
        entry_count=len(manifest.entries),
    )
