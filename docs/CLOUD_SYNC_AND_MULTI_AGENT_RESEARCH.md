# Historical Cross-IDE Collaboration Research

> Historical note: this document records early research. Memorix 1.0.8 product semantics do not promise an automatic chat room between unrelated IDE conversation windows. The supported coordination path is explicit CLI-agent orchestration plus task/message/lock state.

---

## 1. Issue #4 Summary (by AIdeaStudio/Mournight)

Three core requests:

1. **Parallel Scheduling** — DAG-based task dependencies, contract-based collaboration (agents negotiate schemas first), async execution
2. **Visual Progress Dashboard** — real-time task graph, agent activity, inter-agent communication logs
3. **File Locking / Edit Conflicts** — each agent's file scope declared upfront, occupied files visible, prevent conflicting changes

---

## 2. Deep Dive: How Existing Systems Work

### 2.1 Claude Code Agent Teams (Reference Implementation)

The most mature coding-agent team system. Key architectural details:

#### Architecture
- **Lead + Teammates** model — one lead session spawns N teammate sessions
- Each teammate is a **separate Claude Code process** (not a thread)
- Display: in-process (single terminal, Shift+Down to cycle) or split-panes (tmux/iTerm2)
- Config stored in `~/.claude/teams/{team-name}/config.json`
- Task list stored in `~/.claude/tasks/{team-name}/`

#### Communication Protocol
- **`message(to, content)`** — send to one specific teammate (1:1)
- **`broadcast(content)`** — send to all teammates (1:N, cost scales linearly)
- **Automatic delivery** — messages are delivered without polling
- **Idle notifications** — teammate auto-notifies lead when finished
- The communication is **intra-process** (all sessions on same machine), likely via IPC (Unix domain sockets or named pipes) or file-based message queues

#### Task Management
- **Shared task list** — all agents see task status and can claim available work
- **Self-claim** — after finishing, a teammate picks up the next unassigned, unblocked task
- **Lead assigns** — or lead explicitly assigns tasks
- Hooks: `TeammateIdle` (runs when teammate finishes), `TaskCompleted` (quality gate before marking done)

#### File Conflict Strategy
- **NO file locking mechanism** — relies on best practice: "Avoid file conflicts"
- Assign different files/modules to different teammates at planning time
- This works because all agents are on the **same machine, same codebase, same git checkout**

#### Limitations (= Memorix Opportunity)
- **Single-IDE only** — all teammates must be Claude Code sessions
- **Single-machine only** — no remote teammates
- **No nested teams** — teammates can't spawn sub-teams
- **Lead is fixed** — can't transfer leadership
- **No cross-session persistence** — in-process teammates don't survive `/resume`
- **No file locking** — relies on human-guided task partitioning

### 2.2 Claude Code Subagents (Lightweight Delegation)

Different from teams — subagents run **within** a single session:

- **Foreground**: blocks main conversation, passes permission prompts through
- **Background**: runs concurrently, pre-approved permissions, auto-denies unapproved
- Storage: `~/.claude/projects/{project}/{sessionId}/subagents/agent-{agentId}.jsonl`
- **Auto-compaction**: each subagent has its own context window, compacts independently
- Patterns: isolate heavy ops, parallel research, chained subagents
- **No cross-IDE capability** — purely within Claude Code

### 2.3 CrewAI (Python Multi-Agent Framework)

#### Communication Model
- Agents get two auto-injected tools when `allow_delegation=True`:
  - **`Delegate work to coworker(task, context, coworker)`** — assign work to another agent
  - **`Ask question to coworker(question, context, coworker)`** — query another agent
- Communication is **synchronous** — delegator waits for response

#### Process Types
- **Sequential** — agents take turns in order
- **Hierarchical** — manager agent coordinates, specialists execute
- Agents have: role, goal, backstory, tools, allow_delegation flag

#### Key Design Choice
- **Tool-based communication** — agents communicate by calling tools, not via a message bus
- This means any LLM that can call tools can participate
- **No real-time awareness** — agents don't know what others are doing in parallel

### 2.4 AutoGen (Microsoft Multi-Agent Framework)

