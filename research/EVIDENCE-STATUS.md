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
| Source-backed optional-access preflights | Two complete three-condition `canonical-information` screens were retained externally. The first exposed only whole-file writing; the second added bounded replacement but still had an uncommitted transfer tree and unbound `discovery` seed. Raw/native agents did not consult predecessor evidence. A separate isolated product diagnostic confirmed that a clean baseline plus a `decision` record bound to the target source is retrievable by Memorix. | A task or memory outcome, an information-effect estimate, or a comparison with the repaired fixed-index cohort. |
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

1. Exploration must run the separately frozen `fixed-index` cohort with clean
   transfer commits, case-declared precursor metadata, delivery sidecars, and
   complete matched rows on independently reviewable cases. It must preserve
   all failures and noncompliant rows.
2. The paper must continue to identify every archival number as a `1.2.1`
   observation and label the new runner by its study tier.
3. The anonymous supplement must be materialized from an explicit allowlist
   outside the public repository before any submission.
4. A larger claim requires the confirmatory gate in `PROTOCOL.md`, not more
   retries on public fixtures.
