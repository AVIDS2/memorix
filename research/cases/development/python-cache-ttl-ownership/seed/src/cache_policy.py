def valid_cache_ttl(seconds: object) -> bool:
    return isinstance(seconds, int) and seconds > 0
