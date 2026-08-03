"""Small transfer fixture used only to smoke the sealed-local runner."""


def merge_retry_options(defaults, request):
    """Return effective retry options without mutating either input mapping."""
    raise NotImplementedError
