from __future__ import annotations

from dataclasses import dataclass
import json
import os
from pathlib import Path
import re
import shutil
import signal
import stat
import subprocess
import threading
import time
from typing import Iterable, Literal
from urllib import error as urlerror
from urllib import request as urlrequest

from .actions import write_action_ledger

AgentName = Literal["codex", "claude", "openrouter"]

CLAUDE_PROVIDER_ENV_PREFIXES = ("ANTHROPIC_",)
CLAUDE_ROLE_MODEL_KEYS = (
    "ANTHROPIC_DEFAULT_HAIKU_MODEL",
    "ANTHROPIC_DEFAULT_SONNET_MODEL",
    "ANTHROPIC_DEFAULT_OPUS_MODEL",
)
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
OPENROUTER_ENDPOINT = "https://openrouter.ai/api/v1/chat/completions"
OPENROUTER_MAX_TOOL_STEPS = 24
OPENROUTER_MAX_TRANSPORT_ATTEMPTS = 3
OPENROUTER_MAX_FILE_BYTES = 160_000
OPENROUTER_MAX_TOOL_RESULT_BYTES = 18_000
OPENROUTER_TEXT_SUFFIXES = {
    ".c",
    ".cc",
    ".cpp",
    ".cs",
    ".go",
    ".h",
    ".hpp",
    ".java",
    ".js",
    ".json",
    ".md",
    ".mjs",
    ".py",
    ".rs",
    ".toml",
    ".ts",
    ".tsx",
    ".txt",
    ".yaml",
    ".yml",
}


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


def apply_uniform_claude_role_model(
    provider_env: dict[str, str],
    model: str | None,
) -> str | None:
    """Pin Claude's internal role aliases for one isolated experiment process."""

    if model is None:
        return None
    normalized = model.strip()
    if not normalized:
        raise ValueError("uniform Claude role model must be non-empty when provided")
    for key in CLAUDE_ROLE_MODEL_KEYS:
        provider_env[key] = normalized
    return normalized


def _permission_path(path: Path) -> str:
    normalized = path.resolve().as_posix().rstrip("/")
    if os.name == "nt" and len(normalized) >= 2 and normalized[1] == ":":
        remainder = normalized[2:].lstrip("/")
        normalized = "/" + normalized[0].lower()
        if remainder:
            normalized += "/" + remainder
    return "//" + normalized.lstrip("/") + "/**"


def _bash_denied_path_patterns(path: Path) -> tuple[str, ...]:
    normalized = path.resolve()
    windows = str(normalized).rstrip("\\/")
    posix = normalized.as_posix().rstrip("/")
    patterns = [f"Bash(* {windows}*)", f"Bash(* {posix}*)"]
    if normalized.drive:
        suffix = posix[2:].lstrip("/")
        patterns.append(f"Bash(* /{normalized.drive[0].lower()}/{suffix}*)")
    return tuple(dict.fromkeys(patterns))


def write_claude_settings(
    path: str | Path,
    *,
    denied_roots: Iterable[str | Path],
    allowed_tools: Iterable[str],
) -> Path:
    target = Path(path).resolve()
    deny: list[str] = []
    for root in denied_roots:
        root_path = Path(root)
        pattern = _permission_path(root_path)
        deny.extend([f"Read({pattern})", f"Edit({pattern})"])
        deny.extend(_bash_denied_path_patterns(root_path))
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
class StreamRecord:
    sequence: int
    stream: Literal["stdout", "stderr"]
    elapsed_seconds: float
    line: str


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
    timeline_path: Path
    action_ledger_path: Path
    action_ledger_sha256: str
    action_count: int
    action_timing_source: str
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
    bare: bool = True,
    setting_sources: str = "",
    permission_mode: str = "manual",
) -> list[str]:
    if permission_mode not in {
        "acceptEdits",
        "auto",
        "bypassPermissions",
        "manual",
        "dontAsk",
        "plan",
    }:
        raise ValueError("Claude permission mode is unsupported")
    command = [
        "claude",
        "--print",
        "--output-format",
        "stream-json",
        "--verbose",
        "--no-session-persistence",
        "--permission-mode",
        permission_mode,
    ]
    if controlled:
        if setting_sources not in {"", "user", "project", "local"}:
            raise ValueError("controlled Claude setting source is unsupported")
        command.extend([
            "--setting-sources",
            setting_sources,
            "--disable-slash-commands",
            "--tools",
            "Bash,Edit,Read",
        ])
        if bare:
            command.append("--bare")
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
    if "maximum bounded tool steps" in combined:
        return "tool-step-limit"
    if "maximum budget" in combined or "error_max_budget_usd" in combined:
        return "budget-exhausted"
    if "openrouter transient transport failure" in combined:
        return "provider-transient"
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


