import json
from pathlib import Path
from types import SimpleNamespace

import pytest

from memorixbench.agents import ModelUsage
from memorixbench import model_route_preflight
from memorixbench.model_route_preflight import (
    MODEL_ROUTE_PREFLIGHT_SCHEMA_VERSION,
    ModelRoutePreflightError,
    run_model_route_preflight,
)


def _execution(artifact_dir: Path, *, models: tuple[str, ...]) -> SimpleNamespace:
    artifact_dir.mkdir(parents=True, exist_ok=True)
    events = artifact_dir / "events.jsonl"
    timeline = artifact_dir / "event-timeline.jsonl"
    patch = artifact_dir / "patch.diff"
    events.write_text('{"type":"result"}\n', encoding="utf-8")
    timeline.write_text('{"sequence":0}\n', encoding="utf-8")
    patch.write_text("", encoding="utf-8")
    return SimpleNamespace(
        completed=True,
        returncode=0,
        timed_out=False,
        failure_reason=None,
        event_count=1,
        wall_seconds=0.1,
        command_count=0,
        tool_call_count=0,
        reported_models=models,
        model_usage=tuple(
            ModelUsage(
                model=model,
                input_tokens=3,
                cached_input_tokens=1,
                output_tokens=2,
                cost_usd=0.001,
            )
            for model in models
        ),
        events_path=events,
        timeline_path=timeline,
        patch_path=patch,
        action_ledger_sha256="a" * 64,
    )


def _configure_fake_claude(monkeypatch, *, models: tuple[str, ...]):
    observed: dict[str, object] = {}

    def fake_provider_env(_path: Path) -> dict[str, str]:
        return {
            "ANTHROPIC_BASE_URL": "https://provider.invalid",
            "ANTHROPIC_AUTH_TOKEN": "top-secret",
        }

    def fake_run_agent(**kwargs: object) -> SimpleNamespace:
        observed.update(kwargs)
        artifact_dir = kwargs["artifact_dir"]
        assert isinstance(artifact_dir, Path)
        return _execution(artifact_dir, models=models)

    monkeypatch.setattr(model_route_preflight, "load_claude_provider_env", fake_provider_env)
    monkeypatch.setattr(model_route_preflight, "run_agent", fake_run_agent)
    return observed


def test_route_preflight_binds_one_reported_model_and_keeps_secret_out_of_receipt(
    tmp_path: Path,
    monkeypatch,
) -> None:
    observed = _configure_fake_claude(monkeypatch, models=("route-model",))
    output = tmp_path / "route"

    receipt = run_model_route_preflight(
        output_dir=output,
        claude_provider_settings=tmp_path / "user-settings.json",
        model="local-alias",
        uniform_role_model="local-alias",
        expected_reported_model="route-model",
    )

    assert receipt["schema_version"] == MODEL_ROUTE_PREFLIGHT_SCHEMA_VERSION
    assert receipt["passed"] is True
    assert receipt["reported_models"] == ["route-model"]
    assert receipt["uniform_role_model"] == "local-alias"
    assert receipt["model_identity_observations"] == []
    assert receipt["failure_reasons"] == []
    saved = (output / "model-route-preflight.json").read_text(encoding="utf-8")
    assert json.loads(saved) == receipt
    assert "top-secret" not in saved
    environment = observed["environment"]
    assert isinstance(environment, dict)
    assert environment["HOME"].startswith(str(output))
    assert environment["CLAUDE_CONFIG_DIR"].startswith(str(output))
    assert environment["ANTHROPIC_DEFAULT_HAIKU_MODEL"] == "local-alias"
    assert environment["ANTHROPIC_DEFAULT_SONNET_MODEL"] == "local-alias"
    assert environment["ANTHROPIC_DEFAULT_OPUS_MODEL"] == "local-alias"
    assert observed["allowed_tools"] == ()


def test_route_preflight_refuses_to_pass_unbound_or_mixed_telemetry(
    tmp_path: Path,
    monkeypatch,
) -> None:
    _configure_fake_claude(monkeypatch, models=("route-model", "helper-model"))

    receipt = run_model_route_preflight(
        output_dir=tmp_path / "mixed",
        claude_provider_settings=tmp_path / "user-settings.json",
        expected_reported_model="route-model",
    )

    assert receipt["passed"] is False
    assert "reported-model-count-is-not-one" in receipt["failure_reasons"]
    assert "model-usage-count-is-not-one" in receipt["failure_reasons"]
    assert "expected-reported-model-required-or-mismatched" in receipt["failure_reasons"]


def test_route_preflight_discovery_does_not_unlock_a_route(
    tmp_path: Path,
    monkeypatch,
) -> None:
    _configure_fake_claude(monkeypatch, models=("route-model",))

    receipt = run_model_route_preflight(
        output_dir=tmp_path / "discovery",
        claude_provider_settings=tmp_path / "user-settings.json",
        expected_reported_model=None,
    )

    assert receipt["passed"] is False
    assert receipt["reported_models"] == ["route-model"]
    assert receipt["failure_reasons"] == [
        "expected-reported-model-required-or-mismatched"
    ]


def test_route_preflight_rejects_an_empty_uniform_role_model(tmp_path: Path) -> None:
    with pytest.raises(ModelRoutePreflightError, match="uniform_role_model must be non-empty"):
        run_model_route_preflight(
            output_dir=tmp_path / "empty-role",
            claude_provider_settings=tmp_path / "user-settings.json",
            expected_reported_model="route-model",
            uniform_role_model=" ",
        )


def test_route_preflight_requires_a_new_output_directory(tmp_path: Path) -> None:
    output = tmp_path / "existing"
    output.mkdir()

    with pytest.raises(ModelRoutePreflightError, match="must not already exist"):
        run_model_route_preflight(
            output_dir=output,
            claude_provider_settings=tmp_path / "user-settings.json",
            expected_reported_model="route-model",
        )
