import json
from pathlib import Path
import sys

from memorixbench.authoring import verify_case_authoring
from memorixbench.schema import load_case_manifest


def test_verifies_all_authoring_gates(tmp_path: Path) -> None:
    case_dir = tmp_path / "case"
    seed = case_dir / "seed"
    seed.mkdir(parents=True)
    (seed / "value.txt").write_text("base\n", encoding="utf-8")
    (seed / "precursor_check.py").write_text(
        "from pathlib import Path\n"
        "raise SystemExit(Path('value.txt').read_text(encoding='utf-8') != 'base\\n')\n",
        encoding="utf-8",
    )
    (seed / "transfer_check.py").write_text(
        "from pathlib import Path\n"
        "raise SystemExit(Path('value.txt').read_text(encoding='utf-8') != 'broken\\n')\n",
        encoding="utf-8",
    )
    (case_dir / "transition.patch").write_text(
        "--- a/value.txt\n+++ b/value.txt\n@@ -1 +1 @@\n-base\n+broken\n",
        encoding="utf-8",
    )
    (case_dir / "hidden.patch").write_text(
        "--- a/transfer_check.py\n+++ b/transfer_check.py\n"
        "@@ -1,2 +1,2 @@\n"
        " from pathlib import Path\n"
        "-raise SystemExit(Path('value.txt').read_text(encoding='utf-8') != 'broken\\n')\n"
        "+raise SystemExit(Path('value.txt').read_text(encoding='utf-8') != 'fixed\\n')\n",
        encoding="utf-8",
    )
    (case_dir / "reference.patch").write_text(
        "--- a/value.txt\n+++ b/value.txt\n@@ -1 +1 @@\n-broken\n+fixed\n",
        encoding="utf-8",
    )
    executable = sys.executable.replace("\\", "/")
    precursor_command = json.dumps(f'"{executable}" precursor_check.py')
    transfer_command = json.dumps(f'"{executable}" transfer_check.py')
    manifest_path = case_dir / "case.toml"
    manifest_path.write_text(
        f"""
schema_version = "0.5"
id = "authoring-verification"
title = "Authoring verification"
split = "development"
dependency_strength = "low"
dependency_classification_status = "retrospective-development"
language = "text"
tags = ["authoring"]

[repository]
source_type = "local-fixture"
path = "seed"
base_revision = "fixture-base"

[precursor]
task = "Check the precursor."
success_commands = [{precursor_command}]

[transition]
kind = "code-change"
description = "Introduce the controlled transfer regression."
apply_commands = []
patch = "transition.patch"

[transfer]
task = "Repair the transfer regression."
success_commands = [{transfer_command}]

[oracle]
visibility = "public"
required_start_files = ["value.txt"]
relevant_evidence_ids = []
stale_evidence_ids = []
forbidden_actions = []
hidden_patch = "hidden.patch"
reference_patch = "reference.patch"
""".strip(),
        encoding="utf-8",
    )

    verification = verify_case_authoring(
        load_case_manifest(manifest_path),
        tmp_path / "authoring-artifacts",
    )

    assert verification.passed
    assert [gate.name for gate in verification.gates] == [
        "precursor-public",
        "transfer-public",
        "transfer-hidden-regression",
        "transfer-reference",
    ]
    assert verification.gates[2].commands[0].returncode == 1
    assert verification.gates[3].commands[0].returncode == 0
    assert {gate.repository_transport for gate in verification.gates} == {"local-fixture"}
    assert {gate.repository_origin for gate in verification.gates} == {None}
