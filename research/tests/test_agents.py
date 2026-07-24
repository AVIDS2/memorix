import json
import os
from pathlib import Path
import subprocess
import sys

import pytest

from memorixbench.agents import (
    _capture_streaming_process,
    _failure_reason,
    _openrouter_completion,
    _openrouter_execution_environment,
    _openrouter_workspace_path,
    _parse_claude,
    _parse_pi,
    _run_openrouter_agent,
    audit_bash_commands,
    build_claude_command,
    build_codex_command,
    build_pi_command,
    load_claude_provider_env,
    run_agent,
    write_claude_settings,
)


def test_codex_command_is_ephemeral_and_ignores_user_config() -> None:
    command = build_codex_command(
        Path("C:/fixture"),
        model="model-a",
        config_overrides=['mcp_servers.memorix.command="memorix"'],
    )
    assert command[:2] == ["codex", "exec"]
    assert "--json" in command
    assert "--ephemeral" in command
    assert "--ignore-user-config" in command
    assert "--ignore-rules" in command
    assert command[-1] == "-"


def test_claude_no_memory_command_uses_bare_controlled_mode() -> None:
    command = build_claude_command(model="claude-fable-5", max_budget_usd=0.5)
    assert command[0] == "claude"
    assert "--bare" in command
    assert "--setting-sources" in command
    assert "--disable-slash-commands" in command
    assert "--no-session-persistence" in command
    assert "--max-budget-usd" in command


def test_controlled_claude_command_can_enable_hooks_without_loading_user_settings() -> None:
    command = build_claude_command(
        model="claude-fable-5",
        controlled=True,
        bare=False,
    )

    assert "--bare" not in command
    assert command[command.index("--setting-sources") + 1] == ""
    assert "--disable-slash-commands" in command


def test_controlled_claude_command_can_use_an_isolated_user_settings_source() -> None:
    command = build_claude_command(
        controlled=True,
        bare=False,
        setting_sources="user",
    )

    assert command[command.index("--setting-sources") + 1] == "user"


def test_controlled_claude_command_can_use_accept_edits_for_a_disposable_workspace() -> None:
    command = build_claude_command(permission_mode="acceptEdits")

    assert command[command.index("--permission-mode") + 1] == "acceptEdits"


def test_claude_mcp_command_uses_only_explicit_config() -> None:
    command = build_claude_command(
        mcp_config=Path("C:/fixture/mcp.json"),
        allowed_tools=("mcp__memorix__memorix_project_context",),
    )
    assert "--safe-mode" not in command
    assert "--strict-mcp-config" in command
    assert "--mcp-config" in command
    assert "--allowedTools" in command


def test_pi_command_uses_json_mode_and_ignores_discovered_user_resources() -> None:
    command = build_pi_command(
        model="openrouter/qwen/qwen3-coder-30b-a3b-instruct",
        allowed_tools=("read", "grep", "bash"),
        thinking="minimal",
    )

    assert command[:3] == ["pi", "--mode", "json"]
    assert "--no-session" in command
    assert "--no-extensions" in command
    assert "--no-context-files" in command
    assert "--no-approve" in command
    assert command[command.index("--model") + 1] == "openrouter/qwen/qwen3-coder-30b-a3b-instruct"
    assert command[command.index("--tools") + 1] == "read,grep,bash"
    assert command[command.index("--thinking") + 1] == "minimal"


def test_loads_only_claude_provider_environment(tmp_path: Path) -> None:
    path = tmp_path / "settings.json"
    path.write_text(json.dumps({
        "env": {
            "ANTHROPIC_BASE_URL": "https://provider.invalid",
            "ANTHROPIC_AUTH_TOKEN": "secret",
            "OPENROUTER_API_KEY": "must-not-propagate",
        }
    }), encoding="utf-8")

    loaded = load_claude_provider_env(path)

    assert loaded == {
        "ANTHROPIC_BASE_URL": "https://provider.invalid",
        "ANTHROPIC_AUTH_TOKEN": "secret",
    }


