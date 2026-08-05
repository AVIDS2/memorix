"""Stable service identifiers for the current transfer snapshot."""


def normalize_service_slug(value: str) -> str:
    """Return a stable service slug.

    Strip outer whitespace, lowercase letters, and turn each run of spaces,
    underscores, or hyphens into one hyphen. Remove outer hyphens. Raise
    ValueError when the final value contains no alphanumeric character.
    """
    raise NotImplementedError
