# memcode Development Document

> Version: DRAFT
> Date: 2026-06-09
> Author: 五条老师 + 虎杖悠仁
> Branch: feat/memcode-agent

---

## 1. Product Definition

### 1.1 What is memcode

memcode is Memorix's native coding agent with deep, source-level integration of Memorix's memory system.

```
npm install -g memorix
memorix              → memcode TUI (native entry, default)
memorix serve        → MCP Server (for external IDEs)
memorix serve-http   → HTTP MCP Server
memorix init         → Initialize project
memorix <command>    → Other CLI commands
```

**One npm package. One repo. No separate project.**

### 1.2 Product Philosophy

- **Cyber USB Drive**: Memory plugs into any agent (Cursor, Claude Code, Codex, memcode). Unplug the agent, memory stays.
- **No lock-in**: External agents connect via MCP equally. memcode is the "first-class child" with native integration, but MCP is the equal-opportunity interface.
- **Product over tech**: Every feature must improve the user's actual workflow. Memory for memory's sake is noise.

### 1.3 Design Principles

| Principle | What It Means for memcode |
|---|---|
| 4 primitive tools (read/write/edit/bash) | Minimal surface area, easy to extend |
| System prompt < 1000 tokens | Room for memory instructions without bloat |
| Custom TUI with differential rendering (~600 lines) | Fast, no React/Ink overhead |
| Extension system (tools, commands, handlers, flags) | Native hook point for memory tools |
| Tree-structured JSONL sessions | Branching, forking, compaction built-in |
| Minimal dependencies, maximum composability | Small footprint, easy to reason about |

---

## 2. Architecture Overview

### 2.1 Layer Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                      CLI Entry Layer                         │
│  memorix (no args) → memcode TUI                            │
│  memorix serve     → MCP Server                             │
│  memorix <cmd>     → other commands                         │
└────────────┬──────────────────────────┬─────────────────────┘
             │                          │
             ▼                          ▼
┌────────────────────────┐  ┌─────────────────────────────────┐
│       memcode          │  │   Memorix MCP Server            │
│  packages/memcode/     │  │   src/server.ts                 │
│  packages/agent-core/  │  │                                 │
│  packages/ai/          │  │   (existing, untouched)         │
│  packages/tui/         │  └─────────────────────────────────┘
│                        │
│  ┌───────────────────┐ │  ┌─────────────────────────────────┐
│  │ Memory Integration│─┼──│   Memorix Memory Core           │
│  │  (source import)  │ │  │   src/memory/                   │
│  └───────────────────┘ │  │   src/store/                    │
│                        │  │   src/compact/                  │
│  ┌───────────────────┐ │  │   src/search/                  │
│  │ Session Layer     │ │  │   src/embedding/               │
│  │ (JSONL, tree)     │ │  │   src/llm/                     │
│  └───────────────────┘ │  └─────────────────────────────────┘
└────────────────────────┘
```

### 2.2 Package Structure (npm workspaces)

```
memorix/
├── packages/
│   ├── ai/                     ← @memorix/ai
│   │   └── ...                 ← LLM abstraction, 26 providers, streaming
│   ├── agent-core/             ← @memorix/agent-core
│   │   └── ...                 ← Agent loop, AgentHarness, Session abstraction
│   ├── tui/                    ← @memorix/tui
│   │   └── ...                 ← Differential rendering TUI, Editor, Components
│   └── memcode/                ← @memorix/memcode
│       └── ...                 ← AgentSession, SessionManager, Tools, Extensions, Memory integration
│
├── src/                        ← Memorix core (existing, mostly untouched)
│   ├── memory/                 ← Memory write/search/formation
│   ├── store/                  ← SQLite + Orama backends
│   ├── compact/                ← 3-layer disclosure engine
│   ├── search/                 ← Intent detection + query expansion
│   ├── llm/                    ← LLM provider for memory operations
│   ├── embedding/              ← Vector embedding (fastembed/HF/API)
│   ├── hooks/                  ← IDE hook system (9 adapters)
│   ├── rules/                  ← Rule sync (9 adapters)
│   ├── workspace/              ← Workspace sync (10 MCP adapters)
│   ├── orchestrate/            ← Multi-agent orchestration
│   ├── team/                   ← Team collaboration
│   ├── skills/                 ← Skill system
│   ├── cli/                    ← CLI commands + Ink/React dashboard TUI
│   ├── server.ts               ← MCP Server (30+ tools)
│   ├── sdk.ts                  ← Programmatic API
│   └── types.ts                ← Global type definitions
│
├── vendor/pi/                  ← Upstream Pi mirror (read-only, for merge reference)
│   └── packages/{ai,agent,tui,coding-agent}
│
├── docs/memcode/               ← memcode development docs
├── package.json                ← Root package.json with workspaces
├── tsup.config.ts              ← Build config (packages/ + src/ entries)
└── tsconfig.json               ← TypeScript config with path aliases
```

### 2.3 Dependency Graph

```
@memorix/tui            (standalone, no internal deps)
        ↑
