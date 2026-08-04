from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import subprocess
import sys
import tempfile
from typing import Any
from uuid import uuid4

from .models import CaseSpec, OracleSpec, RouteSpec, sha256_text


DEFAULT_DOCKER_IMAGE = "memorixbench:1.4.1"
_ARTIFACT_DIRECTORY = Path("research") / "artifacts"
_DOCKER_SETUP_TIMEOUT_SECONDS = 120
_DOCKER_CLEANUP_TIMEOUT_SECONDS = 60
_CONTAINER_RUNTIME_ENVIRONMENT = (
    "HOME=/runs/home",
    "MEMORIX_DATA_DIR=/runs/memorix-data",
)
_PROVIDER_KEY_ENV = {
    "openrouter": "OPENROUTER_API_KEY",
    "deepseek": "DEEPSEEK_API_KEY",
    "opencode-go": "OPENCODE_API_KEY",
}
_IGNORED_SOURCE_PARTS = {".git", ".memorix", ".venv", "__pycache__", ".pytest_cache"}


class DockerTrialError(RuntimeError):
    """A host-side Docker setup or export failure, never a task outcome."""


@dataclass(frozen=True)
class DockerTrialRequest:
    case_path: Path
    oracle_path: Path
    route_path: Path
    condition: str
    artifact_root: Path
    max_steps: int
    surface_profile: str
    evidence_policy: str
    memorix_timeout_seconds: int = 120
    docker_setup_timeout_seconds: int = _DOCKER_SETUP_TIMEOUT_SECONDS
    image: str = DEFAULT_DOCKER_IMAGE
    docker_binary: str = "docker"


def _repository_root() -> Path:
    return Path(__file__).resolve().parents[4]


def _run(command: list[str], *, timeout_seconds: int, input_text: str | None = None) -> subprocess.CompletedProcess[str]:
    options: dict[str, Any] = {}
    if sys.platform == "win32":
        options["creationflags"] = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    return subprocess.run(
        command,
        input=input_text,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=timeout_seconds,
        check=False,
        **options,
    )


def _clean_detail(completed: subprocess.CompletedProcess[str]) -> str:
    detail = (completed.stderr or completed.stdout).strip().replace("\r", " ").replace("\n", " ")
    # Build systems usually emit the actionable failure at the end, after their
    # layer preamble. Keep the tail while still avoiding giant transient logs.
    return detail[-800:] or f"exit code {completed.returncode}"


def _require_success(command: list[str], *, timeout_seconds: int) -> subprocess.CompletedProcess[str]:
    try:
        completed = _run(command, timeout_seconds=timeout_seconds)
    except subprocess.TimeoutExpired as error:
        command_name = " ".join(error.cmd if isinstance(error.cmd, list) else [str(error.cmd)])
        raise DockerTrialError(
            f"Docker command timed out after {timeout_seconds}s: {command_name}"
        ) from error
    if completed.returncode != 0:
        raise DockerTrialError(f"Docker command failed: {_clean_detail(completed)}")
    return completed


def _validated_artifact_root(value: Path) -> Path:
    root = value.resolve()
    allowed = (_repository_root() / _ARTIFACT_DIRECTORY).resolve()
    if root != allowed and allowed not in root.parents:
        raise ValueError("Docker trial artifacts must stay below research/artifacts in the repository")
    return root


def _require_portable_oracle(oracle: OracleSpec) -> None:
    executable = oracle.command[0]
    if Path(executable).is_absolute() or ":" in executable or "\\" in executable:
        raise ValueError("Docker trials require a portable oracle executable such as python3 or node")


def _copy_source(source: Path, target: Path) -> None:
    shutil.copytree(
        source,
        target,
        ignore=shutil.ignore_patterns(*_IGNORED_SOURCE_PARTS),
    )


