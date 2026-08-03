from __future__ import annotations

import json
from pathlib import Path
import sys
import tempfile
import unittest

from memorixbench.models import OracleSpec
from memorixbench.sandbox import ToolSandbox


class ToolSandboxTests(unittest.TestCase):
    def _sandbox(self, root: Path) -> ToolSandbox:
        oracle_root = root.parent / "oracle"
        oracle_root.mkdir()
        verifier = oracle_root / "verify.py"
        verifier.write_text(
            "from pathlib import Path\nimport sys\nroot=Path(sys.argv[1])\nraise SystemExit(0 if 'done' in (root / 'src' / 'task.py').read_text() else 1)\n",
            encoding="utf-8",
        )
        oracle = oracle_root / "oracle.json"
        oracle.write_text(
            json.dumps({"command": [sys.executable, str(verifier), "{workspace}"], "reveal_output": False}),
            encoding="utf-8",
        )
        return ToolSandbox(root, ("src",), OracleSpec.load(oracle))

    def test_visible_tools_cannot_escape_workspace_or_private_state(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / "workspace"
            (root / "src").mkdir(parents=True)
            (root / "src" / "task.py").write_text("pending\n", encoding="utf-8")
            (root / ".memorix").mkdir()
            (root / ".memorix" / "secret.txt").write_text("not visible", encoding="utf-8")
            sandbox = self._sandbox(root)

            files = sandbox.list_files({"path": "."})["files"]
            self.assertEqual(files, ["src/task.py"])
            with self.assertRaises(ValueError):
                sandbox.read_file({"path": "../oracle/oracle.json"})
            with self.assertRaises(ValueError):
                sandbox.read_file({"path": ".memorix/secret.txt"})
            with self.assertRaises(ValueError):
                sandbox.write_file({"path": "README.md", "content": "outside allowlist"})

    def test_verification_is_trusted_and_output_is_not_leaked(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / "workspace"
            (root / "src").mkdir(parents=True)
            (root / "src" / "task.py").write_text("pending\n", encoding="utf-8")
            sandbox = self._sandbox(root)

            first = sandbox.run_verification({})
            self.assertFalse(first["passed"])
            self.assertEqual(first["output"], "verification failed")
            sandbox.write_file({"path": "src/task.py", "content": "done\n"})
            second = sandbox.run_verification({})
            self.assertTrue(second["passed"])
            self.assertEqual(second["output"], "verification passed")
