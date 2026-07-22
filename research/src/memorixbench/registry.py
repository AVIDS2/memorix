from __future__ import annotations

from dataclasses import asdict, dataclass
import hashlib
from pathlib import Path
import re
import tomllib

from .case_bundle import public_case_definition_hash
from .schema import CaseManifest, load_case_manifest
from .trace import TraceError, load_trace_bundle


CASE_REGISTRY_SCHEMA_VERSION = "0.3"
VALID_ENROLLMENTS = {"development-pilot", "confirmatory"}
VALID_CORPUS_SPLITS = {"development", "validation", "test"}
VALID_SOURCE_CLASSES = {"local-fixture", "public-repository"}
VALID_CONTAMINATION_RISKS = {
    "local-fixture",
    "public-history-possible",
    "public-history-documented",
}
VALID_TRANSITION_EXPOSURES = {
    "development-controlled",
    "historical-public",
    "post-snapshot-private",
}
IDENTIFIER_PATTERN = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")


class CaseRegistryError(ValueError):
    """Raised when a frozen case registry no longer matches its public cases."""


@dataclass(frozen=True)
class CaseRegistryEntry:
    case_id: str
    path: str
    enrollment: str
    case_definition_sha256: str
    corpus_split: str
    repository_family_id: str
    task_family_id: str
    trace_family_id: str
    authoring_batch: str
    source_class: str
    contamination_risk: str
    transition_exposure: str
    dependency_rationale: str
    minimal_sufficient_evidence: str
    plausible_distractor: str
    no_memory_expectation: str
    captured_trace_count: int


@dataclass(frozen=True)
class CaseRegistry:
    schema_version: str
    registry_id: str
    entries: tuple[CaseRegistryEntry, ...]
    source_path: Path

    @property
    def sha256(self) -> str:
        return hashlib.sha256(self.source_path.read_bytes()).hexdigest()


@dataclass(frozen=True)
class CaseRegistryValidation:
    registry_id: str
    registry_sha256: str
    entry_count: int
    development_pilot_count: int
    confirmatory_count: int
    repository_family_count: int
    task_family_count: int
    trace_family_count: int
    case_ids: tuple[str, ...]

    def public_payload(self) -> dict[str, object]:
        return asdict(self)


