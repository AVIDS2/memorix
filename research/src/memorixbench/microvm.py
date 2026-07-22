from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import datetime, timezone
import hashlib
import os
from pathlib import Path
import platform
import shutil
import stat
import subprocess
import sys


MICROVM_KVM_PROFILE_ID = "microvm-kvm-v1"
MICROVM_PREFLIGHT_SCHEMA_VERSION = "0.1"
SUPPORTED_ARCHITECTURES = {"x86_64", "amd64"}


class MicroVMError(ValueError):
    """Raised when the host cannot satisfy the private black-box runtime profile."""


@dataclass(frozen=True)
class MicroVMHostCapability:
    schema_version: str
    profile_id: str
    platform_name: str
    architecture: str
    kvm_device_present: bool
    kvm_device_is_character: bool
    kvm_readable: bool
    kvm_writable: bool
    firecracker_available: bool
    firecracker_sha256: str | None
    jailer_available: bool
    jailer_sha256: str | None
    checked_at: str

    @property
    def ready(self) -> bool:
        return (
            self.schema_version == MICROVM_PREFLIGHT_SCHEMA_VERSION
            and self.profile_id == MICROVM_KVM_PROFILE_ID
            and self.platform_name == "linux"
            and self.architecture in SUPPORTED_ARCHITECTURES
            and self.kvm_device_present
            and self.kvm_device_is_character
            and self.kvm_readable
            and self.kvm_writable
            and self.firecracker_available
            and self.firecracker_sha256 is not None
            and self.jailer_available
            and self.jailer_sha256 is not None
        )

    def public_payload(self) -> dict[str, object]:
        payload = asdict(self)
        payload["ready"] = self.ready
        return payload


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def evaluate_microvm_host(
    *,
    platform_name: str,
    architecture: str,
    kvm_device_present: bool,
    kvm_device_is_character: bool,
    kvm_readable: bool,
    kvm_writable: bool,
    firecracker_path: Path | None,
    jailer_path: Path | None,
    checked_at: datetime | None = None,
) -> MicroVMHostCapability:
    """Turn a host probe into an explicit no-fallback eligibility decision."""

    timestamp = (checked_at or datetime.now(timezone.utc)).astimezone(timezone.utc)
    firecracker_sha256 = _sha256_file(firecracker_path) if firecracker_path and firecracker_path.is_file() else None
    jailer_sha256 = _sha256_file(jailer_path) if jailer_path and jailer_path.is_file() else None
    return MicroVMHostCapability(
        schema_version=MICROVM_PREFLIGHT_SCHEMA_VERSION,
        profile_id=MICROVM_KVM_PROFILE_ID,
        platform_name=platform_name.casefold(),
        architecture=architecture.casefold(),
        kvm_device_present=kvm_device_present,
        kvm_device_is_character=kvm_device_is_character,
        kvm_readable=kvm_readable,
        kvm_writable=kvm_writable,
        firecracker_available=firecracker_sha256 is not None,
        firecracker_sha256=firecracker_sha256,
        jailer_available=jailer_sha256 is not None,
        jailer_sha256=jailer_sha256,
        checked_at=timestamp.isoformat(),
    )


def inspect_microvm_host(
    *,
    firecracker_binary: str = "firecracker",
    jailer_binary: str = "jailer",
) -> MicroVMHostCapability:
    """Inspect the local host without creating a guest or falling back to Docker."""

    kvm = Path("/dev/kvm")
    try:
        details = os.stat(kvm)
        kvm_is_character = stat.S_ISCHR(details.st_mode)
    except OSError:
        kvm_is_character = False
    firecracker = shutil.which(firecracker_binary)
    jailer = shutil.which(jailer_binary)
    return evaluate_microvm_host(
        platform_name=sys.platform,
        architecture=platform.machine(),
        kvm_device_present=kvm.exists(),
        kvm_device_is_character=kvm_is_character,
        kvm_readable=os.access(kvm, os.R_OK),
        kvm_writable=os.access(kvm, os.W_OK),
        firecracker_path=Path(firecracker) if firecracker else None,
        jailer_path=Path(jailer) if jailer else None,
    )


def require_microvm_host(capability: MicroVMHostCapability) -> None:
    """Fail closed when a private grading host lacks the KVM microVM profile."""

    if capability.ready:
        return
    failed = []
    if capability.platform_name != "linux":
        failed.append("linux host")
    if capability.architecture not in SUPPORTED_ARCHITECTURES:
        failed.append("supported architecture")
    if not capability.kvm_device_present:
        failed.append("/dev/kvm")
    elif not capability.kvm_device_is_character:
        failed.append("character /dev/kvm")
    if not capability.kvm_readable or not capability.kvm_writable:
        failed.append("read/write KVM access")
    if not capability.firecracker_available:
        failed.append("Firecracker binary")
    if not capability.jailer_available:
        failed.append("Firecracker jailer binary")
    raise MicroVMError(
        "microVM KVM profile is unavailable: " + ", ".join(failed)
    )


def firecracker_version(binary: str | Path) -> str | None:
    """Return a local runtime version for private attestation, never a public fallback."""

    try:
        completed = subprocess.run(
            [str(binary), "--version"],
            check=False,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=10,
        )
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return None
    if completed.returncode != 0:
        return None
    value = completed.stdout.strip()
    return value or None
