from .cache_policy import valid_cache_ttl


def build_settings(cache_ttl: object) -> dict[str, int]:
    if not valid_cache_ttl(cache_ttl):
        raise ValueError("invalid cache_ttl")
    return {"cache_ttl": cache_ttl}