#### Team Types
- **RoundRobinGroupChat** — agents take turns speaking
- **SelectorGroupChat** — an LLM selects the next speaker after each message
- **MagenticOneGroupChat** — generalist system for web/file tasks
- **Swarm** — agents use `HandoffMessage` to signal transitions

#### Key Patterns
- **Group chat as shared context** — all agents see the full conversation
- **Termination conditions** — `TextMentionTermination("APPROVE")`, max messages, etc.
- **State management** — via `StateGraph` with reducers

#### Design Insight
- AutoGen treats multi-agent as a **conversation** problem, not a task-scheduling problem
- Agents share a group chat, take turns, and build on each other's messages
- **No file locking, no task DAG** — purely conversational coordination

### 2.5 LangGraph (LangChain's Graph-Based Orchestration)

#### Architecture
- **StateGraph** — nodes are agents/functions, edges define flow
- **Send** — fan-out to multiple nodes in parallel (map-reduce)
- **Command** — combine state updates with control flow navigation
- **Subgraphs** — nested graphs for hierarchical agent teams

#### Key Pattern
- Agents are **graph nodes** that read/write shared state
- State has **reducers** (like Redux) to merge concurrent updates
- Control flow is explicit (edges), not emergent (conversation)
- **Checkpointing** — save/resume execution state

### 2.6 MCP Streamable HTTP Transport (Real-Time Foundation)

The MCP spec (2025-03-26) defines Streamable HTTP transport:

#### How It Works
- Client sends JSON-RPC via **HTTP POST** to server endpoint
- Server can respond with `application/json` (simple) or `text/event-stream` (SSE)
- **SSE enables server-initiated messages** — server can push notifications/requests to client
- Client can also **GET** the endpoint to open a long-lived SSE stream for server pushes

#### Key Capabilities
- **Bidirectional** — server can send requests TO the client (not just responses)
- **Session management** — `Mcp-Session-Id` header for stateful connections
- **Resumability** — streams can be resumed after disconnection via `Last-Event-ID`
- **Batching** — multiple JSON-RPC messages in a single request/response

#### Why This Matters for Memorix
- Currently Memorix uses **stdio** transport (single-process, single-client)
- Switching to **Streamable HTTP** enables:
  - Multiple agents connecting to ONE Memorix server
  - Server pushing messages TO agents (real-time notifications)
  - Cross-machine communication (agents on different machines)
  - The Dashboard can also connect as a client (live updates)

### 2.7 mcp-memory-service (Cloud Sync Reference)

- **Hybrid backend**: 5ms local SQLite + background Cloudflare D1 sync
- **Zero user-facing latency** — writes go to local SQLite, async sync to cloud
- **WAL mode** — concurrent read/write without locks
- **OAuth 2.1** — team members authenticate, share memories
- **HTTP transport** — team members connect via `claude mcp add --transport http`
- **Cloudflare D1 free tier**: 100K reads/day, 5M rows, 5GB storage

---

## 3. Pattern Comparison Matrix

| Feature | Claude Code Teams | CrewAI | AutoGen | LangGraph | Memorix (proposed) |
|---------|------------------|--------|---------|-----------|-------------------|
| **Cross-IDE** | No | No (Python only) | No (Python only) | No | **Yes** |
| **Communication** | message/broadcast | Tool calls | Group chat | Shared state | Message bus + SSE |
| **Task Management** | Shared task list | Sequential/Hierarchical | Turn-based | Graph edges | DAG + self-claim |
| **File Locking** | No (best practice) | N/A | N/A | N/A | Advisory + TTL |
| **Real-time** | Yes (intra-process) | No (sync calls) | No (turn-based) | No (batch) | Yes (SSE push) |
| **Persistence** | Session-scoped | None | None | Checkpoints | Memorix observations |
| **Dashboard** | Terminal UI | No | No | LangSmith | Web Dashboard |
| **Transport** | IPC/tmux | In-process | In-process | In-process | **MCP Streamable HTTP** |
| **Protocol** | Proprietary | Python API | Python API | Python API | **MCP standard** |

