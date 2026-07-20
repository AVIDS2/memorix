from pathlib import Path

from memorixbench.schema import load_case_manifest
import subprocess

from memorixbench.workspace import (
    apply_reference_patch,
    materialize_case,
    reset_history_to_snapshot,
    run_transfer_evaluation,
)


def test_materializes_precursor_and_transition_patches(tmp_path: Path) -> None:
    case_dir = tmp_path / "case"
    seed = case_dir / "seed"
    seed.mkdir(parents=True)
    (seed / "value.txt").write_text("base\n", encoding="utf-8")
    (case_dir / "precursor.patch").write_text(
        "--- a/value.txt\n+++ b/value.txt\n@@ -1 +1 @@\n-base\n+precursor\n",
        encoding="utf-8",
    )
    (case_dir / "transition.patch").write_text(
        "--- a/value.txt\n+++ b/value.txt\n@@ -1 +1 @@\n-precursor\n+transfer\n",
        encoding="utf-8",
    )
    (case_dir / "hidden.patch").write_text(
        "diff --git a/hidden.txt b/hidden.txt\n"
        "new file mode 100644\n"
        "--- /dev/null\n"
        "+++ b/hidden.txt\n"
        "@@ -0,0 +1 @@\n"
        "+hidden\n",
        encoding="utf-8",
    )
    (case_dir / "reference.patch").write_text(
        "--- a/value.txt\n+++ b/value.txt\n@@ -1 +1 @@\n-transfer\n+reference\n",
        encoding="utf-8",
    )
    manifest_path = case_dir / "case.toml"
    manifest_path.write_text(
        """
schema_version = "0.1"
id = "workspace-transition"
title = "Workspace transition"
split = "development"
language = "text"
tags = ["transition"]

[repository]
source_type = "local-fixture"
path = "seed"
base_revision = "fixture-base"

[precursor]
task = "Create the precursor state."
success_commands = ["git status --short"]
patch = "precursor.patch"

[transition]
kind = "code-change"
description = "Change the value between sessions."
apply_commands = []
patch = "transition.patch"

[transfer]
task = "Use the transfer state."
success_commands = ["git status --short"]

[oracle]
required_start_files = ["value.txt"]
relevant_evidence_ids = ["value:transfer"]
stale_evidence_ids = ["value:base"]
forbidden_actions = []
hidden_patch = "hidden.patch"
reference_patch = "reference.patch"
""".strip(),
        encoding="utf-8",
    )

    workspace = materialize_case(
        load_case_manifest(manifest_path),
        tmp_path / "workspace",
        stage="transfer",
    )

    assert (workspace.path / "value.txt").read_text(encoding="utf-8") == "transfer\n"
    assert workspace.base_commit
    assert workspace.precursor_commit
    assert workspace.transfer_commit
    assert workspace.precursor_patch_sha256
    assert workspace.transition_patch_sha256
    assert not (workspace.path / "hidden.txt").exists()

    snapshot_commit = reset_history_to_snapshot(workspace.path)
    log = subprocess.run(
        ["git", "log", "--oneline"],
        cwd=workspace.path,
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip().splitlines()
    assert len(log) == 1
    assert log[0].startswith(snapshot_commit[:7])

    reference_patch_sha256 = apply_reference_patch(
        load_case_manifest(manifest_path),
        workspace.path,
    )
    assert reference_patch_sha256
    assert (workspace.path / "value.txt").read_text(encoding="utf-8") == "reference\n"

    evaluation = run_transfer_evaluation(
        load_case_manifest(manifest_path),
        workspace.path,
    )
    assert evaluation.hidden_patch_sha256
    assert (workspace.path / "hidden.txt").read_text(encoding="utf-8") == "hidden\n"


def test_materializes_a_pinned_git_repository(tmp_path: Path) -> None:
    source = tmp_path / "source"
    source.mkdir()
    subprocess.run(["git", "init", "--quiet"], cwd=source, check=True)
    subprocess.run(
        ["git", "config", "user.name", "MemorixBench Test"],
        cwd=source,
        check=True,
    )
    subprocess.run(
        ["git", "config", "user.email", "memorixbench@example.invalid"],
        cwd=source,
        check=True,
    )
    (source / "value.txt").write_text("pinned\n", encoding="utf-8")
    subprocess.run(["git", "add", "value.txt"], cwd=source, check=True)
    subprocess.run(["git", "commit", "--quiet", "-m", "pinned"], cwd=source, check=True)
    pinned_revision = subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=source,
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()
    (source / "value.txt").write_text("later\n", encoding="utf-8")
    subprocess.run(["git", "add", "value.txt"], cwd=source, check=True)
    subprocess.run(["git", "commit", "--quiet", "-m", "later"], cwd=source, check=True)

    case_dir = tmp_path / "git-case"
    case_dir.mkdir()
    manifest_path = case_dir / "case.toml"
    manifest_path.write_text(
        f"""
schema_version = "0.1"
id = "pinned-git-source"
title = "Pinned Git source"
split = "development"
language = "text"
tags = ["git"]

[repository]
source_type = "git"
url = "{source.as_posix()}"
base_revision = "{pinned_revision}"
license = "MIT"

[precursor]
task = "Inspect the pinned source."
success_commands = ["git status --short"]

[transition]
kind = "none"
description = "No transition is required for this materialization test."
apply_commands = []

[transfer]
task = "Use the pinned source."
success_commands = ["git status --short"]

[oracle]
required_start_files = ["value.txt"]
relevant_evidence_ids = []
stale_evidence_ids = []
forbidden_actions = []
""".strip(),
        encoding="utf-8",
    )

    workspace = materialize_case(
        load_case_manifest(manifest_path),
        tmp_path / "pinned-workspace",
        stage="transfer",
    )

    assert workspace.base_commit == pinned_revision
    assert (workspace.path / "value.txt").read_text(encoding="utf-8") == "pinned\n"
