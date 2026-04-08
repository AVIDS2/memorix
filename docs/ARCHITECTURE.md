# Memorix Architecture

Memorix is an open-source cross-agent memory layer for coding agents via MCP.

It combines three core memory layers:

- **Observation Memory** for what changed and how things work
- **Reasoning Memory** for why choices were made
- **Git Memory** for engineering truth derived from commits

These layers are exposed through MCP tools, CLI workflows, and an HTTP control plane.

---

## 1. System Shape

Memorix is better understood as a container-style architecture with multiple ingress surfaces, a shared runtime/control plane, several memory substrates, and parallel processing/retrieval branches.

```mermaid
flowchart LR
    subgraph Clients["Clients and Surfaces"]
        A1["IDEs / coding agents"]
        A2["CLI / TUI"]
        A3["Dashboard / browser"]
        A4["Git hooks / ingest"]
    end

    subgraph Runtime["Runtime and Control Plane"]
        B1["stdio MCP runtime"]
        B2["HTTP control plane"]
        B3["project binding + config provenance"]
    end

    subgraph Core["Memory Core"]
        C1["Observation store"]
        C2["Reasoning store"]
        C3["Git memory store"]
        C4["Session / team registry"]
    end

    subgraph Intelligence["Intelligence and Quality"]
        D1["Formation + enrichment"]
        D2["Embedding + search index"]
        D3["Graph + relations"]
        D4["Dedup + retention + archive"]
    end

    subgraph Experience["Retrieval and Experience"]
        E1["Search / detail / timeline"]
        E2["Dashboard / team / health"]
        E3["Session handoff / agent recall"]
    end

    A1 --> B1
    A1 --> B2
    A2 --> B1
    A2 --> B2
    A3 --> B2
    A4 --> B1

    B1 --> B3
    B2 --> B3

    B3 --> C1
    B3 --> C2
    B3 --> C3
    B3 --> C4

    C1 --> D1
    C1 --> D2
    C1 --> D3
    C1 --> D4
    C2 --> D1
    C2 --> D3
    C3 --> D2
    C4 --> D3

    D1 --> E1
    D2 --> E1
    D3 --> E2
    D4 --> E3
    C4 --> E3
```

### Access and Runtime Layer

This layer provides the entry points that agents and users actually talk to.

Main pieces:

- `src/server.ts`
- `src/index.ts`
- `src/cli/index.ts`
- `src/cli/commands/serve.ts`
- `src/cli/commands/serve-http.ts`

Responsibilities:

- register MCP tools
- start stdio or HTTP transport
- manage project switching
- load config and dotenv state
- expose the dashboard and HTTP APIs

### Memory Core

This layer stores, indexes, and serves persistent memory.

Main pieces:

- `src/memory/observations.ts`
- `src/store/orama-store.ts`
- `src/memory/session.ts`
- `src/memory/retention.ts`
- `src/memory/graph.ts`
- `src/memory/consolidation.ts`

Responsibilities:

- assign observation IDs
- persist project-scoped memory
- maintain the search index
- manage session state
- retention, archive, and deduplication
- knowledge graph entities and relations

### Intelligence and Quality Layer

This layer improves memory quality and retrieval quality.

Main pieces:

- `src/memory/formation/`
- `src/search/intent-detector.ts`
- `src/compact/engine.ts`
- `src/llm/quality.ts`
- `src/embedding/provider.ts`

Responsibilities:

- formation pipeline
- fact extraction and evaluation
- source-aware retrieval
- compact formatting and token budgeting
- optional embedding-backed semantic search
- optional LLM-assisted quality improvements

### Platform and Ecosystem Layer

This is the layer that makes Memorix more than a simple MCP memory server.

Main pieces:

- `src/hooks/`
- `src/git/`
- `src/workspace/`
- `src/rules/`
- `src/team/`
- `src/skills/`
- `src/dashboard/`

Responsibilities:

- IDE hook capture
- Git Memory ingestion
- workspace and rule sync across agents
- team collaboration
- mini-skills and memory-driven workflows
- dashboard and control plane APIs

---

## 2. Core Memory Layers

### Observation Memory

Observation memory captures operational and architectural facts such as:

- `what-changed`
- `problem-solution`
- `decision`
- `trade-off`
- `gotcha`
- `how-it-works`

This is the main general-purpose memory layer.

### Reasoning Memory

Reasoning memory stores the thinking behind non-trivial decisions:

- why a choice was made
- alternatives considered
- constraints
- expected outcomes
- known risks

This layer is useful when a future agent asks:

- why did we do this?
- what trade-off did we accept?

### Git Memory

Git Memory turns commits into structured memory with source provenance:

- `source='git'`
- `commitHash`
- changed files
- inferred observation type
- extracted concepts

This creates an engineering truth layer that complements human- or agent-authored observations.

---

## 3. Main Data Flows

The core operational model is not a single straight line. Memorix has multiple write paths that converge into shared memory substrates, then fan out again into indexing, quality, and retrieval surfaces.

```mermaid
flowchart TB
    W1["Manual store / MCP tools"]
    W2["Git commit / git-hook / ingest"]
    W3["IDE hook event"]
    W4["Session start / team activity"]

    W1 --> R["Runtime validation + project binding"]
    W2 --> R
    W3 --> R
    W4 --> R

    R --> S1["Observation persistence"]
    R --> S2["Reasoning persistence"]
    R --> S3["Git memory extraction"]
    R --> S4["Session + team state"]

    S1 --> P1["Formation / enrichment"]
    S1 --> P2["Embedding / BM25 index"]
    S1 --> P3["Graph relation update"]
    S1 --> P4["Dedup / retention"]
    S2 --> P1
    S2 --> P3
    S3 --> P2
    S4 --> P3

    P1 --> Q1["Search results"]
    P2 --> Q1
    P3 --> Q2["Dashboard / graph / team"]
    P4 --> Q3["Handoff / archive / cleanup"]
    S4 --> Q3
```

