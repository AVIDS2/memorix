from __future__ import annotations

import json
from pathlib import Path
import tempfile
import unittest

from memorixbench.models import CostPolicy, ModelReply, RouteSpec
from memorixbench.qualification import qualify_route, qualify_route_window


class _Client:
    def __init__(self, reply: ModelReply) -> None:
        self.reply = reply
        self.messages = None
        self.tools = None

    def chat(self, messages, tools) -> ModelReply:
        self.messages = messages
        self.tools = tools
        return self.reply


class _SequenceClient:
    def __init__(self, replies: list[ModelReply]) -> None:
        self.replies = list(replies)

    def chat(self, _messages, _tools) -> ModelReply:
        return self.replies.pop(0)


def _route() -> RouteSpec:
    return RouteSpec(
        provider="opencode-go",
        requested_model="glm-5.2",
        expected_actual_model="glm-5.2",
        provider_timeout_seconds=60,
        max_output_tokens=128,
        max_cost_usd=None,
        temperature=0.0,
        tool_choice="auto",
        cost_policy=CostPolicy.load_opencode_go(
            {
                "kind": "subscription-quota",
                "subscription_name": "OpenCode Go",
                "usage_source": "https://opencode.ai/docs/go/",
            }
        ),
        definition_sha256="0" * 64,
        max_total_tokens=1_000,
    )


class RouteQualificationTests(unittest.TestCase):
    def test_passing_probe_writes_a_sanitized_non_cohort_receipt(self) -> None:
        client = _Client(
            ModelReply(
                content="OK",
                tool_calls=(),
                model="glm-5.2",
                response_id="provider-response-id",
                input_tokens=10,
                output_tokens=20,
                cost_usd=0.0,
                cost_accounting="subscription-quota",
            )
        )
        artifact_parent = Path(__file__).resolve().parents[3] / "research" / "artifacts"
        with tempfile.TemporaryDirectory(dir=artifact_parent) as temporary:
            outcome = qualify_route(route=_route(), client=client, artifact_root=Path(temporary))
            payload = json.loads(Path(outcome["receipt_path"]).read_text(encoding="utf-8"))
        self.assertEqual(payload["status"], "passed")
        self.assertEqual(payload["qualification_type"], "non-cohort-transport")
        self.assertEqual(payload["actual_model"], "glm-5.2")
        self.assertEqual(payload["resource_usage"]["total_tokens"], 30)
        self.assertIsNotNone(payload["response_id_sha256"])
        self.assertNotIn("OK", json.dumps(payload))
        self.assertEqual(client.tools, [])
        self.assertEqual(client.messages[0]["content"], "Reply with OK only. Do not call tools.")

    def test_route_mismatch_is_retained_as_a_failed_qualification(self) -> None:
        client = _Client(
            ModelReply(
                content="not retained",
                tool_calls=(),
                model="substituted-model",
                response_id=None,
                input_tokens=10,
                output_tokens=20,
                cost_usd=0.0,
                cost_accounting="subscription-quota",
            )
        )
        artifact_parent = Path(__file__).resolve().parents[3] / "research" / "artifacts"
        with tempfile.TemporaryDirectory(dir=artifact_parent) as temporary:
            outcome = qualify_route(route=_route(), client=client, artifact_root=Path(temporary))
        self.assertEqual(outcome["payload"]["status"], "failed")
        self.assertEqual(outcome["payload"]["failure"], "route:actual-model-mismatch")

    def test_rejects_an_artifact_root_outside_the_repository_boundary(self) -> None:
        client = _Client(
            ModelReply(
                content=None,
                tool_calls=(),
                model="glm-5.2",
                response_id=None,
                input_tokens=10,
                output_tokens=20,
                cost_usd=0.0,
                cost_accounting="subscription-quota",
            )
        )
        with tempfile.TemporaryDirectory() as temporary:
            with self.assertRaisesRegex(ValueError, "research/artifacts"):
                qualify_route(route=_route(), client=client, artifact_root=Path(temporary))

    def test_fixed_window_requires_all_three_probes_to_pass(self) -> None:
        passing = ModelReply(
            content="OK",
            tool_calls=(),
            model="glm-5.2",
            response_id="provider-response-id",
            input_tokens=10,
            output_tokens=20,
            cost_usd=0.0,
            cost_accounting="subscription-quota",
        )
        failed = ModelReply(
            content="wrong model",
            tool_calls=(),
            model="substituted-model",
            response_id="provider-response-id-2",
            input_tokens=10,
            output_tokens=20,
            cost_usd=0.0,
            cost_accounting="subscription-quota",
        )
        artifact_parent = Path(__file__).resolve().parents[3] / "research" / "artifacts"
        with tempfile.TemporaryDirectory(dir=artifact_parent) as temporary:
            outcome = qualify_route_window(
                route=_route(),
                client=_SequenceClient([passing, failed, passing]),
                artifact_root=Path(temporary),
            )
            payload = json.loads(Path(outcome["summary_path"]).read_text(encoding="utf-8"))
        self.assertFalse(payload["all_passed"])
        self.assertEqual(payload["attempt_count"], 3)
        self.assertEqual(payload["attempts"][1]["failure"], "route:actual-model-mismatch")
