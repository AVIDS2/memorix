# Development Guide

This guide is for contributors working on Memorix itself.

Memorix is a TypeScript project built around:

- MCP server runtime
- CLI workflows
- local JSON persistence
- Orama search
- dashboard and HTTP control plane

## Current Release Baseline

The current published release line is **1.0.6**.

Contributors should assume the following are already part of the supported product surface:

- provenance-aware memory fields and layered retrieval semantics
- evidence-aware detail and timeline outputs
- verification-aware and citation-lite compact output
- task-line scoping, secret-safety, and attribution auditing
- calibrated retention plus cleanup/remediation loop ergonomics
- OpenCode `post_compact` support and structured continuation compaction prompt

---

## 1. Prerequisites

- Node.js `>=20`
- npm
- Git

Clone and install:

```bash
git clone https://github.com/AVIDS2/memorix.git
cd memorix
npm install
```

Optional local dependencies:

- `fastembed` for local embedding experiments
- `@huggingface/transformers` for transformer embedding mode

Memorix still works without them.

---

## 2. Core Commands

### Build

```bash
npm run build
```

### Watch mode

```bash
npm run dev
```

### Typecheck

```bash
npm run lint
```

`lint` currently runs `tsc --noEmit`.

### Full test suite

```bash
npm test
```

### Vitest watch mode

```bash
npm run test:watch
```

### Local runtime checks

```bash
memorix serve
memorix background start
memorix status
```

---

## 3. Recommended Development Loop

For most feature work:

1. write or update a focused test
2. implement the change
3. run the targeted test file
4. run `npm run lint`
5. run `npm run build`
6. run `npm test`
7. validate the real MCP or CLI path if the feature affects runtime behavior

Examples:

```bash
npx vitest run tests/git/noise-filter.test.ts
npm run lint
npm run build
npm test
```

If the feature touches the dashboard, HTTP transport, or MCP wiring, do a live verification after the test suite.

---

## 4. Repository Structure

High-level layout:

```text
src/
  cli/                 interactive menu and subcommands
  compact/             compact formatting and token budgeting
  config/              YAML, dotenv, and configuration loading
  dashboard/           dashboard server and static frontend
  embedding/           embedding providers
  git/                 Git Memory extractor, hook path, noise filter
  hooks/               IDE hook normalization and capture
  llm/                 optional LLM quality helpers
  memory/              observations, sessions, retention, graph, formation
  project/             Git-based project detection and aliases
  rules/               rules sync across agents
  search/              intent-aware retrieval helpers
  skills/              memory-driven skills generation
  store/               Orama index and persistence
  team/                collaboration registry, tasks, locks, messages
  workspace/           MCP and workflow sync across agents

tests/
  ...mirrors runtime modules with focused unit and integration tests
```

Docs layout:

- `README.md`: landing page and quick start
- `docs/SETUP.md`: client setup and troubleshooting
- `docs/CONFIGURATION.md`: `memorix.yml + .env`
- `docs/GIT_MEMORY.md`: Git Memory workflows
- `docs/ARCHITECTURE.md`: system design
- `docs/API_REFERENCE.md`: MCP tool surface

---

## 5. Runtime Modes to Validate

### stdio MCP

```bash
memorix serve
```

Use this to validate:

- tool registration
- stdio MCP behavior
- IDE integration compatibility

### HTTP MCP + dashboard

```bash
memorix background start
```

Use this to validate:

- HTTP MCP endpoint
- Team tools
- dashboard API parity
- dashboard UX

Use `memorix serve-http --port 3211` when you want the same stack in the foreground for debugging, manual supervision, or custom ports.

### Dashboard-only mode

```bash
memorix dashboard
```

Useful for local UI checks, but the main product dashboard is the one embedded in the HTTP control plane.

---

## 6. Feature Areas Worth Testing Live

Some features deserve real runtime verification, not just tests:

- project identity detection
- config provenance
- Git hook installation and post-commit ingest
- cross-project search and detail refs
- HTTP transport and Team tools
- dashboard graph stability and page layout

When validating these, prefer:

- real MCP calls
- real CLI commands
- real temporary Git repositories

over only unit tests.

---

## 7. Git Memory Development Notes

Git Memory is one of Memorix's most important product differentiators.

When working in this area, validate:

- `memorix git-hook --force`
- `memorix git-hook-uninstall`
- `memorix ingest commit`
- `memorix ingest commit --force`
- `memorix ingest log --count N`

Also validate behavior in:

- normal repositories
- worktrees
- noisy commit streams

See [GIT_MEMORY.md](GIT_MEMORY.md) for user-facing behavior.

---

## 8. Configuration Development Notes

Memorix is converging on:

- `memorix.yml` for behavior
- `.env` for secrets

When touching config code, always validate:

- project `memorix.yml`
- user `~/.memorix/memorix.yml`
- project `.env`
- user `~/.memorix/.env`
- legacy `~/.memorix/config.json`
- env var overrides

And always check:

```bash
memorix status
```

to make sure provenance diagnostics match runtime behavior.

---

## 9. Release Workflow

Recommended release flow:

1. update docs and version metadata
2. run:

```bash
npm run lint
npm run build
npm test
```

3. validate key live flows:

- MCP store/search/detail
- dashboard
- Git Memory
- config diagnostics

4. commit and push
5. publish manually when ready

Notes:

- `prepublishOnly` already runs build + test
- npm publish is usually manual, especially when 2FA is enabled
- GitHub release automation should not be treated as a substitute for manual runtime validation

---

## 10. Contribution Standards

When contributing to Memorix:

- keep public docs aligned with runtime behavior
- prefer explicit, project-safe behavior over clever fallback
- avoid adding features without a clear product story
- validate MCP behavior with real calls when changing server logic
- keep Git Memory, reasoning memory, and retrieval semantics coherent

Memorix is strongest when its engineering truth layer, reasoning layer, and local control plane all stay in sync.

---

## 11. Related Docs

- [Setup Guide](SETUP.md)
- [Configuration Guide](CONFIGURATION.md)
- [Git Memory Guide](GIT_MEMORY.md)
- [Architecture](ARCHITECTURE.md)
- [API Reference](API_REFERENCE.md)
