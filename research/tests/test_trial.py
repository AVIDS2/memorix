from dataclasses import replace
from pathlib import Path
from types import SimpleNamespace

import pytest

from memorixbench.agents import AgentExecution, ModelUsage
from memorixbench.baseline import RetrievedMemory, build_retrieval
from memorixbench.memorix_adapter import MemorixCanonicalRetrieval
from memorixbench.schema import load_case_manifest
from memorixbench.case_bundle import archive_public_case_definition
from memorixbench.trial import (
    AGENTMEMORY_PROVIDER_ID,
    MEMORIX_CANONICAL_PROVIDER_ID,
    build_claude_allowed_tools,
    build_condition_prompt,
    ensure_development_case,
    is_valid_execution,
    is_task_success,
    _matches_required_single_model,
    _trial_run_directory,
    run_trial,
    validate_trial_outcome,
)
from memorixbench.trace import TraceView


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
    assert "Bash(git *)" in no_memory
    assert "Bash" not in no_memory
    assert "mcp__memorix__memorix_project_context" not in no_memory
    assert "mcp__memorix__memorix_project_context" in memorix


def test_budget_and_timeout_are_valid_task_failures() -> None:
    assert is_valid_execution("budget-exhausted", environment_violation=False)
    assert is_valid_execution("timeout", environment_violation=False)
    assert not is_valid_execution("authentication", environment_violation=False)
    assert not is_valid_execution("mcp-startup", environment_violation=False)
    assert not is_valid_execution("model-route-mismatch", environment_violation=False)
    assert not is_valid_execution(None, environment_violation=True)


def test_timeout_or_budget_exhaustion_cannot_count_as_task_success() -> None:
    assert not is_task_success(True, completed=False, timed_out=True, failure_reason="timeout")
    assert not is_task_success(True, completed=True, timed_out=False, failure_reason="budget-exhausted")
    assert not is_task_success(True, completed=False, timed_out=False, failure_reason=None)
    assert is_task_success(True, completed=True, timed_out=False, failure_reason=None)


def test_required_single_model_route_requires_exact_provider_telemetry() -> None:
    single_usage = (
        ModelUsage(
            model="model-a",
            input_tokens=1,
            cached_input_tokens=None,
            output_tokens=1,
            cost_usd=0.01,
        ),
    )

    assert _matches_required_single_model(
        "model-a",
        reported_models=("model-a",),
        model_usage=single_usage,
    )
    assert not _matches_required_single_model(
        "model-a",
        reported_models=("model-a", "helper-model"),
        model_usage=single_usage,
    )
    assert not _matches_required_single_model(
        "model-a",
        reported_models=("model-a",),
        model_usage=(*single_usage, replace(single_usage[0], model="helper-model")),
    )


def test_trial_artifacts_use_a_short_run_directory(tmp_path: Path) -> None:
    root = tmp_path / ("long-artifact-root-" * 8)
    run_directory = _trial_run_directory(root, "run-123")

    assert run_directory == root / "runs" / "run-123"
    assert "client-default" not in str(run_directory)


def test_last_n_prompt_contains_bounded_precursor_record() -> None:
    prompt = build_condition_prompt(load_case_manifest(CASE), "last-n")
    assert "<prior_session>" in prompt
    assert "src/auth.js#validateToken" in prompt
    assert "at least eighteen characters" in prompt
    assert "issuer shard marker" in prompt


def test_track_c_last_n_requires_a_prepared_event_aligned_view() -> None:
    manifest = replace(load_case_manifest(CASE), formation_track="trace-replay")
    view = TraceView(
        renderer="event-suffix-v1",
        trace_sha256="trace-hash",
        token_budget=180,
        token_count=20,
        context="[session=s1 sequence=1 turn=1 role=assistant kind=message]\nbounded evidence",
        retained_event_ids=("event-1",),
        dropped_event_ids=(),
        truncated=False,
        sha256="view-hash",
    )

    prompt = build_condition_prompt(manifest, "last-n", trace_view=view)

    assert "bounded evidence" in prompt
    assert "issuer shard marker" not in prompt
    with pytest.raises(ValueError, match="prepared bounded trace view"):
        build_condition_prompt(manifest, "last-n")


def test_memorix_prompt_does_not_inline_the_precursor_record() -> None:
    prompt = build_condition_prompt(
        load_case_manifest(CASE),
        "memorix-1.2.1-micro-local",
    )
    assert "<prior_session>" not in prompt
    assert "at least twelve characters" not in prompt


