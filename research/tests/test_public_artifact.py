from __future__ import annotations

from pathlib import Path
import json
import os
import sys

import pytest

from memorixbench.public_artifact import (
    PublicArtifactError,
    audit_public_artifact_manifest,
    build_public_artifact_manifest,
    load_public_artifact_manifest,
    materialize_public_artifact,
    write_public_artifact_manifest,
)
from memorixbench import cli


def _release_tree(tmp_path: Path) -> Path:
    root = tmp_path / "release"
    root.mkdir()
    (root / "README.md").write_text("# Public artifact\n", encoding="utf-8")
    (root / "src").mkdir()
    (root / "src" / "runner.py").write_text("print('ok')\n", encoding="utf-8")
    (root / "paper").mkdir()
    (root / "paper" / "main.tex").write_text("\\section{Method}\n", encoding="utf-8")
    return root


def test_public_artifact_manifest_builds_and_audits_a_whitelist(tmp_path: Path) -> None:
    root = _release_tree(tmp_path)
    (root / "runner.ps1").write_text("Write-Output 'ok'\n", encoding="utf-8")
    (root / "uv.lock").write_text("version = 1\n", encoding="utf-8")
    manifest = build_public_artifact_manifest(
        root=root,
        release_id="memorixbench-design-v1",
        evidence_tier="design-only-v1",
        paths=("README.md", "paper/main.tex", "runner.ps1", "src/runner.py", "uv.lock"),
        created_at="2026-07-23T00:00:00+00:00",
    )
    target = tmp_path / "manifest.json"
    write_public_artifact_manifest(manifest, target)

    loaded = load_public_artifact_manifest(target)
    audit = audit_public_artifact_manifest(loaded, root=root)

    assert [entry.path for entry in loaded.entries] == [
        "README.md",
        "paper/main.tex",
        "runner.ps1",
        "src/runner.py",
        "uv.lock",
    ]
    assert audit.entry_count == 5
    assert str(root) not in str(loaded.public_payload())


def test_public_artifact_manifest_allows_public_fixture_source_suffixes(tmp_path: Path) -> None:
    root = _release_tree(tmp_path)
    (root / "fixture.go").write_text("package fixture\n", encoding="utf-8")
    (root / "go.mod").write_text("module fixture\n", encoding="utf-8")
    (root / "fixture.mjs").write_text("export const value = 1;\n", encoding="utf-8")

    manifest = build_public_artifact_manifest(
        root=root,
        release_id="memorixbench-design-v1",
        evidence_tier="design-only-v1",
        paths=("fixture.go", "fixture.mjs", "go.mod"),
    )

    assert audit_public_artifact_manifest(manifest, root=root).entry_count == 3


def test_public_artifact_audit_rejects_byte_drift(tmp_path: Path) -> None:
    root = _release_tree(tmp_path)
    manifest = build_public_artifact_manifest(
        root=root,
        release_id="memorixbench-design-v1",
        evidence_tier="design-only-v1",
        paths=("README.md",),
    )
    (root / "README.md").write_text("# Changed\n", encoding="utf-8")

    with pytest.raises(PublicArtifactError, match="does not match"):
        audit_public_artifact_manifest(manifest, root=root)


def test_public_artifact_materialization_contains_only_the_whitelist(tmp_path: Path) -> None:
    root = _release_tree(tmp_path)
    (root / "unlisted.md").write_text("must not ship\n", encoding="utf-8")
    manifest = build_public_artifact_manifest(
        root=root,
        release_id="memorixbench-design-v1",
        evidence_tier="design-only-v1",
        paths=("README.md", "paper/main.tex"),
    )
    stage = tmp_path / "release-stage"

    materialized = materialize_public_artifact(manifest, root=root, target=stage)

    assert materialized.entry_count == 2
    assert sorted(
        path.relative_to(stage).as_posix()
        for path in stage.rglob("*")
        if path.is_file()
    ) == ["README.md", "paper/main.tex"]
    assert audit_public_artifact_manifest(
        manifest,
        root=stage,
        require_exact_tree=True,
    ).entry_count == 2
    (stage / "unlisted.md").write_text("unexpected output\n", encoding="utf-8")
    with pytest.raises(PublicArtifactError, match="unlisted or missing"):
        audit_public_artifact_manifest(manifest, root=stage, require_exact_tree=True)


@pytest.mark.parametrize(
    "relative_path",
    ("private/evidence.json", "results/outcome.json", "../escape.md", "C:/escape.md"),
)
def test_public_artifact_manifest_rejects_private_or_escaping_paths(
    tmp_path: Path,
    relative_path: str,
) -> None:
    root = _release_tree(tmp_path)

    with pytest.raises(PublicArtifactError, match="path"):
        build_public_artifact_manifest(
            root=root,
            release_id="memorixbench-design-v1",
            evidence_tier="design-only-v1",
            paths=(relative_path,),
        )