---

## 4. Proposed Architecture: Memorix Coordination

### 4.1 Core Insight

Claude Code's agent teams are powerful but **single-IDE, single-machine**. Memorix can be the **cross-IDE coordination layer** because:
1. Memorix is already installed across all IDEs via MCP
2. All agents already connect to a shared Memorix server
3. Memorix already persists context across sessions
4. The MCP protocol supports Streamable HTTP for real-time communication

### 4.2 Transport Evolution

```
Current:   IDE ──stdio──► memorix serve (1 client per server instance)

Proposed:  IDE A ──HTTP──►┐
           IDE B ──HTTP──►├─► memorix serve --http (N clients, 1 server)
           IDE C ──HTTP──►│   + SSE push for real-time notifications
           Dashboard ────►┘
```

**Step 1**: Add MCP Streamable HTTP transport to `memorix serve`
- Multiple agents connect to one server via HTTP POST
- Server pushes events via SSE (new messages, task updates, lock changes)
- Dashboard connects as another SSE client for live visualization

### 4.3 Layer Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Dashboard (Web UI)                     │
│  Task DAG graph, Agent activity, Message logs, File locks│
└──────────────────────┬──────────────────────────────────┘
                       │ SSE
┌──────────────────────┴──────────────────────────────────┐
│                 Memorix Server (HTTP)                     │
│                                                          │
│  ┌─────────────┐ ┌─────────────┐ ┌──────────────────┐  │
│  │ Agent       │ │ Task        │ │ File Lock        │  │
│  │ Registry &  │ │ DAG &       │ │ Registry         │  │
│  │ Message Bus │ │ Scheduler   │ │ (Advisory + TTL) │  │
│  └─────────────┘ └─────────────┘ └──────────────────┘  │
│  ┌─────────────┐ ┌─────────────┐ ┌──────────────────┐  │
│  │ Memory      │ │ Diff &      │ │ Cloud Sync       │  │
│  │ Store       │ │ Contract    │ │ (Cloudflare D1)  │  │
│  │ (existing)  │ │ Exchange    │ │                  │  │
│  └─────────────┘ └─────────────┘ └──────────────────┘  │
└──┬──────────┬──────────┬──────────┬─────────────────────┘
   │          │          │          │
   ▼          ▼          ▼          ▼
Cursor     Windsurf   Claude     Codex
Agent A    Agent B    Code C     Agent D
(Frontend) (Backend)  (Test)     (Docs)
```

### 4.4 MCP Tools Design

#### Layer 1: Agent Registry (agent knows who else is working)

```typescript
// Register this agent with the team
memorix_team_join({
  agent: "windsurf-frontend",     // unique agent ID
  role: "frontend",               // role in team
  capabilities: ["react", "css"], // what this agent can do
  currentIDE: "windsurf"          // which IDE
})

// See who's on the team right now
memorix_team_status()
// → [{ agent: "windsurf-frontend", role: "frontend", status: "active",
//       currentFile: "src/App.tsx", currentTask: "task-3", lastSeen: "..." },
//    { agent: "claude-backend", role: "backend", status: "idle", ... }]

// Leave the team
memorix_team_leave({ agent: "windsurf-frontend" })
```

#### Layer 2: Message Bus (agents talk to each other)

```typescript
// Send a message to a specific agent
memorix_team_send({
  to: "claude-backend",
  type: "question",               // question | task | status | diff | contract
  content: "What's the API schema for /api/users?",
  attachments: [{ file: "src/types.ts", diff: "..." }]  // optional
})

// Broadcast to all agents
memorix_team_broadcast({
  type: "status",
  content: "Frontend routing complete. Ready for API integration."
})

// Check my inbox (polling — MCP stdio has no push)
memorix_team_inbox({ agent: "windsurf-frontend" })
// → [{ from: "claude-backend", type: "contract", content: "...", time: "..." }]
```

When using **HTTP transport with SSE**, inbox messages are **pushed** in real-time instead of polled.

#### Layer 3: Task DAG (coordinated parallel work)

```typescript
// Create tasks with dependencies
memorix_task_create({
  tasks: [
    { id: "design-api",    desc: "Design REST API schema",   deps: [] },
    { id: "impl-frontend", desc: "Implement React frontend", deps: ["design-api"] },
    { id: "impl-backend",  desc: "Implement Express API",    deps: ["design-api"] },
    { id: "write-tests",   desc: "Write integration tests",  deps: ["impl-frontend", "impl-backend"] }
  ]
})

