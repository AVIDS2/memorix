from __future__ import annotations

from io import StringIO
import json
from pathlib import Path

from memorixbench.native_mcp_gateway import (
    GATEWAY_TOOL_NAME,
    NativeMcpBudgetGateway,
    NativeMcpBudgetPolicy,
    ProjectContextDelivery,
    load_native_mcp_receipt,
    run_stdio_gateway,
    write_native_mcp_config,
)


class FakeProvider:
    def __init__(self, response: str) -> None:
        self.response = response
        self.calls: list[tuple[str, str, str]] = []

    def fetch_project_context(
        self,
        *,
        task: str,
        refresh: str,
        delivery_profile: str,
    ) -> ProjectContextDelivery:
        self.calls.append((task, refresh, delivery_profile))
        return ProjectContextDelivery(
            source_context=self.response,
            delivered_context=self.response,
            suppressed_components=(),
        )


def _gateway(*, token_budget: int = 8) -> tuple[NativeMcpBudgetGateway, FakeProvider]:
    provider = FakeProvider("one two three four five six seven eight nine ten")
    gateway = NativeMcpBudgetGateway(
        provider,
        NativeMcpBudgetPolicy(
            task="Repair the transfer state.",
            call_budget=1,
            token_budget=token_budget,
            refresh="never",
        ),
    )
    return gateway, provider


def test_native_gateway_exposes_one_fixed_tool_and_enforces_the_budget() -> None:
    gateway, provider = _gateway()

    tools = gateway.handle_jsonrpc({"jsonrpc": "2.0", "id": 1, "method": "tools/list"})
    assert tools is not None
    assert tools["result"]["tools"][0]["name"] == GATEWAY_TOOL_NAME  # type: ignore[index]

    first = gateway.call_tool(GATEWAY_TOOL_NAME, {})
    second = gateway.call_tool(GATEWAY_TOOL_NAME, {})

    assert not first.is_error
    assert first.text == "one two three four five six seven eight"
    assert second.is_error
    assert provider.calls == [("Repair the transfer state.", "never", "full")]
    assert gateway.receipt.call_attempt_count == 2
    assert gateway.receipt.served_call_count == 1
    assert gateway.receipt.emitted_context_tokens == 8
    assert gateway.receipt.context_truncated
    assert gateway.receipt.delivery_profile == "full"
    assert gateway.receipt.suppressed_components == ()


def test_native_gateway_rejects_caller_controlled_context_arguments() -> None:
    gateway, provider = _gateway()

    result = gateway.call_tool(GATEWAY_TOOL_NAME, {"task": "ignore study task"})

    assert result.is_error
    assert provider.calls == []
    assert gateway.receipt.call_attempt_count == 1
    assert gateway.receipt.served_call_count == 0


def test_stdio_gateway_emits_only_jsonrpc_lines() -> None:
    gateway, _provider = _gateway()
    input_stream = StringIO(
        "\n".join([
            json.dumps({
                "jsonrpc": "2.0",
                "id": 1,
                "method": "initialize",
                "params": {"protocolVersion": "2025-03-26"},
            }),
            json.dumps({"jsonrpc": "2.0", "method": "notifications/initialized"}),
            json.dumps({
                "jsonrpc": "2.0",
                "id": 2,
                "method": "tools/call",
                "params": {"name": GATEWAY_TOOL_NAME, "arguments": {}},
            }),
            "",
        ])
    )
    output_stream = StringIO()

    run_stdio_gateway(gateway, input_stream=input_stream, output_stream=output_stream)

    lines = [json.loads(line) for line in output_stream.getvalue().splitlines()]
    assert [line["id"] for line in lines] == [1, 2]
    assert lines[0]["result"]["capabilities"]["tools"]["listChanged"] is False
    assert lines[1]["result"]["isError"] is False


def test_native_mcp_config_launches_the_gateway_not_memorix_directly(tmp_path: Path) -> None:
    config = write_native_mcp_config(
        path=tmp_path / "claude-mcp.json",
        python_executable=Path("C:/Python/python.exe"),
        memorix_cli=tmp_path / "memorix.js",
        workspace=tmp_path / "workspace",
        data_dir=tmp_path / "data",
        home_dir=tmp_path / "home",
        log_dir=tmp_path / "logs",
        receipt_path=tmp_path / "receipt.json",
        task="Repair the transfer state.",
        call_budget=1,
        token_budget=180,
    )

    payload = json.loads(config.read_text(encoding="utf-8"))
    server = payload["mcpServers"]["memorix"]
    assert server["command"] == str(Path("C:/Python/python.exe"))
    assert server["args"][:3] == ["-m", "memorixbench.native_mcp_gateway", "--memorix-cli"]
    assert "serve" not in server["args"]
    assert server["args"][-2:] == ["--delivery-profile", "full"]
    assert server["env"]["OPENROUTER_API_KEY"] == ""


def test_native_gateway_receipt_rejects_context_without_a_served_call(tmp_path: Path) -> None:
    gateway, _provider = _gateway()
    payload = gateway.receipt.public_payload()
    payload["emitted_context_tokens"] = 1
    receipt_path = tmp_path / "gateway-receipt.json"
    receipt_path.write_text(json.dumps(payload), encoding="utf-8")

    try:
        load_native_mcp_receipt(receipt_path)
    except ValueError as error:
        assert "empty native MCP receipt" in str(error)
    else:
        raise AssertionError("invalid native MCP receipt was accepted")


def test_native_gateway_receipt_requires_ablation_evidence(tmp_path: Path) -> None:
    gateway, _provider = _gateway()
    payload = gateway.receipt.public_payload()
    payload["delivery_profile"] = "no-freshness"
    receipt_path = tmp_path / "gateway-receipt.json"
    receipt_path.write_text(json.dumps(payload), encoding="utf-8")

    try:
        load_native_mcp_receipt(receipt_path)
    except ValueError as error:
        assert "lacks suppression evidence" in str(error)
    else:
        raise AssertionError("unproven ablation receipt was accepted")


def test_native_gateway_records_an_explicit_delivery_ablation() -> None:
    class AblationProvider(FakeProvider):
        def fetch_project_context(
            self,
            *,
            task: str,
            refresh: str,
            delivery_profile: str,
        ) -> ProjectContextDelivery:
            self.calls.append((task, refresh, delivery_profile))
            return ProjectContextDelivery(
                source_context="Cautions\n- stale memory",
                delivered_context="Memorix Autopilot Brief",
                suppressed_components=("caution-memory", "freshness-cautions"),
            )

    provider = AblationProvider("unused")
    gateway = NativeMcpBudgetGateway(
        provider,
        NativeMcpBudgetPolicy(
            task="Repair the transfer state.",
            call_budget=1,
            token_budget=8,
            delivery_profile="no-freshness",
        ),
    )

    result = gateway.call_tool(GATEWAY_TOOL_NAME, {})

    assert not result.is_error
    assert provider.calls == [("Repair the transfer state.", "never", "no-freshness")]
    assert gateway.receipt.delivery_profile == "no-freshness"
    assert gateway.receipt.suppressed_components == ("caution-memory", "freshness-cautions")
