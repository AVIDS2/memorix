# Evidence Status

This page is the plain-language evidence map for the public MemorixBench
artifact. It separates four different things that are easy to blur together:

1. an observed result from a frozen public cohort;
2. an implemented mechanism with automated tests;
3. a protocol or measurement capability that is ready but unexecuted; and
4. an external gate that local development cannot honestly satisfy alone.

It is not a raw-trace archive, a system ranking, or a claim that a memory
system is useful for every coding task.

## Observed Public Results

| Question | Current observation | What it supports | What it does not support |
| --- | --- | --- | --- |
| Does canonical Memorix beat no memory on the public Qwen cohort? | 12 fully public local fixtures, four conditions, and three repetitions produced 144 valid rows. Memorix completed 35 / 36 transfer tasks and no memory completed 34 / 36. The absolute difference is +2.8 points, with a 95% paired interval of -8.3 to +16.7 points and a cluster sign-flip p value of 1.0. | A bounded descriptive observation for this frozen model, fixtures, prompts, and tool policy. | General effectiveness, a statistically supported improvement, or a ranking over other systems. |
| What happens on the frozen DeepSeek replication? | 12 fixtures, two conditions, and three repetitions produced 72 valid rows. Both Memorix and no memory completed 36 / 36 tasks. Memorix used more input tokens and cost more in this ceiling setting. | A useful boundary finding: memory can add context cost when the base model already solves the fixture set. | A claim that memory is harmless, useful, or harmful in general. |
| How did the public local baselines compare? | The Qwen matrix also contains Mem0 2.0.12 local and AgentMemory 0.9.28 full local under the frozen public setup. Their results are descriptive secondary contrasts. | A reproducible account of those exact local adapters and shared public evidence. | A universal product ranking, a formation-quality comparison, or a claim about native client integrations. |

The exact aggregate receipts are `public-summary/public-cohort-v1.json` and
`public-summary/public-cross-model-deepseek-v1.json`. The two model cohorts
are intentionally separate and must not be pooled as if they were additional
independent cases.

## Implemented and Tested, But Not Outcome-Proven

| Capability | Current evidence | Missing evidence |
| --- | --- | --- |
| Freshness-aware Workset delivery | Source-level and integration tests cover current, stale, suspect, and caution routing. | Held-out coding-task outcomes showing that this changes agent behavior or patch correctness. |
| Budgeted native MCP delivery profiles | The native gateway and delivery profiles are implemented and tested. The profiles control the agent-facing memory bundle, not the underlying store or project files. | A preregistered native-agent outcome study, including stale-conflict labels and negative controls. |
| Native hook formation path | Portable hook capture, isolated formation checks, and diagnostics are implemented. | A fair cross-client or cross-agent effectiveness result. |
| Baseline, route, and artifact guards | The harness rejects mixed models, incomplete matrices, unsafe source material, public-artifact drift, and unsupported confirmatory evidence tiers. | Independent operation of the future trusted relay, worker, vault, and runtime manager. |

An implementation test proves that the harness enforces its contract. It does
not prove that the product intervention helps an agent solve a task. In
particular, no absent stale-action label or native-MCP outcome is treated as a
zero, a success, or a failure.

## Work Prepared but Not Yet Executed

The following pieces exist as versioned protocol and tooling, but have no
confirmatory result rows:

- human-blinded action annotation and adjudication;
- real-repository private transitions, private oracles, and precursor traces;
- a reviewer-frozen power envelope and Holm-controlled primary analysis;
- cross-agent transfer trials; and
- a trusted single-model relay plus independent runtime attestation.

The source ledger has three screened public repository leads. Their source
provenance, license, and hash-only private-draft pre-review checks passed, but
none is an admitted case. Automated pre-review cannot issue an admission
decision and creates no performance evidence.

## Claim Rules

Every candidate product-effect claim remains **Unproven** in `CLAIMS.md`.
That includes improved task success, improvement over raw trace replay,
freshness-harm reduction, faster first correct action, cross-agent transfer,
delivery-profile value, non-inferiority on unrelated tasks, and efficient use
of tokens or cost.

The current artifact may accurately be described as a reproducible,
freshness-aware project-memory evaluation artifact with bounded public cohort
observations. It must not be described as a completed effectiveness study,
proof of a general coding-agent benefit, or an independently reviewed
benchmark.

## Hard Gates Before a Confirmatory Claim

1. Two independent human reviewers must approve each real-repository private
   transition and its dependency rationale.
2. Each admitted case needs a sealed task, private oracle, and at least two
   independently captured precursor traces.
3. The execution deployment needs a KVM-backed worker boundary, an independent
   trusted relay, and a separate runtime-attestation signer.
4. Reviewers must freeze the power envelope and analysis plan before outcome
   labels are read.
5. A venue submission needs independent artifact review and a final anonymity,
   bibliography, and format pass for the chosen venue.

`SUBMISSION-READINESS.md` gives the operational release state. `CLAIMS.md`
defines the exact evidence required for each future claim. The public release
builder includes this page in its whitelist so readers of a materialized
artifact see the same evidence boundary as repository readers.
