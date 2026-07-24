from __future__ import annotations

from dataclasses import replace
import json
import socket
import threading
import time

import pytest

from memorixbench.blackbox import (
    BlackBoxError,
    ConnectedSocketSubjectTransport,
    SubjectMessageSchemas,
    SubjectProtocol,
    run_controller_session,
)


def _schemas() -> SubjectMessageSchemas:
    return SubjectMessageSchemas(
        request_input_schema={
            "type": "object",
            "properties": {
                "payload": {"type": "string", "maxLength": 128},
                "value": {"type": "string", "maxLength": 128},
            },
            "required": [],
            "additionalProperties": False,
        },
        response_output_schema={
            "type": "object",
            "properties": {
                "accepted": {"type": "boolean"},
                "status": {"type": "string", "maxLength": 64},
            },
            "required": [],
            "additionalProperties": False,
        },
    )


def _protocol(schemas: SubjectMessageSchemas | None = None) -> SubjectProtocol:
    schemas = schemas or _schemas()
    return SubjectProtocol(
        protocol="stdio-jsonl-v1",
        isolation_profile="microvm-kvm-v1",
        adapter_image="registry.example.invalid/subject@sha256:" + "1" * 64,
        adapter_command=("/adapter/serve",),
        request_schema_sha256=schemas.request_schema_sha256,
        response_schema_sha256=schemas.response_schema_sha256,
        max_requests=3,
        max_request_bytes=1024,
        max_response_bytes=1024,
        startup_timeout_seconds=2,
        request_timeout_seconds=2,
        total_timeout_seconds=10,
    )


class FakeTransport:
    def __init__(self, responses: list[bytes]) -> None:
        self.responses = responses
        self.sent: list[bytes] = []
        self.closed = False

    def send_line(self, line: bytes, *, timeout_seconds: float) -> None:
        assert timeout_seconds == 2
        self.sent.append(line)

    def receive_line(self, *, timeout_seconds: float) -> bytes:
        assert timeout_seconds == 2
        return self.responses.pop(0)

    def close(self) -> None:
        self.closed = True


def test_controller_session_keeps_exchange_content_out_of_the_public_receipt() -> None:
    secret_expected_value = "private expected value"
    transport = FakeTransport([
        json.dumps({"id": "one", "output": {"status": "candidate"}}).encode("utf-8") + b"\n",
    ])
    schemas = _schemas()

    exchanges, receipt = run_controller_session(
        _protocol(schemas),
        transport,
        ({"id": "one", "input": {"payload": "public request"}},),
        schemas,
    )

    assert transport.closed
    assert exchanges[0].response["output"] == {"status": "candidate"}
    serialized = json.dumps(receipt.public_payload())
    assert "candidate" not in serialized
    assert secret_expected_value not in serialized
    assert receipt.request_count == 1
    assert receipt.transport_isolation_evidence == "not-attested-by-controller-transport-v1"
    assert len(receipt.exchange_sha256) == 64
    assert len(receipt.exchange_timing_sha256) == 64
    assert receipt.max_exchange_seconds >= 0


def test_controller_session_rejects_malformed_or_mismatched_subject_output() -> None:
    transport = FakeTransport([
        b'{"id":"wrong","output":{"status":"candidate"}}\n',
    ])
    schemas = _schemas()

    with pytest.raises(BlackBoxError, match="does not match"):
        run_controller_session(
            _protocol(schemas),
            transport,
            ({"id": "one", "input": {}},),
            schemas,
        )

    assert transport.closed


def test_subject_protocol_rejects_a_candidate_controlled_adapter_command() -> None:
    unsafe = replace(_protocol(), adapter_command=("/work/run-whatever",))

    with pytest.raises(BlackBoxError, match="outside /work"):
        unsafe.validate()


def test_subject_protocol_rejects_a_docker_or_windows_downgrade() -> None:
    unsafe = replace(_protocol(), isolation_profile="docker-agent-diagnostic-v1")

    with pytest.raises(BlackBoxError, match="KVM microVM"):
        unsafe.validate()


def test_controller_session_enforces_message_and_request_budgets() -> None:
    transport = FakeTransport([
        b'{"id":"one","output":{"status":"candidate"}}\n',
    ])
    schemas = _schemas()

    with pytest.raises(BlackBoxError, match="request count"):
        run_controller_session(
            _protocol(schemas),
            transport,
            (
                {"id": "one", "input": {}},
                {"id": "two", "input": {}},
                {"id": "three", "input": {}},
                {"id": "four", "input": {}},
            ),
            schemas,
        )

    tiny = replace(_protocol(schemas), max_response_bytes=8)
    with pytest.raises(BlackBoxError, match="response exceeds"):
        run_controller_session(
            tiny,
            transport,
            ({"id": "one", "input": {}},),
            schemas,
        )


def test_connected_socket_transport_runs_one_bounded_jsonl_exchange() -> None:
    controller_socket, subject_socket = socket.socketpair()

    def respond() -> None:
        request = subject_socket.recv(1024)
        assert request == b'{"id":"one","input":{"value":"public"}}\n'
        subject_socket.sendall(b'{"id":"one","output":{"accepted":true}}\n')
        subject_socket.close()

    responder = threading.Thread(target=respond)
    responder.start()
    schemas = _schemas()
    exchanges, receipt = run_controller_session(
        _protocol(schemas),
        ConnectedSocketSubjectTransport(controller_socket),
        ({"id": "one", "input": {"value": "public"}},),
        schemas,
    )
    responder.join(timeout=2)

    assert not responder.is_alive()
    assert exchanges[0].response["output"] == {"accepted": True}
    assert receipt.request_count == 1
    assert receipt.response_bytes > 0


def test_connected_socket_transport_refuses_an_unbounded_line() -> None:
    controller_socket, subject_socket = socket.socketpair()
    subject_socket.sendall(b"x" * 9)
    transport = ConnectedSocketSubjectTransport(controller_socket, max_line_bytes=8)

    with pytest.raises(BlackBoxError, match="exceeds"):
        transport.receive_line(timeout_seconds=1)

    transport.close()
    subject_socket.close()


def test_controller_session_rejects_schema_mismatch_and_invalid_subject_values() -> None:
    schemas = _schemas()
    protocol = _protocol(schemas)
    transport = FakeTransport([
        b'{"id":"one","output":{"unexpected":true}}\n',
    ])

    with pytest.raises(BlackBoxError, match="response output object does not match"):
        run_controller_session(
            protocol,
            transport,
            ({"id": "one", "input": {}},),
            schemas,
        )

    with pytest.raises(BlackBoxError, match="request schema does not match"):
        run_controller_session(
            replace(_protocol(schemas), request_schema_sha256="a" * 64),
            FakeTransport([]),
            ({"id": "one", "input": {}},),
            schemas,
        )


def test_controller_session_enforces_total_timeout_across_send_and_receive() -> None:
    class SlowTransport(FakeTransport):
        def send_line(self, line: bytes, *, timeout_seconds: float) -> None:
            self.sent.append(line)
            time.sleep(0.02)

    schemas = _schemas()
    protocol = replace(
        _protocol(schemas),
        startup_timeout_seconds=0.001,
        request_timeout_seconds=1,
        total_timeout_seconds=0.01,
    )
    with pytest.raises(BlackBoxError, match="session timed out"):
        run_controller_session(
            protocol,
            SlowTransport([b'{"id":"one","output":{"status":"candidate"}}\n']),
            ({"id": "one", "input": {}},),
            schemas,
        )
