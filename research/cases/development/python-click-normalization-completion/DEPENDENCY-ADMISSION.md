# Dependency Admission

Status: one paired local diagnostic completed; not eligible for an effect claim.

## Policy under test

The configured token normalizer receives names and values, not CLI option
prefixes. Option matching preserves the original prefix, normalizes only the
name body, and returns declared spellings to shell users.

## Static exposure audit

- The transfer prompt names a normalization-boundary regression but does not
  state the prefix predicate, the hidden normalizer, or the reference patch.
- The transfer source exposes an incomplete `utils.py` migration, so a strong
  agent may still infer a prefix-preserving repair from local code. This is a
  confound to measure, not a reason to claim the task is logically opaque.
- Public tests cover ordinary lowercase normalization and completion. They do
  not exercise a prefix-sensitive normalizer.
- The agent workspace contains neither hidden/reference patches nor precursor
  history. The transfer checkout is rebuilt as a one-commit repository by the
  worker protocol.

## Required evidence before comparison admission

1. Two independent captured sessions from the same precursor snapshot, with
   no transfer-era utility owner, hidden test, reference patch, or portable
   repair snippet in their public traces.
2. A static trace coverage review marking the smallest policy evidence and all
   stale implementation-location evidence. This is recorded in
   `TRACE-COVERAGE-REVIEW.md` and still needs independent review.
3. A preregistered matched no-memory cohort using the same model, tool policy,
   task budget, and transfer snapshot. The cohort must be reported even when it
   solves the task; a high no-memory pass rate downgrades or rejects the case.
4. Independent review of the prompt, transfer source, and public tests for a
   direct policy predicate or answer path.

## Observed local diagnostic

One matched local pair used the same case definition, Trace A selection, seed,
client, nominal budget, tool policy, and public oracle. The no-memory run
produced no patch and exhausted its budget; the Memorix canonical run formed
from the trace, injected a 512-token retrieved context, and passed the hidden
test plus both source checks. The two opaque artifact receipts are
`93e278672bc34e448166a659109e61e5b063c0cfa505ccc5e65f907cfade89ab` and
`4da2ea68166ce7c23d91893553d5af8543c1e33b2dd30ac61f136acbb228fef3`.

Both runs reported a mixed local model route, and there is only one pair. The
comparison command therefore rejects them by default; an explicit development
and mixed-model override can render the diagnostic only. This is evidence to
investigate, not a result to claim.