def _required_text(value: object, *, label: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise CaseRegistryError(f"case registry {label} must be a non-empty string")
    return value.strip()


def _relative_case_path(value: str) -> Path:
    path = Path(value)
    if path.is_absolute() or ".." in path.parts:
        raise CaseRegistryError("case registry path must stay under the cases root")
    if path.name != "case.toml":
        raise CaseRegistryError("case registry entries must point to case.toml")
    return path


def _identifier(value: object, *, label: str) -> str:
    text = _required_text(value, label=label)
    if not IDENTIFIER_PATTERN.fullmatch(text):
        raise CaseRegistryError(f"case registry {label} must be a lowercase hyphenated id")
    return text


def _sha256(value: object, *, label: str) -> str:
    digest = _required_text(value, label=label)
    if len(digest) != 64 or any(character not in "0123456789abcdef" for character in digest):
        raise CaseRegistryError(f"case registry {label} must be a lowercase SHA-256")
    return digest


def _nonnegative_integer(value: object, *, label: str) -> int:
    if not isinstance(value, int) or isinstance(value, bool) or value < 0:
        raise CaseRegistryError(f"case registry {label} must be a non-negative integer")
    return value


def _choice(value: object, *, label: str, allowed: set[str]) -> str:
    text = _required_text(value, label=label)
    if text not in allowed:
        raise CaseRegistryError(f"case registry {label} is unsupported")
    return text


def load_case_registry(path: str | Path) -> CaseRegistry:
    source = Path(path).resolve()
    try:
        raw = tomllib.loads(source.read_text(encoding="utf-8"))
    except (OSError, tomllib.TOMLDecodeError) as error:
        raise CaseRegistryError("case registry cannot be read") from error
    if raw.get("schema_version") != CASE_REGISTRY_SCHEMA_VERSION:
        raise CaseRegistryError("unsupported case registry schema")
    if set(raw) not in (
        {"schema_version", "registry_id"},
        {"schema_version", "registry_id", "case"},
    ):
        raise CaseRegistryError("case registry has unexpected top-level fields")
    entries_raw = raw.get("case", [])
    if not isinstance(entries_raw, list):
        raise CaseRegistryError("case registry entries must be an array of tables")
    entries: list[CaseRegistryEntry] = []
    for entry_raw in entries_raw:
        if not isinstance(entry_raw, dict):
            raise CaseRegistryError("case registry entry must be a table")
        expected = {
            "id",
            "path",
            "enrollment",
            "case_definition_sha256",
            "corpus_split",
            "repository_family_id",
            "task_family_id",
            "trace_family_id",
            "authoring_batch",
            "source_class",
            "contamination_risk",
            "transition_exposure",
            "dependency_rationale",
            "minimal_sufficient_evidence",
            "plausible_distractor",
            "no_memory_expectation",
            "captured_trace_count",
        }
        if set(entry_raw) != expected:
            raise CaseRegistryError("case registry entry has unexpected fields")
        enrollment = _choice(
            entry_raw.get("enrollment"),
            label="enrollment",
            allowed=VALID_ENROLLMENTS,
        )
        path_text = _required_text(entry_raw.get("path"), label="path")
        _relative_case_path(path_text)
        entries.append(CaseRegistryEntry(
            case_id=_identifier(entry_raw.get("id"), label="id"),
            path=path_text,
            enrollment=enrollment,
            case_definition_sha256=_sha256(
                entry_raw.get("case_definition_sha256"),
                label="case_definition_sha256",
            ),
            corpus_split=_choice(
                entry_raw.get("corpus_split"),
                label="corpus_split",
                allowed=VALID_CORPUS_SPLITS,
            ),
            repository_family_id=_identifier(
                entry_raw.get("repository_family_id"),
                label="repository_family_id",
            ),
            task_family_id=_identifier(
                entry_raw.get("task_family_id"),
                label="task_family_id",
            ),
            trace_family_id=_identifier(
                entry_raw.get("trace_family_id"),
                label="trace_family_id",
            ),
            authoring_batch=_identifier(
                entry_raw.get("authoring_batch"),
                label="authoring_batch",
            ),
            source_class=_choice(
                entry_raw.get("source_class"),
                label="source_class",
                allowed=VALID_SOURCE_CLASSES,
            ),
            contamination_risk=_choice(
                entry_raw.get("contamination_risk"),
                label="contamination_risk",
                allowed=VALID_CONTAMINATION_RISKS,
            ),
            transition_exposure=_choice(
                entry_raw.get("transition_exposure"),
                label="transition_exposure",
                allowed=VALID_TRANSITION_EXPOSURES,
            ),
            dependency_rationale=_required_text(
                entry_raw.get("dependency_rationale"),
                label="dependency_rationale",
            ),
            minimal_sufficient_evidence=_required_text(
                entry_raw.get("minimal_sufficient_evidence"),
                label="minimal_sufficient_evidence",
            ),
            plausible_distractor=_required_text(
                entry_raw.get("plausible_distractor"),
                label="plausible_distractor",
            ),
            no_memory_expectation=_required_text(
                entry_raw.get("no_memory_expectation"),
                label="no_memory_expectation",
            ),
            captured_trace_count=_nonnegative_integer(
                entry_raw.get("captured_trace_count"),
                label="captured_trace_count",
            ),
        ))
    ids = [entry.case_id for entry in entries]
    if len(ids) != len(set(ids)):
        raise CaseRegistryError("case registry has duplicate case ids")
    paths = [entry.path for entry in entries]
    if len(paths) != len(set(paths)):
        raise CaseRegistryError("case registry has duplicate case paths")
    return CaseRegistry(
        schema_version=CASE_REGISTRY_SCHEMA_VERSION,
        registry_id=_required_text(raw.get("registry_id"), label="registry_id"),
        entries=tuple(entries),
        source_path=source,
    )


def _require_enrollment_invariants(entry: CaseRegistryEntry, manifest: CaseManifest) -> None:
    if entry.corpus_split != manifest.split:
        raise CaseRegistryError("case registry corpus split does not match case manifest")
    expected_source_class = (
        "public-repository" if manifest.repository.source_type == "git" else "local-fixture"
    )
    if entry.source_class != expected_source_class:
        raise CaseRegistryError("case registry source class does not match case manifest")
    if entry.source_class == "local-fixture" and entry.contamination_risk != "local-fixture":
        raise CaseRegistryError("local-fixture entry must disclose local-fixture contamination risk")
    if entry.source_class == "public-repository" and entry.contamination_risk == "local-fixture":
        raise CaseRegistryError("public-repository entry cannot use local-fixture contamination risk")
    if entry.enrollment == "development-pilot":
        if manifest.split != "development":
            raise CaseRegistryError("development-pilot entry must use development split")
        if manifest.dependency_classification_status != "retrospective-development":
            raise CaseRegistryError("development-pilot entry must be retrospective-development")
        if entry.transition_exposure != "development-controlled":
            raise CaseRegistryError("development-pilot entry must disclose development-controlled transition")
        if manifest.study_track == "B":
            if entry.captured_trace_count != 0:
                raise CaseRegistryError("seeded development-pilot entry cannot declare captured traces")
            return
        if manifest.formation_track != "trace-replay" or manifest.precursor_trace_bundle is None:
            raise CaseRegistryError(
                "Track C development-pilot entry must use a captured trace bundle"
            )
        try:
            bundle = load_trace_bundle(manifest)
        except TraceError as error:
            raise CaseRegistryError("development trace bundle is invalid") from error
        if entry.captured_trace_count != len(bundle.entries) or entry.captured_trace_count < 2:
            raise CaseRegistryError(
                "Track C development-pilot entry must declare every bundled capture"
            )
        return
    if manifest.split not in {"validation", "test"}:
        raise CaseRegistryError("confirmatory registry entry must use validation or test split")
    if manifest.dependency_classification_status != "preregistered":
        raise CaseRegistryError("confirmatory registry entry must be preregistered")
    if manifest.oracle.visibility != "private":
        raise CaseRegistryError("confirmatory registry entry must use a private oracle")
    if manifest.study_track != "C" or manifest.precursor_trace_bundle is None:
        raise CaseRegistryError("confirmatory registry entry must use Track C trace replay")
    if entry.source_class != "public-repository":
        raise CaseRegistryError("confirmatory registry entry must use a public repository")
    if entry.transition_exposure != "post-snapshot-private":
        raise CaseRegistryError("confirmatory registry entry requires a post-snapshot private transition")
    try:
        bundle = load_trace_bundle(manifest)
    except TraceError as error:
        raise CaseRegistryError("confirmatory trace bundle is invalid") from error
    if any(entry.trace.provenance != "captured-session-v1" for entry in bundle.entries):
        raise CaseRegistryError("confirmatory registry entry requires captured-session provenance")
    if entry.captured_trace_count != len(bundle.entries) or entry.captured_trace_count < 2:
        raise CaseRegistryError("confirmatory registry entry requires at least two captured traces")


def _require_split_isolation(entries: tuple[CaseRegistryEntry, ...]) -> None:
    for field_name, label in (
        ("repository_family_id", "repository family"),
        ("task_family_id", "task family"),
        ("trace_family_id", "trace family"),
    ):
        splits_by_family: dict[str, set[str]] = {}
        for entry in entries:
            family_id = getattr(entry, field_name)
            splits_by_family.setdefault(family_id, set()).add(entry.corpus_split)
        leaked = sorted(
            family_id
            for family_id, splits in splits_by_family.items()
            if len(splits) > 1
        )
        if leaked:
            raise CaseRegistryError(
                f"{label} crosses corpus splits: " + ",".join(leaked)
            )


def validate_case_registry(
    registry: CaseRegistry,
    *,
    cases_root: str | Path,
) -> CaseRegistryValidation:
    root = Path(cases_root).resolve()
    if not root.is_dir():
        raise CaseRegistryError("cases root is unavailable")
    observed_paths = {
        path.relative_to(root).as_posix()
        for path in root.rglob("case.toml")
    }
    registered_paths = {entry.path.replace("\\", "/") for entry in registry.entries}
    if observed_paths != registered_paths:
        missing = sorted(observed_paths - registered_paths)
        unexpected = sorted(registered_paths - observed_paths)
        detail = []
        if missing:
            detail.append("unregistered=" + ",".join(missing))
        if unexpected:
            detail.append("missing=" + ",".join(unexpected))
        raise CaseRegistryError("case registry does not match cases root: " + " ".join(detail))
    _require_split_isolation(registry.entries)
    pilot_count = 0
    confirmatory_count = 0
    for entry in registry.entries:
        case_path = (root / _relative_case_path(entry.path)).resolve()
        if root not in case_path.parents:
            raise CaseRegistryError("case registry path escaped cases root")
        manifest = load_case_manifest(case_path)
        if manifest.case_id != entry.case_id:
            raise CaseRegistryError("case registry id does not match case manifest")
        if public_case_definition_hash(manifest) != entry.case_definition_sha256:
            raise CaseRegistryError("case registry case definition hash is stale")
        _require_enrollment_invariants(entry, manifest)
        if entry.enrollment == "development-pilot":
            pilot_count += 1
        else:
            confirmatory_count += 1
    return CaseRegistryValidation(
        registry_id=registry.registry_id,
        registry_sha256=registry.sha256,
        entry_count=len(registry.entries),
        development_pilot_count=pilot_count,
        confirmatory_count=confirmatory_count,
        repository_family_count=len({entry.repository_family_id for entry in registry.entries}),
        task_family_count=len({entry.task_family_id for entry in registry.entries}),
        trace_family_count=len({entry.trace_family_id for entry in registry.entries}),
        case_ids=tuple(sorted(entry.case_id for entry in registry.entries)),
    )
