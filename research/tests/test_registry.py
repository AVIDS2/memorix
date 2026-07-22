from __future__ import annotations

from dataclasses import replace
from pathlib import Path
from types import SimpleNamespace

import pytest
import memorixbench.registry as registry_module

from memorixbench.registry import (
    CaseRegistryError,
    load_case_registry,
    validate_case_registry,
)
from memorixbench.schema import load_case_manifest


RESEARCH_ROOT = Path(__file__).parents[1]
CASES_ROOT = RESEARCH_ROOT / "cases"
REGISTRY = CASES_ROOT / "REGISTRY.toml"


def replace_case_field(source: str, case_id: str, old: str, new: str) -> str:
    marker = f'id = "{case_id}"'
    start = source.index(marker)
    end = source.find("\n[[case]]", start)
    section = source[start:] if end < 0 else source[start:end]
    assert old in section
    replacement = section.replace(old, new, 1)
    return source[:start] + replacement + ("" if end < 0 else source[end:])


def test_frozen_development_registry_matches_every_public_case() -> None:
    result = validate_case_registry(load_case_registry(REGISTRY), cases_root=CASES_ROOT)

    assert result.entry_count == 7
    assert result.development_pilot_count == 7
    assert result.confirmatory_count == 0
    assert result.repository_family_count == 6
    assert result.task_family_count == 5
    assert result.trace_family_count == 7
    assert "go-cobra-completion-input-ownership" in result.case_ids
    assert "go-cobra-completion-input-seeded" in result.case_ids
    assert "typescript-auth-ownership" in result.case_ids
    assert len(result.registry_sha256) == 64


def test_registry_rejects_promoting_a_development_case_to_confirmatory(tmp_path: Path) -> None:
    source = REGISTRY.read_text(encoding="utf-8")
    candidate = tmp_path / "REGISTRY.toml"
    candidate.write_text(
        replace_case_field(
            source,
            "go-backoff-zero-jitter-ownership",
            'enrollment = "development-pilot"',
            'enrollment = "confirmatory"',
        ),
        encoding="utf-8",
    )

    with pytest.raises(CaseRegistryError, match="validation or test split"):
        validate_case_registry(load_case_registry(candidate), cases_root=CASES_ROOT)


def test_registry_rejects_sharing_a_repository_family_across_splits(tmp_path: Path) -> None:
    source = REGISTRY.read_text(encoding="utf-8")
    candidate = tmp_path / "REGISTRY.toml"
    candidate_source = replace_case_field(
        source,
        "go-retry-delay-ownership",
        'repository_family_id = "fixture-go-retry-delay"',
        'repository_family_id = "cenkalti-backoff"',
    )
    candidate.write_text(
        replace_case_field(
            candidate_source,
            "go-retry-delay-ownership",
            'corpus_split = "development"',
            'corpus_split = "validation"',
        ),
        encoding="utf-8",
    )

    with pytest.raises(CaseRegistryError, match="repository family crosses corpus splits"):
        validate_case_registry(load_case_registry(candidate), cases_root=CASES_ROOT)


def test_registry_rejects_a_mismatched_development_trace_count(tmp_path: Path) -> None:
    source = REGISTRY.read_text(encoding="utf-8")
    candidate = tmp_path / "REGISTRY.toml"
    candidate.write_text(
        replace_case_field(
            source,
            "go-cobra-completion-input-ownership",
            "captured_trace_count = 2",
            "captured_trace_count = 1",
        ),
        encoding="utf-8",
    )

    with pytest.raises(CaseRegistryError, match="declare every bundled capture"):
        validate_case_registry(load_case_registry(candidate), cases_root=CASES_ROOT)


def test_confirmatory_bundle_checks_provenance_without_direct_trace(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    entry = next(
        item
        for item in load_case_registry(REGISTRY).entries
        if item.case_id == "go-cobra-completion-input-ownership"
    )
    manifest = load_case_manifest(
        CASES_ROOT / "development" / "go-cobra-completion-input-ownership" / "case.toml"
    )
    manifest = replace(
        manifest,
        split="test",
        dependency_classification_status="preregistered",
        oracle=replace(manifest.oracle, visibility="private"),
    )
    entry = replace(
        entry,
        enrollment="confirmatory",
        corpus_split="test",
        transition_exposure="post-snapshot-private",
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
