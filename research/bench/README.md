# MemorixBench sealed-local runner

This is the deliberately small execution core for exploratory project-memory
trials. It is not a general sandbox and it is not a confirmatory study runner.

The model receives only five ordinary coding tools: list files, read files,
write allowed files, replace one exact writable text fragment, and run a trusted
verifier. The verifier is supplied by
the controller in an external oracle file, so its location and content are not
visible to the model. The `raw-record` condition adds one explicit read of a
fixed predecessor record; `memorix-native` adds one normal `memorix context
--json` call and one cited `memorix memory detail` expansion. In the matched
canonical profile, rendered predecessor detail follows the case-defined
evidence-size cap. The native product profile gives the agent Memorix's actual
bounded Workset prompt and its real citations, then records the rendered brief
size separately. The receipt records the provider-reported token usage actually
consumed. This is a capacity control, not a claim that different providers
tokenize text identically. The native path does not expose an evaluation-only
MCP parameter or alter the product's retrieval behavior.

## Evidence-surface profiles

`native-product` is the product-experience profile. It exposes the real
condition-specific tool surface and gives the agent the actual Memorix Workset
prompt plus the real cited observation IDs. It measures total integration cost,
including tool-schema overhead and rendered brief size. It must not be used
alone to attribute a token or success difference solely to predecessor
information.

`canonical-information` gives every condition the same two neutral predecessor
tools. `no-memory` returns no prior evidence, `raw-record` returns the fixed
record, and `memorix-native` verifies the real Memorix brief/detail backend but
exposes a common case-local alias index to the agent. This is the profile for
causal information comparisons; its neutral tools deliberately do not claim to
reproduce the exact product UX.

The `optional` policy leaves those tools available for the agent to choose. The
`fixed-index` policy is a separate controlled cohort: the runner gives all
conditions the same instruction to consult the index before the first source
edit and expands a listed record once. Noncompliance becomes an invalid row.
It estimates evidence delivery against an explicit empty index, not natural
tool adoption or an end-to-end product claim.

Every condition also receives the same repair-loop contract: after an
agent-visible failed verification, it must keep diagnosing, editing allowed
source, and verifying while budget remains. Receipts distinguish the agent's
ordinary tool requests from the controller's final private-oracle check, then
record edit attempts, source changes, and a structured termination reason
without retaining model prose. A case where all matched rows make no edit is a
retained no-action calibration, not a memory-effect result.

The controlled index always returns the same `records` shape. For the canonical
native condition, the runner first checks whether real Memorix selected the
seeded observation, then exposes the case-local alias `1`; the real backend
brief remains in the private sidecar. Native-product does not use that alias.
This avoids treating a condition-specific record ID or text layout as an
information effect.

Source-backed version-4 case cards also declare the precursor observation type,
source files, concepts, immutable source commit, source archive file and digest,
archive top-level directory, and source-tree digest. The runner rehashes the
declared archive, its normalized ZIP contents, and the unpacked tree before it
begins. The native path stores that declared record only
after the copied source has a clean baseline commit, matching Memorix's normal
code-bound memory selection. Delivered evidence is retained in an ignored
external sidecar for audit; receipts retain only its SHA-256 digest.

Run deterministic tests:

```powershell
uv run --directory research/bench python -m unittest discover -s tests -v
```

Validate a public case card:

```powershell
uv run --project research/bench memorixbench validate-case <case.json>
```

Before source-backed cases are reviewed, render an outcome-blind admission
packet from the frozen case card and a provenance-only admission manifest. The
packet intentionally contains the task, predecessor record, source provenance,
classification rationale, and writable scope only. It never serializes a
private oracle, reference repair, receipt, or model outcome.

```powershell
uv run --project research/bench memorixbench write-review-packet `
  --case <case.json> --admission <admission.json> `
  --output <outcome-blind-review-packet.json>
```

The admission manifest is an external artifact for source-backed cases. It
must identify the canonical GitHub repository, SPDX license, frozen transfer
commit, explicit frozen source scope, public-history exposure, and relevant
current-source files. The
generator rejects oracle/reference/outcome fields rather than relying on a
reviewer to notice a leak.

Generate one blank outcome-blind review form for each packet and reviewer
code. Completed forms remain ignored artifacts; their strict frozen schema
accepts only the documented fields and rejects private-oracle, model-output,
receipt, and unstructured-note fields.

