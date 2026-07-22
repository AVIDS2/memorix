from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import re
import tomllib
from typing import Any

SCHEMA_VERSION = "0.5"
CASE_ID_PATTERN = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
COMMIT_SHA_PATTERN = re.compile(r"^[0-9a-f]{40}$")
VALID_SPLITS = {"development", "validation", "test"}
VALID_DEPENDENCY_STRENGTHS = {"low", "medium", "high"}
VALID_DEPENDENCY_CLASSIFICATION_STATUS = {
    "retrospective-development",
    "preregistered",
}
VALID_ORACLE_VISIBILITIES = {"public", "private"}
VALID_CONFIRMATORY_ISOLATION_PROFILES = {
    "remote-worker-vault-v1",
    "hyperv-worker-vault-v1",
}
VALID_CONFIRMATORY_VERIFIER_MODES = {"black-box-controller-v1"}
VALID_FORMATION_TRACKS = {"seeded-canonical", "trace-replay", "native-session"}
VALID_TRACE_PROVENANCE = {"captured-session-v1", "controlled-replay-v1"}
VALID_TRACE_NORMALIZATIONS = {
    "event-normalize-v1",
    "event-normalize-tool-results-omitted-v1",
}
VALID_TRACE_TRUNCATIONS = {"event-suffix-v1"}
VALID_TRACE_BUNDLE_SCHEMAS = {"precursor-trace-bundle-v1"}
VALID_TRACE_BUNDLE_SELECTIONS = {"hash-bucket-v1"}
VALID_SOURCE_TYPES = {"local-fixture", "git"}
VALID_TRANSITIONS = {
    "none",
    "code-change",
    "dependency-change",
    "configuration-change",
    "documentation-change",
}


class ManifestError(ValueError):
    """Raised when a benchmark case manifest violates the public schema."""


@dataclass(frozen=True)
class RepositorySpec:
    source_type: str
    base_revision: str
    path: str | None = None
    url: str | None = None
    license: str | None = None


@dataclass(frozen=True)
class PhaseSpec:
    task: str
    success_commands: tuple[str, ...]
    patch: str | None = None
    transcript: str | None = None


@dataclass(frozen=True)
class TransitionSpec:
    kind: str
    description: str
    apply_commands: tuple[str, ...]
    patch: str | None = None


@dataclass(frozen=True)
class PrecursorTraceSpec:
    path: str
    schema_version: str
    provenance: str
    normalization: str
    truncation: str


@dataclass(frozen=True)
class PrecursorTraceBundleSpec:
    path: str
    schema_version: str
    selection: str
    truncation: str


@dataclass(frozen=True)
class MemorySeedSpec:
    entity_name: str
    type: str
    title: str
    narrative: str
    facts: tuple[str, ...]
    files_modified: tuple[str, ...]
    concepts: tuple[str, ...]
    topic_key: str | None = None
    related_entities: tuple[str, ...] = ()


@dataclass(frozen=True)
class SourceCheckSpec:
    """A deterministic source-level constraint evaluated after an agent run."""

    path: str
    scope_start: str | None
    scope_end: str | None
    required_literals: tuple[str, ...]
    forbidden_literals: tuple[str, ...]


@dataclass(frozen=True)
class OracleSpec:
    visibility: str
    required_isolation_profile: str | None
    verifier_mode: str | None
    required_start_files: tuple[str, ...]
    relevant_evidence_ids: tuple[str, ...]
    stale_evidence_ids: tuple[str, ...]
    forbidden_actions: tuple[str, ...]
    source_checks: tuple[SourceCheckSpec, ...]
    hidden_patch: str | None = None
    reference_patch: str | None = None


