from __future__ import annotations

import json
from pathlib import Path
import sys
import tempfile
import unittest
import zipfile

from memorixbench.models import CaseSpec, ModelReply, OracleSpec, RouteSpec, sha256_file, sha256_tree, sha256_zip_tree
from memorixbench.openrouter import _optional_float, _optional_int
from memorixbench.sandbox import ToolSandbox
from memorixbench.trial import TrialConfig, run_trial


class _UnexpectedClient:
    def chat(self, _messages, _tools):
        raise AssertionError("the source-backed trial must reject before a model request")


def _write_source_archive(archive: Path, source: Path, archive_root: str = "source") -> None:
    with zipfile.ZipFile(archive, "w") as bundle:
        for path in sorted(candidate for candidate in source.rglob("*") if candidate.is_file()):
            relative = path.relative_to(source).as_posix()
            bundle.writestr(f"{archive_root}/{relative}", path.read_bytes())


class FrozenInputTests(unittest.TestCase):
    def test_zip_and_unpacked_tree_use_the_same_portable_path_order(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "source"
            source.mkdir()
            (source / "a.txt").write_text("lowercase first on Windows paths\n", encoding="utf-8")
            (source / "B.txt").write_text("uppercase first in POSIX sort\n", encoding="utf-8")
            nested = source / "nested"
            nested.mkdir()
            (nested / "module.py").write_text("nested\n", encoding="utf-8")
            archive = root / "source.zip"
            _write_source_archive(archive, source)
            self.assertEqual(sha256_tree(source), sha256_zip_tree(archive, "source"))

    def test_route_manifest_freezes_actual_model_usage_and_budget(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            route_path = Path(temporary) / "route.json"
            route_path.write_text(
                json.dumps(
                    {
                        "schema_version": 1,
                        "provider": "openrouter",
                        "requested_model": "provider/requested-model",
                        "expected_actual_model": "provider/actual-model",
                        "provider_timeout_seconds": 90,
                        "max_output_tokens": 1200,
                        "max_cost_usd": 0.5,
                        "temperature": 0,
                        "tool_choice": "auto",
                    }
                ),
                encoding="utf-8",
            )
            route = RouteSpec.load(route_path)
            self.assertEqual(route.requested_model, "provider/requested-model")
            self.assertRegex(route.definition_sha256, r"^[0-9a-f]{64}$")
            matching = ModelReply(None, (), "provider/actual-model", None, 1, 1200, 0.1)
            self.assertIsNone(route.reply_violation(matching, 0.1))
            self.assertEqual(
                route.reply_violation(ModelReply(None, (), "other/model", None, 1, 1, 0.1), 0.1),
                "actual-model-mismatch",
            )
            self.assertEqual(
                route.reply_violation(ModelReply(None, (), "provider/actual-model", None, 1, 1201, 0.1), 0.1),
                "output-budget-exceeded",
            )
            self.assertEqual(
                route.reply_violation(ModelReply(None, (), "provider/actual-model", None, 1, 1, 0.1), 0.6),
                "cost-budget-exceeded",
            )
            self.assertEqual(
                route.reply_violation(ModelReply(None, (), "provider/actual-model", None, -1, 1, 0.1), 0.1),
                "provider-usage-invalid",
            )
            self.assertEqual(
                route.reply_violation(ModelReply(None, (), "provider/actual-model", None, 1, 1, float("nan")), 0.1),
                "provider-usage-invalid",
            )
            self.assertEqual(
                route.reply_violation(ModelReply(None, (), "provider/actual-model", None, 1, 1, 0.1), float("inf")),
                "provider-usage-invalid",
            )

    def test_openrouter_usage_parsing_rejects_lossy_or_unsafe_values(self) -> None:
        self.assertEqual(_optional_int(3), 3)
        self.assertIsNone(_optional_int(3.0))
        self.assertIsNone(_optional_int(-1))
        self.assertIsNone(_optional_int(True))
        self.assertEqual(_optional_float(0.25), 0.25)
        self.assertIsNone(_optional_float(-0.01))
        self.assertIsNone(_optional_float(float("nan")))
        self.assertIsNone(_optional_float(float("inf")))

    def test_route_manifest_rejects_lossy_or_unsafe_budget_values(self) -> None:
        baseline = {
            "schema_version": 1,
            "provider": "openrouter",
            "requested_model": "provider/requested-model",
            "expected_actual_model": "provider/actual-model",
            "provider_timeout_seconds": 90,
            "max_output_tokens": 1200,
            "max_cost_usd": 0.5,
            "temperature": 0,
            "tool_choice": "auto",
        }
        invalid_values = (
            ("provider_timeout_seconds", 90.0, "integer"),
            ("provider_timeout_seconds", True, "integer"),
            ("max_output_tokens", 1200.0, "integer"),
            ("max_output_tokens", True, "integer"),
            ("max_cost_usd", float("nan"), "numeric"),
            ("temperature", float("inf"), "numeric"),
        )
        with tempfile.TemporaryDirectory() as temporary:
            route_path = Path(temporary) / "route.json"
            for field, value, message in invalid_values:
                with self.subTest(field=field, value=value):
                    route_path.write_text(
                        json.dumps({**baseline, field: value}),
                        encoding="utf-8",
                    )
                    with self.assertRaisesRegex(ValueError, message):
                        RouteSpec.load(route_path)

    def test_source_backed_case_rejects_tree_drift(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "source"
            source.mkdir()
            tracked = source / "module.py"
            tracked.write_text("baseline\n", encoding="utf-8")
            archive = root / "source.zip"
            _write_source_archive(archive, source)
            case_path = root / "case.json"
            case_path.write_text(
                json.dumps(
                    {
                        "schema_version": 4,
                        "id": "frozen-source",
                        "title": "Frozen source",
                        "case_class": "source-sufficient-control",
                        "case_tier": "exploratory-source-backed",
                        "task": "Repair the public behavior.",
                        "source_root": "source",
                        "source_tree_sha256": sha256_tree(source),
                        "source_commit": "a" * 40,
                        "source_archive": "source.zip",
                        "source_archive_sha256": sha256_file(archive),
                        "source_archive_root": "source",
                        "writable_paths": ["."],
                        "predecessor_record": "Preserve the public contract.",
                        "predecessor_memory": {
                            "type": "decision",
                            "files": ["module.py"],
                            "concepts": ["public behavior"],
                        },
                        "evidence_char_budget": 256,
                    }
                ),
                encoding="utf-8",
            )
            loaded = CaseSpec.load(case_path)
            self.assertEqual(loaded.source_tree_sha256, sha256_tree(source))
            self.assertEqual(loaded.source_archive_root, "source")
            tracked.write_text("changed\n", encoding="utf-8")
            with self.assertRaises(ValueError):
                CaseSpec.load(case_path)

    def test_source_backed_case_rejects_archive_drift(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "source"
            source.mkdir()
            (source / "module.py").write_text("baseline\n", encoding="utf-8")
            archive = root / "source.zip"
            _write_source_archive(archive, source)
            case_path = root / "case.json"
            case_path.write_text(
                json.dumps(
                    {
                        "schema_version": 4,
                        "id": "frozen-archive",
                        "title": "Frozen archive",
                        "case_class": "source-sufficient-control",
                        "case_tier": "exploratory-source-backed",
                        "task": "Repair the public behavior.",
                        "source_root": "source",
                        "source_tree_sha256": sha256_tree(source),
                        "source_commit": "a" * 40,
                        "source_archive": "source.zip",
                        "source_archive_sha256": sha256_file(archive),
                        "source_archive_root": "source",
                        "writable_paths": ["."],
                        "predecessor_record": "Preserve the public contract.",
                        "predecessor_memory": {
                            "type": "decision",
                            "files": ["module.py"],
                            "concepts": ["public behavior"],
                        },
                        "evidence_char_budget": 256,
                    }
                ),
                encoding="utf-8",
            )
            self.assertEqual(CaseSpec.load(case_path).source_archive_path, archive)
            archive.write_bytes(b"changed archive")
            with self.assertRaises(ValueError):
                CaseSpec.load(case_path)

    def test_source_backed_case_rejects_archive_content_mismatch(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "source"
            source.mkdir()
            (source / "module.py").write_text("baseline\n", encoding="utf-8")
            archived_source = root / "archived-source"
            archived_source.mkdir()
            (archived_source / "module.py").write_text("different\n", encoding="utf-8")
            archive = root / "source.zip"
            _write_source_archive(archive, archived_source)
            case_path = root / "case.json"
            case_path.write_text(
                json.dumps(
                    {
                        "schema_version": 4,
                        "id": "archive-content-mismatch",
                        "title": "Archive content mismatch",
                        "case_class": "source-sufficient-control",
                        "case_tier": "exploratory-source-backed",
                        "task": "Repair the public behavior.",
                        "source_root": "source",
                        "source_tree_sha256": sha256_tree(source),
                        "source_commit": "a" * 40,
                        "source_archive": "source.zip",
                        "source_archive_sha256": sha256_file(archive),
                        "source_archive_root": "source",
                        "writable_paths": ["."],
                        "predecessor_record": "Preserve the public contract.",
                        "predecessor_memory": {
                            "type": "decision",
                            "files": ["module.py"],
                            "concepts": ["public behavior"],
                        },
                        "evidence_char_budget": 256,
                    }
                ),
                encoding="utf-8",
            )
            with self.assertRaisesRegex(ValueError, "contents do not match"):
                CaseSpec.load(case_path)

    def test_source_backed_case_requires_schema_four(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "source"
            source.mkdir()
            (source / "module.py").write_text("baseline\n", encoding="utf-8")
            archive = root / "source.zip"
            _write_source_archive(archive, source)
            case_path = root / "case.json"
            case_path.write_text(
                json.dumps(
                    {
                        "schema_version": 3,
                        "id": "legacy-source-backed",
                        "title": "Legacy source-backed",
                        "case_class": "source-sufficient-control",
                        "case_tier": "exploratory-source-backed",
                        "task": "Repair the public behavior.",
                        "source_root": "source",
                        "source_tree_sha256": sha256_tree(source),
                        "source_commit": "a" * 40,
                        "source_archive": "source.zip",
                        "source_archive_sha256": sha256_file(archive),
                        "writable_paths": ["."],
                        "predecessor_record": "Preserve the public contract.",
                        "predecessor_memory": {
                            "type": "decision",
                            "files": ["module.py"],
                            "concepts": ["public behavior"],
                        },
                        "evidence_char_budget": 256,
                    }
                ),
                encoding="utf-8",
            )
            with self.assertRaisesRegex(ValueError, "require schema_version 4"):
                CaseSpec.load(case_path)

    def test_oracle_asset_drift_is_rejected_before_verification(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            workspace = root / "workspace"
            workspace.mkdir()
            oracle_dir = root / "oracle"
            oracle_dir.mkdir()
            verifier = oracle_dir / "verify.py"
            verifier.write_text("raise SystemExit(0)\n", encoding="utf-8")
            manifest = oracle_dir / "oracle.json"
            manifest.write_text(
                json.dumps(
                    {
                        "schema_version": 2,
                        "command": [sys.executable, "{oracle_dir}/verify.py", "{workspace}"],
                        "timeout_seconds": 10,
                        "assets": [
                            {
                                "path": "verify.py",
                                "sha256": sha256_file(verifier),
                            }
                        ],
                    }
                ),
                encoding="utf-8",
            )
            oracle = OracleSpec.load(manifest)
            sandbox = ToolSandbox(workspace, (".",), oracle)
            identity = sandbox.oracle_identity()
            self.assertEqual(identity["assets_sha256"], oracle.assets_sha256)
            self.assertNotIn(str(root), json.dumps(identity))
            self.assertTrue(sandbox.run_verification({})["passed"])
            verifier.write_text("raise SystemExit(1)\n", encoding="utf-8")
            with self.assertRaises(RuntimeError):
                sandbox.run_verification({})

    def test_source_backed_trial_requires_a_frozen_route_before_model_access(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "source"
            source.mkdir()
            (source / "module.py").write_text("baseline\n", encoding="utf-8")
            archive = root / "source.zip"
            _write_source_archive(archive, source)
            case_path = root / "case.json"
            case_path.write_text(
                json.dumps(
                    {
                        "schema_version": 4,
                        "id": "route-required",
                        "title": "Route required",
                        "case_class": "source-sufficient-control",
                        "case_tier": "exploratory-source-backed",
                        "task": "Repair the public behavior.",
                        "source_root": "source",
                        "source_tree_sha256": sha256_tree(source),
                        "source_commit": "a" * 40,
                        "source_archive": "source.zip",
                        "source_archive_sha256": sha256_file(archive),
                        "source_archive_root": "source",
                        "writable_paths": ["."],
                        "predecessor_record": "Preserve the public contract.",
                        "predecessor_memory": {
                            "type": "decision",
                            "files": ["module.py"],
                            "concepts": ["public behavior"],
                        },
                        "evidence_char_budget": 256,
                    }
                ),
                encoding="utf-8",
            )
            oracle_dir = root / "oracle"
            oracle_dir.mkdir()
            verifier = oracle_dir / "verify.py"
            verifier.write_text("raise SystemExit(0)\n", encoding="utf-8")
            oracle_path = oracle_dir / "oracle.json"
            oracle_path.write_text(
                json.dumps(
                    {
                        "schema_version": 2,
                        "command": [sys.executable, "{oracle_dir}/verify.py", "{workspace}"],
                        "timeout_seconds": 10,
                        "assets": [{"path": "verify.py", "sha256": sha256_file(verifier)}],
                    }
                ),
                encoding="utf-8",
            )
            with self.assertRaisesRegex(ValueError, "frozen oracle and route manifests"):
                run_trial(
                    TrialConfig(
                        case=CaseSpec.load(case_path),
                        oracle=OracleSpec.load(oracle_path),
                        condition="no-memory",
                        requested_model="provider/requested-model",
                        artifact_root=root / "artifacts",
                    ),
                    _UnexpectedClient(),
                )
