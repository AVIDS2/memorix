from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from .models import CaseSpec, OracleSpec, sha256_text, sha256_tree
from .sandbox import ToolSandbox
from .trial import (
    PROTOCOL_VERSION,
    MemorixContextTool,
    TrialConfig,
    _copy_source,
    _initialize_git,
    _runner_source_tree_sha256,
)


PREFLIGHT_VERSION = "1"


def _native_payload(tool: MemorixContextTool | None) -> dict[str, Any] | None:
    if tool is None:
        return None
    return {
        "memorix_version": tool.version,
        "seed": tool.seed_receipt,
        "codegraph_refresh": tool.codegraph_refresh_receipt,
        "seed_observation_id_sha256": (
            sha256_text(str(tool.seed_observation_id))
            if tool.seed_observation_id is not None
            else None
        ),
        "context_includes_seed": tool.context_includes_seed,
        "detail_delivered": tool.detail_delivered,
        "context_sha256": tool.context_hashes,
        "detail_sha256": tool.detail_hashes,
        "retrieved_chars": tool.retrieved_chars,
        "formation_elapsed_ms": tool.formation_elapsed_ms,
        "codegraph_refresh_elapsed_ms": tool.codegraph_refresh_elapsed_ms,
    }


def run_native_preflight(
    *,
    case: CaseSpec,
    oracle: OracleSpec,
    artifact_root: Path,
    memorix_cli: str = "memorix",
    memorix_timeout_seconds: int = 120,
) -> dict[str, Any]:
    """Exercise native evidence delivery without asking a model to solve a task."""
    artifact_root = artifact_root.resolve()
    if artifact_root.exists():
        raise RuntimeError("native preflight artifact root must not already exist")
    artifact_root.mkdir(parents=True)
    workspace = artifact_root / "workspace"
    receipt_path = artifact_root / "native-preflight-receipt.json"

    stage = "source-copy"
    failure: str | None = None
    start_tree_sha256: str | None = None
    end_tree_sha256: str | None = None
    baseline_oracle_passed: bool | None = None
    baseline_oracle_exit_code: int | None = None
    codegraph_refresh: dict[str, object] | None = None
    tool: MemorixContextTool | None = None

    try:
        _copy_source(case.source_root, workspace)
        stage = "git-baseline"
        _initialize_git(workspace)
        start_tree_sha256 = sha256_tree(workspace)

        stage = "baseline-oracle"
        sandbox = ToolSandbox(workspace, case.writable_paths, oracle)
        baseline = sandbox.run_verification({})
        baseline_oracle_passed = bool(baseline["passed"])
        baseline_oracle_exit_code = sandbox.events[-1].exit_code if sandbox.events else None

        stage = "native-seed"
        config = TrialConfig(
            case=case,
            oracle=oracle,
            condition="memorix-native",
            requested_model="not-run-preflight",
            artifact_root=artifact_root,
            memorix_cli=memorix_cli,
            memorix_timeout_seconds=memorix_timeout_seconds,
        )
        tool = MemorixContextTool(config=config, workspace=workspace)
        tool.seed()

        stage = "codegraph-refresh"
        tool.prepare_transfer()

        stage = "native-context"
        tool.context()
        if tool.context_includes_seed:
            stage = "native-detail"
            tool.detail(1)
    except Exception as error:
        failure = f"{stage}:{type(error).__name__}"
    finally:
        if workspace.is_dir():
            end_tree_sha256 = sha256_tree(workspace)
        if tool is not None:
            codegraph_refresh = tool.codegraph_refresh_receipt

    if failure is None and baseline_oracle_passed is not False:
        failure = "baseline-oracle:unexpected-pass"
    if failure is None and start_tree_sha256 != end_tree_sha256:
        failure = "workspace:source-changed-during-preflight"
    if failure is None and (tool is None or tool.context_includes_seed is not True or not tool.detail_delivered):
        failure = "native-evidence:seed-not-delivered"

    payload = {
        "schema": f"memorixbench-native-preflight-v{PREFLIGHT_VERSION}",
        "status": "passed" if failure is None else "failed",
        "failure": failure,
        "runner": {
            "protocol_version": PROTOCOL_VERSION,
            "source_tree_sha256": _runner_source_tree_sha256(),
        },
        "case": {
            "id": case.case_id,
            "class": case.case_class,
            "tier": case.case_tier,
            "task_sha256": sha256_text(case.task),
            "predecessor_record_sha256": sha256_text(case.predecessor_record),
        },
        "oracle": {
            "definition_sha256": oracle.definition_sha256,
            "baseline_passed": baseline_oracle_passed,
            "baseline_exit_code": baseline_oracle_exit_code,
        },
        "codegraph_refresh": codegraph_refresh,
        "workspace": {
            "start_tree_sha256": start_tree_sha256,
            "end_tree_sha256": end_tree_sha256,
            "source_unchanged": (
                start_tree_sha256 is not None and start_tree_sha256 == end_tree_sha256
            ),
        },
        "native": _native_payload(tool),
    }
    receipt_path.write_bytes((json.dumps(payload, indent=2) + "\n").encode("utf-8"))
    return {"receipt_path": receipt_path, "payload": payload}