def _is_reparse_point(path: Path) -> bool:
    try:
        details = os.lstat(path)
    except OSError:
        return False
    attributes = getattr(details, "st_file_attributes", 0)
    reparse_flag = getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0)
    return path.is_symlink() or bool(attributes & reparse_flag)


def _openrouter_workspace_path(
    workspace: Path,
    relative: object,
    *,
    must_exist: bool = False,
) -> Path:
    if not isinstance(relative, str):
        raise ValueError("path must be a string")
    candidate = Path(relative)
    if candidate.is_absolute() or ".." in candidate.parts or ".git" in candidate.parts:
        raise ValueError("path must remain inside the workspace")
    raw = workspace / candidate
    current = workspace
    for part in candidate.parts:
        current = current / part
        if _is_reparse_point(current):
            raise ValueError("path cannot traverse a symbolic link or reparse point")
    resolved = raw.resolve()
    if resolved != workspace and workspace not in resolved.parents:
        raise ValueError("path must remain inside the workspace")
    if must_exist and not resolved.exists():
        raise ValueError("path does not exist")
    return resolved


def _openrouter_execution_environment(workspace: Path) -> dict[str, str]:
    """Keep host credentials out of tools while supplying disposable build caches."""

    inherited = os.environ
    environment: dict[str, str] = {}
    for key in ("PATH", "PATHEXT", "SYSTEMROOT", "WINDIR", "COMSPEC"):
        value = inherited.get(key)
        if value:
            environment[key] = value

    # Tool commands run without the user's home directory so they cannot inherit
    # credentials or incidental configuration. Windows toolchains still need a
    # writable profile and cache root, so provide one beside this isolated run,
    # never inside the editable workspace or the user's real profile.
    runtime_root = workspace.parent / "agent-runtime"
    home = runtime_root / "home"
    cache = runtime_root / "cache"
    temporary = runtime_root / "tmp"
    for path in (home, cache, temporary):
        path.mkdir(parents=True, exist_ok=True)
    for key, path in {
        "HOME": home,
        "USERPROFILE": home,
        "APPDATA": home / "appdata",
        "LOCALAPPDATA": home / "localappdata",
        "TEMP": temporary,
        "TMP": temporary,
        "GOCACHE": cache / "go-build",
        "GOMODCACHE": cache / "go-mod",
        "GOPATH": cache / "go-path",
        "npm_config_cache": cache / "npm",
        "PIP_CACHE_DIR": cache / "pip",
        "PYTHONPYCACHEPREFIX": cache / "python-bytecode",
    }.items():
        path.mkdir(parents=True, exist_ok=True)
        environment[key] = str(path)
    environment["GOENV"] = "off"
    return environment


def _bounded_openrouter_output(value: object) -> str:
    text = json.dumps(value, ensure_ascii=False, sort_keys=True)
    encoded = text.encode("utf-8")
    if len(encoded) <= OPENROUTER_MAX_TOOL_RESULT_BYTES:
        return text
    truncated = encoded[:OPENROUTER_MAX_TOOL_RESULT_BYTES].decode("utf-8", errors="ignore")
    return truncated + "\n[tool output truncated]"


def _openrouter_text_file(path: Path) -> str | None:
    if not path.is_file() or _is_reparse_point(path):
        return None
    if path.suffix.lower() not in OPENROUTER_TEXT_SUFFIXES:
        return None
    if path.stat().st_size > OPENROUTER_MAX_FILE_BYTES:
        return None
    try:
        return path.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        return None


def _openrouter_path_is_writable(
    workspace: Path,
    path: Path,
    writable_paths: tuple[str, ...],
) -> bool:
    try:
        relative = path.relative_to(workspace)
    except ValueError:
        return False
    return any(
        relative == Path(root) or Path(root) in relative.parents
        for root in writable_paths
    )


def _openrouter_list_files(workspace: Path, arguments: dict[str, object]) -> str:
    root = _openrouter_workspace_path(workspace, arguments.get("path", ""), must_exist=True)
    if not root.is_dir():
        raise ValueError("path must name a directory")
    depth = arguments.get("max_depth", 3)
    if isinstance(depth, bool) or not isinstance(depth, int) or not 0 <= depth <= 5:
        raise ValueError("max_depth must be an integer from 0 through 5")
    files: list[str] = []
    for current, directories, names in os.walk(root, followlinks=False):
        current_path = Path(current)
        relative_depth = len(current_path.relative_to(root).parts)
        directories[:] = [
            name for name in directories
            if name not in {".git", "node_modules", ".venv", "__pycache__"}
            and not _is_reparse_point(current_path / name)
        ]
        if relative_depth > depth:
            directories[:] = []
            continue
        for name in sorted(names):
            path = current_path / name
            if _is_reparse_point(path):
                continue
            files.append(path.relative_to(workspace).as_posix())
            if len(files) >= 240:
                return _bounded_openrouter_output({"files": files, "truncated": True})
    return _bounded_openrouter_output({"files": files, "truncated": False})


