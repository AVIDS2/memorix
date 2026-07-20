from pathlib import Path

import pytest

from memorixbench.schema import ManifestError, load_case_manifest


VALID_CASE = """
schema_version = "0.1"
id = "typescript-auth-transfer"
title = "Auth ownership transfer"
split = "development"
language = "typescript"
tags = ["cross-session", "stale-symbol"]

[repository]
source_type = "local-fixture"
path = "fixtures/typescript-auth"
base_revision = "fixture-v1"

[precursor]
task = "Repair the original token validator."
success_commands = ["npm test"]

[transition]
kind = "code-change"
description = "Move validation ownership to the session boundary."
apply_commands = ["git apply transition.patch"]

[transfer]
task = "Continue the authentication regression after the ownership change."
success_commands = ["npm test"]

[oracle]
required_start_files = ["src/session.ts"]
relevant_evidence_ids = ["test:session-auth"]
stale_evidence_ids = ["obs:legacy-auth-owner"]
forbidden_actions = ["restore the removed auth validator"]
"""


def write_case(tmp_path: Path, content: str = VALID_CASE) -> Path:
    path = tmp_path / "case.toml"
    path.write_text(content, encoding="utf-8")
    return path


def test_loads_valid_case(tmp_path: Path) -> None:
    case = load_case_manifest(write_case(tmp_path))
    assert case.case_id == "typescript-auth-transfer"
    assert case.transition.kind == "code-change"
    assert case.oracle.stale_evidence_ids == ("obs:legacy-auth-owner",)


def test_rejects_evidence_marked_relevant_and_stale(tmp_path: Path) -> None:
    content = VALID_CASE.replace(
        'stale_evidence_ids = ["obs:legacy-auth-owner"]',
        'stale_evidence_ids = ["test:session-auth"]',
    )
    with pytest.raises(ManifestError, match="both relevant and stale"):
        load_case_manifest(write_case(tmp_path, content))


def test_requires_git_license(tmp_path: Path) -> None:
    content = VALID_CASE.replace(
        'source_type = "local-fixture"\npath = "fixtures/typescript-auth"',
        'source_type = "git"\nurl = "https://example.test/repo.git"',
    )
    with pytest.raises(ManifestError, match="url and repository.license"):
        load_case_manifest(write_case(tmp_path, content))


def test_parses_atomic_memory_seeds(tmp_path: Path) -> None:
    content = VALID_CASE + """

[[memory_seed]]
entity_name = "token-policy"
type = "decision"
title = "Token policy"
narrative = "Tokens require a prefix and a minimum length."
facts = ["Prefix: tok_"]
files_modified = []
concepts = ["authentication"]
topic_key = "policy/token"
"""

    case = load_case_manifest(write_case(tmp_path, content))

    assert len(case.memory_seeds) == 1
    assert case.memory_seeds[0].entity_name == "token-policy"
    assert case.memory_seeds[0].facts == ("Prefix: tok_",)


def test_parses_oracle_reference_patch(tmp_path: Path) -> None:
    content = VALID_CASE.replace(
        "[oracle]\n",
        "[oracle]\nreference_patch = \"reference.patch\"\n",
    )

    case = load_case_manifest(write_case(tmp_path, content))

    assert case.oracle.reference_patch == "reference.patch"


def test_parses_scoped_source_check(tmp_path: Path) -> None:
    content = VALID_CASE.replace(
        'forbidden_actions = ["restore the removed auth validator"]',
        '''forbidden_actions = ["restore the removed auth validator"]

[[oracle.source_check]]
path = "src/session.ts"
scope_start = "export function validate"
scope_end = "export function next"
required_literals = ["return true"]
forbidden_literals = ["return false"]''',
    )

    case = load_case_manifest(write_case(tmp_path, content))

    assert case.oracle.source_checks[0].path == "src/session.ts"
    assert case.oracle.source_checks[0].scope_start == "export function validate"
    assert case.oracle.source_checks[0].forbidden_literals == ("return false",)


def test_rejects_empty_source_check(tmp_path: Path) -> None:
    content = VALID_CASE.replace(
        'forbidden_actions = ["restore the removed auth validator"]',
        '''forbidden_actions = []

[[oracle.source_check]]
path = "src/session.ts"''',
    )

    with pytest.raises(ManifestError, match="requires required_literals or forbidden_literals"):
        load_case_manifest(write_case(tmp_path, content))


def test_rejects_duplicate_memory_seed_topic_keys(tmp_path: Path) -> None:
    content = VALID_CASE + """

[[memory_seed]]
entity_name = "one"
type = "decision"
title = "One"
narrative = "One."
facts = []
files_modified = []
concepts = []
topic_key = "duplicate"

[[memory_seed]]
entity_name = "two"
type = "decision"
title = "Two"
narrative = "Two."
facts = []
files_modified = []
concepts = []
topic_key = "duplicate"
"""

    with pytest.raises(ManifestError, match="duplicates an earlier"):
        load_case_manifest(write_case(tmp_path, content))
