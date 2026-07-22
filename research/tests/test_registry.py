from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace

import pytest

import memorixbench.registry as registry_module
from memorixbench.registry import (
    CaseRegistryEntry,
    CaseRegistryError,
    load_case_registry,
    validate_case_registry,
)


RESEARCH_ROOT = Path(__file__).parents[1]
CASES_ROOT = RESEARCH_ROOT / "cases"
REGISTRY = CASES_ROOT / "REGISTRY.toml"


def _entry(
    *,
    case_id: str = "example-case",
    enrollment: str = "development-pilot",
    corpus_split: str = "development",
    repository_family_id: str = "example-repository",
    transition_exposure: str = "development-controlled",
) -> CaseRegistryEntry:
    return CaseRegistryEntry(
        case_id=case_id,
        path=f"development/{case_id}/case.toml",
        enrollment=enrollment,
        case_definition_sha256="a" * 64,
        corpus_split=corpus_split,
        repository_family_id=repository_family_id,
        task_family_id="example-task",
        trace_family_id="example-trace",
        authoring_batch="example-batch",
        source_class="public-repository",
        contamination_risk="public-history-documented",
        transition_exposure=transition_exposure,
        dependency_rationale="A retained policy may help after a private migration.",
        minimal_sufficient_evidence="A durable policy statement.",
        plausible_distractor="A prior implementation owner.",
        no_memory_expectation="Current source may still permit partial inference.",
        captured_trace_count=2,
    )


def test_public_registry_is_empty_until_clean_cases_are_admitted() -> None:
    result = validate_case_registry(load_case_registry(REGISTRY), cases_root=CASES_ROOT)

    assert result.entry_count == 0
    assert result.development_pilot_count == 0
    assert result.confirmatory_count == 0
    assert result.repository_family_count == 0
    assert result.task_family_count == 0
    assert result.trace_family_count == 0
    assert result.case_ids == ()
    assert len(result.registry_sha256) == 64


def test_empty_registry_is_valid_for_an_empty_cases_root(tmp_path: Path) -> None:
    registry_path = tmp_path / "REGISTRY.toml"
    registry_path.write_text(
        'schema_version = "0.3"\nregistry_id = "empty-registry"\n',
        encoding="utf-8",
    )
    cases_root = tmp_path / "cases"
    cases_root.mkdir()

    result = validate_case_registry(load_case_registry(registry_path), cases_root=cases_root)

    assert result.entry_count == 0


def test_registry_rejects_unregistered_case_paths(tmp_path: Path) -> None:
    registry_path = tmp_path / "REGISTRY.toml"
    registry_path.write_text(
        'schema_version = "0.3"\nregistry_id = "empty-registry"\n',
        encoding="utf-8",
    )
    cases_root = tmp_path / "cases"
    (cases_root / "development" / "example").mkdir(parents=True)
    (cases_root / "development" / "example" / "case.toml").write_text(
        "placeholder\n",
        encoding="utf-8",
    )

    with pytest.raises(CaseRegistryError, match="unregistered"):
        validate_case_registry(load_case_registry(registry_path), cases_root=cases_root)


def test_registry_rejects_shared_repository_family_across_splits() -> None:
    development = _entry(case_id="development-case")
    confirmatory = _entry(
        case_id="confirmatory-case",
        enrollment="confirmatory",
        corpus_split="test",
        transition_exposure="post-snapshot-private",
    )

    with pytest.raises(CaseRegistryError, match="repository family crosses corpus splits"):
        registry_module._require_split_isolation((development, confirmatory))


def test_confirmatory_bundle_checks_captured_provenance(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    entry = _entry(
        enrollment="confirmatory",
        corpus_split="test",
        transition_exposure="post-snapshot-private",
    )
    manifest = SimpleNamespace(
        split="test",
        repository=SimpleNamespace(source_type="git"),
        dependency_classification_status="preregistered",
        oracle=SimpleNamespace(visibility="private"),
        study_track="C",
        precursor_trace_bundle=object(),
    )
    bundle = SimpleNamespace(entries=(
        SimpleNamespace(trace=SimpleNamespace(provenance="captured-session-v1")),
        SimpleNamespace(trace=SimpleNamespace(provenance="captured-session-v1")),
    ))
    monkeypatch.setattr(registry_module, "load_trace_bundle", lambda _manifest: bundle)

    registry_module._require_enrollment_invariants(entry, manifest)

    invalid_bundle = SimpleNamespace(entries=(
        SimpleNamespace(trace=SimpleNamespace(provenance="captured-session-v1")),
        SimpleNamespace(trace=SimpleNamespace(provenance="controlled-replay-v1")),
    ))
    monkeypatch.setattr(registry_module, "load_trace_bundle", lambda _manifest: invalid_bundle)
    with pytest.raises(CaseRegistryError, match="captured-session provenance"):
        registry_module._require_enrollment_invariants(entry, manifest)
