# Canonical precursor session

The operations review established a durable cache policy: cache TTL is an
integer from 75 through 3600 seconds inclusive and must use a 15-second
cadence. At this snapshot the policy is implemented by
`src/cache_policy.py#valid_cache_ttl`; that file location is snapshot-specific,
while the bounds and cadence are not.

The focused Python unit test passed after the change.