@memorix/ai             (standalone, no internal deps)
        ↑
@memorix/agent-core     depends on: @memorix/ai
        ↑
@memorix/memcode        depends on: @memorix/agent-core, @memorix/ai, @memorix/tui
                         imports from: src/memory/, src/store/, src/compact/, src/search/
```

---

## 3. Build Configuration

### 3.1 npm workspaces

```json
// package.json (root)
{
  "workspaces": [
    "packages/ai",
    "packages/agent-core",
    "packages/tui",
    "packages/memcode"
  ]
}
```

### 3.2 tsup.config.ts

```typescript
// tsup.config.ts
import { defineConfig } from 'tsup';

export default defineConfig([
  // Existing Memorix entries (unchanged)
  {
    entry: ['src/index.ts'],
    format: ['esm'],
    dts: true,
    clean: true,
  },
  {
    entry: ['src/cli/index.ts'],
    format: ['esm'],
    clean: false,
  },
  // New: memcode entry
  {
    entry: ['packages/memcode/src/index.ts'],
    format: ['esm'],
    dts: true,
    clean: false,
    outDir: 'dist/memcode',
  },
]);
```

### 3.3 package.json exports

```json
{
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "types": "./dist/index.d.ts"
    },
    "./memcode": {
      "import": "./dist/memcode/index.js",
      "types": "./dist/memcode/index.d.ts"
    },
    "./types": {
      "import": "./dist/types.js",
      "types": "./dist/types.d.ts"
    }
  }
}
```

### 3.4 CLI entry routing

```typescript
// src/cli/index.ts (modified)
import { parseArgs } from 'node:util';

const args = process.argv.slice(2);

if (args.length === 0) {
  // No args → enter memcode TUI
  const { startMemcode } = await import('@memorix/memcode');
  await startMemcode();
} else if (args[0] === 'serve') {
  // ... existing MCP server logic
} else {
  // ... existing CLI command routing
}
```

---

## 4. Storage Design

### 4.1 Storage Decision Matrix

| Data | Backend | Path | Rationale |
|---|---|---|---|
| Session conversation history | JSONL files | `~/.memorix/sessions/<projectId>/` | Tree-structured (id + parentId), append-only, crash-safe, human-readable |
| Memory (observations) | SQLite | `~/.memorix/data/<projectId>/memories.db` | BM25 + vector search, bucket/tag/score filtering, existing Memorix backend |
| Session metadata index | SQLite (optional) | `~/.memorix/sessions.db` | Fast session listing for /resume picker, rebuildable from JSONL |
| Knowledge graph | SQLite | Same as memories.db | Entity-Relation storage |
| Search index | Orama (in-memory) | Hydrated from SQLite | BM25 full-text + optional vector |
| Embedding cache | JSON | `~/.memorix/data/.embedding-cache.json` | Avoid re-computation on restart |

### 4.2 Why JSONL for Sessions (not SQLite)

1. **Tree-structured branching**: Each record has `id` + `parentId`. JSONL is naturally append-only with this structure. SQLite would require recursive CTEs for tree traversal.
2. **Append-only = crash-safe**: Never corrupts existing data. A crash mid-write loses only the last line.
3. **Human-readable**: `cat session.jsonl` works. Users can inspect and manually edit.
4. **Format fit**: JSONL naturally supports tree-structured records with `id` + `parentId` — no recursive queries needed.

### 4.3 Tree-structured Session Example

```
m001 (user)  →  m002 (assistant)  →  m003 (user)  →  m004 (assistant)  ← active leaf
                                     ↘ l001 (label)
                                     ↘ m005 (user)  →  bs01 (branch_summary)  ← abandoned branch