```powershell
uv run --project research/bench memorixbench write-review-form `
  --packet <outcome-blind-review-packet.json> --reviewer-code R1 `
  --output research/artifacts/<reviewer>/<case-id>.json

uv run --project research/bench memorixbench validate-review-form `
  --packet <outcome-blind-review-packet.json> `
  --review research/artifacts/<reviewer>/<case-id>.json
```

After every reviewer has submitted every form, generate one sanitized audit.
The audit retains reviewer codes, structured decisions, and hashes, but not
free-text rationales. A disagreement becomes `needs-third-review`; it does not
admit a case by default.

```powershell
uv run --project research/bench memorixbench audit-review-set `
  --packet-dir research/artifacts/case-bank-v1/review-packets-v2 `
  --review-root research/artifacts/case-bank-v1/review-forms-v2 `
  --reviewer-codes R1 R2 `
  --output research/artifacts/case-bank-v1/review-audits-v2/admission.json
```

Before a source-backed case is allowed to enter a model cohort, run the native
preflight against a new external artifact directory. It initializes a clean
Git transfer workspace, verifies that the baseline still fails the private
oracle, completes the supported CodeGraph refresh that binds the predecessor
to current source, then checks real Memorix seed/context/detail delivery
without making a model request. The emitted receipt contains only hashes and
status fields. Its copied Git workspace receives an opaque run-specific name,
so Memorix local-project identities cannot collide across cases that happen to
have the same temporary directory name.

```powershell
uv run --project research/bench memorixbench preflight-native `
  --case <case.json> --oracle <private-oracle.json> `
  --artifact-root <new-external-artifact-directory>
```

A real source-backed run additionally needs a frozen external oracle JSON file
and a frozen external route JSON file. The oracle declares and hashes every
executable asset; the route pins the requested and expected actual model,
timeout, output cap, cost policy, temperature, and tool policy. Raw model
output and local paths are never written into the receipt. Each current receipt
also contains a protocol version and a hash of the runner source tree, so later
source-backed trials can identify the exact executable study surface without
recording a local checkout path.

For Docker execution, exported artifacts must stay under
`research/artifacts/`; that directory is ignored except for its README. The
worker's deep source workspace lives in an ephemeral Docker named volume, not
under a host drive root. It receives source/oracle inputs through `docker cp`,
never through a source bind mount, and removes its container and volume after
export.

```powershell
uv run --project research/bench memorixbench build-worker-image `
  --docker-image memorixbench:1.4.1 --memorix-version 1.4.1

uv run --project research/bench memorixbench run-trial `
  --case <case.json> --oracle <private-oracle.json> --route <frozen-route.json> `
  --artifact-root research/artifacts/<new-run> `
  --condition <no-memory|raw-record|memorix-native> `
  --execution-mode docker --docker-image memorixbench:1.4.1
```

```json
{
  "schema_version": 1,
  "provider": "openrouter",
  "requested_model": "provider/requested-model",
  "expected_actual_model": "provider/actual-model",
  "provider_timeout_seconds": 90,
  "max_output_tokens": 1200,
  "max_cost_usd": 0.50,
  "temperature": 0,
  "tool_choice": "auto"
}
```

The command rejects a row when the provider does not report the expected actual
model and usage, or when the output or aggregate cost exceeds the frozen route.
No live route is committed here, and no model cohort is authorized until review
and route verification are complete.

Route schema version 1 is reserved for OpenRouter because that provider returns
per-response cost. Schema version 2 is reserved for the official DeepSeek API:
it still requires provider-reported token counts, but it records cost as a
conservative frozen rate-card upper bound because the API does not return a
per-response dollar amount. The receipt carries the accounting basis and the
official pricing URL, so an estimate cannot be mistaken for an invoice.

Schema version 3 is the required DeepSeek form for a fresh multi-turn tool
cohort. It freezes `thinking.type` and `reasoning_effort`; for that provider,
the runner carries every non-null assistant `reasoning_content` only in the
in-memory provider transcript, as required by DeepSeek's tool-call contract.
It never writes that reasoning content to a receipt, sidecar, or Git file. A
malformed model tool-argument payload is never executed: the runner normalizes
the prior provider message to a valid empty argument object, returns a fixed
tool error, and records only a count in the sanitized receipt so the model may
repair the call. Earlier DeepSeek tool-loop artifacts made before these
continuity and repair rules are transport diagnostics, not analysis rows.

Schema version 4 supports OpenCode Go Chat Completions routes such as
`glm-5.2`. It requires `OPENCODE_API_KEY` at runtime and the official Go
endpoint documented at `https://opencode.ai/docs/go/`. Go uses subscription
quota accounting: receipts retain usage and an optional provider-reported
request-price field as non-invoice telemetry, and schema 4 deliberately has no
fake USD cap. The client identifies itself as MemorixBench rather than
impersonating an OpenCode client.