def _openrouter_read_file(workspace: Path, arguments: dict[str, object]) -> str:
    path = _openrouter_workspace_path(workspace, arguments.get("path"), must_exist=True)
    content = _openrouter_text_file(path)
    if content is None:
        raise ValueError("file is unavailable or exceeds the safe text-file limit")
    start_line = arguments.get("start_line", 1)
    end_line = arguments.get("end_line")
    if isinstance(start_line, bool) or not isinstance(start_line, int) or start_line < 1:
        raise ValueError("start_line must be a positive integer")
    lines = content.splitlines()
    if end_line is None:
        end_line = min(len(lines), start_line + 299)
    if isinstance(end_line, bool) or not isinstance(end_line, int) or end_line < start_line:
        raise ValueError("end_line must be an integer no smaller than start_line")
    end_line = min(end_line, start_line + 299, len(lines))
    selected = "\n".join(lines[start_line - 1:end_line])
    return _bounded_openrouter_output({
        "path": path.relative_to(workspace).as_posix(),
        "start_line": start_line,
        "end_line": end_line,
        "content": selected,
    })


def _openrouter_search_text(workspace: Path, arguments: dict[str, object]) -> str:
    query = arguments.get("query")
    if not isinstance(query, str) or not query.strip() or len(query) > 160:
        raise ValueError("query must be a non-empty literal of at most 160 characters")
    root = _openrouter_workspace_path(workspace, arguments.get("path", ""), must_exist=True)
    if not root.is_dir():
        raise ValueError("path must name a directory")
    matches: list[dict[str, object]] = []
    for current, directories, names in os.walk(root, followlinks=False):
        current_path = Path(current)
        directories[:] = [
            name for name in directories
            if name not in {".git", "node_modules", ".venv", "__pycache__"}
            and not _is_reparse_point(current_path / name)
        ]
        for name in sorted(names):
            path = current_path / name
            content = _openrouter_text_file(path)
            if content is None:
                continue
            for number, line in enumerate(content.splitlines(), 1):
                if query in line:
                    matches.append({
                        "path": path.relative_to(workspace).as_posix(),
                        "line": number,
                        "text": line[:500],
                    })
                    if len(matches) >= 60:
                        return _bounded_openrouter_output({"matches": matches, "truncated": True})
    return _bounded_openrouter_output({"matches": matches, "truncated": False})


def _openrouter_write_file(
    workspace: Path,
    arguments: dict[str, object],
    writable_paths: tuple[str, ...],
) -> str:
    path = _openrouter_workspace_path(workspace, arguments.get("path"))
    content = arguments.get("content")
    if not isinstance(content, str):
        raise ValueError("content must be a string")
    if len(content.encode("utf-8")) > OPENROUTER_MAX_FILE_BYTES:
        raise ValueError("content exceeds the safe write limit")
    if not _openrouter_path_is_writable(workspace, path, writable_paths):
        raise ValueError("path is outside this case's writable source roots")
    if path.exists() and _is_reparse_point(path):
        raise ValueError("cannot write through a symbolic link or reparse point")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8", newline="\n")
    return _bounded_openrouter_output({
        "path": path.relative_to(workspace).as_posix(),
        "bytes_written": len(content.encode("utf-8")),
    })


def _openrouter_patch_paths_are_safe(
    workspace: Path,
    patch: str,
    writable_paths: tuple[str, ...],
) -> bool:
    if "GIT binary patch" in patch or "\x00" in patch:
        return False
    for line in patch.splitlines():
        if line.startswith(("diff --git ", "--- ", "+++ ")):
            if "../" in line or "..\\" in line or re.search(r"(?:^|\s)[A-Za-z]:[\\/]", line):
                return False
        if line.startswith(("--- ", "+++ ")):
            raw_path = line[4:].split("\t", 1)[0].strip()
            if raw_path == "/dev/null":
                continue
            if raw_path.startswith(("a/", "b/")):
                raw_path = raw_path[2:]
            try:
                target = _openrouter_workspace_path(workspace, raw_path)
            except ValueError:
                return False
            if not _openrouter_path_is_writable(workspace, target, writable_paths):
                return False
    return True


