from __future__ import annotations

from pathlib import Path

import pytest

from memorixbench.registry import (
    CaseRegistryError,
    load_case_registry,
    validate_case_registry,
)


RESEARCH_ROOT = Path(__file__).parents[1]
CASES_ROOT = RESEARCH_ROOT / "cases"
REGISTRY = CASES_ROOT / "REGISTRY.toml"


def test_frozen_development_registry_matches_every_public_case() -> None:
    result = validate_case_registry(load_case_registry(REGISTRY), cases_root=CASES_ROOT)

    assert result.entry_count == 5
    assert result.development_pilot_count == 5
    assert result.confirmatory_count == 0
    assert result.repository_family_count == 5
    assert result.task_family_count == 4
    assert result.trace_family_count == 5
    assert "typescript-auth-ownership" in result.case_ids
    assert len(result.registry_sha256) == 64


def test_registry_rejects_promoting_a_development_case_to_confirmatory(tmp_path: Path) -> None:
    source = REGISTRY.read_text(encoding="utf-8")
    candidate = tmp_path / "REGISTRY.toml"
    candidate.write_text(
        source.replace('enrollment = "development-pilot"', 'enrollment = "confirmatory"', 1),
        encoding="utf-8",
    )

    with pytest.raises(CaseRegistryError, match="validation or test split"):
        validate_case_registry(load_case_registry(candidate), cases_root=CASES_ROOT)


def test_registry_rejects_sharing_a_repository_family_across_splits(tmp_path: Path) -> None:
    source = REGISTRY.read_text(encoding="utf-8")
    candidate = tmp_path / "REGISTRY.toml"
    candidate.write_text(
        source.replace(
            'repository_family_id = "fixture-go-retry-delay"',
            'repository_family_id = "cenkalti-backoff"',
            1,
        ).replace('corpus_split = "development"', 'corpus_split = "validation"', 1),
        encoding="utf-8",
    )

    with pytest.raises(CaseRegistryError, match="repository family crosses corpus splits"):
        validate_case_registry(load_case_registry(candidate), cases_root=CASES_ROOT)
