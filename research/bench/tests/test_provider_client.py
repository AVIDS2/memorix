from __future__ import annotations

import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from memorixbench.models import RouteSpec
from memorixbench.openrouter import DeepSeekClient, client_for_route


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
    def test_deepseek_route_uses_official_endpoint_and_conservative_cost(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            route_path = Path(temporary) / "route.json"
            route_path.write_text(
                json.dumps(
                    {
                        "schema_version": 2,
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
                    }
                ),
                encoding="utf-8",
            )
            route = RouteSpec.load(route_path)
            response = _Response(
                {
                    "id": "response-id",
                    "model": "deepseek-v4-flash",
                    "choices": [{"message": {"content": "done"}}],
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
            self.assertEqual(reply.cost_accounting, "frozen-rate-card-conservative")
            self.assertAlmostEqual(reply.cost_usd or 0, (100 * 0.14 + 50 * 0.28) / 1_000_000)

