# Results policy

Raw JSONL traces are ignored by Git. Frozen aggregate tables may be committed
only when they can be regenerated from checksummed raw results and their run
manifest identifies the protocol version, code commit, cases, conditions,
agents, models, seeds, exclusions, and analysis command.

The public v1 cohort does not commit raw results here. Its sanitized aggregate
receipt is [public-summary/public-cohort-v1.json](../public-summary/public-cohort-v1.json).
It contains only the frozen-plan identities, matrix validation, aggregate
comparisons, resource summaries, and failure counts. The external raw run
receipts remain necessary to regenerate it and are intentionally excluded from
Git and public release staging.

The independently frozen DeepSeek replication is also committed only as a
sanitized aggregate receipt at
[public-summary/public-cross-model-deepseek-v1.json](../public-summary/public-cross-model-deepseek-v1.json).
It is a separate 72-row model cohort, not additional rows pooled into the
original Qwen analysis.
