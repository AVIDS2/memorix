# memcode Historical Handoff

> This file used to contain an early private development handoff for the memcode fork.
> It is no longer the source of truth for product behavior, setup, release status, or user-facing documentation.

Current public docs:

- [memcode product guide](../MEMCODE.md)
- [Memorix setup guide](../SETUP.md)
- [Configuration guide](../CONFIGURATION.md)
- [Development guide](../DEVELOPMENT.md)

## Current Product Truth

For the 1.1 release line:

- `memorix` opens memcode, the Memorix-native coding agent.
- `memcode` is also available as the standalone binary from `@memorix/memcode`.
- memcode writes to the same project memory pool used by MCP-connected agents.
- Configuration is TOML-first:
  - global `~/.memorix/config.toml`
  - project `<git-root>/memorix.toml`
- The main model lanes are:
  - `[agent]` for the coding model
  - `[memory.llm]` for formation, summaries, deduplication, and rerank
  - `[embedding]` for semantic/vector search
- Legacy `memorix.yml`, `.env`, and `~/.memorix/config.json` files remain compatibility inputs.

## What Was Preserved From The Early Handoff

The useful engineering intent from the original handoff was:

- memcode should be native to Memorix, but external MCP agents remain first-class users of the same memory system.
- Project memory should belong to the user and the Git project, not to one agent session.
- The terminal agent should stay practical: read files, edit files, run commands, resume sessions, and expose memory controls without making users understand internal MCP plumbing.
- Product decisions should be judged by whether they improve real coding workflows, not by whether they add more memory machinery.

Those principles are now reflected in the public docs linked above.