@dataclass(frozen=True)
class CaseManifest:
    schema_version: str
    case_id: str
    title: str
    split: str
    dependency_strength: str
    dependency_classification_status: str
    language: str
    tags: tuple[str, ...]
    repository: RepositorySpec
    precursor: PhaseSpec
    transition: TransitionSpec
    transfer: PhaseSpec
    formation_track: str
    precursor_trace: PrecursorTraceSpec | None
    precursor_trace_bundle: PrecursorTraceBundleSpec | None
    memory_seeds: tuple[MemorySeedSpec, ...]
    oracle: OracleSpec
    public_bundle_paths: tuple[str, ...]
    source_path: Path

    @property
    def study_track(self) -> str:
        """The formation surface determines whether a case is Track B or C."""

        return "B" if self.formation_track == "seeded-canonical" else "C"


def _table(data: dict[str, Any], key: str) -> dict[str, Any]:
    value = data.get(key)
    if not isinstance(value, dict):
        raise ManifestError(f"missing [{key}] table")
    return value


def _text(data: dict[str, Any], key: str, *, context: str = "manifest") -> str:
    value = data.get(key)
    if not isinstance(value, str) or not value.strip():
        raise ManifestError(f"{context}.{key} must be a non-empty string")
    return value.strip()


def _optional_text(data: dict[str, Any], key: str) -> str | None:
    value = data.get(key)
    if value is None:
        return None
    if not isinstance(value, str) or not value.strip():
        raise ManifestError(f"{key} must be a non-empty string when present")
    return value.strip()


def _strings(
    data: dict[str, Any],
    key: str,
    *,
    context: str,
    required: bool = False,
) -> tuple[str, ...]:
    value = data.get(key)
    if value is None and not required:
        return ()
    if not isinstance(value, list) or any(not isinstance(item, str) or not item.strip() for item in value):
        raise ManifestError(f"{context}.{key} must be an array of non-empty strings")
    cleaned = tuple(item.strip() for item in value)
    if required and not cleaned:
        raise ManifestError(f"{context}.{key} must not be empty")
    if len(set(cleaned)) != len(cleaned):
        raise ManifestError(f"{context}.{key} contains duplicates")
    return cleaned


def _memory_seeds(data: dict[str, Any]) -> tuple[MemorySeedSpec, ...]:
    raw = data.get("memory_seed", [])
    if not isinstance(raw, list):
        raise ManifestError("memory_seed must be an array of tables when present")
    seeds: list[MemorySeedSpec] = []
    topic_keys: set[str] = set()
    for index, item in enumerate(raw, 1):
        if not isinstance(item, dict):
            raise ManifestError(f"memory_seed[{index}] must be a table")
        context = f"memory_seed[{index}]"
        topic_key = _optional_text(item, "topic_key")
        if topic_key:
            if topic_key in topic_keys:
                raise ManifestError(f"{context}.topic_key duplicates an earlier memory seed")
            topic_keys.add(topic_key)
        seeds.append(MemorySeedSpec(
            entity_name=_text(item, "entity_name", context=context),
            type=_text(item, "type", context=context),
            title=_text(item, "title", context=context),
            narrative=_text(item, "narrative", context=context),
            facts=_strings(item, "facts", context=context),
            files_modified=_strings(item, "files_modified", context=context),
            concepts=_strings(item, "concepts", context=context),
            topic_key=topic_key,
            related_entities=_strings(item, "related_entities", context=context),
        ))
    return tuple(seeds)


