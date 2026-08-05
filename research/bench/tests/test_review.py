from __future__ import annotations

import json
from pathlib import Path
import tempfile
import unittest

from memorixbench.admission import PACKET_SCHEMA
from memorixbench.review import ReviewForm, write_review_audit, write_review_form


class ReviewFormTests(unittest.TestCase):
    def _packet(self, root: Path) -> Path:
        path = root / "packet.json"
        path.write_text(
            json.dumps(
                {
                    "schema": PACKET_SCHEMA,
                    "candidate": {
                        "id": "case-v1",
                        "proposed_class": "durable-decision-dependency",
                    },
                }
            ),
            encoding="utf-8",
        )
        return path

    def _complete(self, form: Path, *, decision: str = "admit") -> None:
        data = json.loads(form.read_text(encoding="utf-8"))
        data.update(
            {
                "reviewed_on": "2026-08-05",
                "reviewer_selected_class": "durable-decision-dependency",
                "current_source_assessment": "predecessor-material",
                "patch_answer_leak": "none",
                "provenance_and_scope_adequate": True,
                "decision": decision,
                "rationale": "The packet describes a real source ambiguity without exposing a patch-shaped answer.",
            }
        )
        form.write_text(json.dumps(data), encoding="utf-8")

    def test_writes_and_validates_a_completed_outcome_blind_form(self) -> None:
        artifact_parent = Path(__file__).resolve().parents[3] / "research" / "artifacts"
        with tempfile.TemporaryDirectory(dir=artifact_parent) as temporary:
            root = Path(temporary)
            packet = self._packet(root)
            form = write_review_form(
                packet_path=packet,
                reviewer_code="R1",
                output_path=root / "review.json",
            )
            self._complete(form)
            review = ReviewForm.load(form, packet_path=packet)
        self.assertEqual(review.case_id, "case-v1")
        self.assertEqual(review.decision, "admit")

    def test_rejects_an_outcome_oracle_leak_and_unknown_fields(self) -> None:
        artifact_parent = Path(__file__).resolve().parents[3] / "research" / "artifacts"
        with tempfile.TemporaryDirectory(dir=artifact_parent) as temporary:
            root = Path(temporary)
            packet = self._packet(root)
            form = write_review_form(
                packet_path=packet,
                reviewer_code="R2",
                output_path=root / "review.json",
            )
            self._complete(form)
            data = json.loads(form.read_text(encoding="utf-8"))
            data["oracle"] = "forbidden"
            form.write_text(json.dumps(data), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "oracle"):
                ReviewForm.load(form, packet_path=packet)

            data.pop("oracle")
            data["unstructured_notes"] = "Could accidentally contain private material."
            form.write_text(json.dumps(data), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "frozen schema"):
                ReviewForm.load(form, packet_path=packet)

    def test_audit_sanitizes_two_matching_reviews(self) -> None:
        artifact_parent = Path(__file__).resolve().parents[3] / "research" / "artifacts"
        with tempfile.TemporaryDirectory(dir=artifact_parent) as temporary:
            root = Path(temporary)
            packet_dir = root / "packets"
            packet_dir.mkdir()
            packet = self._packet(packet_dir)
            review_root = root / "reviews"
            for reviewer_code in ("R1", "R2"):
                form = write_review_form(
                    packet_path=packet,
                    reviewer_code=reviewer_code,
                    output_path=review_root / reviewer_code / packet.name,
                )
                self._complete(form)
            audit_path = write_review_audit(
                packet_dir=packet_dir,
                review_root=review_root,
                reviewer_codes=("R1", "R2"),
                output_path=root / "audit.json",
            )
            payload = json.loads(audit_path.read_text(encoding="utf-8"))
        self.assertTrue(payload["all_cases_admitted"])
        self.assertEqual(payload["cases"][0]["admission_state"], "admitted")
        self.assertNotIn("rationale", json.dumps(payload))

    def test_audit_requires_a_consensus_or_third_review(self) -> None:
        artifact_parent = Path(__file__).resolve().parents[3] / "research" / "artifacts"
        with tempfile.TemporaryDirectory(dir=artifact_parent) as temporary:
            root = Path(temporary)
            packet_dir = root / "packets"
            packet_dir.mkdir()
            packet = self._packet(packet_dir)
            review_root = root / "reviews"
            for reviewer_code, decision in (("R1", "admit"), ("R2", "revise")):
                form = write_review_form(
                    packet_path=packet,
                    reviewer_code=reviewer_code,
                    output_path=review_root / reviewer_code / packet.name,
                )
                self._complete(form, decision=decision)
            audit_path = write_review_audit(
                packet_dir=packet_dir,
                review_root=review_root,
                reviewer_codes=("R1", "R2"),
                output_path=root / "audit.json",
            )
            payload = json.loads(audit_path.read_text(encoding="utf-8"))
        self.assertFalse(payload["all_cases_admitted"])
        self.assertEqual(payload["cases"][0]["admission_state"], "needs-third-review")
