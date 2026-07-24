import json
from pathlib import Path

import pytest

from memorixbench import baseline_preflight
from memorixbench.baseline_preflight import (
    BASELINE_RUNTIME_PREFLIGHT_SCHEMA_VERSION,
    BaselineRuntimePreflightError,
    run_baseline_runtime_preflight,
)


def test_mem0_runtime_preflight_writes_a_minimal_receipt(
    tmp_path: Path,
    monkeypatch,
) -> None:
    class FakeMem0Adapter:
        def __init__(self, **kwargs: object) -> None:
            self.kwargs = kwargs

        def preflight(self) -> dict[str, object]:
            return {
                "version": "2.0.12",
                "write_count": 1,
                "persisted_count": 1,
                "empty_scope_count": 0,
                "persisted_marker_found": True,
                "infer": False,
                "embedding_model": "local-model",
            }

    monkeypatch.setattr(baseline_preflight, "Mem0LocalAdapter", FakeMem0Adapter)
    output = tmp_path / "mem0"

    receipt = run_baseline_runtime_preflight(
        provider="mem0",
        output_dir=output,
        mem0_python=tmp_path / "python.exe",
        model_cache_root=tmp_path / "cache",
    )

    assert receipt["schema_version"] == BASELINE_RUNTIME_PREFLIGHT_SCHEMA_VERSION
    assert receipt["provider"] == "mem0-2.0.12-local"
    assert receipt["passed"] is True
    saved = json.loads((output / "baseline-preflight.json").read_text(encoding="utf-8"))
    assert saved == receipt


def test_agentmemory_runtime_preflight_uses_a_unique_compose_project(
    tmp_path: Path,
    monkeypatch,
) -> None:
    created: list[object] = []

    class FakeAgentMemoryAdapter:
        def __init__(self, **kwargs: object) -> None:
            created.append(kwargs)

        def __enter__(self) -> "FakeAgentMemoryAdapter":
            return self

        def __exit__(self, *args: object) -> None:
            return None

        def preflight(self, *, project_id: str) -> dict[str, object]:
            assert project_id.startswith("baseline-preflight-")
            return {
                "version": "0.9.28",
                "initial_result_count": 1,
                "foreign_result_count": 0,
                "restarted_result_count": 1,
                "persistence_settle_seconds": 12,
                "auto_compress": False,
                "context_injection": False,
            }

    monkeypatch.setattr(baseline_preflight, "AgentMemoryFullAdapter", FakeAgentMemoryAdapter)
    output = tmp_path / "agentmemory"

    receipt = run_baseline_runtime_preflight(
        provider="agentmemory",
        output_dir=output,
        agentmemory_runtime=tmp_path / "runtime",
    )

    assert receipt["provider"] == "agentmemory-0.9.28-full-local"
    assert receipt["checks"]["restarted_result_count"] == 1
    assert len(created) == 1
    kwargs = created[0]
    assert isinstance(kwargs, dict)
    assert str(kwargs["project_name"]).startswith("memorixbench_preflight_")


def test_runtime_preflight_refuses_an_existing_output_directory(tmp_path: Path) -> None:
    output = tmp_path / "existing"
    output.mkdir()

    with pytest.raises(BaselineRuntimePreflightError, match="must not already exist"):
        run_baseline_runtime_preflight(
            provider="mem0",
            output_dir=output,
            mem0_python=tmp_path / "python.exe",
            model_cache_root=tmp_path / "cache",
        )


def test_runtime_preflight_validates_required_inputs_before_creating_output(
    tmp_path: Path,
) -> None:
    output = tmp_path / "missing-input"

    with pytest.raises(BaselineRuntimePreflightError, match="requires --mem0-python"):
        run_baseline_runtime_preflight(provider="mem0", output_dir=output)

    assert not output.exists()