### Explicit store flow

- `memorix_store` / `memorix_store_reasoning`
- runtime validation and project binding
- persistence into observation/reasoning memory
- async quality/indexing branches
- retrieval through search/detail/timeline or dashboard surfaces

### Git Memory flow

- `git commit`
- post-commit hook or manual `memorix ingest commit --auto`
- git extractor + noise filter
- persistence as Git Memory with provenance
- indexing and retrieval through normal search surfaces

### Hook capture flow

- IDE hook event
- normalize and significance detection
- optional memory write
- session-aware context update

### Retrieval flow

- `memorix_search` -> project-scoped search by default -> BM25 or hybrid retrieval -> source-aware ranking -> compact formatting
- `memorix_detail` -> full observation lookup with project-aware refs for global hits
- `memorix_timeline` -> chronological context around an anchor observation

---

## 4. Retrieval Model

Memorix does not treat all memory equally.

### Default scope

- `memorix_search` defaults to the current project
- `scope="global"` searches across projects
- global hits can be opened with project-aware refs in `memorix_detail`

### Source-aware retrieval

Retrieval weights memory differently depending on intent:

- "what changed" style queries boost Git Memory
- "why" style queries boost reasoning and decision memory
- "problem" style queries can boost both operational fixes and Git Memory

### Progressive disclosure

Memorix retrieval is layered:

- compact search results
- timeline context
- full detail only when explicitly requested

This keeps normal retrieval efficient while still allowing deep inspection.

---

## 5. Project Identity Model

Project identity is central to Memorix.

Main idea:

- memory is project-scoped by default
- project IDs come from Git identity
- aliases and identity health are tracked explicitly

This prevents unrelated repositories, IDE install folders, or system directories from polluting the same memory namespace.

Useful runtime tools and surfaces:

- `memorix status`
- dashboard identity health page
- global search with project-aware refs

---

## 6. Configuration Model

Memorix is intentionally converging on:

- `memorix.yml` for behavior
- `.env` for secrets

Resolution order:

### Behavior settings

1. environment variables
2. project `memorix.yml`
3. user `~/.memorix/memorix.yml`
4. legacy `~/.memorix/config.json`
5. defaults

### Secrets

1. shell or host-provided environment variables
2. project `.env`
3. user `~/.memorix/.env`

The dashboard and `memorix status` expose config provenance so the active value source is visible.

---

## 7. Runtime Modes

### `memorix serve`

Starts the stdio MCP server.

Use this for:

- Cursor
- Claude Code
- Codex
- Windsurf
- other stdio MCP clients

### `memorix background start`

Starts the recommended long-lived HTTP control plane and dashboard in the background.

Use this when you want:

- an HTTP MCP endpoint
- one shared Memorix process for multiple agents
- Team features
- the control plane dashboard

Companion commands:

- `memorix background status`
- `memorix background logs`
- `memorix background stop`

### `memorix serve-http --port 3211`

Starts the same HTTP MCP server and dashboard in the foreground.

Use this when you want:

- foreground logs
- manual supervision
- a custom port
- custom launch control

Main URLs:

- MCP endpoint: `http://localhost:3211/mcp`
- dashboard: `http://localhost:3211`

### `memorix dashboard`

Standalone dashboard mode.

Useful for local inspection and debugging, but the main product mode is the dashboard embedded in the HTTP control plane.

---

## 8. Session and Control-Plane Collaboration

The HTTP control plane is not just a transport wrapper. It is the coordination layer that keeps multiple agents, multiple projects, and multiple UX surfaces from drifting apart.

```mermaid
flowchart LR
    A1["Agent / IDE session"] --> B1["HTTP MCP initialize"]
    B1 --> B2["memorix_session_start(projectRoot)"]
    B2 --> C1["Project binding"]
    C1 --> C2["Session context"]
    C1 --> C3["Config provenance"]
    C1 --> C4["Team / task registry"]

    C2 --> D1["Recent Handoff"]
    C2 --> D2["Key Project Memories"]
    C2 --> D3["Recent Session History"]

    C3 --> E1["doctor / status"]
    C3 --> E2["dashboard config + health"]

    C4 --> F1["team status"]
    C4 --> F2["tasks / messages / locks"]
    C4 --> F3["dashboard team view"]
```

This is the layer that gives Memorix its cross-agent behavior:

- explicit `projectRoot` binding for HTTP sessions
- Git-backed project identity
- shared team/task/message state
- session handoff context that survives across clients and runs
- dashboard and CLI surfaces reading the same underlying runtime state

---

## 9. Dashboard as Control Plane

The dashboard is no longer just an observation browser.

It acts as a control plane for:

- memory source breakdown
- Git Memory visibility
- config provenance
- identity health
- sessions
- retention state
- team collaboration in HTTP mode

This is part of Memorix's shift from a single MCP server to a broader local memory platform.

---

## 10. Design Goals

Memorix is designed around a few guiding ideas:

- **Local-first**: memory should stay on the developer machine by default
- **Project-safe**: default recall should respect project boundaries
- **Cross-agent**: different tools should share one memory base
- **Layered truth**: Git Memory, observation memory, and reasoning memory each serve different jobs
- **Quality over volume**: retention, formation, compaction, and noise filtering matter as much as raw storage

---

## 10. Related Docs

- [Setup Guide](SETUP.md)
- [Configuration Guide](CONFIGURATION.md)
- [Git Memory Guide](GIT_MEMORY.md)
- [API Reference](API_REFERENCE.md)
- [Development Guide](DEVELOPMENT.md)
