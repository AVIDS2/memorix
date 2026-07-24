from pathlib import Path

from memorixbench.case_bundle import hash_case_tree


def test_case_tree_hash_ignores_reproducible_python_cache(tmp_path: Path) -> None:
    root = tmp_path / "case"
    root.mkdir()
    (root / "source.py").write_text("answer = 42\n", encoding="utf-8")
    before = hash_case_tree(root)
    cache = root / "__pycache__"
    cache.mkdir()
    (cache / "source.cpython-311.pyc").write_bytes(b"\x00cache")

    assert hash_case_tree(root) == before
