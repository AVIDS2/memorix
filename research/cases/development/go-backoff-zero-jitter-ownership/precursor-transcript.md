# Precursor session record

The retry layer allows callers to disable jitter by setting
`ExponentialBackOff.RandomizationFactor` to zero. Keep that case deterministic:
return the current interval and do not consume a random sample. The helper was
in `exponential.go` at this point, but that location is not part of the policy.