```

Undo = set next message's `parentId` to `m002`, creating a new fork. Original `m003→m004` path remains forever.

### 4.4 Directory Layout

```
~/.memorix/
├── data/
│   └── <projectId>/
│       ├── memories.db           ← SQLite (Memorix core, unchanged)
│       └── ...
├── sessions.db                   ← SQLite (lightweight index, optional)
└── sessions/
    └── <projectId>/
        ├── 20260609_a3f9k.jsonl
        ├── 20260608_b2e8j.jsonl
        └── ...
```

### 4.5 Session Metadata Index (SQLite)

```sql
-- Lightweight index for /resume session picker
CREATE TABLE IF NOT EXISTS session_index (
  session_id   TEXT PRIMARY KEY,
  name         TEXT,           -- from /name or --name
  file_path    TEXT NOT NULL,  -- absolute path to .jsonl
  project_id   TEXT NOT NULL,
  cwd          TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  message_count INTEGER DEFAULT 0,
  parent_session_id TEXT       -- for forked sessions
);

CREATE INDEX IF NOT EXISTS idx_session_project ON session_index(project_id);
CREATE INDEX IF NOT EXISTS idx_session_updated ON session_index(updated_at DESC);
```

Source of truth remains JSONL. This index is a cache — rebuildable at any time by scanning JSONL files.

### 4.6 Data Migration

**None required.** memcode directly reuses existing `~/.memorix/data/` directory. Memories, knowledge graph, sessions — zero migration. Existing Memorix users upgrade seamlessly.

---

## 5. Seven Integration Points

### 5.1 Overview

| # | Integration Point | Location | Modification | Priority |
|---|---|---|---|---|
| 1 | Memory Injection | `AgentHarness.executeTurn()` → `before_agent_start` hook | Call `compactSearch()` → inject into system prompt | P0 |
| 2 | Memory Storage | `AgentSession` → `agent_end` event listener | Extract summary → call `storeObservation()` | P0 |
| 3 | Tool Registration | `AgentSession._toolRegistry` Map | Register `memorix_search`, `memorix_store`, `memorix_detail` as native tools | P0 |
| 4 | System Prompt | `ResourceLoader` → system prompt assembly | Add memory usage instructions | P1 |
| 5 | Session Path | `SessionManager.sessionsRoot` | Change to `~/.memorix/sessions/` | P1 |
| 6 | AGENTS.md | `ResourceLoader` file discovery | `~/.memorix/AGENTS.md` + project-level traversal | P1 |
| 7 | Storage Format | `JsonlSessionStorage` / `JsonlSessionRepo` | Keep JSONL (source of truth), add optional SQLite index | P2 |

### 5.2 Integration Point 1: Memory Injection

**Goal**: Before each LLM turn, inject relevant memories into the context so the agent has persistent knowledge.

**Location**: `packages/memcode/src/memory/memory-injection.ts`

**Hook**: `AgentHarness.executeTurn()` emits `before_agent_start`. We listen for this event and inject memories.

```typescript
// packages/memcode/src/memory/memory-injection.ts
import { compactSearch } from '../../../src/compact/engine.js';

interface MemoryInjectionConfig {
  maxTokens: number;          // token budget for injected memories
  queryStrategy: 'auto' | 'last-message' | 'full-context';
  enabled: boolean;
}

