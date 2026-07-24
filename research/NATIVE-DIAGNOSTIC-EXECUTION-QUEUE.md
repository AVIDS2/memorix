# Native Product Diagnostic Execution Queue

Status: frozen execution policy. This queue is for local product diagnostics
only. It cannot create public-cohort, private-oracle, or confirmatory evidence.

## Why This Is Separate

The canonical public cohort injects one bounded context block before the agent
starts. Native Memorix exposes one real MCP tool and lets the agent decide
whether to call it. Those are different interventions and must not share an
aggregate result table.

The queue exists to answer narrow product questions after a route is known to
be stable:

- does Claude Code discover and call the one-tool native MCP surface when
  predecessor evidence should matter;
- does the selective instruction abstain when current source already settles
  the task; and
- do individual delivery-profile suppressions change behavior in the expected
  diagnostic direction?

It does not estimate a general effect size or validate an agent-memory claim.

## Entry Gates

Every queued task must satisfy all of these before the first task request:

1. It is a fresh `development` case with a public oracle and no private overlay.
   Public-evaluation and confirmatory cases are rejected by the runner.
2. Its predecessor dependency, negative-control status, and stale-evidence risk
   were written before the first condition runs.
3. The isolated no-task route preflight passes for the exact Claude client,
   requested model, and uniform role-model override. It must report exactly one
   actual model in both event and usage telemetry.
4. The run uses a fresh artifact root and a separate workspace root. It never
   reuses the user profile, MCP configuration, cache, or a prior run workspace.
5. Every task passes `--required-single-model` and `--uniform-role-model` with
   the same exact model label. A route mismatch is infrastructure evidence, not
   a retryable task failure.

The current route preflight passed on 2026-07-24 for the isolated
`deepseek-v4-flash` route. That receipt authorizes no task by itself: every new
queue invocation repeats the preflight immediately before its task run.

## Frozen Diagnostic Matrix

For each newly admitted development case, run exactly two repetitions under a
predeclared condition order. Do not add a condition after viewing an outcome.

| Case stratum | Conditions |
| --- | --- |
| Current-source-sufficient negative control | `no-memory`, `memorix-1.2.1-selective-local`, `memorix-1.2.1-native-autopilot-local` |
| Durable predecessor handoff | `no-memory`, `memorix-1.2.1-native-autopilot-local`, `memorix-1.2.1-selective-local` |
| Stale-conflict handoff | `no-memory`, `memorix-1.2.1-native-autopilot-local`, `memorix-1.2.1-delivery-no-freshness-local` |

Each task uses a 300 second timeout, one native MCP call maximum, the existing
512-token native context ceiling, and a declared per-run cost cap. The full
native context is the actual Memorix Workset; a delivery ablation suppresses a
rendered component only and must never be described as disabling the underlying
memory store or code index.

## Execution

Use `scripts/run-native-diagnostic-trial.ps1` for every row. The script first
creates a separate route-preflight receipt. It refuses to invoke `run-trial`
when that receipt is not an exact single-model pass, and it passes the same
model binding into the trial.

The task result, route receipt, MCP gateway receipt, patch, action ledger, and
clean agent-start snapshot remain local diagnostic artifacts. Report only
operational observations such as call/abstention behavior, route stability,
context size, failure modes, and whether an artifact invalidated. Do not merge
them into the public 12-case cohort, use them for benchmark ranking, or update
the paper's canonical efficacy table.

## Current Queue State

No newly admitted native diagnostic case is queued yet. This is intentional:
the older local pilot fixtures are not retroactively promoted after their
outcomes were seen. The next execution requires a newly authored and reviewed
development case per the entry gates above.
