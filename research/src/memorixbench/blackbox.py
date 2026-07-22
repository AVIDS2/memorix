from __future__ import annotations

from dataclasses import asdict, dataclass
import hashlib
import json
import re
import time
from typing import Any, Protocol

from .oracle_assets import PINNED_IMAGE_PATTERN


BLACK_BOX_PROTOCOL = "stdio-jsonl-v1"
MICROVM_KVM_PROFILE = "microvm-kvm-v1"
SHA256_PATTERN = re.compile(r"^[0-9a-f]{64}$")
MESSAGE_ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")


class BlackBoxError(ValueError):
    """Raised when a controller/subject exchange violates the public contract."""


class SubjectTransport(Protocol):
    """Private controller-side transport; implementations must not expose raw I/O publicly."""

    def send_line(self, line: bytes, *, timeout_seconds: float) -> None: ...

    def receive_line(self, *, timeout_seconds: float) -> bytes: ...

    def close(self) -> None: ...


@dataclass(frozen=True)
class SubjectProtocol:
    protocol: str
    isolation_profile: str
    adapter_image: str
    adapter_command: tuple[str, ...]
    request_schema_sha256: str
    response_schema_sha256: str
    max_requests: int
    max_request_bytes: int
    max_response_bytes: int
    startup_timeout_seconds: float
    request_timeout_seconds: float
    total_timeout_seconds: float

    def public_payload(self) -> dict[str, object]:
        payload = asdict(self)
        payload["adapter_command"] = list(self.adapter_command)
        return payload

    @property
    def sha256(self) -> str:
        encoded = json.dumps(
            self.public_payload(),
            sort_keys=True,
            separators=(",", ":"),
            ensure_ascii=True,
        ).encode("ascii")
        return hashlib.sha256(encoded).hexdigest()

    def validate(self) -> None:
        if self.protocol != BLACK_BOX_PROTOCOL:
            raise BlackBoxError("unsupported black-box subject protocol")
        if self.isolation_profile != MICROVM_KVM_PROFILE:
            raise BlackBoxError("black-box subject requires the KVM microVM profile")
        if not PINNED_IMAGE_PATTERN.fullmatch(self.adapter_image):
            raise BlackBoxError("subject adapter image must be pinned by sha256 digest")
        if not self.adapter_command or any(
            not value or "\0" in value or "\r" in value or "\n" in value
            for value in self.adapter_command
        ):
            raise BlackBoxError("subject adapter command is invalid")
        if not self.adapter_command[0].startswith("/adapter/"):
            raise BlackBoxError("subject adapter command must be fixed outside /work")
        for label, value in {
            "request schema": self.request_schema_sha256,
            "response schema": self.response_schema_sha256,
        }.items():
            if not SHA256_PATTERN.fullmatch(value):
                raise BlackBoxError(f"{label} must be a sha256 digest")
        limits = {
            "max requests": self.max_requests,
            "max request bytes": self.max_request_bytes,
            "max response bytes": self.max_response_bytes,
        }
        if any(isinstance(value, bool) or not isinstance(value, int) or value <= 0 for value in limits.values()):
            raise BlackBoxError("black-box integer limits must be positive")
        if self.max_requests > 10_000:
            raise BlackBoxError("black-box max requests exceeds the protocol limit")
        if self.max_request_bytes > 1_048_576 or self.max_response_bytes > 1_048_576:
            raise BlackBoxError("black-box message limit exceeds the protocol limit")
        timeouts = {
            "startup timeout": self.startup_timeout_seconds,
            "request timeout": self.request_timeout_seconds,
            "total timeout": self.total_timeout_seconds,
        }
        if any(not isinstance(value, (int, float)) or isinstance(value, bool) or value <= 0 for value in timeouts.values()):
            raise BlackBoxError("black-box time limits must be positive")
        if self.total_timeout_seconds < self.startup_timeout_seconds:
            raise BlackBoxError("black-box total timeout is shorter than startup timeout")


@dataclass(frozen=True)
class PrivateExchange:
    request_id: str
    request: dict[str, Any]
    response: dict[str, Any]
    request_bytes: int
    response_bytes: int
    elapsed_seconds: float


@dataclass(frozen=True)
class BlackBoxSessionReceipt:
    isolation_profile: str
    protocol_sha256: str
    request_count: int
    request_bytes: int
    response_bytes: int
    elapsed_seconds: float
    exchange_sha256: str

    def public_payload(self) -> dict[str, object]:
        return asdict(self)


