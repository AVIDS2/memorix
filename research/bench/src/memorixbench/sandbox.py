from __future__ import annotations

from dataclasses import asdict
import os
from pathlib import Path
import subprocess
import sys
from typing import Any

from .models import OracleSpec, ToolEvent, sha256_text


IGNORED_PATH_PARTS = {".git", ".memorix", "__pycache__", ".pytest_cache"}
MAX_READ_BYTES = 32 * 1024
MAX_WRITE_BYTES = 64 * 1024
MAX_LISTED_FILES = 240


class ToolSandbox:
    """Expose a small coding surface without an arbitrary command or host path tool."""

    def __init__(self, root: Path, writable_paths: tuple[str, ...], oracle: OracleSpec):
        self.root = root.resolve()
        self.writable_roots = tuple((self.root / value).resolve() for value in writable_paths)
        self.oracle = oracle
        self.events: list[ToolEvent] = []
        if not self.root.is_dir():
            raise ValueError("workspace root does not exist")
        for candidate in self.writable_roots:
            if candidate != self.root and self.root not in candidate.parents:
                raise ValueError("writable path escapes workspace")

    def _resolve(self, raw_path: str, *, create: bool = False) -> tuple[Path, str]:
        if not isinstance(raw_path, str) or not raw_path or "\0" in raw_path:
            raise ValueError("path must be a non-empty string")
        relative = Path(raw_path)
        if relative.is_absolute() or ".." in relative.parts:
            raise ValueError("path must stay inside the workspace")
        current = self.root
        for part in relative.parts:
            current = current / part
            if current.is_symlink():
                raise ValueError("symbolic links are not permitted")
        candidate = current.resolve(strict=False)
        if candidate != self.root and self.root not in candidate.parents:
            raise ValueError("path must stay inside the workspace")
        if any(part in IGNORED_PATH_PARTS for part in candidate.relative_to(self.root).parts):
            raise ValueError("path is outside the agent-visible workspace")
        if not create and not candidate.exists():
            raise ValueError("path does not exist")
        return candidate, candidate.relative_to(self.root).as_posix()

    def _is_writable(self, candidate: Path) -> bool:
        return any(candidate == allowed or allowed in candidate.parents for allowed in self.writable_roots)

    def list_files(self, arguments: dict[str, Any]) -> dict[str, Any]:
        raw_path = str(arguments.get("path", "."))
        if raw_path == ".":
            candidate, relative = self.root, "."
        else:
            candidate, relative = self._resolve(raw_path)
        if not candidate.is_dir():
            raise ValueError("path is not a directory")
        entries: list[str] = []
        for item in sorted(candidate.rglob("*")):
            if item.is_symlink() or any(part in IGNORED_PATH_PARTS for part in item.relative_to(self.root).parts):
                continue
            if item.is_file():
                entries.append(item.relative_to(self.root).as_posix())
            if len(entries) >= MAX_LISTED_FILES:
                break
        self.events.append(ToolEvent(name="list_files", path=relative, success=True))
        return {"files": entries, "truncated": len(entries) == MAX_LISTED_FILES}

    def read_file(self, arguments: dict[str, Any]) -> dict[str, Any]:
        candidate, relative = self._resolve(str(arguments.get("path", "")))
        if not candidate.is_file():
            raise ValueError("path is not a file")
        payload = candidate.read_bytes()
        if len(payload) > MAX_READ_BYTES:
            raise ValueError("file exceeds the read limit")
        try:
            content = payload.decode("utf-8")
        except UnicodeDecodeError as error:
            raise ValueError("file is not UTF-8 text") from error
        self.events.append(ToolEvent(name="read_file", path=relative, success=True))
        return {"path": relative, "content": content}

    def write_file(self, arguments: dict[str, Any]) -> dict[str, Any]:
        content = arguments.get("content")
        if not isinstance(content, str):
            raise ValueError("content must be a string")
        if len(content.encode("utf-8")) > MAX_WRITE_BYTES:
            raise ValueError("content exceeds the write limit")
        candidate, relative = self._resolve(str(arguments.get("path", "")), create=True)
        if not self._is_writable(candidate):
            raise ValueError("path is not writable in this case")
        candidate.parent.mkdir(parents=True, exist_ok=True)
        candidate.write_text(content, encoding="utf-8", newline="\n")
        self.events.append(
            ToolEvent(
                name="write_file",
                path=relative,
                success=True,
                content_sha256=sha256_text(content),
            )
        )
        return {"path": relative, "written": True}

    def run_verification(self, _arguments: dict[str, Any]) -> dict[str, Any]:
        command = [item.replace("{workspace}", str(self.root)) for item in self.oracle.command]
        environment = os.environ.copy()
        options: dict[str, Any] = {}
        if sys.platform == "win32":
            options["creationflags"] = getattr(subprocess, "CREATE_NO_WINDOW", 0)
        try:
            completed = subprocess.run(
                command,
                cwd=self.root,
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=self.oracle.timeout_seconds,
                env=environment,
                check=False,
                **options,
            )
            passed = completed.returncode == 0
            raw_output = (completed.stdout + completed.stderr).strip()
            output = raw_output[:4000] if self.oracle.reveal_output else ("verification passed" if passed else "verification failed")
            self.events.append(
                ToolEvent(
                    name="run_verification",
                    path=None,
                    success=passed,
                    content_sha256=sha256_text(raw_output),
                    exit_code=completed.returncode,
                )
            )
            return {"passed": passed, "output": output}
        except subprocess.TimeoutExpired:
            self.events.append(ToolEvent(name="run_verification", path=None, success=False))
            return {"passed": False, "output": "verification timed out"}

    def dispatch(self, name: str, arguments: dict[str, Any]) -> dict[str, Any]:
        if name == "list_files":
            return self.list_files(arguments)
        if name == "read_file":
            return self.read_file(arguments)
        if name == "write_file":
            return self.write_file(arguments)
        if name == "run_verification":
            return self.run_verification(arguments)
        raise ValueError("tool is not available")

    def event_payload(self) -> list[dict[str, Any]]:
        return [asdict(event) for event in self.events]
