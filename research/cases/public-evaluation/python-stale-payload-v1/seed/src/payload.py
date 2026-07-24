from collections.abc import Mapping
from typing import Any


def clean_payload(values: Mapping[str, Any]) -> dict[str, Any]:
    """Build the current API payload from optional input fields."""

    return dict(values)
