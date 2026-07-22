from __future__ import annotations

from dataclasses import dataclass
import hashlib
import os
from pathlib import Path
import re
import stat
import tomllib

from .case_bundle import public_case_definition_hash
from .schema import CaseManifest

PRIVATE_OVERLAY_SCHEMA_VERSION = "0.2"
SHA256_PATTERN = "0123456789abcdef"
PINNED_IMAGE_PATTERN = re.compile(r"^.+@sha256:[0-9a-f]{64}$")


@dataclass(frozen=True)
class OracleAssetSet:
    case_id: str
    visibility: str
    root: Path
    hidden_patch: Path | None
    reference_patch: Path | None
    annotation_rubric: Path | None
    verifier_runtime: Path | None
    verifier_image: str | None
    verifier_command: tuple[str, ...]
    definition_sha256: str
    overlay_id: str | None
    public_contract_sha256: str
    hidden_patch_sha256: str | None
    reference_patch_sha256: str | None
    annotation_rubric_sha256: str | None
    verifier_runtime_sha256: str | None


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _hash_tree(root: Path) -> str:
    if not root.is_dir() or _is_reparse_point(root):
        raise ValueError("private verifier runtime is invalid")
    digest = hashlib.sha256()
    paths = tuple(sorted(root.rglob("*")))
    if any(_is_reparse_point(path) for path in paths):
        raise ValueError("private verifier runtime is invalid")
    files = tuple(path for path in paths if path.is_file())
    if not files:
        raise ValueError("private verifier runtime is invalid")
    for path in files:
        if _is_reparse_point(path):
            raise ValueError("private verifier runtime is invalid")
        digest.update(path.relative_to(root).as_posix().encode("utf-8"))
        digest.update(b"\0")
        with path.open("rb") as handle:
            for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                digest.update(chunk)
    return digest.hexdigest()


def verifier_runtime_hash(path: str | Path) -> str:
    candidate = Path(path)
    return _hash_tree(candidate) if candidate.is_dir() else _sha256(candidate)


def _require_sha256(data: dict[str, object], key: str) -> str:
    value = data.get(key)
    if not isinstance(value, str) or len(value) != 64 or any(
        character not in SHA256_PATTERN for character in value
    ):
        raise ValueError("private oracle definition has an invalid digest")
    return value


def _required_text(data: dict[str, object], key: str) -> str:
    value = data.get(key)
    if not isinstance(value, str) or not value.strip():
        raise ValueError("private oracle definition has a missing required field")
    return value.strip()


def _required_command(data: dict[str, object]) -> tuple[str, ...]:
    value = data.get("verifier_command")
    if not isinstance(value, list) or not value:
        raise ValueError("private oracle verifier command is missing or invalid")
    command = tuple(str(item).strip() for item in value)
    if any(not item or "\0" in item for item in command):
        raise ValueError("private oracle verifier command is missing or invalid")
    return command


def _resolve_asset(root: Path, relative: str, *, label: str) -> Path:
    relative_path = Path(relative)
    if relative_path.is_absolute() or ".." in relative_path.parts:
        raise ValueError("private oracle asset path is invalid")
    raw_candidate = root / relative_path
    current = root
    if _is_reparse_point(current):
        raise ValueError("private oracle root is invalid")
    for part in relative_path.parts:
        current = current / part
        if _is_reparse_point(current):
            raise ValueError("private oracle asset path is invalid")
    candidate = raw_candidate.resolve()
    if candidate == root or root not in candidate.parents:
        raise ValueError("private oracle asset path is invalid")
    if not candidate.is_file():
        raise ValueError("private oracle asset is missing or invalid")
    return candidate


def _is_reparse_point(path: Path) -> bool:
    try:
        details = os.lstat(path)
    except OSError:
        return False
    attributes = getattr(details, "st_file_attributes", 0)
    reparse_flag = getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0)
    return path.is_symlink() or bool(attributes & reparse_flag)


