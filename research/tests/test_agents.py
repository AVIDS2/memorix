import json
from pathlib import Path

from memorixbench.agents import (
    _failure_reason,
    _parse_claude,
    audit_bash_commands,
    build_claude_command,
    build_codex_command,
    load_claude_provider_env,
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


def test_claude_mcp_command_uses_only_explicit_config() -> None:
    command = build_claude_command(
        mcp_config=Path("C:/fixture/mcp.json"),
        allowed_tools=("mcp__memorix__memorix_project_context",),
    )
    assert "--safe-mode" not in command
    assert "--strict-mcp-config" in command
    assert "--mcp-config" in command
    assert "--allowedTools" in command


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