def _image_id(docker_binary: str, image: str) -> str:
    completed = _run([docker_binary, "image", "inspect", "--format", "{{.Id}}", image], timeout_seconds=30)
    if completed.returncode != 0:
        raise DockerTrialError(
            f"Docker image {image!r} is unavailable; run memorixbench build-worker-image first"
        )
    image_id = completed.stdout.strip()
    if not image_id:
        raise DockerTrialError("Docker image inspection returned no immutable image ID")
    return image_id


def _provider_key_env(route: RouteSpec) -> str:
    try:
        key_env = _PROVIDER_KEY_ENV[route.provider]
    except KeyError as error:
        raise ValueError(f"Docker runner does not support route provider: {route.provider}") from error
    if not os.environ.get(key_env):
        raise RuntimeError(f"{key_env} is required for a Docker live trial")
    return key_env


def _safe_internal_file(value: object, *, expected_parent: str) -> str:
    candidate = PurePosixPath(str(value))
    expected = PurePosixPath("/runs/artifacts") / expected_parent
    if (
        not candidate.is_absolute()
        or candidate.parent != expected
        or candidate.suffix != ".json"
        or candidate.name in {"", ".", ".."}
    ):
        raise DockerTrialError("container trial returned an unsafe artifact path")
    return str(candidate)


def _extract_summary(stdout: str) -> dict[str, Any] | None:
    try:
        payload = json.loads(stdout)
    except json.JSONDecodeError:
        return None
    return payload if isinstance(payload, dict) else None


def _prepare_runtime_inputs(
    *,
    temporary_root: Path,
    case_path: Path,
    case: CaseSpec,
    oracle_path: Path,
    oracle: OracleSpec,
    route_path: Path,
) -> Path:
    card = temporary_root / "card"
    card.mkdir(parents=True)
    _copy_source(case.source_root, card / case.source_root.name)
    raw_case = json.loads(case_path.read_text(encoding="utf-8"))
    raw_case["source_root"] = case.source_root.name
    if case.source_archive_path is not None:
        archive_name = case.source_archive_path.name
        shutil.copy2(case.source_archive_path, card / archive_name)
        raw_case["source_archive"] = archive_name
    (card / "case.json").write_text(
        json.dumps(raw_case, indent=2, ensure_ascii=True) + "\n",
        encoding="utf-8",
    )
    oracle_target = temporary_root / "oracle"
    shutil.copytree(oracle.oracle_root, oracle_target)
    route_target = temporary_root / "route.json"
    shutil.copy2(route_path, route_target)
    # Loading from the staged copy catches accidental loss of a declared source
    # archive or oracle asset before anything enters the container.
    CaseSpec.load(card / "case.json")
    OracleSpec.load(oracle_target / oracle_path.name)
    RouteSpec.load(route_target)
    return temporary_root


def build_worker_image(
    *,
    image: str = DEFAULT_DOCKER_IMAGE,
    memorix_version: str = "1.4.1",
    base_image: str = "node:22-bookworm-slim",
    docker_binary: str = "docker",
) -> dict[str, str]:
    if not image or any(character.isspace() for character in image):
        raise ValueError("Docker image name must be non-empty and contain no whitespace")
    if not memorix_version or any(character.isspace() for character in memorix_version):
        raise ValueError("Memorix version must be non-empty and contain no whitespace")
    if not base_image or any(character.isspace() for character in base_image):
        raise ValueError("Docker base image must be non-empty and contain no whitespace")
    repository_root = _repository_root()
    dockerfile = repository_root / "research" / "bench" / "Dockerfile"
    if not dockerfile.is_file():
        raise DockerTrialError("MemorixBench Dockerfile is missing")
    completed = _run(
        [
            docker_binary,
            "build",
            "--file",
            str(dockerfile),
            "--tag",
            image,
            "--build-arg",
            f"MEMORIX_VERSION={memorix_version}",
            "--build-arg",
            f"BASE_IMAGE={base_image}",
            str(repository_root / "research" / "bench"),
        ],
        timeout_seconds=1_800,
    )
    if completed.returncode != 0:
        raise DockerTrialError(f"Docker worker image build failed: {_clean_detail(completed)}")
    return {"image": image, "image_id": _image_id(docker_binary, image), "base_image": base_image}