def test_writes_claude_isolation_settings(tmp_path: Path) -> None:
    path = write_claude_settings(
        tmp_path / "settings.json",
        denied_roots=(Path("F:/artifacts"),),
        allowed_tools=("Read", "Bash(npm test)", "Bash(go test ./...)"),
    )
    payload = json.loads(path.read_text(encoding="utf-8"))
    assert payload["autoMemoryEnabled"] is False
    assert "Read(//f/artifacts/**)" in payload["permissions"]["deny"]
    assert "Bash(* F:/artifacts*)" in payload["permissions"]["deny"]
    assert "Bash(* /f/artifacts*)" in payload["permissions"]["deny"]
    assert "Bash(npm test)" in payload["permissions"]["allow"]
    assert "Bash" not in payload["permissions"]["deny"]
    assert "Bash(*..*)" not in payload["permissions"]["deny"]
    assert "Bash(* ../*)" in payload["permissions"]["deny"]
    assert "Bash(go test ./...)" in payload["permissions"]["allow"]


def test_claude_completed_patch_at_budget_boundary_is_valid() -> None:
    events = [
        {
            "type": "assistant",
            "message": {
                "model": "reported-model",
                "content": [
                    {
                        "type": "tool_use",
                        "id": "memory-call",
                        "name": "mcp__memorix__memorix_project_context",
                    },
                    {"type": "text", "text": "Tests pass."},
                ],
            },
        },
        {
            "type": "user",
            "message": {
                "content": [
                    {
                        "type": "tool_result",
                        "tool_use_id": "memory-call",
                        "content": "context",
                    }
                ]
            },
        },
        {
            "type": "result",
            "subtype": "error_max_budget_usd",
            "is_error": True,
            "stop_reason": "end_turn",
            "result": "Tests pass.",
            "modelUsage": {
                "helper-model": {
                    "inputTokens": 4,
                    "outputTokens": 1,
                    "cacheReadInputTokens": 2,
                    "costUSD": 0.001,
                },
                "reported-model": {
                    "inputTokens": 12,
                    "outputTokens": 5,
                    "cacheReadInputTokens": 6,
                    "costUSD": 0.02,
                },
            },
        },
    ]
    parsed = _parse_claude(events)
    assert parsed["completed"] is True
    assert parsed["reported_models"] == ("helper-model", "reported-model")
    assert [
        (usage.model, usage.input_tokens, usage.output_tokens, usage.cost_usd)
        for usage in parsed["model_usage"]
    ] == [
        ("helper-model", 4, 1, 0.001),
        ("reported-model", 12, 5, 0.02),
    ]
    assert parsed["tool_names"] == ("mcp__memorix__memorix_project_context",)
    assert parsed["tool_call_names"] == ("mcp__memorix__memorix_project_context",)
    assert parsed["successful_tool_call_names"] == ("mcp__memorix__memorix_project_context",)
    assert parsed["successful_tool_call_count"] == 1
    assert _failure_reason(
        completed=True,
        timed_out=False,
        returncode=1,
        stdout='{"subtype":"error_max_budget_usd","errors":["Reached maximum budget"]}',
        stderr="",
    ) == "budget-exhausted"


def test_claude_parser_records_unavailable_tool_attempts() -> None:
    events = [
        {
            "type": "assistant",
            "message": {
                "content": [
                    {
                        "type": "tool_use",
                        "id": "grep-call",
                        "name": "Grep",
                    }
                ]
            },
        },
        {
            "type": "user",
            "message": {
                "content": [
                    {
                        "type": "tool_result",
                        "tool_use_id": "grep-call",
                        "is_error": True,
                        "content": "Error: No such tool available: Grep.",
                    }
                ]
            },
        },
    ]

    parsed = _parse_claude(events)

    assert parsed["unavailable_tool_attempts"] == ("Grep",)


def test_claude_parser_preserves_repeated_tool_calls_for_accounting() -> None:
    events = [
        {
            "type": "assistant",
            "message": {
                "content": [
                    {"type": "tool_use", "id": "first", "name": "mcp__memorix__memorix_search"},
                    {"type": "tool_use", "id": "second", "name": "mcp__memorix__memorix_search"},
                ]
            },
        },
        {
            "type": "user",
            "message": {
                "content": [
                    {"type": "tool_result", "tool_use_id": "first", "content": "one"},
                    {"type": "tool_result", "tool_use_id": "second", "content": "two"},
                ]
            },
        },
    ]

    parsed = _parse_claude(events)

    assert parsed["tool_names"] == ("mcp__memorix__memorix_search",)
    assert parsed["tool_call_names"] == (
        "mcp__memorix__memorix_search",
        "mcp__memorix__memorix_search",
    )
    assert parsed["successful_tool_call_names"] == (
        "mcp__memorix__memorix_search",
        "mcp__memorix__memorix_search",
    )


