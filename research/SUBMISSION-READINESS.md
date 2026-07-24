# Submission Readiness

Status: public protocol/artifact ready for external review; not ready to claim
confirmatory efficacy or submit as a completed main-track effectiveness paper.

Read `EVIDENCE-STATUS.md` first for the compact, reader-facing boundary between
observed public results, tested implementation, and unexecuted confirmatory
work.

## Verified Public Evidence

- The frozen Qwen public cohort has 144 valid rows: 12 local fixtures, four
  canonical conditions, and three fixed repetitions.
- The separately frozen DeepSeek replication has 72 valid rows: the same cases,
  canonical Memorix versus no memory, and three fixed repetitions.
- Both matrices bind one provider-reported model per cohort, one tool-policy
  hash, stable case/oracle hashes, one Memorix CLI build hash, and exact study
  IDs. Their sanitized aggregate receipts are committed under `public-summary/`.
- On 2026-07-24, the retained external raw run roots were revalidated against
  both frozen plans: Qwen remained 144 / 144 valid rows and DeepSeek remained
  72 / 72 valid rows. Regenerated analysis objects and SHA-256 values exactly
  matched the committed public summaries.
- The public artifact release builder whitelists sources and public bundles,
  scans for host paths and credentials, materializes a fresh tree, self-tests
  it outside the staged tree, and rejects any unlisted staged file.
- An isolated Claude route preflight now proves one actual
  `deepseek-v4-flash` route when all Claude role aliases are overridden only
  for the experiment process. The trial harness repeats and records that
  override per run; it is a local diagnostic route, not a trusted relay.
- The English LaTeX paper builds and its public-results pages have been
  visually inspected.
- Zod, Click, and urfave/cli source caches passed their ledger provenance and
  license audits. They remain source leads, not benchmark cases.
- Their external private design drafts also passed hash-only automated
  pre-review. This checks mechanical integrity only and leaves all three
  sources at `screening`; it is not an independent-human admission decision.
- Before any independent review, their current v1 hash-only admission templates
  must be regenerated to receipt v3 and assembled into external private handoff
  packets. That change requires separate worksheet-bound attestations from each
  reviewer and changes no private task commitment or candidate status.

## Permitted Positioning Now

The present work can accurately be described as:

- a reproducible evaluation artifact and protocol for freshness-aware project
  memory in coding agents;
- a bounded public-fixture study with one inconclusive Qwen cohort and one
  DeepSeek cohort where both conditions solve every fixture but canonical memory
  adds context cost; and
- an open, fail-closed implementation of public-result accounting and future
  confirmatory execution contracts.

It must not be described as proof that Memorix generally improves coding-agent
success, transfers across agent clients, outperforms every memory system, or
solves private-oracle engineering tasks.

## Blocking Gates

1. At least two independent human reviewers must approve each newly authored
   real-repository private transition and its predecessor-dependency rationale.
2. A newly admitted real-repository corpus needs private transitions, private
   oracles, and at least two captured precursor traces per confirmatory case.
3. A worker/vault deployment needs a usable KVM-backed Linux subject, a trusted
   model relay, and an independent runtime manager with disjoint signing keys.
   The currently configured development machines do not satisfy the KVM gate.
4. The confirmatory power envelope and analysis plan described in
   `CONFIRMATORY-ANALYSIS-FREEZE.md` must be reviewer-frozen before any
   confirmatory outcome is read.
5. A final venue-specific pass needs independent artifact review, author and
   anonymization checks, bibliography/format validation, and a decision about
   whether the target accepts an artifact/protocol contribution without a full
   confirmatory effectiveness result.

## Release Procedure

Build the public release from a clean checkout into a new external staging
directory with `scripts/build-public-release.ps1`. Upload only the exact staged
directory and its manifest after the final source commit/tag is fixed. Do not
upload raw agent events, private transition drafts, caches, model credentials,
or private oracle material.
