from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import secrets
import subprocess
import tempfile
import uuid


DOCKER_DIAGNOSTIC_PROFILE_ID = "docker-agent-diagnostic-v1"
DIAGNOSTIC_RECEIPT_SCHEMA_VERSION = "0.1"
WORKSPACE_MOUNT_TARGET = "/workspace"
RUNTIME_CONFIG_MOUNT_TARGET = "/run/memorixbench"
TMPFS_MOUNT_TARGETS = ("/tmp", "/home/agent")
PINNED_IMAGE_PATTERN = re.compile(r"^.+@sha256:[0-9a-f]{64}$")


class IsolationError(ValueError):
    """Raised when a runner cannot prove the required oracle boundary."""


@dataclass(frozen=True)
class DockerDiagnosticSpec:
    image: str
    workspace: Path
    private_oracle_root: Path
    runtime_config_root: Path | None = None
    network_mode: str = "bridge"
    user: str = "1000:1000"
    profile_id: str = DOCKER_DIAGNOSTIC_PROFILE_ID


@dataclass(frozen=True)
class DockerDiagnosticReceipt:
    schema_version: str
    profile_id: str
    image_reference: str
    image_id: str
    docker_server_version: str
    network_mode: str
    user: str
    workspace_mount_target: str
    runtime_config_mount_target: str | None
    read_only_rootfs: bool
    dropped_capabilities: tuple[str, ...]
    security_options: tuple[str, ...]
    private_root_fingerprint: str
    sentinel_fingerprint: str
    inspect_sha256: str
    probe_stdout_sha256: str
    probe_stderr_sha256: str
    probe_stdout_bytes: int
    probe_stderr_bytes: int
    issued_at: str

    @property
    def receipt_sha256(self) -> str:
        payload = json.dumps(asdict(self), sort_keys=True, separators=(",", ":"))
        return hashlib.sha256(payload.encode("utf-8")).hexdigest()

    def public_payload(self) -> dict[str, object]:
        payload = asdict(self)
        payload["receipt_sha256"] = self.receipt_sha256
        return payload