def test_public_artifact_manifest_rejects_sensitive_text(tmp_path: Path) -> None:
    root = _release_tree(tmp_path)
    (root / "unsafe.md").write_text("api_key=sk-abcdefghijklmnopqrstuv\n", encoding="utf-8")

    with pytest.raises(PublicArtifactError, match="sensitive text"):
        build_public_artifact_manifest(
            root=root,
            release_id="memorixbench-design-v1",
            evidence_tier="design-only-v1",
            paths=("unsafe.md",),
        )


def test_public_artifact_manifest_rejects_sensitive_file_names(tmp_path: Path) -> None:
    root = _release_tree(tmp_path)
    unsafe_name = "sk-" + "a" * 24 + ".md"
    (root / unsafe_name).write_text("safe text\n", encoding="utf-8")

    with pytest.raises(PublicArtifactError, match="path contains sensitive text"):
        build_public_artifact_manifest(
            root=root,
            release_id="memorixbench-design-v1",
            evidence_tier="design-only-v1",
            paths=(unsafe_name,),
        )


def test_public_artifact_manifest_rejects_a_hard_link(tmp_path: Path) -> None:
    root = _release_tree(tmp_path)
    private_source = tmp_path / "private-source.md"
    private_source.write_text("unlisted source\n", encoding="utf-8")
    linked = root / "linked.md"
    os.link(private_source, linked)

    with pytest.raises(PublicArtifactError, match="hard link"):
        build_public_artifact_manifest(
            root=root,
            release_id="memorixbench-design-v1",
            evidence_tier="design-only-v1",
            paths=("linked.md",),
        )


def test_public_artifact_manifest_rejects_unimplemented_confirmatory_tier(
    tmp_path: Path,
) -> None:
    root = _release_tree(tmp_path)

    with pytest.raises(PublicArtifactError, match="evidence tier"):
        build_public_artifact_manifest(
            root=root,
            release_id="memorixbench-confirmatory-v1",
            evidence_tier="confirmatory-summary-v1",
            paths=("README.md",),
        )


def test_public_artifact_summary_tier_requires_and_validates_the_summary(tmp_path: Path) -> None:
    root = _release_tree(tmp_path)
    summary_dir = root / "public-summary"
    summary_dir.mkdir()
    summary_path = summary_dir / "public-cohort-v1.json"
    analysis = {
        "schema_version": "public-reproducible-cohort-analysis-v1",
        "plan_id": "public-v1",
        "result_validation": {},
        "primary_success": {},
        "failure_summaries": [],
    }
    analysis_sha256 = __import__("hashlib").sha256(
        json.dumps(analysis, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode("ascii")
    ).hexdigest()
    summary_path.write_text(json.dumps({
        "schema_version": "public-cohort-summary-v1",
        "evidence_tier": "public-reproducible",
        "analysis_sha256": analysis_sha256,
        "analysis": analysis,
    }), encoding="utf-8")

    manifest = build_public_artifact_manifest(
        root=root,
        release_id="memorixbench-public-v1",
        evidence_tier="public-reproducible-summary-v1",
        paths=("README.md", "public-summary/public-cohort-v1.json"),
    )

    assert audit_public_artifact_manifest(manifest, root=root).entry_count == 2
    with pytest.raises(PublicArtifactError, match="requires its cohort summary"):
        build_public_artifact_manifest(
            root=root,
            release_id="memorixbench-public-v1",
            evidence_tier="public-reproducible-summary-v1",
            paths=("README.md",),
        )

    summary_path.write_text(json.dumps({
        "schema_version": "public-cohort-summary-v1",
        "evidence_tier": "public-reproducible",
        "analysis_sha256": analysis_sha256,
        "analysis": {**analysis, "plan_id": "tampered"},
    }), encoding="utf-8")
    with pytest.raises(PublicArtifactError, match="analysis hash does not match"):
        build_public_artifact_manifest(
            root=root,
            release_id="memorixbench-public-v1",
            evidence_tier="public-reproducible-summary-v1",
            paths=("README.md", "public-summary/public-cohort-v1.json"),
        )


def test_public_artifact_cli_builds_then_audits(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    root = _release_tree(tmp_path)
    manifest_path = tmp_path / "manifest.json"
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "memorixbench",
            "build-public-artifact-manifest",
            "--root",
            str(root),
            "--release-id",
            "memorixbench-design-v1",
            "--evidence-tier",
            "design-only-v1",
            "--include",
            "README.md",
            "--output",
            str(manifest_path),
        ],
    )

    assert cli.main() == 0
    summary = json.loads(capsys.readouterr().out)
    assert summary["entry_count"] == 1

    monkeypatch.setattr(
        sys,
        "argv",
        [
            "memorixbench",
            "audit-public-artifact-manifest",
            "--root",
            str(root),
            "--manifest",
            str(manifest_path),
        ],
    )
    assert cli.main() == 0
    audit = json.loads(capsys.readouterr().out)
    assert audit["entry_count"] == 1

    stage = tmp_path / "release-stage"
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "memorixbench",
            "materialize-public-artifact",
            "--root",
            str(root),
            "--manifest",
            str(manifest_path),
            "--target",
            str(stage),
        ],
    )
    assert cli.main() == 0
    materialized = json.loads(capsys.readouterr().out)
    assert materialized["entry_count"] == 1
    assert (stage / "README.md").is_file()
