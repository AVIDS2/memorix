# Canonical precursor session

The reliability review established a durable retry policy: retry delays must be
at least 375 milliseconds, at most 30 seconds, and align to a 125-millisecond
scheduler cadence. At this snapshot the check is implemented by
`internal/policy/delay.go#ValidRetryDelay`; that package location is
snapshot-specific evidence, while the bounds and cadence are not.

The focused Go test passed after the change.
