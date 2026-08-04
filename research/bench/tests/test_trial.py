from __future__ import annotations

from dataclasses import dataclass
import json
from pathlib import Path
import sys
import tempfile
import unittest

from memorixbench.models import CaseSpec, CostPolicy, ModelReply, OracleSpec, RouteSpec, ToolCall, sha256_file, sha256_text, sha256_tree
from memorixbench import preflight, trial
from memorixbench.trial import CanonicalEvidenceTool, RawRecordTool, TrialConfig, _assistant_wire, _messages, _workset_includes_observation, agent_tools, _native_context_prompt, _native_memory_detail, run_trial


@dataclass
class ScriptedClient:
    replies: list[ModelReply]

    def __post_init__(self) -> None:
        self.messages: list[list[dict[str, object]]] = []

    def chat(self, messages, _tools):
        self.messages.append(list(messages))
        return self.replies.pop(0)


class TrialTests(unittest.TestCase):
    def test_runner_hash_covers_only_the_loaded_runner_package(self) -> None:
        package_root = Path(trial.__file__).resolve().parent
        self.assertEqual(trial._runner_source_tree_sha256(), sha256_tree(package_root))
        self.assertNotEqual(
            trial._runner_source_tree_sha256(),
            sha256_tree(package_root.parents[1]),
        )

    def _case_and_oracle(self, root: Path) -> tuple[CaseSpec, OracleSpec]:
        case_root = root / "case"
        source_root = case_root / "seed" / "src"
        source_root.mkdir(parents=True)
        (source_root / "task.py").write_text("pending\n", encoding="utf-8")
        (case_root / "case.json").write_text(
            json.dumps(
                {
                    "schema_version": 2,
                    "id": "example",
                    "title": "Example policy",
                    "case_class": "durable-decision-dependency",
                    "case_tier": "synthetic-engineering-smoke",
                    "task": "Replace pending with done in src/task.py.",
                    "source_root": "seed",
                    "writable_paths": ["src"],
                    "predecessor_record": "The durable decision is to use done.",
                    "predecessor_memory": {
                        "type": "decision",
                        "files": ["src/task.py"],
                        "concepts": ["task state"],
                    },
                    "evidence_char_budget": 256,
                }
            ),
            encoding="utf-8",
        )
        oracle_root = root / "oracle"
        oracle_root.mkdir()
        verifier = oracle_root / "verify.py"
        verifier.write_text(
            "from pathlib import Path\nimport sys\nraise SystemExit(0 if (Path(sys.argv[1]) / 'src' / 'task.py').read_text().strip() == 'done' else 1)\n",
            encoding="utf-8",
        )
        (oracle_root / "oracle.json").write_text(
            json.dumps({"command": [sys.executable, str(verifier), "{workspace}"], "timeout_seconds": 10}),
            encoding="utf-8",
        )
        return CaseSpec.load(case_root / "case.json"), OracleSpec.load(oracle_root / "oracle.json")

    def test_completed_trial_records_sanitized_receipt(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            case, oracle = self._case_and_oracle(root)
            client = ScriptedClient(
                [
                    ModelReply(
                        content=None,
                        tool_calls=(ToolCall("call-1", "read_predecessor_record", {}),),
                        model="example/model",
                        response_id="private-response-id",
                        input_tokens=10,
                        output_tokens=5,
                        cost_usd=0.001,
                    ),
                    ModelReply(
                        content=None,
                        tool_calls=(ToolCall("call-2", "write_file", {"path": "src/task.py", "content": "done\n"}),),
                        model="example/model",
                        response_id="private-response-id-2",
                        input_tokens=10,
                        output_tokens=5,
                        cost_usd=0.001,
                    ),
                    ModelReply(
                        content="finished",
                        tool_calls=(),
                        model="example/model",
                        response_id="private-response-id-3",
                        input_tokens=12,
                        output_tokens=3,
                        cost_usd=0.002,
                    ),
                ]
            )
            outcome = run_trial(
                TrialConfig(case=case, oracle=oracle, condition="raw-record", requested_model="example/model", artifact_root=root / "artifacts"),
                client,
            )
            payload = outcome["payload"]
            self.assertEqual(payload["status"], "completed")
            self.assertTrue(payload["task_success"])
            self.assertEqual(payload["runner"]["protocol_version"], "1.8-draft")
            self.assertRegex(payload["runner"]["source_tree_sha256"], r"^[0-9a-f]{64}$")
            self.assertEqual(payload["resource_usage"]["memory_context_calls"], 0)
            self.assertEqual(payload["resource_usage"]["raw_record_calls"], 1)
            self.assertEqual(payload["resource_usage"]["input_tokens"], 32)
            self.assertEqual(payload["resource_usage"]["ordinary_tool_call_count"], 1)
            self.assertEqual(payload["resource_usage"]["trusted_final_verification_count"], 1)
            self.assertTrue(payload["agent_action"]["source_edit_attempted"])
            self.assertTrue(payload["agent_action"]["source_edit_succeeded"])
            self.assertTrue(payload["agent_action"]["source_changed"])
            self.assertEqual(payload["agent_action"]["termination_reason"], "verification-passed")
            self.assertNotIn(str(root), outcome["receipt_path"].read_text(encoding="utf-8"))
            self.assertNotIn("durable decision", client.messages[0][1]["content"])
            self.assertIn("durable decision", outcome["evidence_path"].read_text(encoding="utf-8"))
            self.assertNotIn(str(root), outcome["evidence_path"].read_text(encoding="utf-8"))
            self.assertEqual(payload["evidence_payload_sha256"], sha256_file(outcome["evidence_path"]))

    def test_trial_marks_gateway_model_substitution_invalid_before_tools(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            case, oracle = self._case_and_oracle(root)
            route = RouteSpec(
                provider="openrouter",
                requested_model="provider/requested-model",
                expected_actual_model="provider/actual-model",
                provider_timeout_seconds=90,
                max_output_tokens=1200,
                max_cost_usd=0.5,
                temperature=0,
                tool_choice="auto",
                cost_policy=CostPolicy.provider_reported(),
                definition_sha256="d" * 64,
            )
            client = ScriptedClient(
                [
                    ModelReply(
                        content=None,
                        tool_calls=(ToolCall("call-1", "write_file", {"path": "src/task.py", "content": "done\n"}),),
                        model="provider/substituted-model",
                        response_id="private-response-id",
                        input_tokens=10,
                        output_tokens=5,
                        cost_usd=0.001,
                    )
                ]
            )
            outcome = run_trial(
                TrialConfig(
                    case=case,
                    oracle=oracle,
                    condition="no-memory",
                    requested_model="provider/requested-model",
                    artifact_root=root / "artifacts",
                    route=route,
                ),
                client,
            )
            payload = outcome["payload"]
            self.assertEqual(payload["status"], "invalid")
            self.assertEqual(payload["invalid_reason"], "route:actual-model-mismatch")
            self.assertEqual(payload["actual_models"], ["provider/substituted-model"])
            self.assertEqual(payload["resource_usage"]["ordinary_tool_call_count"], 0)
            self.assertFalse(payload["agent_action"]["source_edit_attempted"])

    def test_assistant_wire_preserves_tool_reasoning_only_in_provider_state(self) -> None:
        reply = ModelReply(
            content=None,
            tool_calls=(ToolCall("call-1", "read_file", {"path": "src/task.py"}),),
            model="deepseek-v4-flash",
            response_id="private-response",
            input_tokens=1,
            output_tokens=1,
            cost_usd=0.001,
            reasoning_content="private reasoning state",
        )
        self.assertEqual(_assistant_wire(reply)["reasoning_content"], "private reasoning state")
        final_reply = ModelReply(
            content="finished",
            tool_calls=(),
            model="deepseek-v4-flash",
            response_id="private-response-final",
            input_tokens=1,
            output_tokens=1,
            cost_usd=0.001,
            reasoning_content="unneeded final reasoning",
        )
        self.assertNotIn("reasoning_content", _assistant_wire(final_reply))

    def test_frozen_route_reprompts_once_before_an_unverified_finish(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            case, oracle = self._case_and_oracle(root)
            route = RouteSpec(
                provider="openrouter",
                requested_model="provider/requested-model",
                expected_actual_model="provider/actual-model",
                provider_timeout_seconds=90,
                max_output_tokens=1200,
                max_cost_usd=0.5,
                temperature=0,
                tool_choice="auto",
                cost_policy=CostPolicy.provider_reported(),
                definition_sha256="e" * 64,
            )
            reply_kwargs = {
                "model": "provider/actual-model",
                "input_tokens": 10,
                "output_tokens": 5,
                "cost_usd": 0.001,
                "cost_accounting": "provider-reported",
            }
            client = ScriptedClient(
                [
                    ModelReply(content="ready", tool_calls=(), response_id="private-1", **reply_kwargs),
                    ModelReply(
                        content=None,
                        tool_calls=(ToolCall("call-1", "write_file", {"path": "src/task.py", "content": "done\n"}),),
                        response_id="private-2",
                        **reply_kwargs,
                    ),
                    ModelReply(
                        content=None,
                        tool_calls=(ToolCall("call-2", "run_verification", {}),),
                        response_id="private-3",
                        **reply_kwargs,
                    ),
                    ModelReply(content="finished", tool_calls=(), response_id="private-4", **reply_kwargs),
                ]
            )
            outcome = run_trial(
                TrialConfig(
                    case=case,
                    oracle=oracle,
                    condition="no-memory",
                    requested_model="provider/requested-model",
                    artifact_root=root / "artifacts",
                    route=route,
                ),
                client,
            )
            action = outcome["payload"]["agent_action"]
            self.assertTrue(outcome["payload"]["task_success"])
            self.assertTrue(action["verification_required_before_finish"])
            self.assertEqual(action["verification_before_finish_reprompt_count"], 1)
            self.assertEqual(action["ordinary_tool_sequence"], ["write_file", "run_verification"])
            self.assertIn("call run_verification once", client.messages[1][-1]["content"])

    def test_frozen_route_marks_a_second_unverified_finish_invalid(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            case, oracle = self._case_and_oracle(root)
            route = RouteSpec(
                provider="openrouter",
                requested_model="provider/requested-model",
                expected_actual_model="provider/actual-model",
                provider_timeout_seconds=90,
                max_output_tokens=1200,
                max_cost_usd=0.5,
                temperature=0,
                tool_choice="auto",
                cost_policy=CostPolicy.provider_reported(),
                definition_sha256="f" * 64,
            )
            reply_kwargs = {
                "model": "provider/actual-model",
                "input_tokens": 10,
                "output_tokens": 5,
                "cost_usd": 0.001,
                "cost_accounting": "provider-reported",
            }
            client = ScriptedClient(
                [
                    ModelReply(content="ready", tool_calls=(), response_id="private-1", **reply_kwargs),
                    ModelReply(content="still done", tool_calls=(), response_id="private-2", **reply_kwargs),
                ]
            )
            outcome = run_trial(
                TrialConfig(
                    case=case,
                    oracle=oracle,
                    condition="no-memory",
                    requested_model="provider/requested-model",
                    artifact_root=root / "artifacts",
                    route=route,
                ),
                client,
            )
            action = outcome["payload"]["agent_action"]
            self.assertEqual(outcome["payload"]["status"], "invalid")
            self.assertEqual(outcome["payload"]["invalid_reason"], "agent-protocol:stopped-before-verification")
            self.assertEqual(action["verification_before_finish_reprompt_count"], 1)
            self.assertEqual(action["agent_verification_call_count"], 0)

    def test_receipt_distinguishes_agent_stop_after_failed_verification(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            case, oracle = self._case_and_oracle(root)
            client = ScriptedClient(
                [
                    ModelReply(
                        content=None,
                        tool_calls=(ToolCall("call-1", "run_verification", {}),),
                        model="example/model",
                        response_id="private-response-id",
                        input_tokens=10,
                        output_tokens=5,
                        cost_usd=0.001,
                    ),
                    ModelReply(
                        content="cannot continue",
                        tool_calls=(),
                        model="example/model",
                        response_id="private-response-id-2",
                        input_tokens=10,
                        output_tokens=5,
                        cost_usd=0.001,
                    ),
                ]
            )
            outcome = run_trial(
                TrialConfig(case=case, oracle=oracle, condition="no-memory", requested_model="example/model", artifact_root=root / "artifacts"),
                client,
            )
            action = outcome["payload"]["agent_action"]
            self.assertFalse(outcome["payload"]["task_success"])
            self.assertEqual(action["ordinary_tool_sequence"], ["run_verification"])
            self.assertFalse(action["source_edit_attempted"])
            self.assertEqual(action["agent_verification_call_count"], 1)
            self.assertEqual(action["agent_verification_failure_count"], 1)
            self.assertEqual(action["termination_reason"], "assistant-stopped-after-failed-verification")

    def test_infrastructure_receipt_names_the_safe_failure_stage(self) -> None:
        class FailingClient:
            def chat(self, _messages, _tools):
                raise RuntimeError("provider details must not enter the receipt")

        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            case, oracle = self._case_and_oracle(root)
            outcome = run_trial(
                TrialConfig(case=case, oracle=oracle, condition="no-memory", requested_model="example/model", artifact_root=root / "artifacts"),
                FailingClient(),
            )
            payload = outcome["payload"]
            self.assertEqual(payload["status"], "invalid")
            self.assertEqual(payload["invalid_reason"], "infrastructure:provider-chat:RuntimeError")
            self.assertNotIn("provider details", outcome["receipt_path"].read_text(encoding="utf-8"))

    def test_raw_record_uses_an_explicit_bounded_tool(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            case, _oracle = self._case_and_oracle(Path(temporary))
            raw = RawRecordTool(case)
            result = raw.read()
            self.assertIn("durable decision", result["record"])
            self.assertFalse(result["truncated"])
            self.assertEqual(raw.retrieved_chars, len(result["record"]))
            with self.assertRaises(ValueError):
                raw.read()
            raw_tool_names = {item["function"]["name"] for item in agent_tools("raw-record")}
            native_tool_names = {item["function"]["name"] for item in agent_tools("memorix-native")}
            self.assertIn("read_predecessor_record", raw_tool_names)
            self.assertNotIn("read_predecessor_record", native_tool_names)
            self.assertNotIn(case.predecessor_record, _messages(case)[1]["content"])

    def test_canonical_profile_matches_the_evidence_tool_surface(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            case, _oracle = self._case_and_oracle(Path(temporary))
            tool_name_sets = {
                condition: [item["function"]["name"] for item in agent_tools(condition, "canonical-information")]
                for condition in ("no-memory", "raw-record", "memorix-native")
            }
            self.assertEqual(tool_name_sets["no-memory"], tool_name_sets["raw-record"])
            self.assertEqual(tool_name_sets["raw-record"], tool_name_sets["memorix-native"])
            self.assertIn("project_predecessor_context", tool_name_sets["no-memory"])
            self.assertIn("project_predecessor_detail", tool_name_sets["no-memory"])
            fixed_prompt = _messages(case, "fixed-index")[0]["content"]
            self.assertIn("project_predecessor_context", fixed_prompt)
            self.assertIn("project_predecessor_detail", fixed_prompt)
            self.assertIn("Do not stop solely because verification failed", fixed_prompt)
            self.assertNotIn(case.predecessor_record, fixed_prompt)

            raw = CanonicalEvidenceTool(case, "raw-record")
            raw_context = raw.context()
            raw_detail = raw.detail(1)
            self.assertEqual(raw_context["records"], [{"id": 1}])
            self.assertTrue(raw.record_available)
            self.assertIn("durable decision", raw_detail["detail"])
            self.assertEqual(raw.retrieved_chars, len(raw_detail["detail"]))

            none = CanonicalEvidenceTool(case, "no-memory")
            none_context = none.context()
            self.assertEqual(none_context["records"], [])
            self.assertFalse(none.record_available)
            none_detail = none.detail(1)
            self.assertIn("No predecessor evidence", none_detail["detail"])
            self.assertEqual(none.retrieved_chars, 0)

    def test_fixed_index_policy_delivers_evidence_before_a_source_edit(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            case, oracle = self._case_and_oracle(root)
            client = ScriptedClient(
                [
                    ModelReply(None, (ToolCall("context", "project_predecessor_context", {}),), "example/model", "response-1", 1, 1, None),
                    ModelReply(None, (ToolCall("detail", "project_predecessor_detail", {"id": 1}),), "example/model", "response-2", 1, 1, None),
                    ModelReply(None, (ToolCall("replace", "replace_text", {"path": "src/task.py", "old_text": "pending", "new_text": "done"}),), "example/model", "response-3", 1, 1, None),
                    ModelReply("finished", (), "example/model", "response-4", 1, 1, None),
                ]
            )
            outcome = run_trial(
                TrialConfig(
                    case=case,
                    oracle=oracle,
                    condition="raw-record",
                    requested_model="example/model",
                    artifact_root=root / "artifacts",
                    surface_profile="canonical-information",
                    evidence_policy="fixed-index",
                ),
                client,
            )
            payload = outcome["payload"]
            self.assertEqual(payload["status"], "completed")
            self.assertTrue(payload["task_success"])
            self.assertTrue(payload["evidence_policy"]["compliant"])
            self.assertEqual(payload["evidence_policy"]["context_calls"], 1)
            self.assertEqual(payload["evidence_policy"]["detail_calls"], 1)
            self.assertTrue(payload["evidence_policy"]["index_record_available"])
            self.assertNotIn(case.predecessor_record, outcome["receipt_path"].read_text(encoding="utf-8"))
            self.assertIn(case.predecessor_record, outcome["evidence_path"].read_text(encoding="utf-8"))

    def test_fixed_index_policy_marks_early_edits_invalid(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            case, oracle = self._case_and_oracle(root)
            client = ScriptedClient(
                [
                    ModelReply(None, (ToolCall("write", "write_file", {"path": "src/task.py", "content": "done\n"}),), "example/model", "response-1", 1, 1, None),
                    ModelReply("finished", (), "example/model", "response-2", 1, 1, None),
                ]
            )
            outcome = run_trial(
                TrialConfig(
                    case=case,
                    oracle=oracle,
                    condition="raw-record",
                    requested_model="example/model",
                    artifact_root=root / "artifacts",
                    surface_profile="canonical-information",
                    evidence_policy="fixed-index",
                ),
                client,
            )
            payload = outcome["payload"]
            self.assertEqual(payload["status"], "invalid")
            self.assertEqual(payload["task_success"], None)
            self.assertFalse(payload["evidence_policy"]["compliant"])
            self.assertIn("predecessor index", payload["invalid_reason"])

    def test_transfer_workspace_starts_with_a_clean_git_baseline(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            workspace = Path(temporary) / "workspace"
            (workspace / "src").mkdir(parents=True)
            (workspace / "src" / "task.py").write_text("pending\n", encoding="utf-8")
            trial._initialize_git(workspace)
            status = trial._run(["git", "status", "--porcelain"], cwd=workspace, timeout_seconds=10)
            self.assertEqual(status.returncode, 0)
            self.assertEqual(status.stdout.strip(), "")

    def test_native_workset_membership_requires_the_seed_observation(self) -> None:
        payload = {"workset": {"reliableMemory": [{"id": 7}], "evidenceIds": []}}
        self.assertTrue(_workset_includes_observation(payload, 7))
        self.assertFalse(_workset_includes_observation(payload, 8))
        self.assertIsNone(_workset_includes_observation(payload, None))

    def test_case_rejects_escape_path(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            manifest = root / "case.json"
            manifest.write_text(
                json.dumps({"schema_version": 2, "id": "bad", "title": "Bad", "case_class": "source-sufficient-control", "case_tier": "synthetic-engineering-smoke", "task": "x", "source_root": "../outside", "writable_paths": ["src"], "predecessor_record": "x", "predecessor_memory": {"type": "discovery", "files": ["src/task.py"], "concepts": []}, "evidence_char_budget": 256}),
                encoding="utf-8",
            )
            with self.assertRaises(ValueError):
                CaseSpec.load(manifest)

    def test_source_copy_skips_local_runtime_directories(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "source"
            target = root / "target"
            (source / "src").mkdir(parents=True)
            (source / "src" / "module.py").write_text("visible\n", encoding="utf-8")
            (source / ".venv" / "Scripts").mkdir(parents=True)
            (source / ".venv" / "Scripts" / "python.exe").write_text("runtime\n", encoding="utf-8")
            trial._copy_source(source, target)
            self.assertTrue((target / "src" / "module.py").is_file())
            self.assertFalse((target / ".venv").exists())

    def test_native_context_uses_only_bounded_agent_prompt(self) -> None:
        prompt = _native_context_prompt(
            {
                "operator_only": {"local_path": "must not be sent"},
                "workset": {"prompt": "Memorix Autopilot Brief\nUse current code."},
            }
        )
        self.assertEqual(prompt, "Memorix Autopilot Brief\nUse current code.")
        with self.assertRaises(RuntimeError):
            _native_context_prompt({"workset": {"prompt": ""}})

    def test_native_product_delivers_the_real_brief_and_cited_detail(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            case, oracle = self._case_and_oracle(root)
            native = trial.MemorixContextTool(
                config=TrialConfig(
                    case=case,
                    oracle=oracle,
                    condition="memorix-native",
                    requested_model="example/model",
                    artifact_root=root / "artifacts",
                ),
                workspace=root,
            )
            native.seed_receipt = {"returncode": 0}
            native.seed_observation_id = 7
            native.transfer_prepared = True
            calls: list[list[str]] = []
            original_run = trial._run
            try:
                def fake_run(command, **_kwargs):
                    calls.append(command)
                    if command[1] == "context":
                        return type(
                            "Completed",
                            (),
                            {
                                "returncode": 0,
                                "stderr": "",
                                "stdout": json.dumps(
                                    {
                                        "workset": {
                                            "prompt": "Memorix Autopilot Brief\\nReliable memory\\n- #7 decision: durable rule",
                                            "reliableMemory": [{"id": 7}],
                                        }
                                    }
                                ),
                            },
                        )()
                    return type(
                        "Completed",
                        (),
                        {
                            "returncode": 0,
                            "stderr": "",
                            "stdout": json.dumps(
                                {
                                    "documents": [
                                        {
                                            "observationId": 7,
                                            "title": "Durable rule",
                                            "narrative": "Use the current decision.",
                                        }
                                    ]
                                }
                            ),
                        },
                    )()

                trial._run = fake_run
                context = native.context()
                self.assertIn("#7 decision", context["brief"])
                self.assertEqual(context["cited_memory_ids"], [7])
                self.assertNotIn("records", context)
                self.assertTrue(native.context_includes_seed)
                with self.assertRaises(ValueError):
                    native.detail(1)
                detail = native.detail(7)
            finally:
                trial._run = original_run
            self.assertIn("Durable rule", detail["detail"])
            self.assertIn("7", calls[-1])
            self.assertEqual(native.context_retrieved_chars, len(context["brief"]))

    def test_canonical_profile_hides_native_ids_behind_the_common_alias(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            case, oracle = self._case_and_oracle(root)
            canonical = trial.MemorixContextTool(
                config=TrialConfig(
                    case=case,
                    oracle=oracle,
                    condition="memorix-native",
                    requested_model="example/model",
                    artifact_root=root / "artifacts",
                    surface_profile="canonical-information",
                    evidence_policy="fixed-index",
                ),
                workspace=root,
            )
            canonical.seed_receipt = {"returncode": 0}
            canonical.seed_observation_id = 7
            canonical.transfer_prepared = True
            calls: list[list[str]] = []
            original_run = trial._run
            try:
                def fake_run(command, **_kwargs):
                    calls.append(command)
                    if command[1] == "context":
                        return type(
                            "Completed",
                            (),
                            {
                                "returncode": 0,
                                "stderr": "",
                                "stdout": json.dumps(
                                    {
                                        "workset": {
                                            "prompt": "Memorix Autopilot Brief\\nReliable memory\\n- #7 decision: durable rule",
                                            "reliableMemory": [{"id": 7}],
                                        }
                                    }
                                ),
                            },
                        )()
                    return type(
                        "Completed",
                        (),
                        {
                            "returncode": 0,
                            "stderr": "",
                            "stdout": json.dumps(
                                {
                                    "documents": [
                                        {
                                            "observationId": 7,
                                            "title": "Durable rule",
                                            "narrative": "Use the current decision.",
                                        }
                                    ]
                                }
                            ),
                        },
                    )()

                trial._run = fake_run
                context = canonical.context()
                self.assertEqual(context["records"], [{"id": 1}])
                self.assertNotIn("brief", context)
                canonical.detail(1)
            finally:
                trial._run = original_run
            self.assertIn("7", calls[-1])
            self.assertEqual(canonical.context_retrieved_chars, 0)

    def test_memory_detail_strips_operator_metadata(self) -> None:
        detail = _native_memory_detail(
            {
                "project": {"rootPath": "must not reach the model"},
                "documents": [
                    {
                        "observationId": 7,
                        "title": "Durable rule",
                        "narrative": "Use zero as an explicit disable.",
                        "projectId": "operator-only",
                    }
                ],
            }
        )
        self.assertIn("Durable rule", detail)
        self.assertNotIn("operator-only", detail)
        self.assertNotIn("rootPath", detail)

    def test_windows_shim_resolution_accepts_cmd_wrapper(self) -> None:
        original_which = trial.shutil.which
        original_platform = trial.sys.platform
        try:
            trial.sys.platform = "win32"
            trial.shutil.which = lambda name: "C:/npm/memorix.cmd" if name == "memorix.cmd" else None
            self.assertEqual(trial._resolve_executable("memorix"), "C:/npm/memorix.cmd")
        finally:
            trial.shutil.which = original_which
            trial.sys.platform = original_platform

    def test_native_preflight_records_delivery_without_model_execution(self) -> None:
        class FakeMemorixContextTool:
            def __init__(self, *, config, workspace) -> None:
                self.config = config
                self.workspace = workspace
                self.cli = "fake-memorix"
                self.version = None
                self.seed_receipt = None
                self.seed_observation_id = None
                self.codegraph_refresh_receipt = None
                self.codegraph_refresh_elapsed_ms = None
                self.context_includes_seed = None
                self.detail_delivered = False
                self.context_hashes: list[str] = []
                self.detail_hashes: list[str] = []
                self.retrieved_chars = 0
                self.context_retrieved_chars = 0
                self.formation_elapsed_ms = None
                self.cited_observation_ids = (7,)

            def seed(self) -> None:
                self.version = "fake-memorix"
                self.seed_receipt = {"returncode": 0, "stdout_sha256": "a" * 64, "stderr_sha256": "b" * 64}
                self.seed_observation_id = 7
                self.formation_elapsed_ms = 1

            def context(self) -> dict[str, object]:
                self.context_includes_seed = True
                digest = sha256_text("index")
                self.context_hashes.append(digest)
                return {"context_sha256": digest}

            def prepare_transfer(self) -> None:
                self.codegraph_refresh_receipt = {"returncode": 0, "stdout_sha256": "c" * 64, "stderr_sha256": "d" * 64}
                self.codegraph_refresh_elapsed_ms = 1

            def detail(self, observation_id: int) -> dict[str, object]:
                if observation_id != 7:
                    raise ValueError("wrong observation")
                self.detail_delivered = True
                self.retrieved_chars = 20
                digest = sha256_text("detail")
                self.detail_hashes.append(digest)
                return {"detail_sha256": digest}

        original_tool = preflight.MemorixContextTool
        try:
            preflight.MemorixContextTool = FakeMemorixContextTool
            with tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                case, oracle = self._case_and_oracle(root)
                outcome = preflight.run_native_preflight(
                    case=case,
                    oracle=oracle,
                    artifact_root=root / "preflight",
                )
                payload = outcome["payload"]
                self.assertEqual(payload["status"], "passed")
                self.assertEqual(payload["runner"]["protocol_version"], "1.8-draft")
                self.assertRegex(payload["runner"]["source_tree_sha256"], r"^[0-9a-f]{64}$")
                self.assertFalse(payload["oracle"]["baseline_passed"])
                self.assertTrue(payload["workspace"]["source_unchanged"])
                self.assertTrue(payload["native"]["context_includes_seed"])
                self.assertTrue(payload["native"]["detail_delivered"])
                self.assertEqual(payload["codegraph_refresh"]["returncode"], 0)
                receipt = outcome["receipt_path"].read_text(encoding="utf-8")
                self.assertNotIn(str(root), receipt)
                self.assertNotIn(case.predecessor_record, receipt)
                with self.assertRaises(RuntimeError):
                    preflight.run_native_preflight(
                        case=case,
                        oracle=oracle,
                        artifact_root=root / "preflight",
                    )
        finally:
            preflight.MemorixContextTool = original_tool

    def test_preflight_workspaces_have_distinct_local_project_identities(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            first = preflight._preflight_workspace_path(root / "left" / "same-run", "case-a")
            second = preflight._preflight_workspace_path(root / "right" / "same-run", "case-a")
            self.assertNotEqual(first.name, "workspace")
            self.assertNotEqual(first.name, second.name)
            self.assertTrue(first.name.startswith("workspace-"))

    def test_native_transfer_preparation_requires_a_seed_and_records_refresh(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            case, oracle = self._case_and_oracle(root)
            tool = trial.MemorixContextTool(
                config=TrialConfig(
                    case=case,
                    oracle=oracle,
                    condition="memorix-native",
                    requested_model="example/model",
                    artifact_root=root / "artifacts",
                ),
                workspace=root,
            )
            with self.assertRaises(RuntimeError):
                tool.prepare_transfer()
            with self.assertRaises(RuntimeError):
                tool.context()
            tool.seed_receipt = {"returncode": 0, "stdout_sha256": "a" * 64, "stderr_sha256": "b" * 64}
            original_run = trial._run
            calls: list[list[str]] = []
            try:
                def fake_run(command, **_kwargs):
                    calls.append(command)
                    return type("Completed", (), {"returncode": 0, "stdout": "{}", "stderr": ""})()

                trial._run = fake_run
                tool.prepare_transfer()
            finally:
                trial._run = original_run
            self.assertTrue(tool.transfer_prepared)
            self.assertEqual(calls[0][1:3], ["codegraph", "refresh"])
            self.assertEqual(tool.codegraph_refresh_receipt["returncode"], 0)
            with self.assertRaises(ValueError):
                tool.prepare_transfer()

            failed_tool = trial.MemorixContextTool(
                config=tool.config,
                workspace=root,
            )
            failed_tool.seed_receipt = tool.seed_receipt
            try:
                def failed_run(_command, **_kwargs):
                    return type("Completed", (), {"returncode": 1, "stdout": "", "stderr": "refresh failed"})()

                trial._run = failed_run
                with self.assertRaises(RuntimeError):
                    failed_tool.prepare_transfer()
            finally:
                trial._run = original_run
            self.assertFalse(failed_tool.transfer_prepared)
            self.assertEqual(failed_tool.codegraph_refresh_receipt["returncode"], 1)

    def test_native_preflight_retains_a_failed_refresh_receipt(self) -> None:
        class FailingRefreshTool:
            def __init__(self, *, config, workspace) -> None:
                self.config = config
                self.workspace = workspace
                self.version = "fake-memorix"
                self.seed_receipt = None
                self.seed_observation_id = None
                self.codegraph_refresh_receipt = None
                self.codegraph_refresh_elapsed_ms = None
                self.context_includes_seed = None
                self.detail_delivered = False
                self.context_hashes: list[str] = []
                self.detail_hashes: list[str] = []
                self.retrieved_chars = 0
                self.formation_elapsed_ms = None

            def seed(self) -> None:
                self.seed_receipt = {"returncode": 0, "stdout_sha256": "a" * 64, "stderr_sha256": "b" * 64}
                self.seed_observation_id = 7
                self.formation_elapsed_ms = 1

            def prepare_transfer(self) -> None:
                self.codegraph_refresh_receipt = {"returncode": 1, "stdout_sha256": "c" * 64, "stderr_sha256": "d" * 64}
                self.codegraph_refresh_elapsed_ms = 1
                raise RuntimeError("refresh failed")

        original_tool = preflight.MemorixContextTool
        try:
            preflight.MemorixContextTool = FailingRefreshTool
            with tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                case, oracle = self._case_and_oracle(root)
                outcome = preflight.run_native_preflight(
                    case=case,
                    oracle=oracle,
                    artifact_root=root / "preflight",
                )
                payload = outcome["payload"]
                self.assertEqual(payload["status"], "failed")
                self.assertEqual(payload["failure"], "codegraph-refresh:RuntimeError")
                self.assertEqual(payload["codegraph_refresh"]["returncode"], 1)
                self.assertTrue(payload["workspace"]["source_unchanged"])
        finally:
            preflight.MemorixContextTool = original_tool
