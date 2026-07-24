from __future__ import annotations

import hashlib
import os
from pathlib import Path
import shutil
import stat
import tempfile

from .public_safety import reject_public_json_text, reject_public_text
from .schema import CaseManifest


PRIVATE_ORACLE_FILENAMES = frozenset(
    {
        "annotation-rubric.md",
        "hidden-tests.patch",
        "oracle.toml",
        "reference.patch",
        "transition.patch",
    }
)
TRANSIENT_CASE_DIRECTORIES = frozenset({"__pycache__", ".pytest_cache"})


def _is_reparse_point(path: Path) -> bool:
    try:
        details = os.lstat(path)
    except OSError:
        return False
    attributes = getattr(details, "st_file_attributes", 0)
    reparse_flag = getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0)
    return path.is_symlink() or bool(attributes & reparse_flag)


def _resolve_without_reparse(path: str | Path, *, label: str) -> Path:
    requested = Path(path)
    current = requested
    while True:
        if current.exists() and _is_reparse_point(current):
            raise ValueError(f"{label} cannot be a symbolic or reparse path")
        if current.parent == current:
            break
        current = current.parent
    resolved = requested.resolve()
    if _is_reparse_point(resolved):
        raise ValueError(f"{label} cannot be a symbolic or reparse path")
    return resolved


def _regular_files(root: Path) -> tuple[Path, ...]:
    if not root.is_dir() or _is_reparse_point(root):
        raise ValueError("case definition root must be a regular directory")
    # These interpreter/test caches are never part of a case definition. Keeping
    # them out of the snapshot avoids accidental binary drift after a local smoke.
    paths = tuple(sorted(
        path for path in root.rglob("*")
        if not (set(path.relative_to(root).parts) & TRANSIENT_CASE_DIRECTORIES)
    ))
    if any(_is_reparse_point(path) for path in paths):
        raise ValueError("case definition cannot contain symbolic or reparse paths")
    files: list[Path] = []
    for path in paths:
        try:
            metadata = path.lstat()
        except OSError as error:
            raise ValueError("case definition path cannot be inspected") from error
        if stat.S_ISDIR(metadata.st_mode):
            continue
        if not stat.S_ISREG(metadata.st_mode):
            raise ValueError("case definition contains an unsupported filesystem entry")
        files.append(path)
    return tuple(files)


def _path_identity(path: Path) -> tuple[int, int, int, int, int, int]:
    try:
        metadata = path.lstat()
    except OSError as error:
        raise ValueError("public case bundle path cannot be inspected") from error
    return (
        metadata.st_dev,
        metadata.st_ino,
        metadata.st_mode,
        metadata.st_size,
        metadata.st_mtime_ns,
        getattr(metadata, "st_file_attributes", 0),
    )


def _public_path_chain_identities(root: Path, path: Path) -> tuple[tuple[Path, tuple[int, int, int, int, int, int]], ...]:
    try:
        relative = path.relative_to(root)
    except ValueError as error:
        raise ValueError("public case bundle path escapes its root") from error
    current = root
    paths = [current]
    for part in relative.parts:
        current = current / part
        paths.append(current)
    identities: list[tuple[Path, tuple[int, int, int, int, int, int]]] = []
    for candidate in paths:
        if _is_reparse_point(candidate):
            raise ValueError("public case bundle cannot contain symbolic or reparse paths")
        identities.append((candidate, _path_identity(candidate)))
    if not stat.S_ISREG(identities[-1][1][2]):
        raise ValueError("public case bundle contains an unsupported filesystem entry")
    return tuple(identities)


def hash_case_tree(root: str | Path) -> str:
    base = _resolve_without_reparse(root, label="case definition root")
    return _hash_files(base, _regular_files(base))


def _hash_files(root: Path, paths: tuple[Path, ...]) -> str:
    digest = hashlib.sha256()
    for path in paths:
        relative = path.relative_to(root).as_posix()
        digest.update(relative.encode("utf-8"))
        digest.update(b"\0")
        with path.open("rb") as handle:
            for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                digest.update(chunk)
    return digest.hexdigest()


def _hash_snapshots(root: Path, snapshots: tuple[tuple[Path, bytes], ...]) -> str:
    digest = hashlib.sha256()
    for path, data in snapshots:
        relative = path.relative_to(root).as_posix()
        digest.update(relative.encode("utf-8"))
        digest.update(b"\0")
        digest.update(data)
    return digest.hexdigest()