def _openrouter_apply_patch(
    workspace: Path,
    arguments: dict[str, object],
    writable_paths: tuple[str, ...],
) -> tuple[bool, str]:
    patch = arguments.get("patch")
    if not isinstance(patch, str) or not patch.strip():
        raise ValueError("patch must be a non-empty unified diff")
    if len(patch.encode("utf-8")) > OPENROUTER_MAX_FILE_BYTES:
        raise ValueError("patch exceeds the safe write limit")
    if not _openrouter_patch_paths_are_safe(workspace, patch, writable_paths):
        raise ValueError("patch contains an unsafe path or binary payload")
    environment = _openrouter_execution_environment(workspace)
    checked = subprocess.run(
        ["git", "apply", "--check", "--whitespace=nowarn", "-"],
        cwd=workspace,
        input=patch,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        env=environment,
        timeout=30,
    )
    if checked.returncode != 0:
        return False, _bounded_openrouter_output({
            "applied": False,
            "stderr": checked.stderr[-4000:],
        })
    applied = subprocess.run(
        ["git", "apply", "--whitespace=nowarn", "-"],
        cwd=workspace,
        input=patch,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        env=environment,
        timeout=30,
    )
    succeeded = applied.returncode == 0
    return succeeded, _bounded_openrouter_output({
        "applied": applied.returncode == 0,
        "stderr": applied.stderr[-4000:],
    })


def _openrouter_run_verification(
    workspace: Path,
    arguments: dict[str, object],
    verification_commands: tuple[str, ...],
) -> tuple[str, str | None]:
    index = arguments.get("command_index", 0)
    if isinstance(index, bool) or not isinstance(index, int):
        raise ValueError("command_index must be an integer")
    if not 0 <= index < len(verification_commands):
        raise ValueError("command_index does not name a declared verification command")
    command = verification_commands[index]
    try:
        completed = subprocess.run(
            command,
            cwd=workspace,
            shell=True,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            env=_openrouter_execution_environment(workspace),
            timeout=300,
        )
        payload = {
            "command_index": index,
            "returncode": completed.returncode,
            "stdout": completed.stdout[-8000:],
            "stderr": completed.stderr[-8000:],
        }
    except subprocess.TimeoutExpired:
        payload = {"command_index": index, "returncode": 124, "stdout": "", "stderr": "timeout"}
    return _bounded_openrouter_output(payload), command


def _openrouter_show_diff(workspace: Path) -> str:
    completed = subprocess.run(
        ["git", "diff", "--no-ext-diff"],
        cwd=workspace,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        env=_openrouter_execution_environment(workspace),
        timeout=30,
    )
    return _bounded_openrouter_output({
        "returncode": completed.returncode,
        "diff": completed.stdout[-OPENROUTER_MAX_TOOL_RESULT_BYTES:],
        "stderr": completed.stderr[-2000:],
    })


def _openrouter_tools() -> list[dict[str, object]]:
    return [
        {
            "type": "function",
            "function": {
                "name": "list_files",
                "description": "List safe workspace files under a relative directory.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "path": {"type": "string"},
                        "max_depth": {"type": "integer", "minimum": 0, "maximum": 5},
                    },
                    "required": ["path"],
                    "additionalProperties": False,
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "read_file",
                "description": "Read a bounded range from a safe text file in the workspace.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "path": {"type": "string"},
                        "start_line": {"type": "integer", "minimum": 1},
                        "end_line": {"type": "integer", "minimum": 1},
                    },
                    "required": ["path"],
                    "additionalProperties": False,
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "search_text",
                "description": "Search a literal string in safe workspace text files.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "query": {"type": "string", "minLength": 1, "maxLength": 160},
                        "path": {"type": "string"},
                    },
                    "required": ["query", "path"],
                    "additionalProperties": False,
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "write_file",
                "description": "Write a complete safe text file inside the workspace.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "path": {"type": "string"},
                        "content": {"type": "string"},
                    },
                    "required": ["path", "content"],
                    "additionalProperties": False,
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "apply_patch",
                "description": "Apply a safe unified diff inside the workspace.",
                "parameters": {
                    "type": "object",
                    "properties": {"patch": {"type": "string"}},
                    "required": ["patch"],
                    "additionalProperties": False,
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "run_verification",
                "description": "Run one trusted verification command by its declared index.",
                "parameters": {
                    "type": "object",
                    "properties": {"command_index": {"type": "integer", "minimum": 0}},
                    "required": ["command_index"],
                    "additionalProperties": False,
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "show_diff",
                "description": "Show the current Git diff for the workspace.",
                "parameters": {"type": "object", "properties": {}, "additionalProperties": False},
            },
        },
    ]