Schema version 5 is the required form for a frozen OpenCode Go cohort route.
It keeps the schema-4 subscription accounting rules and additionally requires
`max_total_tokens`: an aggregate input-plus-output cap for one trial row. A
subscription route has no honest per-row USD invoice, but it still needs a
hard token budget; a reply that would cross that cap becomes an invalid row
before the next tool action.

Before a route can enter a source-backed cohort, retain a separate direct
transport qualification. It sends a fixed non-task prompt with no tools,
checks the actual provider model ID and usage fields against the frozen route,
and writes a sanitized receipt. It is a connectivity check, not a task outcome
or a Memorix-effect result.

```powershell
uv run --project research/bench memorixbench qualify-route `
  --route <frozen-route.json> `
  --artifact-root research/artifacts/<route-qualification>
```

For a frozen cohort route, use the stricter fixed three-probe window after the
final transport client is in place. It emits exactly three separate
qualifications and a summarized ledger; any failed probe keeps that route out
of the cohort rather than being retried selectively.

```powershell
uv run --project research/bench memorixbench qualify-route-window `
  --route <frozen-route.json> `
  --artifact-root research/artifacts/<route-stability-window>
```

After the independent review audit and current-runner action calibrations pass,
seal the cohort exactly once. The receipt contains no private paths or model
prose, but hashes every case/oracle/route/review input and fixes the complete
row order. It refuses to overwrite an existing receipt.

```powershell
uv run --project research/bench memorixbench freeze-cohort `
  --case-bank research/artifacts/case-bank-v1/sealed-v2 `
  --review-audit research/artifacts/case-bank-v1/review-audits-v2/admission.json `
  --route research/artifacts/route-qualification-2026-08-05/routes/glm-5.2.json `
  --route research/artifacts/route-qualification-2026-08-05/routes/deepseek-v4-pro.json `
  --route-window research/artifacts/route-stability-window-v1/route-qualification-windows/<glm-window>.json `
  --route-window research/artifacts/route-stability-window-v1/route-qualification-windows/<deepseek-window>.json `
  --analysis-plan research/ANALYSIS-PLAN.md `
  --output research/artifacts/cohorts/<cohort-id>/cohort.json
```

Run a sealed cohort through the same Docker named-volume worker. The runner
records a durable `started` marker before every provider request. A crash after
that marker blocks a rerun of the affected row, preserving the one-call rule.

```powershell
uv run --project research/bench memorixbench run-cohort `
  --cohort research/artifacts/cohorts/<cohort-id>/cohort.json `
  --case-bank research/artifacts/case-bank-v1/sealed-v2 `
  --route research/artifacts/route-qualification-2026-08-05/routes/glm-5.2.json `
  --route research/artifacts/route-qualification-2026-08-05/routes/deepseek-v4-pro.json `
  --artifact-root research/artifacts/cohorts/<cohort-id>/runs
```

Analyze only after every frozen row has a finalized ledger entry. The analyzer
rechecks each receipt hash, case, route, actual model, runner hash, surface,
and evidence policy before emitting a sanitized aggregate. It rejects partial
ledgers, duplicate rows, route substitutions, receipt drift, and unfinished
rows rather than calculating a favorable subset. The output contains aggregate
counts, resource summaries, and case-cluster bootstrap intervals; it contains
no model prose, private oracle material, or local paths.

```powershell
uv run --project research/bench memorixbench analyze-cohort `
  --cohort research/artifacts/cohorts/<cohort-id>/cohort.json `
  --artifact-root research/artifacts/cohorts/<cohort-id>/runs `
  --output research/artifacts/cohorts/<cohort-id>/analysis.json
```

For every frozen live route, the repair-loop contract also requires one
agent-requested `run_verification` before the agent may finish. If the first
completion omits it, the runner emits one identical condition-neutral reminder
and records that reminder count; a second unverified finish is an invalid
agent-protocol row, not a task failure. It never exposes the private oracle
source or turns the controller's final check into an agent-visible pass.

```powershell
uv run --project research/bench memorixbench run-trial `
  --case <case.json> --oracle <private-oracle.json> --route <frozen-route.json> `
  --artifact-root <new-external-artifact-directory> `
  --condition <no-memory|raw-record|memorix-native>
```
