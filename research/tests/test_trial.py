from dataclasses import replace
from pathlib import Path

import pytest

from memorixbench.schema import load_case_manifest
from memorixbench.trial import (
    AGENTMEMORY_PROVIDER_ID,
    build_claude_allowed_tools,
    build_condition_prompt,
    ensure_development_case,
    is_valid_execution,
)


CASE = Path(__file__).parents[1] / "cases" / "development" / "typescript-auth-ownership" / "case.toml"


def test_no_memory_prompt_has_no_precursor_record() -> None:
    prompt = build_condition_prompt(load_case_manifest(CASE), "no-memory")
    assert "<prior_session>" not in prompt
    assert "A regression now accepts prefixed tokens that violate the existing security policy" in prompt
    assert "configured project-context or memory capability" in prompt
    assert "single transfer snapshot" in prompt
    assert "You are already in the repository" in prompt
    assert "Use normal source-inspection and verification commands" in prompt
    assert "Trusted verification command for this case: `npm test`" in prompt


def test_claude_allowlist_includes_case_verification_only() -> None:
    manifest = load_case_manifest(CASE)

    no_memory = build_claude_allowed_tools(manifest, "no-memory")
    memorix = build_claude_allowed_tools(manifest, "memorix-1.2.1-micro-local")

    assert "Bash(npm test)" in no_memory
    assert "mcp__memorix__memorix_project_context" not in no_memory
    assert "mcp__memorix__memorix_project_context" in memorix


def test_budget_and_timeout_are_valid_task_failures() -> None:
    assert is_valid_execution("budget-exhausted", environment_violation=False)
    assert is_valid_execution("timeout", environment_violation=False)
    assert not is_valid_execution("authentication", environment_violation=False)
    assert not is_valid_execution("mcp-startup", environment_violation=False)
    assert not is_valid_execution(None, environment_violation=True)


def test_last_n_prompt_contains_bounded_precursor_record() -> None:
    prompt = build_condition_prompt(load_case_manifest(CASE), "last-n")
    assert "<prior_session>" in prompt
    assert "src/auth.js#validateToken" in prompt
    assert "at least eighteen characters" in prompt
    assert "issuer shard marker" in prompt


def test_memorix_prompt_does_not_inline_the_precursor_record() -> None:
    prompt = build_condition_prompt(
        load_case_manifest(CASE),
        "memorix-1.2.1-micro-local",
    )
    assert "<prior_session>" not in prompt
    assert "at least twelve characters" not in prompt


def test_mem0_prompt_inlines_only_retrieved_canonical_context() -> None:
    prompt = build_condition_prompt(
        load_case_manifest(CASE),
        "mem0-2.0.12-local",
        retrieved_context="Retrieved project memory follows.\n\n[1] durable policy",
    )

    assert "<retrieved_memory>" in prompt
    assert "durable policy" in prompt
    assert "<prior_session>" not in prompt


def test_mem0_prompt_requires_retrieval() -> None:
    manifest = load_case_manifest(CASE)

    try:
        build_condition_prompt(manifest, "mem0-2.0.12-local")
    except ValueError as error:
        assert "requires retrieved context" in str(error)
    else:
        raise AssertionError("Mem0 condition should require retrieved context")


def test_agentmemory_canonical_prompt_uses_the_same_context_boundary() -> None:
    prompt = build_condition_prompt(
        load_case_manifest(CASE),
        AGENTMEMORY_PROVIDER_ID,
        retrieved_context="Retrieved project memory follows.\n\n[1] durable policy",
    )

    assert "<retrieved_memory>" in prompt
    assert "durable policy" in prompt
    assert "mcp__agentmemory" not in build_claude_allowed_tools(
        load_case_manifest(CASE), AGENTMEMORY_PROVIDER_ID
    )


def test_non_development_cases_are_not_executable_yet() -> None:
    manifest = replace(load_case_manifest(CASE), split="test")

    with pytest.raises(ValueError, match="private-oracle overlays"):
        ensure_development_case(manifest)