def _openrouter_completion(
    *,
    model: str,
    messages: list[dict[str, object]],
    timeout_seconds: float,
) -> dict[str, object]:
    openrouter_credential = os.environ.get("OPENROUTER_API_KEY", "").strip()
    if not openrouter_credential:
        raise RuntimeError("OpenRouter API key is unavailable")
    body = json.dumps({
        "model": model,
        "messages": messages,
        "tools": _openrouter_tools(),
        "tool_choice": "auto",
        "temperature": 0,
        "max_tokens": 2000,
    }, ensure_ascii=False).encode("utf-8")
    request = urlrequest.Request(
        OPENROUTER_ENDPOINT,
        data=body,
        headers={
            "Authorization": f"Bearer {openrouter_credential}",
            "Content-Type": "application/json",
            "HTTP-Referer": "https://github.com/AVIDS2/memorix",
            "X-OpenRouter-Title": "MemorixBench controlled agent",
        },
        method="POST",
    )
    started = time.monotonic()
    transient_failures: list[str] = []
    for attempt in range(1, OPENROUTER_MAX_TRANSPORT_ATTEMPTS + 1):
        remaining = timeout_seconds - (time.monotonic() - started)
        if remaining <= 0:
            break
        try:
            with urlrequest.urlopen(request, timeout=max(1.0, min(60.0, remaining))) as response:
                payload = json.loads(response.read().decode("utf-8"))
            break
        except urlerror.HTTPError as error:
            if error.code not in {408, 409, 429} and error.code < 500:
                raise RuntimeError(f"OpenRouter request failed with HTTP {error.code}") from error
            transient_failures.append(f"http-{error.code}")
        except urlerror.URLError:
            transient_failures.append("unreachable")
        except TimeoutError:
            transient_failures.append("timeout")

        if attempt == OPENROUTER_MAX_TRANSPORT_ATTEMPTS:
            break
        remaining = timeout_seconds - (time.monotonic() - started)
        delay = min(float(2 ** (attempt - 1)), max(0.0, remaining - 1.0))
        if delay <= 0:
            break
        time.sleep(delay)
    else:  # pragma: no cover - loop always breaks or returns
        raise AssertionError("unreachable OpenRouter transport loop")

    if "payload" not in locals():
        details = ", ".join(transient_failures) or "timeout-budget"
        raise RuntimeError(
            "OpenRouter transient transport failure after "
            f"{len(transient_failures)} attempt(s): {details}"
        )
    if not isinstance(payload, dict):
        raise RuntimeError("OpenRouter returned an invalid response")
    payload["_memorixbench_transport"] = {
        "attempts": len(transient_failures) + 1,
        "transient_failures": transient_failures,
    }
    return payload


def _openrouter_tool_call(
    *,
    workspace: Path,
    name: str,
    arguments: dict[str, object],
    verification_commands: tuple[str, ...],
    writable_paths: tuple[str, ...],
) -> tuple[bool, str, str | None]:
    try:
        if name == "list_files":
            return True, _openrouter_list_files(workspace, arguments), None
        if name == "read_file":
            return True, _openrouter_read_file(workspace, arguments), None
        if name == "search_text":
            return True, _openrouter_search_text(workspace, arguments), None
        if name == "write_file":
            return True, _openrouter_write_file(workspace, arguments, writable_paths), None
        if name == "apply_patch":
            succeeded, output = _openrouter_apply_patch(workspace, arguments, writable_paths)
            return succeeded, output, None
        if name == "run_verification":
            output, command = _openrouter_run_verification(
                workspace,
                arguments,
                verification_commands,
            )
            return True, output, command
        if name == "show_diff":
            return True, _openrouter_show_diff(workspace), None
        return False, _bounded_openrouter_output({"error": "unsupported tool"}), None
    except (OSError, ValueError, subprocess.SubprocessError) as error:
        return False, _bounded_openrouter_output({"error": str(error)}), None


