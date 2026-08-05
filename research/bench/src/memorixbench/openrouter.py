from __future__ import annotations

import json
from math import isfinite
import os
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from .models import ModelReply, RouteSpec, ToolCall

_USER_AGENT = "MemorixBench/1.4.1 (+https://github.com/AVIDS2/memorix)"


class ProviderRequestError(RuntimeError):
    """A sanitized transport classification safe to retain in a receipt."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


class _OpenAICompatibleRouteClient:
    """Fail-closed OpenAI-compatible transport shared by explicitly approved routes."""

    provider = ""
    provider_label = "provider"
    endpoint = ""
    api_key_env = ""

    def __init__(self, route: RouteSpec):
        if route.provider != self.provider:
            raise ValueError(f"{self.provider_label} client received a {route.provider} route")
        self.route = route
        self.api_key = os.environ.get(self.api_key_env)
        if not self.api_key:
            raise RuntimeError(f"{self.api_key_env} is required for a live trial")

    def chat(self, messages: list[dict[str, Any]], tools: list[dict[str, Any]]) -> ModelReply:
        request_payload: dict[str, Any] = {
            "model": self.route.requested_model,
            "messages": messages,
            "temperature": self.route.temperature,
            "max_tokens": self.route.max_output_tokens,
        }
        if tools:
            request_payload["tools"] = tools
            request_payload["tool_choice"] = self.route.tool_choice
        if self.route.thinking_mode is not None:
            request_payload["thinking"] = {"type": self.route.thinking_mode}
        if self.route.reasoning_effort is not None:
            request_payload["reasoning_effort"] = self.route.reasoning_effort
        payload = json.dumps(request_payload).encode("utf-8")
        request = Request(
            self.endpoint,
            data=payload,
            headers={
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json",
                # Some provider edge layers reject Python's default user agent.
                # Identify this benchmark honestly instead of impersonating a
                # provider-owned client; the value is safe to retain in source.
                "User-Agent": _USER_AGENT,
            },
            method="POST",
        )
        try:
            with urlopen(request, timeout=self.route.provider_timeout_seconds) as response:
                data = json.loads(response.read().decode("utf-8"))
        except HTTPError as error:
            # Do not retain a gateway body: it may echo task text or provider
            # diagnostics. The status class is sufficient for failure analysis.
            raise ProviderRequestError(
                f"http-{error.code}",
                f"{self.provider_label} request failed with HTTP {error.code}",
            ) from error
        except URLError as error:
            raise ProviderRequestError(
                "network",
                f"{self.provider_label} request failed: {error.reason}",
            ) from error

        try:
            message = data["choices"][0]["message"]
        except (KeyError, IndexError, TypeError) as error:
            raise RuntimeError(f"{self.provider_label} response has no assistant message") from error
        calls: list[ToolCall] = []
        for raw_call in message.get("tool_calls") or []:
            function = raw_call.get("function") or {}
            raw_arguments = function.get("arguments")
            argument_error: str | None = None
            arguments: dict[str, Any] = {}
            if not isinstance(raw_arguments, str):
                argument_error = "arguments-not-a-string"
                raw_arguments = None
            else:
                try:
                    parsed_arguments = json.loads(raw_arguments)
                except json.JSONDecodeError:
                    argument_error = "arguments-invalid-json"
                else:
                    if isinstance(parsed_arguments, dict):
                        arguments = parsed_arguments
                    else:
                        argument_error = "arguments-not-an-object"
            calls.append(
                ToolCall(
                    call_id=str(raw_call.get("id") or ""),
                    name=str(function.get("name") or ""),
                    arguments=arguments,
                    raw_arguments=raw_arguments,
                    argument_error=argument_error,
                )
            )
        usage = data.get("usage") or {}
        input_tokens = _optional_int(usage.get("prompt_tokens"))
        output_tokens = _optional_int(usage.get("completion_tokens"))
        return ModelReply(
            content=message.get("content") if isinstance(message.get("content"), str) else None,
            tool_calls=tuple(calls),
            model=data.get("model") if isinstance(data.get("model"), str) else None,
            response_id=data.get("id") if isinstance(data.get("id"), str) else None,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            cost_usd=self._cost_usd(data, usage, input_tokens, output_tokens),
            cost_accounting=self.route.cost_policy.kind,
            reasoning_content=(
                message.get("reasoning_content")
                if isinstance(message.get("reasoning_content"), str)
                else None
            ),
        )

    def _cost_usd(
        self,
        _data: dict[str, Any],
        usage: dict[str, Any],
        input_tokens: int | None,
        output_tokens: int | None,
    ) -> float | None:
        raise NotImplementedError


class OpenRouterClient(_OpenAICompatibleRouteClient):
    """OpenRouter route with provider-reported per-response cost."""

    provider = "openrouter"
    provider_label = "OpenRouter"
    endpoint = "https://openrouter.ai/api/v1/chat/completions"
    api_key_env = "OPENROUTER_API_KEY"

    def _cost_usd(
        self,
        _data: dict[str, Any],
        usage: dict[str, Any],
        _input_tokens: int | None,
        _output_tokens: int | None,
    ) -> float | None:
        return _optional_float(usage.get("cost"))


class DeepSeekClient(_OpenAICompatibleRouteClient):
    """Official DeepSeek route with a frozen conservative rate-card bound."""

    provider = "deepseek"
    provider_label = "DeepSeek"
    endpoint = "https://api.deepseek.com/chat/completions"
    api_key_env = "DEEPSEEK_API_KEY"

    def _cost_usd(
        self,
        _data: dict[str, Any],
        _usage: dict[str, Any],
        input_tokens: int | None,
        output_tokens: int | None,
    ) -> float | None:
        return self.route.cost_policy.estimate_cost_usd(input_tokens, output_tokens)


class OpenCodeGoClient(_OpenAICompatibleRouteClient):
    """Official OpenCode Go OpenAI-compatible route under a subscription quota."""

    provider = "opencode-go"
    provider_label = "OpenCode Go"
    endpoint = "https://opencode.ai/zen/go/v1/chat/completions"
    api_key_env = "OPENCODE_API_KEY"

    def _cost_usd(
        self,
        data: dict[str, Any],
        _usage: dict[str, Any],
        _input_tokens: int | None,
        _output_tokens: int | None,
    ) -> float | None:
        # Go responses currently expose a request price at the top level. It is
        # telemetry under the subscription plan, not an invoice amount.
        return _optional_float(data.get("cost"), allow_numeric_string=True)


def client_for_route(route: RouteSpec) -> _OpenAICompatibleRouteClient:
    if route.provider == "openrouter":
        return OpenRouterClient(route)
    if route.provider == "deepseek":
        return DeepSeekClient(route)
    if route.provider == "opencode-go":
        return OpenCodeGoClient(route)
    raise ValueError(f"unsupported route provider: {route.provider}")


def _optional_int(value: object) -> int | None:
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        return None
    return value


def _optional_float(value: object, *, allow_numeric_string: bool = False) -> float | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, str) and allow_numeric_string:
        try:
            normalized = float(value.strip())
        except ValueError:
            return None
    elif isinstance(value, (int, float)):
        normalized = float(value)
    else:
        return None
    if not isfinite(normalized) or normalized < 0:
        return None
    return normalized