def test_pi_parser_aggregates_turn_usage_and_tool_results() -> None:
    events = [
        {"type": "session", "version": 3},
        {
            "type": "tool_execution_start",
            "toolCallId": "bash-1",
            "toolName": "bash",
            "args": {"command": "go test ./..."},
        },
        {
            "type": "tool_execution_end",
            "toolCallId": "bash-1",
            "toolName": "bash",
            "result": {"content": [{"type": "text", "text": "ok"}]},
            "isError": False,
        },
        {
            "type": "turn_end",
            "message": {
                "role": "assistant",
                "provider": "openrouter",
                "model": "qwen/qwen3-coder-30b-a3b-instruct",
                "usage": {"input": 12, "output": 4, "cacheRead": 3, "cost": 0.01},
                "content": [{"type": "text", "text": "First pass."}],
            },
        },
        {
            "type": "turn_end",
            "message": {
                "role": "assistant",
                "provider": "openrouter",
                "model": "qwen/qwen3-coder-30b-a3b-instruct",
                "usage": {"input": 8, "output": 2, "cacheRead": 1, "cost": 0.02},
                "content": [{"type": "text", "text": "Tests pass."}],
            },
        },
        {"type": "agent_end", "messages": []},
    ]

    parsed = _parse_pi(events)

    assert parsed["completed"] is True
    assert parsed["reported_models"] == ("openrouter/qwen/qwen3-coder-30b-a3b-instruct",)
    assert parsed["input_tokens"] == 20
    assert parsed["cached_input_tokens"] == 4
    assert parsed["output_tokens"] == 6
    assert parsed["cost_usd"] == 0.03
    assert parsed["final_message"] == "Tests pass."
    assert parsed["bash_commands"] == ("go test ./...",)
    assert parsed["tool_call_names"] == ("bash",)
    assert parsed["successful_tool_call_names"] == ("bash",)


def test_controlled_pi_run_uses_an_isolated_home_and_only_its_provider_secret(
    tmp_path: Path,
    monkeypatch,
) -> None:
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    subprocess.run(["git", "init", "--quiet"], cwd=workspace, check=True)
    observed: dict[str, object] = {}
    monkeypatch.setenv("OPENROUTER_API_KEY", "pi-fixture-key")
    monkeypatch.setenv("UNRELATED_API_KEY", "must-not-reach-pi")
    monkeypatch.setattr("memorixbench.agents._platform_command", lambda command: command)

    def fake_capture(command, *, cwd, prompt, environment, timeout_seconds):
        observed["command"] = command
        observed["cwd"] = cwd
        observed["prompt"] = prompt
        observed["environment"] = environment
        events = [
            {
                "type": "turn_end",
                "message": {
                    "role": "assistant",
                    "model": "openrouter/test-model",
                    "usage": {"input": 1, "output": 1, "cacheRead": 0, "cost": 0.0},
                    "content": [{"type": "text", "text": "done"}],
                },
            },
            {"type": "agent_end", "messages": []},
        ]
        return "".join(json.dumps(event) + "\n" for event in events), "", 0, False, ()

    monkeypatch.setattr("memorixbench.agents._capture_streaming_process", fake_capture)
    execution = run_agent(
        agent="pi",
        workspace=workspace,
        prompt="Reply with done.",
        artifact_dir=tmp_path / "artifacts",
        model="openrouter/test-model",
        allowed_tools=("read",),
        timeout_seconds=10,
    )

    environment = observed["environment"]
    assert isinstance(environment, dict)
    assert observed["prompt"] == "Reply with done."
    assert "Reply with done." not in observed["command"]
    assert environment["OPENROUTER_API_KEY"] == "pi-fixture-key"
    assert "UNRELATED_API_KEY" not in environment
    assert environment["PI_CODING_AGENT_DIR"] == str(tmp_path / "artifacts" / "pi-agent-home" / "agent")
    assert environment["PI_OFFLINE"] == "1"
    assert execution.completed is True


def test_controlled_pi_run_rejects_an_unenforceable_cost_budget(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="no hard max-budget"):
        run_agent(
            agent="pi",
            workspace=tmp_path,
            prompt="Reply with done.",
            artifact_dir=tmp_path / "artifacts",
            model="openrouter/test-model",
            max_budget_usd=0.01,
        )


