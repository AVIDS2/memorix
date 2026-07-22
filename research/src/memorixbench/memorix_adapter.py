from __future__ import annotations

from dataclasses import dataclass
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import socket
import subprocess
import time
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen

from .baseline import BaselineRetrieval, RetrievedMemory, build_retrieval
from .schema import CaseManifest
from .trace import PrecursorTrace


PROVIDER_ENV_KEYS = (
    "MEMORIX_LLM_PROVIDER",
    "MEMORIX_LLM_MODEL",
    "MEMORIX_LLM_BASE_URL",
    "MEMORIX_LLM_API_KEY",
    "MEMORIX_API_KEY",
    "MEMORIX_EMBEDDING_API_KEY",
    "MEMORIX_EMBEDDING_MODEL",
    "MEMORIX_EMBEDDING_BASE_URL",
    "MEMORIX_EMBEDDING_DIMENSIONS",
    "OPENAI_API_KEY",
    "ANTHROPIC_API_KEY",
    "OPENROUTER_API_KEY",
)
MEMORIX_CANONICAL_PROVIDER_ID = "memorix-1.2.1-canonical-local"
TYPED_OBSERVATION_REF_PATTERN = re.compile(r"\|\s*(obs:[0-9]+(?:@[^\s|]+)?)\s*\|")


def _isolated_process_env(provider_env: dict[str, str] | None = None) -> dict[str, str]:
    env = os.environ.copy()
    for key in PROVIDER_ENV_KEYS:
        env.pop(key, None)
    if provider_env:
        env.update(provider_env)
    return env


def _isolated_mcp_env(provider_env: dict[str, str] | None = None) -> dict[str, str]:
    env = {key: "" for key in PROVIDER_ENV_KEYS}
    if provider_env:
        env.update(provider_env)
    return env


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def _parse_mcp_body(body: str) -> dict[str, Any]:
    stripped = body.strip()
    if not stripped:
        return {}
    if stripped.startswith("{"):
        value = json.loads(stripped)
        if not isinstance(value, dict):
            raise ValueError("MCP response must be a JSON object")
        return value
    messages: list[dict[str, Any]] = []
    for line in body.splitlines():
        if not line.startswith("data:"):
            continue
        payload = line[5:].strip()
        if not payload or payload == "[DONE]":
            continue
        value = json.loads(payload)
        if isinstance(value, dict):
            messages.append(value)
    if not messages:
        raise ValueError("MCP response contained no JSON data event")
    return messages[-1]


