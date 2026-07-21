from __future__ import annotations

from dataclasses import dataclass
import hashlib
import os
from pathlib import Path
import stat
import tomllib

from .case_bundle import public_case_definition_hash
from .schema import CaseManifest

PRIVATE_OVERLAY_SCHEMA_VERSION = "0.1"
SHA256_PATTERN = "0123456789abcdef"


@dataclass(frozen=True)
class OracleAssetSet:
    case_id: str
    visibility: str
    root: Path
    hidden_patch: Path | None
    reference_patch: Path | None
    definition_sha256: str
    overlay_id: str | None
    public_contract_sha256: str
    verifier_runtime_sha256: str | None


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _require_sha256(data: dict[str, object], key: str) -> str:
    value = data.get(key)
    if not isinstance(value, str) or len(value) != 64 or any(
        character not in SHA256_PATTERN for character in value
    ):
        raise ValueError(f"private oracle.{key} must be a lowercase SHA-256 digest")
    return value


def _required_text(data: dict[str, object], key: str) -> str:
    value = data.get(key)
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"private oracle.{key} must be a non-empty string")
    return value.strip()


def _resolve_asset(root: Path, relative: str, *, label: str) -> Path:
    relative_path = Path(relative)
    if relative_path.is_absolute() or ".." in relative_path.parts:
        raise ValueError(f"{label} escapes its oracle root: {relative}")
    raw_candidate = root / relative_path
    current = root
    if _is_reparse_point(current):
        raise ValueError("oracle root must not be a symbolic link or reparse point")
    for part in relative_path.parts:
        current = current / part
        if _is_reparse_point(current):
            raise ValueError(f"{label} must not contain a symbolic link or reparse point")
    candidate = raw_candidate.resolve()
    if candidate == root or root not in candidate.parents:
        raise ValueError(f"{label} escapes its oracle root: {relative}")
    if not candidate.is_file():
        raise ValueError(f"{label} must be a regular file")
    return candidate


def _is_reparse_point(path: Path) -> bool:
    try:
        details = os.lstat(path)
    except OSError:
        return False
    attributes = getattr(details, "st_file_attributes", 0)
    return path.is_symlink() or bool(attributes & stat.FILE_ATTRIBUTE_REPARSE_POINT)


def _overlay_hash(paths: tuple[Path, ...], root: Path) -> str:
    digest = hashlib.sha256()
    for path in sorted(paths):
        relative = path.relative_to(root).as_posix()
        digest.update(relative.encode("utf-8"))
        digest.update(b"\0")
        with path.open("rb") as handle:
            for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                digest.update(chunk)
    return digest.hexdigest()


def _public_asset(manifest: CaseManifest, relative: str, *, label: str) -> Path:
    return _resolve_asset(manifest.source_path.parent.resolve(), relative, label=label)


def _public_transition_sha256(manifest: CaseManifest) -> str:
    if not manifest.transition.patch:
        raise ValueError(
            "private-oracle cases require a public transition.patch commitment"
        )
    return _sha256(_public_asset(manifest, manifest.transition.patch, label="transition patch"))


def public_oracle_assets(manifest: CaseManifest) -> OracleAssetSet:
    if manifest.oracle.visibility != "public":
        raise ValueError(f"case {manifest.case_id} requires a private oracle overlay")
    root = manifest.source_path.parent.resolve()
    hidden = (
        _resolve_asset(root, manifest.oracle.hidden_patch, label="hidden patch")
        if manifest.oracle.hidden_patch
        else None
    )
    reference = (
        _resolve_asset(root, manifest.oracle.reference_patch, label="reference patch")
        if manifest.oracle.reference_patch
        else None
    )
    return OracleAssetSet(
        case_id=manifest.case_id,
        visibility="public",
        root=root,
        hidden_patch=hidden,
        reference_patch=reference,
        definition_sha256=public_case_definition_hash(manifest),
        overlay_id=None,
        public_contract_sha256=public_case_definition_hash(manifest),
        verifier_runtime_sha256=None,
    )


def load_private_oracle_overlay(
    manifest: CaseManifest,
    overlay_root: str | Path,
) -> OracleAssetSet:
    if manifest.oracle.visibility != "private":
        raise ValueError(f"case {manifest.case_id} does not declare a private oracle")
    root = Path(overlay_root).resolve()
    if not root.is_dir() or _is_reparse_point(Path(overlay_root)):
        raise ValueError("private oracle root must be a regular directory")
    definition = root / "oracle.toml"
    if not definition.is_file() or _is_reparse_point(definition):
        raise ValueError("private oracle definition is missing")
    try:
        data = tomllib.loads(definition.read_text(encoding="utf-8"))
    except (OSError, tomllib.TOMLDecodeError) as error:
        raise ValueError(f"cannot read private oracle definition: {error}") from error
    if data.get("schema_version") != PRIVATE_OVERLAY_SCHEMA_VERSION:
        raise ValueError("unsupported private oracle schema version")
    if _required_text(data, "case_id") != manifest.case_id:
        raise ValueError("private oracle case_id does not match the public manifest")
    public_contract_sha256 = _require_sha256(data, "public_case_definition_sha256")
    if public_contract_sha256 != public_case_definition_hash(manifest):
        raise ValueError("private oracle is not bound to this public case definition")
    if _required_text(data, "base_commit") != manifest.repository.base_revision:
        raise ValueError("private oracle base_commit does not match the public manifest")
    if _require_sha256(data, "transition_patch_sha256") != _public_transition_sha256(manifest):
        raise ValueError("private oracle transition patch commitment does not match")
    hidden = _resolve_asset(root, _required_text(data, "hidden_patch"), label="hidden patch")
    reference = _resolve_asset(
        root,
        _required_text(data, "reference_patch"),
        label="reference patch",
    )
    if _require_sha256(data, "hidden_patch_sha256") != _sha256(hidden):
        raise ValueError("private oracle hidden patch commitment does not match")
    if _require_sha256(data, "reference_patch_sha256") != _sha256(reference):
        raise ValueError("private oracle reference patch commitment does not match")
    verifier_runtime_sha256 = _require_sha256(data, "verifier_runtime_sha256")
    return OracleAssetSet(
        case_id=manifest.case_id,
        visibility="private",
        root=root,
        hidden_patch=hidden,
        reference_patch=reference,
        definition_sha256=_overlay_hash((definition, hidden, reference), root),
        overlay_id=_required_text(data, "overlay_id"),
        public_contract_sha256=public_contract_sha256,
        verifier_runtime_sha256=verifier_runtime_sha256,
    )


def resolve_oracle_assets(
    manifest: CaseManifest,
    private_oracle_root: str | Path | None = None,
) -> OracleAssetSet:
    if manifest.oracle.visibility == "private":
        if private_oracle_root is None:
            raise ValueError(f"case {manifest.case_id} requires --private-oracle-root")
        return load_private_oracle_overlay(manifest, private_oracle_root)
    if private_oracle_root is not None:
        raise ValueError("--private-oracle-root is only valid for private-oracle cases")
    return public_oracle_assets(manifest)
