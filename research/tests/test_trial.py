from dataclasses import replace
from pathlib import Path
import subprocess
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
    ensure_trial_eligibility,
    is_valid_execution,
    is_task_success,
    _matches_required_single_model,
    _clean_agent_start_snapshot,
    _git_root_or_self,
    _tool_policy_hash,
    _trial_run_directory,
    run_trial,
    validate_trial_outcome,
)
from memorixbench.trace import TraceView


CASE = Path(__file__).parent / "fixtures" / "prompt-case" / "case.toml"


def test_no_memory_prompt_has_no_precursor_record() -> None:
    prompt = build_condition_prompt(load_case_manifest(CASE), "no-memory")
    assert "<prior_session>" not in prompt
    assert "restore the durable project policy" in prompt
    assert "No prior project memory or session record is available" in prompt
    assert "single transfer snapshot" in prompt
    assert "You are already in the repository" in prompt
    assert "Use normal source-inspection and verification commands" in prompt
    assert "never `cd` into `/workspace`" in prompt
    assert "Git Bash" in prompt
    assert "Trusted verification command for this case: `git status --short`" in prompt


def test_claude_allowlist_includes_case_verification_only() -> None:
    manifest = load_case_manifest(CASE)

    no_memory = build_claude_allowed_tools(manifest, "no-memory")
    memorix = build_claude_allowed_tools(manifest, "memorix-1.2.1-native-autopilot-local")

    assert "Bash(git status --short)" in no_memory
    assert "Bash(git *)" in no_memory
    assert "Bash(ls *)" in no_memory
    assert "Bash(cat *)" in no_memory
    assert "Bash(rg *)" in no_memory
    assert "Bash(xxd *)" in no_memory
    assert "Bash(diff *)" in no_memory
    assert "Bash" not in no_memory
    assert "mcp__memorix__memorix_project_context" not in no_memory
    assert "mcp__memorix__memorix_project_context" in memorix


def test_memory_access_does_not_change_the_ordinary_tool_policy() -> None:
    manifest = load_case_manifest(CASE)
    no_memory = build_claude_allowed_tools(manifest, "no-memory")
    selective = build_claude_allowed_tools(
        manifest,
        "memorix-1.2.1-selective-local",
    )

    assert _tool_policy_hash(
        no_memory,
        include_memory_tools=False,
    ) == _tool_policy_hash(
        selective,
        include_memory_tools=False,
    )
    assert _tool_policy_hash(
        no_memory,
        include_memory_tools=True,
    ) != _tool_policy_hash(
        selective,
        include_memory_tools=True,
    )


def test_budget_and_timeout_are_valid_task_failures() -> None:
    assert is_valid_execution("budget-exhausted", environment_violation=False)
    assert is_valid_execution("timeout", environment_violation=False)
    assert not is_valid_execution("authentication", environment_violation=False)
    assert not is_valid_execution("mcp-startup", environment_violation=False)
    assert not is_valid_execution("model-route-mismatch", environment_violation=False)
    assert not is_valid_execution(None, environment_violation=True)


def test_public_evaluation_requires_bounded_openrouter_surface() -> None:
    manifest = SimpleNamespace(
        split="public-evaluation",
        oracle=SimpleNamespace(agent_writable_paths=("src",)),
    )
    oracle_assets = SimpleNamespace(visibility="public")

    assert ensure_trial_eligibility(
        manifest,
        agent="openrouter",
        oracle_assets=oracle_assets,
    ) == "public-reproducible"
    with pytest.raises(ValueError, match="bounded OpenRouter"):
        ensure_trial_eligibility(
            manifest,
            agent="claude",
            oracle_assets=oracle_assets,
        )


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


def test_non_git_case_root_remains_an_explicit_denied_root(tmp_path: Path) -> None:
    case_root = tmp_path / "external-case"
    case_root.mkdir()

    assert _git_root_or_self(case_root) == case_root.resolve()


