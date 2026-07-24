# Local Agent UX Diagnostic

Status: local operational observation only. This document is not a public
cohort result, a baseline comparison, or evidence for any claim in
`CLAIMS.md`.

## Purpose

Memorix must feel useful without teaching an agent or a user a special command
language. This diagnostic asks a narrow product question: when Pi Coding Agent
starts a fresh coding session in a project that has earlier Memorix activity,
does the installed extension surface a bounded, source-aware handoff without a
prompt that says "use Memorix"?

It does not ask whether Memorix improves task success. The selected task is a
current-source-sufficient negative control, so a competent agent can solve it
from the checked-out code alone.

## Method

On 2026-07-24, Pi Coding Agent 0.79.0 and the already-installed Memorix Pi
package were used in a fresh external checkout of the public historical
`go-logr/logr` negative-control draft. No Pi configuration, extension source,
or user session file was changed.

### Runtime Identity

The diagnostic used the global `memorix` hook CLI at version 1.2.1. The loaded
Pi extension was byte-identical to this repository's
`plugins/pi/memorix/extensions/memorix.js` entry point at the time of the
observation (`sha256:ce89df8fce8a73f1d70cf70bcc30bf7e1c98c65871bb393efb44dca983a12498`).
The installed Pi package's packaging version was 1.1.1, but its extension
entry point matched the 1.2.1 source exactly. This distinction matters: the
observation is about the extension and hook binary actually exercised, not a
claim that an arbitrary package label has been tested.

- The precursor session added one predeclared explanatory comment and passed
  `go test ./funcr`.
- The public transition then made repeated `WithValues` calls observable under
  `RenderValuesHook`; the expected focused test failure was observed.
- A second Pi invocation used `--no-session`, a normal bug-fix request, and an
  isolated Memorix data directory. It was not told to invoke Memorix.
- Embeddings were disabled for the diagnostic, so any retrieval behavior used
  the BM25 fallback. Pi used the model route already configured in the local
  Pi profile; it was not a frozen or independently attested research route.
- Raw agent event streams, workspace data, and Memorix data stay in an
  external private artifact directory and are not part of this repository or
  the public research release.

## Observation

The second Pi session received a Memorix extension message before its ordinary
task work. The message supplied a compact handoff and explicitly said that the
current worktree outranks stored information. Pi did not need an explicit
Memorix command or a user prompt about memory.

It produced a source-compatible repair for the repeated-values bug. The repair
was not textually identical to the historical upstream change, which is the
expected behavior for an independent coding session. Both `go test ./funcr`
and the repository-wide `go test ./...` passed afterward. The isolated
Memorix project contained 16 active observations after the two sessions.

## What This Does and Does Not Show

This is useful product feedback: Pi's native extension can form state from
normal tool activity and make a new session aware of relevant project history
without forcing a command ritual. The stale-source caution also appeared in
the injected handoff, which is the intended product behavior.

It does not show a performance gain. There is one run, no paired no-memory
control, no blinded task outcome, no controlled model route, and no dependency
strong enough to establish that the stored information caused the repair. It
must not be merged into the public 12-case cohort, used in a chart, or cited as
an efficacy result.

## Follow-up Rule

Any future Pi effectiveness study needs Pi's official extension event surface
captured through a versioned adapter, paired no-memory controls, frozen task
inputs, one verified model route, and the same independent review and runtime
gates required for every other agent. Until then, Pi remains a documented
product-usability signal rather than a research outcome.
