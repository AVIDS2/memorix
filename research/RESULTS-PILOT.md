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
- Four initial Mem0 external-case attempts are archived as harness diagnostics,
  not result rows: two hit Windows path-length failures before an agent started;
  one had an over-broad Bash deny rule that blocked `go test ./...`; and one
  blocked ordinary in-workspace `grep`/`dir` inspection. The current runner
  uses short F-drive runtime data, an offline shared model cache, and a
  command-contamination audit instead.

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
The repaired runner has one valid paired development smoke on this case with
the same seed: `mem0-2.0.12-local` and no-memory both passed hidden tests. Mem0
used two retrieved records (150 proxy tokens), took 49.7 seconds, and cost
about USD 0.108; no-memory took 104.1 seconds and cost about USD 0.232. This
is one easy development pair, not an effect estimate: both conditions solved
the task and the client was a mixed stack. It exists to verify the real Mem0
adapter, isolation, command audit, and grading path before case expansion.

AgentMemory's official Docker full-service adapter also has one valid
development smoke on this same easy case. It passed write/read/restart/project
isolation preflight, retrieved the same two records at the same 150-token
ceiling, passed hidden tests, and had 25.7 seconds of service preparation plus
0.078 seconds retrieval and 68.6 seconds of agent time. This is a functional
adapter smoke only, not a Mem0-vs-AgentMemory comparison or evidence of an
outcome effect.

`python-itsdangerous-future-age-zero` is the second external development case.
It pins the BSD-3-Clause `pallets/itsdangerous` revision `672971d` and records
the real upstream future-timestamp policy from `c30678d`; its helper-extraction
transition is benchmark-authored and labelled as such. A fresh upstream
materialization passed the precursor and transfer public suites (101 each),
failed the hidden regression oracle (103 passed, 1 failed), and passed the
reference repair (104 passed). A hidden Python AST oracle checks that timestamp
rejection stays outside `TimestampSigner.unsign`, so a solution cannot merely
restore the stale inline owner. It has no agent result yet.
