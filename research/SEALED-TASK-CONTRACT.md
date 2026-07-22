# Sealed Task Contract

This contract prevents a benchmark task from teaching an agent its own answer.
It divides every future case into three different things rather than treating a
directory as all three.

## What is public

The public case card records the source repository and pinned base revision,
license, broad task class, split, contamination disclosure, retrieval budget,
and cryptographic commitments. It is enough to audit provenance and protocol
drift. It is not enough to reconstruct the bug, solution, exact policy, hidden
test, or predecessor implementation recipe.

## What the agent receives

The worker receives a freshly materialized transfer workspace, the ordinary
task prompt, the fixed allowed-tool policy, and the condition-specific memory
surface. It does not receive the public case repository, any parent directory
that contains it, the private overlay, raw precursor events, a transition diff,
hidden tests, reference repairs, or another condition's artifacts.

The worker sees a single Git snapshot. There is no predecessor commit, reflog,
or controller path from which it can rediscover the withheld task construction.

## What stays private

The controller overlay contains the post-snapshot transition patch, hidden
behavioral oracle, structural checks, reference repair, annotation rubric, and
verifier runtime. The overlay binds to the public card hash, base revision, and
transition commitment. The controller constructs the transfer workspace before
the worker starts; the vault constructs a second fresh workspace before grading
the returned sealed patch.

## Admission consequences

- A private case must declare an opaque `transition.commitment_sha256`, never a
  public `transition.patch`.
- Private cases use an explicit public bundle allowlist; extra files in the
  public case directory are rejected.
- Exact seeds and raw transcripts stay inside the private controller. Public
  Track C traces require independent leakage review before release.
- `development-authoring-v1` can exercise deterministic maintainer gates but
  cannot run an agent or produce an outcome row.
- A withdrawn case id is never reused. Similar future work starts with a new
  id, new private transition, new trace review, and new no-memory screening.

The current repository has no admitted task. This contract is the entry gate
for the next one, not a retroactive justification for a retired exercise.