def _sha256_text(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _path_fingerprint(path: Path) -> str:
    return _sha256_text(path.resolve().as_posix())


def _paths_overlap(left: Path, right: Path) -> bool:
    left_resolved = left.resolve()
    right_resolved = right.resolve()
    return (
        left_resolved == right_resolved
        or left_resolved in right_resolved.parents
        or right_resolved in left_resolved.parents
    )


def _mount_argument(source: Path, target: str, *, readonly: bool) -> str:
    options = [
        "type=bind",
        f"source={source.resolve()}",
        f"target={target}",
        "bind-propagation=rprivate",
    ]
    if readonly:
        options.append("readonly")
    return ",".join(options)


def validate_docker_diagnostic_spec(spec: DockerDiagnosticSpec) -> None:
    if spec.profile_id != DOCKER_DIAGNOSTIC_PROFILE_ID:
        raise IsolationError(f"unsupported isolation profile: {spec.profile_id}")
    if not PINNED_IMAGE_PATTERN.fullmatch(spec.image):
        raise IsolationError("Docker isolation images must be pinned by sha256 digest")
    if not spec.workspace.is_dir():
        raise IsolationError("isolation workspace must be an existing directory")
    if not spec.private_oracle_root.is_dir():
        raise IsolationError("private oracle root must be an existing directory")
    if _paths_overlap(spec.workspace, spec.private_oracle_root):
        raise IsolationError("workspace must not overlap the private oracle root")
    if spec.runtime_config_root is not None:
        if not spec.runtime_config_root.is_dir():
            raise IsolationError("runtime config root must be an existing directory")
        if _paths_overlap(spec.runtime_config_root, spec.private_oracle_root):
            raise IsolationError("runtime config must not overlap the private oracle root")
    if spec.network_mode in {"", "host"} or spec.network_mode.startswith("container:"):
        raise IsolationError("agent isolation must not use host or container network mode")
    if not spec.user or spec.user in {"root", "0", "0:0"}:
        raise IsolationError("agent isolation must use a non-root user")


def build_docker_diagnostic_create_command(
    spec: DockerDiagnosticSpec,
    *,
    container_name: str,
    sentinel_name: str,
    docker_binary: str = "docker",
) -> list[str]:
    """Build the exact no-oracle preflight container invocation."""

    validate_docker_diagnostic_spec(spec)
    if not re.fullmatch(r"[a-z0-9][a-z0-9_-]{5,127}", container_name):
        raise IsolationError("invalid Docker preflight container name")
    if not re.fullmatch(r"memorixbench-sentinel-[a-f0-9]{32}", sentinel_name):
        raise IsolationError("invalid Docker preflight sentinel name")
    command = [
        docker_binary,
        "create",
        "--name",
        container_name,
        "--label",
        f"memorixbench.isolation-profile={spec.profile_id}",
        "--workdir",
        WORKSPACE_MOUNT_TARGET,
        "--user",
        spec.user,
        "--network",
        spec.network_mode,
        "--read-only",
        "--cap-drop",
        "ALL",
        "--security-opt",
        "no-new-privileges:true",
        "--pids-limit",
        "512",
        "--mount",
        _mount_argument(spec.workspace, WORKSPACE_MOUNT_TARGET, readonly=False),
        "--tmpfs",
        "/tmp:rw,nosuid,nodev,noexec,size=64m",
        "--tmpfs",
        "/home/agent:rw,nosuid,nodev,size=64m",
        "--env",
        f"MEMORIXBENCH_SENTINEL={sentinel_name}",
    ]
    if spec.runtime_config_root is not None:
        command.extend([
            "--mount",
            _mount_argument(
                spec.runtime_config_root,
                RUNTIME_CONFIG_MOUNT_TARGET,
                readonly=True,
            ),
        ])
    command.extend([
        spec.image,
        "sh",
        "-lc",
        (
            "set -eu; "
            "test ! -e /var/run/docker.sock; "
            "matches=$(find / -xdev -name \"$MEMORIXBENCH_SENTINEL\" "
            "-print -quit 2>/dev/null || true); "
            "test -z \"$matches\""
        ),
    ])
    return command


def _run_docker(
    command: list[str],
    *,
    timeout_seconds: int,
) -> subprocess.CompletedProcess[str]:
    try:
        return subprocess.run(
            command,
            check=False,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=timeout_seconds,
        )
    except FileNotFoundError as error:
        raise IsolationError("Docker CLI is not available") from error
    except subprocess.TimeoutExpired as error:
        raise IsolationError("Docker isolation preflight timed out") from error


def _docker_output(
    command: list[str],
    *,
    timeout_seconds: int,
) -> str:
    completed = _run_docker(command, timeout_seconds=timeout_seconds)
    if completed.returncode != 0:
        message = (completed.stderr or completed.stdout or "Docker command failed").strip()
        raise IsolationError(message)
    return completed.stdout.strip()


def _inspect_container(
    docker_binary: str,
    container_name: str,
    *,
    timeout_seconds: int,
) -> tuple[dict[str, object], str]:
    raw = _docker_output(
        [docker_binary, "inspect", container_name],
        timeout_seconds=timeout_seconds,
    )
    try:
        decoded = json.loads(raw)
    except json.JSONDecodeError as error:
        raise IsolationError("Docker inspect did not return JSON") from error
    if not isinstance(decoded, list) or len(decoded) != 1 or not isinstance(decoded[0], dict):
        raise IsolationError("Docker inspect returned an unexpected container record")
    return decoded[0], raw


def _inspect_mount_source(value: object) -> Path | None:
    if not isinstance(value, str) or not value:
        return None
    return Path(value).resolve()


def validate_container_inspection(
    inspection: dict[str, object],
    spec: DockerDiagnosticSpec,
) -> tuple[str, tuple[str, ...], tuple[str, ...]]:
    """Validate the Docker-level oracle boundary without returning private paths."""

    host_config = inspection.get("HostConfig")
    if not isinstance(host_config, dict):
        raise IsolationError("Docker inspect has no HostConfig")
    if host_config.get("Privileged") is not False:
        raise IsolationError("isolation container must not be privileged")
    if host_config.get("ReadonlyRootfs") is not True:
        raise IsolationError("isolation container root filesystem must be read-only")
    if host_config.get("NetworkMode") != spec.network_mode:
        raise IsolationError("isolation container network mode does not match the profile")
    if host_config.get("PidMode") == "host" or host_config.get("IpcMode") == "host":
        raise IsolationError("isolation container must not join host namespaces")

    cap_drop = tuple(sorted(str(value).upper() for value in host_config.get("CapDrop") or ()))
    if "ALL" not in cap_drop:
        raise IsolationError("isolation container must drop all Linux capabilities")
    security_options = tuple(sorted(str(value) for value in host_config.get("SecurityOpt") or ()))
    if not any(option.startswith("no-new-privileges") for option in security_options):
        raise IsolationError("isolation container must set no-new-privileges")

    config = inspection.get("Config")
    if not isinstance(config, dict) or str(config.get("User") or "") != spec.user:
        raise IsolationError("isolation container user does not match the profile")
    image_id = inspection.get("Image")
    if not isinstance(image_id, str) or not image_id.startswith("sha256:"):
        raise IsolationError("Docker inspect did not expose a pinned image id")

    expected_sources = {spec.workspace.resolve()}
    expected_targets = {WORKSPACE_MOUNT_TARGET, *TMPFS_MOUNT_TARGETS}
    if spec.runtime_config_root is not None:
        expected_sources.add(spec.runtime_config_root.resolve())
        expected_targets.add(RUNTIME_CONFIG_MOUNT_TARGET)
    mounts = inspection.get("Mounts")
    if not isinstance(mounts, list):
        raise IsolationError("Docker inspect has no mount list")
    seen_targets: set[str] = set()
    for mount in mounts:
        if not isinstance(mount, dict):
            raise IsolationError("Docker inspect contains an invalid mount record")
        target = str(mount.get("Destination") or "")
        source = _inspect_mount_source(mount.get("Source"))
        mount_type = str(mount.get("Type") or "")
        seen_targets.add(target)
        if target not in expected_targets:
            raise IsolationError("isolation container has an unexpected mount target")
        if target == WORKSPACE_MOUNT_TARGET and mount.get("RW") is not True:
            raise IsolationError("workspace mount must be writable for the agent")
        if target == RUNTIME_CONFIG_MOUNT_TARGET and mount.get("RW") is not False:
            raise IsolationError("runtime configuration mount must be read-only")
        if target in TMPFS_MOUNT_TARGETS and mount_type != "tmpfs":
            raise IsolationError("temporary agent paths must use tmpfs mounts")
        if source is not None:
            if source not in expected_sources:
                raise IsolationError("isolation container has an unexpected bind source")
            if _paths_overlap(source, spec.private_oracle_root):
                raise IsolationError("private oracle root or parent is mounted into the agent")
            if source.name.lower() == "docker.sock" or target == "/var/run/docker.sock":
                raise IsolationError("Docker socket must not be mounted into the agent")
    if seen_targets != expected_targets:
        raise IsolationError("isolation container mounts do not match the profile")
    return image_id, cap_drop, security_options


def preflight_docker_diagnostic(
    spec: DockerDiagnosticSpec,
    *,
    docker_binary: str = "docker",
    timeout_seconds: int = 60,
) -> DockerDiagnosticReceipt:
    """Exercise local Docker containment without enabling confirmatory trials."""

    validate_docker_diagnostic_spec(spec)
    private_parent = spec.private_oracle_root.resolve().parent
    if not private_parent.is_dir():
        raise IsolationError("private oracle parent must be an existing directory")
    sentinel_name = "memorixbench-sentinel-" + secrets.token_hex(16)
    container_name = "memorixbench-preflight-" + uuid.uuid4().hex
    with tempfile.TemporaryDirectory(prefix=".memorixbench-sentinel-", dir=private_parent) as sentinel_root:
        sentinel_path = Path(sentinel_root) / sentinel_name
        sentinel_path.write_text("private oracle sentinel\n", encoding="utf-8")
        create = _run_docker(
            build_docker_diagnostic_create_command(
                spec,
                container_name=container_name,
                sentinel_name=sentinel_name,
                docker_binary=docker_binary,
            ),
            timeout_seconds=timeout_seconds,
        )
        if create.returncode != 0:
            message = (create.stderr or create.stdout or "Docker create failed").strip()
            raise IsolationError(message)
        try:
            inspection, raw_inspection = _inspect_container(
                docker_binary,
                container_name,
                timeout_seconds=timeout_seconds,
            )
            image_id, cap_drop, security_options = validate_container_inspection(
                inspection,
                spec,
            )
            started = _run_docker(
                [docker_binary, "start", "-a", container_name],
                timeout_seconds=timeout_seconds,
            )
            if started.returncode != 0:
                raise IsolationError("Docker sentinel probe failed")
            docker_server_version = _docker_output(
                [docker_binary, "version", "--format", "{{.Server.Version}}"],
                timeout_seconds=timeout_seconds,
            )
            issued_at = datetime.now(timezone.utc).isoformat()
            return DockerDiagnosticReceipt(
                schema_version=DIAGNOSTIC_RECEIPT_SCHEMA_VERSION,
                profile_id=spec.profile_id,
                image_reference=spec.image,
                image_id=image_id,
                docker_server_version=docker_server_version,
                network_mode=spec.network_mode,
                user=spec.user,
                workspace_mount_target=WORKSPACE_MOUNT_TARGET,
                runtime_config_mount_target=(
                    RUNTIME_CONFIG_MOUNT_TARGET
                    if spec.runtime_config_root is not None
                    else None
                ),
                read_only_rootfs=True,
                dropped_capabilities=cap_drop,
                security_options=security_options,
                private_root_fingerprint=_path_fingerprint(spec.private_oracle_root),
                sentinel_fingerprint=_path_fingerprint(sentinel_path),
                inspect_sha256=_sha256_text(raw_inspection),
                probe_stdout_sha256=_sha256_text(started.stdout),
                probe_stderr_sha256=_sha256_text(started.stderr),
                probe_stdout_bytes=len(started.stdout.encode("utf-8")),
                probe_stderr_bytes=len(started.stderr.encode("utf-8")),
                issued_at=issued_at,
            )
        finally:
            _run_docker(
                [docker_binary, "rm", "-f", container_name],
                timeout_seconds=timeout_seconds,
            )
