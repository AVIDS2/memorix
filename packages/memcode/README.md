# memcode

> First-party memagent with shared Memorix project memory.

memcode is the first-party terminal agent for Memorix. It can read from and write to the same project memory used by MCP-connected agents.

Install it directly:

```bash
npm install -g @memorix/memcode
memcode
```

Or install Memorix and use the bundled entry:

```bash
npm install -g memorix
memorix
```

Both routes enter the same memcode TUI.

## What memcode Adds

| Capability | What it means |
| --- | --- |
| Native project memory | memcode reads and writes the same Memorix memory pool as MCP-connected agents |
| Hook capture | prompts, tool calls, assistant output, and session lifecycle feed the Memorix hook pipeline |
| Session continuity | continue, resume, fork, name, export, and inspect coding sessions |
| Model control | provider/model flags, `/model switch`, thinking levels, scoped model cycling |
| Tool control | read, bash, edit, write, grep, find, ls plus allow/deny lists |
| Memory commands | `/memory status`, `/memory search`, `/memory show`, `/memory stats`, `/memory hooks` |
| Extensions | user/project skills, prompt templates, themes, and extension packages |
| Scriptable modes | interactive TUI, print mode, JSON event stream, and RPC mode |

## Quick Start

```bash
memcode                         # start the TUI
memcode -p "summarize this repo" # print mode
memcode -c                      # continue the most recent session
memcode -r                      # resume from the session picker
memcode --help                  # full CLI reference
```

Useful read-only review mode:

```bash
memcode --tools read,grep,find,ls -p "review the auth module"
```

Use a specific model:

```bash
memcode --model openai/gpt-4o "refactor this command parser"
memcode --model sonnet:high "debug this failing test"
```

Include files in the first prompt:

```bash
memcode @README.md @src/index.ts "what should change before release?"
```

## Inside The TUI

Common slash commands:

```text
/help             show available commands
/model switch     switch model or thinking profile
/memory status    inspect Memorix runtime and memory health
/memory search    search shared project memory
/memory show      browse stored memories
/memory hooks     inspect native hook state
/resume           resume a previous session
/tree             navigate the session tree
/fork             fork the current session
/git status       show working-tree status
/git diff         inspect a file diff
/config           open configuration
```

The TUI works like a normal coding agent: keep a session open, let the agent inspect files and run commands, then resume later without re-explaining the project.

## Memory Model

memcode does not create a separate private memory bucket.

```text
one Git project -> one shared Memorix memory pool
```

That means:

- memcode can use memories captured by Claude Code, Codex, Cursor, Windsurf, and other Memorix-connected agents
- those agents can use memories captured by memcode
- memcode-specific records are distinguished by source metadata, not by a separate store

Native hook capture makes this feel automatic: useful project knowledge from memcode sessions can become durable Memorix memory without forcing users to wire an external MCP server into memcode.

## Configuration

memcode follows the Memorix TOML configuration lanes:

```toml
[agent]
provider = "openai"
model = "gpt-4o"
api_key = "..."

[memory.llm]
provider = "openai"
model = "gpt-4o-mini"
api_key = "..."

[embedding]
provider = "auto"
```

Use:

- `[agent]` for the model memcode talks to while coding
- `[memory.llm]` for background memory formation, summaries, deduplication, and rerank
- `[embedding]` for semantic/vector search

These lanes are separate on purpose. A common setup is a strong coding model, a cheaper background memory model, and local or low-cost embeddings.

Environment variables still work for quick runs and provider compatibility:

```bash
OPENAI_API_KEY=...
ANTHROPIC_API_KEY=...
GEMINI_API_KEY=...
OPENROUTER_API_KEY=...
MEMCODE_OFFLINE=1
```

See the root [Configuration Guide](https://github.com/AVIDS2/memorix/blob/main/docs/CONFIGURATION.md) for the full TOML model.

## Sessions

```bash
memcode -c                 # continue the most recent session
memcode -r                 # open the resume picker
memcode --session <id>     # use a specific session
memcode --session-id <id>  # create or use an exact project session ID
memcode --fork <id>        # fork a previous session
memcode --name "Release docs"
memcode --export session.jsonl output.html
```

Session storage lives under the Memorix agent config area by default, so memcode sessions travel with the rest of the local Memorix runtime state.

## Tools And Safety

Built-in tools:

| Tool | Purpose |
| --- | --- |
| `read` | Read file contents |
| `bash` | Execute shell commands |
| `edit` | Edit files with find/replace |
| `write` | Create or overwrite files |
| `grep` | Search file contents |
| `find` | Find files by glob |
| `ls` | List directory contents |

Useful flags:

```bash
memcode --no-tools
memcode --no-builtin-tools
memcode --tools read,grep,find,ls
memcode --exclude-tools bash,write
memcode --no-context-files
memcode --approve
memcode --no-approve
```

Project-local instructions, skills, prompt templates, themes, and packages are trust-sensitive. Use `--approve` for a trusted project-local run, and `--no-approve` when you want to ignore project-local resources.

## Extensions, Skills, Themes

memcode can load:

- extension files via `--extension`
- skills via `--skill`
- prompt templates via `--prompt-template`
- themes via `--theme`
- package resources through `memcode install`, `memcode list`, `memcode config`, `memcode update`

Examples:

```bash
memcode install <source>
memcode list
memcode config
memcode update self
```

## Relationship To Memorix

Memorix is the shared memory layer. memcode is a first-party memagent built on top of it.

Use Memorix when you want Claude Code, Codex, Cursor, Windsurf, Copilot, Gemini CLI, OpenCode, Kiro, Antigravity, Trae, or another MCP client to share project memory.

Use memcode when you want a bundled terminal agent that already uses that memory layer natively.

## Attribution

memcode is based on the Pi coding-agent codebase and keeps compatibility with much of Pi's extension and session model. The Memorix distribution replaces user-facing package names, configuration roots, runtime memory behavior, and publishing metadata for the Memorix ecosystem.
