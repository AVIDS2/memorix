# Literature And Comparison Boundary

This is a working reading matrix, not a final related-work section. Venue,
version, author lists, and BibTeX must be rechecked before manuscript freeze.

| Work | What it establishes | What it does not establish for this study |
| --- | --- | --- |
| [Mem0](https://arxiv.org/abs/2504.19413) | A practical long-term memory design and conversational-memory evaluation framing. | Whether a memory layer improves a fresh coding agent's patch after repository evolution. |
| [LongMemEval](https://arxiv.org/abs/2410.10813) | Long-horizon session retrieval and update evaluation. | Repository-state freshness, stale-symbol handling, or hidden-test patch correctness. |
| [MemoryAgentBench](https://arxiv.org/abs/2507.05257) | Incremental multi-turn evaluation across retrieval, test-time learning, long-range understanding, and conflict resolution. | A controlled repository transition followed by a dependent implementation task. |
| [MemoryArena](https://arxiv.org/abs/2602.16313) | Agentic-memory evaluation on agentic tasks, closer in spirit to downstream use than conversation-only recall. | The exact multi-session code-ownership and freshness intervention implemented by MemorixBench-Transfer. |
| [RepoQA](https://arxiv.org/abs/2406.06025) | Repository-level code understanding and retrieval questions across real projects. | Whether memory retained from an earlier session changes a later agent's patch success. |
| [Cognee](https://github.com/topoteretes/cognee) | A graph-plus-vector knowledge layer with ontology and ingestion emphasis. | A ready-made fair baseline for coding-agent transfer without a pinned adapter and equal evidence budget. |
| [AgentMemory benchmark notes](https://github.com/rohitg00/agentmemory/blob/main/benchmark/COMPARISON.md) | Useful public discussion of retrieval-oriented coding-memory comparisons and the apples-to-oranges risk. | A head-to-head patch-success result on an identical harness. |

## Consequence For MemorixBench-Transfer

MemorixBench-Transfer is not positioned as a replacement for these benchmarks.
It targets the gap between them: a precursor engineering decision is stored,
the repository changes so that some implementation evidence becomes stale, and
a fresh agent must make a tested patch without receiving the raw precursor
transcript unless its condition explicitly permits it.

This makes three separable questions measurable:

1. Did the memory system preserve the durable rule?
2. Did it avoid treating the previous file or symbol as current truth?
3. Did that distinction change the next agent's tested engineering result under
   an equal model, tool, budget, and repository boundary?

The artifact must compare only adapters that can satisfy the same write, read,
isolation, and accounting contract. A system that cannot do so is an adapter
failure, not a score of zero.