def _encode_json_line(value: dict[str, Any], *, label: str) -> bytes:
    try:
        encoded = json.dumps(
            value,
            sort_keys=True,
            separators=(",", ":"),
            ensure_ascii=True,
        ).encode("ascii")
    except (TypeError, ValueError) as error:
        raise BlackBoxError(f"{label} is not JSON serializable") from error
    return encoded + b"\n"


def _require_request(value: object) -> tuple[str, dict[str, Any]]:
    if not isinstance(value, dict) or set(value) != {"id", "input"}:
        raise BlackBoxError("black-box request must contain only id and input")
    request_id = value.get("id")
    if not isinstance(request_id, str) or not MESSAGE_ID_PATTERN.fullmatch(request_id):
        raise BlackBoxError("black-box request id is invalid")
    return request_id, value


def _decode_response(line: bytes, *, expected_id: str) -> dict[str, Any]:
    if not line.endswith(b"\n"):
        raise BlackBoxError("black-box response must be newline delimited")
    try:
        decoded = json.loads(line[:-1].decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise BlackBoxError("black-box response is not valid JSON") from error
    if not isinstance(decoded, dict) or set(decoded) != {"id", "output"}:
        raise BlackBoxError("black-box response must contain only id and output")
    if decoded.get("id") != expected_id:
        raise BlackBoxError("black-box response id does not match the request")
    return decoded


def _exchange_hash(exchanges: tuple[PrivateExchange, ...]) -> str:
    payload = [
        {
            "id": exchange.request_id,
            "request": exchange.request,
            "response": exchange.response,
            "request_bytes": exchange.request_bytes,
            "response_bytes": exchange.response_bytes,
        }
        for exchange in exchanges
    ]
    encoded = json.dumps(
        payload,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=True,
    ).encode("ascii")
    return hashlib.sha256(encoded).hexdigest()


def run_controller_session(
    protocol: SubjectProtocol,
    transport: SubjectTransport,
    requests: tuple[dict[str, Any], ...],
) -> tuple[tuple[PrivateExchange, ...], BlackBoxSessionReceipt]:
    """Run bounded private controller exchanges without publishing request or response text."""

    protocol.validate()
    if len(requests) > protocol.max_requests:
        raise BlackBoxError("black-box request count exceeds the protocol limit")
    started = time.monotonic()
    exchanges: list[PrivateExchange] = []
    seen_ids: set[str] = set()
    try:
        for request in requests:
            if time.monotonic() - started > protocol.total_timeout_seconds:
                raise BlackBoxError("black-box controller session timed out")
            request_id, normalized_request = _require_request(request)
            if request_id in seen_ids:
                raise BlackBoxError("black-box request ids must be unique")
            seen_ids.add(request_id)
            encoded_request = _encode_json_line(normalized_request, label="black-box request")
            if len(encoded_request) > protocol.max_request_bytes:
                raise BlackBoxError("black-box request exceeds the byte limit")
            exchange_started = time.monotonic()
            transport.send_line(encoded_request, timeout_seconds=protocol.request_timeout_seconds)
            response_line = transport.receive_line(timeout_seconds=protocol.request_timeout_seconds)
            if len(response_line) > protocol.max_response_bytes:
                raise BlackBoxError("black-box response exceeds the byte limit")
            response = _decode_response(response_line, expected_id=request_id)
            exchanges.append(
                PrivateExchange(
                    request_id=request_id,
                    request=normalized_request,
                    response=response,
                    request_bytes=len(encoded_request),
                    response_bytes=len(response_line),
                    elapsed_seconds=time.monotonic() - exchange_started,
                )
            )
    finally:
        transport.close()
    private_exchanges = tuple(exchanges)
    receipt = BlackBoxSessionReceipt(
        isolation_profile=protocol.isolation_profile,
        protocol_sha256=protocol.sha256,
        request_count=len(private_exchanges),
        request_bytes=sum(exchange.request_bytes for exchange in private_exchanges),
        response_bytes=sum(exchange.response_bytes for exchange in private_exchanges),
        elapsed_seconds=time.monotonic() - started,
        exchange_sha256=_exchange_hash(private_exchanges),
    )
    return private_exchanges, receipt
