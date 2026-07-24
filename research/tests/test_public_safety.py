from __future__ import annotations

import json
from pathlib import Path

import pytest

from memorixbench.public_safety import (
    PublicSafetyError,
    reject_public_json_payload,
    reject_public_json_text,
    reject_public_text,
)


def test_reject_public_json_payload_checks_nested_values_and_keys() -> None:
    with pytest.raises(PublicSafetyError, match="absolute host path"):
        reject_public_json_payload({"events": [{"content": r"C:\\Users\\alice"}]})

    with pytest.raises(PublicSafetyError, match="credential-like"):
        reject_public_json_payload({"api_key=sk-abcdefghijklmnopqrstuv": "safe"})


def test_reject_public_text_does_not_treat_https_urls_as_windows_paths() -> None:
    reject_public_text("See https://github.com/AVIDS2/memorix for the source.")


def test_reject_public_text_does_not_treat_latex_row_breaks_as_unc_paths() -> None:
    reject_public_text("Condition & Success \\\\")


@pytest.mark.parametrize(
    "host_path",
    (
        r"C:\Users\alice\workspace",
        r"\\server\share\workspace",
        r"\\?\C:\Users\alice\workspace",
    ),
)
def test_reject_public_text_still_rejects_real_windows_host_paths(host_path: str) -> None:
    with pytest.raises(PublicSafetyError, match="absolute host path"):
        reject_public_text(host_path)


def test_reject_public_text_allows_runtime_secret_references_but_not_values() -> None:
    reject_public_text('api_key = os.environ.get("OPENROUTER_API_KEY")')
    reject_public_text("auth_token = settings.auth_token")

    with pytest.raises(PublicSafetyError, match="credential-like"):
        reject_public_text('api_key = "literal-secret-value"')


def test_reject_public_text_rejects_private_key_material_not_public_signature_headers() -> None:
    reject_public_text("-----BEGIN SSH SIGNATURE-----")

    with pytest.raises(PublicSafetyError, match="credential-like"):
        reject_public_text("-----BEGIN OPENSSH PRIVATE KEY-----")


@pytest.mark.parametrize(
"credential",
    (
        "ghp_" + "a" * 36,
        "github_pat_" + "a" * 36,
        "npm_" + "a" * 36,
    ),
)
def test_reject_public_text_checks_common_registry_and_vcs_tokens(credential: str) -> None:
    with pytest.raises(PublicSafetyError, match="credential-like"):
        reject_public_text(f"credential={credential}")


def test_public_research_docs_and_case_metadata_are_host_and_secret_free() -> None:
    research_root = Path(__file__).parents[1]
    repository_root = research_root.parent
    paths = [
        *research_root.glob("*.md"),
        *research_root.glob("*.toml"),
        *research_root.joinpath("cases").rglob("*.md"),
        *research_root.joinpath("cases").rglob("*.toml"),
        *research_root.joinpath("cases").rglob("*.json"),
        repository_root / "progress.txt",
        repository_root / "docs" / "dev-log" / "2026-07-20-agent-memory-research.md",
    ]

    for path in sorted(set(paths)):
        content = path.read_text(encoding="utf-8")
        reject_public_text(content)
        if path.suffix == ".json":
            reject_public_json_text(content)


def test_reject_public_json_text_checks_decoded_values_not_escape_syntax() -> None:
    raw = '{"note":"C:\\n"}'

    reject_public_json_text(raw)
    assert json.loads(raw)["note"] == "C:\n"
