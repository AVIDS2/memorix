# Results policy

Raw JSONL traces are ignored by Git. Frozen aggregate tables may be committed
only when they can be regenerated from checksummed raw results and their run
manifest identifies the protocol version, code commit, cases, conditions,
agents, models, seeds, exclusions, and analysis command.