def test_stream_capture_records_observed_order_and_elapsed_time(tmp_path: Path) -> None:
    stdout, stderr, returncode, timed_out, records = _capture_streaming_process(
        [
            sys.executable,
            "-u",
            "-c",
            "import sys; print('first', flush=True); print('second', file=sys.stderr, flush=True)",
        ],
        cwd=tmp_path,
        prompt="",
        environment=os.environ.copy(),
        timeout_seconds=10,
    )

    assert returncode == 0
    assert not timed_out
    assert stdout == "first\n"
    assert stderr == "second\n"
    assert [record.sequence for record in records] == list(range(len(records)))
    assert {record.stream for record in records} == {"stdout", "stderr"}
    assert all(record.elapsed_seconds >= 0 for record in records)


def test_command_audit_allows_workspace_scoped_browsing(tmp_path: Path) -> None:
    workspace = tmp_path / "workspace"
    workspace.mkdir()

    violations = audit_bash_commands(
        (
            f'cd "{workspace}" && grep -rn "retry" --include="*_test.go"',
            f'dir "{workspace}" /b',
            "go test ./...",
        ),
        workspace=workspace,
    )

    assert violations == ()


def test_command_audit_flags_escape_and_network_commands(tmp_path: Path) -> None:
    workspace = tmp_path / "workspace"
    workspace.mkdir()

    violations = audit_bash_commands(
        ("grep -r secret ../outside", "curl https://example.invalid", "type F:\\outside.txt"),
        workspace=workspace,
    )

    assert any(item.startswith("parent-traversal:") for item in violations)
    assert any(item.startswith("network-command:") for item in violations)
    assert any(item.startswith("external-path:") for item in violations)


def test_openrouter_agent_uses_bounded_tools_and_records_one_model(
    tmp_path: Path,
    monkeypatch,
) -> None:
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    subprocess.run(["git", "init", "--quiet"], cwd=workspace, check=True)
    subprocess.run(["git", "config", "user.name", "MemorixBench Test"], cwd=workspace, check=True)
    subprocess.run(["git", "config", "user.email", "test@example.invalid"], cwd=workspace, check=True)
    (workspace / "README.md").write_text("fixture\n", encoding="utf-8")
    subprocess.run(["git", "add", "README.md"], cwd=workspace, check=True)
    subprocess.run(["git", "commit", "--quiet", "-m", "fixture"], cwd=workspace, check=True)
    responses = iter((
        {
            "model": "qwen/qwen3-coder-30b-a3b-instruct",
            "usage": {"prompt_tokens": 12, "completion_tokens": 5},
            "choices": [{
                "finish_reason": "tool_calls",
                "message": {
                    "content": "",
                    "tool_calls": [{
                        "id": "write-answer",
                        "function": {
                            "name": "write_file",
                            "arguments": json.dumps({
                                "path": "src/answer.py",
                                "content": "answer = 42\n",
                            }),
                        },
                    }],
                },
            }],
        },
        {
            "model": "qwen/qwen3-coder-30b-a3b-instruct",
            "usage": {"prompt_tokens": 18, "completion_tokens": 3},
            "choices": [{
                "finish_reason": "stop",
                "message": {"content": "Done."},
            }],
        },
    ))

    monkeypatch.setattr(
        "memorixbench.agents._openrouter_completion",
        lambda **_kwargs: next(responses),
    )

    execution = _run_openrouter_agent(
        workspace=workspace,
        prompt="Create src/answer.py.",
        artifact_dir=tmp_path / "artifacts",
        model="qwen/qwen3-coder-30b-a3b-instruct",
        timeout_seconds=30,
        max_budget_usd=None,
        verification_commands=("python -m py_compile src/answer.py",),
        writable_paths=("src",),
    )

    assert execution.completed
    assert execution.returncode == 0
    assert execution.reported_models == ("qwen/qwen3-coder-30b-a3b-instruct",)
    assert execution.input_tokens == 30
    assert execution.output_tokens == 8
    assert execution.tool_call_names == ("write_file",)
    assert execution.successful_tool_call_names == ("write_file",)
    assert (workspace / "src" / "answer.py").read_text(encoding="utf-8") == "answer = 42\n"
    assert execution.action_count == 1
    assert "OPENROUTER_API_KEY" not in execution.events_path.read_text(encoding="utf-8")


