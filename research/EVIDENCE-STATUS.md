# Evidence Status

This ledger keeps facts, prototypes, and claims separate. It exists to prevent
a correct engineering smoke test or a small public pilot from becoming a
marketing result by accident.

## What has been observed

### Archived public pilot (Memorix 1.2.1)

The committed public summaries contain two frozen public-fixture cohorts:

- **Qwen cohort:** 12 public fixtures, four conditions, three repetitions,
  144 valid rows. No memory and one local baseline each passed 34/36; a second
  local baseline and canonical Memorix each passed 35/36. The predeclared
  canonical-Memorix versus no-memory paired interval spans -8.3 to +16.7
  percentage points and the sign-flip result is 1.0. This is inconclusive.
- **DeepSeek cohort:** 12 public fixtures, two conditions, three repetitions,
  72 valid rows. Both conditions passed 36/36. Canonical Memorix used more
  input tokens and cost more in this ceiling setting.

The exact summaries are committed under `public-summary/`. They are useful
because they rule out a simplistic "memory always helps" story. They were run
against an earlier 1.2.1 build, use public fixtures, and do not prove any
current `1.4.1` product effect.

## What is implemented or planned

| Item | Current state | What it does not prove |
| --- | --- | --- |
| Memorix 1.4.1 | Released product with its own tests and package smoke evidence. | That it improves coding-task success. |
| Public pilot receipts | Preserved as sanitized aggregate JSON. | Generalization beyond the fixed public fixtures and routes. |
| Sealed-local trial protocol | The runner passed deterministic contracts plus two synthetic 3-by-3 matrices: `native-product` and matched `canonical-information`. All receipts remain external and are excluded from efficacy analysis. The no-memory condition also solved the synthetic durable-decision task by ordinary exploration. | An information-effect estimate, independent isolation, or a confirmatory experimental result. |
| First native fixed-index synthetic smoke | The task oracle passed and native Memorix retrieved the seeded decision, but the original Windows text-mode sidecar write changed its byte hash after the receipt was calculated. The row is preserved externally as a harness finding and excluded from all analyses; the runner now writes exact UTF-8 bytes and has a hash-equality regression test. | A valid smoke result or any memory-effect claim. |
| Byte-stable native fixed-index synthetic smoke | A fresh rerun after the byte-stable write repair completed: real Memorix selected the seeded decision, the agent consulted the common index and detail before editing, the task oracle passed, and the receipt digest matched the private sidecar byte-for-byte. | A comparison against no memory, a general product claim, or any publication result. This is one synthetic engineering row only. |
| Source-backed optional-access preflights | Two complete three-condition `canonical-information` screens were retained externally. The first exposed only whole-file writing; the second added bounded replacement but still had an uncommitted transfer tree and unbound `discovery` seed. Raw/native agents did not consult predecessor evidence. A separate isolated product diagnostic confirmed that a clean baseline plus a `decision` record bound to the target source is retrievable by Memorix. | A task or memory outcome, an information-effect estimate, or a comparison with the repaired fixed-index cohort. |
| Source-backed fixed-index pipx cohort (protocol 1.3) | One frozen MIT-licensed pipx case completed all three matched rows with byte-verifiable sidecars and confirmed raw/native evidence delivery. No row changed source or passed the oracle. Because protocol 1.3 did not separate agent-requested verification from the controller's final verifier, the cohort is retained as an inconclusive no-action calibration. | A raw-versus-native result, a failure-after-verification claim, or any product-effect conclusion. |
| Protocol-1.4 source-sufficient action calibration | One frozen no-memory synthetic row completed with an empty common index, a permitted source edit, an agent-requested verification pass, a separately counted controller verifier, and a byte-verifiable sidecar. | A memory benefit, cost, or retrieval result. It only clears the action-and-attribution prerequisite for future cohorts. |
| Protocol-1.5 source-backed lifecycle preflights | Three permissively licensed candidate cases (two `pypa/packaging`, one `pallets/click`) passed external baseline/reference checks and native preflights: clean Git transfer, private baseline oracle failure, real seed, supported CodeGraph refresh, native Workset inclusion, and detail delivery. No model was asked to solve any task. These receipts are historical lifecycle calibration because the later 1.6 runner strengthened what native-product delivers and how inputs are frozen. | A protocol-1.6 preflight, a condition effect, a case-class claim, or a result for Memorix versus any baseline. |
| Protocol-1.6 sealed-input runner | Unit contracts reject original-source-archive drift, archive-to-tree mismatch, unpacked source-tree drift, private oracle-asset drift, missing source-backed route manifests, provider model substitution, missing or malformed usage, and output/cost-cap breaches. Source-tree hashing uses portable POSIX relative-path ordering. Native-product hands the agent the real Workset brief and real citations; canonical-information retains a controlled alias index. Three source-backed candidates passed fresh v14 no-model lifecycle preflights with unique local-project identities and a runner fingerprint limited to the loaded package. Earlier v11 tree hashes, v12 whole-directory runner fingerprints, and v13 receipts before malformed-usage validation are retained as superseded artifacts, not overwritten. One CodeGraph-refresh infrastructure failure was retained externally and rerun only in a new artifact directory. | A completed cohort, model performance, independent review, or any effect claim. |
| Owner-attested exploratory admission | On 2026-08-04, the owner reported that two outcome-blind non-owner reviewers found no blocker in the three candidates. A sanitized external ledger records the anonymous count and case decisions only; it intentionally contains neither reviewer identities nor individual rationales. | A retained independent-review record, confirmatory admission, or any result. |
| Protocol-1.7 verification handoff | Frozen live routes now require an agent-requested verification before an agent can finish. One condition-neutral reminder is permitted only when the first completion skips that call; a second unverified finish is an invalid agent-protocol row, and the reminder count is retained in the receipt. The controller's private final verification remains separate. | A successful source-backed action calibration or a memory-effect result. |
| Pre-1.8 DeepSeek tool-loop diagnostics | A direct DeepSeek smoke, a synthetic action calibration, two packaging calibrations, three no-memory source-backed rows, and one interrupted raw-record row were retained externally. Afterward, DeepSeek's official tool-call documentation showed that thinking-mode `reasoning_content` must be returned after tool calls; the runner had omitted it. These artifacts are excluded as transport diagnostics and are never analyzed as model or Memorix outcomes. | Any action-calibration success, baseline, or memory-effect result. |
| Protocol-1.8 DeepSeek continuity contract | The runner now preserves `reasoning_content` only in transient provider state after a DeepSeek tool call, and a fresh route must freeze thinking mode and effort. Tests verify outbound configuration and ensure the field does not enter receipts. | A completed corrected cohort or a memory-effect result. |
| Protocol-1.9 DeepSeek repairable tool contract | The runner now preserves non-null DeepSeek reasoning state across provider-only continuation messages for a tool route. A malformed tool-argument payload is not executed and does not crash the row: it is normalized to a valid provider-history object, receives a fixed error response, and is counted without retaining raw arguments or model prose. A live two-turn transport check passed. The v2 core plan's initial no-memory row and an excluded replay both exposed the prior invalid-argument crash; neither is an analysis row. | A source-backed task outcome or a memory-effect result. |
| Anonymous NIER draft | A locally compiled candidate paper describes the cleaned protocol and archival evidence. | Venue acceptance, peer review, or a general performance claim. |

## Claims currently supported

At present the work may accurately be described as:

- a carefully scoped design for evaluating project memory in fresh-agent
  coding tasks;
- an archived public pilot with mixed and ceiling observations; and
- a bounded, privacy-preserving exploratory runner that has passed its initial
  engineering smoke.

It may not be described as proof that Memorix is generally better than no
memory, Mem0, AgentMemory, or any other system.

## What must happen next

1. Freeze a new protocol-1.9 live route and plan, complete an action
   calibration with that same route, then collect the explicitly exploratory
   three-case cohort. Do not promote the owner-attested admission record to a
   confirmatory review record.
2. The paper must continue to identify every archival number as a `1.2.1`
   observation and label the new runner by its study tier.
3. The anonymous supplement must be materialized from an explicit allowlist
   outside the public repository before any submission.
4. A larger claim requires the confirmatory gate in `PROTOCOL.md`, not more
   retries on public fixtures.