def _public_case_files(manifest: CaseManifest) -> tuple[Path, ...]:
    root = _resolve_without_reparse(manifest.source_path.parent, label="public bundle root")
    if not manifest.public_bundle_paths:
        return _regular_files(root)
    files: set[Path] = set()
    for relative in manifest.public_bundle_paths:
        relative_path = Path(relative)
        if relative_path.is_absolute() or ".." in relative_path.parts:
            raise ValueError("public bundle path escapes its case directory")
        current = root
        for part in relative_path.parts:
            current = current / part
            if _is_reparse_point(current):
                raise ValueError("public bundle cannot contain symbolic or reparse paths")
        candidate = current.resolve()
        if candidate == root or root not in candidate.parents:
            raise ValueError("public bundle path escapes its case directory")
        if candidate.is_dir():
            files.update(_regular_files(candidate))
        elif candidate.is_file():
            try:
                metadata = candidate.lstat()
            except OSError as error:
                raise ValueError("public bundle path cannot be inspected") from error
            if not stat.S_ISREG(metadata.st_mode):
                raise ValueError("public bundle contains an unsupported filesystem entry")
            files.add(candidate)
        else:
            raise ValueError(f"declared public bundle path does not exist: {relative}")
    return tuple(sorted(files))


def _assert_private_oracle_assets_are_absent(manifest: CaseManifest) -> None:
    if manifest.oracle.visibility != "private":
        return
    root = _resolve_without_reparse(manifest.source_path.parent, label="public case root")
    all_files = _regular_files(root)
    if any(path.name in PRIVATE_ORACLE_FILENAMES for path in all_files):
        raise ValueError("public case tree contains a reserved private-oracle asset")
    public_files = _public_case_files(manifest)
    if set(all_files) != set(public_files):
        raise ValueError("public private case tree contains an unbundled file")


def _read_public_case_bytes(path: Path, *, root: Path | None = None) -> bytes:
    root = root or path.parent
    before = _public_path_chain_identities(root, path)
    try:
        data = path.read_bytes()
    except OSError as error:
        raise ValueError("public case bundle file cannot be read") from error
    if before != _public_path_chain_identities(root, path):
        raise ValueError("public case bundle path changed while snapshotting")
    try:
        content = data.decode("utf-8")
    except UnicodeDecodeError as error:
        raise ValueError("public case bundle contains a non-UTF-8 file") from error
    reject_public_text(content)
    if path.suffix.lower() == ".json":
        reject_public_json_text(content)
    return data


def _public_case_snapshot(
    root: Path,
    files: tuple[Path, ...],
) -> tuple[tuple[Path, bytes], ...]:
    return tuple((path, _read_public_case_bytes(path, root=root)) for path in files)


def public_case_definition_hash(manifest: CaseManifest) -> str:
    root = _resolve_without_reparse(manifest.source_path.parent, label="public case root")
    _assert_private_oracle_assets_are_absent(manifest)
    return _hash_snapshots(root, _public_case_snapshot(root, _public_case_files(manifest)))


def public_case_bundle_relative_paths(manifest: CaseManifest) -> tuple[str, ...]:
    """Return the exact reviewed files that may accompany a public case."""

    root = _resolve_without_reparse(manifest.source_path.parent, label="public case root")
    _assert_private_oracle_assets_are_absent(manifest)
    snapshots = _public_case_snapshot(root, _public_case_files(manifest))
    return tuple(path.relative_to(root).as_posix() for path, _data in snapshots)


def archive_public_case_definition(manifest: CaseManifest, artifact_dir: str | Path) -> str:
    """Archive one validated byte snapshot, not a later re-read of the case tree."""

    _assert_private_oracle_assets_are_absent(manifest)
    source = _resolve_without_reparse(manifest.source_path.parent, label="public case root")
    snapshots = _public_case_snapshot(source, _public_case_files(manifest))
    definition_sha256 = _hash_snapshots(source, snapshots)
    artifact_root = _resolve_without_reparse(artifact_dir, label="public artifact root")
    artifact_root.mkdir(parents=True, exist_ok=True)
    destination = artifact_root / "case-definition"
    if destination.exists():
        raise ValueError("public case archive target already exists")
    temporary = Path(tempfile.mkdtemp(prefix=".case-definition-", dir=artifact_root))
    try:
        for path, data in snapshots:
            target = temporary / path.relative_to(source)
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
        snapshot_files = _regular_files(temporary)
        if _hash_files(temporary, snapshot_files) != definition_sha256:
            raise ValueError("public case archive snapshot hash is inconsistent")
        os.replace(temporary, destination)
        return definition_sha256
    except Exception:
        shutil.rmtree(temporary, ignore_errors=True)
        raise
