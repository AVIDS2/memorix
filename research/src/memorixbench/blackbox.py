from __future__ import annotations

from dataclasses import asdict, dataclass
import hashlib
import json
import re
import socket
import time
from typing import Any, Protocol

from .oracle_assets import PINNED_IMAGE_PATTERN


BLACK_BOX_PROTOCOL = "stdio-jsonl-v1"
MICROVM_KVM_PROFILE = "microvm-kvm-v1"
SHA256_PATTERN = re.compile(r"^[0-9a-f]{64}$")
MESSAGE_ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")
SCHEMA_PROPERTY_PATTERN = re.compile(r"^[A-Za-z][A-Za-z0-9_]{0,63}$")
SCHEMA_MAX_DEPTH = 12
SCHEMA_MAX_PROPERTIES = 64
SCHEMA_MAX_ITEMS = 256
SCHEMA_MAX_STRING_LENGTH = 65_536


class BlackBoxError(ValueError):
    """Raised when a controller/subject exchange violates the public contract."""


class SubjectTransport(Protocol):
    """Private controller-side transport; implementations must not expose raw I/O publicly."""

    def send_line(self, line: bytes, *, timeout_seconds: float) -> None: ...

    def receive_line(self, *, timeout_seconds: float) -> bytes: ...

    def close(self) -> None: ...


def _canonical_json_bytes(value: object, *, label: str) -> bytes:
    try:
        return json.dumps(
            value,
            sort_keys=True,
            separators=(",", ":"),
            ensure_ascii=True,
            allow_nan=False,
        ).encode("ascii")
    except (TypeError, ValueError) as error:
        raise BlackBoxError(f"{label} is not canonical JSON") from error


@dataclass(frozen=True)
class SubjectMessageSchemas:
    """Controller-owned schemas for the public subject input/output boundary.

    The supported schema subset is deliberately narrow and non-executable. It
    validates public message shape and size without accepting regexes, refs,
    callbacks, or arbitrary JSON Schema keywords from a case definition.
    """

    request_input_schema: dict[str, Any]
    response_output_schema: dict[str, Any]

    @property
    def request_schema_sha256(self) -> str:
        return hashlib.sha256(
            _canonical_json_bytes(self.request_input_schema, label="request schema")
        ).hexdigest()

    @property
    def response_schema_sha256(self) -> str:
        return hashlib.sha256(
            _canonical_json_bytes(self.response_output_schema, label="response schema")
        ).hexdigest()

    def validate(self) -> None:
        _validate_message_schema(self.request_input_schema, label="request schema")
        _validate_message_schema(self.response_output_schema, label="response schema")

    def require_protocol_binding(self, protocol: SubjectProtocol) -> None:
        self.validate()
        if protocol.request_schema_sha256 != self.request_schema_sha256:
            raise BlackBoxError("black-box request schema does not match the subject protocol")
        if protocol.response_schema_sha256 != self.response_schema_sha256:
            raise BlackBoxError("black-box response schema does not match the subject protocol")


class ConnectedSocketSubjectTransport:
    """JSONL transport over a controller-provided, already-isolated socket.

    This class deliberately does not open a network connection or start a
    subject. A remote KVM runner must establish and attest the connection
    before handing it to the private controller.
    """

    def __init__(self, connection: socket.socket, *, max_line_bytes: int = 1_048_576) -> None:
        if max_line_bytes <= 0:
            raise BlackBoxError("black-box transport line limit must be positive")
        self._connection = connection
        self._max_line_bytes = max_line_bytes
        self._buffer = bytearray()
        self._closed = False

    def _require_open(self) -> None:
        if self._closed:
            raise BlackBoxError("black-box transport is closed")

    def send_line(self, line: bytes, *, timeout_seconds: float) -> None:
        self._require_open()
        if not line.endswith(b"\n") or b"\n" in line[:-1]:
            raise BlackBoxError("black-box transport requires one newline-delimited message")
        if len(line) > self._max_line_bytes:
            raise BlackBoxError("black-box transport message exceeds the byte limit")
        try:
            self._connection.settimeout(timeout_seconds)
            self._connection.sendall(line)
        except (OSError, socket.timeout) as error:
            raise BlackBoxError("black-box transport send failed") from error

    def receive_line(self, *, timeout_seconds: float) -> bytes:
        self._require_open()
        try:
            self._connection.settimeout(timeout_seconds)
            while True:
                delimiter = self._buffer.find(b"\n")
                if delimiter >= 0:
                    line_end = delimiter + 1
                    if line_end > self._max_line_bytes:
                        raise BlackBoxError("black-box transport message exceeds the byte limit")
                    line = bytes(self._buffer[:line_end])
                    del self._buffer[:line_end]
                    return line
                if len(self._buffer) >= self._max_line_bytes:
                    raise BlackBoxError("black-box transport message exceeds the byte limit")
                chunk = self._connection.recv(
                    min(65_536, self._max_line_bytes - len(self._buffer) + 1)
                )
                if not chunk:
                    raise BlackBoxError("black-box transport closed before a response line")
                self._buffer.extend(chunk)
        except (OSError, socket.timeout) as error:
            raise BlackBoxError("black-box transport receive failed") from error

    def close(self) -> None:
        if self._closed:
            return
        self._closed = True
        try:
            self._connection.shutdown(socket.SHUT_RDWR)
        except OSError:
            pass
        self._connection.close()


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


