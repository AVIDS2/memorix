from __future__ import annotations

from dataclasses import dataclass
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import time
from typing import Iterable, Literal

AgentName = Literal["codex", "claude"]

CLAUDE_PROVIDER_ENV_PREFIXES = ("ANTHROPIC_",)
SENSITIVE_ENV_PATTERN = re.compile(r"(?:API[_-]?KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)", re.IGNORECASE)
PARENT_TRAVERSAL_PATTERN = re.compile(r"(?<!\.)\.\.(?:[\\/]|(?=\s|$))")
WINDOWS_PATH_PATTERN = re.compile(r"(?i)\b[a-z]:[\\/][^\s\"'`;&|<>]*")
POSIX_DRIVE_PATH_PATTERN = re.compile(r"(?i)(?<![a-z0-9_])/[a-z](?:/[^\s\"'`;&|<>]*)?")
NETWORK_COMMAND_PATTERN = re.compile(
    r"(?i)(?:^|&&|\|\||;|\|)\s*(?:curl|wget|iwr|invoke-webrequest|ssh|scp|git\s+(?:clone|fetch|pull|push)|npm\s+install|pip\s+install)\b"
)
DYNAMIC_INTERPRETER_PATTERN = re.compile(
    r"(?i)(?:^|&&|\|\||;|\|)\s*(?:node|python|powershell|pwsh|cmd)\s+(?:-e|-c|--input-type|/c)\b"
)


def load_claude_provider_env(settings_path: str | Path) -> dict[str, str]:
    path = Path(settings_path).resolve()
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict) or not isinstance(value.get("env"), dict):
        raise ValueError(f"Claude provider settings have no env object: {path}")
    provider_env = {
        str(key): str(raw)
        for key, raw in value["env"].items()
        if any(str(key).startswith(prefix) for prefix in CLAUDE_PROVIDER_ENV_PREFIXES)
        and str(raw).strip()
    }
    if "ANTHROPIC_BASE_URL" not in provider_env:
        raise ValueError("Claude provider settings must define ANTHROPIC_BASE_URL")
    if not ({"ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"} & provider_env.keys()):
        raise ValueError("Claude provider settings must define an Anthropic API credential")
    return provider_env


def _permission_path(path: Path) -> str:
    normalized = path.resolve().as_posix().rstrip("/")
    if os.name == "nt" and len(normalized) >= 2 and normalized[1] == ":":
        remainder = normalized[2:].lstrip("/")
        normalized = "/" + normalized[0].lower()
        if remainder:
            normalized += "/" + remainder
    return "//" + normalized.lstrip("/") + "/**"


def write_claude_settings(
    path: str | Path,
    *,
    denied_roots: Iterable[str | Path],
    allowed_tools: Iterable[str],
) -> Path:
    target = Path(path).resolve()
    deny: list[str] = []
    for root in denied_roots:
        pattern = _permission_path(Path(root))
        deny.extend([f"Read({pattern})", f"Edit({pattern})"])
    deny.extend([
        # Do not block Go's ./... package pattern while denying parent traversal.
        "Bash(../*)",
        "Bash(..\\*)",
        "Bash(* ../*)",
        "Bash(* ..\\*)",
        "Bash(* /../*)",
        "Bash(* \\..\\*)",
        "Bash(* ..)",
        "Bash(* .. *)",
        "Bash(curl *)",
        "Bash(wget *)",
        "Bash(iwr *)",
        "Bash(Invoke-WebRequest *)",
        "Bash(ssh *)",
        "Bash(scp *)",
        "Bash(git clone *)",
        "Bash(git fetch *)",
        "Bash(git pull *)",
        "Bash(git push *)",
        "Bash(npm install *)",
        "Bash(pip install *)",
        "Bash(node -e *)",
        "Bash(node --input-type*)",
        "Bash(pwsh *)",
        "Bash(powershell *)",
        "Bash(cmd /c *)",
    ])
    payload = {
        "autoMemoryEnabled": False,
        "permissions": {
            "deny": sorted(set(deny)),
            "allow": sorted(set(allowed_tools)),
        },
    }
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    return target


def _platform_command(command: list[str]) -> list[str]:
    if os.name != "nt":
        return command
    name = command[0]
    if name == "claude":
        executable = shutil.which("claude.exe")
        if executable:
            return [executable, *command[1:]]
    wrapper = shutil.which(name + ".cmd")
    if wrapper:
        command_line = subprocess.list2cmdline([wrapper, *command[1:]])
        return [os.environ.get("COMSPEC", "cmd.exe"), "/d", "/s", "/c", command_line]
    executable = shutil.which(name + ".exe")
    if executable:
        return [executable, *command[1:]]
    raise FileNotFoundError(f"cannot resolve Windows command: {name}")