def _resolve_runtime(root: Path, relative: str) -> Path:
    relative_path = Path(relative)
    if relative_path.is_absolute() or ".." in relative_path.parts:
        raise ValueError("private verifier runtime path is invalid")
    current = root
    for part in relative_path.parts:
        current = current / part
        if _is_reparse_point(current):
            raise ValueError("private verifier runtime path is invalid")
    candidate = (root / relative_path).resolve()
    if candidate == root or root not in candidate.parents:
        raise ValueError("private verifier runtime path is invalid")
    if not candidate.is_dir() or _is_reparse_point(candidate):
        raise ValueError("private verifier runtime is missing or invalid")
    _hash_tree(candidate)
    return candidate


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


def _private_definition_hash(
    *,
    definition: Path,
    hidden: Path,
    reference: Path,
    annotation_rubric: Path,
    verifier_runtime: Path,
    root: Path,
) -> str:
    digest = hashlib.sha256()
    digest.update(
        _overlay_hash((definition, hidden, reference, annotation_rubric), root).encode("ascii")
    )
    digest.update(b"\0")
    digest.update(verifier_runtime.relative_to(root).as_posix().encode("utf-8"))
    digest.update(b"\0")
    digest.update(verifier_runtime_hash(verifier_runtime).encode("ascii"))
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
        annotation_rubric=None,
        verifier_runtime=None,
        verifier_image=None,
        verifier_command=(),
        definition_sha256=public_case_definition_hash(manifest),
        overlay_id=None,
        public_contract_sha256=public_case_definition_hash(manifest),
        hidden_patch_sha256=None,
        reference_patch_sha256=None,
        annotation_rubric_sha256=None,
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
        raise ValueError("private oracle root is invalid")
    definition = root / "oracle.toml"
    if not definition.is_file() or _is_reparse_point(definition):
        raise ValueError("private oracle definition is missing or invalid")
    try:
        data = tomllib.loads(definition.read_text(encoding="utf-8"))
    except (OSError, tomllib.TOMLDecodeError) as error:
        raise ValueError("private oracle definition cannot be read") from error
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
    annotation_rubric = _resolve_asset(
        root,
        _required_text(data, "annotation_rubric"),
        label="annotation rubric",
    )
    verifier_runtime = _resolve_runtime(
        root,
        _required_text(data, "verifier_runtime"),
    )
    hidden_patch_sha256 = _require_sha256(data, "hidden_patch_sha256")
    if hidden_patch_sha256 != _sha256(hidden):
        raise ValueError("private oracle hidden patch commitment does not match")
    reference_patch_sha256 = _require_sha256(data, "reference_patch_sha256")
    if reference_patch_sha256 != _sha256(reference):
        raise ValueError("private oracle reference patch commitment does not match")
    annotation_rubric_sha256 = _require_sha256(data, "annotation_rubric_sha256")
    if annotation_rubric_sha256 != _sha256(annotation_rubric):
        raise ValueError("private oracle annotation rubric commitment does not match")
    verifier_runtime_sha256 = _require_sha256(data, "verifier_runtime_sha256")
    if verifier_runtime_sha256 != verifier_runtime_hash(verifier_runtime):
        raise ValueError("private oracle verifier runtime commitment does not match")
    verifier_image = _required_text(data, "verifier_image")
    if not PINNED_IMAGE_PATTERN.fullmatch(verifier_image):
        raise ValueError("private oracle verifier image must be pinned by digest")
    verifier_command = _required_command(data)
    return OracleAssetSet(
        case_id=manifest.case_id,
        visibility="private",
        root=root,
        hidden_patch=hidden,
        reference_patch=reference,
        annotation_rubric=annotation_rubric,
        verifier_runtime=verifier_runtime,
        verifier_image=verifier_image,
        verifier_command=verifier_command,
        definition_sha256=_private_definition_hash(
            definition=definition,
            hidden=hidden,
            reference=reference,
            annotation_rubric=annotation_rubric,
            verifier_runtime=verifier_runtime,
            root=root,
        ),
        overlay_id=_required_text(data, "overlay_id"),
        public_contract_sha256=public_contract_sha256,
        hidden_patch_sha256=hidden_patch_sha256,
        reference_patch_sha256=reference_patch_sha256,
        annotation_rubric_sha256=annotation_rubric_sha256,
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
