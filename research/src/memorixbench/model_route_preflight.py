"""Isolated, no-task verification for a Claude model route."""

from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import subprocess
from typing import Any

from .agents import (
    apply_uniform_claude_role_model,
    ModelUsage,
    load_claude_provider_env,
    run_agent,
    write_claude_settings,
)


MODEL_ROUTE_PREFLIGHT_SCHEMA_VERSION = "model-route-preflight-v1"
PROBE_PROMPT = "Reply with exactly READY. Do not use tools or inspect files."


class ModelRoutePreflightError(ValueError):
    """Raised when a model-route preflight cannot be prepared safely."""


def _sha256_text(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _sha256_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _nonempty_text(value: str | None, *, label: str, required: bool) -> str | None:
    if value is None:
        if required:
            raise ModelRoutePreflightError(f"{label} is required")
        return None
    normalized = value.strip()
    if not normalized:
        raise ModelRoutePreflightError(f"{label} must be non-empty when provided")
    return normalized


def _prepare_output_dir(path: str | Path) -> Path:
    output_dir = Path(path).resolve()
    if output_dir.exists():
        raise ModelRoutePreflightError(
            "model-route preflight output directory must not already exist"
        )
    output_dir.mkdir(parents=True)
    return output_dir


def _require_new_output_path(path: str | Path) -> Path:
    output_dir = Path(path).resolve()
    if output_dir.exists():
        raise ModelRoutePreflightError(
            "model-route preflight output directory must not already exist"
        )
    return output_dir


def _initialize_probe_workspace(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=False)
    completed = subprocess.run(
        ["git", "init", "--quiet"],
        cwd=path,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    if completed.returncode != 0:
        raise ModelRoutePreflightError("could not initialize isolated probe workspace")


def _workspace_is_clean(path: Path) -> bool:
    completed = subprocess.run(
        [
            "git",
            "status",
            "--porcelain=v1",
            "-z",
            "--untracked-files=all",
            "--ignored=matching",
        ],
        cwd=path,
        capture_output=True,
        text=False,
    )
    if completed.returncode != 0:
        raise ModelRoutePreflightError("could not inspect isolated probe workspace")
    return not completed.stdout


def _model_usage_payload(records: tuple[ModelUsage, ...]) -> list[dict[str, object]]:
    return [
        {
            "model": record.model,
            "input_tokens": record.input_tokens,
            "cached_input_tokens": record.cached_input_tokens,
            "output_tokens": record.output_tokens,
            "cost_usd": record.cost_usd,
        }
        for record in records
    ]


def _model_identity_observations(path: Path) -> list[dict[str, str]]:
    """Extract only model identifiers from private JSONL events, never text."""

    observations: set[tuple[str, str]] = set()
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        try:
            event = json.loads(line)
        except json.JSONDecodeError:
            continue
        if not isinstance(event, dict):
            continue
        event_type = event.get("type")
        label = str(event_type) if isinstance(event_type, str) else "event"
        event_model = event.get("model")
        if isinstance(event_model, str) and event_model:
            observations.add((f"{label}.model", event_model))
        message = event.get("message")
        if isinstance(message, dict):
            message_model = message.get("model")
            if isinstance(message_model, str) and message_model:
                observations.add((f"{label}.message.model", message_model))
        model_usage = event.get("modelUsage")
        if isinstance(model_usage, dict):
            for model in model_usage:
                if isinstance(model, str) and model:
                    observations.add((f"{label}.modelUsage", model))
    return [
        {"source": source, "model": model}
        for source, model in sorted(observations)
    ]


def _model_profile(records: tuple[ModelUsage, ...]) -> str:
    if not records:
        return "unreported"
    return "single" if len(records) == 1 else "mixed"


def _failure_reasons(checks: dict[str, bool]) -> list[str]:
    labels = {
        "completed": "agent-did-not-complete",
        "zero_returncode": "agent-returned-nonzero",
        "not_timed_out": "agent-timed-out",
        "no_tool_calls": "probe-used-tools",
        "workspace_clean": "probe-workspace-changed",
        "one_reported_model": "reported-model-count-is-not-one",
        "one_model_usage": "model-usage-count-is-not-one",
        "telemetry_agrees": "reported-model-and-usage-disagree",
        "expected_model_bound": "expected-reported-model-required-or-mismatched",
    }
    return [label for key, label in labels.items() if not checks[key]]


def run_model_route_preflight(
    *,
    output_dir: str | Path,
    claude_provider_settings: str | Path,
    expected_reported_model: str | None,
    model: str | None = None,
    uniform_role_model: str | None = None,
    timeout_seconds: int = 120,
    max_budget_usd: float | None = 0.25,
) -> dict[str, Any]:
    """Run one fixed no-tool probe and bind its route to client telemetry.

    This is intentionally not a benchmark trial: it contains no case, memory,
    repository task, or outcome. Raw client events remain in ``output_dir``;
    the returned receipt contains only hashes and aggregate telemetry.
    """

    expected_model = _nonempty_text(
        expected_reported_model,
        label="expected_reported_model",
        required=False,
    )
    requested_model = _nonempty_text(model, label="model", required=False)
    role_model_override = _nonempty_text(
        uniform_role_model,
        label="uniform_role_model",
        required=False,
    )
    if timeout_seconds <= 0:
        raise ModelRoutePreflightError("model-route preflight timeout must be positive")
    if max_budget_usd is not None and max_budget_usd <= 0:
        raise ModelRoutePreflightError("model-route preflight max budget must be positive")

    target_path = _require_new_output_path(output_dir)
    provider_env = load_claude_provider_env(claude_provider_settings)
    apply_uniform_claude_role_model(provider_env, role_model_override)
    target = _prepare_output_dir(target_path)
    workspace = target / "probe-workspace"
    _initialize_probe_workspace(workspace)

    agent_home = target / "control" / "agent-home"
    agent_temp = target / "control" / "agent-temp"
    agent_appdata = agent_home / "AppData" / "Roaming"
    agent_local_appdata = agent_home / "AppData" / "Local"
    agent_claude_config = agent_home / "claude-config"
    for directory in (
        agent_home,
        agent_temp,
        agent_appdata,
        agent_local_appdata,
        agent_claude_config,
    ):
        directory.mkdir(parents=True, exist_ok=True)
    provider_env.update({
        "HOME": str(agent_home),
        "USERPROFILE": str(agent_home),
        "APPDATA": str(agent_appdata),
        "LOCALAPPDATA": str(agent_local_appdata),
        "CLAUDE_CONFIG_DIR": str(agent_claude_config),
        "TEMP": str(agent_temp),
        "TMP": str(agent_temp),
    })
    settings_path = write_claude_settings(
        target / "control" / "claude-settings.json",
        denied_roots=(target, Path.home()),
        allowed_tools=(),
    )
    execution = run_agent(
        agent="claude",
        workspace=workspace,
        prompt=PROBE_PROMPT,
        artifact_dir=target / "private-agent-artifacts",
        model=requested_model,
        timeout_seconds=timeout_seconds,
        max_budget_usd=max_budget_usd,
        environment=provider_env,
        allowed_tools=(),
        settings_path=settings_path,
        controlled=True,
    )
    workspace_clean = _workspace_is_clean(workspace)
    reported_models = tuple(sorted(set(execution.reported_models)))
    model_usage = tuple(sorted(execution.model_usage, key=lambda item: item.model))
    telemetry_model = model_usage[0].model if len(model_usage) == 1 else None
    checks = {
        "completed": execution.completed,
        "zero_returncode": execution.returncode == 0,
        "not_timed_out": not execution.timed_out,
        "no_tool_calls": execution.tool_call_count == 0 and execution.command_count == 0,
        "workspace_clean": workspace_clean,
        "one_reported_model": len(reported_models) == 1,
        "one_model_usage": len(model_usage) == 1,
        "telemetry_agrees": (
            len(reported_models) == 1
            and telemetry_model is not None
            and reported_models[0] == telemetry_model
        ),
        "expected_model_bound": (
            expected_model is not None
            and reported_models == (expected_model,)
            and telemetry_model == expected_model
        ),
    }
    receipt = {
        "schema_version": MODEL_ROUTE_PREFLIGHT_SCHEMA_VERSION,
        "agent": "claude",
        "requested_model": requested_model,
        "uniform_role_model": role_model_override,
        "expected_reported_model": expected_model,
        "reported_models": list(reported_models),
        "model_usage": _model_usage_payload(model_usage),
        "model_identity_observations": _model_identity_observations(
            execution.events_path
        ),
        "model_profile": _model_profile(model_usage),
        "checks": checks,
        "failure_reasons": _failure_reasons(checks),
        "completed": execution.completed,
        "returncode": execution.returncode,
        "timed_out": execution.timed_out,
        "failure_reason": execution.failure_reason,
        "event_count": execution.event_count,
        "wall_seconds": execution.wall_seconds,
        "probe_prompt_sha256": _sha256_text(PROBE_PROMPT),
        "private_evidence": {
            "events_sha256": _sha256_file(execution.events_path),
            "timeline_sha256": _sha256_file(execution.timeline_path),
            "action_ledger_sha256": execution.action_ledger_sha256,
            "patch_sha256": _sha256_file(execution.patch_path),
        },
        "provider_env_keys": sorted(
            key for key in provider_env if key.startswith("ANTHROPIC_")
        ),
        "isolation_profile": "external-artifact-home+bare-controlled-claude-v1",
        "observed_at_utc": datetime.now(timezone.utc).isoformat(),
        "passed": all(checks.values()),
    }
    (target / "model-route-preflight.json").write_text(
        json.dumps(receipt, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    return receipt
