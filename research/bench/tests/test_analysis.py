from __future__ import annotations

import json
from pathlib import Path
import tempfile
import unittest

from memorixbench.analysis import ANALYSIS_SCHEMA, analyze_frozen_cohort, write_cohort_analysis
from memorixbench.cohort import COHORT_SCHEMA, build_schedule
from memorixbench.models import sha256_file


class CohortAnalysisTests(unittest.TestCase):
    def _write_complete_fixture(self, root: Path) -> tuple[Path, Path]:
        cases = [
            {"case_id": "case-a", "case_class": "source-sufficient-control"},
            {"case_id": "case-b", "case_class": "stale-conflict"},
        ]
        routes = [
            {
                "route_id": "model-a",
                "expected_actual_model": "provider/model-a",
                "action_calibration_receipt_sha256": "a" * 64,
            },
            {
                "route_id": "model-b",
                "expected_actual_model": "provider/model-b",
                "action_calibration_receipt_sha256": "b" * 64,
            },
        ]
        cohort_id = "cohort-0123456789ab"
        schedule = build_schedule(cohort_id=cohort_id, case_entries=cases, route_entries=routes)
        cohort_path = root / "cohort.json"
        cohort_path.write_text(
            json.dumps(
                {
                    "schema_version": COHORT_SCHEMA,
                    "status": "frozen",
                    "cohort_id": cohort_id,
                    "analysis_plan_sha256": "a" * 64,
                    "runner_source_tree_sha256": "runner-hash",
                    "docker_image": "memorixbench:test",
                    "docker_image_id": "image-id",
                    "cases": cases,
                    "routes": routes,
                    "expected_row_count": len(schedule),
                    "schedule": schedule,
                }
            ),
            encoding="utf-8",
        )
        cohort_hash = sha256_file(cohort_path)
        receipts = root / "runs" / "receipts"
        receipts.mkdir(parents=True)
        rows = {}
        actual_models = {route["route_id"]: route["expected_actual_model"] for route in routes}
        for index, row in enumerate(schedule):
            filename = f"row-{index}.json"
            receipt_path = receipts / filename
            task_success = row["condition"] == "memorix-native"
            receipt = {
                "schema_version": "exploratory-sealed-local-v2",
                "runner": {"source_tree_sha256": "runner-hash"},
                "case_id": row["case_id"],
                "condition": row["condition"],
                "study_role": "cohort",
                "surface_profile": "canonical-information",
                "evidence_policy": {"mode": "fixed-index"},
                "requested_model": row["route_id"],
                "route": {"expected_actual_model": actual_models[row["route_id"]]},
                "actual_models": [actual_models[row["route_id"]]],
                "status": "completed",
                "invalid_reason": None,
                "task_success": task_success,
                "resource_usage": {
                    "input_tokens": 100 + index,
                    "output_tokens": 20,
                    "total_tokens": 120 + index,
                    "transfer_elapsed_ms": 50 + index,
                    "tool_call_count": 3,
                    "ordinary_tool_call_count": 2,
                    "evidence_tool_call_count": 1,
                    "provider_reported_request_price_usd": None,
                },
                "case": {"class": row["case_class"]},
                "execution_environment": {
                    "mode": "docker-named-volume",
                    "docker_image": "memorixbench:test",
                    "docker_image_id": "image-id",
                },
            }
            receipt_path.write_text(json.dumps(receipt), encoding="utf-8")
            rows[row["row_id"]] = {
                "state": "finalized",
                "case_id": row["case_id"],
                "route_id": row["route_id"],
                "repetition": row["repetition"],
                "condition": row["condition"],
                "status": "completed",
                "task_success": task_success,
                "invalid_reason": None,
                "receipt_filename": filename,
                "receipt_sha256": sha256_file(receipt_path),
            }
        ledger_path = root / "runs" / "cohort-run-ledger.json"
        ledger_path.write_text(
            json.dumps(
                {
                    "schema_version": "memorixbench-frozen-cohort-run-ledger-v1",
                    "cohort_id": cohort_id,
                    "cohort_receipt_sha256": cohort_hash,
                    "rows": rows,
                }
            ),
            encoding="utf-8",
        )
        return cohort_path, root / "runs"

    def test_complete_cohort_generates_sanitized_paired_summary(self) -> None:
        artifact_parent = Path(__file__).resolve().parents[3] / "research" / "artifacts"
        with tempfile.TemporaryDirectory(dir=artifact_parent) as temporary:
            root = Path(temporary)
            cohort_path, run_root = self._write_complete_fixture(root)
            output = write_cohort_analysis(
                cohort_path=cohort_path,
                artifact_root=run_root,
                output_path=root / "analysis.json",
            )
            payload = json.loads(output.read_text(encoding="utf-8"))
        self.assertEqual(payload["schema_version"], ANALYSIS_SCHEMA)
        self.assertEqual(payload["row_accounting"]["planned_rows"], 36)
        self.assertEqual(payload["row_accounting"]["valid_rows"], 36)
        self.assertEqual(payload["row_accounting"]["task_success_rows"], 12)
        self.assertTrue(payload["paired_contrasts"])
        self.assertNotIn("receipt_filename", json.dumps(payload))

    def test_incomplete_ledger_is_rejected_before_analysis(self) -> None:
        artifact_parent = Path(__file__).resolve().parents[3] / "research" / "artifacts"
        with tempfile.TemporaryDirectory(dir=artifact_parent) as temporary:
            root = Path(temporary)
            cohort_path, run_root = self._write_complete_fixture(root)
            ledger_path = run_root / "cohort-run-ledger.json"
            ledger = json.loads(ledger_path.read_text(encoding="utf-8"))
            ledger["rows"].pop(next(iter(ledger["rows"])))
            ledger_path.write_text(json.dumps(ledger), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "incomplete"):
                analyze_frozen_cohort(cohort_path=cohort_path, artifact_root=run_root)

    def test_tampered_receipt_is_rejected_before_analysis(self) -> None:
        artifact_parent = Path(__file__).resolve().parents[3] / "research" / "artifacts"
        with tempfile.TemporaryDirectory(dir=artifact_parent) as temporary:
            root = Path(temporary)
            cohort_path, run_root = self._write_complete_fixture(root)
            receipt_path = next((run_root / "receipts").glob("*.json"))
            receipt = json.loads(receipt_path.read_text(encoding="utf-8"))
            receipt["actual_models"] = ["substituted-model"]
            receipt_path.write_text(json.dumps(receipt), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "hash"):
                analyze_frozen_cohort(cohort_path=cohort_path, artifact_root=run_root)

    def test_model_substitution_is_rejected_even_if_ledger_hash_is_changed(self) -> None:
        artifact_parent = Path(__file__).resolve().parents[3] / "research" / "artifacts"
        with tempfile.TemporaryDirectory(dir=artifact_parent) as temporary:
            root = Path(temporary)
            cohort_path, run_root = self._write_complete_fixture(root)
            receipt_path = next((run_root / "receipts").glob("*.json"))
            receipt = json.loads(receipt_path.read_text(encoding="utf-8"))
            receipt["actual_models"] = ["substituted-model"]
            receipt_path.write_text(json.dumps(receipt), encoding="utf-8")
            ledger_path = run_root / "cohort-run-ledger.json"
            ledger = json.loads(ledger_path.read_text(encoding="utf-8"))
            record = next(
                record
                for record in ledger["rows"].values()
                if record.get("receipt_filename") == receipt_path.name
            )
            record["receipt_sha256"] = sha256_file(receipt_path)
            ledger_path.write_text(json.dumps(ledger), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "model identity"):
                analyze_frozen_cohort(cohort_path=cohort_path, artifact_root=run_root)

    def test_action_calibration_receipt_cannot_enter_cohort_analysis(self) -> None:
        artifact_parent = Path(__file__).resolve().parents[3] / "research" / "artifacts"
        with tempfile.TemporaryDirectory(dir=artifact_parent) as temporary:
            root = Path(temporary)
            cohort_path, run_root = self._write_complete_fixture(root)
            receipt_path = next((run_root / "receipts").glob("*.json"))
            receipt = json.loads(receipt_path.read_text(encoding="utf-8"))
            receipt["study_role"] = "action-calibration"
            receipt_path.write_text(json.dumps(receipt), encoding="utf-8")
            ledger_path = run_root / "cohort-run-ledger.json"
            ledger = json.loads(ledger_path.read_text(encoding="utf-8"))
            record = next(
                record
                for record in ledger["rows"].values()
                if record.get("receipt_filename") == receipt_path.name
            )
            record["receipt_sha256"] = sha256_file(receipt_path)
            ledger_path.write_text(json.dumps(ledger), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "not explicitly labeled"):
                analyze_frozen_cohort(cohort_path=cohort_path, artifact_root=run_root)