def test_openrouter_tool_paths_cannot_escape_workspace(tmp_path: Path) -> None:
    workspace = tmp_path / "workspace"
    workspace.mkdir()

    try:
        _openrouter_workspace_path(workspace, "../outside")
    except ValueError as error:
        assert "workspace" in str(error)
    else:
        raise AssertionError("parent traversal must be rejected")


def test_openrouter_tools_get_an_isolated_windows_compatible_runtime(tmp_path: Path) -> None:
    workspace = tmp_path / "run" / "workspace"
    workspace.mkdir(parents=True)

    environment = _openrouter_execution_environment(workspace)

    runtime_root = workspace.parent / "agent-runtime"
    assert environment["USERPROFILE"] == str(runtime_root / "home")
    assert environment["LOCALAPPDATA"] == str(runtime_root / "home" / "localappdata")
    assert environment["GOCACHE"] == str(runtime_root / "cache" / "go-build")
    assert environment["TEMP"] == str(runtime_root / "tmp")
    assert environment["GOENV"] == "off"
    assert Path(environment["GOCACHE"]).is_dir()
    assert Path(environment["TEMP"]).is_dir()


def test_openrouter_completion_retries_only_a_transient_transport_failure(monkeypatch) -> None:
    class Response:
        def __enter__(self):
            return self

        def __exit__(self, _exc_type, _exc_value, _traceback) -> None:
            return None

        def read(self) -> bytes:
            return json.dumps({"choices": [{"message": {"content": "ok"}}]}).encode("utf-8")

    attempts = iter((
        __import__("urllib.error", fromlist=["URLError"]).URLError("temporary"),
        Response(),
    ))

    def fake_urlopen(*_args, **_kwargs):
        next_item = next(attempts)
        if isinstance(next_item, Exception):
            raise next_item
        return next_item

    monkeypatch.setenv("OPENROUTER_API_KEY", "test-key")
    monkeypatch.setattr("memorixbench.agents.urlrequest.urlopen", fake_urlopen)
    monkeypatch.setattr("memorixbench.agents.time.sleep", lambda _seconds: None)

    payload = _openrouter_completion(
        model="qwen/qwen3-coder-30b-a3b-instruct",
        messages=[{"role": "user", "content": "test"}],
        timeout_seconds=10,
    )

    assert payload["_memorixbench_transport"] == {
        "attempts": 2,
        "transient_failures": ["unreachable"],
    }
    assert _failure_reason(
        completed=False,
        timed_out=False,
        returncode=1,
        stdout="",
        stderr="OpenRouter transient transport failure after 3 attempt(s): unreachable",
    ) == "provider-transient"


def test_openrouter_agent_stops_at_declared_cost_budget(
    tmp_path: Path,
    monkeypatch,
) -> None:
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    subprocess.run(["git", "init", "--quiet"], cwd=workspace, check=True)
    subprocess.run(["git", "config", "user.name", "MemorixBench Test"], cwd=workspace, check=True)
    subprocess.run(["git", "config", "user.email", "test@example.invalid"], cwd=workspace, check=True)
    (workspace / "README.md").write_text("fixture\n", encoding="utf-8")
    subprocess.run(["git", "add", "README.md"], cwd=workspace, check=True)
    subprocess.run(["git", "commit", "--quiet", "-m", "fixture"], cwd=workspace, check=True)
    monkeypatch.setattr(
        "memorixbench.agents._openrouter_completion",
        lambda **_kwargs: {
            "model": "qwen/qwen3-coder-30b-a3b-instruct",
            "usage": {"prompt_tokens": 10, "completion_tokens": 1, "cost": 0.02},
            "choices": [{"finish_reason": "stop", "message": {"content": "Done."}}],
        },
    )

    execution = _run_openrouter_agent(
        workspace=workspace,
        prompt="Do nothing.",
        artifact_dir=tmp_path / "artifacts",
        model="qwen/qwen3-coder-30b-a3b-instruct",
        timeout_seconds=30,
        max_budget_usd=0.01,
        verification_commands=("git status --short",),
        writable_paths=("src",),
    )

    assert not execution.completed
    assert execution.failure_reason == "budget-exhausted"
    assert execution.cost_usd == 0.02