def _run_openrouter_agent(
    *,
    workspace: Path,
    prompt: str,
    artifact_dir: Path,
    model: str | None,
    timeout_seconds: int,
    max_budget_usd: float | None,
    verification_commands: Iterable[str],
    writable_paths: Iterable[str],
) -> AgentExecution:
    if model is None or not model.strip():
        raise ValueError("OpenRouter runs require an explicit model id")
    if max_budget_usd is not None and max_budget_usd <= 0:
        raise ValueError("OpenRouter max_budget_usd must be positive when provided")
    commands = tuple(command for command in verification_commands if command.strip())
    if not commands:
        raise ValueError("OpenRouter runs require at least one verification command")
    writable = tuple(path for path in writable_paths if path.strip())
    if not writable:
        raise ValueError("OpenRouter runs require explicit writable source roots")
    artifact_dir.mkdir(parents=True, exist_ok=True)
    events_path = artifact_dir / "events.jsonl"
    timeline_path = artifact_dir / "event-timeline.jsonl"
    action_ledger_path = artifact_dir / "action-ledger.json"
    stderr_path = artifact_dir / "stderr.txt"
    patch_path = artifact_dir / "patch.diff"
    started = time.monotonic()
    records: list[StreamRecord] = []
    stderr = ""
    messages: list[dict[str, object]] = [
        {
            "role": "system",
            "content": (
                "You are a bounded coding agent. Work only through the supplied tools. "
                "Inspect source before editing, make the smallest correct change, and run "
                "the trusted verification command before finishing. Do not request network, "
                "shell, parent-directory, or host access."
            ),
        },
        {"role": "user", "content": prompt},
    ]
    reported_models: set[str] = set()
    usage_by_model: dict[str, dict[str, float | int | None]] = {}
    tool_names: set[str] = set()
    tool_call_names: list[str] = []
    successful_tool_names: set[str] = set()
    successful_tool_call_names: list[str] = []
    bash_commands: list[str] = []
    final_message = ""
    completed = False
    timed_out = False
    returncode = 0

    def emit(event: dict[str, object]) -> None:
        records.append(StreamRecord(
            sequence=len(records),
            stream="stdout",
            elapsed_seconds=time.monotonic() - started,
            line=json.dumps(event, ensure_ascii=False) + "\n",
        ))

    try:
        for _step in range(OPENROUTER_MAX_TOOL_STEPS):
            remaining = timeout_seconds - (time.monotonic() - started)
            if remaining <= 0:
                timed_out = True
                returncode = 124
                stderr = "timeout\n"
                break
            response = _openrouter_completion(
                model=model.strip(),
                messages=messages,
                timeout_seconds=remaining,
            )
            response_model = response.get("model")
            if isinstance(response_model, str) and response_model.strip():
                response_model = response_model.strip()
                reported_models.add(response_model)
            else:
                response_model = model.strip()
            usage = response.get("usage") if isinstance(response.get("usage"), dict) else {}
            prompt_tokens = _int_or_none(usage.get("prompt_tokens"))
            completion_tokens = _int_or_none(usage.get("completion_tokens"))
            cached_tokens = _int_or_none(usage.get("cached_tokens"))
            cost = _float_or_none(usage.get("cost"))
            aggregate = usage_by_model.setdefault(response_model, {
                "input_tokens": 0,
                "cached_input_tokens": 0,
                "output_tokens": 0,
                "cost_usd": 0.0,
                "has_input": False,
                "has_cached": False,
                "has_output": False,
                "has_cost": False,
            })
            if prompt_tokens is not None:
                aggregate["input_tokens"] = int(aggregate["input_tokens"] or 0) + prompt_tokens
                aggregate["has_input"] = True
            if cached_tokens is not None:
                aggregate["cached_input_tokens"] = int(aggregate["cached_input_tokens"] or 0) + cached_tokens
                aggregate["has_cached"] = True
            if completion_tokens is not None:
                aggregate["output_tokens"] = int(aggregate["output_tokens"] or 0) + completion_tokens
                aggregate["has_output"] = True
            if cost is not None:
                aggregate["cost_usd"] = float(aggregate["cost_usd"] or 0.0) + cost
                aggregate["has_cost"] = True
            choices = response.get("choices")
            if not isinstance(choices, list) or not choices or not isinstance(choices[0], dict):
                raise RuntimeError("OpenRouter response has no completion choice")
            message = choices[0].get("message")
            if not isinstance(message, dict):
                raise RuntimeError("OpenRouter completion has no message")
            content = message.get("content")
            final_message = content if isinstance(content, str) else final_message
            raw_tool_calls = message.get("tool_calls")
            tool_calls = raw_tool_calls if isinstance(raw_tool_calls, list) else []
            emit({
                "type": "openrouter.response",
                "model": response_model,
                "usage": usage,
                "transport": response.get("_memorixbench_transport"),
                "finish_reason": choices[0].get("finish_reason"),
                "content": content if isinstance(content, str) else "",
                "tool_call_count": len(tool_calls),
            })
            total_cost = sum(
                float(values["cost_usd"] or 0.0)
                for values in usage_by_model.values()
            )
            if max_budget_usd is not None and total_cost > max_budget_usd:
                returncode = 1
                stderr = "maximum budget reached\n"
                break
            assistant_message: dict[str, object] = {
                "role": "assistant",
                "content": content if isinstance(content, str) else "",
            }
            if tool_calls:
                assistant_message["tool_calls"] = tool_calls
            messages.append(assistant_message)
            if not tool_calls:
                completed = True
                break
            for raw_call in tool_calls:
                if not isinstance(raw_call, dict):
                    continue
                call_id = raw_call.get("id")
                function = raw_call.get("function")
                if not isinstance(call_id, str) or not isinstance(function, dict):
                    continue
                name = function.get("name")
                raw_arguments = function.get("arguments")
                if not isinstance(name, str):
                    continue
                try:
                    arguments = json.loads(raw_arguments) if isinstance(raw_arguments, str) else raw_arguments
                except json.JSONDecodeError:
                    arguments = {}
                if not isinstance(arguments, dict):
                    arguments = {}
                tool_names.add(name)
                tool_call_names.append(name)
                emit({
                    "type": "openrouter.tool_call",
                    "id": call_id,
                    "name": name,
                    "arguments": arguments,
                })
                succeeded, output, command = _openrouter_tool_call(
                    workspace=workspace,
                    name=name,
                    arguments=arguments,
                    verification_commands=commands,
                    writable_paths=writable,
                )
                if succeeded:
                    successful_tool_names.add(name)
                    successful_tool_call_names.append(name)
                if command is not None:
                    bash_commands.append(command)
                emit({
                    "type": "openrouter.tool_result",
                    "id": call_id,
                    "name": name,
                    "success": succeeded,
                    "output": output,
                })
                messages.append({"role": "tool", "tool_call_id": call_id, "content": output})
        else:
            returncode = 1
            stderr = "maximum bounded tool steps reached\n"
    except RuntimeError as error:
        returncode = 124 if "timed out" in str(error).lower() else 1
        timed_out = returncode == 124
        stderr = str(error) + "\n"

    stdout = "".join(record.line for record in records)
    events_path.write_text(stdout, encoding="utf-8", newline="\n")
    _write_event_timeline(timeline_path, records)
    action_ledger = write_action_ledger(
        agent="openrouter",
        timeline_path=timeline_path,
        path=action_ledger_path,
    )
    stderr_path.write_text(stderr, encoding="utf-8", newline="\n")
    patch_path.write_text(_git_patch(workspace), encoding="utf-8", newline="\n")
    model_usage = tuple(
        ModelUsage(
            model=usage_model,
            input_tokens=int(values["input_tokens"]) if values["has_input"] else None,
            cached_input_tokens=(
                int(values["cached_input_tokens"]) if values["has_cached"] else None
            ),
            output_tokens=int(values["output_tokens"]) if values["has_output"] else None,
            cost_usd=float(values["cost_usd"]) if values["has_cost"] else None,
        )
        for usage_model, values in sorted(usage_by_model.items())
    )
    input_tokens = sum(item.input_tokens or 0 for item in model_usage) or None
    cached_input_tokens = sum(item.cached_input_tokens or 0 for item in model_usage) or None
    output_tokens = sum(item.output_tokens or 0 for item in model_usage) or None
    cost_usd = (
        sum(item.cost_usd or 0.0 for item in model_usage)
        if any(item.cost_usd is not None for item in model_usage)
        else None
    )
    failure_reason = _failure_reason(
        completed=completed,
        timed_out=timed_out,
        returncode=returncode,
        stdout=stdout,
        stderr=stderr,
    )
    return AgentExecution(
        agent="openrouter",
        model=model.strip(),
        reported_models=tuple(sorted(reported_models)),
        model_usage=model_usage,
        returncode=returncode,
        timed_out=timed_out,
        completed=completed,
        failure_reason=failure_reason,
        wall_seconds=time.monotonic() - started,
        input_tokens=input_tokens,
        cached_input_tokens=cached_input_tokens,
        output_tokens=output_tokens,
        reasoning_output_tokens=None,
        cost_usd=cost_usd,
        event_count=len(records),
        command_count=len(bash_commands),
        tool_call_count=len(tool_call_names),
        tool_names=tuple(sorted(tool_names)),
        tool_call_names=tuple(tool_call_names),
        successful_tool_call_count=len(successful_tool_call_names),
        successful_tool_names=tuple(sorted(successful_tool_names)),
        successful_tool_call_names=tuple(successful_tool_call_names),
        permission_denials=(),
        unavailable_tool_attempts=(),
        bash_commands=tuple(bash_commands),
        final_message=final_message,
        events_path=events_path,
        timeline_path=timeline_path,
        action_ledger_path=action_ledger_path,
        action_ledger_sha256=action_ledger.sha256,
        action_count=len(action_ledger.actions),
        action_timing_source=action_ledger.timing_source,
        stderr_path=stderr_path,
        patch_path=patch_path,
    )