@dataclass(frozen=True)
class ModelUsage:
    model: str
    input_tokens: int | None
    cached_input_tokens: int | None
    output_tokens: int | None
    cost_usd: float | None


@dataclass(frozen=True)
class AgentExecution:
    agent: AgentName
    model: str | None
    reported_models: tuple[str, ...]
    model_usage: tuple[ModelUsage, ...]
    returncode: int
    timed_out: bool
    completed: bool
    failure_reason: str | None
    wall_seconds: float
    input_tokens: int | None
    cached_input_tokens: int | None
    output_tokens: int | None
    reasoning_output_tokens: int | None
    cost_usd: float | None
    event_count: int
    command_count: int
    tool_call_count: int
    tool_names: tuple[str, ...]
    tool_call_names: tuple[str, ...]
    successful_tool_call_count: int
    successful_tool_names: tuple[str, ...]
    successful_tool_call_names: tuple[str, ...]
    permission_denials: tuple[str, ...]
    unavailable_tool_attempts: tuple[str, ...]
    bash_commands: tuple[str, ...]
    final_message: str
    events_path: Path
    stderr_path: Path
    patch_path: Path


def build_codex_command(
    workspace: Path,
    *,
    model: str | None = None,
    config_overrides: Iterable[str] = (),
) -> list[str]:
    command = [
        "codex",
        "exec",
        "--json",
        "--ephemeral",
        "--ignore-user-config",
        "--ignore-rules",
        "--sandbox",
        "workspace-write",
        "--cd",
        str(workspace),
    ]
    if model:
        command.extend(["--model", model])
    for override in config_overrides:
        command.extend(["--config", override])
    command.append("-")
    return command


def build_claude_command(
    *,
    model: str | None = None,
    mcp_config: Path | None = None,
    max_budget_usd: float | None = None,
    allowed_tools: Iterable[str] = (),
    settings_path: Path | None = None,
    controlled: bool = True,
) -> list[str]:
    command = [
        "claude",
        "--print",
        "--output-format",
        "stream-json",
        "--verbose",
        "--no-session-persistence",
        "--permission-mode",
        "manual",
    ]
    if controlled:
        command.extend([
            "--bare",
            "--setting-sources",
            "",
            "--disable-slash-commands",
            "--tools",
            "Bash,Edit,Read",
        ])
    if mcp_config is not None:
        command.extend(["--strict-mcp-config", "--mcp-config", str(mcp_config)])
    if settings_path is not None:
        command.extend(["--settings", str(settings_path)])
    if model:
        command.extend(["--model", model])
    if max_budget_usd is not None:
        command.extend(["--max-budget-usd", str(max_budget_usd)])
    allowed = tuple(allowed_tools)
    if allowed:
        command.extend(["--allowedTools", ",".join(allowed)])
    return command


def _json_events(stdout: str) -> list[dict[str, object]]:
    events: list[dict[str, object]] = []
    for line in stdout.splitlines():
        if not line.strip():
            continue
        try:
            event = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(event, dict):
            events.append(event)
    return events


def _int_or_none(value: object) -> int | None:
    if value is None:
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _float_or_none(value: object) -> float | None:
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _parse_model_usage(value: object) -> tuple[ModelUsage, ...]:
    if not isinstance(value, dict):
        return ()
    parsed: list[ModelUsage] = []
    for raw_model, raw_usage in value.items():
        model = str(raw_model).strip()
        if not model:
            continue
        usage = raw_usage if isinstance(raw_usage, dict) else {}
        parsed.append(ModelUsage(
            model=model,
            input_tokens=_int_or_none(usage.get("inputTokens") or usage.get("input_tokens")),
            cached_input_tokens=_int_or_none(
                usage.get("cacheReadInputTokens") or usage.get("cached_input_tokens")
            ),
            output_tokens=_int_or_none(usage.get("outputTokens") or usage.get("output_tokens")),
            cost_usd=_float_or_none(usage.get("costUSD") or usage.get("cost_usd")),
        ))
    return tuple(sorted(parsed, key=lambda item: item.model))


