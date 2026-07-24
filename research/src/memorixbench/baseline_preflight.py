"""Repeatable runtime preflight for the pinned memory baselines."""

from __future__ import annotations

from hashlib import sha256
import json
from pathlib import Path
from typing import Any, Literal

from .agentmemory_adapter import AGENTMEMORY_PROVIDER_ID, AgentMemoryFullAdapter
from .mem0_adapter import MEM0_PROVIDER_ID, Mem0LocalAdapter


BASELINE_RUNTIME_PREFLIGHT_SCHEMA_VERSION = "baseline-runtime-preflight-v1"
BaselineProvider = Literal["mem0", "agentmemory"]


class BaselineRuntimePreflightError(ValueError):
    """Raised when a baseline runtime cannot pass its independent smoke gate."""


def _prepare_output_dir(path: str | Path) -> Path:
    output_dir = Path(path).resolve()
    if output_dir.exists():
        raise BaselineRuntimePreflightError(
            "baseline preflight output directory must not already exist"
        )
    output_dir.mkdir(parents=True)
    return output_dir


def _stable_run_id(output_dir: Path) -> str:
    digest = sha256(str(output_dir).encode("utf-8")).hexdigest()
    return digest[:16]


def _write_receipt(
    output_dir: Path,
    *,
    provider: str,
    provider_version: str,
    checks: dict[str, Any],
) -> dict[str, Any]:
    receipt = {
        "schema_version": BASELINE_RUNTIME_PREFLIGHT_SCHEMA_VERSION,
        "provider": provider,
        "provider_version": provider_version,
        "checks": checks,
        "passed": True,
    }
    target = output_dir / "baseline-preflight.json"
    target.write_text(json.dumps(receipt, indent=2) + "\n", encoding="utf-8")
    return receipt


def _run_mem0_preflight(
    *,
    output_dir: Path,
    mem0_python: Path | None,
    model_cache_root: Path | None,
) -> dict[str, Any]:
    if mem0_python is None:
        raise BaselineRuntimePreflightError("Mem0 preflight requires --mem0-python")
    if model_cache_root is None:
        raise BaselineRuntimePreflightError("Mem0 preflight requires --model-cache-root")
    adapter = Mem0LocalAdapter(
        python_path=mem0_python.resolve(),
        data_dir=output_dir / "data",
        artifact_dir=output_dir / "artifacts",
        model_cache_root=model_cache_root.resolve(),
        collection_name="baseline-runtime-preflight",
    )
    result = adapter.preflight()
    write_count = result.get("write_count")
    persisted_count = result.get("persisted_count")
    empty_scope_count = result.get("empty_scope_count")
    persisted_marker_found = result.get("persisted_marker_found")
    if (
        not isinstance(write_count, int)
        or write_count < 1
        or not isinstance(persisted_count, int)
        or persisted_count < 1
        or empty_scope_count != 0
        or persisted_marker_found is not True
        or result.get("infer") is not False
    ):
        raise BaselineRuntimePreflightError("Mem0 runtime preflight returned invalid checks")
    version = result.get("version")
    if not isinstance(version, str) or not version:
        raise BaselineRuntimePreflightError("Mem0 runtime preflight did not report a version")
    return _write_receipt(
        output_dir,
        provider=MEM0_PROVIDER_ID,
        provider_version=version,
        checks={
            "write_count": write_count,
            "persisted_count": persisted_count,
            "empty_scope_count": empty_scope_count,
            "persisted_marker_found": persisted_marker_found,
            "infer": False,
            "embedding_model": result.get("embedding_model"),
        },
    )


def _run_agentmemory_preflight(
    *,
    output_dir: Path,
    agentmemory_runtime: Path | None,
) -> dict[str, Any]:
    if agentmemory_runtime is None:
        raise BaselineRuntimePreflightError(
            "AgentMemory preflight requires --agentmemory-runtime"
        )
    run_id = _stable_run_id(output_dir)
    adapter = AgentMemoryFullAdapter(
        runtime_root=agentmemory_runtime.resolve(),
        data_dir=output_dir / "data",
        artifact_dir=output_dir / "artifacts",
        project_name=f"memorixbench_preflight_{run_id}",
    )
    with adapter:
        result = adapter.preflight(project_id=f"baseline-preflight-{run_id}")
    initial_count = result.get("initial_result_count")
    foreign_count = result.get("foreign_result_count")
    restarted_count = result.get("restarted_result_count")
    if (
        not isinstance(initial_count, int)
        or initial_count < 1
        or foreign_count != 0
        or not isinstance(restarted_count, int)
        or restarted_count < 1
        or result.get("auto_compress") is not False
        or result.get("context_injection") is not False
    ):
        raise BaselineRuntimePreflightError(
            "AgentMemory runtime preflight returned invalid checks"
        )
    version = result.get("version")
    if not isinstance(version, str) or not version:
        raise BaselineRuntimePreflightError(
            "AgentMemory runtime preflight did not report a version"
        )
    return _write_receipt(
        output_dir,
        provider=AGENTMEMORY_PROVIDER_ID,
        provider_version=version,
        checks={
            "initial_result_count": initial_count,
            "foreign_result_count": foreign_count,
            "restarted_result_count": restarted_count,
            "persistence_settle_seconds": result.get("persistence_settle_seconds"),
            "auto_compress": False,
            "context_injection": False,
        },
    )


def run_baseline_runtime_preflight(
    *,
    provider: BaselineProvider,
    output_dir: str | Path,
    mem0_python: str | Path | None = None,
    model_cache_root: str | Path | None = None,
    agentmemory_runtime: str | Path | None = None,
) -> dict[str, Any]:
    if provider == "mem0":
        if mem0_python is None:
            raise BaselineRuntimePreflightError("Mem0 preflight requires --mem0-python")
        if model_cache_root is None:
            raise BaselineRuntimePreflightError("Mem0 preflight requires --model-cache-root")
    elif provider == "agentmemory":
        if agentmemory_runtime is None:
            raise BaselineRuntimePreflightError(
                "AgentMemory preflight requires --agentmemory-runtime"
            )
    else:
        raise BaselineRuntimePreflightError(f"unsupported baseline provider: {provider}")
    target = _prepare_output_dir(output_dir)
    if provider == "mem0":
        return _run_mem0_preflight(
            output_dir=target,
            mem0_python=Path(mem0_python) if mem0_python is not None else None,
            model_cache_root=(
                Path(model_cache_root) if model_cache_root is not None else None
            ),
        )
    if provider == "agentmemory":
        return _run_agentmemory_preflight(
            output_dir=target,
            agentmemory_runtime=(
                Path(agentmemory_runtime) if agentmemory_runtime is not None else None
            ),
        )
    raise AssertionError("validated baseline provider was not dispatched")
