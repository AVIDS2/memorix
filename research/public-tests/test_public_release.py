from __future__ import annotations

import hashlib
import json
from pathlib import Path

import pytest

from memorixbench.public_artifact import audit_public_artifact_manifest
from memorixbench.public_cohort import load_public_cohort_plan, validate_public_cohort_plan
from memorixbench.public_release import (
    PUBLIC_RELEASE_V2_ID,
    build_public_release_v2_manifest,
    public_release_v2_paths,
)
from memorixbench.public_safety import PublicSafetyError, reject_public_text
from memorixbench.registry import load_case_registry


def _release_root() -> Path:
    return Path(__file__).parents[1]


def test_frozen_plan_matches_the_public_registry() -> None:
    root = _release_root()
    primary = load_public_cohort_plan(
        root / "public-cohort-plans" / "memorixbench-public-cohort-v1.json"
    )
    replication = load_public_cohort_plan(
        root / "public-cohort-plans" / "memorixbench-public-cross-model-deepseek-v1.json"
    )
    registry = load_case_registry(root / "cases" / "REGISTRY.toml")

    validate_public_cohort_plan(primary, registry=registry, cases_root=root / "cases")
    validate_public_cohort_plan(replication, registry=registry, cases_root=root / "cases")
    assert len(primary.expected_keys) == 144
    assert len(replication.expected_keys) == 72


def test_public_summary_hash_and_release_manifest_are_auditable() -> None:
    root = _release_root()
    for name in ("public-cohort-v1.json", "public-cross-model-deepseek-v1.json"):
        summary = json.loads((root / "public-summary" / name).read_text(encoding="utf-8"))
        expected = hashlib.sha256(
            json.dumps(
                summary["analysis"],
                sort_keys=True,
                separators=(",", ":"),
                ensure_ascii=True,
            ).encode("ascii")
        ).hexdigest()
        assert summary["analysis_sha256"] == expected

    manifest = build_public_release_v2_manifest(
        root=root,
        created_at="2026-07-23T00:00:00+00:00",
    )
    audit = audit_public_artifact_manifest(manifest, root=root)
    assert audit.release_id == PUBLIC_RELEASE_V2_ID
    assert audit.entry_count == len(public_release_v2_paths(root))
    assert "ADMISSION-REVIEWER-GUIDE.md" in public_release_v2_paths(root)
    assert "EVIDENCE-STATUS.md" in public_release_v2_paths(root)
    assert "LOCAL-AGENT-UX-DIAGNOSTIC.md" in public_release_v2_paths(root)
    assert "src/memorixbench/native_client_capture.py" in public_release_v2_paths(root)


def test_paper_public_result_text_matches_the_frozen_summaries() -> None:
    root = _release_root()
    qwen = json.loads(
        (root / "public-summary" / "public-cohort-v1.json").read_text(encoding="utf-8")
    )["analysis"]
    deepseek = json.loads(
        (root / "public-summary" / "public-cross-model-deepseek-v1.json").read_text(
            encoding="utf-8"
        )
    )["analysis"]
    paper = (root / "paper" / "sections" / "public-results.tex").read_text(encoding="utf-8")

    assert qwen["primary_success"]["treatment_success_rate"] == pytest.approx(35 / 36)
    assert qwen["primary_success"]["control_success_rate"] == pytest.approx(34 / 36)
    assert "97.2\\% versus 94.4\\%" in paper
    assert "$+2.8$ points" in paper
    assert deepseek["primary_success"]["treatment_success_rate"] == 1.0
    assert deepseek["primary_success"]["control_success_rate"] == 1.0
    assert "36 / 36 successes and a zero success-rate difference" in paper
    assert "11,398 versus 9,192 input tokens" in paper
    assert "\\$0.00111 versus \\$0.00094" in paper


def test_public_safety_rejects_real_values_without_rejecting_latex() -> None:
    reject_public_text("Table row " + "\\" * 2)
    drive_path = "C" + ":" + "\\" + "Users" + "\\" + "sample"
    secret_name = "api" + "_" + "key"

    with pytest.raises(PublicSafetyError, match="absolute host path"):
        reject_public_text(drive_path)
    with pytest.raises(PublicSafetyError, match="credential-like"):
        reject_public_text(secret_name + "=" + "literal-value")