def _parse_codex(events: list[dict[str, object]]) -> dict[str, object]:
    usage: dict[str, object] = {}
    final_message = ""
    command_count = 0
    tool_call_count = 0
    tool_names: set[str] = set()
    tool_call_names: list[str] = []
    successful_tool_call_count = 0
    successful_tool_names: set[str] = set()
    successful_tool_call_names: list[str] = []
    completed = False
    reported_models: set[str] = set()
    for event in events:
        event_model = event.get("model")
        if isinstance(event_model, str) and event_model:
            reported_models.add(event_model)
        if event.get("type") == "turn.completed" and isinstance(event.get("usage"), dict):
            usage = event["usage"]  # type: ignore[assignment]
            completed = True
        item = event.get("item")
        if not isinstance(item, dict):
            continue
        item_type = item.get("type")
        if item_type == "command_execution" and event.get("type") == "item.completed":
            command_count += 1
        if item_type in {"mcp_tool_call", "web_search"} and event.get("type") == "item.completed":
            tool_call_count += 1
            tool_name = item.get("tool") or item.get("name")
            if isinstance(tool_name, str) and tool_name:
                tool_names.add(tool_name)
                successful_tool_names.add(tool_name)
                tool_call_names.append(tool_name)
                successful_tool_call_names.append(tool_name)
            successful_tool_call_count += 1
        if item_type == "agent_message" and event.get("type") == "item.completed":
            final_message = str(item.get("text", ""))
    return {
        "input_tokens": _int_or_none(usage.get("input_tokens")),
        "cached_input_tokens": _int_or_none(usage.get("cached_input_tokens")),
        "output_tokens": _int_or_none(usage.get("output_tokens")),
        "reasoning_output_tokens": _int_or_none(usage.get("reasoning_output_tokens")),
        "cost_usd": None,
        "final_message": final_message,
        "command_count": command_count,
        "tool_call_count": tool_call_count,
        "tool_names": tuple(sorted(tool_names)),
        "tool_call_names": tuple(tool_call_names),
        "successful_tool_call_count": successful_tool_call_count,
        "successful_tool_names": tuple(sorted(successful_tool_names)),
        "successful_tool_call_names": tuple(successful_tool_call_names),
        "permission_denials": (),
        "unavailable_tool_attempts": (),
        "bash_commands": (),
        "completed": completed,
        "reported_models": tuple(sorted(reported_models)),
        "model_usage": (),
    }


def _parse_claude(events: list[dict[str, object]]) -> dict[str, object]:
    usage: dict[str, object] = {}
    final_message = ""
    cost_usd: float | None = None
    command_count = 0
    tool_call_count = 0
    tool_names: set[str] = set()
    tool_call_names: list[str] = []
    successful_tool_call_count = 0
    successful_tool_names: set[str] = set()
    successful_tool_call_names: list[str] = []
    tool_use_names: dict[str, str] = {}
    permission_denials: set[str] = set()
    unavailable_tool_attempts: set[str] = set()
    bash_commands: list[str] = []
    completed = False
    reported_models: set[str] = set()
    model_usage_records: dict[str, ModelUsage] = {}
    for event in events:
        event_type = event.get("type")
        if event_type == "result":
            result_text = str(event.get("result", ""))
            if result_text:
                final_message = result_text
            completed = (
                not bool(event.get("is_error", False))
                or (
                    event.get("subtype") == "error_max_budget_usd"
                    and event.get("stop_reason") == "end_turn"
                    and bool(final_message)
                )
            )
            if isinstance(event.get("usage"), dict):
                usage = event["usage"]  # type: ignore[assignment]
            cost_usd = _float_or_none(event.get("total_cost_usd"))
            raw_model_usage = event.get("modelUsage")
            for record in _parse_model_usage(raw_model_usage):
                reported_models.add(record.model)
                model_usage_records[record.model] = record
            denials = event.get("permission_denials")
            if isinstance(denials, list):
                for denial in denials:
                    if isinstance(denial, dict) and isinstance(denial.get("tool_name"), str):
                        permission_denials.add(str(denial["tool_name"]))
        message = event.get("message")
        if not isinstance(message, dict):
            continue
        message_model = message.get("model")
        if isinstance(message_model, str) and message_model:
            reported_models.add(message_model)
        content = message.get("content")
        if not isinstance(content, list):
            continue
        for item in content:
            if not isinstance(item, dict):
                continue
            if item.get("type") == "text" and item.get("text"):
                final_message = str(item["text"])
                continue
            if item.get("type") == "tool_result":
                tool_use_id = item.get("tool_use_id")
                if item.get("is_error", False) and isinstance(tool_use_id, str):
                    tool_name = tool_use_names.get(tool_use_id)
                    detail = str(item.get("content", ""))
                    if tool_name and "No such tool available" in detail:
                        unavailable_tool_attempts.add(tool_name)
                elif isinstance(tool_use_id, str):
                    tool_name = tool_use_names.get(tool_use_id)
                    if tool_name:
                        successful_tool_call_count += 1
                        successful_tool_names.add(tool_name)
                        successful_tool_call_names.append(tool_name)
                continue
            if item.get("type") != "tool_use":
                continue
            tool_call_count += 1
            tool_name = item.get("name")
            if isinstance(tool_name, str) and tool_name:
                tool_names.add(tool_name)
                tool_call_names.append(tool_name)
                tool_use_id = item.get("id")
                if isinstance(tool_use_id, str):
                    tool_use_names[tool_use_id] = tool_name
            if tool_name == "Bash":
                command_count += 1
                tool_input = item.get("input")
                if isinstance(tool_input, dict):
                    raw_command = tool_input.get("command")
                    if isinstance(raw_command, str) and raw_command.strip():
                        bash_commands.append(raw_command.strip())
    return {
        "input_tokens": _int_or_none(usage.get("input_tokens")),
        "cached_input_tokens": _int_or_none(
            usage.get("cache_read_input_tokens") or usage.get("cached_input_tokens")
        ),
        "output_tokens": _int_or_none(usage.get("output_tokens")),
        "reasoning_output_tokens": None,
        "cost_usd": cost_usd,
        "final_message": final_message,
        "command_count": command_count,
        "tool_call_count": tool_call_count,
        "tool_names": tuple(sorted(tool_names)),
        "tool_call_names": tuple(tool_call_names),
        "successful_tool_call_count": successful_tool_call_count,
        "successful_tool_names": tuple(sorted(successful_tool_names)),
        "successful_tool_call_names": tuple(successful_tool_call_names),
        "permission_denials": tuple(sorted(permission_denials)),
        "unavailable_tool_attempts": tuple(sorted(unavailable_tool_attempts)),
        "bash_commands": tuple(bash_commands),
        "completed": completed,
        "reported_models": tuple(sorted(reported_models)),
        "model_usage": tuple(sorted(model_usage_records.values(), key=lambda item: item.model)),
    }


