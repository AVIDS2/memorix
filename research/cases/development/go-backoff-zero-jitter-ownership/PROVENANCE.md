# Source provenance

- Upstream repository: `https://github.com/cenkalti/backoff`
- Pinned base: `3d3869e86accb1d31bcb9cb954435afa128bd986` (v5)
- License: MIT
- Historical policy source: upstream commit
  `6b0e4ad0cd65431b217393bff47d1dff727b264b`, “make sure no randomness
  is used when randomizationFactor is 0”.

The base repository and the zero-jitter policy are real upstream artifacts. The
between-session helper extraction in `transition.patch` is a controlled,
benchmark-authored migration that intentionally reintroduces the behavior loss.
It is not represented as an upstream incident replay. This design gives the
benchmark a known historical constraint and an auditable state transition while
keeping the hidden behavioral oracle outside the agent workspace.
