from pathlib import Path

import pytest

from memorixbench.schema import ManifestError, load_case_manifest


VALID_CASE = """
schema_version = "0.5"
id = "typescript-auth-transfer"
title = "Auth ownership transfer"
split = "development"
dependency_strength = "medium"
dependency_classification_status = "retrospective-development"
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
visibility = "public"
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
    assert case.dependency_strength == "medium"
    assert case.dependency_classification_status == "retrospective-development"
    assert case.oracle.visibility == "public"
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
    ).replace('base_revision = "fixture-v1"', 'base_revision = "0123456789abcdef0123456789abcdef01234567"')
    with pytest.raises(ManifestError, match="url and repository.license"):
        load_case_manifest(write_case(tmp_path, content))


def test_rejects_mutable_git_base_revision(tmp_path: Path) -> None:
    content = VALID_CASE.replace(
        'source_type = "local-fixture"\npath = "fixtures/typescript-auth"',
        'source_type = "git"\nurl = "https://example.test/repo.git"\nlicense = "MIT"',
    ).replace('base_revision = "fixture-v1"', 'base_revision = "HEAD"')

    with pytest.raises(ManifestError, match="40-character commit SHA"):
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


def test_rejects_source_check_path_escape(tmp_path: Path) -> None:
    content = VALID_CASE.replace(
        'forbidden_actions = ["restore the removed auth validator"]',
        '''forbidden_actions = []

[[oracle.source_check]]
path = "../outside.txt"
required_literals = ["expected"]''',
    )

    with pytest.raises(ManifestError, match="must stay inside the repository"):
        load_case_manifest(write_case(tmp_path, content))


def test_rejects_unknown_dependency_strength(tmp_path: Path) -> None:
    content = VALID_CASE.replace(
        'dependency_strength = "medium"',
        'dependency_strength = "unknown"',
    )

    with pytest.raises(ManifestError, match="dependency_strength"):
        load_case_manifest(write_case(tmp_path, content))


def test_rejects_unknown_dependency_classification_status(tmp_path: Path) -> None:
    content = VALID_CASE.replace(
        'dependency_classification_status = "retrospective-development"',
        'dependency_classification_status = "unknown"',
    )

    with pytest.raises(ManifestError, match="dependency_classification_status"):
        load_case_manifest(write_case(tmp_path, content))


def test_private_oracle_assets_are_not_public_manifest_fields(tmp_path: Path) -> None:
    content = VALID_CASE.replace(
        'visibility = "public"',
        'visibility = "private"\nhidden_patch = "hidden.patch"',
    )

    with pytest.raises(ManifestError, match="private oracle assets"):
        load_case_manifest(write_case(tmp_path, content))


def test_test_split_requires_private_preregistered_oracle(tmp_path: Path) -> None:
    content = VALID_CASE.replace('split = "development"', 'split = "test"').replace(
        'dependency_classification_status = "retrospective-development"',
        'dependency_classification_status = "preregistered"',
    ).replace('visibility = "public"', 'visibility = "private"').replace(
        'forbidden_actions = ["restore the removed auth validator"]',
        '''required_isolation_profile = "remote-worker-vault-v1"
verifier_mode = "black-box-controller-v1"
forbidden_actions = []''',
    ).replace(
        "[repository]",
        '''[bundle]
public_paths = ["case.toml", "fixtures/typescript-auth"]

[repository]''',
    )

    case = load_case_manifest(write_case(tmp_path, content))

    assert case.oracle.visibility == "private"
    assert case.oracle.required_isolation_profile == "remote-worker-vault-v1"
    assert case.public_bundle_paths == ("case.toml", "fixtures/typescript-auth")


def test_confirmatory_case_requires_public_bundle_allowlist(tmp_path: Path) -> None:
    content = VALID_CASE.replace('split = "development"', 'split = "test"').replace(
        'dependency_classification_status = "retrospective-development"',
        'dependency_classification_status = "preregistered"',
    ).replace('visibility = "public"', 'visibility = "private"').replace(
        'forbidden_actions = ["restore the removed auth validator"]',
        '''required_isolation_profile = "remote-worker-vault-v1"
verifier_mode = "black-box-controller-v1"
forbidden_actions = []''',
    )

    with pytest.raises(ManifestError, match="public_paths allowlist"):
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


def test_defaults_to_seeded_canonical_formation(tmp_path: Path) -> None:
    case = load_case_manifest(write_case(tmp_path))

    assert case.formation_track == "seeded-canonical"
    assert case.study_track == "B"
    assert case.precursor_trace is None


def test_rejects_noncanonical_formation_without_trace(tmp_path: Path) -> None:
    content = VALID_CASE.replace(
        "[repository]",
        "[formation]\ntrack = \"trace-replay\"\n\n[repository]",
    )

    with pytest.raises(ManifestError, match="require precursor_trace"):
        load_case_manifest(write_case(tmp_path, content))


def test_track_c_rejects_seeded_evidence_and_raw_transcript(tmp_path: Path) -> None:
    content = VALID_CASE.replace(
        "[repository]",
        '''[formation]
track = "trace-replay"

[formation.precursor_trace]
path = "trace.json"
schema_version = "precursor-trace-v1"
provenance = "captured-session-v1"
normalization = "event-normalize-v1"
truncation = "event-suffix-v1"

[repository]''',
    ).replace(
        'success_commands = ["npm test"]\n\n[transition]',
        'success_commands = ["npm test"]\ntranscript = "precursor.md"\n\n[transition]',
        1,
    ) + '''

[[memory_seed]]
entity_name = "leak"
type = "decision"
title = "Leak"
narrative = "This must not enter Track C."
facts = []
files_modified = []
concepts = []
'''

    with pytest.raises(ManifestError, match="Track C cases must not declare memory_seed"):
        load_case_manifest(write_case(tmp_path, content))


def test_track_c_rejects_raw_precursor_transcript_without_seed(tmp_path: Path) -> None:
    content = VALID_CASE.replace(
        "[repository]",
        '''[formation]
track = "trace-replay"

[formation.precursor_trace]
path = "trace.json"
schema_version = "precursor-trace-v1"
provenance = "captured-session-v1"
normalization = "event-normalize-v1"
truncation = "event-suffix-v1"

[repository]''',
    ).replace(
        'success_commands = ["npm test"]\n\n[transition]',
        'success_commands = ["npm test"]\ntranscript = "precursor.md"\n\n[transition]',
        1,
    )

    with pytest.raises(ManifestError, match="precursor_trace"):
        load_case_manifest(write_case(tmp_path, content))


def test_track_c_requires_trace_truncation_contract(tmp_path: Path) -> None:
    content = VALID_CASE.replace(
        "[repository]",
        '''[formation]
track = "trace-replay"

[formation.precursor_trace]
path = "trace.json"
schema_version = "precursor-trace-v1"
provenance = "captured-session-v1"
normalization = "event-normalize-v1"

[repository]''',
    )

    with pytest.raises(ManifestError, match="truncation"):
        load_case_manifest(write_case(tmp_path, content))