def _source_checks(data: dict[str, Any]) -> tuple[SourceCheckSpec, ...]:
    raw = data.get("source_check", [])
    if not isinstance(raw, list):
        raise ManifestError("oracle.source_check must be an array of tables when present")

    checks: list[SourceCheckSpec] = []
    identities: set[tuple[str, str | None, str | None]] = set()
    for index, item in enumerate(raw, 1):
        if not isinstance(item, dict):
            raise ManifestError(f"oracle.source_check[{index}] must be a table")
        context = f"oracle.source_check[{index}]"
        path = _text(item, "path", context=context)
        path_parts = Path(path).parts
        if Path(path).is_absolute() or ".." in path_parts:
            raise ManifestError(f"{context}.path must stay inside the repository")
        scope_start = _optional_text(item, "scope_start")
        scope_end = _optional_text(item, "scope_end")
        if scope_end and not scope_start:
            raise ManifestError(f"{context}.scope_end requires scope_start")
        required_literals = _strings(item, "required_literals", context=context)
        forbidden_literals = _strings(item, "forbidden_literals", context=context)
        if not required_literals and not forbidden_literals:
            raise ManifestError(
                f"{context} requires required_literals or forbidden_literals"
            )
        overlap = set(required_literals) & set(forbidden_literals)
        if overlap:
            raise ManifestError(
                f"{context} literals cannot be both required and forbidden: "
                + ", ".join(sorted(overlap))
            )
        identity = (path, scope_start, scope_end)
        if identity in identities:
            raise ManifestError(f"{context} duplicates an earlier source check scope")
        identities.add(identity)
        checks.append(SourceCheckSpec(
            path=path,
            scope_start=scope_start,
            scope_end=scope_end,
            required_literals=required_literals,
            forbidden_literals=forbidden_literals,
        ))
    return tuple(checks)


def _public_bundle_paths(data: dict[str, Any]) -> tuple[str, ...]:
    bundle_data = data.get("bundle")
    if bundle_data is None:
        return ()
    if not isinstance(bundle_data, dict):
        raise ManifestError("bundle must be a table when present")
    paths = _strings(bundle_data, "public_paths", context="bundle", required=True)
    seen: set[str] = set()
    for path in paths:
        candidate = Path(path)
        if candidate.is_absolute() or ".." in candidate.parts or not candidate.parts:
            raise ManifestError("bundle.public_paths must stay inside the case directory")
        normalized = candidate.as_posix()
        if normalized in seen:
            raise ManifestError("bundle.public_paths must not contain duplicates")
        seen.add(normalized)
    return tuple(Path(path).as_posix() for path in paths)


def _path_is_covered(path: str, public_paths: tuple[str, ...]) -> bool:
    candidate = Path(path).as_posix()
    return any(
        candidate == declared or candidate.startswith(declared.rstrip("/") + "/")
        for declared in public_paths
    )


def _required_public_assets(manifest: CaseManifest) -> tuple[str, ...]:
    assets: list[str] = ["case.toml"]
    if manifest.repository.path:
        assets.append(manifest.repository.path)
    for phase in (manifest.precursor, manifest.transfer):
        if phase.patch:
            assets.append(phase.patch)
        if phase.transcript:
            assets.append(phase.transcript)
    if manifest.transition.patch:
        assets.append(manifest.transition.patch)
    if manifest.precursor_trace:
        assets.append(manifest.precursor_trace.path)
    if manifest.precursor_trace_bundle:
        assets.append(manifest.precursor_trace_bundle.path)
    return tuple(assets)


