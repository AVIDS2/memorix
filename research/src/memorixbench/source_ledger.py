from __future__ import annotations

from dataclasses import asdict, dataclass
from collections import Counter
import hashlib
from pathlib import Path
import re
import subprocess
import tomllib
from urllib.parse import urlparse


SOURCE_LEDGER_SCHEMA_VERSION = "0.1"
IDENTIFIER_PATTERN = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
COMMIT_SHA_PATTERN = re.compile(r"^[0-9a-f]{40}$")
SHA256_PATTERN = re.compile(r"^[0-9a-f]{64}$")
ALLOWED_LICENSES = {"Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "ISC", "MIT"}
VALID_STATUSES = {"screening", "deferred", "rejected", "admitted"}
VALID_CAUSAL_CHAINS = {
    "issue-pr",
    "pr-chain",
    "release-regression",
    "review-revision",
    "standalone-pr",
}
VALID_ENVIRONMENT_READINESS = {"unverified", "offline-ready", "blocked"}
VALID_BENCHMARK_OVERLAP = {"unreviewed", "none-confirmed", "known-benchmark"}
VALID_TRANSITION_PLANS = {"not-designed", "private-post-snapshot", "reuse-public-fix"}
VALID_MODEL_EXPOSURE = {"public-history-possible", "public-history-documented"}
VALID_BASE_SELECTIONS = {"first-parent-of-public-transition"}


class SourceLedgerError(ValueError):
    """Raised when a source candidate cannot support the declared corpus status."""


@dataclass(frozen=True)
class SourceLedgerEntry:
    candidate_id: str
    status: str
    language: str
    repository_family_id: str
    repository_url: str
    base_revision: str
    public_transition_revision: str
    base_selection: str
    license_spdx: str
    license_path: str
    license_url: str
    license_sha256: str
    source_urls: tuple[str, ...]
    causal_chain: str
    environment_readiness: str
    benchmark_overlap: str
    model_exposure: str
    public_solution_exists: bool
    transition_plan: str
    decision_rationale: str


@dataclass(frozen=True)
class SourceLedger:
    ledger_id: str
    entries: tuple[SourceLedgerEntry, ...]
    source_path: Path


@dataclass(frozen=True)
class SourceLedgerValidation:
    ledger_id: str
    entry_count: int
    status_counts: dict[str, int]
    candidate_ids: tuple[str, ...]

    def public_payload(self) -> dict[str, object]:
        return asdict(self)


@dataclass(frozen=True)
class SourceAudit:
    candidate_id: str
    repository_origin: str
    base_revision: str
    public_transition_revision: str
    license_path: str
    license_sha256: str
    origin_matches: bool
    base_matches_public_parent: bool
    license_matches: bool

    def public_payload(self) -> dict[str, object]:
        return asdict(self)


def _required_text(value: object, *, label: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise SourceLedgerError(f"source ledger {label} must be a non-empty string")
    return value.strip()


def _identifier(value: object, *, label: str) -> str:
    text = _required_text(value, label=label)
    if not IDENTIFIER_PATTERN.fullmatch(text):
        raise SourceLedgerError(f"source ledger {label} must be a lowercase hyphenated id")
    return text


def _choice(value: object, *, label: str, allowed: set[str]) -> str:
    text = _required_text(value, label=label)
    if text not in allowed:
        raise SourceLedgerError(f"source ledger {label} is unsupported")
    return text


def _url(value: object, *, label: str) -> str:
    text = _required_text(value, label=label)
    parsed = urlparse(text)
    if parsed.scheme != "https" or not parsed.netloc:
        raise SourceLedgerError(f"source ledger {label} must be an HTTPS URL")
    return text


def _urls(value: object, *, label: str) -> tuple[str, ...]:
    if not isinstance(value, list) or not value:
        raise SourceLedgerError(f"source ledger {label} must be a non-empty list")
    urls = tuple(_url(item, label=label) for item in value)
    if len(urls) != len(set(urls)):
        raise SourceLedgerError(f"source ledger {label} cannot contain duplicates")
    return urls


def _commit_sha(value: object, *, label: str) -> str:
    text = _required_text(value, label=label)
    if not COMMIT_SHA_PATTERN.fullmatch(text):
        raise SourceLedgerError(f"source ledger {label} must be a full lowercase commit SHA")
    return text


def _sha256(value: object, *, label: str) -> str:
    text = _required_text(value, label=label)
    if not SHA256_PATTERN.fullmatch(text):
        raise SourceLedgerError(f"source ledger {label} must be a lowercase SHA-256")
    return text


def _boolean(value: object, *, label: str) -> bool:
    if not isinstance(value, bool):
        raise SourceLedgerError(f"source ledger {label} must be a boolean")
    return value


def _relative_path(value: object, *, label: str) -> str:
    text = _required_text(value, label=label)
    path = Path(text)
    if path.is_absolute() or ".." in path.parts:
        raise SourceLedgerError(f"source ledger {label} must stay inside the repository")
    return path.as_posix()


def _normalized_git_url(value: str) -> str:
    return value.rstrip("/").removesuffix(".git")


def _run_git_bytes(cwd: Path, *args: str) -> bytes:
    completed = subprocess.run(
        ["git", *args],
        cwd=cwd,
        check=True,
        capture_output=True,
    )
    return completed.stdout


def load_source_ledger(path: str | Path) -> SourceLedger:
    source = Path(path).resolve()
    try:
        raw = tomllib.loads(source.read_text(encoding="utf-8"))
    except (OSError, tomllib.TOMLDecodeError) as error:
        raise SourceLedgerError("source ledger cannot be read") from error
    if raw.get("schema_version") != SOURCE_LEDGER_SCHEMA_VERSION:
        raise SourceLedgerError("unsupported source ledger schema")
    if set(raw) != {"schema_version", "ledger_id", "candidate"}:
        raise SourceLedgerError("source ledger has unexpected top-level fields")
    candidates = raw.get("candidate")
    if not isinstance(candidates, list) or not candidates:
        raise SourceLedgerError("source ledger must contain at least one [[candidate]] entry")
    entries: list[SourceLedgerEntry] = []
    expected_fields = {
        "id",
        "status",
        "language",
        "repository_family_id",
        "repository_url",
        "base_revision",
        "public_transition_revision",
        "base_selection",
        "license_spdx",
        "license_path",
        "license_url",
        "license_sha256",
        "source_urls",
        "causal_chain",
        "environment_readiness",
        "benchmark_overlap",
        "model_exposure",
        "public_solution_exists",
        "transition_plan",
        "decision_rationale",
    }
    for candidate in candidates:
        if not isinstance(candidate, dict) or set(candidate) != expected_fields:
            raise SourceLedgerError("source ledger candidate has unexpected fields")
        license_spdx = _required_text(candidate.get("license_spdx"), label="license_spdx")
        if license_spdx not in ALLOWED_LICENSES:
            raise SourceLedgerError("source ledger candidate uses a disallowed license")
        entries.append(SourceLedgerEntry(
            candidate_id=_identifier(candidate.get("id"), label="id"),
            status=_choice(candidate.get("status"), label="status", allowed=VALID_STATUSES),
            language=_identifier(candidate.get("language"), label="language"),
            repository_family_id=_identifier(
                candidate.get("repository_family_id"),
                label="repository_family_id",
            ),
            repository_url=_url(candidate.get("repository_url"), label="repository_url"),
            base_revision=_commit_sha(candidate.get("base_revision"), label="base_revision"),
            public_transition_revision=_commit_sha(
                candidate.get("public_transition_revision"),
                label="public_transition_revision",
            ),
            base_selection=_choice(
                candidate.get("base_selection"),
                label="base_selection",
                allowed=VALID_BASE_SELECTIONS,
            ),
            license_spdx=license_spdx,
            license_path=_relative_path(candidate.get("license_path"), label="license_path"),
            license_url=_url(candidate.get("license_url"), label="license_url"),
            license_sha256=_sha256(candidate.get("license_sha256"), label="license_sha256"),
            source_urls=_urls(candidate.get("source_urls"), label="source_urls"),
            causal_chain=_choice(
                candidate.get("causal_chain"),
                label="causal_chain",
                allowed=VALID_CAUSAL_CHAINS,
            ),
            environment_readiness=_choice(
                candidate.get("environment_readiness"),
                label="environment_readiness",
                allowed=VALID_ENVIRONMENT_READINESS,
            ),
            benchmark_overlap=_choice(
                candidate.get("benchmark_overlap"),
                label="benchmark_overlap",
                allowed=VALID_BENCHMARK_OVERLAP,
            ),
            model_exposure=_choice(
                candidate.get("model_exposure"),
                label="model_exposure",
                allowed=VALID_MODEL_EXPOSURE,
            ),
            public_solution_exists=_boolean(
                candidate.get("public_solution_exists"),
                label="public_solution_exists",
            ),
            transition_plan=_choice(
                candidate.get("transition_plan"),
                label="transition_plan",
                allowed=VALID_TRANSITION_PLANS,
            ),
            decision_rationale=_required_text(
                candidate.get("decision_rationale"),
                label="decision_rationale",
            ),
        ))
    ids = [entry.candidate_id for entry in entries]
    if len(ids) != len(set(ids)):
        raise SourceLedgerError("source ledger has duplicate candidate ids")
    return SourceLedger(
        ledger_id=_identifier(raw.get("ledger_id"), label="ledger_id"),
        entries=tuple(entries),
        source_path=source,
    )


def _require_admission_invariants(entry: SourceLedgerEntry) -> None:
    if entry.status != "admitted":
        return
    if entry.environment_readiness != "offline-ready":
        raise SourceLedgerError("admitted source candidate must be offline-ready")
    if entry.benchmark_overlap != "none-confirmed":
        raise SourceLedgerError("admitted source candidate needs benchmark-overlap review")
    if entry.transition_plan != "private-post-snapshot":
        raise SourceLedgerError("admitted source candidate needs a private post-snapshot transition")


def validate_source_ledger(ledger: SourceLedger) -> SourceLedgerValidation:
    for entry in ledger.entries:
        _require_admission_invariants(entry)
    status_counts = Counter(entry.status for entry in ledger.entries)
    return SourceLedgerValidation(
        ledger_id=ledger.ledger_id,
        entry_count=len(ledger.entries),
        status_counts=dict(sorted(status_counts.items())),
        candidate_ids=tuple(sorted(entry.candidate_id for entry in ledger.entries)),
    )


def audit_source_candidate(
    ledger: SourceLedger,
    *,
    candidate_id: str,
    repository_cache: str | Path,
) -> SourceAudit:
    candidate = next(
        (entry for entry in ledger.entries if entry.candidate_id == candidate_id),
        None,
    )
    if candidate is None:
        raise SourceLedgerError(f"source ledger candidate is unknown: {candidate_id}")
    cache = Path(repository_cache).resolve()
    if not cache.is_dir():
        raise SourceLedgerError("source repository cache does not exist")
    try:
        origin = _run_git_bytes(cache, "remote", "get-url", "origin").decode(
            "utf-8",
            errors="replace",
        ).strip()
        _run_git_bytes(cache, "cat-file", "-e", f"{candidate.base_revision}^{{commit}}")
        public_parent = _run_git_bytes(
            cache,
            "rev-parse",
            f"{candidate.public_transition_revision}^1",
        ).decode("utf-8", errors="replace").strip()
        license_bytes = _run_git_bytes(
            cache,
            "show",
            f"{candidate.base_revision}:{candidate.license_path}",
        )
    except subprocess.CalledProcessError as error:
        details = (error.stderr or error.stdout or b"invalid repository cache").decode(
            "utf-8",
            errors="replace",
        ).strip()
        raise SourceLedgerError(f"invalid source repository cache: {details}") from error
    license_sha256 = hashlib.sha256(license_bytes).hexdigest()
    origin_matches = _normalized_git_url(origin) == _normalized_git_url(candidate.repository_url)
    base_matches_public_parent = public_parent == candidate.base_revision
    license_matches = license_sha256 == candidate.license_sha256
    if not origin_matches:
        raise SourceLedgerError("source repository cache origin does not match ledger")
    if not base_matches_public_parent:
        raise SourceLedgerError("source ledger base is not the public transition first parent")
    if not license_matches:
        raise SourceLedgerError("source repository license bytes do not match ledger")
    return SourceAudit(
        candidate_id=candidate.candidate_id,
        repository_origin=origin,
        base_revision=candidate.base_revision,
        public_transition_revision=candidate.public_transition_revision,
        license_path=candidate.license_path,
        license_sha256=license_sha256,
        origin_matches=origin_matches,
        base_matches_public_parent=base_matches_public_parent,
        license_matches=license_matches,
    )