export async function injectMemories(
  context: AgentContext,
  config: MemoryInjectionConfig,
  projectId: string,
): Promise<void> {
  if (!config.enabled) return;

  // Build search query from recent messages
  const query = buildSearchQuery(context.messages, config.queryStrategy);

  // Search Memorix memory (direct import, no MCP overhead)
  const results = await compactSearch({
    query,
    projectId,
    maxResults: 10,
    tokenBudget: config.maxTokens,
  });

  if (results.length === 0) return;

  // Format as context block
  const memoryBlock = formatMemoryContext(results);

  // Prepend to system prompt (or append as context section)
  context.systemPrompt += `\n\n## Relevant Memories\n${memoryBlock}`;
}
```

**Data flow**:
```
User sends message
  → AgentHarness.executeTurn()
  → before_agent_start event
  → injectMemories()
  → compactSearch() [src/compact/engine.ts, direct import]
  → format results → prepend to systemPrompt
  → runLoop() starts with enriched context
```

### 5.3 Integration Point 2: Memory Storage

**Goal**: After each agent turn, extract key information and store it as a Memorix observation.

**Location**: `packages/memcode/src/memory/memory-storage.ts`

**Hook**: `AgentSession` emits `agent_end` event via `ExtensionRunner`.

```typescript
// packages/memcode/src/memory/memory-storage.ts
import { storeObservation } from '../../../src/memory/observations.js';

interface MemoryStorageConfig {
  enabled: boolean;
  autoExtract: boolean;       // use LLM to extract key info
  minTurnsForStorage: number; // skip trivial single-turn exchanges
}

export async function storeMemoryFromTurn(
  messages: AgentMessage[],
  projectId: string,
  sessionId: string,
  config: MemoryStorageConfig,
): Promise<void> {
  if (!config.enabled) return;
  if (messages.length < config.minTurnsForStorage) return;

  // Extract summary from assistant messages
  const summary = extractTurnSummary(messages);
  if (!summary || summary.length < 50) return; // skip trivial

  // Store as observation (direct import, no MCP)
  await storeObservation({
    entityName: projectId,
    type: 'how-it-works',
    title: summary.title,
    narrative: summary.narrative,
    facts: summary.facts,
    filesModified: summary.filesModified,
    concepts: summary.concepts,
    projectId,
    sessionId,
    source: 'agent',
    sourceDetail: 'explicit',
  });
}
```

**Data flow**:
```
Agent completes turn
  → agent_end event
  → storeMemoryFromTurn()
  → extractTurnSummary() [analyze assistant messages]
  → storeObservation() [src/memory/observations.ts, direct import]
  → SQLite + Orama index updated
```

### 5.4 Integration Point 3: Tool Registration

**Goal**: Expose Memorix search/store as native agent tools so the LLM can actively query and save memories.

**Location**: `packages/memcode/src/tools/memory-tools.ts`

**Mechanism**: Register tools via `Extension.tools` Map in the Extension system.

```typescript
// packages/memcode/src/tools/memory-tools.ts
import type { ToolDefinition } from '../extensions/types.js';

export function createMemorySearchTool(): ToolDefinition {
  return {
    name: 'memorix_search',
    label: 'Memory Search',
    description: 'Search your persistent memory for relevant context, past decisions, and project knowledge.',
    parameters: Type.Object({
      query: Type.String({ description: 'Search query' }),
      type: Type.Optional(Type.String({ description: 'Filter by observation type' })),
    }),
    execute: async (toolCallId, params, signal) => {
      const results = await compactSearch({
        query: params.query,
        projectId: getProjectId(),
        maxResults: 5,
      });
      return {
        content: [{ type: 'text', text: formatSearchResults(results) }],
        details: results,
      };
    },
  };
}

