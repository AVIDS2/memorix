"""Standalone worker executed inside the pinned Mem0 runtime."""

from __future__ import annotations

import argparse
import importlib.metadata
import json
import os
from pathlib import Path
import sys
from typing import Any


RESULT_PREFIX = "MEMORIXBENCH_RESULT="


def _memory_config(request: dict[str, Any]) -> dict[str, Any]:
    root = Path(str(request["data_dir"])).resolve()
    root.mkdir(parents=True, exist_ok=True)
    model = str(request.get("embedding_model") or "BAAI/bge-small-en-v1.5")
    dimensions = int(request.get("embedding_dimensions") or 384)
    return {
        "vector_store": {
            "provider": "qdrant",
            "config": {
                "collection_name": str(request.get("collection_name") or "memorixbench"),
                "path": str(root / "qdrant"),
                "embedding_model_dims": dimensions,
            },
        },
        # infer=False below means this placeholder client is never asked to
        # extract facts. Mem0 still constructs its documented LLM client.
        "llm": {
            "provider": "openai",
            "config": {"api_key": "benchmark-no-llm"},
        },
        "embedder": {
            "provider": "fastembed",
            "config": {"model": model, "embedding_dims": dimensions},
        },
        "history_db_path": str(root / "history.db"),
    }


def _close(memory: Any) -> None:
    client = getattr(getattr(memory, "vector_store", None), "client", None)
    close = getattr(client, "close", None)
    if callable(close):
        close()


def _new_memory(request: dict[str, Any]) -> Any:
    from mem0 import Memory

    return Memory.from_config(_memory_config(request))


def _preflight(request: dict[str, Any]) -> dict[str, Any]:
    scope = "memorixbench-preflight"
    marker = "MemorixBench preflight retention marker: retry cadence evidence."
    first = _new_memory(request)
    try:
        written = first.add(marker, user_id=scope, infer=False)
    finally:
        _close(first)
    second = _new_memory(request)
    try:
        persisted = second.search(
            "retry cadence evidence",
            filters={"user_id": scope},
            top_k=3,
            threshold=0.0,
        )
        empty_scope = second.search(
            "retry cadence evidence",
            filters={"user_id": "memorixbench-empty-scope"},
            top_k=3,
            threshold=0.0,
        )
    finally:
        _close(second)
    persisted_rows = persisted.get("results", [])
    return {
        "version": importlib.metadata.version("mem0ai"),
        "write_count": len(written.get("results", [])),
        "persisted_count": len(persisted_rows),
        "persisted_marker_found": any(
            row.get("memory") == marker for row in persisted_rows if isinstance(row, dict)
        ),
        "empty_scope_count": len(empty_scope.get("results", [])),
        "infer": False,
        "embedding_model": request.get("embedding_model") or "BAAI/bge-small-en-v1.5",
    }


def _seed(request: dict[str, Any]) -> dict[str, Any]:
    project_id = str(request["project_id"])
    seeds = request.get("seeds")
    if not isinstance(seeds, list) or not seeds:
        raise ValueError("seed request requires a non-empty seeds array")
    memory = _new_memory(request)
    written: list[dict[str, Any]] = []
    try:
        for seed in seeds:
            if not isinstance(seed, dict):
                raise ValueError("seed entries must be objects")
            seed_id = str(seed["seed_id"])
            content = str(seed["content"])
            result = memory.add(
                content,
                user_id=project_id,
                metadata={"memorixbench_seed_id": seed_id},
                infer=False,
            )
            written.append({"seed_id": seed_id, "result": result})
    finally:
        _close(memory)
    return {"seed_count": len(written), "written": written, "infer": False}


def _retrieve(request: dict[str, Any]) -> dict[str, Any]:
    project_id = str(request["project_id"])
    query = str(request["query"])
    top_k = int(request.get("top_k") or 8)
    memory = _new_memory(request)
    try:
        result = memory.search(
            query,
            filters={"user_id": project_id},
            top_k=top_k,
            threshold=0.0,
        )
    finally:
        _close(memory)
    records: list[dict[str, Any]] = []
    for row in result.get("results", []):
        if not isinstance(row, dict):
            continue
        content = row.get("memory")
        identifier = row.get("id")
        if not isinstance(content, str) or not content.strip() or not identifier:
            continue
        score = row.get("score")
        records.append(
            {
                "id": str(identifier),
                "content": content,
                "score": score if isinstance(score, (int, float)) else None,
            }
        )
    return {
        "version": importlib.metadata.version("mem0ai"),
        "records": records,
        "query": query,
    }


def run(request: dict[str, Any]) -> dict[str, Any]:
    action = request.get("action")
    if action == "preflight":
        return _preflight(request)
    if action == "seed":
        return _seed(request)
    if action == "retrieve":
        return _retrieve(request)
    raise ValueError(f"unsupported Mem0 worker action: {action!r}")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--request", required=True, type=Path)
    args = parser.parse_args()
    request = json.loads(args.request.read_text(encoding="utf-8"))
    if not isinstance(request, dict):
        raise ValueError("request must be a JSON object")
    try:
        result = run(request)
        payload = {"ok": True, "result": result}
    except Exception as error:
        payload = {"ok": False, "error": f"{type(error).__name__}: {error}"}
    print(RESULT_PREFIX + json.dumps(payload, sort_keys=True))
    return 0 if payload["ok"] else 1


if __name__ == "__main__":
    os.environ.setdefault("MEM0_TELEMETRY", "false")
    raise SystemExit(main())
