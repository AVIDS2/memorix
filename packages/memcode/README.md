# @memorix/memcode

Memcode is the first-party coding agent CLI for Memorix. It keeps the full terminal-agent workflow from the Pi codebase while adding native Memorix memory, hook capture, project identity, and runtime status awareness.

## Install

```bash
npm install -g @memorix/memcode
```

Then run:

```bash
memcode
```

## What It Is

Memcode is a normal coding-agent TUI:

- chat with an agent in your terminal
- read, grep, find, edit, write, and run shell commands
- keep resumable sessions and branchable conversation history
- use slash commands for model, session, tree, memory, and configuration workflows
- load user and project skills from `~/.agents/skills`, `~/.memorix/agent/skills`, `.agents/skills`, and `.memorix/skills`

It is also Memorix-native:

- project memory is shared with Claude Code, Codex, OpenCode, Windsurf, and other agents using the same Memorix project identity
- native hooks capture durable project knowledge without making users think about MCP wiring
- `memorix_search`, `memorix_detail`, `memorix_store`, and `memorix_status` are available as first-party agent tools
- `/memory status`, `/memory search`, `/memory show`, `/memory stats`, and `/memory hooks` expose memory health from the TUI
- embedding, BM25 fallback, rerank, retention, and hook status are surfaced to the agent instead of being hidden background magic

## API Key Lanes

Memcode follows the Memorix key-lane convention:

```bash
MEMORIX_AGENT_API_KEY=...      # model used by memcode as the coding agent
MEMORIX_API_KEY=...            # background memory LLM lane used by Memorix
MEMORIX_EMBEDDING_API_KEY=...  # embedding/vector lane used by Memorix search
```

These keys are intentionally separate. Users often choose a strong agent model, a cheaper background memory model, and a different embedding provider.

## Common Commands

```bash
memcode                         # start the TUI
memcode -p "summarize this repo" # print mode
memcode -c                      # continue the most recent session
memcode -r                      # resume from the session picker
memcode --help                  # CLI reference
```

Inside the TUI:

```text
/commands       browse commands
/model          switch model or thinking profile
/memory status  inspect Memorix project memory/runtime status
/memory search  search shared project memory
/tree           inspect or jump conversation branches
/help           show help
```

## Memory Model

Memcode does not create a separate private memory bucket by default. The default user-facing model is:

```text
one project -> one shared Memorix memory pool
```

Memcode-specific observations are distinguished by metadata such as source detail and lifecycle category, not by fragmenting project memory into separate stores. This lets memcode benefit from knowledge captured by other agents and lets other agents benefit from memcode's native hooks.

## Attribution

Memcode is based on the Pi coding-agent codebase and keeps compatibility with much of Pi's extension and session model. The Memorix distribution replaces user-facing package names, configuration roots, runtime memory behavior, and publishing metadata for the Memorix ecosystem.