def _schema_int(value: object, *, label: str, minimum: int, maximum: int) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or not minimum <= value <= maximum:
        raise BlackBoxError(f"{label} is invalid")
    return value


def _validate_message_schema(schema: object, *, label: str, depth: int = 0) -> None:
    if depth > SCHEMA_MAX_DEPTH:
        raise BlackBoxError(f"{label} exceeds the schema nesting limit")
    if not isinstance(schema, dict):
        raise BlackBoxError(f"{label} must be an object")
    schema_type = schema.get("type")
    if schema_type == "object":
        expected = {"type", "properties", "required", "additionalProperties"}
        if set(schema) != expected:
            raise BlackBoxError(f"{label} object schema has unsupported fields")
        properties = schema.get("properties")
        required = schema.get("required")
        if not isinstance(properties, dict) or len(properties) > SCHEMA_MAX_PROPERTIES:
            raise BlackBoxError(f"{label} object properties are invalid")
        if not isinstance(required, list) or any(
            not isinstance(name, str) or not SCHEMA_PROPERTY_PATTERN.fullmatch(name)
            for name in required
        ) or len(required) != len(set(required)):
            raise BlackBoxError(f"{label} object required properties are invalid")
        if schema.get("additionalProperties") is not False:
            raise BlackBoxError(f"{label} object schema must forbid additional properties")
        for name, nested in properties.items():
            if not isinstance(name, str) or not SCHEMA_PROPERTY_PATTERN.fullmatch(name):
                raise BlackBoxError(f"{label} object property name is invalid")
            _validate_message_schema(nested, label=f"{label}.{name}", depth=depth + 1)
        if any(name not in properties for name in required):
            raise BlackBoxError(f"{label} object required property is undeclared")
        return
    if schema_type == "array":
        if set(schema) != {"type", "items", "maxItems"}:
            raise BlackBoxError(f"{label} array schema has unsupported fields")
        _schema_int(
            schema.get("maxItems"),
            label=f"{label} array maxItems",
            minimum=0,
            maximum=SCHEMA_MAX_ITEMS,
        )
        _validate_message_schema(schema.get("items"), label=f"{label}[]", depth=depth + 1)
        return
    if schema_type == "string":
        if set(schema) != {"type", "maxLength"}:
            raise BlackBoxError(f"{label} string schema has unsupported fields")
        _schema_int(
            schema.get("maxLength"),
            label=f"{label} string maxLength",
            minimum=0,
            maximum=SCHEMA_MAX_STRING_LENGTH,
        )
        return
    if schema_type == "integer":
        if set(schema) != {"type", "minimum", "maximum"}:
            raise BlackBoxError(f"{label} integer schema has unsupported fields")
        minimum = _schema_int(
            schema.get("minimum"),
            label=f"{label} integer minimum",
            minimum=-(2**53),
            maximum=2**53,
        )
        maximum = _schema_int(
            schema.get("maximum"),
            label=f"{label} integer maximum",
            minimum=-(2**53),
            maximum=2**53,
        )
        if minimum > maximum:
            raise BlackBoxError(f"{label} integer bounds are invalid")
        return
    if schema_type in {"boolean", "null"} and set(schema) == {"type"}:
        return
    raise BlackBoxError(f"{label} has an unsupported schema type")


