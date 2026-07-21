from pathlib import Path

import pytest

from memorixbench.isolation import (
    DOCKER_DIAGNOSTIC_PROFILE_ID,
    DockerDiagnosticReceipt,
    DockerDiagnosticSpec,
    IsolationError,
    build_docker_diagnostic_create_command,
    validate_container_inspection,
    validate_docker_diagnostic_spec,
)


def _image() -> str:
    return "registry.example.invalid/memorix-agent@sha256:" + "a" * 64


def _spec(tmp_path: Path) -> DockerDiagnosticSpec:
    workspace = tmp_path / "workspace"
    private_root = tmp_path / "vault" / "private-oracle"
    config = tmp_path / "runtime-config"
    workspace.mkdir()
    private_root.mkdir(parents=True)
    config.mkdir()
    return DockerDiagnosticSpec(
        image=_image(),
        workspace=workspace,
        private_oracle_root=private_root,
        runtime_config_root=config,
    )


def _inspection(spec: DockerDiagnosticSpec) -> dict[str, object]:
    assert spec.runtime_config_root is not None
    return {
        "HostConfig": {
            "Privileged": False,
            "ReadonlyRootfs": True,
            "NetworkMode": spec.network_mode,
            "PidMode": "",
            "IpcMode": "",
            "CapDrop": ["ALL"],
            "SecurityOpt": ["no-new-privileges:true"],
        },
        "Config": {"User": spec.user},
        "Image": "sha256:" + "b" * 64,
        "Mounts": [
            {
                "Destination": "/workspace",
                "Source": str(spec.workspace.resolve()),
                "Type": "bind",
                "RW": True,
            },
            {"Destination": "/tmp", "Type": "tmpfs", "RW": True},
            {"Destination": "/home/agent", "Type": "tmpfs", "RW": True},
            {
                "Destination": "/run/memorixbench",
                "Source": str(spec.runtime_config_root.resolve()),
                "Type": "bind",
                "RW": False,
            },
        ],
    }


def test_diagnostic_command_never_mounts_the_private_oracle(tmp_path: Path) -> None:
    spec = _spec(tmp_path)

    command = build_docker_diagnostic_create_command(
        spec,
        container_name="memorixbench-preflight-1234567890abcdef",
        sentinel_name="memorixbench-sentinel-0123456789abcdef0123456789abcdef",
    )

    serialized = "\n".join(command)
    assert DOCKER_DIAGNOSTIC_PROFILE_ID in serialized
    assert str(spec.workspace.resolve()) in serialized
    assert str(spec.runtime_config_root.resolve()) in serialized  # type: ignore[union-attr]
    assert str(spec.private_oracle_root.resolve()) not in serialized
    assert "--read-only" in command
    assert "--cap-drop" in command
    assert "no-new-privileges:true" in command


def test_diagnostic_spec_rejects_unpinned_or_overlapping_inputs(tmp_path: Path) -> None:
    spec = _spec(tmp_path)

    with pytest.raises(IsolationError, match="pinned"):
        validate_docker_diagnostic_spec(
            DockerDiagnosticSpec(
                image="registry.example.invalid/memorix-agent:latest",
                workspace=spec.workspace,
                private_oracle_root=spec.private_oracle_root,
            )
        )
    with pytest.raises(IsolationError, match="overlap"):
        validate_docker_diagnostic_spec(
            DockerDiagnosticSpec(
                image=_image(),
                workspace=spec.private_oracle_root.parent,
                private_oracle_root=spec.private_oracle_root,
            )
        )


def test_diagnostic_inspection_rejects_private_parent_mount(tmp_path: Path) -> None:
    spec = _spec(tmp_path)
    inspection = _inspection(spec)
    mounts = inspection["Mounts"]
    assert isinstance(mounts, list)
    mounts[0] = {
        "Destination": "/workspace",
        "Source": str(spec.private_oracle_root.parent.resolve()),
        "Type": "bind",
        "RW": True,
    }

    with pytest.raises(IsolationError, match="unexpected bind source"):
        validate_container_inspection(inspection, spec)


def test_diagnostic_receipt_publishes_only_private_path_fingerprint(tmp_path: Path) -> None:
    spec = _spec(tmp_path)
    receipt = DockerDiagnosticReceipt(
        schema_version="0.1",
        profile_id=DOCKER_DIAGNOSTIC_PROFILE_ID,
        image_reference=spec.image,
        image_id="sha256:" + "c" * 64,
        docker_server_version="29.5.0",
        network_mode="bridge",
        user="1000:1000",
        workspace_mount_target="/workspace",
        runtime_config_mount_target="/run/memorixbench",
        read_only_rootfs=True,
        dropped_capabilities=("ALL",),
        security_options=("no-new-privileges:true",),
        private_root_fingerprint="d" * 64,
        sentinel_fingerprint="e" * 64,
        inspect_sha256="f" * 64,
        probe_stdout_sha256="0" * 64,
        probe_stderr_sha256="1" * 64,
        probe_stdout_bytes=0,
        probe_stderr_bytes=0,
        issued_at="2026-07-21T00:00:00+00:00",
    )

    payload = receipt.public_payload()

    assert str(spec.private_oracle_root.resolve()) not in str(payload)
    assert payload["receipt_sha256"] == receipt.receipt_sha256
