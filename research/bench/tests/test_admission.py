from __future__ import annotations

import json
from pathlib import Path
import tempfile
import unittest
import zipfile

from memorixbench.admission import AdmissionSpec, PACKET_SCHEMA, write_review_packet
from memorixbench.models import CaseSpec, sha256_file, sha256_tree


class AdmissionPacketTests(unittest.TestCase):
    def _case_and_admission(self, root: Path) -> tuple[Path, Path]:
        case_root = root / "case"
        source_root = case_root / "seed" / "src"
        source_root.mkdir(parents=True)
        source_file = source_root / "widget.py"
        source_file.write_bytes(b"VALUE = 'old'\n")
        archive = case_root / "source.zip"
        with zipfile.ZipFile(archive, "w") as bundle:
            bundle.writestr("seed/src/widget.py", source_file.read_bytes())
        commit = "a" * 40
        case_path = case_root / "case.json"
        case_path.write_text(
            json.dumps(
                {
                    "schema_version": 4,
                    "id": "external-widget-v1",
                    "title": "External widget transition",
                    "case_class": "durable-decision-dependency",
                    "case_tier": "exploratory-source-backed",
                    "task": "Update the supported widget behavior without widening the writable scope.",
                    "source_root": "seed",
                    "source_tree_sha256": sha256_tree(case_root / "seed"),
                    "source_commit": commit,
                    "source_archive": "source.zip",
                    "source_archive_sha256": sha256_file(archive),
                    "source_archive_root": "seed",
                    "writable_paths": ["src"],
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
        admission_path = case_root / "admission.json"
        admission_path.write_text(
            json.dumps(
                {
                    "schema_version": 1,
                    "candidate_id": "external-widget-v1",
                    "repository_url": "https://github.com/example/widgets",
                    "license_spdx": "MIT",
                    "transfer_base_commit": commit,
                    "provenance_kind": "upstream-commit",
                    "public_history_url": "https://github.com/example/widgets/commit/" + commit,
                    "public_history_note": "The upstream transition is public; this packet records that exposure.",
                    "classification_rationale": "The source does not cheaply settle the compatibility choice.",
                    "frozen_source_scope": ["src"],
                    "relevant_current_source_files": ["src/widget.py"],
                }
            ),
            encoding="utf-8",
        )
        return case_path, admission_path

    def test_packet_contains_only_outcome_blind_fields(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            case_path, admission_path = self._case_and_admission(root)
            output = write_review_packet(
                case_path=case_path,
                admission_path=admission_path,
                output_path=root / "review" / "packet.json",
            )
            rendered = output.read_text(encoding="utf-8")
            payload = json.loads(rendered)
            self.assertEqual(payload["schema"], PACKET_SCHEMA)
            self.assertEqual(payload["candidate"]["id"], "external-widget-v1")
            self.assertEqual(payload["provenance"]["license_spdx"], "MIT")
            self.assertEqual(payload["provenance"]["frozen_source_scope"], ["src"])
            self.assertEqual(payload["transfer"]["predecessor_memory"]["files"], ["src/widget.py"])
            self.assertNotIn("oracle", rendered.lower())
            self.assertNotIn("reference_repair", rendered)
            self.assertNotIn(str(root), rendered)

    def test_rejects_private_oracle_fields(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            case_path, admission_path = self._case_and_admission(root)
            payload = json.loads(admission_path.read_text(encoding="utf-8"))
            payload["oracle_path"] = "private/oracle.json"
            admission_path.write_text(json.dumps(payload), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "private oracle"):
                AdmissionSpec.load(admission_path, case=CaseSpec.load(case_path))

    def test_rejects_source_file_outside_frozen_tree(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            case_path, admission_path = self._case_and_admission(root)
            payload = json.loads(admission_path.read_text(encoding="utf-8"))
            payload["relevant_current_source_files"] = ["../private.py"]
            admission_path.write_text(json.dumps(payload), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "source-relative"):
                AdmissionSpec.load(admission_path, case=CaseSpec.load(case_path))
