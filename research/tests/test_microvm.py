from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

import pytest

from memorixbench.microvm import (
    MICROVM_KVM_PROFILE_ID,
    MicroVMError,
    evaluate_microvm_host,
    require_microvm_host,
)


def _runtime(path: Path, name: str) -> Path:
    binary = path / name
    binary.write_bytes(b"runtime")
    return binary


def test_microvm_preflight_accepts_only_a_kvm_linux_profile(tmp_path: Path) -> None:
    capability = evaluate_microvm_host(
        platform_name="linux",
        architecture="x86_64",
        kvm_device_present=True,
        kvm_device_is_character=True,
        kvm_readable=True,
        kvm_writable=True,
        firecracker_path=_runtime(tmp_path, "firecracker"),
        jailer_path=_runtime(tmp_path, "jailer"),
        checked_at=datetime(2026, 7, 22, tzinfo=timezone.utc),
    )

    assert capability.profile_id == MICROVM_KVM_PROFILE_ID
    assert capability.ready
    assert len(capability.firecracker_sha256 or "") == 64
    require_microvm_host(capability)


def test_microvm_preflight_refuses_a_docker_style_fallback() -> None:
    capability = evaluate_microvm_host(
        platform_name="linux",
        architecture="x86_64",
        kvm_device_present=False,
        kvm_device_is_character=False,
        kvm_readable=False,
        kvm_writable=False,
        firecracker_path=None,
        jailer_path=None,
    )

    assert not capability.ready
    with pytest.raises(MicroVMError, match="/dev/kvm"):
        require_microvm_host(capability)
