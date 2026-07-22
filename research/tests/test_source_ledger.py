from __future__ import annotations

from dataclasses import replace
import hashlib
from pathlib import Path
import subprocess

import pytest

from memorixbench.source_ledger import (
    SourceLedgerError,
    audit_source_candidate,
    load_source_ledger,
    validate_source_ledger,
)


RESEARCH_ROOT = Path(__file__).parents[1]
LEDGER = RESEARCH_ROOT / "cases" / "CANDIDATE-SOURCES.toml"


def test_source_ledger_keeps_candidates_out_of_the_confirmatory_corpus() -> None:
    result = validate_source_ledger(load_source_ledger(LEDGER))

    assert result.entry_count == 10
    assert result.status_counts == {"deferred": 1, "rejected": 1, "screening": 8}
    assert "backoff-permanent-error" in result.candidate_ids


def test_source_ledger_rejects_admission_without_offline_preflight(tmp_path: Path) -> None:
    candidate = tmp_path / "CANDIDATE-SOURCES.toml"
    candidate.write_text(
        LEDGER.read_text(encoding="utf-8").replace('status = "screening"', 'status = "admitted"', 1),
        encoding="utf-8",
    )

    with pytest.raises(SourceLedgerError, match="offline-ready"):
        validate_source_ledger(load_source_ledger(candidate))


def test_source_audit_checks_origin_commit_and_exact_license_bytes(tmp_path: Path) -> None:
    repo = tmp_path / "repository"
    repo.mkdir()
    subprocess.run(["git", "init", "--quiet"], cwd=repo, check=True)
    subprocess.run(["git", "config", "user.name", "MemorixBench"], cwd=repo, check=True)
    subprocess.run(
        ["git", "config", "user.email", "memorixbench@example.invalid"],
        cwd=repo,
        check=True,
    )
    license_bytes = b"MIT sample license\n"
    (repo / "LICENSE").write_bytes(license_bytes)
    subprocess.run(["git", "add", "LICENSE"], cwd=repo, check=True)
    subprocess.run(["git", "commit", "--quiet", "-m", "license"], cwd=repo, check=True)
    base_revision = subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=repo,
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()
    (repo / "marker.txt").write_text("public transition\n", encoding="utf-8")
    subprocess.run(["git", "add", "marker.txt"], cwd=repo, check=True)
    subprocess.run(["git", "commit", "--quiet", "-m", "public transition"], cwd=repo, check=True)
    subprocess.run(
        ["git", "remote", "add", "origin", "https://github.com/cenkalti/backoff.git"],
        cwd=repo,
        check=True,
    )
    transition_revision = subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=repo,
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()
    ledger = load_source_ledger(LEDGER)
    entry = next(item for item in ledger.entries if item.candidate_id == "backoff-permanent-error")
    audit_ledger = replace(
        ledger,
        entries=(
            replace(
                entry,
                base_revision=base_revision,
                public_transition_revision=transition_revision,
                license_sha256=hashlib.sha256(license_bytes).hexdigest(),
            ),
        ),
    )

    audit = audit_source_candidate(
        audit_ledger,
        candidate_id="backoff-permanent-error",
        repository_cache=repo,
    )

    assert audit.origin_matches is True
    assert audit.base_matches_public_parent is True
    assert audit.license_matches is True
    assert audit.license_sha256 == hashlib.sha256(license_bytes).hexdigest()


def test_source_audit_rejects_changed_license_bytes(tmp_path: Path) -> None:
    repo = tmp_path / "repository"
    repo.mkdir()
    subprocess.run(["git", "init", "--quiet"], cwd=repo, check=True)
    subprocess.run(["git", "config", "user.name", "MemorixBench"], cwd=repo, check=True)
    subprocess.run(
        ["git", "config", "user.email", "memorixbench@example.invalid"],
        cwd=repo,
        check=True,
    )
    (repo / "LICENSE").write_text("different license\n", encoding="utf-8")
    subprocess.run(["git", "add", "LICENSE"], cwd=repo, check=True)
    subprocess.run(["git", "commit", "--quiet", "-m", "license"], cwd=repo, check=True)
    base_revision = subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=repo,
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()
    (repo / "marker.txt").write_text("public transition\n", encoding="utf-8")
    subprocess.run(["git", "add", "marker.txt"], cwd=repo, check=True)
    subprocess.run(["git", "commit", "--quiet", "-m", "public transition"], cwd=repo, check=True)
    subprocess.run(
        ["git", "remote", "add", "origin", "https://github.com/cenkalti/backoff"],
        cwd=repo,
        check=True,
    )
    transition_revision = subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=repo,
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()
    ledger = load_source_ledger(LEDGER)
    entry = next(item for item in ledger.entries if item.candidate_id == "backoff-permanent-error")
    audit_ledger = replace(
        ledger,
        entries=(replace(
            entry,
            base_revision=base_revision,
            public_transition_revision=transition_revision,
        ),),
    )

    with pytest.raises(SourceLedgerError, match="license bytes"):
        audit_source_candidate(
            audit_ledger,
            candidate_id="backoff-permanent-error",
            repository_cache=repo,
        )
