from __future__ import annotations

from dataclasses import replace
import json

import pytest

from memorixbench.blackbox import (
    BlackBoxError,
    SubjectProtocol,
    run_controller_session,
)


def _protocol() -> SubjectProtocol:
    return SubjectProtocol(
        protocol="stdio-jsonl-v1",
        isolation_profile="microvm-kvm-v1",
        adapter_image="registry.example.invalid/subject@sha256:" + "1" * 64,
        adapter_command=("/adapter/serve",),
        request_schema_sha256="2" * 64,
        response_schema_sha256="3" * 64,
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
        json.dumps({"id": "one", "output": "candidate"}).encode("utf-8") + b"\n",
    ])

    exchanges, receipt = run_controller_session(
        _protocol(),
        transport,
        ({"id": "one", "input": {"payload": "public request"}},),
    )

    assert transport.closed
    assert exchanges[0].response["output"] == "candidate"
    serialized = json.dumps(receipt.public_payload())
    assert "candidate" not in serialized
    assert secret_expected_value not in serialized
    assert receipt.request_count == 1
    assert len(receipt.exchange_sha256) == 64


def test_controller_session_rejects_malformed_or_mismatched_subject_output() -> None:
    transport = FakeTransport([
        b'{"id":"wrong","output":"candidate"}\n',
    ])

    with pytest.raises(BlackBoxError, match="does not match"):
        run_controller_session(
            _protocol(),
            transport,
            ({"id": "one", "input": {}},),
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
        b'{"id":"one","output":"candidate"}\n',
    ])

    with pytest.raises(BlackBoxError, match="request count"):
        run_controller_session(
            _protocol(),
            transport,
            (
                {"id": "one", "input": {}},
                {"id": "two", "input": {}},
                {"id": "three", "input": {}},
                {"id": "four", "input": {}},
            ),
        )

    tiny = replace(_protocol(), max_response_bytes=8)
    with pytest.raises(BlackBoxError, match="response exceeds"):
        run_controller_session(
            tiny,
            transport,
            ({"id": "one", "input": {}},),
        )
