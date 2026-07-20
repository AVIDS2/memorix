from __future__ import annotations

from dataclasses import dataclass, field
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import time
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from .baseline import (
    BaselineRetrieval,
    RetrievedMemory,
    build_retrieval,
    canonical_seed_content,
    canonical_seed_id,
    scrubbed_provider_environment,
)
from .schema import CaseManifest


AGENTMEMORY_PROVIDER_ID = "agentmemory-0.9.28-full-local"
PERSISTENCE_SETTLE_SECONDS = 12
ENGINE_PORT_OFFSETS = (0, 1, 2, 6_353, 46_023)


class AgentMemoryAdapterError(RuntimeError):
    """Raised when the pinned full AgentMemory runtime is unavailable."""


def _json_response(response: Any) -> dict[str, Any]:
    raw = response.read().decode("utf-8")
    try:
        value = json.loads(raw)
    except json.JSONDecodeError as error:
        raise AgentMemoryAdapterError("AgentMemory returned non-JSON output") from error
    if not isinstance(value, dict):
        raise AgentMemoryAdapterError("AgentMemory response is not an object")
    return value


def _port_is_available(port: int) -> bool:
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as candidate:
            candidate.bind(("127.0.0.1", port))
            return True
    except OSError:
        return False


@dataclass
class AgentMemoryFullAdapter:
    runtime_root: Path
    data_dir: Path
    artifact_dir: Path
    project_name: str
    port: int = 3111
    lock_path: Path | None = None
    _process: subprocess.Popen[str] | None = field(default=None, init=False)
    _stdout_handle: Any = field(default=None, init=False)
    _stderr_handle: Any = field(default=None, init=False)
    _lease_acquired: bool = field(default=False, init=False)

    @property
    def package_root(self) -> Path:
        return self.runtime_root / "node_modules" / "@agentmemory" / "agentmemory"

    @property
    def entry_path(self) -> Path:
        return self.package_root / "dist" / "cli.mjs"

    @property
    def compose_path(self) -> Path:
        return self.package_root / "docker-compose.yml"

    @property
    def home_dir(self) -> Path:
        return self.data_dir / "home"

    @property
    def base_url(self) -> str:
        return f"http://127.0.0.1:{self.port}"

    @property
    def effective_lock_path(self) -> Path:
        return self.lock_path or self.data_dir.parent / f"agentmemory-{self.port}.lock"

    @property
    def version(self) -> str:
        manifest_path = self.package_root / "package.json"
        try:
            value = json.loads(manifest_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as error:
            raise AgentMemoryAdapterError(
                f"cannot read AgentMemory package manifest: {manifest_path}"
            ) from error
        version = value.get("version") if isinstance(value, dict) else None
        if not isinstance(version, str) or not version.strip():
            raise AgentMemoryAdapterError("AgentMemory package manifest has no version")
        return version.strip()

    def _environment(self) -> dict[str, str]:
        env = scrubbed_provider_environment()
        for key in (
            "ANTHROPIC_BASE_URL",
            "OPENAI_BASE_URL",
            "OPENROUTER_BASE_URL",
            "AGENTMEMORY_SECRET",
            "AGENTMEMORY_AGENT_SCOPE",
            "AGENT_ID",
        ):
            env.pop(key, None)
        env.update({
            "HOME": str(self.home_dir),
            "USERPROFILE": str(self.home_dir),
            "APPDATA": str(self.home_dir / "appdata"),
            "LOCALAPPDATA": str(self.home_dir / "localappdata"),
            "XDG_CONFIG_HOME": str(self.home_dir / "config"),
            "XDG_CACHE_HOME": str(self.home_dir / "cache"),
            "CI": "1",
            "COMPOSE_PROJECT_NAME": self.project_name,
            "AGENTMEMORY_USE_DOCKER": "1",
            "AGENTMEMORY_AUTO_COMPRESS": "false",
            "AGENTMEMORY_INJECT_CONTEXT": "false",
            "AGENTMEMORY_TOOLS": "core",
            "III_REST_PORT": str(self.port),
            "AGENTMEMORY_URL": self.base_url,
        })
        return env

    def _write_artifact(self, name: str, payload: object) -> None:
        self.artifact_dir.mkdir(parents=True, exist_ok=True)
        (self.artifact_dir / name).write_text(
            json.dumps(payload, indent=2),
            encoding="utf-8",
        )

    def _acquire_lease(self) -> None:
        if self._lease_acquired:
            return
        path = self.effective_lock_path
        path.parent.mkdir(parents=True, exist_ok=True)
        try:
            with path.open("x", encoding="utf-8") as handle:
                json.dump(
                    {
                        "pid": os.getpid(),
                        "project_name": self.project_name,
                        "port": self.port,
                    },
                    handle,
                )
        except FileExistsError as error:
            raise AgentMemoryAdapterError(
                f"AgentMemory port lease already exists: {path}"
            ) from error
        self._lease_acquired = True

    def _release_lease(self) -> None:
        if not self._lease_acquired:
            return
        try:
            self.effective_lock_path.unlink(missing_ok=True)
        finally:
            self._lease_acquired = False

    def _request_json(
        self,
        path: str,
        *,
        payload: dict[str, object] | None = None,
        timeout_seconds: float = 10,
    ) -> dict[str, Any]:
        method = "POST" if payload is not None else "GET"
        body = json.dumps(payload).encode("utf-8") if payload is not None else None
        request = Request(
            self.base_url + path,
            data=body,
            method=method,
            headers={"Content-Type": "application/json"} if body else {},
        )
        try:
            with urlopen(request, timeout=timeout_seconds) as response:
                return _json_response(response)
        except HTTPError as error:
            detail = error.read().decode("utf-8", errors="replace")[:500]
            raise AgentMemoryAdapterError(
                f"AgentMemory {method} {path} failed: HTTP {error.code} {detail}"
            ) from error
        except (URLError, TimeoutError) as error:
            raise AgentMemoryAdapterError(
                f"AgentMemory {method} {path} failed: {error}"
            ) from error

    def _wait_for_ready(self, timeout_seconds: int = 45) -> dict[str, Any]:
        deadline = time.monotonic() + timeout_seconds
        latest_error: str | None = None
        while time.monotonic() < deadline:
            if self._process and self._process.poll() is not None:
                raise AgentMemoryAdapterError(
                    "AgentMemory worker exited during startup; see worker logs"
                )
            try:
                return self._request_json("/agentmemory/livez", timeout_seconds=1)
            except AgentMemoryAdapterError as error:
                latest_error = str(error)
                time.sleep(0.5)
        raise AgentMemoryAdapterError(
            f"AgentMemory did not become ready on {self.base_url}: {latest_error}"
        )

    def _wait_for_ports_available(self, timeout_seconds: int = 30) -> None:
        ports = tuple(self.port + offset for offset in ENGINE_PORT_OFFSETS)
        deadline = time.monotonic() + timeout_seconds
        while time.monotonic() < deadline:
            if all(_port_is_available(port) for port in ports):
                return
            time.sleep(0.25)
        occupied = [port for port in ports if not _port_is_available(port)]
        raise AgentMemoryAdapterError(
            "AgentMemory Docker ports did not release: "
            + ", ".join(str(port) for port in occupied)
        )

    def _compose_down(self) -> None:
        docker = shutil.which("docker")
        if not docker:
            raise AgentMemoryAdapterError("docker is required for AgentMemory full runtime")
        completed = subprocess.run(
            [
                docker,
                "compose",
                "--project-name",
                self.project_name,
                "-f",
                str(self.compose_path),
                "down",
            ],
            cwd=self.runtime_root,
            env=self._environment(),
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=90,
        )
        self._write_artifact(
            "docker-down.json",
            {
                "returncode": completed.returncode,
                "stdout": completed.stdout,
                "stderr": completed.stderr,
            },
        )
        if completed.returncode != 0:
            raise AgentMemoryAdapterError(
                "AgentMemory docker compose down failed; see docker-down.json"
            )
        self._wait_for_ports_available()

    def start(self) -> dict[str, Any]:
        if self._process and self._process.poll() is None:
            return self._request_json("/agentmemory/livez")
        if not self.entry_path.is_file() or not self.compose_path.is_file():
            raise AgentMemoryAdapterError(
                f"AgentMemory runtime is incomplete under {self.package_root}"
            )
        node = shutil.which("node")
        if not node:
            raise AgentMemoryAdapterError("node is required for AgentMemory full runtime")
        lease_was_acquired = self._lease_acquired
        self._acquire_lease()
        try:
            if not all(
                _port_is_available(self.port + offset)
                for offset in ENGINE_PORT_OFFSETS
            ):
                raise AgentMemoryAdapterError(
                    f"AgentMemory ports for {self.port} are already bound; runs must be serialized"
                )
            self.artifact_dir.mkdir(parents=True, exist_ok=True)
            self.home_dir.mkdir(parents=True, exist_ok=True)
            self._stdout_handle = (self.artifact_dir / "worker.stdout.log").open(
                "a", encoding="utf-8"
            )
            self._stderr_handle = (self.artifact_dir / "worker.stderr.log").open(
                "a", encoding="utf-8"
            )
            creationflags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
            self._process = subprocess.Popen(
                [node, str(self.entry_path), "--tools", "core", "--port", str(self.port)],
                cwd=self.runtime_root,
                env=self._environment(),
                stdin=subprocess.DEVNULL,
                stdout=self._stdout_handle,
                stderr=self._stderr_handle,
                text=True,
                creationflags=creationflags,
            )
            ready = self._wait_for_ready()
            startup = {
                "provider_id": AGENTMEMORY_PROVIDER_ID,
                "version": self.version,
                "runtime_root": str(self.runtime_root),
                "compose_file": str(self.compose_path),
                "project_name": self.project_name,
                "port": self.port,
                "ready": ready,
                "runtime_environment": {
                    "home": str(self.home_dir),
                    "compose_project_name": self.project_name,
                    "auto_compress": "false",
                    "context_injection": "false",
                    "tools": "core",
                },
            }
            self._write_artifact("startup.json", startup)
            return ready
        except Exception:
            try:
                self.stop()
            except AgentMemoryAdapterError:
                pass
            if not lease_was_acquired:
                self._release_lease()
            raise

    def stop(self) -> None:
        process = self._process
        self._process = None
        try:
            if process and process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=15)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=5)
            self._compose_down()
        finally:
            if self._stdout_handle:
                self._stdout_handle.close()
                self._stdout_handle = None
            if self._stderr_handle:
                self._stderr_handle.close()
                self._stderr_handle = None

    def __enter__(self) -> "AgentMemoryFullAdapter":
        self.start()
        return self

    def __exit__(self, exc_type: object, exc: object, traceback: object) -> None:
        try:
            self.stop()
        finally:
            self._release_lease()

    def _remember(self, *, project_id: str, content: str) -> dict[str, Any]:
        return self._request_json(
            "/agentmemory/remember",
            payload={
                "content": content,
                "type": "fact",
                "project": project_id,
            },
        )

    def _search_raw(
        self,
        *,
        project_id: str,
        query: str,
        limit: int,
    ) -> dict[str, Any]:
        return self._request_json(
            "/agentmemory/search",
            payload={
                "query": query,
                "limit": limit,
                "project": project_id,
                "format": "narrative",
            },
        )

    def preflight(self, *, project_id: str) -> dict[str, Any]:
        marker_project = f"{project_id}-preflight"
        marker = "MemorixBench AgentMemory persistence marker: scoped local retrieval."
        initial_write = self._remember(project_id=marker_project, content=marker)
        initial_search = self._search_raw(
            project_id=marker_project,
            query="persistence marker",
            limit=8,
        )
        foreign_search = self._search_raw(
            project_id=f"{marker_project}-foreign",
            query="persistence marker",
            limit=8,
        )
        # iii's file-backed Docker store acknowledges the request before the
        # async persistence worker has flushed its files. This measured window
        # is a preflight gate, not part of agent wall-clock time.
        time.sleep(PERSISTENCE_SETTLE_SECONDS)
        self.stop()
        self.start()
        restarted_search = self._search_raw(
            project_id=marker_project,
            query="persistence marker",
            limit=8,
        )
        initial_count = _result_count(initial_search)
        foreign_count = _result_count(foreign_search)
        restarted_count = _result_count(restarted_search)
        result = {
            "version": self.version,
            "initial_write": initial_write,
            "initial_result_count": initial_count,
            "foreign_result_count": foreign_count,
            "restarted_result_count": restarted_count,
            "persistence_settle_seconds": PERSISTENCE_SETTLE_SECONDS,
            "auto_compress": False,
            "context_injection": False,
        }
        self._write_artifact("preflight.json", result)
        if initial_count < 1 or restarted_count < 1 or foreign_count != 0:
            raise AgentMemoryAdapterError(
                "AgentMemory preflight failed write/read/restart/project-isolation checks"
            )
        return result

    def seed(self, manifest: CaseManifest, *, project_id: str) -> dict[str, Any]:
        if not manifest.memory_seeds:
            raise AgentMemoryAdapterError(f"case {manifest.case_id} has no memory seeds")
        written: list[dict[str, Any]] = []
        for seed in manifest.memory_seeds:
            written.append(
                {
                    "seed_id": canonical_seed_id(seed),
                    "result": self._remember(
                        project_id=project_id,
                        content=canonical_seed_content(seed),
                    ),
                }
            )
        result = {"seed_count": len(written), "written": written}
        self._write_artifact("seed.json", result)
        return result

    def retrieve(
        self,
        *,
        project_id: str,
        query: str,
        top_k: int,
        token_budget: int,
    ) -> BaselineRetrieval:
        raw = self._search_raw(project_id=project_id, query=query, limit=top_k)
        raw_results = raw.get("results")
        if not isinstance(raw_results, list):
            raise AgentMemoryAdapterError("AgentMemory search response has no results list")
        records: list[RetrievedMemory] = []
        for row in raw_results:
            if not isinstance(row, dict):
                continue
            observation = row.get("observation")
            value = observation if isinstance(observation, dict) else row
            memory_id = value.get("id") or row.get("obsId")
            content = _narrative_content(value)
            score = row.get("score")
            if not isinstance(memory_id, str) or not content:
                continue
            records.append(
                RetrievedMemory(
                    memory_id=memory_id,
                    content=content,
                    score=float(score) if isinstance(score, (int, float)) else None,
                )
            )
        self._write_artifact("retrieve.json", raw)
        return build_retrieval(
            provider=AGENTMEMORY_PROVIDER_ID,
            provider_version=self.version,
            query=query,
            records=records,
            token_budget=token_budget,
        )


def _result_count(payload: dict[str, Any]) -> int:
    results = payload.get("results")
    return len(results) if isinstance(results, list) else 0


def _narrative_content(value: dict[str, Any]) -> str:
    for key in ("narrative", "content", "title"):
        candidate = value.get(key)
        if isinstance(candidate, str) and candidate.strip():
            return candidate.strip()
    facts = value.get("facts")
    if isinstance(facts, list):
        return "\n".join(item for item in facts if isinstance(item, str)).strip()
    return ""
