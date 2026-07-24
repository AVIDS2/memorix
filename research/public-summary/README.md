# Public Cohort Summary

`public-cohort-v1.json` is the sanitized aggregate receipt for the frozen
MemorixBench public v1 cohort. It is not a raw trace archive and not a
confirmatory result. It records the fixed plan and registry identities, one
provider-reported model, matrix validity, primary and secondary descriptive
comparisons, resource summaries, and failure counts.

`public-cross-model-deepseek-v1.json` is a separate, post-result frozen
replication under one DeepSeek model. It has its own 72-row plan and analysis
receipt and must never be pooled with the original Qwen cohort as extra cases.

Recreate it only from the checked-out research harness, frozen public cases,
and the separately retained raw receipt root:

```powershell
uv run memorixbench materialize-public-cohort-summary `
  public-cohort-plans/memorixbench-public-cohort-v1.json `
  --registry cases/REGISTRY.toml --cases-root cases `
  --results-root <external-result-root> `
  --output public-summary/public-cohort-v1.json
```

The command refuses incomplete, invalid, mixed-model, tool-policy-drifting, or
definition-drifting matrices. Do not overwrite the committed receipt: produce a
new release id and explain any protocol change instead.

The only replacement path is an audit-preserving harness upgrade: pass
`--replace-expected-analysis-sha256 <committed-hash>`. The command rereads the
existing receipt, rejects a different hash, writes a sibling replacement, and
atomically swaps it only after the new frozen analysis succeeds. Record why the
schema-level replacement was needed; it is not a way to change a plan, matrix,
or outcome after the fact.

Recreate the separate DeepSeek receipt with its own frozen plan:

```powershell
uv run memorixbench materialize-public-cohort-summary `
  public-cohort-plans/memorixbench-public-cross-model-deepseek-v1.json `
  --registry cases/REGISTRY.toml --cases-root cases `
  --results-root <external-result-root> `
  --output public-summary/public-cross-model-deepseek-v1.json
```
