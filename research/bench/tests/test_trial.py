from __future__ import annotations

from dataclasses import dataclass
import json
from pathlib import Path
import sys
import tempfile
import unittest

from memorixbench.models import CaseSpec, ModelReply, OracleSpec, ToolCall
from memorixbench import trial
from memorixbench.trial import CanonicalEvidenceTool, RawRecordTool, TrialConfig, _messages, agent_tools, _native_context_prompt, _native_memory_detail, run_trial


@dataclass
class ScriptedClient:
    replies: list[ModelReply]

    def __post_init__(self) -> None:
        self.messages: list[list[dict[str, object]]] = []

    def chat(self, messages, _tools):
        self.messages.append(messages)
        return self.replies.pop(0)


class TrialTests(unittest.TestCase):
    def _case_and_oracle(self, root: Path) -> tuple[CaseSpec, OracleSpec]:
        case_root = root / "case"
        source_root = case_root / "seed" / "src"
        source_root.mkdir(parents=True)
        (source_root / "task.py").write_text("pending\n", encoding="utf-8")
        (case_root / "case.json").write_text(
            json.dumps(
                {
                    "schema_version": 1,
                    "id": "example",
                    "title": "Example policy",
                    "case_class": "durable-decision-dependency",
                    "case_tier": "synthetic-engineering-smoke",
                    "task": "Replace pending with done in src/task.py.",
                    "source_root": "seed",
                    "writable_paths": ["src"],
                    "predecessor_record": "The durable decision is to use done.",
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
            self.assertEqual(payload["runner"]["protocol_version"], "1.1-draft")
            self.assertRegex(payload["runner"]["source_tree_sha256"], r"^[0-9a-f]{64}$")
            self.assertEqual(payload["resource_usage"]["memory_context_calls"], 0)
            self.assertEqual(payload["resource_usage"]["raw_record_calls"], 1)
            self.assertEqual(payload["resource_usage"]["input_tokens"], 32)
            self.assertNotIn(str(root), outcome["receipt_path"].read_text(encoding="utf-8"))
            self.assertNotIn("durable decision", client.messages[0][1]["content"])

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

            raw = CanonicalEvidenceTool(case, "raw-record")
            raw_context = raw.context()
            raw_detail = raw.detail(1)
            self.assertIn("#1", raw_context["context"])
            self.assertIn("durable decision", raw_detail["detail"])
            self.assertEqual(raw.retrieved_chars, len(raw_detail["detail"]))

            none = CanonicalEvidenceTool(case, "no-memory")
            none.context()
            none_detail = none.detail(1)
            self.assertIn("No predecessor evidence", none_detail["detail"])
            self.assertEqual(none.retrieved_chars, 0)

    def test_case_rejects_escape_path(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            manifest = root / "case.json"
            manifest.write_text(
                json.dumps({"schema_version": 1, "id": "bad", "title": "Bad", "case_class": "source-sufficient-control", "case_tier": "synthetic-engineering-smoke", "task": "x", "source_root": "../outside", "writable_paths": ["src"], "predecessor_record": "x", "evidence_char_budget": 256}),
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