def _is_within_workspace(path: Path, workspace: Path) -> bool:
    try:
        path.resolve().relative_to(workspace.resolve())
    except ValueError:
        return False
    return True


def audit_bash_commands(
    commands: Iterable[str],
    *,
    workspace: str | Path,
) -> tuple[str, ...]:
    """Flag command strings that could contaminate a non-adversarial trial."""
    workspace_path = Path(workspace).resolve()
    violations: list[str] = []
    for command in commands:
        if PARENT_TRAVERSAL_PATTERN.search(command):
            violations.append(f"parent-traversal: {command}")
        if NETWORK_COMMAND_PATTERN.search(command):
            violations.append(f"network-command: {command}")
        if DYNAMIC_INTERPRETER_PATTERN.search(command):
            violations.append(f"dynamic-interpreter: {command}")
        raw_paths = list(WINDOWS_PATH_PATTERN.findall(command))
        for raw in POSIX_DRIVE_PATH_PATTERN.findall(command):
            if len(raw) >= 3 and raw[1] == "/":
                raw_paths.append(raw[1].upper() + ":/" + raw[3:])
        for raw_path in raw_paths:
            if not _is_within_workspace(Path(raw_path), workspace_path):
                violations.append(f"external-path: {raw_path}")
    return tuple(dict.fromkeys(violations))


def _failure_reason(
    *,
    completed: bool,
    timed_out: bool,
    returncode: int,
    stdout: str,
    stderr: str,
) -> str | None:
    combined = (stdout + "\n" + stderr).lower()
    if "maximum budget" in combined or "error_max_budget_usd" in combined:
        return "budget-exhausted"
    if completed:
        return None
    if timed_out:
        return "timeout"
    if "401 unauthorized" in combined or "authentication required" in combined:
        return "authentication"
    if "429" in combined or "usage limit" in combined or "quota" in combined:
        return "quota"
    if "mcp" in combined and "failed to initialize" in combined:
        return "mcp-startup"
    if returncode != 0:
        return "agent-runtime"
    return "missing-completion-event"