def run_docker_trial(request: DockerTrialRequest) -> dict[str, Any]:
    """Run one sealed live trial inside an ephemeral container and named volume."""
    case_path = request.case_path.resolve()
    oracle_path = request.oracle_path.resolve()
    route_path = request.route_path.resolve()
    case = CaseSpec.load(case_path)
    oracle = OracleSpec.load(oracle_path)
    route = RouteSpec.load(route_path)
    if case.case_tier == "synthetic-engineering-smoke":
        raise ValueError("formal Docker trials require a source-backed case, not a synthetic smoke")
    if request.condition not in {"no-memory", "raw-record", "memorix-native"}:
        raise ValueError("unsupported trial condition")
    if request.surface_profile not in {"native-product", "canonical-information"}:
        raise ValueError("unsupported surface profile")
    if request.evidence_policy not in {"optional", "fixed-index"}:
        raise ValueError("unsupported evidence policy")
    if request.evidence_policy == "fixed-index" and request.surface_profile != "canonical-information":
        raise ValueError("fixed-index policy requires the canonical-information profile")
    if request.max_steps < 1 or request.max_steps > 80:
        raise ValueError("max_steps must be between 1 and 80")
    _require_portable_oracle(oracle)
    artifact_root = _validated_artifact_root(request.artifact_root)
    artifact_root.mkdir(parents=True, exist_ok=True)
    key_env = _provider_key_env(route)
    if request.docker_setup_timeout_seconds < 30 or request.docker_setup_timeout_seconds > 600:
        raise ValueError("docker_setup_timeout_seconds must be between 30 and 600")
    setup_timeout = request.docker_setup_timeout_seconds
    image_id = _image_id(request.docker_binary, request.image)
    run_token = uuid4().hex[:16]
    volume_name = f"memorixbench-{run_token}"
    container_name = f"memorixbench-{run_token}"
    container_created = False
    container_attempted = False
    volume_created = False
    copied_payload: dict[str, Any] | None = None
    copied_receipt: Path | None = None
    copied_evidence: Path | None = None
    try:
        _require_success([request.docker_binary, "volume", "create", volume_name], timeout_seconds=setup_timeout)
        volume_created = True
        container_attempted = True
        _require_success(
            [
                request.docker_binary,
                "create",
                "--name",
                container_name,
                "--mount",
                f"type=volume,source={volume_name},target=/runs",
                "--env",
                _CONTAINER_RUNTIME_ENVIRONMENT[0],
                "--env",
                _CONTAINER_RUNTIME_ENVIRONMENT[1],
                "--workdir",
                "/runner",
                request.image,
                "sleep",
                "infinity",
            ],
            timeout_seconds=setup_timeout,
        )
        container_created = True
        _require_success([request.docker_binary, "start", container_name], timeout_seconds=setup_timeout)
        _require_success(
            [request.docker_binary, "exec", "--user", "root", container_name, "mkdir", "-p", "/input"],
            timeout_seconds=setup_timeout,
        )
        with tempfile.TemporaryDirectory(prefix="docker-input-", dir=artifact_root) as temporary:
            staged = _prepare_runtime_inputs(
                temporary_root=Path(temporary),
                case_path=case_path,
                case=case,
                oracle_path=oracle_path,
                oracle=oracle,
                route_path=route_path,
            )
            _require_success(
                [request.docker_binary, "cp", str(staged / "card"), f"{container_name}:/input"],
                timeout_seconds=180,
            )
            _require_success(
                [request.docker_binary, "cp", str(staged / "oracle"), f"{container_name}:/input"],
                timeout_seconds=60,
            )
            _require_success(
                [request.docker_binary, "cp", str(staged / "route.json"), f"{container_name}:/input/route.json"],
                timeout_seconds=30,
            )
        _require_success(
            [
                request.docker_binary,
                "exec",
                "--user",
                "root",
                container_name,
                "chown",
                "-R",
                "bench:bench",
                "/input/card",
                "/runs",
            ],
            timeout_seconds=60,
        )
        command = [
            request.docker_binary,
            "exec",
            "--user",
            "bench",
            "--workdir",
            "/runner",
            "--env",
            key_env,
            container_name,
            "memorixbench",
            "run-trial",
            "--case",
            "/input/card/case.json",
            "--oracle",
            f"/input/oracle/{oracle_path.name}",
            "--route",
            "/input/route.json",
            "--artifact-root",
            "/runs/artifacts",
            "--condition",
            request.condition,
            "--execution-mode",
            "host",
            "--container-worker",
            "--memorix-cli",
            "memorix",
            "--surface-profile",
            request.surface_profile,
            "--evidence-policy",
            request.evidence_policy,
            "--max-steps",
            str(request.max_steps),
            "--memorix-timeout-seconds",
            str(request.memorix_timeout_seconds),
        ]
        completed = _run(
            command,
            timeout_seconds=max(300, (request.max_steps + 4) * route.provider_timeout_seconds + request.memorix_timeout_seconds * 3),
        )
        summary = _extract_summary(completed.stdout)
        if summary is None:
            raise DockerTrialError(f"container trial did not produce a receipt summary: {_clean_detail(completed)}")
        receipt_internal = _safe_internal_file(summary.get("receipt"), expected_parent="receipts")
        run_id = PurePosixPath(receipt_internal).stem
        evidence_internal = f"/runs/artifacts/evidence-payloads/{run_id}.json"
        receipts = artifact_root / "receipts"
        evidence_payloads = artifact_root / "evidence-payloads"
        receipts.mkdir(parents=True, exist_ok=True)
        evidence_payloads.mkdir(parents=True, exist_ok=True)
        _require_success(
            [request.docker_binary, "cp", f"{container_name}:{receipt_internal}", str(receipts)],
            timeout_seconds=60,
        )
        _require_success(
            [request.docker_binary, "cp", f"{container_name}:{evidence_internal}", str(evidence_payloads)],
            timeout_seconds=60,
        )
        copied_receipt = receipts / f"{run_id}.json"
        copied_evidence = evidence_payloads / f"{run_id}.json"
        copied_payload = json.loads(copied_receipt.read_text(encoding="utf-8"))
        copied_payload["execution_environment"] = {
            "schema_version": "docker-named-volume-v1",
            "mode": "docker-named-volume",
            "docker_image": request.image,
            "docker_image_id": image_id,
            "workspace_storage": "ephemeral-named-volume",
            "source_transfer": "docker-cp-no-bind-mount",
            "credentials_injected_at_runtime": True,
            "volume_name_sha256": sha256_text(volume_name),
            "exported_at": datetime.now(timezone.utc).isoformat(),
        }
        copied_receipt.write_text(
            json.dumps(copied_payload, indent=2, ensure_ascii=True) + "\n",
            encoding="utf-8",
        )
        return {
            "receipt_path": copied_receipt,
            "evidence_path": copied_evidence,
            "payload": copied_payload,
            "container_exit_code": completed.returncode,
        }
    finally:
        # A timed-out `docker create` can still complete in the daemon after the
        # client is killed. The generated name is unique, so best-effort removal
        # is safe even when this process never observed a successful create.
        if container_created or container_attempted:
            try:
                _run(
                    [request.docker_binary, "rm", "--force", container_name],
                    timeout_seconds=_DOCKER_CLEANUP_TIMEOUT_SECONDS,
                )
            except subprocess.TimeoutExpired:
                pass
        if volume_created:
            try:
                _run(
                    [request.docker_binary, "volume", "rm", volume_name],
                    timeout_seconds=_DOCKER_CLEANUP_TIMEOUT_SECONDS,
                )
            except subprocess.TimeoutExpired:
                pass
