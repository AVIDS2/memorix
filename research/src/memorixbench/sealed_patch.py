from __future__ import annotations

from dataclasses import dataclass
import hashlib
from pathlib import Path
import re


MAX_SEALED_PATCH_BYTES = 2 * 1024 * 1024
DIFF_HEADER_PATTERN = re.compile(r"^diff --git a/([^\s]+) b/([^\s]+)$")
FILE_HEADER_PATTERN = re.compile(r"^(---|\+\+\+) (.+?)(?:\t.*)?$")


class SealedPatchError(ValueError):
    """Raised when a worker patch is unsafe or unsuitable for vault grading."""


@dataclass(frozen=True)
class SealedPatch:
    path: Path
    sha256: str
    byte_count: int
    changed_paths: tuple[str, ...]


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _validate_relative_path(path: str) -> str:
    if not path or path.startswith("/") or "\\" in path:
        raise SealedPatchError("sealed patch paths must be relative POSIX paths")
    parts = Path(path).parts
    if not parts or ".." in parts or ".git" in parts:
        raise SealedPatchError("sealed patch paths must not escape or modify Git metadata")
    return Path(path).as_posix()


def _parse_diff_headers(text: str) -> tuple[str, ...]:
    changed_paths: list[str] = []
    for line in text.splitlines():
        if line.startswith("diff --git "):
            match = DIFF_HEADER_PATTERN.fullmatch(line)
            if not match:
                raise SealedPatchError("sealed patch has an unsupported diff header")
            left = _validate_relative_path(match.group(1))
            right = _validate_relative_path(match.group(2))
            changed_paths.extend((left, right))
            continue
        match = FILE_HEADER_PATTERN.fullmatch(line)
        if match is None:
            continue
        target = match.group(2)
        if target == "/dev/null":
            continue
        if not (target.startswith("a/") or target.startswith("b/")):
            raise SealedPatchError("sealed patch file headers must use Git-relative paths")
        _validate_relative_path(target[2:])
    return tuple(dict.fromkeys(changed_paths))


def seal_patch(
    path: str | Path,
    *,
    max_bytes: int = MAX_SEALED_PATCH_BYTES,
) -> SealedPatch:
    """Validate a worker-produced textual Git patch before vault transfer."""

    candidate = Path(path)
    if not candidate.is_file() or candidate.is_symlink():
        raise SealedPatchError("sealed patch must be a regular file")
    data = candidate.read_bytes()
    if len(data) > max_bytes:
        raise SealedPatchError("sealed patch exceeds the configured size limit")
    if b"\0" in data or b"GIT binary patch" in data:
        raise SealedPatchError("sealed patch must not contain binary payloads")
    try:
        text = data.decode("utf-8")
    except UnicodeDecodeError as error:
        raise SealedPatchError("sealed patch must be UTF-8 text") from error
    changed_paths = _parse_diff_headers(text)
    return SealedPatch(
        path=candidate.resolve(),
        sha256=_sha256(data),
        byte_count=len(data),
        changed_paths=changed_paths,
    )


def snapshot_sealed_patch(source: SealedPatch, destination: str | Path) -> SealedPatch:
    """Copy a checked worker patch into the vault and revalidate its exact bytes."""

    target = Path(destination)
    if target.exists():
        raise SealedPatchError("sealed patch snapshot destination already exists")
    if not source.path.is_file() or source.path.is_symlink():
        raise SealedPatchError("worker sealed patch is no longer a regular file")
    data = source.path.read_bytes()
    if _sha256(data) != source.sha256 or len(data) != source.byte_count:
        raise SealedPatchError("worker sealed patch changed after sealing")
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(data)
    try:
        return seal_patch(target)
    except Exception:
        target.unlink(missing_ok=True)
        raise
