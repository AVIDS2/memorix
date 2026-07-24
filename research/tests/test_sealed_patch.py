from pathlib import Path

import pytest

import memorixbench.sealed_patch as sealed_patch_module
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


@pytest.mark.parametrize("unsafe_path", ("C:worker-output", "src/result:alternate-stream"))
def test_rejects_windows_drive_relative_and_ads_patch_paths(
    unsafe_path: str,
    tmp_path: Path,
) -> None:
    patch = _write_patch(
        tmp_path,
        f"diff --git a/{unsafe_path} b/{unsafe_path}\n",
    )

    with pytest.raises(SealedPatchError, match="Windows drive or stream"):
        seal_patch(patch)


def test_rejects_binary_worker_payloads(tmp_path: Path) -> None:
    patch = tmp_path / "candidate.patch"
    patch.write_bytes(b"GIT binary patch\n\x00")

    with pytest.raises(SealedPatchError, match="binary"):
        seal_patch(patch)


@pytest.mark.parametrize("mode", ("120000", "160000", "040000"))
def test_rejects_special_git_file_modes(mode: str, tmp_path: Path) -> None:
    patch = _write_patch(
        tmp_path,
        "\n".join((
            "diff --git a/unsafe b/unsafe",
            f"new file mode {mode}",
            "--- /dev/null",
            "+++ b/unsafe",
            "@@ -0,0 +1 @@",
            "+payload",
            "",
        )),
    )

    with pytest.raises(SealedPatchError, match="special Git file mode"):
        seal_patch(patch)


def test_rejects_a_windows_reparse_patch_source(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    patch = _write_patch(tmp_path, "diff --git a/value.txt b/value.txt\n")
    monkeypatch.setattr(
        sealed_patch_module,
        "_is_reparse_point",
        lambda path: path == patch,
    )

    with pytest.raises(SealedPatchError, match="regular file"):
        seal_patch(patch)
