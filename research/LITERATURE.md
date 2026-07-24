# Literature And Comparison Boundary

This is a working reading matrix, not a source of additional paper claims. The
arXiv entries used by `paper/references.bib` were cross-checked against the
official arXiv Atom metadata and paper pages on 2026-07-23; the OpenAI
SWE-bench contamination post was cross-checked against its official page on the
same date. The manuscript cites preprints as preprints and does not assume a
venue version unless it is independently verified at submission time.

| Work | What it establishes | What it does not establish for this study |
| --- | --- | --- |
| [Mem0](https://arxiv.org/abs/2504.19413) | A practical long-term memory design and conversational-memory evaluation framing. | Whether a memory layer improves a fresh coding agent's patch after repository evolution. |
| [LongMemEval](https://arxiv.org/abs/2410.10813) | Long-horizon session retrieval and update evaluation. | Repository-state freshness, stale-symbol handling, or hidden-test patch correctness. |
| [MemoryAgentBench](https://arxiv.org/abs/2507.05257) | Incremental multi-turn evaluation across retrieval, test-time learning, long-range understanding, and conflict resolution. | A controlled repository transition followed by a dependent implementation task. |
| [MemoryArena](https://arxiv.org/abs/2602.16313) | Agentic-memory evaluation on agentic tasks, closer in spirit to downstream use than conversation-only recall. | The exact multi-session code-ownership and freshness intervention implemented by MemorixBench-Transfer. |
| [Agent Workflow Memory](https://arxiv.org/abs/2409.07429) | Induces and selectively retrieves reusable routines for later web-navigation tasks. | A fair fresh-coding-agent patch comparison after controlled repository evolution. |
| [EvoArena / EvoMem](https://arxiv.org/abs/2606.13681) | Progressive environment updates across terminal, software, and social domains; a patch-based memory representation for evolving environments. | A reason to avoid any "first dynamic-memory benchmark" claim. The abstract does not establish the same fresh-transfer, equal-evidence multi-system coding-memory comparison or private post-snapshot construction used here. |
| [RepoQA](https://arxiv.org/abs/2406.06025) | Repository-level code understanding and retrieval questions across real projects. | Whether memory retained from an earlier session changes a later agent's patch success. |
| [OpenAI's SWE-bench contamination audit](https://openai.com/index/why-we-no-longer-evaluate-swe-bench-verified) | Public benchmark tasks and solutions can enter training data; contamination checks must be part of evaluation design. | That any individual MemorixBench case is unseen by every model, or that private task construction removes all pretraining exposure. |
| [SWE-EVO](https://arxiv.org/abs/2512.18470) | Long-horizon multi-file repository evolution tasks reconstructed from release notes and version history. | An explicit memory intervention or a fresh-agent transfer experiment. It rules out claiming that multi-step software evolution itself is new. |
| [ChainSWE](https://arxiv.org/abs/2607.02606) | Chronological dependent bug-fix chains in shared codebases, with chain-level coding-agent evaluation. | A fair comparison of memory systems under one bounded predecessor-evidence budget and a sealed private transition. It rules out claiming that dependent coding chains themselves are new. |
| [Cognee](https://github.com/topoteretes/cognee) | A graph-plus-vector knowledge layer with ontology and ingestion emphasis. | A ready-made fair baseline for coding-agent transfer without a pinned adapter and equal evidence budget. |
| [AgentMemory benchmark notes](https://github.com/rohitg00/agentmemory/blob/main/benchmark/COMPARISON.md) | Useful public discussion of retrieval-oriented coding-memory comparisons and the apples-to-oranges risk. | A head-to-head patch-success result on an identical harness. |

## Consequence For MemorixBench-Transfer

MemorixBench-Transfer is not positioned as the first dynamic-environment,
multi-session-memory, or long-horizon coding benchmark. EvoArena/EvoMem,
SWE-EVO, and ChainSWE make each of those broader novelty claims untenable. Its
narrower target is a controlled causal question: a precursor engineering
decision is retained, the repository changes so some implementation evidence is
stale, and a **fresh** agent must make a tested patch with the same current-code
capabilities regardless of whether it receives bounded predecessor evidence.
The protocol keeps raw precursor transcripts, public-history solutions, and the
private transition outside the agent's public input, then compares memory
systems under an equal evidence/context budget.

This makes three separable questions measurable:

1. Did the memory system preserve the durable rule?
2. Did it avoid treating the previous file or symbol as current truth?
3. Did that distinction change the next agent's tested engineering result under
   an equal model, tool, budget, and repository boundary?

The artifact must compare only adapters that can satisfy the same write, read,
isolation, and accounting contract. A system that cannot do so is an adapter
failure, not a score of zero.

## Evaluation consequences

MemoryAgentBench separates retrieval, test-time learning, long-range
understanding, and conflict resolution. MemorixBench-Transfer borrows that
separation but measures its downstream consequence: whether a fresh coding
agent makes a correct patch after the project state changes.

MemoryArena motivates a multi-session action loop rather than a standalone
recall quiz. Our corresponding unit is a precursor engineering session, a
sealed repository transition, and a separate transfer session. The outcome is
not a memory-answer score; it is a private behavioral oracle over the transfer
patch and its tests.

Agent Workflow Memory establishes workflow induction and selective reuse as an
adjacent agent-memory idea. MemorixBench-Transfer does not claim that idea as
new; its narrower question is whether declared predecessor evidence changes a
fresh coding agent's tested patch after a repository transition, while the
no-memory condition retains ordinary current-code access.

The SWE-bench contamination audit is why public issues, pull requests, patches,
and exact behavior predicates are source provenance only. They never become a
public task answer, public hidden test, or public transition. A private
post-snapshot transition reduces answer leakage from the benchmark artifact; it
does not justify an impossible claim that a public repository was absent from
model pretraining. Those two risks are reported separately.

## Revised novelty boundary

The paper may claim a new **evaluation protocol and artifact discipline** only
if the final corpus and execution gates are completed: controlled fresh-agent
transfer after a sealed repository transition, current-source-first/no-memory
control, equal-evidence canonical memory adapters, a separate budgeted native
product surface, stale-guidance outcomes, and fail-closed private-oracle/source
provenance execution. It must not claim first use of evolving repositories,
patch-based memory updates, sequential coding tasks, or dynamic agent-memory
evaluation.
