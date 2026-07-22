# Precursor session record

Completion input handling may append a sentinel to the completed portion while
parsing flags. That work must never rewrite the caller-provided incomplete word,
even when the input slice has spare capacity. The implementation helper was in
`completions.go` at this point; that location is not the behavior contract.