def test_memorix_canonical_prompt_uses_injected_context_without_native_mcp() -> None:
    manifest = load_case_manifest(CASE)
    prompt = build_condition_prompt(
        manifest,
        MEMORIX_CANONICAL_PROVIDER_ID,
        retrieved_context="Retrieved project memory follows.\n\n[1] durable policy",
    )

    assert "<retrieved_memory>" in prompt
    assert "durable policy" in prompt
    assert "mcp__memorix" not in build_claude_allowed_tools(
        manifest,
        MEMORIX_CANONICAL_PROVIDER_ID,
    )


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


def test_archives_complete_case_definition(tmp_path: Path) -> None:
    manifest = load_case_manifest(CASE)

    first_hash = archive_public_case_definition(manifest, tmp_path / "first")
    second_hash = archive_public_case_definition(manifest, tmp_path / "second")

    assert first_hash == second_hash
    assert (tmp_path / "first" / "case-definition" / "case.toml").is_file()
    assert (tmp_path / "first" / "case-definition" / "hidden-tests.patch").is_file()


def _pending_outcome(**overrides: object) -> SimpleNamespace:
    value = {
        "study_track": "B",
        "formation_track": "seeded-canonical",
        "condition": "no-memory",
        "precursor_trace_sha256": None,
        "precursor_trace_source_sha256": None,
        "precursor_trace_view_sha256": None,
        "precursor_trace_capture_id": None,
        "precursor_trace_selection": None,
        "precursor_trace_bundle_sha256": None,
        "precursor_transcript_sha256": None,
        "raw_replay_context_tokens": None,
        "retrieval_call_count": None,
        "retrieval_round_count": None,
        "native_mcp_policy_sha256": None,
        "native_mcp_call_budget": None,
        "native_mcp_receipt_status": "not-applicable-v1",
        "native_mcp_call_attempt_count": None,
        "native_mcp_served_call_count": None,
        "native_mcp_context_tokens": None,
        "native_mcp_context_truncated": None,
        "memory_tool_attempt_count": 0,
        "memory_tool_call_count": 0,
        "tool_call_count": 0,
        "successful_tool_call_count": 0,
        "agent_action_ledger_sha256": "a" * 64,
        "agent_action_count": 0,
        "annotation_status": "pending-v1",
        "annotation_summary_sha256": None,
        "first_correct_action_seconds": None,
        "first_correct_action_status": "pending-v1",
        "stale_memory_errors": None,
        "stale_memory_error_status": "pending-v1",
        "negative_control_intrusions": None,
        "negative_control_intrusion_status": "pending-v1",
        "formation_receipt": None,
    }
    value.update(overrides)
    return SimpleNamespace(**value)


def test_outcome_validator_rejects_fake_pending_zeroes() -> None:
    outcome = _pending_outcome(stale_memory_errors=0)

    with pytest.raises(ValueError, match="pending annotation outcomes"):
        validate_trial_outcome(outcome)  # type: ignore[arg-type]


def test_outcome_validator_accepts_a_pending_unmeasured_run() -> None:
    validate_trial_outcome(_pending_outcome())  # type: ignore[arg-type]


def test_outcome_validator_requires_track_c_trace_and_formation_receipt() -> None:
    outcome = _pending_outcome(
        study_track="C",
        formation_track="trace-replay",
        condition="mem0-2.0.12-local",
        precursor_trace_sha256="b" * 64,
        precursor_trace_source_sha256="c" * 64,
        formation_receipt={"surface": "trace-replay", "trace_sha256": "different"},
    )

    with pytest.raises(ValueError, match="different trace"):
        validate_trial_outcome(outcome)  # type: ignore[arg-type]


def test_outcome_validator_rejects_native_mcp_budget_overrun() -> None:
    outcome = _pending_outcome(
        condition="memorix-1.2.1-micro-local",
        formation_receipt={"surface": "seeded-canonical"},
        native_mcp_policy_sha256="d" * 64,
        native_mcp_call_budget=1,
        native_mcp_receipt_status="recorded-v1",
        native_mcp_call_attempt_count=2,
        native_mcp_served_call_count=2,
        native_mcp_context_tokens=180,
        native_mcp_context_truncated=True,
    )

    with pytest.raises(ValueError, match="exceeded its call budget"):
        validate_trial_outcome(outcome)  # type: ignore[arg-type]


