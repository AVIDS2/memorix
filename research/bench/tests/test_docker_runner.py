from __future__ import annotations

import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

from memorixbench.docker_runner import DockerTrialError, _prepare_runtime_inputs, _require_portable_oracle, _require_success, _safe_internal_file, _validated_artifact_root
from memorixbench.models import CaseSpec, OracleSpec, RouteSpec


class DockerRunnerTests(unittest.TestCase):
    def _route(self, root: Path) -> Path:
        route = root / "route.json"
        route.write_text(
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
        return route

    def test_runtime_staging_reloads_the_source_and_private_oracle_contracts(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            card = root / "card"
            source = card / "seed"
            source.mkdir(parents=True)
            (source / "src.py").write_text("value = 'baseline'\n", encoding="utf-8")
            (source / ".git").mkdir()
            (source / ".git" / "private.txt").write_text("not copied\n", encoding="utf-8")
            case_path = card / "case.json"
            case_path.write_text(
                json.dumps(
                    {
                        "schema_version": 2,
                        "id": "docker-stage-smoke",
                        "title": "Docker staging smoke",
                        "case_class": "source-sufficient-control",
                        "case_tier": "synthetic-engineering-smoke",
                        "task": "Repair the visible file.",
                        "source_root": "seed",
                        "writable_paths": ["."],
                        "predecessor_record": "The visible source is authoritative.",
                        "predecessor_memory": {"type": "decision", "files": ["src.py"], "concepts": ["source"]},
                        "evidence_char_budget": 256,
                    }
                ),
                encoding="utf-8",
            )
            oracle_root = root / "oracle"
            oracle_root.mkdir()
            verifier = oracle_root / "verify.py"
            verifier.write_text("raise SystemExit(0)\n", encoding="utf-8")
            oracle_path = oracle_root / "oracle.json"
            oracle_path.write_text(
                json.dumps({"command": ["python3", "{oracle_dir}/verify.py", "{workspace}"], "reveal_output": False}),
                encoding="utf-8",
            )
            stage = root / "stage"
            stage.mkdir()
            case = CaseSpec.load(case_path)
            oracle = OracleSpec.load(oracle_path)
            _prepare_runtime_inputs(
                temporary_root=stage,
                case_path=case_path,
                case=case,
                oracle_path=oracle_path,
                oracle=oracle,
                route_path=self._route(root),
            )
            staged_case = CaseSpec.load(stage / "card" / "case.json")
            self.assertTrue((staged_case.source_root / "src.py").is_file())
            self.assertFalse((staged_case.source_root / ".git").exists())
            self.assertEqual(OracleSpec.load(stage / "oracle" / "oracle.json").command[0], "python3")
            self.assertEqual(RouteSpec.load(stage / "route.json").provider, "opencode-go")

    def test_host_roots_and_unsafe_container_paths_are_rejected(self) -> None:
        with self.assertRaisesRegex(ValueError, "research/artifacts"):
            _validated_artifact_root(Path(tempfile.gettempdir()) / "memorixbench-runs")
        self.assertEqual(
            _safe_internal_file("/runs/artifacts/receipts/trial.json", expected_parent="receipts"),
            "/runs/artifacts/receipts/trial.json",
        )
        with self.assertRaisesRegex(Exception, "unsafe artifact path"):
            _safe_internal_file("/runs/artifacts/receipts/../secret.json", expected_parent="receipts")

    def test_windows_bound_oracle_executable_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            oracle_path = root / "oracle.json"
            oracle_path.write_text(
                json.dumps({"command": ["C:\\\\Python\\\\python.exe", "{workspace}"], "reveal_output": False}),
                encoding="utf-8",
            )
            with self.assertRaisesRegex(ValueError, "portable oracle executable"):
                _require_portable_oracle(OracleSpec.load(oracle_path))

    def test_docker_timeout_becomes_an_actionable_runner_error(self) -> None:
        with patch(
            "memorixbench.docker_runner._run",
            side_effect=subprocess.TimeoutExpired(["docker", "create"], 120),
        ):
            with self.assertRaisesRegex(DockerTrialError, "timed out after 120s: docker create"):
                _require_success(["docker", "create"], timeout_seconds=120)