def test_agent_start_snapshot_rejects_ignored_files(tmp_path: Path) -> None:
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    subprocess.run(["git", "init", "--quiet"], cwd=workspace, check=True)
    subprocess.run(["git", "config", "user.name", "MemorixBench Test"], cwd=workspace, check=True)
    subprocess.run(["git", "config", "user.email", "test@example.invalid"], cwd=workspace, check=True)
    (workspace / ".gitignore").write_text("leftover.txt\n", encoding="utf-8")
    (workspace / "tracked.txt").write_text("transfer\n", encoding="utf-8")
    subprocess.run(["git", "add", ".gitignore", "tracked.txt"], cwd=workspace, check=True)
    subprocess.run(["git", "commit", "--quiet", "-m", "transfer"], cwd=workspace, check=True)
    (workspace / "leftover.txt").write_text("prior run artifact\n", encoding="utf-8")

    with pytest.raises(RuntimeError, match="dirty before agent start"):
        _clean_agent_start_snapshot(workspace)


def test_last_n_prompt_contains_bounded_precursor_record() -> None:
    prompt = build_condition_prompt(load_case_manifest(CASE), "last-n")
    assert "<prior_session>" in prompt
    assert "durable project policy survives" in prompt


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
    assert "durable project policy survives" not in prompt
    with pytest.raises(ValueError, match="prepared bounded trace view"):
        build_condition_prompt(manifest, "last-n")


def test_memorix_prompt_does_not_inline_the_precursor_record() -> None:
    prompt = build_condition_prompt(
        load_case_manifest(CASE),
        "memorix-1.2.1-native-autopilot-local",
    )
    assert "<prior_session>" not in prompt
    assert "durable project policy survives" not in prompt


def test_selective_memorix_keeps_memory_available_but_optional() -> None:
    manifest = load_case_manifest(CASE)

    prompt = build_condition_prompt(manifest, "memorix-1.2.1-selective-local")
    allowed_tools = build_claude_allowed_tools(
        manifest,
        "memorix-1.2.1-selective-local",
    )

    assert "Memorix is optional for this task" in prompt
    assert "Do not call it merely because it is available" in prompt
    assert "mcp__memorix__memorix_project_context" in allowed_tools


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
    assert (tmp_path / "first" / "case-definition" / "seed" / "project.txt").is_file()
    assert not (tmp_path / "first" / "case-definition" / "hidden-tests.patch").exists()


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
        "agent_start_tree_id": "a" * 40,
        "agent_start_worktree_status_sha256": "b" * 64,
        "task_prompt_sha256": "c" * 64,
        "ordinary_tool_policy_sha256": "d" * 64,
        "full_tool_policy_sha256": "e" * 64,
    }
    value.update(overrides)
    return SimpleNamespace(**value)


def test_outcome_validator_rejects_fake_pending_zeroes() -> None:
    outcome = _pending_outcome(stale_memory_errors=0)

    with pytest.raises(ValueError, match="pending annotation outcomes"):
        validate_trial_outcome(outcome)  # type: ignore[arg-type]


def test_outcome_validator_accepts_a_pending_unmeasured_run() -> None:
    validate_trial_outcome(_pending_outcome())  # type: ignore[arg-type]


def test_outcome_validator_requires_agent_start_and_control_hashes() -> None:
    outcome = _pending_outcome(agent_start_tree_id="not-a-git-tree")

    with pytest.raises(ValueError, match="agent-start tree id"):
        validate_trial_outcome(outcome)  # type: ignore[arg-type]


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
        condition="memorix-1.2.1-native-autopilot-local",
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
        environment = kwargs["environment"]
        assert isinstance(environment, dict)
        assert Path(str(environment["HOME"])).is_relative_to(tmp_path)
        assert environment["HOME"] == environment["USERPROFILE"]
        assert Path(str(environment["TEMP"])).is_relative_to(tmp_path)
        assert environment["TEMP"] == environment["TMP"]
        assert environment["ANTHROPIC_DEFAULT_HAIKU_MODEL"] == "test-model"
        assert environment["ANTHROPIC_DEFAULT_SONNET_MODEL"] == "test-model"
        assert environment["ANTHROPIC_DEFAULT_OPUS_MODEL"] == "test-model"
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
        uniform_role_model="test-model",
    )

    assert outcome.memory_provider == "memorix"
    assert outcome.retrieval_call_count == 1
    assert outcome.retrieval_round_count == 1
    assert outcome.retrieved_context_tokens == retrieval.token_count
    assert outcome.native_mcp_receipt_status == "not-applicable-v1"
    assert outcome.native_mcp_policy_sha256 is None
    assert len(outcome.agent_start_tree_id) == 40
    assert len(outcome.agent_start_worktree_status_sha256) == 64
    assert len(outcome.task_prompt_sha256) == 64
    assert len(outcome.ordinary_tool_policy_sha256) == 64
    assert len(outcome.full_tool_policy_sha256) == 64