def test_canonical_memorix_trial_uses_injected_context_not_native_mcp(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import memorixbench.trial as module

    cli = tmp_path / "memorix-cli.js"
    cli.write_text("placeholder", encoding="utf-8")
    retrieval = build_retrieval(
        provider=MEMORIX_CANONICAL_PROVIDER_ID,
        provider_version=None,
        query="Continue the token-validation migration.",
        records=(RetrievedMemory(memory_id="obs:1", content="durable policy"),),
        token_budget=180,
    )

    def fake_seed(**_kwargs: object) -> dict[str, object]:
        return {
            "project_id": "project-a",
            "maintenance": {
                "poll_count": 0,
                "settled_for_retrieval": True,
                "mode": "deferred-after-synchronous-store-v1",
            },
            "formation_receipt": {
                "surface": "seeded-canonical",
                "write_operation_count": 2,
                "transport_call_count": 3,
                "maintenance_call_count": 0,
                "record_count": 2,
            },
        }

    def fake_retrieve(**_kwargs: object) -> MemorixCanonicalRetrieval:
        return MemorixCanonicalRetrieval(
            retrieval=retrieval,
            candidate_refs=("obs:1",),
            transport_call_count=2,
        )

    def fake_run_agent(**kwargs: object) -> AgentExecution:
        artifact_dir = kwargs["artifact_dir"]
        assert isinstance(artifact_dir, Path)
        artifact_dir.mkdir(parents=True, exist_ok=True)
        patch_path = artifact_dir / "candidate.patch"
        patch_path.write_text("", encoding="utf-8")
        assert kwargs["mcp_config"] is None
        assert "<retrieved_memory>" in str(kwargs["prompt"])
        return AgentExecution(
            agent="claude",
            model="test-model",
            reported_models=("test-model",),
            model_usage=(),
            returncode=0,
            timed_out=False,
            completed=True,
            failure_reason=None,
            wall_seconds=0.01,
            input_tokens=None,
            cached_input_tokens=None,
            output_tokens=None,
            reasoning_output_tokens=None,
            cost_usd=None,
            event_count=0,
            command_count=0,
            tool_call_count=0,
            tool_names=(),
            tool_call_names=(),
            successful_tool_call_count=0,
            successful_tool_names=(),
            successful_tool_call_names=(),
            permission_denials=(),
            unavailable_tool_attempts=(),
            bash_commands=(),
            final_message="done",
            events_path=artifact_dir / "events.jsonl",
            timeline_path=artifact_dir / "timeline.jsonl",
            action_ledger_path=artifact_dir / "action-ledger.json",
            action_ledger_sha256="a" * 64,
            action_count=0,
            action_timing_source="stream-monotonic-v1",
            stderr_path=artifact_dir / "stderr.log",
            patch_path=patch_path,
        )

    monkeypatch.setattr(module, "load_claude_provider_env", lambda _path: {})
    monkeypatch.setattr(module, "archive_public_case_definition", lambda *_args, **_kwargs: "b" * 64)
    monkeypatch.setattr(module, "seed_memorix_canonical_evidence", fake_seed)
    monkeypatch.setattr(module, "retrieve_memorix_canonical", fake_retrieve)
    monkeypatch.setattr(module, "run_agent", fake_run_agent)
    monkeypatch.setattr(
        module,
        "run_transfer_evaluation",
        lambda *_args, **_kwargs: SimpleNamespace(
            passed=True,
            commands=(),
            source_checks=(),
            hidden_patch_sha256=None,
            source_check_phase=None,
        ),
    )

    outcome = run_trial(
        case_path=CASE,
        artifact_root=tmp_path / "artifacts",
        study_id="unit",
        condition=MEMORIX_CANONICAL_PROVIDER_ID,
        agent="claude",
        model="test-model",
        repetition=0,
        seed=1,
        memorix_cli=cli,
        workspace_root=tmp_path / "workspaces",
        claude_provider_settings=tmp_path / "provider.json",
    )

    assert outcome.memory_provider == "memorix"
    assert outcome.retrieval_call_count == 1
    assert outcome.retrieval_round_count == 1
    assert outcome.retrieved_context_tokens == retrieval.token_count
    assert outcome.native_mcp_receipt_status == "not-applicable-v1"
    assert outcome.native_mcp_policy_sha256 is None
