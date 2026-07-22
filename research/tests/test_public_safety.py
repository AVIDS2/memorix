from __future__ import annotations

import json

import pytest

from memorixbench.public_safety import (
    PublicSafetyError,
    reject_public_json_payload,
    reject_public_json_text,
)


def test_reject_public_json_payload_checks_nested_values_and_keys() -> None:
    with pytest.raises(PublicSafetyError, match="absolute host path"):
        reject_public_json_payload({"events": [{"content": r"C:\\Users\\alice"}]})

    with pytest.raises(PublicSafetyError, match="credential-like"):
        reject_public_json_payload({"api_key=sk-abcdefghijklmnopqrstuv": "safe"})


def test_reject_public_json_text_checks_decoded_values_not_escape_syntax() -> None:
    raw = '{"note":"C:\\n"}'

    reject_public_json_text(raw)
    assert json.loads(raw)["note"] == "C:\n"
