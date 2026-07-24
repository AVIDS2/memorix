from __future__ import annotations

import argparse
from dataclasses import asdict, dataclass
import hashlib
import json
from pathlib import Path
import sys
from typing import Any, Protocol, TextIO

from .baseline import token_count, truncate_to_tokens
from .memorix_adapter import MemorixControlPlane, _isolated_mcp_env, _tool_text


GATEWAY_SCHEMA_VERSION = "0.2"
GATEWAY_TOOL_NAME = "memorix_project_context"
GATEWAY_SERVER_NAME = "memorixbench-native-budget-gateway"
SUPPORTED_MCP_PROTOCOL_VERSIONS = {"2025-03-26", "2025-06-18", "2025-11-25"}
SHA256_PATTERN = "0123456789abcdef"
DELIVERY_PROFILES = frozenset({
    "full",
    "no-freshness",
    "no-current-state",
    "no-semantic-code",
    "no-knowledge",
    "no-workflow",
})


class NativeMcpGatewayError(ValueError):
    """Raised when a native MCP research gateway violates its fixed budget."""


@dataclass(frozen=True)
class ProjectContextDelivery:
    """Full source context plus the one profile-safe prompt sent to the agent."""

    source_context: str
    delivered_context: str
    suppressed_components: tuple[str, ...]


class ProjectContextProvider(Protocol):
    def fetch_project_context(
        self,
        *,
        task: str,
        refresh: str,
        delivery_profile: str,
    ) -> ProjectContextDelivery: ...


