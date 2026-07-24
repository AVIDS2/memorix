# Blinded Action Annotation Protocol

Status: implemented development-stage measurement protocol. Confirmatory use
also requires the worker/vault admission gates.

## What Is Measured

The primary outcome is deterministic task success. Three secondary outcomes
need human judgment and therefore do not receive default zeroes:

- the first action that advances the frozen required repair or verification;
- starts of distinct stale-memory-error episodes; and
- starts of distinct negative-control intrusion episodes.

Agent clients emit line-delimited events. MemorixBench records observed
monotonic arrival times, derives a private action ledger, and assigns stable
`a0001`-style action ids. The timing source is explicitly
`stream-observed-monotonic-v1`: it measures when the client exposed an action,
not hidden model thinking time.

## Blinding And Privacy

For a private-oracle run, the worker exports only a sanitized action ledger:
action id, order, elapsed time, kind, success state, and a provider-redacted
operation summary. It excludes raw event text, model and provider identity,
condition, memory payloads, MCP arguments/results, secrets, and absolute host
paths.

The vault combines that ledger with the public transfer task and a committed
private annotation rubric. The resulting packet uses an HMAC-derived blind run
id. Raters never receive the condition, model, provider, overlay id, private
paths, hidden test text, or reference repair.

## Human Labels

Each packet receives two independent submissions with `judge_kind = "human"`
and pseudonymous rater ids. A submission chooses an observed first-correct
action, `none-observed`, or `unrateable`; it records only start actions for
stale/error and intrusion episodes so repeated retries are not double counted.

Matching decisions become `consensus-v1`. Any disagreement requires a third,
independent human adjudication and becomes `adjudicated-v1`. LLM judging is
rejected by the schema. The final sidecar contains only numeric labels, status,
and cryptographic commitments; reasons, raw actions, rubric content, and rater
identities remain outside public results.

`pending-v1` and `unrateable-v1` retain `null` metrics. `annotated-v1` may
contain zero, which means a human actually rated no episode. Secondary analysis
rejects pending or unrateable rows and must disclose the resulting missingness.

## Artifact Commands

Run these commands only in the development artifact root or the private vault,
never in a public worker workspace:

```text
memorixbench build-annotation-packet <result.json> <sanitized-action-ledger.json> \
  --task-file task.txt --rubric-file rubric.txt --blind-salt-file salt.txt \
  --output packet.json

memorixbench finalize-annotations packet.json rater-a.json rater-b.json \
  --adjudication adjudicator.json --output outcome-annotation.json

memorixbench merge-annotation result.json outcome-annotation.json \
  --output annotated-result.json
```

`collect-results` automatically merges a neighboring
`outcome-annotation.json` only when its commitments bind to the exact raw
`result.json` and action-ledger hash.