class HttpMcpClient:
    def __init__(self, endpoint: str) -> None:
        self.endpoint = endpoint
        self.session_id: str | None = None
        self._request_id = 0

    def _post(self, payload: dict[str, Any]) -> dict[str, Any]:
        headers = {
            "Content-Type": "application/json",
            "Accept": "application/json, text/event-stream",
        }
        if self.session_id:
            headers["mcp-session-id"] = self.session_id
        request = Request(
            self.endpoint,
            data=json.dumps(payload).encode("utf-8"),
            headers=headers,
            method="POST",
        )
        with urlopen(request, timeout=30) as response:
            session = response.headers.get("mcp-session-id")
            if session:
                self.session_id = session
            return _parse_mcp_body(response.read().decode("utf-8"))

    def request(self, method: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
        self._request_id += 1
        payload: dict[str, Any] = {
            "jsonrpc": "2.0",
            "id": self._request_id,
            "method": method,
        }
        if params is not None:
            payload["params"] = params
        response = self._post(payload)
        if "error" in response:
            raise RuntimeError(f"MCP {method} failed: {response['error']}")
        return response.get("result", {})

    def notify(self, method: str, params: dict[str, Any] | None = None) -> None:
        payload: dict[str, Any] = {"jsonrpc": "2.0", "method": method}
        if params is not None:
            payload["params"] = params
        self._post(payload)

    def initialize(self) -> None:
        self.request(
            "initialize",
            {
                "protocolVersion": "2025-03-26",
                "capabilities": {},
                "clientInfo": {"name": "memorixbench", "version": "0.1.0"},
            },
        )
        if not self.session_id:
            raise RuntimeError("MCP initialize returned no session id")
        self.notify("notifications/initialized")

    def call_tool(self, name: str, arguments: dict[str, Any]) -> dict[str, Any]:
        return self.request(
            "tools/call",
            {"name": name, "arguments": arguments},
        )


def _tool_text(result: dict[str, Any]) -> str:
    content = result.get("content")
    if not isinstance(content, list):
        raise ValueError("MCP tool result has no content array")
    for item in content:
        if isinstance(item, dict) and item.get("type") == "text":
            return str(item.get("text", ""))
    raise ValueError("MCP tool result has no text content")


def _tool_json(result: dict[str, Any]) -> dict[str, Any]:
    structured = result.get("structuredContent")
    if isinstance(structured, dict):
        return structured
    text = _tool_text(result)
    value = json.loads(text)
    if not isinstance(value, dict):
        raise ValueError("MCP tool text must contain a JSON object")
    return value


@dataclass
class MemorixControlPlane:
    cli_path: Path
    workspace: Path
    data_dir: Path
    home_dir: Path
    log_dir: Path
    mode: str = "full"
    provider_env: dict[str, str] | None = None

    def __post_init__(self) -> None:
        self.port = _free_port()
        self.process: subprocess.Popen[str] | None = None
        self.client: HttpMcpClient | None = None
        self._stdout_handle = None
        self._stderr_handle = None

    @property
    def base_url(self) -> str:
        return f"http://127.0.0.1:{self.port}"

    def __enter__(self) -> "MemorixControlPlane":
        node = shutil.which("node")
        if not node:
            raise FileNotFoundError("node is required for Memorix control plane")
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.home_dir.mkdir(parents=True, exist_ok=True)
        self.log_dir.mkdir(parents=True, exist_ok=True)
        self._stdout_handle = (self.log_dir / "control-plane.stdout.log").open(
            "w", encoding="utf-8"
        )
        self._stderr_handle = (self.log_dir / "control-plane.stderr.log").open(
            "w", encoding="utf-8"
        )
        env = _isolated_process_env(self.provider_env)
        env.update({
            "MEMORIX_DATA_DIR": str(self.data_dir),
            "MEMORIX_EMBEDDING": "off",
            "HOME": str(self.home_dir),
            "USERPROFILE": str(self.home_dir),
        })
        creationflags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
        self.process = subprocess.Popen(
            [
                node,
                str(self.cli_path),
                "serve-http",
                "--port",
                str(self.port),
                "--host",
                "127.0.0.1",
                "--cwd",
                str(self.workspace),
                "--mode",
                self.mode,
            ],
            cwd=self.workspace,
            env=env,
            stdout=self._stdout_handle,
            stderr=self._stderr_handle,
            text=True,
            creationflags=creationflags,
        )
        deadline = time.monotonic() + 30
        while time.monotonic() < deadline:
            if self.process.poll() is not None:
                raise RuntimeError("Memorix control plane exited during startup")
            try:
                with urlopen(self.base_url + "/health", timeout=1):
                    break
            except HTTPError:
                break
            except (URLError, TimeoutError):
                time.sleep(0.25)
        else:
            raise TimeoutError("Memorix control plane did not become ready")
        self.client = HttpMcpClient(self.base_url + "/mcp")
        self.client.initialize()
        return self

    def __exit__(self, exc_type: object, exc: object, traceback: object) -> None:
        if self.process and self.process.poll() is None:
            self.process.terminate()
            try:
                self.process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                self.process.kill()
                self.process.wait(timeout=5)
        if self._stdout_handle:
            self._stdout_handle.close()
        if self._stderr_handle:
            self._stderr_handle.close()

    def tool(self, name: str, arguments: dict[str, Any]) -> dict[str, Any]:
        if not self.client:
            raise RuntimeError("control plane is not initialized")
        return self.client.call_tool(name, arguments)

    def poll_maintenance(self, project_id: str, *, timeout_seconds: int = 45) -> dict[str, Any]:
        deadline = time.monotonic() + timeout_seconds
        latest: dict[str, Any] = {}
        poll_count = 0
        while time.monotonic() < deadline:
            url = self.base_url + "/api/maintenance?project=" + quote(project_id, safe="")
            with urlopen(url, timeout=5) as response:
                value = json.loads(response.read().decode("utf-8"))
            poll_count += 1
            if isinstance(value, dict):
                latest = value
                summary = value.get("summary")
                if isinstance(summary, dict) and all(
                    int(summary.get(key, 0)) == 0
                    for key in ("pending", "running", "retrying")
                ):
                    return {**latest, "poll_count": poll_count}
            time.sleep(0.5)
        raise TimeoutError(f"Memorix maintenance did not drain: {latest}")


def write_claude_mcp_config(
    *,
    path: Path,
    cli_path: Path,
    workspace: Path,
    data_dir: Path,
    home_dir: Path,
    provider_env: dict[str, str] | None = None,
    mode: str = "full",
) -> Path:
    node = shutil.which("node")
    if not node:
        raise FileNotFoundError("node is required for Memorix MCP")
    server_env = _isolated_mcp_env(provider_env)
    server_env.update({
        "MEMORIX_DATA_DIR": str(data_dir),
        "MEMORIX_EMBEDDING": "off",
        "HOME": str(home_dir),
        "USERPROFILE": str(home_dir),
    })
    payload = {
        "mcpServers": {
            "memorix": {
                "command": node,
                "args": [
                    str(cli_path),
                    "serve",
                    "--cwd",
                    str(workspace),
                    "--mode",
                    mode,
                ],
                "env": server_env,
            }
        }
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    return path


def seed_memorix_canonical_evidence(
    *,
    manifest: CaseManifest,
    workspace: Path,
    cli_path: Path,
    data_dir: Path,
    home_dir: Path,
    artifact_dir: Path,
    provider_env: dict[str, str] | None = None,
    mode: str = "full",
) -> dict[str, Any]:
    with MemorixControlPlane(
        cli_path=cli_path,
        workspace=workspace,
        data_dir=data_dir,
        home_dir=home_dir,
        log_dir=artifact_dir / "seed-control-plane",
        mode=mode,
        provider_env=provider_env,
    ) as control:
        initial = _tool_json(control.tool("memorix_project_context", {
            "task": manifest.precursor.task,
            "format": "json",
            "refresh": "always",
        }))
        project_id = str(initial["project"]["id"])
        if not manifest.memory_seeds:
            raise ValueError(f"case {manifest.case_id} has no memory_seed entries")
        stored: list[dict[str, Any]] = []
        for seed in manifest.memory_seeds:
            arguments: dict[str, Any] = {
                "entityName": seed.entity_name,
                "type": seed.type,
                "title": seed.title,
                "narrative": seed.narrative,
                "facts": list(seed.facts),
                "filesModified": list(seed.files_modified),
                "concepts": list(seed.concepts),
                "relatedEntities": list(seed.related_entities),
            }
            if seed.topic_key:
                arguments["topicKey"] = seed.topic_key
            stored.append(control.tool("memorix_store", arguments))
        maintenance = control.poll_maintenance(project_id)
    result = {
        "project_id": project_id,
        "initial_context": initial,
        "stored": stored,
        "maintenance": maintenance,
        "formation_receipt": {
            "surface": "seeded-canonical",
            "input_record_ids": [seed.topic_key or seed.entity_name for seed in manifest.memory_seeds],
            "setup_call_count": 1,
            "write_operation_count": len(stored),
            "transport_call_count": 1 + len(stored) + int(maintenance.get("poll_count", 0)),
            "maintenance_call_count": int(maintenance.get("poll_count", 0)),
            "record_count": len(stored),
        },
    }
    artifact_dir.mkdir(parents=True, exist_ok=True)
    (artifact_dir / "seed.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
    return result


def ingest_memorix_trace(
    *,
    trace: PrecursorTrace,
    workspace: Path,
    cli_path: Path,
    data_dir: Path,
    home_dir: Path,
    artifact_dir: Path,
    provider_env: dict[str, str] | None = None,
    mode: str = "full",
) -> dict[str, Any]:
    """Replay a normalized public precursor trace through Memorix MCP writes."""

    with MemorixControlPlane(
        cli_path=cli_path,
        workspace=workspace,
        data_dir=data_dir,
        home_dir=home_dir,
        log_dir=artifact_dir / "trace-seed-control-plane",
        mode=mode,
        provider_env=provider_env,
    ) as control:
        initial = _tool_json(control.tool("memorix_project_context", {
            "task": "Replay the precursor session for benchmark formation.",
            "format": "json",
            "refresh": "never",
        }))
        project_id = str(initial["project"]["id"])
        stored = []
        for event in trace.events:
            stored.append(control.tool("memorix_store", {
                "entityName": f"trace:{event.event_id}",
                "type": "session-event",
                "title": f"Precursor {event.role} event",
                "narrative": event.replay_content(),
                "facts": [],
                "filesModified": [],
                "concepts": ["benchmark-trace", event.kind],
                "topicKey": f"benchmark-trace/{trace.case_id}/{event.event_id}",
            }))
        maintenance = control.poll_maintenance(project_id)
    result = {
        "project_id": project_id,
        "trace_sha256": trace.canonical_sha256,
        "event_count": len(trace.events),
        "initial_context": initial,
        "stored": stored,
        "maintenance": maintenance,
        "formation_receipt": {
            "surface": "trace-replay",
            "trace_sha256": trace.canonical_sha256,
            "source_event_ids": [event.event_id for event in trace.events],
            "setup_call_count": 1,
            "write_operation_count": len(stored),
            "transport_call_count": 1 + len(stored) + int(maintenance.get("poll_count", 0)),
            "maintenance_call_count": int(maintenance.get("poll_count", 0)),
            "record_count": len(stored),
        },
    }
    artifact_dir.mkdir(parents=True, exist_ok=True)
    (artifact_dir / "trace-seed.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
    return result


def refresh_memorix_project(
    *,
    manifest: CaseManifest,
    workspace: Path,
    cli_path: Path,
    data_dir: Path,
    home_dir: Path,
    artifact_dir: Path,
    project_id: str,
    provider_env: dict[str, str] | None = None,
    mode: str = "full",
) -> dict[str, Any]:
    with MemorixControlPlane(
        cli_path=cli_path,
        workspace=workspace,
        data_dir=data_dir,
        home_dir=home_dir,
        log_dir=artifact_dir / "refresh-control-plane",
        mode=mode,
        provider_env=provider_env,
    ) as control:
        refreshed = _tool_json(control.tool("memorix_project_context", {
            "task": manifest.transfer.task,
            "format": "json",
            "refresh": "always",
        }))
        maintenance = control.poll_maintenance(project_id)
        final = _tool_json(control.tool("memorix_project_context", {
            "task": manifest.transfer.task,
            "format": "json",
            "refresh": "never",
        }))
    result = {"refreshed": refreshed, "maintenance": maintenance, "final": final}
    artifact_dir.mkdir(parents=True, exist_ok=True)
    (artifact_dir / "context.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
    return result


@dataclass(frozen=True)
class MemorixCanonicalRetrieval:
    retrieval: BaselineRetrieval
    candidate_refs: tuple[str, ...]
    transport_call_count: int


def _typed_observation_refs(text: str, *, limit: int) -> tuple[str, ...]:
    refs: list[str] = []
    for match in TYPED_OBSERVATION_REF_PATTERN.finditer(text):
        ref = match.group(1)
        if ref not in refs:
            refs.append(ref)
        if len(refs) >= limit:
            break
    return tuple(refs)


def retrieve_memorix_canonical(
    *,
    workspace: Path,
    cli_path: Path,
    data_dir: Path,
    home_dir: Path,
    artifact_dir: Path,
    query: str,
    top_k: int,
    token_budget: int,
) -> MemorixCanonicalRetrieval:
    """Run one logical Memorix retrieval round through compact search then bulk detail."""

    if top_k <= 0 or token_budget <= 0:
        raise ValueError("Memorix canonical retrieval limits must be positive")
    with MemorixControlPlane(
        cli_path=cli_path,
        workspace=workspace,
        data_dir=data_dir,
        home_dir=home_dir,
        log_dir=artifact_dir / "canonical-retrieval-control-plane",
        mode="micro",
    ) as control:
        search_text = _tool_text(control.tool("memorix_search", {
            "query": query,
            "limit": top_k,
            "maxTokens": 0,
            "scope": "project",
            "status": "active",
        }))
        refs = _typed_observation_refs(search_text, limit=top_k)
        detail_text = ""
        transport_call_count = 1
        if refs:
            detail_text = _tool_text(control.tool("memorix_detail", {"typedRefs": list(refs)}))
            transport_call_count += 1
    records = (
        (RetrievedMemory(memory_id="|".join(refs), content=detail_text),)
        if detail_text.strip()
        else ()
    )
    retrieval = build_retrieval(
        provider=MEMORIX_CANONICAL_PROVIDER_ID,
        provider_version=None,
        query=query,
        records=records,
        token_budget=token_budget,
        retrieval_call_count=1,
        retrieval_round_count=1,
    )
    result = {
        "provider": MEMORIX_CANONICAL_PROVIDER_ID,
        "query_sha256": hashlib.sha256(query.encode("utf-8")).hexdigest(),
        "candidate_refs": list(refs),
        "search_sha256": hashlib.sha256(search_text.encode("utf-8")).hexdigest(),
        "detail_sha256": hashlib.sha256(detail_text.encode("utf-8")).hexdigest(),
        "transport_call_count": transport_call_count,
        "logical_retrieval_call_count": retrieval.retrieval_call_count,
        "token_budget": retrieval.token_budget,
        "token_count": retrieval.token_count,
        "truncated": retrieval.truncated,
    }
    artifact_dir.mkdir(parents=True, exist_ok=True)
    (artifact_dir / "canonical-retrieval.json").write_text(
        json.dumps(result, indent=2),
        encoding="utf-8",
    )
    return MemorixCanonicalRetrieval(
        retrieval=retrieval,
        candidate_refs=refs,
        transport_call_count=transport_call_count,
    )
