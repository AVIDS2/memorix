from __future__ import annotations

import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from memorixbench.models import RouteSpec
from memorixbench.openrouter import DeepSeekClient, OpenCodeGoClient, client_for_route


class _Response:
    def __init__(self, payload: dict[str, object]):
        self._payload = json.dumps(payload).encode("utf-8")

    def __enter__(self) -> "_Response":
        return self

    def __exit__(self, _type, _value, _traceback) -> None:
        return None

    def read(self) -> bytes:
        return self._payload


class ProviderClientTests(unittest.TestCase):
    def test_opencode_go_route_uses_the_official_chat_completions_endpoint(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            route_path = Path(temporary) / "route.json"
            route_path.write_text(
                json.dumps(
                    {
                        "schema_version": 4,
                        "provider": "opencode-go",
                        "requested_model": "glm-5.2",
                        "expected_actual_model": "glm-5.2",
                        "provider_timeout_seconds": 90,
                        "max_output_tokens": 1200,
                        "temperature": 0,
                        "tool_choice": "auto",
                        "cost_policy": {
                            "kind": "subscription-quota",
                            "subscription_name": "OpenCode Go",
                            "usage_source": "https://opencode.ai/docs/go",
                        },
                        "reasoning_effort": "low",
                        "preserve_reasoning_content": True,
                    }
                ),
                encoding="utf-8",
            )
            response = _Response(
                {
                    "id": "response-id",
                    "model": "glm-5.2",
                    "cost": "0",
                    "choices": [{"message": {"content": "done", "reasoning_content": "route reasoning"}}],
                    "usage": {"prompt_tokens": 100, "completion_tokens": 50},
                }
            )
            with patch.dict(os.environ, {"OPENCODE_API_KEY": "test-key"}):
                with patch("memorixbench.openrouter.urlopen", return_value=response) as open_call:
                    client = client_for_route(RouteSpec.load(route_path))
                    self.assertIsInstance(client, OpenCodeGoClient)
                    reply = client.chat([{"role": "user", "content": "test"}], [])
                    client.chat(
                        [{"role": "user", "content": "test"}],
                        [{"type": "function", "function": {"name": "read_file", "parameters": {}}}],
                    )

            no_tool_request = open_call.call_args_list[0].args[0]
            request = open_call.call_args_list[1].args[0]
            self.assertEqual(no_tool_request.full_url, "https://opencode.ai/zen/go/v1/chat/completions")
            self.assertEqual(
                no_tool_request.get_header("User-agent"),
                "MemorixBench/1.4.1 (+https://github.com/AVIDS2/memorix)",
            )
            no_tool_body = json.loads(no_tool_request.data.decode("utf-8"))
            self.assertNotIn("tools", no_tool_body)
            self.assertNotIn("tool_choice", no_tool_body)
            request_body = json.loads(request.data.decode("utf-8"))
            self.assertEqual(request_body["reasoning_effort"], "low")
            self.assertEqual(request_body["tool_choice"], "auto")
            self.assertEqual(request_body["tools"][0]["function"]["name"], "read_file")
            self.assertEqual(reply.cost_accounting, "subscription-quota")
            self.assertEqual(reply.cost_usd, 0.0)
            self.assertEqual(reply.reasoning_content, "route reasoning")

    def test_deepseek_route_uses_official_endpoint_and_conservative_cost(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            route_path = Path(temporary) / "route.json"
            route_path.write_text(
                json.dumps(
                    {
                        "schema_version": 3,
                        "provider": "deepseek",
                        "requested_model": "deepseek-v4-flash",
                        "expected_actual_model": "deepseek-v4-flash",
                        "provider_timeout_seconds": 90,
                        "max_output_tokens": 1200,
                        "max_cost_usd": 0.5,
                        "temperature": 0,
                        "tool_choice": "auto",
                        "cost_policy": {
                            "kind": "frozen-rate-card-conservative",
                            "input_cache_miss_usd_per_million_tokens": 0.14,
                            "output_usd_per_million_tokens": 0.28,
                            "pricing_source": "https://api-docs.deepseek.com/quick_start/pricing",
                            "pricing_verified_on": "2026-08-04",
                        },
                        "thinking": {"type": "enabled"},
                        "reasoning_effort": "high",
                    }
                ),
                encoding="utf-8",
            )
            route = RouteSpec.load(route_path)
            response = _Response(
                {
                    "id": "response-id",
                    "model": "deepseek-v4-flash",
                    "choices": [{"message": {"content": "done", "reasoning_content": "private tool reasoning"}}],
                    "usage": {"prompt_tokens": 100, "completion_tokens": 50},
                }
            )
            with patch.dict(os.environ, {"DEEPSEEK_API_KEY": "test-key"}):
                with patch("memorixbench.openrouter.urlopen", return_value=response) as open_call:
                    client = client_for_route(route)
                    self.assertIsInstance(client, DeepSeekClient)
                    reply = client.chat([{"role": "user", "content": "test"}], [])

            request = open_call.call_args.args[0]
            self.assertEqual(request.full_url, "https://api.deepseek.com/chat/completions")
            request_body = json.loads(request.data.decode("utf-8"))
            self.assertEqual(request_body["thinking"], {"type": "enabled"})
            self.assertEqual(request_body["reasoning_effort"], "high")
            self.assertEqual(reply.cost_accounting, "frozen-rate-card-conservative")
            self.assertEqual(reply.reasoning_content, "private tool reasoning")
            self.assertAlmostEqual(reply.cost_usd or 0, (100 * 0.14 + 50 * 0.28) / 1_000_000)

    def test_deepseek_client_returns_a_repairable_malformed_tool_call(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            route_path = Path(temporary) / "route.json"
            route_path.write_text(
                json.dumps(
                    {
                        "schema_version": 3,
                        "provider": "deepseek",
                        "requested_model": "deepseek-v4-flash",
                        "expected_actual_model": "deepseek-v4-flash",
                        "provider_timeout_seconds": 90,
                        "max_output_tokens": 1200,
                        "max_cost_usd": 0.5,
                        "temperature": 0,
                        "tool_choice": "auto",
                        "cost_policy": {
                            "kind": "frozen-rate-card-conservative",
                            "input_cache_miss_usd_per_million_tokens": 0.14,
                            "output_usd_per_million_tokens": 0.28,
                            "pricing_source": "https://api-docs.deepseek.com/quick_start/pricing",
                            "pricing_verified_on": "2026-08-04",
                        },
                        "thinking": {"type": "enabled"},
                        "reasoning_effort": "high",
                    }
                ),
                encoding="utf-8",
            )
            response = _Response(
                {
                    "id": "response-id",
                    "model": "deepseek-v4-flash",
                    "choices": [
                        {
                            "message": {
                                "content": "",
                                "reasoning_content": "private tool reasoning",
                                "tool_calls": [
                                    {
                                        "id": "call-1",
                                        "type": "function",
                                        "function": {"name": "read_file", "arguments": '{"path":'},
                                    }
                                ],
                            }
                        }
                    ],
                    "usage": {"prompt_tokens": 100, "completion_tokens": 50},
                }
            )
            with patch.dict(os.environ, {"DEEPSEEK_API_KEY": "test-key"}):
                with patch("memorixbench.openrouter.urlopen", return_value=response):
                    reply = client_for_route(RouteSpec.load(route_path)).chat([], [])

            self.assertEqual(len(reply.tool_calls), 1)
            call = reply.tool_calls[0]
            self.assertEqual(call.arguments, {})
            self.assertEqual(call.raw_arguments, '{"path":')
            self.assertEqual(call.argument_error, "arguments-invalid-json")