export function createMemoryStoreTool(): ToolDefinition {
  return {
    name: 'memorix_store',
    label: 'Memory Store',
    description: 'Store important information, decisions, or findings to persistent memory for future sessions.',
    parameters: Type.Object({
      title: Type.String({ description: 'Brief title' }),
      content: Type.String({ description: 'Detailed content' }),
      type: Type.String({ description: 'Observation type (decision, gotcha, problem-solution, how-it-works)' }),
      concepts: Type.Optional(Type.Array(Type.String())),
    }),
    execute: async (toolCallId, params) => {
      const result = await storeObservation({
        entityName: getProjectId(),
        type: params.type as ObservationType,
        title: params.title,
        narrative: params.content,
        concepts: params.concepts,
        projectId: getProjectId(),
        source: 'agent',
      });
      return {
        content: [{ type: 'text', text: `Stored: ${params.title}` }],
        details: result,
      };
    },
  };
}
```

### 5.5 Integration Point 4: System Prompt

**Goal**: Add memory-specific instructions to the system prompt.

**Location**: `packages/memcode/src/prompts/memory-instructions.ts`

```typescript
export const MEMORY_SYSTEM_PROMPT_SECTION = `
## Persistent Memory

You have access to a persistent memory system (Memorix). Use it to:

- **Search memory** before starting work: look up past decisions, known issues, project context
- **Store important findings**: architecture decisions, bug root causes, non-obvious gotchas
- **Don't store noise**: greetings, trivial reads, redundant status updates

Memory types:
- decision: architecture or design choices
- problem-solution: bug root cause + fix
- gotcha: non-obvious pitfalls
- how-it-works: implementation explanations
`;
```

Injected via `ResourceLoader` into the system prompt assembly.

### 5.6 Integration Point 5: Session Path

**Location**: `packages/memcode/src/session/memcode-session-manager.ts`

```typescript
// Override session directory
const MEMCODE_SESSION_DIR = path.join(os.homedir(), '.memorix', 'sessions');

export class MemcodeSessionManager extends SessionManager {
  static getDefaultSessionDir(): string {
    return MEMCODE_SESSION_DIR;
  }
}
```

### 5.7 Integration Point 6: AGENTS.md

**Location**: `packages/memcode/src/resources/memcode-resource-loader.ts`

Discovery hierarchy:
1. Global: `~/.memorix/AGENTS.md`
2. Walk up parent directories from cwd
3. Project-level: `<project>/.memorix/AGENTS.md` or `<project>/AGENTS.md`
4. Concatenate all found files into system prompt

### 5.8 Integration Point 7: Storage Format

**Decision**: Keep JSONL as source of truth for sessions. Add optional SQLite index for fast listing.

Session writes go to JSONL (via `JsonlSessionStorage`). On session creation/close, update the SQLite index in `~/.memorix/sessions.db`.

---

## 6. Agent Loop Deep Dive

### 6.1 Dual Loop Architecture

```
runLoop(initialContext, newMessages, config, signal, emit):
│
├── Outer Loop (follow-up handling)
│   │ while (true):
│   │
│   ├── Inner Loop (tool calls + steering)
│   │   │ while (hasMoreToolCalls || pendingMessages):
│   │   │
│   │   ├── 1. Inject pending steering messages
│   │   ├── 2. streamAssistantResponse()
│   │   │      → transformContext(messages)
│   │   │      → convertToLlm(messages) → LLM Message[]
│   │   │      → streamSimple(model, messages, tools, signal)
│   │   │      → build AssistantMessage from stream
│   │   ├── 3. Check for toolCalls in response
│   │   ├── 4. if toolCalls → executeToolCalls()
│   │   │      → parallel or sequential execution
│   │   │      → push ToolResultMessages
│   │   ├── 5. emit("turn_end")
│   │   └── 6. Check shouldStopAfterTurn → break inner loop
│   │
│   ├── Check followUpQueue → if messages, continue outer loop
│   └── Check getFollowUpMessages → if messages, continue outer loop
│
└── emit("agent_end")
```

### 6.2 memcode's Addition to the Loop

```
runLoop (modified for memcode):
│
├── [NEW] before_agent_start hook
│   └── injectMemories(context, config, projectId)
│       → compactSearch() → prepend to systemPrompt
│
├── ... (existing dual loop) ...
│
└── [NEW] after agent_end
    └── storeMemoryFromTurn(messages, projectId, sessionId)
        → storeObservation()
