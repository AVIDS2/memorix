from __future__ import annotations

from dataclasses import dataclass, field
import json
from pathlib import Path
import subprocess
from typing import Any

from .baseline import (
    BaselineRetrieval,
    RetrievedMemory,
    build_retrieval,
    canonical_seed_content,
    canonical_seed_id,
    scrubbed_provider_environment,
)
from .schema import CaseManifest
from .trace import PrecursorTrace


MEM0_PROVIDER_ID = "mem0-2.0.12-local"
RESULT_PREFIX = "MEMORIXBENCH_RESULT="


class Mem0AdapterError(RuntimeError):
    """Raised when the pinned Mem0 runtime cannot complete an adapter action."""


@dataclass
class Mem0LocalAdapter:
    python_path: Path
    data_dir: Path
    artifact_dir: Path
    model_cache_root: Path | None = None
    embedding_model: str = "BAAI/bge-small-en-v1.5"
    embedding_dimensions: int = 384
    collection_name: str = "memorixbench"
    _request_number: int = field(default=0, init=False)

    @property
    def worker_path(self) -> Path:
        return Path(__file__).with_name("mem0_worker.py")

    def _environment(self) -> dict[str, str]:
        cache_dir = self.model_cache_root or self.data_dir / "cache"
        env = scrubbed_provider_environment()
        env.update({
            "MEM0_DIR": str(self.data_dir / "home"),
            "MEM0_TELEMETRY": "false",
            "HF_HOME": str(cache_dir / "huggingface"),
            "XDG_CACHE_HOME": str(cache_dir / "xdg"),
            "FASTEMBED_CACHE_PATH": str(cache_dir / "fastembed"),
            "PIP_CACHE_DIR": str(cache_dir / "pip"),
            "HOME": str(self.data_dir / "home"),
            "USERPROFILE": str(self.data_dir / "home"),
            "HF_HUB_OFFLINE": "1",
            "TRANSFORMERS_OFFLINE": "1",
        })
        return env

    def _base_request(self, action: str) -> dict[str, object]:
        return {
            "action": action,
            "data_dir": str(self.data_dir),
            "embedding_model": self.embedding_model,
            "embedding_dimensions": self.embedding_dimensions,
            "collection_name": self.collection_name,
        }

    def _invoke(self, action: str, payload: dict[str, object]) -> dict[str, Any]:
        if not self.python_path.is_file():
            raise Mem0AdapterError(f"Mem0 Python runtime does not exist: {self.python_path}")
        if not self.worker_path.is_file():
            raise Mem0AdapterError(f"Mem0 worker is missing: {self.worker_path}")
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.artifact_dir.mkdir(parents=True, exist_ok=True)
        self._request_number += 1
        request = self._base_request(action)
        request.update(payload)
        prefix = f"{self._request_number:02d}-{action}"
        request_path = self.artifact_dir / f"{prefix}.request.json"
        stdout_path = self.artifact_dir / f"{prefix}.stdout.log"
        stderr_path = self.artifact_dir / f"{prefix}.stderr.log"
        request_path.write_text(json.dumps(request, indent=2), encoding="utf-8")
        completed = subprocess.run(
            [str(self.python_path), str(self.worker_path), "--request", str(request_path)],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            env=self._environment(),
            timeout=300,
        )
        stdout_path.write_text(completed.stdout, encoding="utf-8")
        stderr_path.write_text(completed.stderr, encoding="utf-8")
        payload_line = next(
            (
                line[len(RESULT_PREFIX) :]
                for line in reversed(completed.stdout.splitlines())
                if line.startswith(RESULT_PREFIX)
            ),
            None,
        )
        if payload_line is None:
            raise Mem0AdapterError(
                f"Mem0 {action} produced no result payload; see {stdout_path} and {stderr_path}"
            )
        response = json.loads(payload_line)
        if not isinstance(response, dict) or response.get("ok") is not True:
            detail = response.get("error") if isinstance(response, dict) else response
            raise Mem0AdapterError(f"Mem0 {action} failed: {detail}")
        if completed.returncode != 0:
            raise Mem0AdapterError(f"Mem0 {action} exited {completed.returncode}")
        result = response.get("result")
        if not isinstance(result, dict):
            raise Mem0AdapterError(f"Mem0 {action} result is not an object")
        return result

    def preflight(self) -> dict[str, Any]:
        return self._invoke("preflight", {})

    def seed_canonical_evidence(
        self,
        manifest: CaseManifest,
        *,
        project_id: str,
    ) -> dict[str, Any]:
        if not manifest.memory_seeds:
            raise Mem0AdapterError(f"case {manifest.case_id} has no memory seeds")
        seeds = [
            {
                "seed_id": canonical_seed_id(seed),
                "content": canonical_seed_content(seed),
            }
            for seed in manifest.memory_seeds
        ]
        result = self._invoke("seed", {"project_id": project_id, "seeds": seeds})
        result["formation_receipt"] = {
            "surface": "seeded-canonical",
            "input_record_ids": [str(seed["seed_id"]) for seed in seeds],
            "write_operation_count": len(seeds),
            "transport_call_count": 1,
            "maintenance_call_count": 0,
            "record_count": len(seeds),
        }
        return result

    def ingest_trace(self, trace: PrecursorTrace, *, project_id: str) -> dict[str, Any]:
        records = [
            {
                "seed_id": f"trace:{event.event_id}",
                "content": event.replay_content(),
            }
            for event in trace.events
        ]
        if not records:
            raise Mem0AdapterError("precursor trace has no replay records")
        result = self._invoke("seed", {"project_id": project_id, "seeds": records})
        result["formation_receipt"] = {
            "surface": "trace-replay",
            "trace_sha256": trace.canonical_sha256,
            "source_event_ids": [event.event_id for event in trace.events],
            "write_operation_count": len(records),
            "transport_call_count": 1,
            "maintenance_call_count": 0,
            "record_count": len(records),
        }
        return result

    def retrieve(
        self,
        *,
        project_id: str,
        query: str,
        top_k: int,
        token_budget: int,
    ) -> BaselineRetrieval:
        raw = self._invoke(
            "retrieve",
            {"project_id": project_id, "query": query, "top_k": top_k},
        )
        raw_records = raw.get("records")
        if not isinstance(raw_records, list):
            raise Mem0AdapterError("Mem0 retrieve response has no records list")
        records: list[RetrievedMemory] = []
        for row in raw_records:
            if not isinstance(row, dict):
                continue
            memory_id = row.get("id")
            content = row.get("content")
            score = row.get("score")
            if not isinstance(memory_id, str) or not isinstance(content, str):
                continue
            records.append(
                RetrievedMemory(
                    memory_id=memory_id,
                    content=content,
                    score=float(score) if isinstance(score, (int, float)) else None,
                )
            )
        version = raw.get("version")
        return build_retrieval(
            provider=MEM0_PROVIDER_ID,
            provider_version=str(version) if version is not None else None,
            query=query,
            records=records,
            token_budget=token_budget,
        )
