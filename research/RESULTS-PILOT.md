# Development Pilot Ledger

Status: non-confirmatory development evidence only

This file records trial behavior used to harden MemorixBench-Transfer. It is
not a result table and must not be used to claim a memory effect.

## Excluded diagnostics

- The first Python transfer wording said short TTLs were "accepted again". The
  agent reasonably treated that as the desired policy. That manifest revision
  and its run are archived but excluded because the prompt was ambiguous.
- The next Python revision used only a 60-second lower bound. Both micro and
  no-memory agents found the same repair, showing that 60 was too easy to
  infer. That revision is excluded because the task did not require precursor
  knowledge.
- Early no-memory fixed-budget exhaustions predated the explicit valid-failure
  classification rule. They remain raw artifacts, not comparison rows.

## Current executable smoke

The current development fixtures require a durable policy that cannot be
recovered from the transfer snapshot alone:

| Case | Durable policy | Micro-Memorix smoke |
| --- | --- | --- |
| Python cache TTL | 75s minimum, 15s cadence | hidden tests passed |
| Go retry delay | 375ms minimum, 125ms cadence | hidden tests passed |
| TypeScript token | `tok_`, 18+ chars, ASCII digit marker | hidden tests passed |

All three successful smokes used Claude Code 2.1.201 through the configured
DeepSeek V4 Flash route. Provider telemetry also reported a small
`claude-haiku-4-5` helper component, so these runs are labelled `mixed` rather
than pure DeepSeek. Each used isolated data, an isolated transfer snapshot,
hidden tests mounted only after the agent exited, and the Memorix 1.2.1 CLI
hash recorded in its artifact manifest.

The smokes show only that the harness and the real MCP path can execute across
three languages. Confirmatory work still requires frozen external cases,
matched no-memory/last-N/external-memory conditions, repetitions, statistics,
and an independent review.

## External case authoring evidence

`go-backoff-zero-jitter-ownership` pins the MIT-licensed upstream
`cenkalti/backoff` v5 source at `3d3869e`. It is a historically grounded
controlled transition, not an upstream incident replay: the durable no-jitter
constraint comes from upstream commit `6b0e4ad`, while the helper-extraction
regression is benchmark-authored and documented in the case provenance.

The case has passed its four authoring gates on this machine: precursor tests
passed; transfer public tests passed; the unmodified transfer snapshot failed
the hidden zero-sampling check; and the maintainer reference patch passed it.
No agent condition has been run on this case, so this is validation evidence,
not an efficacy result.