def _git_patch(workspace: Path) -> str:
    completed = subprocess.run(
        ["git", "diff", "--binary", "--no-ext-diff"],
        cwd=workspace,
        check=True,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    return completed.stdout


def run_agent(
    *,
    agent: AgentName,
    workspace: str | Path,
    prompt: str,
    artifact_dir: str | Path,
    model: str | None = None,
    timeout_seconds: int = 900,
    config_overrides: Iterable[str] = (),
    mcp_config: Path | None = None,
    max_budget_usd: float | None = None,
    environment: dict[str, str] | None = None,
    allowed_tools: Iterable[str] = (),
    settings_path: Path | None = None,
    controlled: bool = True,
) -> AgentExecution:
    workspace_path = Path(workspace).resolve()
    artifacts = Path(artifact_dir).resolve()
    artifacts.mkdir(parents=True, exist_ok=True)
    if agent == "codex":
        command = build_codex_command(
            workspace_path,
            model=model,
            config_overrides=config_overrides,
        )
    elif agent == "claude":
        command = build_claude_command(
            model=model,
            mcp_config=mcp_config,
            max_budget_usd=max_budget_usd,
            allowed_tools=allowed_tools,
            settings_path=settings_path,
            controlled=controlled,
        )
    else:
        raise ValueError(f"unsupported agent: {agent}")
    command = _platform_command(command)

    env = os.environ.copy()
    if controlled and agent == "claude":
        for key in list(env):
            if SENSITIVE_ENV_PATTERN.search(key):
                env.pop(key, None)
        env.update({
            "CLAUDE_CODE_DISABLE_AUTO_MEMORY": "1",
            "CLAUDE_CODE_SUBPROCESS_ENV_SCRUB": "1",
        })
    if environment:
        env.update(environment)
    started = time.monotonic()
    timed_out = False
    try:
        completed = subprocess.run(
            command,
            cwd=workspace_path,
            input=prompt,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=timeout_seconds,
            env=env,
        )
        stdout = completed.stdout
        stderr = completed.stderr
        returncode = completed.returncode
    except subprocess.TimeoutExpired as error:
        timed_out = True
        stdout = error.stdout if isinstance(error.stdout, str) else ""
        stderr = error.stderr if isinstance(error.stderr, str) else "timeout"
        returncode = 124
    wall_seconds = time.monotonic() - started

    events_path = artifacts / "events.jsonl"
    stderr_path = artifacts / "stderr.txt"
    patch_path = artifacts / "patch.diff"
    events_path.write_text(stdout, encoding="utf-8")
    stderr_path.write_text(stderr, encoding="utf-8")
    patch_path.write_text(_git_patch(workspace_path), encoding="utf-8")

    events = _json_events(stdout)
    parsed = _parse_codex(events) if agent == "codex" else _parse_claude(events)
    completed = bool(parsed["completed"])
    return AgentExecution(
        agent=agent,
        model=model,
        reported_models=parsed["reported_models"],  # type: ignore[arg-type]
        model_usage=parsed["model_usage"],  # type: ignore[arg-type]
        returncode=returncode,
        timed_out=timed_out,
        completed=completed,
        failure_reason=_failure_reason(
            completed=completed,
            timed_out=timed_out,
            returncode=returncode,
            stdout=stdout,
            stderr=stderr,
        ),
        wall_seconds=wall_seconds,
        input_tokens=parsed["input_tokens"],  # type: ignore[arg-type]
        cached_input_tokens=parsed["cached_input_tokens"],  # type: ignore[arg-type]
        output_tokens=parsed["output_tokens"],  # type: ignore[arg-type]
        reasoning_output_tokens=parsed["reasoning_output_tokens"],  # type: ignore[arg-type]
        cost_usd=parsed["cost_usd"],  # type: ignore[arg-type]
        event_count=len(events),
        command_count=int(parsed["command_count"]),
        tool_call_count=int(parsed["tool_call_count"]),
        tool_names=parsed["tool_names"],  # type: ignore[arg-type]
        tool_call_names=parsed["tool_call_names"],  # type: ignore[arg-type]
        successful_tool_call_count=int(parsed["successful_tool_call_count"]),
        successful_tool_names=parsed["successful_tool_names"],  # type: ignore[arg-type]
        successful_tool_call_names=parsed["successful_tool_call_names"],  # type: ignore[arg-type]
        permission_denials=parsed["permission_denials"],  # type: ignore[arg-type]
        unavailable_tool_attempts=parsed["unavailable_tool_attempts"],  # type: ignore[arg-type]
        bash_commands=parsed["bash_commands"],  # type: ignore[arg-type]
        final_message=str(parsed["final_message"]),
        events_path=events_path,
        stderr_path=stderr_path,
        patch_path=patch_path,
    )