def test_uniform_role_model_rejects_non_claude_trials() -> None:
    with pytest.raises(ValueError, match="only for Claude trials"):
        run_trial(
            case_path=CASE,
            artifact_root=CASE.parent / "unused-artifacts",
            study_id="unit",
            condition="no-memory",
            agent="openrouter",
            model="test-model",
            repetition=0,
            seed=1,
            uniform_role_model="test-model",
        )


def test_native_session_trial_uses_hook_capture_not_trace_replay(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import memorixbench.trial as module

    cli = tmp_path / "memorix-cli.js"
    cli.write_text("placeholder", encoding="utf-8")
    base_manifest = load_case_manifest(CASE)
    native_manifest = replace(
        base_manifest,
        formation_track="native-session",
        precursor_trace=None,
        precursor_trace_bundle=None,
        precursor=replace(base_manifest.precursor, transcript=None),
        native_hook_capture=SimpleNamespace(
            path="native-hook-capture.json",
            schema_version="native-hook-capture-v1",
        ),
        memory_seeds=(),
    )
    capture = SimpleNamespace(
        capture_id="capture-a",
        canonical_sha256="a" * 64,
        source_sha256="b" * 64,
        capture_mode="local-diagnostic-v1",
        agent="claude",
        client_version="claude-code-test",
    )
    ingest_calls: list[dict[str, object]] = []

    def fake_ingest(**kwargs: object) -> dict[str, object]:
        ingest_calls.append(kwargs)
        return {
            "maintenance": {
                "poll_count": 0,
                "settled_for_retrieval": True,
                "mode": "deferred-after-synchronous-hook-v1",
            },
            "formation_receipt": {
                "surface": "native-session",
                "capture_sha256": "a" * 64,
                "write_operation_count": 1,
                "transport_call_count": 3,
                "maintenance_call_count": 0,
                "record_count": 1,
            }
        }

    def fake_run_agent(**kwargs: object) -> AgentExecution:
        artifact_dir = kwargs["artifact_dir"]
        assert isinstance(artifact_dir, Path)
        artifact_dir.mkdir(parents=True, exist_ok=True)
        patch_path = artifact_dir / "candidate.patch"
        patch_path.write_text("", encoding="utf-8")
        assert kwargs["mcp_config"] is not None
        assert "<prior_session>" not in str(kwargs["prompt"])
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
            action_ledger_sha256="c" * 64,
            action_count=0,
            action_timing_source="stream-monotonic-v1",
            stderr_path=artifact_dir / "stderr.log",
            patch_path=patch_path,
        )

    monkeypatch.setattr(module, "load_case_manifest", lambda _path: native_manifest)
    monkeypatch.setattr(module, "load_native_hook_capture", lambda *_args, **_kwargs: capture)
    monkeypatch.setattr(module, "ingest_memorix_native_hook_capture", fake_ingest)
    monkeypatch.setattr(module, "load_claude_provider_env", lambda _path: {})
    monkeypatch.setattr(module, "archive_public_case_definition", lambda *_args, **_kwargs: "d" * 64)
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
        study_id="unit-native",
        condition="memorix-1.2.1-native-autopilot-local",
        agent="claude",
        model="test-model",
        repetition=0,
        seed=1,
        memorix_cli=cli,
        workspace_root=tmp_path / "workspaces",
        claude_provider_settings=tmp_path / "provider.json",
    )

    assert len(ingest_calls) == 1
    assert outcome.formation_track == "native-session"
    assert outcome.precursor_trace_sha256 is None
    assert outcome.native_hook_capture_sha256 == "a" * 64
    assert outcome.native_hook_capture_source_sha256 == "b" * 64
    assert outcome.formation_receipt is not None
    assert outcome.formation_receipt["surface"] == "native-session"