// Claim an available task
memorix_task_claim({ taskId: "impl-frontend", agent: "windsurf-frontend" })

// Complete a task with result summary
memorix_task_complete({
  taskId: "impl-frontend",
  result: "Implemented 12 components, all rendering correctly",
  filesModified: ["src/App.tsx", "src/components/*.tsx"]
})

// View task board
memorix_task_list()
// → [{ id: "design-api", status: "completed", assignee: "claude-backend" },
//    { id: "impl-frontend", status: "in_progress", assignee: "windsurf-frontend" },
//    { id: "impl-backend", status: "available", assignee: null },  ← unblocked!
//    { id: "write-tests", status: "blocked", blockedBy: ["impl-frontend", "impl-backend"] }]
```

#### Layer 4: File Lock Registry (prevent edit conflicts)

```typescript
// Claim files before editing
memorix_file_lock({
  files: ["src/api/routes.ts", "src/api/middleware.ts"],
  agent: "claude-backend",
  ttl: 600  // auto-release after 10 minutes
})

// Check what's locked
memorix_file_status()
// → [{ file: "src/api/routes.ts", agent: "claude-backend", since: "...", ttl: 600 },
//    { file: "src/App.tsx", agent: "windsurf-frontend", since: "...", ttl: 300 }]

// Release when done
memorix_file_unlock({
  files: ["src/api/routes.ts"],
  agent: "claude-backend"
})
```

#### Layer 5: Diff & Contract Exchange (share work artifacts)

```typescript
// Share a contract (interface definition) with the team
memorix_team_send({
  to: "*",  // broadcast
  type: "contract",
  content: JSON.stringify({
    endpoint: "POST /api/users",
    request: { name: "string", email: "string" },
    response: { id: "number", name: "string", email: "string" }
  }),
  format: "json-schema"
})

// Share a diff for review
memorix_team_send({
  to: "claude-backend",
  type: "diff",
  content: "--- a/src/types.ts\n+++ b/src/types.ts\n@@ ...",
  attachments: [{ file: "src/types.ts", action: "modified" }]
})
```

### 4.5 Communication Patterns

#### Pattern A: Contract-First Parallel Development
```
1. Lead agent creates task DAG and contracts
2. Frontend agent claims frontend tasks, locks relevant files
3. Backend agent claims backend tasks, locks relevant files
4. Both develop in parallel against shared contracts
5. Test agent watches for task completions, claims test tasks when ready
6. Agents exchange diffs and status updates via message bus
```

#### Pattern B: Competing Hypotheses (Debug)
```
1. User describes bug, lead creates N investigation tasks
2. Each agent claims one hypothesis, investigates independently
3. Agents broadcast findings and challenge each other's theories
4. Agents vote/converge on root cause
5. Winner implements fix
```

#### Pattern C: Review Pipeline
```
1. Dev agent completes implementation, marks task done
2. Security agent auto-claims review task (dependency resolved)
3. Performance agent auto-claims review task (parallel)
4. Both review, send findings back to dev agent
5. Dev agent addresses feedback, marks final task done
```

### 4.6 Real-Time via MCP Streamable HTTP

For agents using HTTP transport (Claude Code, future IDE support):

```
Agent A (POST) ──► Memorix Server
                      │
                      ├──► SSE push to Agent B: "New message from A"
                      ├──► SSE push to Dashboard: "Agent A sent message"
                      └──► SSE push to Agent C: "Task X now unblocked"
```

For agents using stdio transport (Windsurf, Cursor):
- Fall back to **polling** via `memorix_team_inbox()`
- Agent's rules file can include instruction: "Check inbox every N turns"
- Or use hooks (PostToolUse) to auto-check inbox

### 4.7 Hybrid Transport Strategy

```typescript
// Server supports both transports simultaneously
memorix serve --http --port 3211   // HTTP + SSE for agents that support it
memorix serve                       // stdio for current IDE integrations