```

---

## 7. Extension System

### 7.1 Extension Interface

```typescript
interface Extension {
  tools: Map<string, RegisteredTool>;         // Additional tools
  commands: Map<string, RegisteredCommand>;    // Slash commands
  handlers: Map<string, HandlerFn[]>;          // Event handlers
  shortcuts: Map<KeyId, ExtensionShortcut>;    // Keyboard shortcuts
  flags: Map<string, ExtensionFlag>;           // Feature flags
}
```

### 7.2 memcode Memory Extension

```typescript
// packages/memcode/src/extensions/memory-extension.ts
export function createMemoryExtension(config: MemoryConfig): Extension {
  return {
    tools: new Map([
      ['memorix_search', registerTool(createMemorySearchTool())],
      ['memorix_store', registerTool(createMemoryStoreTool())],
      ['memorix_detail', registerTool(createMemoryDetailTool())],
    ]),
    commands: new Map([
      ['/memory', registerCommand(memorySearchCommand)],
      ['/remember', registerCommand(memoryStoreCommand)],
    ]),
    handlers: new Map([
      ['agent_end', [memoryStorageHandler]],
      ['before_agent_start', [memoryInjectionHandler]],
    ]),
    shortcuts: new Map(),
    flags: new Map([
      ['memory-injection', { default: true, description: 'Auto-inject relevant memories' }],
      ['memory-storage', { default: true, description: 'Auto-store turn summaries' }],
    ]),
  };
}
```

---

## 8. Thinking Levels

### 8.1 Six-Level Abstraction

memcode defines six thinking levels: `off | minimal | low | medium | high | xhigh`

Each model maps these to provider-specific parameters:

| Level | Anthropic (budget_tokens) | OpenAI (reasoning_effort) | Other |
|---|---|---|---|
| off | 0 | none | default |
| minimal | 1024 | low | mapped |
| low | 2048 | low | mapped |
| medium | 4096 | medium | mapped |
| high | 8192 | high | mapped |
| xhigh | 16384 | high | mapped |

### 8.2 Implementation

Each model in the registry defines its own `thinkingLevelMap`. The ai package provides the model registry and provider abstraction.

---

## 9. Key Design Decisions

### 9.1 Unified agent architecture

- **Backend** (agent core, session, tools): `packages/agent-core` + `packages/memcode`
- **Frontend/TUI**: `packages/tui` — custom component system with differential rendering (~600 lines)
- NOT using Memorix's existing Ink/React TUI (`src/cli/tui/`) — that's a dashboard panel, not a coding agent TUI
- Both frontend and backend are from the same architecture — unified, no mixing

### 9.2 AGENTS.md Discovery

1. Global: `~/.memorix/AGENTS.md`
2. Walk up parent directories looking for AGENTS.md
3. Project-level: `<project>/AGENTS.md`
4. All concatenated into system prompt

### 9.3 Embedding Default → auto

Current Memorix defaults to off. memcode changes to auto:
- If local capability exists (fastembed), use it
- Otherwise, fall back to pure BM25

### 9.4 Observation Model (no change for now)

Current 11 ObservationTypes are over-classified. Future direction:
- Keep: `decision`, `gotcha`, `problem-solution`
- Demote: `how-it-works`, `what-changed` (git log suffices)
- **But**: 1.0.11 keeps existing model. Simplification is a future release.

### 9.5 No Built-in Subagents

Single agent + memory first. Subagents via extension mechanism if needed later.

### 9.6 Upstream Merge Strategy

```
upstream (vendor/pi/)       packages/ (our code)
  └── packages/tui/    →    packages/tui/     — Frequent merge (minimal local changes)
  └── packages/ai/     →    packages/ai/      — Frequent merge (minimal local changes)
  └── packages/agent/  →    packages/agent-core/ — Rare merge (deep modifications)
  └── packages/coding/ →    packages/memcode/ — Never merge (our product layer)