@dataclass(frozen=True)
class NativeMcpBudgetPolicy:
    task: str
    call_budget: int
    token_budget: int
    refresh: str = "never"
    delivery_profile: str = "full"

    def validate(self) -> None:
        if not self.task.strip():
            raise NativeMcpGatewayError("native MCP gateway task must be non-empty")
        if isinstance(self.call_budget, bool) or not isinstance(self.call_budget, int) or self.call_budget <= 0:
            raise NativeMcpGatewayError("native MCP gateway call budget must be positive")
        if isinstance(self.token_budget, bool) or not isinstance(self.token_budget, int) or self.token_budget <= 0:
            raise NativeMcpGatewayError("native MCP gateway token budget must be positive")
        if self.refresh not in {"never", "auto"}:
            raise NativeMcpGatewayError("native MCP gateway refresh policy is invalid")
        if self.delivery_profile not in DELIVERY_PROFILES:
            raise NativeMcpGatewayError("native MCP gateway delivery profile is invalid")

    def public_payload(self) -> dict[str, object]:
        self.validate()
        return {
            "schema_version": GATEWAY_SCHEMA_VERSION,
            "tool_name": GATEWAY_TOOL_NAME,
            "task_sha256": hashlib.sha256(self.task.encode("utf-8")).hexdigest(),
            "call_budget": self.call_budget,
            "token_budget": self.token_budget,
            "refresh": self.refresh,
            "delivery_profile": self.delivery_profile,
        }

    @property
    def sha256(self) -> str:
        encoded = json.dumps(
            self.public_payload(),
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")
        return hashlib.sha256(encoded).hexdigest()


@dataclass(frozen=True)
class NativeMcpGatewayReceipt:
    schema_version: str
    policy_sha256: str
    delivery_profile: str
    suppressed_components: tuple[str, ...]
    call_attempt_count: int
    served_call_count: int
    provider_failure_count: int
    emitted_context_sha256: str | None
    source_context_sha256: str | None
    source_context_tokens: int | None
    emitted_context_tokens: int | None
    context_truncated: bool | None

    def public_payload(self) -> dict[str, object]:
        return asdict(self)

    @classmethod
    def from_public_payload(cls, value: object) -> NativeMcpGatewayReceipt:
        if not isinstance(value, dict):
            raise NativeMcpGatewayError("native MCP gateway receipt must be an object")
        expected = {
            "schema_version",
            "policy_sha256",
            "delivery_profile",
            "suppressed_components",
            "call_attempt_count",
            "served_call_count",
            "provider_failure_count",
            "emitted_context_sha256",
            "source_context_sha256",
            "source_context_tokens",
            "emitted_context_tokens",
            "context_truncated",
        }
        if set(value) != expected:
            raise NativeMcpGatewayError("native MCP gateway receipt has unexpected fields")
        if value.get("schema_version") != GATEWAY_SCHEMA_VERSION:
            raise NativeMcpGatewayError("unsupported native MCP gateway receipt schema")
        delivery_profile = value.get("delivery_profile")
        if delivery_profile not in DELIVERY_PROFILES:
            raise NativeMcpGatewayError("native MCP gateway receipt delivery profile is invalid")
        raw_suppressed = value.get("suppressed_components")
        if not isinstance(raw_suppressed, list) or any(
            not isinstance(component, str) or not component for component in raw_suppressed
        ):
            raise NativeMcpGatewayError("native MCP gateway receipt suppressed components are invalid")
        suppressed_components = tuple(raw_suppressed)
        if delivery_profile == "full" and suppressed_components:
            raise NativeMcpGatewayError("full native MCP delivery cannot suppress components")
        if delivery_profile != "full" and not suppressed_components:
            raise NativeMcpGatewayError("ablated native MCP delivery lacks suppression evidence")
        policy_sha256 = value.get("policy_sha256")
        if not isinstance(policy_sha256, str) or len(policy_sha256) != 64 or any(
            character not in SHA256_PATTERN for character in policy_sha256
        ):
            raise NativeMcpGatewayError("native MCP gateway receipt policy hash is invalid")
        counts = {}
        for key in ("call_attempt_count", "served_call_count", "provider_failure_count"):
            item = value.get(key)
            if isinstance(item, bool) or not isinstance(item, int) or item < 0:
                raise NativeMcpGatewayError("native MCP gateway receipt count is invalid")
            counts[key] = item
        optional_hashes: dict[str, str | None] = {}
        for key in ("emitted_context_sha256", "source_context_sha256"):
            item = value.get(key)
            if item is not None and (
                not isinstance(item, str)
                or len(item) != 64
                or any(character not in SHA256_PATTERN for character in item)
            ):
                raise NativeMcpGatewayError("native MCP gateway receipt context hash is invalid")
            optional_hashes[key] = item
        optional_counts: dict[str, int | None] = {}
        for key in ("source_context_tokens", "emitted_context_tokens"):
            item = value.get(key)
            if item is not None and (
                isinstance(item, bool) or not isinstance(item, int) or item < 0
            ):
                raise NativeMcpGatewayError("native MCP gateway receipt token count is invalid")
            optional_counts[key] = item
        context_truncated = value.get("context_truncated")
        if context_truncated is not None and not isinstance(context_truncated, bool):
            raise NativeMcpGatewayError("native MCP gateway receipt truncation is invalid")
        receipt = cls(
            schema_version=GATEWAY_SCHEMA_VERSION,
            policy_sha256=policy_sha256,
            delivery_profile=delivery_profile,
            suppressed_components=suppressed_components,
            call_attempt_count=counts["call_attempt_count"],
            served_call_count=counts["served_call_count"],
            provider_failure_count=counts["provider_failure_count"],
            emitted_context_sha256=optional_hashes["emitted_context_sha256"],
            source_context_sha256=optional_hashes["source_context_sha256"],
            source_context_tokens=optional_counts["source_context_tokens"],
            emitted_context_tokens=optional_counts["emitted_context_tokens"],
            context_truncated=context_truncated,
        )
        if receipt.served_call_count > receipt.call_attempt_count:
            raise NativeMcpGatewayError("native MCP gateway served calls exceed attempts")
        if receipt.served_call_count == 0 and any(
            value is not None
            for value in (
                receipt.emitted_context_sha256,
                receipt.source_context_sha256,
                receipt.source_context_tokens,
                receipt.emitted_context_tokens,
                receipt.context_truncated,
            )
        ):
            raise NativeMcpGatewayError("empty native MCP receipt contains context evidence")
        if receipt.served_call_count == 0 and receipt.suppressed_components:
            raise NativeMcpGatewayError("empty native MCP receipt contains delivery evidence")
        return receipt


@dataclass(frozen=True)
class GatewayToolResult:
    text: str
    is_error: bool


class NativeMcpBudgetGateway:
    """One-tool, one-budget MCP surface for the separately labelled native track."""

    def __init__(self, provider: ProjectContextProvider, policy: NativeMcpBudgetPolicy) -> None:
        policy.validate()
        self.provider = provider
        self.policy = policy
        self.call_attempt_count = 0
        self.served_call_count = 0
        self.provider_failure_count = 0
        self._emitted_context: str | None = None
        self._source_context: str | None = None
        self._source_context_tokens: int | None = None
        self._context_truncated: bool | None = None
        self._suppressed_components: tuple[str, ...] = ()

    @property
    def receipt(self) -> NativeMcpGatewayReceipt:
        return NativeMcpGatewayReceipt(
            schema_version=GATEWAY_SCHEMA_VERSION,
            policy_sha256=self.policy.sha256,
            delivery_profile=self.policy.delivery_profile,
            suppressed_components=self._suppressed_components,
            call_attempt_count=self.call_attempt_count,
            served_call_count=self.served_call_count,
            provider_failure_count=self.provider_failure_count,
            emitted_context_sha256=(
                hashlib.sha256(self._emitted_context.encode("utf-8")).hexdigest()
                if self._emitted_context is not None
                else None
            ),
            source_context_sha256=(
                hashlib.sha256(self._source_context.encode("utf-8")).hexdigest()
                if self._source_context is not None
                else None
            ),
            source_context_tokens=self._source_context_tokens,
            emitted_context_tokens=(
                token_count(self._emitted_context)
                if self._emitted_context is not None
                else None
            ),
            context_truncated=self._context_truncated,
        )

    def tool_definition(self) -> dict[str, object]:
        return {
            "name": GATEWAY_TOOL_NAME,
            "description": (
                "Return the single fixed, token-bounded Memorix project-context packet "
                "configured for this research run. The task, refresh policy, call budget, "
                "and output budget are controlled by the runner."
            ),
            "inputSchema": {
                "type": "object",
                "properties": {},
                "additionalProperties": False,
            },
        }

    def call_tool(self, name: object, arguments: object) -> GatewayToolResult:
        if name != GATEWAY_TOOL_NAME:
            return GatewayToolResult("This research MCP gateway exposes no such tool.", True)
        self.call_attempt_count += 1
        if arguments not in ({}, None):
            return GatewayToolResult(
                "This research MCP tool accepts no caller-controlled arguments.",
                True,
            )
        if self.served_call_count >= self.policy.call_budget:
            return GatewayToolResult(
                "Memorix research MCP call budget is exhausted for this run.",
                True,
            )
        try:
            delivery = self.provider.fetch_project_context(
                task=self.policy.task,
                refresh=self.policy.refresh,
                delivery_profile=self.policy.delivery_profile,
            )
        except Exception:
            self.provider_failure_count += 1
            return GatewayToolResult("Memorix project context is unavailable for this run.", True)
        if (
            not isinstance(delivery, ProjectContextDelivery)
            or not isinstance(delivery.source_context, str)
            or not isinstance(delivery.delivered_context, str)
            or any(not isinstance(component, str) or not component for component in delivery.suppressed_components)
        ):
            self.provider_failure_count += 1
            return GatewayToolResult("Memorix project context is unavailable for this run.", True)
        if self.policy.delivery_profile == "full" and delivery.suppressed_components:
            self.provider_failure_count += 1
            return GatewayToolResult("Memorix project context delivery evidence is invalid for this run.", True)
        emitted_context, truncated = truncate_to_tokens(
            delivery.delivered_context,
            self.policy.token_budget,
        )
        self.served_call_count += 1
        self._source_context = delivery.source_context
        self._source_context_tokens = token_count(delivery.source_context)
        self._emitted_context = emitted_context
        self._context_truncated = truncated
        self._suppressed_components = delivery.suppressed_components
        return GatewayToolResult(emitted_context, False)

    def handle_jsonrpc(self, message: object) -> dict[str, object] | None:
        if not isinstance(message, dict) or message.get("jsonrpc") != "2.0":
            return self._error_response(message, -32600, "Invalid JSON-RPC message")
        method = message.get("method")
        request_id = message.get("id")
        if not isinstance(method, str):
            return self._error_response(message, -32600, "Invalid JSON-RPC method")
        if method == "notifications/initialized":
            return None
        if method == "initialize":
            params = message.get("params")
            protocol_version = (
                params.get("protocolVersion")
                if isinstance(params, dict)
                else None
            )
            selected_version = (
                protocol_version
                if isinstance(protocol_version, str)
                and protocol_version in SUPPORTED_MCP_PROTOCOL_VERSIONS
                else "2025-03-26"
            )
            return self._result_response(
                request_id,
                {
                    "protocolVersion": selected_version,
                    "capabilities": {"tools": {"listChanged": False}},
                    "serverInfo": {"name": GATEWAY_SERVER_NAME, "version": GATEWAY_SCHEMA_VERSION},
                },
            )
        if method == "ping":
            return self._result_response(request_id, {})
        if method == "tools/list":
            return self._result_response(request_id, {"tools": [self.tool_definition()]})
        if method == "tools/call":
            params = message.get("params")
            if not isinstance(params, dict):
                return self._error_response(message, -32602, "Invalid tools/call parameters")
            result = self.call_tool(params.get("name"), params.get("arguments"))
            return self._result_response(
                request_id,
                {
                    "content": [{"type": "text", "text": result.text}],
                    "isError": result.is_error,
                },
            )
        return self._error_response(message, -32601, "Method not found")

    @staticmethod
    def _result_response(request_id: object, result: dict[str, object]) -> dict[str, object] | None:
        if request_id is None:
            return None
        return {"jsonrpc": "2.0", "id": request_id, "result": result}

    @staticmethod
    def _error_response(message: object, code: int, detail: str) -> dict[str, object] | None:
        request_id = message.get("id") if isinstance(message, dict) else None
        if request_id is None:
            return None
        return {
            "jsonrpc": "2.0",
            "id": request_id,
            "error": {"code": code, "message": detail},
        }


class MemorixProjectContextProviderImpl:
    def __init__(
        self,
        *,
        memorix_cli: Path,
        workspace: Path,
        data_dir: Path,
        home_dir: Path,
        log_dir: Path,
    ) -> None:
        self.control = MemorixControlPlane(
            cli_path=memorix_cli,
            workspace=workspace,
            data_dir=data_dir,
            home_dir=home_dir,
            log_dir=log_dir,
            mode="micro",
        )

    def __enter__(self) -> MemorixProjectContextProviderImpl:
        self.control.__enter__()
        return self

    def __exit__(self, exc_type: object, exc: object, traceback: object) -> None:
        self.control.__exit__(exc_type, exc, traceback)

    def fetch_project_context(
        self,
        *,
        task: str,
        refresh: str,
        delivery_profile: str,
    ) -> ProjectContextDelivery:
        result = self.control.tool(
            GATEWAY_TOOL_NAME,
            {
                "task": task,
                "format": "json",
                "refresh": refresh,
                "deliveryProfile": delivery_profile,
            },
        )
        try:
            payload = json.loads(_tool_text(result))
        except (TypeError, json.JSONDecodeError) as error:
            raise NativeMcpGatewayError("Memorix project context JSON is unavailable") from error
        if not isinstance(payload, dict):
            raise NativeMcpGatewayError("Memorix project context JSON must be an object")
        workset = payload.get("workset")
        delivery = payload.get("delivery")
        if not isinstance(workset, dict) or not isinstance(delivery, dict):
            raise NativeMcpGatewayError("Memorix project context JSON lacks delivery evidence")
        source_context = workset.get("prompt")
        delivered_context = delivery.get("prompt")
        suppressed = delivery.get("suppressed")
        if (
            not isinstance(source_context, str)
            or not isinstance(delivered_context, str)
            or not isinstance(suppressed, list)
            or any(not isinstance(component, str) or not component for component in suppressed)
            or delivery.get("profile") != delivery_profile
        ):
            raise NativeMcpGatewayError("Memorix project context delivery evidence is invalid")
        return ProjectContextDelivery(
            source_context=source_context,
            delivered_context=delivered_context,
            suppressed_components=tuple(suppressed),
        )


def write_native_mcp_config(
    *,
    path: Path,
    python_executable: Path,
    memorix_cli: Path,
    workspace: Path,
    data_dir: Path,
    home_dir: Path,
    log_dir: Path,
    receipt_path: Path,
    task: str,
    call_budget: int,
    token_budget: int,
    refresh: str = "never",
    delivery_profile: str = "full",
) -> Path:
    policy = NativeMcpBudgetPolicy(
        task=task,
        call_budget=call_budget,
        token_budget=token_budget,
        refresh=refresh,
        delivery_profile=delivery_profile,
    )
    policy.validate()
    payload = {
        "mcpServers": {
            "memorix": {
                "command": str(python_executable),
                "args": [
                    "-m",
                    "memorixbench.native_mcp_gateway",
                    "--memorix-cli",
                    str(memorix_cli),
                    "--workspace",
                    str(workspace),
                    "--data-dir",
                    str(data_dir),
                    "--home-dir",
                    str(home_dir),
                    "--log-dir",
                    str(log_dir),
                    "--receipt-path",
                    str(receipt_path),
                    "--task",
                    task,
                    "--call-budget",
                    str(call_budget),
                    "--token-budget",
                    str(token_budget),
                    "--refresh",
                    refresh,
                    "--delivery-profile",
                    delivery_profile,
                ],
                "env": _isolated_mcp_env(),
            }
        }
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    return path


def run_stdio_gateway(
    gateway: NativeMcpBudgetGateway,
    *,
    input_stream: TextIO,
    output_stream: TextIO,
) -> None:
    for raw_line in input_stream:
        try:
            message = json.loads(raw_line)
        except json.JSONDecodeError:
            response = {"jsonrpc": "2.0", "id": None, "error": {"code": -32700, "message": "Parse error"}}
        else:
            response = gateway.handle_jsonrpc(message)
        if response is not None:
            output_stream.write(json.dumps(response, separators=(",", ":")) + "\n")
            output_stream.flush()


def _write_receipt(path: Path, receipt: NativeMcpGatewayReceipt) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(receipt.public_payload(), indent=2) + "\n", encoding="utf-8")


def load_native_mcp_receipt(path: Path) -> NativeMcpGatewayReceipt:
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise NativeMcpGatewayError("native MCP gateway receipt cannot be read") from error
    return NativeMcpGatewayReceipt.from_public_payload(raw)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="memorixbench-native-mcp-gateway")
    parser.add_argument("--memorix-cli", type=Path, required=True)
    parser.add_argument("--workspace", type=Path, required=True)
    parser.add_argument("--data-dir", type=Path, required=True)
    parser.add_argument("--home-dir", type=Path, required=True)
    parser.add_argument("--log-dir", type=Path, required=True)
    parser.add_argument("--receipt-path", type=Path, required=True)
    parser.add_argument("--task", required=True)
    parser.add_argument("--call-budget", type=int, required=True)
    parser.add_argument("--token-budget", type=int, required=True)
    parser.add_argument("--refresh", choices=("never", "auto"), default="never")
    parser.add_argument("--delivery-profile", choices=sorted(DELIVERY_PROFILES), default="full")
    return parser


def main() -> int:
    args = build_parser().parse_args()
    policy = NativeMcpBudgetPolicy(
        task=args.task,
        call_budget=args.call_budget,
        token_budget=args.token_budget,
        refresh=args.refresh,
        delivery_profile=args.delivery_profile,
    )
    try:
        with MemorixProjectContextProviderImpl(
            memorix_cli=args.memorix_cli,
            workspace=args.workspace,
            data_dir=args.data_dir,
            home_dir=args.home_dir,
            log_dir=args.log_dir,
        ) as provider:
            gateway = NativeMcpBudgetGateway(provider, policy)
            try:
                run_stdio_gateway(gateway, input_stream=sys.stdin, output_stream=sys.stdout)
            finally:
                _write_receipt(args.receipt_path, gateway.receipt)
    except (NativeMcpGatewayError, OSError, RuntimeError, TimeoutError) as error:
        print(f"[memorixbench-native-mcp-gateway] {type(error).__name__}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
