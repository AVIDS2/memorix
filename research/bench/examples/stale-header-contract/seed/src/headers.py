"""Request headers for the current transfer snapshot."""


def build_request_headers(request_key: str, extra: dict[str, str] | None = None) -> dict[str, str]:
    """Return a new outgoing-header mapping.

    The current gateway contract uses X-Request-Key. X-Request-ID is retired
    and must not be emitted. Preserve extra headers without mutating the input.
    Request keys are trimmed and must not be empty.
    """
    raise NotImplementedError
