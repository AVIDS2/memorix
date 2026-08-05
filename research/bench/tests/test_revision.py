from __future__ import annotations

import json
from pathlib import Path
import tempfile
import unittest
import zipfile

from memorixbench.admission import write_review_packet
from memorixbench.models import sha256_file, sha256_tree
from memorixbench.revision import REVISION_SCHEMA, prepare_case_revision
from memorixbench.review import ReviewForm, write_review_form


class CaseRevisionTests(unittest.TestCase):
    def _write_case(self, root: Path, case_id: str, task: str) -> None:
        case_root = root / "cases" / case_id
        source = case_root / "seed" / "src"
        source.mkdir(parents=True)
        source_file = source / "widget.py"
        source_file.write_text("VALUE = 'old'\n", encoding="utf-8")
        archive = case_root / "source.zip"
        with zipfile.ZipFile(archive, "w") as bundle:
            bundle.writestr("seed/src/widget.py", source_file.read_bytes())
        case_path = case_root / "case.json"
        case_path.write_text(
            json.dumps(
                {
                    "schema_version": 4,
                    "id": case_id,
                    "title": f"Case {case_id}",
                    "case_class": "durable-decision-dependency",
                    "case_tier": "exploratory-source-backed",
                    "task": task,
                    "source_root": "seed",
                    "source_tree_sha256": sha256_tree(case_root / "seed"),
                    "source_commit": "a" * 40,
                    "source_archive": "source.zip",
                    "source_archive_sha256": sha256_file(archive),
                    "source_archive_root": "seed",
                    "writable_paths": ["src/widget.py"],
                    "predecessor_record": "Keep the durable widget compatibility decision.",
                    "predecessor_memory": {
                        "type": "decision",
                        "files": ["src/widget.py"],
                        "concepts": ["widget compatibility"],
                    },
                    "evidence_char_budget": 512,
                }
            ),
            encoding="utf-8",
        )
        (case_root / "admission.json").write_text(
            json.dumps(
                {
                    "schema_version": 1,
                    "candidate_id": case_id,
                    "repository_url": "https://github.com/example/widgets",
                    "license_spdx": "MIT",
                    "transfer_base_commit": "a" * 40,
                    "provenance_kind": "upstream-commit",
                    "public_history_url": "https://github.com/example/widgets/commit/" + "a" * 40,
                    "public_history_note": "The public transition is documented without private repair material.",
                    "classification_rationale": "The source does not cheaply settle the compatibility choice.",
                    "frozen_source_scope": ["src"],
                    "relevant_current_source_files": ["src/widget.py"],
                }
            ),
            encoding="utf-8",
        )

    def _complete_form(self, path: Path) -> None:
        payload = json.loads(path.read_text(encoding="utf-8"))
        payload.update(
            {
                "reviewed_on": "2026-08-05",
                "reviewer_selected_class": "durable-decision-dependency",
                "current_source_assessment": "predecessor-material",
                "patch_answer_leak": "none",
                "provenance_and_scope_adequate": True,
                "decision": "admit",
                "rationale": "The packet describes a real source ambiguity without exposing a patch-shaped answer.",
            }
        )
        path.write_text(json.dumps(payload), encoding="utf-8")

    def test_creates_new_packets_reuses_unchanged_forms_and_blanks_revised_forms(self) -> None:
        artifact_parent = Path(__file__).resolve().parents[3] / "research" / "artifacts"
        repository = Path(__file__).resolve().parents[3]
        with tempfile.TemporaryDirectory(dir=artifact_parent) as temporary:
            root = Path(temporary)
            self._write_case(root, "unchanged-v1", "Keep supported behavior unchanged.")
            self._write_case(root, "revised-v1", "Old task wording reveals too much.")
            parent_cases = root / "cases"
            parent_packets = root / "packets"
            parent_forms = root / "forms"
            for case_dir in sorted(path for path in parent_cases.iterdir() if path.is_dir()):
                packet = write_review_packet(
                    case_path=case_dir / "case.json",
                    admission_path=case_dir / "admission.json",
                    output_path=parent_packets / f"{case_dir.name}.json",
                )
                for reviewer in ("R1", "R2"):
                    form = write_review_form(
                        packet_path=packet,
                        reviewer_code=reviewer,
                        output_path=parent_forms / reviewer / packet.name,
                    )
                    self._complete_form(form)

            original_case = parent_cases / "revised-v1" / "case.json"
            relative = lambda path: path.relative_to(repository).as_posix()
            manifest = {
                "schema_version": REVISION_SCHEMA,
                "revision_id": "test-revision",
                "reviewer_codes": ["R1", "R2"],
                "parent": {
                    "case_bank": relative(parent_cases),
                    "review_packets": relative(parent_packets),
                    "review_forms": relative(parent_forms),
                },
                "output": {
                    "case_bank": relative(root / "revised-cases"),
                    "review_packets": relative(root / "revised-packets"),
                    "review_forms": relative(root / "revised-forms"),
                    "receipt": relative(root / "revision-receipt.json"),
                },
                "revisions": [
                    {
                        "case_id": "revised-v1",
                        "base_case_card_sha256": sha256_file(original_case),
                        "task": "Revised task wording names the compatibility report without supplying the policy.",
                        "rationale": "The original task duplicated the policy that should remain material predecessor evidence.",
                    }
                ],
            }
            manifest_path = root / "revision.json"
            manifest_path.write_text(json.dumps(manifest), encoding="utf-8")

            outcome = prepare_case_revision(manifest_path=manifest_path)
            self.assertEqual(outcome["pending_re_review_case_ids"], ["revised-v1"])

            unchanged_packet = root / "revised-packets" / "unchanged-v1.json"
            self.assertEqual(
                unchanged_packet.read_bytes(),
                (parent_packets / "unchanged-v1.json").read_bytes(),
            )
            reused_form = root / "revised-forms" / "R1" / "unchanged-v1.json"
            self.assertEqual(reused_form.read_bytes(), (parent_forms / "R1" / "unchanged-v1.json").read_bytes())
            ReviewForm.load(reused_form, packet_path=unchanged_packet)

            revised_form = json.loads((root / "revised-forms" / "R2" / "revised-v1.json").read_text(encoding="utf-8"))
            self.assertIsNone(revised_form["decision"])
            self.assertIsNone(revised_form["reviewed_on"])
            revised_card = json.loads((root / "revised-cases" / "revised-v1" / "case.json").read_text(encoding="utf-8"))
            self.assertEqual(revised_card["task"], manifest["revisions"][0]["task"])

    def test_rejects_a_revision_against_the_wrong_parent_card(self) -> None:
        artifact_parent = Path(__file__).resolve().parents[3] / "research" / "artifacts"
        repository = Path(__file__).resolve().parents[3]
        with tempfile.TemporaryDirectory(dir=artifact_parent) as temporary:
            root = Path(temporary)
            self._write_case(root, "case-v1", "Original task.")
            parent_cases = root / "cases"
            parent_packets = root / "packets"
            parent_forms = root / "forms"
            packet = write_review_packet(
                case_path=parent_cases / "case-v1" / "case.json",
                admission_path=parent_cases / "case-v1" / "admission.json",
                output_path=parent_packets / "case-v1.json",
            )
            for reviewer in ("R1", "R2"):
                form = write_review_form(
                    packet_path=packet,
                    reviewer_code=reviewer,
                    output_path=parent_forms / reviewer / packet.name,
                )
                self._complete_form(form)
            relative = lambda path: path.relative_to(repository).as_posix()
            manifest = {
                "schema_version": REVISION_SCHEMA,
                "revision_id": "wrong-base",
                "reviewer_codes": ["R1", "R2"],
                "parent": {
                    "case_bank": relative(parent_cases),
                    "review_packets": relative(parent_packets),
                    "review_forms": relative(parent_forms),
                },
                "output": {
                    "case_bank": relative(root / "new-cases"),
                    "review_packets": relative(root / "new-packets"),
                    "review_forms": relative(root / "new-forms"),
                    "receipt": relative(root / "receipt.json"),
                },
                "revisions": [
                    {
                        "case_id": "case-v1",
                        "base_case_card_sha256": "0" * 64,
                        "task": "A revised task.",
                        "rationale": "The original task duplicated the policy that should remain material predecessor evidence.",
                    }
                ],
            }
            manifest_path = root / "revision.json"
            manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "base case card hash"):
                prepare_case_revision(manifest_path=manifest_path)

    def test_rejects_a_reused_form_stored_under_the_wrong_reviewer_code(self) -> None:
        artifact_parent = Path(__file__).resolve().parents[3] / "research" / "artifacts"
        repository = Path(__file__).resolve().parents[3]
        with tempfile.TemporaryDirectory(dir=artifact_parent) as temporary:
            root = Path(temporary)
            self._write_case(root, "case-v1", "Original task.")
            parent_cases = root / "cases"
            parent_packets = root / "packets"
            parent_forms = root / "forms"
            packet = write_review_packet(
                case_path=parent_cases / "case-v1" / "case.json",
                admission_path=parent_cases / "case-v1" / "admission.json",
                output_path=parent_packets / "case-v1.json",
            )
            for reviewer in ("R1", "R2"):
                form = write_review_form(
                    packet_path=packet,
                    reviewer_code=reviewer,
                    output_path=parent_forms / reviewer / packet.name,
                )
                self._complete_form(form)
            (parent_forms / "R1" / packet.name).write_bytes((parent_forms / "R2" / packet.name).read_bytes())
            relative = lambda path: path.relative_to(repository).as_posix()
            manifest = {
                "schema_version": REVISION_SCHEMA,
                "revision_id": "wrong-reviewer-code",
                "reviewer_codes": ["R1", "R2"],
                "parent": {
                    "case_bank": relative(parent_cases),
                    "review_packets": relative(parent_packets),
                    "review_forms": relative(parent_forms),
                },
                "output": {
                    "case_bank": relative(root / "new-cases"),
                    "review_packets": relative(root / "new-packets"),
                    "review_forms": relative(root / "new-forms"),
                    "receipt": relative(root / "receipt.json"),
                },
                "revisions": [],
            }
            manifest_path = root / "revision.json"
            manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "reviewer code does not match"):
                prepare_case_revision(manifest_path=manifest_path)
