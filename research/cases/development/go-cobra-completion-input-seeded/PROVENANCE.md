# Source provenance

- Upstream repository: `https://github.com/spf13/cobra`
- Pinned base: `f2878bab8c96afd6e36968af96343b35dbb82a82`
- License: Apache-2.0
- Historical source lead: upstream [issue 2257](https://github.com/spf13/cobra/issues/2257)
  and [pull request 2356](https://github.com/spf13/cobra/pull/2356).

The pinned Cobra base and the general caller-input ownership concern are real
upstream artifacts. The precursor helper, the later extraction into
`completion_input.go`, the regression, and the hidden regression test are
benchmark-authored. This is not a verbatim or file-level replay of the upstream
repair, test, or issue text; it reconstructs the same public ownership-failure
class with independently authored code. This historically grounded controlled
transition is development-only and is not confirmatory evidence about a model's
exposure to public history.
