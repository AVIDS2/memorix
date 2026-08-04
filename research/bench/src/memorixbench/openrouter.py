from __future__ import annotations

import json
from math import isfinite
import os
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from .models import ModelReply, RouteSpec, ToolCall


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
            "tools": tools,
            "tool_choice": "auto",
            "temperature": self.route.temperature,
            "max_tokens": self.route.max_output_tokens,
        }
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
            },
            method="POST",
        )
        try:
            with urlopen(request, timeout=self.route.provider_timeout_seconds) as response:
                data = json.loads(response.read().decode("utf-8"))
        except HTTPError as error:
            detail = error.read().decode("utf-8", errors="replace")[:500]
            raise RuntimeError(f"{self.provider_label} request failed with HTTP {error.code}: {detail}") from error
        except URLError as error:
            raise RuntimeError(f"{self.provider_label} request failed: {error.reason}") from error

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
            cost_usd=self._cost_usd(usage, input_tokens, output_tokens),
            cost_accounting=self.route.cost_policy.kind,
            reasoning_content=(
                message.get("reasoning_content")
                if isinstance(message.get("reasoning_content"), str)
                else None
            ),
        )

    def _cost_usd(
        self,
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
        _usage: dict[str, Any],
        input_tokens: int | None,
        output_tokens: int | None,
    ) -> float | None:
        return self.route.cost_policy.estimate_cost_usd(input_tokens, output_tokens)


def client_for_route(route: RouteSpec) -> _OpenAICompatibleRouteClient:
    if route.provider == "openrouter":
        return OpenRouterClient(route)
    if route.provider == "deepseek":
        return DeepSeekClient(route)
    raise ValueError(f"unsupported route provider: {route.provider}")


def _optional_int(value: object) -> int | None:
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        return None
    return value


def _optional_float(value: object) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    normalized = float(value)
    if not isfinite(normalized) or normalized < 0:
        return None
    return normalized
