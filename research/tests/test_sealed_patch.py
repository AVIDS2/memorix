from pathlib import Path

import pytest

from memorixbench.sealed_patch import SealedPatchError, seal_patch


def _write_patch(tmp_path: Path, text: str) -> Path:
    path = tmp_path / "candidate.patch"
    path.write_text(text, encoding="utf-8")
    return path


def test_seals_a_textual_git_patch_with_changed_paths(tmp_path: Path) -> None:
    patch = _write_patch(
        tmp_path,
        """diff --git a/src/policy.py b/src/policy.py
index 1111111..2222222 100644
--- a/src/policy.py
+++ b/src/policy.py
@@ -1 +1 @@
-old
+new
""",
    )

    sealed = seal_patch(patch)

    assert sealed.byte_count == len(patch.read_bytes())
    assert len(sealed.sha256) == 64
    assert sealed.changed_paths == ("src/policy.py",)


def test_rejects_patch_path_escape_or_git_metadata_write(tmp_path: Path) -> None:
    traversal = _write_patch(
        tmp_path,
        "diff --git a/../vault.txt b/../vault.txt\n",
    )
    with pytest.raises(SealedPatchError, match="escape"):
        seal_patch(traversal)

    git_metadata = _write_patch(
        tmp_path,
        "diff --git a/.git/config b/.git/config\n",
    )
    with pytest.raises(SealedPatchError, match="Git metadata"):
        seal_patch(git_metadata)


def test_rejects_binary_worker_payloads(tmp_path: Path) -> None:
    patch = tmp_path / "candidate.patch"
    patch.write_bytes(b"GIT binary patch\n\x00")

    with pytest.raises(SealedPatchError, match="binary"):
        seal_patch(patch)
