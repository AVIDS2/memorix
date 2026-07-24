from __future__ import annotations

import json
from pathlib import Path
import re
from typing import Iterable


GENERIC_SECRET_ASSIGNMENT_PATTERN = re.compile(
    r"(?i)(?:api[_-]?key|auth[_-]?token|password|secret)\s*[:=]\s*(?P<value>\S+)"
)
SAFE_RUNTIME_SECRET_REFERENCE_PATTERN = re.compile(
    r"(?i)^(?:"
    r"os\.(?:environ|getenv)"
    r"|process\.env"
    r"|environ\.get"
    r"|getenv\s*\("
    r"|[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)+"
    r"|[A-Za-z_][A-Za-z0-9_]*\s*\("
    r"|(?:str|bytes|None)\b"
    r")"
)

SECRET_REDACTIONS = (
    (GENERIC_SECRET_ASSIGNMENT_PATTERN, "[REDACTED_SECRET]"),
    (re.compile(r"(?i)bearer\s+[a-z0-9._~+/=-]{16,}"), "Bearer [REDACTED]"),
    (re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----"), "[REDACTED_PRIVATE_KEY]"),
    (re.compile(r"(?<![A-Za-z0-9])sk-[A-Za-z0-9_-]{20,}"), "[REDACTED_SECRET]"),
    (
        re.compile(r"(?<![A-Za-z0-9_])gh(?:p|o|u|s|r)_[A-Za-z0-9_]{20,}"),
        "[REDACTED_GITHUB_TOKEN]",
    ),
    (
        re.compile(r"(?<![A-Za-z0-9_])github_pat_[A-Za-z0-9_]{20,}"),
        "[REDACTED_GITHUB_TOKEN]",
    ),
    (re.compile(r"(?<![A-Za-z0-9_])npm_[A-Za-z0-9]{20,}"), "[REDACTED_NPM_TOKEN]"),
    (
        re.compile(r"\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b"),
        "[REDACTED_JWT]",
    ),
)
SECRET_PATTERNS = tuple(pattern for pattern, _replacement in SECRET_REDACTIONS)

# Match the full host-path token rather than only its prefix. The character set
# intentionally permits spaces so a Windows home directory is not partly left
# behind after redaction. Newlines and markup delimiters terminate a path.
#
# A bare ``\\`` is not a UNC path: it is also a common LaTeX row break. Require
# either a device-prefixed drive path or both a UNC host and share name.
UNC_COMPONENT_PATTERN = r"[A-Za-z0-9][^\\/\r\n\"'`<>|]*"
POSIX_HOST_ROOT_PATTERN = (
    r"(?:Users|home|tmp|private" + r"/" + r"tmp|var" + r"/" + r"folders|mnt/[a-z])"
)
HOST_PATH_PATTERN = re.compile(
    r"(?ix)(?:"
    r"(?<![A-Za-z0-9])[a-z]:[\\/][^\r\n\"'`<>|]*"
    r"|\\\\(?:\?\\)?(?:"
    r"[a-z]:[\\/][^\r\n\"'`<>|]*"
    r"|" + UNC_COMPONENT_PATTERN + r"[\\/]" + UNC_COMPONENT_PATTERN + r"(?:[\\/][^\r\n\"'`<>|]*)?"
    r")"
    r"|/" + POSIX_HOST_ROOT_PATTERN + r"(?:/[^\r\n\"'`<>|]*)?"
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
    if _contains_credential_like_content(content):
        raise PublicSafetyError("public artifact contains credential-like content")


def _contains_credential_like_content(content: str) -> bool:
    for match in GENERIC_SECRET_ASSIGNMENT_PATTERN.finditer(content):
        if not SAFE_RUNTIME_SECRET_REFERENCE_PATTERN.match(match.group("value")):
            return True
    return any(pattern.search(content) for pattern in SECRET_PATTERNS[1:])


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
