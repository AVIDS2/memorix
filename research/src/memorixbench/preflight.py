from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re


ENVIRONMENT_PREFLIGHT_SCHEMA_VERSION = "candidate-environment-preflight-v1"
IDENTIFIER_PATTERN = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
COMMIT_SHA_PATTERN = re.compile(r"^[0-9a-f]{40}$")
SHA256_PATTERN = re.compile(r"^[0-9a-f]{64}$")
VALID_OFFLINE_POLICIES = {
    "go-proxy-off-v1",
    "node-offline-store-v1",
    "python-index-off-v1",
}
CACHE_PROFILE = "external-artifact-root-v1"


class PreflightError(ValueError):
    """Raised when an environment-preflight receipt is incomplete or inconsistent."""


@dataclass(frozen=True)
class CommandEvidence:
    command: str
    exit_code: int
    log_sha256: str


@dataclass(frozen=True)
class EnvironmentPreflightReceipt:
    schema_version: str
    candidate_id: str
    base_revision: str
    public_transition_revision: str
    bootstrap: CommandEvidence
    offline: CommandEvidence
    runtime: str
    offline_policy: str
    cache_profile: str
    passed: bool
    observed_at_utc: str

    def public_payload(self) -> dict[str, object]:
        return asdict(self)


def _required_text(value: object, *, label: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise PreflightError(f"preflight {label} must be a non-empty string")
    return value.strip()


def _identifier(value: object, *, label: str) -> str:
    text = _required_text(value, label=label)
    if not IDENTIFIER_PATTERN.fullmatch(text):
        raise PreflightError(f"preflight {label} must be a lowercase hyphenated id")
    return text


def _sha256(value: object, *, label: str) -> str:
    text = _required_text(value, label=label)
    if not SHA256_PATTERN.fullmatch(text):
        raise PreflightError(f"preflight {label} must be a lowercase SHA-256")
    return text


def _commit_sha(value: object, *, label: str) -> str:
    text = _required_text(value, label=label)
    if not COMMIT_SHA_PATTERN.fullmatch(text):
        raise PreflightError(f"preflight {label} must be a full lowercase commit SHA")
    return text


def _exit_code(value: object, *, label: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise PreflightError(f"preflight {label} must be a non-negative integer")
    return value


def parse_preflight_timestamp(value: object) -> datetime:
    text = _required_text(value, label="observed_at_utc")
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError as error:
        raise PreflightError("preflight observed_at_utc is invalid") from error
    if parsed.tzinfo is None:
        raise PreflightError("preflight observed_at_utc must include a timezone")
    return parsed.astimezone(timezone.utc)


def _hash_file(path: str | Path) -> str:
    source = Path(path).resolve()
    try:
        return hashlib.sha256(source.read_bytes()).hexdigest()
    except OSError as error:
        raise PreflightError(f"preflight log cannot be read: {source.name}") from error


def write_environment_preflight_receipt(
    *,
    path: str | Path,
    candidate_id: str,
    base_revision: str,
    public_transition_revision: str,
    bootstrap_command: str,
    bootstrap_exit_code: int,
    bootstrap_log: str | Path,
    offline_command: str,
    offline_exit_code: int,
    offline_log: str | Path,
    runtime: str,
    offline_policy: str,
    observed_at_utc: str | None = None,
) -> EnvironmentPreflightReceipt:
    if offline_policy not in VALID_OFFLINE_POLICIES:
        raise PreflightError("preflight offline policy is unsupported")
    receipt = EnvironmentPreflightReceipt(
        schema_version=ENVIRONMENT_PREFLIGHT_SCHEMA_VERSION,
        candidate_id=_identifier(candidate_id, label="candidate_id"),
        base_revision=_commit_sha(base_revision, label="base_revision"),
        public_transition_revision=_commit_sha(
            public_transition_revision,
            label="public_transition_revision",
        ),
        bootstrap=CommandEvidence(
            command=_required_text(bootstrap_command, label="bootstrap_command"),
            exit_code=_exit_code(bootstrap_exit_code, label="bootstrap_exit_code"),
            log_sha256=_hash_file(bootstrap_log),
        ),
        offline=CommandEvidence(
            command=_required_text(offline_command, label="offline_command"),
            exit_code=_exit_code(offline_exit_code, label="offline_exit_code"),
            log_sha256=_hash_file(offline_log),
        ),
        runtime=_required_text(runtime, label="runtime"),
        offline_policy=offline_policy,
        cache_profile=CACHE_PROFILE,
        passed=bootstrap_exit_code == 0 and offline_exit_code == 0,
        observed_at_utc=parse_preflight_timestamp(
            observed_at_utc or datetime.now(timezone.utc).isoformat()
        ).isoformat(),
    )
    target = Path(path).resolve()
    if target.exists():
        raise PreflightError("preflight receipt path already exists")
    target.parent.mkdir(parents=True, exist_ok=True)
    with target.open("w", encoding="utf-8", newline="\n") as handle:
        handle.write(json.dumps(receipt.public_payload(), indent=2, ensure_ascii=False) + "\n")
    return receipt


def _command_evidence(value: object, *, label: str) -> CommandEvidence:
    if not isinstance(value, dict) or set(value) != {"command", "exit_code", "log_sha256"}:
        raise PreflightError(f"preflight {label} is invalid")
    return CommandEvidence(
        command=_required_text(value.get("command"), label=f"{label}.command"),
        exit_code=_exit_code(value.get("exit_code"), label=f"{label}.exit_code"),
        log_sha256=_sha256(value.get("log_sha256"), label=f"{label}.log_sha256"),
    )


def load_environment_preflight_receipt(path: str | Path) -> EnvironmentPreflightReceipt:
    source = Path(path).resolve()
    try:
        raw = json.loads(source.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise PreflightError("preflight receipt cannot be read") from error
    if not isinstance(raw, dict):
        raise PreflightError("preflight receipt must be an object")
    expected = {
        "schema_version",
        "candidate_id",
        "base_revision",
        "public_transition_revision",
        "bootstrap",
        "offline",
        "runtime",
        "offline_policy",
        "cache_profile",
        "passed",
        "observed_at_utc",
    }
    if set(raw) != expected or raw.get("schema_version") != ENVIRONMENT_PREFLIGHT_SCHEMA_VERSION:
        raise PreflightError("preflight receipt has an unsupported schema")
    offline_policy = _required_text(raw.get("offline_policy"), label="offline_policy")
    if offline_policy not in VALID_OFFLINE_POLICIES:
        raise PreflightError("preflight receipt offline policy is unsupported")
    if raw.get("cache_profile") != CACHE_PROFILE:
        raise PreflightError("preflight receipt cache profile is unsupported")
    bootstrap = _command_evidence(raw.get("bootstrap"), label="bootstrap")
    offline = _command_evidence(raw.get("offline"), label="offline")
    passed = raw.get("passed")
    if not isinstance(passed, bool) or passed != (bootstrap.exit_code == 0 and offline.exit_code == 0):
        raise PreflightError("preflight receipt passed state is inconsistent")
    return EnvironmentPreflightReceipt(
        schema_version=ENVIRONMENT_PREFLIGHT_SCHEMA_VERSION,
        candidate_id=_identifier(raw.get("candidate_id"), label="candidate_id"),
        base_revision=_commit_sha(raw.get("base_revision"), label="base_revision"),
        public_transition_revision=_commit_sha(
            raw.get("public_transition_revision"),
            label="public_transition_revision",
        ),
        bootstrap=bootstrap,
        offline=offline,
        runtime=_required_text(raw.get("runtime"), label="runtime"),
        offline_policy=offline_policy,
        cache_profile=CACHE_PROFILE,
        passed=passed,
        observed_at_utc=parse_preflight_timestamp(raw.get("observed_at_utc")).isoformat(),
    )
