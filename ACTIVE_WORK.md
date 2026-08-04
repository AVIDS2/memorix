# Memorix Active Work

> This is the single living work-status document for this repository. Read it
> before resuming substantial work, update it after a material decision or
> milestone, and do not create parallel progress logs.

**Last updated:** 2026-08-05

## Current Product State

- `1.4.1` is the current published release.
- It includes the accepted MiniMax M3 video-input contribution (#153), the
  maintained public-roadmap contribution (#140), deterministic provider-test
  boundaries, and synchronized plugin/MCP Registry release metadata.
- Release evidence is complete: full local checks, a fresh-package CLI/MCP
  smoke, Ubuntu and Windows CI, npm provenance, the official MCP Registry, and
  the GitHub Release `v1.4.1`.

## Active Objectives

1. Keep the public repository free of operator state, local paths, credentials,
   raw session captures, and one-off development artifacts.
2. Complete the MemorixBench research program below until there is a
   submission-ready package, rather than opening more informal research tracks.
   Historical evidence stays historical; new `1.4.1` work must use isolated
   workspaces, frozen routes, and reviewable provenance receipts.

## Completed Contribution Decisions

- #153: accepted and merged with focused MiniMax M3 video-input tests.
- #140: accepted and merged after replacing its stale release timeline with a
  maintained boundary-and-roadmap document.
- #33, #31, #30: not merged into the superseding media/retrieval architecture.
  Their original authorship is preserved through #173 (PDF derivations), #174
  (audio derivatives), and #175 (graph-assisted evidence expansion).
- #136 and #151: research-only work. Their useful public protocol and paper
  assets are being recovered on a clean branch; do not merge their old
  product-interface changes or local-development records into a release.

## MemorixBench Completion Contract

This is the **only** living specification for the MemorixBench research program.
It replaces ad-hoc status updates. Update it only when evidence, a frozen
decision, or a completion gate changes.

**Last reconciled:** 2026-08-05

**Product under study:** Memorix `1.4.1`
**Primary submission target:** an anonymous ICSE NIER candidate plus a
reviewable, privacy-preserving supplement. A venue can reject it; "done" means
the package is technically and methodologically ready for the maintainer to
upload, not that acceptance is guaranteed.

### The finish line

The program is complete only when all of the following exist:

1. A versioned, Docker-isolated runner that starts every trial from a clean
   task snapshot and stores deep workspaces in a Docker named volume, not at a
   Windows drive root.
2. Frozen source-backed cases, route manifests, private deterministic oracles,
   and complete receipts for every planned row, including invalid rows,
   timeouts, costs, and failures.
3. A reproducible analysis that reports correctness, time, tokens, tool calls,
   cost, and stale-action behavior separately. It must retain null and negative
   results rather than retrying until a preferred story appears.
4. An anonymous compiled paper, tables, figures, supplement allowlist,
   reproduction instructions, and a final identity/secrets scan.
5. A maintainer handoff pack: one upload-ready archive and a plain-language
   submission guide covering the remaining human portal fields and approvals.

The work is **not** complete merely because a runner smoke passes, a model gives
one good answer, or a manuscript compiles.

### Claim boundary

The paper may ask when project memory helps, has no measurable effect, or harms
fresh coding agents. It must not claim that Memorix is generally superior to
Mem0, AgentMemory, or no memory unless the frozen evidence actually supports
that claim. A result in Memorix's own repository is never efficacy evidence.

Two distinct deliverables are intentionally kept separate:

- **NIER package:** a defensible contribution even if the final cohort is
  mixed: fail-closed protocol, benchmark artifact, carefully scoped findings,
  and transparent limitations.
- **Empirical extension:** only after the larger frozen cohort and independent
  case review may the work make conditional effect claims about task class or
  model route. It is not retroactively inferred from the NIER draft.

### Current evidence, stated honestly

- The archived public `1.2.1` pilot is retained as a mixed/ceiling
  observation. It is not evidence about `1.4.1`.
- The protocol-1.9 runner has passed deterministic contracts and DeepSeek
  transport continuity checks. Its 3-case by 3-condition exploratory matrix
  has zero valid oracle successes; it is a route-and-harness diagnostic, not an
  effect result.
- Protocol-2.0 Docker/OpenCode Go qualification is complete: the isolated
  worker passed deterministic contracts plus a source-backed action smoke and
  a separate predecessor-decision delivery smoke. The latter recorded real
  Memorix seed, CodeGraph refresh, context, cited-detail expansion, and a
  private-oracle pass. Both are explicitly non-cohort qualifications, not
  paper outcome rows or evidence of a condition effect.
- Three permissively licensed source-backed candidates have passed sealed
  no-model lifecycle preflights. They are candidates, not admitted outcome
  cases. An owner-reported two-reviewer check exists, but it is not a retained
  independent admission record.
- The anonymous NIER manuscript compiles locally, but is a protocol candidate,
  not a submitted or accepted empirical paper.

### Frozen execution design

The intervention remains three-way:

| Condition | Fresh agent receives |
| --- | --- |
| `no-memory` | Current checkout and ordinary task tools only. |
| `raw-record` | One bounded predecessor record through the common evidence surface. |
| `memorix-native` | Normal bounded Memorix project context and one cited detail expansion. |

The primary causal comparison uses the `canonical-information/fixed-index`
profile. The real `native-product` profile is retained separately as an
end-to-end product-experience measurement. Tool-schema cost, rendered evidence
size, actual model ID, and route usage are recorded rather than assumed equal.

The planned exploratory corpus is **at least nine admitted cases**: three
source-sufficient controls, three durable-decision dependencies, and three
stale-conflict cases drawn from at least three permissively licensed external
repositories. With three frozen routes, three conditions, and three
repetitions, the initial complete matrix is at least 243 planned rows. If a
route cannot complete a source-backed action calibration, it is removed before
the plan freezes rather than silently becoming a failed treatment row.

Route labels are descriptive, never "weak" or "strong" vendor labels. The
initial qualification candidates are OpenCode Go
`glm-5.2`, `kimi-k2.7-code`, and `deepseek-v4-pro`; actual provider/model
IDs, temperature, reasoning configuration, timeout, and caps are frozen in a
route manifest before outcome collection.

### Docker and data boundary

Docker is required for the experimental worker, not as a substitute for product
acceptance testing:

- a pinned image owns the task runtime, repository snapshot, tests, and agent
  harness;
- each row receives a fresh container and an isolated named volume;
- credentials are injected at runtime only and never enter an image, receipt,
  Git file, or artifact archive;
- host-side outputs are compact sanitized receipts and aggregates under the
  ignored research artifact boundary;
- the worker explicitly owns `HOME` and `MEMORIX_DATA_DIR` under `/runs`, so a
  supplied local base image cannot redirect Memorix data to an inherited path;
- a small, explicitly labeled Windows host acceptance suite continues to test
  real Claude Code, Codex, OpenCode, Pi, hooks, and MCP behavior.

Docker fixes environment leakage and Windows path-depth failures. It does not
make remote models deterministic; replication and full route accounting remain
mandatory.

### Completion phases

| Phase | Gate | Status |
| --- | --- | --- |
| P0 | Reconcile evidence, scope, claims, and final deliverables in this document. | Complete |
| P1 | Add Docker execution, named-volume lifecycle, artifact export, and OpenCode Go route support; pass unit and live route qualification without secrets. | Complete |
| P2 | Build the nine-case source-backed bank, seal archives/oracles, and create blind admission packets. | Pending |
| P3 | Obtain two retained outcome-blind case-admission reviews, freeze the case list, route manifests, analysis plan, and budget before reading new outcomes. | Pending |
| P4 | Run every planned row once under the frozen cohort plan; retain successes, failures, invalid rows, and timeouts. | Pending |
| P5 | Generate analysis, robustness checks, figures, and claim-limited manuscript text from the complete dataset. | Pending |
| P6 | Materialize the anonymous supplement from an allowlist, compile and visually inspect the paper, reproduce a clean smoke, and perform anonymity/secrets scans. | Pending |
| P7 | Hand the maintainer the upload archive and portal guide; collect author metadata and explicit authorization only at the final external submission step. | Pending |

### Rules that prevent research drift

1. No source-backed outcome row is rerun after inspection. A real runner or
   route defect creates a new versioned cohort with the defect disclosed.
2. Case admission happens before new outcome collection. Reviewers receive
   case structure and provenance, not model outcomes.
3. Private oracle assets never enter the agent-visible checkout or public Git.
4. One root cause is changed at a time: protocol, case, route, or product, not
   several after looking at an outcome.
5. The paper's wording is generated from the evidence ledger, not from product
   aspirations.
6. No runtime command may create arbitrary drive-root workspaces. Research
   runtime state belongs in Docker volumes; exported artifacts follow the
   ignored relative artifact boundary.

### External dependencies that cannot be fabricated

The implementation, data processing, paper, figures, archive, and upload guide
are autonomous work. Two things still require a real person:

1. Two outcome-blind reviewers must provide retained case-admission decisions
   using the existing rubric. Earlier verbal review is useful but cannot be
   represented as a detailed independent record without their actual answers.
2. At upload time, the maintainer supplies author names, affiliation, email,
   conflicts, any ORCID choice, venue account access, and final authorization.

These are the only planned human interruptions. Everything else proceeds against
the phases above.

## Operating Rules

- Git, `package.json`, and `CHANGELOG.md` are live product facts; this document
  records intent and next actions, not a replacement for them.
- Never write secrets, account identifiers, local absolute paths, raw chat
  transcripts, or local tool state into tracked files.
- Keep reusable public docs and test fixtures only when they are source-backed,
  non-sensitive, and exercised by the repository.
- Do not rewrite Git history without explicit maintainer approval. Removing a
  file from the current tree does not erase existing forks or historical clones.
- Treat `research/PROTOCOL.md`, `research/CLAIMS.md`, and
  `research/EVIDENCE-STATUS.md` as detailed evidence records. This file owns
  the active sequence and definition of done; it must stay synchronized with
  their protocol version and facts.

## Immediate Next Step

Complete P2: build the nine-case source-backed bank and blind-admission packets.
Do not collect new outcome labels until P3 freezes those packets, routes,
analysis plan, and budget.