// IDE MCP config examples:
// Cursor/Windsurf (stdio — polling):
{ "command": "memorix", "args": ["serve"] }

// Claude Code (HTTP — real-time push):
{ "transport": "http", "url": "http://localhost:3211/mcp" }
```

---

## 5. Cloud Sync Options

Given user constraints (VPS unstable, shared resources):

| Option | Pros | Cons | Recommendation |
|--------|------|------|----------------|
| **Cloudflare D1** | Free, 99.99% uptime, SQLite-compat, zero ops | Vendor lock-in | **Best for memory sync** |
| **Turso** (libSQL) | Native SQLite sync, 9GB free, edge replicas | Newer | Good alternative |
| **Supabase** | Real-time WebSocket, PostgreSQL, auth built-in | Schema conversion needed | Good for real-time features |
| **GitHub** | Free, version history, PRs | Not real-time, merge conflicts | Too slow for live coordination |
| **Self-hosted VPS** | Full control | Unstable, shared resources | **Not recommended** |

**Recommendation**: Cloudflare D1 for memory/observation sync (proven by mcp-memory-service). For real-time coordination state (messages, tasks, locks), keep everything **local** on the shared Memorix HTTP server — no cloud needed for same-machine coordination.

---

## 6. Implementation Roadmap

| Phase | Feature | New MCP Tools | Complexity | Dependencies |
|-------|---------|---------------|------------|--------------|
| **P0** | HTTP transport for `memorix serve` | 0 | Medium | MCP SDK HTTP support |
| **P1** | Agent registry + message bus | `team_join`, `team_leave`, `team_status`, `team_send`, `team_broadcast`, `team_inbox` | Medium | P0 |
| **P2** | File lock registry | `file_lock`, `file_unlock`, `file_status` | Low | P1 |
| **P3** | Task DAG + scheduler | `task_create`, `task_claim`, `task_complete`, `task_list` | Medium | P1 |
| **P4** | Dashboard: team activity panel | 0 (extends existing dashboard) | Medium | P1 |
| **P5** | Contract/diff exchange | Extends `team_send` with attachment types | Low | P1 |
| **P6** | SSE push notifications | 0 (transport-level) | Medium | P0 |
| **P7** | Cloud sync (Cloudflare D1) | `team_cloud_setup`, `team_cloud_sync` | Medium | P1 |

**Estimated total**: ~13 new MCP tools + HTTP transport upgrade

---

## 7. Memorix Differentiator vs Claude Code Teams

| Aspect | Claude Code Teams | Memorix Teams |
|--------|------------------|---------------|
| IDE support | Claude Code only | Any MCP-compatible IDE |
| Machine scope | Single machine | Local or remote (via HTTP) |
| Persistence | Session-scoped | Persistent (observations + cloud) |
| File locking | None | Advisory + TTL |
| Task management | Simple list | DAG with dependency resolution |
| Communication | IPC (proprietary) | MCP standard (portable) |
| Dashboard | Terminal UI | Web Dashboard with graph visualization |
| Memory | No cross-session | Full Memorix memory system |
| Contract sharing | No formal system | Typed contract exchange |
| Cost | Anthropic API only | Any LLM provider |

**Memorix's unique value proposition**: "A shared memory and coordination layer for coding agents across IDEs and CLIs."

---

## 8. Key Design Decisions to Make

1. **Transport priority** — Start with HTTP-only, or support stdio+HTTP hybrid from day one?
2. **Message persistence** — Store agent messages as observations, or separate ephemeral store?
3. **Lock enforcement** — Pure advisory (warn only) or block file writes via hooks?
4. **Task DAG format** — Simple JSON list, or full DAG with contract attachments?
5. **Cloud scope** — Sync memories only, or also sync team state (tasks, messages)?
6. **Auto-rules injection** — Should `memorix_session_start` inject "check inbox" instructions?
