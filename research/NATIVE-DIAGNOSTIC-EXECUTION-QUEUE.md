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
`deepseek-v4-flash` route. That receipt verifies model routing only; it does
not prove that a headless client emits command-hook events. Every new queue
invocation repeats the preflight immediately before its task run.

## Native Client Capture Status

The real-client capture controller is implemented and fail-closed. It runs
Claude in a disposable home and settings directory, deliberately omits
`--bare` because that mode skips hooks, requires the exact declared precursor
patch, and rejects a run if no raw `PostToolUse` event reaches the forwarder.

On 2026-07-24, local headless Claude Code candidates on versions 2.1.201 and
2.1.217 completed the bounded precursor task but did not emit the required raw
hook event. No portable capture was produced and none of those attempts enters
this queue. The absence is a diagnostic finding, not a zero, a failed task
label, or a reason to alter a user's Claude configuration.

Pi is documented separately in
`LOCAL-AGENT-UX-DIAGNOSTIC.md`. Its one local two-turn product observation
used Pi's existing Memorix extension and is deliberately not a queue row: it
has no paired no-memory control, no pinned experimental model, and no
admitted dependency case.

The generic precursor-capture harness now also accepts Pi's official JSON
event stream. It starts Pi with a fresh agent directory, disabled discovered
resources, an explicit provider-qualified model, a read-only tool allowlist,
and a piped one-shot prompt. A fixture smoke on 2026-07-24 completed with Pi
0.79.0, one `openrouter/qwen/qwen3-coder-30b-a3b-instruct` route, two successful
read actions, a clean workspace, and a sanitized local trace. Two earlier
Windows smoke attempts are retained as invalid private diagnostics: positional
prompts were split by the `.cmd` wrapper and timed out. The adapter now uses
stdin, so that failure mode cannot create a trace row. None of these harness
smokes is a queue result, a native-extension outcome, or efficacy evidence.
Pi exposes no hard max-budget flag, so the controlled adapter rejects requested
cost caps instead of treating a timeout as a budget boundary.

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

`diagnostics/native-session/go-logr-repeated-values-v1` is a newly authored
development-only negative-control draft. Its predeclared
`native-hook-capture.json` is intentionally absent until a real client capture
passes every capture gate, so it cannot be run as a trial today. It is outside
`research/cases/`, outside the frozen public registry, and outside public
result tables.

No native diagnostic case is admitted or queued. Older local pilots and the Pi
usability observation are not retroactively promoted after their outcomes were
seen. The next execution requires a newly authored and reviewed development
case, a valid portable capture, and every entry gate above.
