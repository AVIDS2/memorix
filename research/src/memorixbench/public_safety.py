from __future__ import annotations

import json
from pathlib import Path
import re
from typing import Iterable


SECRET_REDACTIONS = (
    (
        re.compile(r"(?i)(?:api[_-]?key|auth[_-]?token|password|secret)\s*[:=]\s*\S+"),
        "[REDACTED_SECRET]",
    ),
    (re.compile(r"(?i)bearer\s+[a-z0-9._~+/=-]{16,}"), "Bearer [REDACTED]"),
    (re.compile(r"-----BEGIN [A-Z ]+-----"), "[REDACTED_PRIVATE_KEY]"),
    (re.compile(r"(?<![A-Za-z0-9])sk-[A-Za-z0-9_-]{20,}"), "[REDACTED_SECRET]"),
    (
        re.compile(r"\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b"),
        "[REDACTED_JWT]",
    ),
)
SECRET_PATTERNS = tuple(pattern for pattern, _replacement in SECRET_REDACTIONS)

# Match the full host-path token rather than only its prefix. The character set
# intentionally permits spaces so a Windows home directory is not partly left
# behind after redaction. Newlines and markup delimiters terminate a path.
HOST_PATH_PATTERN = re.compile(
    r"(?ix)(?:"
    r"[a-z]:[\\/][^\r\n\"'`<>|]*"
    r"|\\\\(?:\?\\)?[^\r\n\"'`<>|]*"
    r"|/(?:Users|home|tmp|private/tmp|var/folders|mnt/[a-z])(?:/[^\r\n\"'`<>|]*)?"
    r")"
)


class PublicSafetyError(ValueError):
    """Raised when a proposed public artifact still contains sensitive text."""


def _workspace_variants(workspace_roots: Iterable[Path]) -> tuple[str, ...]:
    variants: set[str] = set()
    for root in workspace_roots:
        resolved = root.resolve()
        variants.update((str(resolved), resolved.as_posix()))
    return tuple(sorted((value for value in variants if value), key=len, reverse=True))


def sanitize_public_text(
    content: str,
    *,
    workspace_roots: Iterable[Path],
) -> tuple[str, int]:
    if "\0" in content:
        raise PublicSafetyError("public artifact content contains a NUL byte")
    sanitized = content.replace("\r\n", "\n").replace("\r", "\n")
    redaction_count = 0
    for variant in _workspace_variants(workspace_roots):
        sanitized, count = re.subn(
            re.escape(variant),
            "<WORKSPACE>",
            sanitized,
            flags=re.IGNORECASE,
        )
        redaction_count += count
    sanitized, count = HOST_PATH_PATTERN.subn("<ABSOLUTE_PATH>", sanitized)
    redaction_count += count
    for pattern, replacement in SECRET_REDACTIONS:
        sanitized, count = pattern.subn(replacement, sanitized)
        redaction_count += count
    if not sanitized.strip():
        raise PublicSafetyError("captured event became empty after redaction")
    return sanitized, redaction_count


def reject_public_text(content: str) -> None:
    if "\0" in content:
        raise PublicSafetyError("public artifact contains a NUL byte")
    if HOST_PATH_PATTERN.search(content):
        raise PublicSafetyError("public artifact contains an absolute host path")
    if any(pattern.search(content) for pattern in SECRET_PATTERNS):
        raise PublicSafetyError("public artifact contains credential-like content")


def reject_public_json_payload(payload: object) -> None:
    """Reject sensitive strings in a decoded public JSON artifact.

    Paths must be checked after JSON decoding: a raw Windows JSON escape such
    as ``\\n`` can otherwise resemble the beginning of a UNC path to a regex.
    """

    if isinstance(payload, str):
        reject_public_text(payload)
        return
    if isinstance(payload, dict):
        for key, value in payload.items():
            if not isinstance(key, str):
                raise PublicSafetyError("public JSON object key is not text")
            reject_public_text(key)
            reject_public_json_payload(value)
        return
    if isinstance(payload, list):
        for value in payload:
            reject_public_json_payload(value)
        return
    if payload is None or isinstance(payload, (bool, int, float)):
        return
    raise PublicSafetyError("public JSON artifact contains an unsupported value")


def reject_public_json_text(content: str) -> None:
    """Decode a JSON artifact and check its semantic text fields for secrets."""

    try:
        payload = json.loads(content)
    except json.JSONDecodeError as error:
        raise PublicSafetyError("public artifact is not valid JSON") from error
    reject_public_json_payload(payload)


def contains_sensitive_value(content: str, values: Iterable[str]) -> bool:
    """Check injected secret values without returning them in diagnostics."""

    return any(value and value in content for value in values)