def _formation_spec(
    data: dict[str, Any],
) -> tuple[str, PrecursorTraceSpec | None, PrecursorTraceBundleSpec | None]:
    formation_data = data.get("formation")
    if formation_data is None:
        return "seeded-canonical", None, None
    if not isinstance(formation_data, dict):
        raise ManifestError("formation must be a table when present")
    track = _text(formation_data, "track", context="formation")
    if track not in VALID_FORMATION_TRACKS:
        raise ManifestError(
            "formation.track must be one of " + str(sorted(VALID_FORMATION_TRACKS))
        )
    trace_data = formation_data.get("precursor_trace")
    bundle_data = formation_data.get("trace_bundle")
    if trace_data is not None and bundle_data is not None:
        raise ManifestError("formation may declare precursor_trace or trace_bundle, not both")
    if trace_data is None and bundle_data is None:
        if track != "seeded-canonical":
            raise ManifestError("trace-replay and native-session require precursor_trace or trace_bundle")
        return track, None, None
    if trace_data is not None:
        if not isinstance(trace_data, dict):
            raise ManifestError("formation.precursor_trace must be a table")
        trace = PrecursorTraceSpec(
            path=_text(trace_data, "path", context="formation.precursor_trace"),
            schema_version=_text(trace_data, "schema_version", context="formation.precursor_trace"),
            provenance=_text(trace_data, "provenance", context="formation.precursor_trace"),
            normalization=_text(trace_data, "normalization", context="formation.precursor_trace"),
            truncation=_text(trace_data, "truncation", context="formation.precursor_trace"),
        )
        if trace.provenance not in VALID_TRACE_PROVENANCE:
            raise ManifestError("formation.precursor_trace.provenance is unsupported")
        if trace.normalization not in VALID_TRACE_NORMALIZATIONS:
            raise ManifestError("formation.precursor_trace.normalization is unsupported")
        if trace.truncation not in VALID_TRACE_TRUNCATIONS:
            raise ManifestError("formation.precursor_trace.truncation is unsupported")
        if track == "seeded-canonical":
            raise ManifestError("seeded-canonical cases must not declare precursor_trace")
        trace_path = Path(trace.path)
        if trace_path.is_absolute() or ".." in trace_path.parts:
            raise ManifestError("formation.precursor_trace.path must stay inside the case")
        return track, trace, None
    assert bundle_data is not None
    if not isinstance(bundle_data, dict):
        raise ManifestError("formation.trace_bundle must be a table")
    bundle = PrecursorTraceBundleSpec(
        path=_text(bundle_data, "path", context="formation.trace_bundle"),
        schema_version=_text(bundle_data, "schema_version", context="formation.trace_bundle"),
        selection=_text(bundle_data, "selection", context="formation.trace_bundle"),
        truncation=_text(bundle_data, "truncation", context="formation.trace_bundle"),
    )
    if bundle.schema_version not in VALID_TRACE_BUNDLE_SCHEMAS:
        raise ManifestError("formation.trace_bundle.schema_version is unsupported")
    if bundle.selection not in VALID_TRACE_BUNDLE_SELECTIONS:
        raise ManifestError("formation.trace_bundle.selection is unsupported")
    if bundle.truncation not in VALID_TRACE_TRUNCATIONS:
        raise ManifestError("formation.trace_bundle.truncation is unsupported")
    if track != "trace-replay":
        raise ManifestError("formation.trace_bundle requires trace-replay")
    bundle_path = Path(bundle.path)
    if bundle_path.is_absolute() or ".." in bundle_path.parts:
        raise ManifestError("formation.trace_bundle.path must stay inside the case")
    return track, None, bundle


