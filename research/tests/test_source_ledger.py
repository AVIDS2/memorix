from __future__ import annotations

from pathlib import Path

import pytest

from memorixbench.source_ledger import (
    SourceLedgerError,
    load_source_ledger,
    validate_source_ledger,
)


RESEARCH_ROOT = Path(__file__).parents[1]
LEDGER = RESEARCH_ROOT / "cases" / "CANDIDATE-SOURCES.toml"


def test_source_ledger_keeps_candidates_out_of_the_confirmatory_corpus() -> None:
    result = validate_source_ledger(load_source_ledger(LEDGER))

    assert result.entry_count == 4
    assert result.status_counts == {"rejected": 1, "screening": 3}
    assert "backoff-permanent-error" in result.candidate_ids


def test_source_ledger_rejects_admission_without_offline_preflight(tmp_path: Path) -> None:
    candidate = tmp_path / "CANDIDATE-SOURCES.toml"
    candidate.write_text(
        LEDGER.read_text(encoding="utf-8").replace('status = "screening"', 'status = "admitted"', 1),
        encoding="utf-8",
    )

    with pytest.raises(SourceLedgerError, match="offline-ready"):
        validate_source_ledger(load_source_ledger(candidate))
