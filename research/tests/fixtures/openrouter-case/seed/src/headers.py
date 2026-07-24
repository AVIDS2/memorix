from collections.abc import Mapping


def merge_headers(defaults: Mapping[str, str], request: Mapping[str, str]) -> dict[str, str]:
    """Merge retry headers using the project's durable merge policy."""

    return {**defaults, **request}