```

### 9.7 Data Migration

None. memcode reuses `~/.memorix/data/` directly. Existing memories work immediately.

---

## 10. Milestones

### Phase 1: Skeleton (1.0.11-alpha)

- [ ] Set up `packages/` structure (ai, agent-core, tui, memcode)
- [ ] Set up npm workspaces
- [ ] Configure tsup + package.json exports
- [ ] `memorix` (no args) → enters memcode TUI
- [ ] `memorix serve` → existing MCP Server (unchanged)
- [ ] Minimal LLM conversation working (user types → agent responds)

### Phase 2: Memory Integration (1.0.11-beta)

- [ ] Integration Point 1: Memory injection via `before_agent_start`
- [ ] Integration Point 2: Memory storage via `agent_end`
- [ ] Integration Point 3: Native tools (memorix_search, memorix_store, memorix_detail)
- [ ] Integration Point 4: System prompt memory instructions
- [ ] Session path → `~/.memorix/sessions/`
- [ ] AGENTS.md → `~/.memorix/AGENTS.md`

### Phase 3: Polish (1.0.11)

- [ ] SQLite session index for fast /resume
- [ ] Embedding default → auto
- [ ] TUI branding (memorix logo, memory sidebar)
- [ ] Memory-aware compaction (include memories in context budget)
- [ ] Documentation and testing

### Phase 4: Future

- [ ] TUI customization (memory sidebar, knowledge graph visualization)
- [ ] Desktop version (based on CLI core)
- [ ] Observation model simplification (11 → 3-4 types)
- [ ] Sub-agent support via extension mechanism

---

## 11. References

### Upstream Reference (vendor/pi/)
- Sessions: https://pi.dev/docs/latest/sessions
- Session Format: https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/session-format.md
- Source: https://github.com/earendil-works/pi

### Third-party Analysis
- Agent Harness Field Guide: https://wuu73.org/aiguide/infoblogs/coding_agents/pi.html
- Anatomy Article: https://shivamagarwal7.medium.com/agentic-ai-pi-anatomy-of-a-minimal-coding-agent-powering-openclaw-5ecd4dd6b440
- DeepWiki: https://deepwiki.com/earendil-works/pi
- Alejandro AO Tutorial: https://alejandro-ao.com/pi-architecture/

### Key Source Files (packages/)
| File | Role |
|---|---|
| `packages/agent-core/src/agent.ts` | Agent class (prompt/continue/steer/followUp) |
| `packages/agent-core/src/agent-loop.ts` | runLoop (dual inner/outer loop) |
| `packages/agent-core/src/harness/agent-harness.ts` | AgentHarness (Agent + Session + Tools glue) |
| `packages/agent-core/src/harness/session/session.ts` | Session abstraction + buildSessionContext |
| `packages/memcode/src/core/agent-session.ts` | AgentSession (main product glue) |
| `packages/memcode/src/core/session-manager.ts` | JSONL persistence, SessionManager API |
| `packages/memcode/src/core/extensions/types.ts` | Extension + ToolDefinition interfaces |
| `packages/memcode/src/core/extensions/runner.ts` | ExtensionRunner |
| `packages/memcode/src/core/tools/bash.ts` | Bash tool |
| `packages/memcode/src/core/tools/edit.ts` | Edit tool (fuzzy match) |

### Key Source Files (Memorix)
| File | Role |
|---|---|
| `src/server.ts` | MCP Server (30+ tools) |
| `src/memory/observations.ts` | storeObservation (write path) |
| `src/memory/graph.ts` | KnowledgeGraphManager |
| `src/memory/formation/` | Formation Pipeline (extract → resolve → evaluate) |
| `src/compact/engine.ts` | 3-layer disclosure engine (compactSearch) |
| `src/store/obs-store.ts` | ObservationStore singleton |
| `src/store/sqlite-store.ts` | SqliteBackend |
| `src/store/orama-store.ts` | Orama full-text + vector index |
| `src/types.ts` | ObservationType, Entity, Relation |
