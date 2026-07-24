# Exploratory 72-Hour Pilot

Status: design and runtime gate only. This is not a benchmark release or a
confirmatory experiment.

## Question

Does a strong coding agent gain anything from Memorix after it is already free
to inspect the current repository and run its normal tests? If not, does an
optional-memory policy avoid unnecessary retrieval without harming the task?

## Matched conditions

Each eligible public-oracle `development` case uses the same agent client,
actual model route, transfer checkout, ordinary source and verification
permissions, timeout, task prompt, and precursor-trace selection. Its private
run artifacts are retained only for local diagnostics:

1. `no-memory`: no predecessor evidence or memory tool.
2. `last-n`: a bounded normalized predecessor-trace view.
3. `memorix-1.2.1-canonical-local`: one forced, bounded Memorix retrieval block.
4. `memorix-1.2.1-selective-local`: native full Memorix MCP with optional-use guidance.

No condition may be handicapped by hiding current files, disabling ordinary
search, or withholding a test command available to another condition.

The canonical and selective surfaces are intentionally not pooled: the former
tests a forced bounded delivery, while the latter tests whether an Agent uses a
native memory capability selectively. The pilot records both rather than
pretending they are the same intervention.

## Pilot case mix

The pilot admits at most six all-new `development` cases that have never
appeared in the retired corpus: two current-source-sufficient negative controls,
two durable-predecessor handoffs, and two stale-conflict transfers. Every case
declares its expected no-memory solvability before any condition runs. Each
condition runs twice in a frozen per-case order, for at most 48 diagnostic runs.

## Evidence to collect

The pilot records the exact run manifest, actual model telemetry when available,
patch, trusted-test result, tool-call ledger, memory-call counts, served-context
receipt, token/cost fields, and failure reason. Before the Agent's first action,
it also records the clean transfer-tree identity, clean-worktree status hash,
task-prompt hash, ordinary-tool-policy hash, full-tool-policy hash, and the
applicable trace or formation receipt. It must record a failure to start an
adapter, obtain single-model telemetry, or match a paired start state as
infrastructure evidence, not as an agent failure.

## Decision gates

The pilot is useful only if it answers these operational questions:

1. Can all four conditions start from equivalent transfer workspaces?
2. Does the no-memory agent retain normal current-code capability?
3. Can the selected model route be reported precisely enough for a later fair
   comparison?
4. Does selective Memorix actually abstain on some current-source-sufficient
   task, or does the prompt fail to change tool use?
5. Do any case surfaces expose a solution, stale answer, hidden path, or
   condition-specific privilege?

A local pilot result is never converted into a confirmatory effect size. It
does not use a hidden oracle, private transition, or private reference repair.
Its only permitted outcomes are: repair the harness, reject a case, refine a
preregistered design choice before confirmation, or proceed to isolated worker
admission.