def _capture_streaming_process(
    command: list[str],
    *,
    cwd: Path,
    prompt: str,
    environment: dict[str, str],
    timeout_seconds: int,
) -> tuple[str, str, int, bool, tuple[StreamRecord, ...]]:
    """Capture line-delimited client events with observed monotonic timings."""

    started = time.monotonic()
    creationflags = 0
    if os.name == "nt":
        creationflags = subprocess.CREATE_NO_WINDOW | subprocess.CREATE_NEW_PROCESS_GROUP
    process = subprocess.Popen(
        command,
        cwd=cwd,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        encoding="utf-8",
        errors="replace",
        bufsize=1,
        env=environment,
        creationflags=creationflags,
        start_new_session=os.name != "nt",
    )
    records: list[StreamRecord] = []
    lock = threading.Lock()
    next_sequence = 0

    def drain(stream: Literal["stdout", "stderr"], handle) -> None:
        nonlocal next_sequence
        try:
            for line in iter(handle.readline, ""):
                with lock:
                    records.append(StreamRecord(
                        sequence=next_sequence,
                        stream=stream,
                        elapsed_seconds=time.monotonic() - started,
                        line=line,
                    ))
                    next_sequence += 1
        finally:
            handle.close()

    assert process.stdout is not None
    assert process.stderr is not None
    stdout_thread = threading.Thread(target=drain, args=("stdout", process.stdout), daemon=True)
    stderr_thread = threading.Thread(target=drain, args=("stderr", process.stderr), daemon=True)
    stdout_thread.start()
    stderr_thread.start()
    timed_out = False
    try:
        assert process.stdin is not None
        try:
            process.stdin.write(prompt)
            process.stdin.close()
        except BrokenPipeError:
            pass
        returncode = process.wait(timeout=timeout_seconds)
    except subprocess.TimeoutExpired:
        timed_out = True
        _terminate_process_tree(process)
        try:
            process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=5)
        returncode = 124
    finally:
        if process.stdin and not process.stdin.closed:
            process.stdin.close()
        stdout_thread.join(timeout=10)
        stderr_thread.join(timeout=10)
    ordered = tuple(sorted(records, key=lambda item: item.sequence))
    stdout = "".join(item.line for item in ordered if item.stream == "stdout")
    stderr = "".join(item.line for item in ordered if item.stream == "stderr")
    if timed_out and not stderr:
        stderr = "timeout\n"
    return stdout, stderr, returncode, timed_out, ordered