def load_case_manifest(path: str | Path) -> CaseManifest:
    source_path = Path(path).resolve()
    try:
        data = tomllib.loads(source_path.read_text(encoding="utf-8"))
    except (OSError, tomllib.TOMLDecodeError) as error:
        raise ManifestError(f"cannot read {source_path}: {error}") from error

    schema_version = _text(data, "schema_version")
    if schema_version != SCHEMA_VERSION:
        raise ManifestError(
            f"unsupported schema_version {schema_version!r}; expected {SCHEMA_VERSION!r}"
        )

    case_id = _text(data, "id")
    if not CASE_ID_PATTERN.fullmatch(case_id):
        raise ManifestError("manifest.id must be a lowercase kebab-case identifier")

    split = _text(data, "split")
    if split not in VALID_SPLITS:
        raise ManifestError(f"manifest.split must be one of {sorted(VALID_SPLITS)}")
    dependency_strength = _text(data, "dependency_strength")
    if dependency_strength not in VALID_DEPENDENCY_STRENGTHS:
        raise ManifestError(
            "manifest.dependency_strength must be one of "
            f"{sorted(VALID_DEPENDENCY_STRENGTHS)}"
        )
    dependency_classification_status = _text(data, "dependency_classification_status")
    if dependency_classification_status not in VALID_DEPENDENCY_CLASSIFICATION_STATUS:
        raise ManifestError(
            "manifest.dependency_classification_status must be one of "
            f"{sorted(VALID_DEPENDENCY_CLASSIFICATION_STATUS)}"
        )

    repository_data = _table(data, "repository")
    source_type = _text(repository_data, "source_type", context="repository")
    if source_type not in VALID_SOURCE_TYPES:
        raise ManifestError(
            f"repository.source_type must be one of {sorted(VALID_SOURCE_TYPES)}"
        )
    base_revision = _text(repository_data, "base_revision", context="repository")
    if source_type == "git" and not COMMIT_SHA_PATTERN.fullmatch(base_revision):
        raise ManifestError(
            "repository.base_revision must be a full lowercase 40-character commit SHA"
        )
    repository = RepositorySpec(
        source_type=source_type,
        base_revision=base_revision,
        path=_optional_text(repository_data, "path"),
        url=_optional_text(repository_data, "url"),
        license=_optional_text(repository_data, "license"),
    )
    if source_type == "local-fixture" and repository.path is None:
        raise ManifestError("repository.path is required for local-fixture cases")
    if source_type == "git" and (repository.url is None or repository.license is None):
        raise ManifestError("repository.url and repository.license are required for git cases")

    precursor_data = _table(data, "precursor")
    transfer_data = _table(data, "transfer")
    transition_data = _table(data, "transition")
    transition_kind = _text(transition_data, "kind", context="transition")
    if transition_kind not in VALID_TRANSITIONS:
        raise ManifestError(
            f"transition.kind must be one of {sorted(VALID_TRANSITIONS)}"
        )

    oracle_data = _table(data, "oracle")
    oracle_visibility = _optional_text(oracle_data, "visibility") or "public"
    if oracle_visibility not in VALID_ORACLE_VISIBILITIES:
        raise ManifestError(
            "oracle.visibility must be one of "
            f"{sorted(VALID_ORACLE_VISIBILITIES)}"
        )
    required_isolation_profile = _optional_text(
        oracle_data,
        "required_isolation_profile",
    )
    verifier_mode = _optional_text(oracle_data, "verifier_mode")
    hidden_patch = _optional_text(oracle_data, "hidden_patch")
    reference_patch = _optional_text(oracle_data, "reference_patch")
    if oracle_visibility == "private" and (hidden_patch or reference_patch):
        raise ManifestError(
            "private oracle assets must live in a private overlay, not case.toml"
        )
    if split in {"validation", "test"} and oracle_visibility != "private":
        raise ManifestError("validation and test cases require oracle.visibility = 'private'")
    if split in {"validation", "test"} and dependency_classification_status != "preregistered":
        raise ManifestError(
            "validation and test cases require preregistered dependency classification"
        )
    public_bundle_paths = _public_bundle_paths(data)
    formation_track, precursor_trace, precursor_trace_bundle = _formation_spec(data)
    manifest = CaseManifest(
        schema_version=schema_version,
        case_id=case_id,
        title=_text(data, "title"),
        split=split,
        dependency_strength=dependency_strength,
        dependency_classification_status=dependency_classification_status,
        language=_text(data, "language"),
        tags=_strings(data, "tags", context="manifest", required=True),
        repository=repository,
        precursor=PhaseSpec(
            task=_text(precursor_data, "task", context="precursor"),
            success_commands=_strings(
                precursor_data,
                "success_commands",
                context="precursor",
                required=True,
            ),
            patch=_optional_text(precursor_data, "patch"),
            transcript=_optional_text(precursor_data, "transcript"),
        ),
        transition=TransitionSpec(
            kind=transition_kind,
            description=_text(transition_data, "description", context="transition"),
            apply_commands=_strings(
                transition_data,
                "apply_commands",
                context="transition",
                required=False,
            ),
            patch=_optional_text(transition_data, "patch"),
        ),
        transfer=PhaseSpec(
            task=_text(transfer_data, "task", context="transfer"),
            success_commands=_strings(
                transfer_data,
                "success_commands",
                context="transfer",
                required=True,
            ),
            patch=_optional_text(transfer_data, "patch"),
            transcript=_optional_text(transfer_data, "transcript"),
        ),
        formation_track=formation_track,
        precursor_trace=precursor_trace,
        precursor_trace_bundle=precursor_trace_bundle,
        memory_seeds=_memory_seeds(data),
        oracle=OracleSpec(
            visibility=oracle_visibility,
            required_isolation_profile=required_isolation_profile,
            verifier_mode=verifier_mode,
            required_start_files=_strings(
                oracle_data,
                "required_start_files",
                context="oracle",
                required=True,
            ),
            relevant_evidence_ids=_strings(
                oracle_data,
                "relevant_evidence_ids",
                context="oracle",
            ),
            stale_evidence_ids=_strings(
                oracle_data,
                "stale_evidence_ids",
                context="oracle",
            ),
            forbidden_actions=_strings(
                oracle_data,
                "forbidden_actions",
                context="oracle",
            ),
            source_checks=_source_checks(oracle_data),
            hidden_patch=hidden_patch,
            reference_patch=reference_patch,
        ),
        public_bundle_paths=public_bundle_paths,
        source_path=source_path,
    )

    overlap = set(manifest.oracle.relevant_evidence_ids) & set(
        manifest.oracle.stale_evidence_ids
    )
    if overlap:
        raise ManifestError(
            "oracle evidence cannot be both relevant and stale: " + ", ".join(sorted(overlap))
        )
    if split in {"validation", "test"} and (
        manifest.oracle.source_checks or manifest.oracle.forbidden_actions
    ):
        raise ManifestError(
            "validation and test case-specific oracle rules must live in the private overlay"
        )
    if split in {"validation", "test"}:
        if manifest.oracle.required_isolation_profile not in VALID_CONFIRMATORY_ISOLATION_PROFILES:
            raise ManifestError(
                "validation and test cases require a supported "
                "oracle.required_isolation_profile"
            )
        if manifest.oracle.verifier_mode not in VALID_CONFIRMATORY_VERIFIER_MODES:
            raise ManifestError(
                "validation and test cases require oracle.verifier_mode = "
                '"black-box-controller-v1"'
            )
        if not manifest.public_bundle_paths:
            raise ManifestError(
                "validation and test cases require an explicit [bundle] public_paths allowlist"
            )
        missing_assets = [
            asset
            for asset in _required_public_assets(manifest)
            if not _path_is_covered(asset, manifest.public_bundle_paths)
        ]
        if missing_assets:
            raise ManifestError(
                "bundle.public_paths does not cover required public assets: "
                + ", ".join(missing_assets)
            )
    if (
        manifest.formation_track != "seeded-canonical"
        and manifest.precursor_trace is None
        and manifest.precursor_trace_bundle is None
    ):
        raise ManifestError("non-canonical formation requires precursor_trace or trace_bundle")
    if manifest.study_track == "C" and manifest.memory_seeds:
        raise ManifestError("Track C cases must not declare memory_seed entries")
    if manifest.study_track == "C" and manifest.precursor.transcript:
        raise ManifestError(
            "Track C precursor session content must be represented by precursor_trace or trace_bundle, not precursor.transcript"
        )
    if (
        manifest.split in {"validation", "test"}
        and manifest.study_track == "C"
        and manifest.precursor_trace_bundle is None
    ):
        raise ManifestError(
            "confirmatory Track C cases require a captured-session trace bundle"
        )
    if manifest.precursor_trace is not None:
        if not _path_is_covered(
            manifest.precursor_trace.path,
            manifest.public_bundle_paths,
        ):
            if split in {"validation", "test"}:
                raise ManifestError(
                    "bundle.public_paths must cover the precursor trace"
                )
    if manifest.precursor_trace_bundle is not None:
        if not _path_is_covered(
            manifest.precursor_trace_bundle.path,
            manifest.public_bundle_paths,
        ):
            if split in {"validation", "test"}:
                raise ManifestError(
                    "bundle.public_paths must cover the precursor trace bundle"
                )
    if transition_kind != "none" and not (
        manifest.transition.patch or manifest.transition.apply_commands
    ):
        raise ManifestError(
            "a non-empty transition requires transition.patch or transition.apply_commands"
        )
    return manifest
