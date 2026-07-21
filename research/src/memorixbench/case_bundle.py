from __future__ import annotations

import hashlib
from pathlib import Path
import shutil

from .schema import CaseManifest


def _regular_files(root: Path) -> tuple[Path, ...]:
    if not root.is_dir() or root.is_symlink():
        raise ValueError(f"case definition root must be a regular directory: {root}")
    paths = tuple(sorted(root.rglob("*")))
    if any(path.is_symlink() for path in paths):
        raise ValueError("case definition cannot contain symbolic links")
    return tuple(path for path in paths if path.is_file())


def hash_case_tree(root: str | Path) -> str:
    base = Path(root).resolve()
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


def _public_case_files(manifest: CaseManifest) -> tuple[Path, ...]:
    root = manifest.source_path.parent.resolve()
    if not manifest.public_bundle_paths:
        return _regular_files(root)
    files: set[Path] = set()
    for relative in manifest.public_bundle_paths:
        candidate = (root / relative).resolve()
        if candidate == root or root not in candidate.parents:
            raise ValueError("public bundle path escapes its case directory")
        if candidate.is_symlink():
            raise ValueError("public bundle cannot contain symbolic links")
        if candidate.is_dir():
            files.update(_regular_files(candidate))
        elif candidate.is_file():
            files.add(candidate)
        else:
            raise ValueError(f"declared public bundle path does not exist: {relative}")
    return tuple(sorted(files))


def public_case_definition_hash(manifest: CaseManifest) -> str:
    root = manifest.source_path.parent.resolve()
    return _hash_files(root, _public_case_files(manifest))


def archive_public_case_definition(manifest: CaseManifest, artifact_dir: str | Path) -> str:
    destination = Path(artifact_dir).resolve() / "case-definition"
    source = manifest.source_path.parent.resolve()
    files = _public_case_files(manifest)
    destination.mkdir(parents=True)
    for path in files:
        target = destination / path.relative_to(source)
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(path, target)
    return _hash_files(destination, _regular_files(destination))