def _terminate_process_tree(process: subprocess.Popen[str]) -> None:
    """Stop a timed-out client and its normal descendants before grading state."""

    if process.poll() is not None:
        return
    if os.name == "nt":
        try:
            completed = subprocess.run(
                ["taskkill", "/PID", str(process.pid), "/T", "/F"],
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=15,
                creationflags=subprocess.CREATE_NO_WINDOW,
            )
        except subprocess.TimeoutExpired:
            process.kill()
            return
        if completed.returncode == 0:
            return
        if process.poll() is None:
            process.kill()
        return
    try:
        os.killpg(process.pid, signal.SIGTERM)
    except ProcessLookupError:
        return


def _write_event_timeline(path: Path, records: Iterable[StreamRecord]) -> None:
    with path.open("w", encoding="utf-8", newline="\n") as handle:
        for record in records:
            handle.write(json.dumps({
                "sequence": record.sequence,
                "stream": record.stream,
                "elapsed_seconds": record.elapsed_seconds,
                "line": record.line,
            }, ensure_ascii=False) + "\n")


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
    claude_bare: bool = True,
    claude_setting_sources: str = "",
    claude_permission_mode: str = "manual",
    verification_commands: Iterable[str] = (),
    writable_paths: Iterable[str] = (),
) -> AgentExecution:
    workspace_path = Path(workspace).resolve()
    artifacts = Path(artifact_dir).resolve()
    artifacts.mkdir(parents=True, exist_ok=True)
    if agent == "openrouter":
        return _run_openrouter_agent(
            workspace=workspace_path,
            prompt=prompt,
            artifact_dir=artifacts,
            model=model,
            timeout_seconds=timeout_seconds,
            max_budget_usd=max_budget_usd,
            verification_commands=verification_commands,
            writable_paths=writable_paths,
        )
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
            bare=claude_bare,
            setting_sources=claude_setting_sources,
            permission_mode=claude_permission_mode,
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
    stdout, stderr, returncode, timed_out, stream_records = _capture_streaming_process(
        command,
        cwd=workspace_path,
        prompt=prompt,
        environment=env,
        timeout_seconds=timeout_seconds,
    )
    wall_seconds = time.monotonic() - started

    events_path = artifacts / "events.jsonl"
    timeline_path = artifacts / "event-timeline.jsonl"
    action_ledger_path = artifacts / "action-ledger.json"
    stderr_path = artifacts / "stderr.txt"
    patch_path = artifacts / "patch.diff"
    events_path.write_bytes(stdout.encode("utf-8"))
    _write_event_timeline(timeline_path, stream_records)
    action_ledger = write_action_ledger(
        agent=agent,
        timeline_path=timeline_path,
        path=action_ledger_path,
    )
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
        timeline_path=timeline_path,
        action_ledger_path=action_ledger_path,
        action_ledger_sha256=action_ledger.sha256,
        action_count=len(action_ledger.actions),
        action_timing_source=action_ledger.timing_source,
        stderr_path=stderr_path,
        patch_path=patch_path,
    )
