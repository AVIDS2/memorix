from __future__ import annotations

from collections import Counter
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from memorixbench.cohort import (
    COHORT_SCHEMA,
    CohortReceipt,
    _CaseInput,
    _artifact_path,
    build_schedule,
    run_frozen_cohort,
)
from memorixbench.models import sha256_tree


class CohortTests(unittest.TestCase):
    def _cohort(self, root: Path) -> CohortReceipt:
        cases = [
            {"case_id": "case-a", "case_class": "source-sufficient-control"},
            {"case_id": "case-b", "case_class": "stale-conflict"},
        ]
        routes = [{"route_id": "model-a"}, {"route_id": "model-b"}]
        cohort_id = "cohort-0123456789ab"
        schedule = build_schedule(cohort_id=cohort_id, case_entries=cases, route_entries=routes)
        runner_source = Path(__file__).resolve().parents[1] / "src" / "memorixbench"
        return CohortReceipt(
            path=root / "cohort.json",
            definition_sha256="0" * 64,
            payload={
                "schema_version": COHORT_SCHEMA,
                "status": "frozen",
                "cohort_id": cohort_id,
                "runner_source_tree_sha256": sha256_tree(runner_source),
                "docker_image": "memorixbench:test",
                "docker_image_id": "image-id",
                "execution": {
                    "surface_profile": "canonical-information",
                    "evidence_policy": "fixed-index",
                    "max_steps": 24,
                    "memorix_timeout_seconds": 120,
                    "conditions": ["no-memory", "raw-record", "memorix-native"],
                    "repetitions": 3,
                },
                "cases": cases,
                "routes": routes,
                "expected_row_count": len(schedule),
                "schedule": schedule,
            },
        )

    def test_schedule_is_complete_deterministic_and_balanced(self) -> None:
        cases = [
            {"case_id": "case-b", "case_class": "stale-conflict"},
            {"case_id": "case-a", "case_class": "source-sufficient-control"},
        ]
        routes = [{"route_id": "model-b"}, {"route_id": "model-a"}]
        first = build_schedule(cohort_id="cohort-0123456789ab", case_entries=cases, route_entries=routes)
        second = build_schedule(
            cohort_id="cohort-0123456789ab",
            case_entries=list(reversed(cases)),
            route_entries=list(reversed(routes)),
        )
        self.assertEqual(first, second)
        self.assertEqual(len(first), 36)
        self.assertEqual(len({row["row_id"] for row in first}), 36)
        combinations = Counter(
            (row["case_id"], row["route_id"], row["repetition"], row["condition"])
            for row in first
        )
        self.assertTrue(all(count == 1 for count in combinations.values()))

    def test_cohort_artifacts_cannot_escape_the_research_boundary(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            with self.assertRaisesRegex(ValueError, "research/artifacts"):
                _artifact_path(Path(temporary) / "cohort.json")

    def test_receipt_rejects_a_tampered_schedule(self) -> None:
        artifact_parent = Path(__file__).resolve().parents[3] / "research" / "artifacts"
        with tempfile.TemporaryDirectory(dir=artifact_parent) as temporary:
            root = Path(temporary)
            cases = [
                {"case_id": "case-a", "case_class": "source-sufficient-control"},
                {"case_id": "case-b", "case_class": "stale-conflict"},
            ]
            routes = [{"route_id": "model-a"}, {"route_id": "model-b"}]
            schedule = build_schedule(
                cohort_id="cohort-0123456789ab",
                case_entries=cases,
                route_entries=routes,
            )
            receipt = root / "cohort.json"
            receipt.write_text(
                json.dumps(
                    {
                        "schema_version": COHORT_SCHEMA,
                        "status": "frozen",
                        "cohort_id": "cohort-0123456789ab",
                        "cases": cases,
                        "routes": routes,
                        "expected_row_count": len(schedule),
                        "schedule": schedule,
                    }
                ),
                encoding="utf-8",
            )
            self.assertEqual(CohortReceipt.load(receipt).cohort_id, "cohort-0123456789ab")
            schedule[0]["condition"] = "tampered"
            receipt.write_text(
                json.dumps(
                    {
                        "schema_version": COHORT_SCHEMA,
                        "status": "frozen",
                        "cohort_id": "cohort-0123456789ab",
                        "cases": cases,
                        "routes": routes,
                        "expected_row_count": len(schedule),
                        "schedule": schedule,
                    }
                ),
                encoding="utf-8",
            )
            with self.assertRaisesRegex(ValueError, "schedule"):
                CohortReceipt.load(receipt)

    def test_runner_finalizes_a_row_once_before_resuming_the_next(self) -> None:
        artifact_parent = Path(__file__).resolve().parents[3] / "research" / "artifacts"
        with tempfile.TemporaryDirectory(dir=artifact_parent) as temporary:
            root = Path(temporary)
            cohort = self._cohort(root)
            inputs = {
                case_id: _CaseInput(
                    case_path=root / f"{case_id}.json",
                    oracle_path=root / f"{case_id}-oracle.json",
                    receipt_entry={},
                )
                for case_id in ("case-a", "case-b")
            }
            calls = []

            def fake_trial(request):
                calls.append(request)
                receipt = request.artifact_root / "receipts" / f"row-{len(calls)}.json"
                receipt.parent.mkdir(parents=True, exist_ok=True)
                receipt.write_text("{}", encoding="utf-8")
                return {
                    "receipt_path": receipt,
                    "payload": {"status": "completed", "task_success": True, "invalid_reason": None},
                }

            with (
                patch("memorixbench.cohort.CohortReceipt.load", return_value=cohort),
                patch("memorixbench.cohort._private_case_inputs", return_value=inputs),
                patch(
                    "memorixbench.cohort._private_routes",
                    return_value={"model-a": root / "a.json", "model-b": root / "b.json"},
                ),
                patch("memorixbench.cohort._image_id", return_value="image-id"),
                patch("memorixbench.cohort.run_docker_trial", side_effect=fake_trial),
            ):
                first = run_frozen_cohort(
                    cohort_path=cohort.path,
                    case_bank=root,
                    route_paths=[],
                    artifact_root=root / "runs",
                    max_rows=1,
                )
                second = run_frozen_cohort(
                    cohort_path=cohort.path,
                    case_bank=root,
                    route_paths=[],
                    artifact_root=root / "runs",
                    max_rows=1,
                )
            ledger = json.loads(Path(first["ledger_path"]).read_text(encoding="utf-8"))
        self.assertEqual(first["completed_rows"], 1)
        self.assertEqual(second["completed_rows"], 2)
        self.assertEqual(len(calls), 2)
        self.assertEqual(len(ledger["rows"]), 2)

    def test_runner_refuses_to_repeat_an_unresolved_started_row(self) -> None:
        artifact_parent = Path(__file__).resolve().parents[3] / "research" / "artifacts"
        with tempfile.TemporaryDirectory(dir=artifact_parent) as temporary:
            root = Path(temporary)
            cohort = self._cohort(root)
            run_root = root / "runs"
            run_root.mkdir()
            first_row = cohort.payload["schedule"][0]
            (run_root / "cohort-run-ledger.json").write_text(
                json.dumps(
                    {
                        "schema_version": "memorixbench-frozen-cohort-run-ledger-v1",
                        "cohort_id": cohort.cohort_id,
                        "cohort_receipt_sha256": cohort.definition_sha256,
                        "rows": {first_row["row_id"]: {"state": "started"}},
                    }
                ),
                encoding="utf-8",
            )
            with (
                patch("memorixbench.cohort.CohortReceipt.load", return_value=cohort),
                patch("memorixbench.cohort._private_case_inputs", return_value={}),
                patch("memorixbench.cohort._private_routes", return_value={}),
                patch("memorixbench.cohort._image_id", return_value="image-id"),
            ):
                with self.assertRaisesRegex(RuntimeError, "started row"):
                    run_frozen_cohort(
                        cohort_path=cohort.path,
                        case_bank=root,
                        route_paths=[],
                        artifact_root=run_root,
                    )
