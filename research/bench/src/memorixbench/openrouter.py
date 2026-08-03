from __future__ import annotations

import json
import os
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from .models import ModelReply, ToolCall


class OpenRouterClient:
    """Small OpenAI-compatible tool-loop client with explicit route receipts."""

    endpoint = "https://openrouter.ai/api/v1/chat/completions"

    def __init__(self, model: str, *, timeout_seconds: int = 90, max_output_tokens: int = 1200):
        self.model = model
        self.timeout_seconds = timeout_seconds
        self.max_output_tokens = max_output_tokens
        if max_output_tokens < 1 or max_output_tokens > 4096:
            raise ValueError("max_output_tokens must be between 1 and 4096")
        self.api_key = os.environ.get("OPENROUTER_API_KEY")
        if not self.api_key:
            raise RuntimeError("OPENROUTER_API_KEY is required for a live trial")

    def chat(self, messages: list[dict[str, Any]], tools: list[dict[str, Any]]) -> ModelReply:
        payload = json.dumps(
            {
                "model": self.model,
                "messages": messages,
                "tools": tools,
                "tool_choice": "auto",
                "temperature": 0,
                "max_tokens": self.max_output_tokens,
            }
        ).encode("utf-8")
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
            with urlopen(request, timeout=self.timeout_seconds) as response:
                data = json.loads(response.read().decode("utf-8"))
        except HTTPError as error:
            detail = error.read().decode("utf-8", errors="replace")[:500]
            raise RuntimeError(f"OpenRouter request failed with HTTP {error.code}: {detail}") from error
        except URLError as error:
            raise RuntimeError(f"OpenRouter request failed: {error.reason}") from error

        try:
            message = data["choices"][0]["message"]
        except (KeyError, IndexError, TypeError) as error:
            raise RuntimeError("OpenRouter response has no assistant message") from error
        calls: list[ToolCall] = []
        for raw_call in message.get("tool_calls") or []:
            function = raw_call.get("function") or {}
            try:
                arguments = json.loads(function.get("arguments") or "{}")
            except json.JSONDecodeError as error:
                raise RuntimeError("model emitted invalid JSON tool arguments") from error
            if not isinstance(arguments, dict):
                raise RuntimeError("model emitted non-object tool arguments")
            calls.append(
                ToolCall(
                    call_id=str(raw_call.get("id") or ""),
                    name=str(function.get("name") or ""),
                    arguments=arguments,
                )
            )
        usage = data.get("usage") or {}
        return ModelReply(
            content=message.get("content") if isinstance(message.get("content"), str) else None,
            tool_calls=tuple(calls),
            model=data.get("model") if isinstance(data.get("model"), str) else None,
            response_id=data.get("id") if isinstance(data.get("id"), str) else None,
            input_tokens=_optional_int(usage.get("prompt_tokens")),
            output_tokens=_optional_int(usage.get("completion_tokens")),
            cost_usd=_optional_float(usage.get("cost")),
        )


def _optional_int(value: object) -> int | None:
    return int(value) if isinstance(value, (int, float)) else None


def _optional_float(value: object) -> float | None:
    return float(value) if isinstance(value, (int, float)) else None