def _validate_message_value(value: object, schema: dict[str, Any], *, label: str, depth: int = 0) -> None:
    if depth > SCHEMA_MAX_DEPTH:
        raise BlackBoxError(f"{label} exceeds the message nesting limit")
    schema_type = schema["type"]
    if schema_type == "object":
        if not isinstance(value, dict):
            raise BlackBoxError(f"{label} must be an object")
        properties = schema["properties"]
        required = schema["required"]
        if any(name not in properties for name in value) or any(name not in value for name in required):
            raise BlackBoxError(f"{label} object does not match the subject schema")
        for name, nested in properties.items():
            if name in value:
                _validate_message_value(value[name], nested, label=f"{label}.{name}", depth=depth + 1)
        return
    if schema_type == "array":
        if not isinstance(value, list) or len(value) > schema["maxItems"]:
            raise BlackBoxError(f"{label} array does not match the subject schema")
        for index, item in enumerate(value):
            _validate_message_value(item, schema["items"], label=f"{label}[{index}]", depth=depth + 1)
        return
    if schema_type == "string":
        if not isinstance(value, str) or len(value) > schema["maxLength"]:
            raise BlackBoxError(f"{label} string does not match the subject schema")
        return
    if schema_type == "integer":
        if (
            isinstance(value, bool)
            or not isinstance(value, int)
            or value < schema["minimum"]
            or value > schema["maximum"]
        ):
            raise BlackBoxError(f"{label} integer does not match the subject schema")
        return
    if schema_type == "boolean":
        if not isinstance(value, bool):
            raise BlackBoxError(f"{label} boolean does not match the subject schema")
        return
    if value is not None:
        raise BlackBoxError(f"{label} null does not match the subject schema")


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
    transport_isolation_evidence: str
    protocol_sha256: str
    request_count: int
    request_bytes: int
    response_bytes: int
    elapsed_seconds: float
    exchange_sha256: str
    exchange_timing_sha256: str
    max_exchange_seconds: float

    def public_payload(self) -> dict[str, object]:
        return asdict(self)


def _encode_json_line(value: dict[str, Any], *, label: str) -> bytes:
    try:
        encoded = json.dumps(
            value,
            sort_keys=True,
            separators=(",", ":"),
            ensure_ascii=True,
            allow_nan=False,
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


def _reject_json_constant(_value: str) -> object:
    raise ValueError("non-finite JSON constant")


def _decode_response(line: bytes, *, expected_id: str) -> dict[str, Any]:
    if not line.endswith(b"\n"):
        raise BlackBoxError("black-box response must be newline delimited")
    try:
        decoded = json.loads(line[:-1].decode("utf-8"), parse_constant=_reject_json_constant)
    except (UnicodeDecodeError, ValueError, json.JSONDecodeError) as error:
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


def _exchange_timing_hash(exchanges: tuple[PrivateExchange, ...]) -> str:
    payload = [round(exchange.elapsed_seconds, 9) for exchange in exchanges]
    return hashlib.sha256(_canonical_json_bytes(payload, label="black-box exchange timing")).hexdigest()


def run_controller_session(
    protocol: SubjectProtocol,
    transport: SubjectTransport,
    requests: tuple[dict[str, Any], ...],
    schemas: SubjectMessageSchemas,
) -> tuple[tuple[PrivateExchange, ...], BlackBoxSessionReceipt]:
    """Run bounded private controller exchanges without publishing request or response text."""

    protocol.validate()
    schemas.require_protocol_binding(protocol)
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
            _validate_message_value(
                normalized_request["input"],
                schemas.request_input_schema,
                label="black-box request input",
            )
            encoded_request = _encode_json_line(normalized_request, label="black-box request")
            if len(encoded_request) > protocol.max_request_bytes:
                raise BlackBoxError("black-box request exceeds the byte limit")
            exchange_started = time.monotonic()
            remaining_seconds = protocol.total_timeout_seconds - (exchange_started - started)
            if remaining_seconds <= 0:
                raise BlackBoxError("black-box controller session timed out")
            transport.send_line(
                encoded_request,
                timeout_seconds=min(protocol.request_timeout_seconds, remaining_seconds),
            )
            remaining_seconds = protocol.total_timeout_seconds - (time.monotonic() - started)
            if remaining_seconds <= 0:
                raise BlackBoxError("black-box controller session timed out")
            response_line = transport.receive_line(
                timeout_seconds=min(protocol.request_timeout_seconds, remaining_seconds),
            )
            if len(response_line) > protocol.max_response_bytes:
                raise BlackBoxError("black-box response exceeds the byte limit")
            response = _decode_response(response_line, expected_id=request_id)
            _validate_message_value(
                response["output"],
                schemas.response_output_schema,
                label="black-box response output",
            )
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
        transport_isolation_evidence="not-attested-by-controller-transport-v1",
        protocol_sha256=protocol.sha256,
        request_count=len(private_exchanges),
        request_bytes=sum(exchange.request_bytes for exchange in private_exchanges),
        response_bytes=sum(exchange.response_bytes for exchange in private_exchanges),
        elapsed_seconds=time.monotonic() - started,
        exchange_sha256=_exchange_hash(private_exchanges),
        exchange_timing_sha256=_exchange_timing_hash(private_exchanges),
        max_exchange_seconds=max(
            (exchange.elapsed_seconds for exchange in private_exchanges),
            default=0.0,
        ),
    )
    return private_exchanges, receipt
