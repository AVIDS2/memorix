# Memorix Documentation

Use this page as the fastest path to the right Memorix document.

The public docs are organized by user intent:

- **Start**: install Memorix and run `memorix setup` for an agent
- **Use**: memory search, Git Memory, dashboard, and the optional bundled terminal agent
- **Operate**: configuration, Docker, performance, troubleshooting
- **Integrate**: MCP tools, CLI, SDK, agent rules, hooks, plugins, skills
- **Understand**: architecture and deeper implementation notes
- **Develop**: contributor workflow and release checks

---

## Start

| You want to... | Read this |
| --- | --- |
| Install Memorix and run one-command agent setup | [SETUP.md](SETUP.md) |
| Configure provider keys, model lanes, and project overrides | [CONFIGURATION.md](CONFIGURATION.md) |
| Connect an IDE or AI coding agent manually over MCP | [SETUP.md](SETUP.md#4-manual-mcp-client-setup) |
| Understand plugin, rules, hooks, skills, and MCP support | [INTEGRATIONS.md](INTEGRATIONS.md) |
| Run the HTTP service in Docker | [DOCKER.md](DOCKER.md) |
| Try the bundled terminal agent | [MEMCODE.md](MEMCODE.md) |

---

## Use

| Topic | Document |
| --- | --- |
| CLI commands and MCP tools | [API_REFERENCE.md](API_REFERENCE.md) |
| Memory Autopilot, Code State, and context packs | [API_REFERENCE.md § Memory Autopilot, Code State, and Context Packs](API_REFERENCE.md#memory-autopilot-code-state-and-context-packs), [1.2 Code State](1.2.0-CODE-STATE.md), and [1.2 Workset Retrieval](1.2.0-WORKSET-RETRIEVAL.md) |
| Reviewed episodic, semantic, and procedural long-term memory | [1.3 Memory Architecture](1.3-MEMORY-ARCHITECTURE.md) |
| Browse memory, maintenance, and read-only Coordination Status | [Dashboard](DASHBOARD.md) |
| Reviewable knowledge pages and workflow inheritance | [API_REFERENCE.md § Knowledge Workspace and Workflows](API_REFERENCE.md#knowledge-workspace-and-workflows), [1.2 Knowledge Workspace](1.2.0-KNOWLEDGE-WORKSPACE.md), and [1.2 Workflow Inheritance](1.2.0-WORKFLOW-INHERITANCE.md) |
| Git-derived engineering memory | [GIT_MEMORY.md](GIT_MEMORY.md) |
| Memory formation and quality pipeline | [MEMORY_FORMATION_PIPELINE.md](MEMORY_FORMATION_PIPELINE.md) |
| Evidence cards and memory feedback | [1.8.0 Release Specification](1.8.0-RELEASE-CANDIDATE-SPEC.md) and [API_REFERENCE.md](API_REFERENCE.md) |
| Performance and resource profile | [PERFORMANCE.md](PERFORMANCE.md) |
| Orchestrated subagent tasks, messages, locks, handoffs | [API_REFERENCE.md § Orchestration Coordination](API_REFERENCE.md#9-orchestration-coordination-tools) |
| Subagent orchestration | [API_REFERENCE.md](API_REFERENCE.md) and `memorix orchestrate --help` |
| Bundled terminal agent | [MEMCODE.md](MEMCODE.md) |

---

## Operate

| Topic | Document |
| --- | --- |
| Runtime selection: setup packages, stdio MCP, HTTP MCP, dashboard, CLI, memcode | [SETUP.md](SETUP.md) |
| TOML-first configuration | [CONFIGURATION.md](CONFIGURATION.md) |
| Docker/compose deployment | [DOCKER.md](DOCKER.md) |
| Resource and timeout tuning | [PERFORMANCE.md](PERFORMANCE.md) |
| Dashboard modes, maintenance actions, and safety contract | [DASHBOARD.md](DASHBOARD.md) |
| AI-facing install and troubleshooting playbook | [Agent Playbook](AGENT_OPERATOR_PLAYBOOK.md) |

---

## Integrate

| Topic | Document |
| --- | --- |
| MCP / CLI commands | [API_REFERENCE.md](API_REFERENCE.md) |
| MCP protocol discovery and compatibility boundaries | [API_REFERENCE.md](API_REFERENCE.md), [1.3.3 MCP Compatibility](1.3.3-MULTIMODAL-MEDIA-AND-MCP-COMPAT.md), and [1.8.0 Release Specification](1.8.0-RELEASE-CANDIDATE-SPEC.md) |
| Plugin, rules, hooks, skills, and MCP support matrix | [INTEGRATIONS.md](INTEGRATIONS.md) |
| TypeScript SDK | [../README.md#sdk](../README.md#sdk) |
| Workspace and rules sync | [API_REFERENCE.md § Workspace and Rules](API_REFERENCE.md#8-workspace-and-rules-tools) |
| Project skills and mini-skill promotion | [API_REFERENCE.md § Skills](API_REFERENCE.md#7-skills-and-promotion-tools) |
| Hook architecture | [hooks-architecture.md](hooks-architecture.md) |

---

## Understand

| Topic | Document |
| --- | --- |
| System shape, data flows, memory layers | [ARCHITECTURE.md](ARCHITECTURE.md) |
| Design decisions and rationale | [DESIGN_DECISIONS.md](DESIGN_DECISIONS.md) |
| Module-by-module notes | [MODULES.md](MODULES.md) |
| Current implementation status and ecosystem watch | [ACTIVE_WORK.md](../ACTIVE_WORK.md) |
| CodeGraph Memory / Context Fabric design | [2026-06-29-codegraph-memory-context-fabric-design.md](superpowers/specs/2026-06-29-codegraph-memory-context-fabric-design.md) |
| Auto Context Layer design | [2026-06-29-auto-context-layer-design.md](superpowers/specs/2026-06-29-auto-context-layer-design.md) |
| 1.2 product direction and user journey | [1.2 Product Story](1.2.0-PRODUCT-STORY.md) |
| 1.2 knowledge base and workflow inheritance research | [Knowledge and Workflow Research](1.2.0-KNOWLEDGE-WORKFLOW-RESEARCH.md) |
| 1.2 execution contract and phase gates | [1.2 Implementation Plan](1.2.0-IMPLEMENTATION-PLAN.md) |
| 1.2 deterministic Workset evaluation fixtures | [1.2 Evaluation Harness](1.2.0-EVALUATION-HARNESS.md) |
| 1.2 versioned code-state contract | [1.2 Code State Snapshots](1.2.0-CODE-STATE.md) |
| 1.2 source-backed claim and conflict contract | [1.2 Claim Ledger](1.2.0-CLAIM-LEDGER.md) |
| 1.2 reviewable Markdown knowledge workspace | [1.2 Knowledge Workspace](1.2.0-KNOWLEDGE-WORKSPACE.md) |
| 1.2 canonical workflows and safe agent adapters | [1.2 Workflow Inheritance](1.2.0-WORKFLOW-INHERITANCE.md) |
| 1.2 task-shaped evidence selection | [1.2 Workset Retrieval](1.2.0-WORKSET-RETRIEVAL.md) |
| 1.2 non-blocking refresh and maintenance contract | [1.2 Dynamic Lifecycle](1.2.0-DYNAMIC-LIFECYCLE.md) |
| 1.2 honest Lite and optional semantic CodeGraph provider contract | [1.2 Provider Quality](1.2.0-PROVIDER-QUALITY.md) |
| 1.3 long-term memory model, source boundary, and lifecycle | [1.3 Memory Architecture](1.3-MEMORY-ARCHITECTURE.md) |
| Active context-control work | [1.2.2 Memory Control Plane](1.2.2-MEMORY-CONTROL-PLANE.md) |
| 1.8.5 MCP compatibility acceptance contract | [1.8.0 Release Specification](1.8.0-RELEASE-CANDIDATE-SPEC.md) |
| Historical cloud sync and multi-agent research | [CLOUD_SYNC_AND_MULTI_AGENT_RESEARCH.md](CLOUD_SYNC_AND_MULTI_AGENT_RESEARCH.md) |
| Known issues and old roadmap notes | [KNOWN_ISSUES_AND_ROADMAP.md](KNOWN_ISSUES_AND_ROADMAP.md) |

Historical/deep-reference documents may describe older designs. If they conflict with the current product docs, prefer:

1. [README.md](../README.md)
2. [SETUP.md](SETUP.md)
3. [CONFIGURATION.md](CONFIGURATION.md)
4. [MEMCODE.md](MEMCODE.md)
5. [API_REFERENCE.md](API_REFERENCE.md)
6. [Agent Playbook](AGENT_OPERATOR_PLAYBOOK.md)

---

## Develop

| Topic | Document |
| --- | --- |
| Contributor workflow, tests, build, release checks | [DEVELOPMENT.md](DEVELOPMENT.md) |
| AI-facing project context note | [AI_CONTEXT.md](AI_CONTEXT.md) |
| LLM-friendly short summary | [../llms.txt](../llms.txt) |
| LLM-friendly full summary | [../llms-full.txt](../llms-full.txt) |

---

## Current Product Line

The current product line is **1.8.5**. The authoritative acceptance contract is
[1.8.0 Release Specification](1.8.0-RELEASE-CANDIDATE-SPEC.md).
The current baseline has:

- `memorix setup --agent <agent> --global` is the default agent integration command
- `memorix serve` is the manual stdio MCP server for external agents
- `memorix background start` runs the shared HTTP MCP service and dashboard
- Dashboard maintenance is preview-first, project-scoped, and uses the same
  cleanup and deduplication planners as CLI and MCP
- Dashboard Coordination Status is read-only and projects the persistent SQLite
  `TeamStore` truth; its task section is `Task Status` and failed reads are
  explicit `error`/`degraded` states
- context and CodeGraph commands return bounded task receipts before detailed diagnostics
- HTTP MCP sessions have a bounded, explicit lifecycle and fail with a reinitialize hint after expiry
- `memorix integrate --agent <agent>` and `memorix hooks install --agent <agent>` remain manual/fallback generation commands
- `memorix` / `memcode` open memcode, the bundled terminal agent that uses the same Memorix memory pool
- `~/.memorix/config.toml` and project `memorix.toml` are the user-facing configuration model
- legacy `memorix.yml`, `.env`, and `config.json` files are still read for compatibility, but new setups should use TOML

For MCP compatibility, 1.8.5 preserves legacy 2025-era initialize and
stateful Streamable HTTP behavior. `memorix serve` starts a bounded stdio
startup gate: pre-initialize 2026-07-28 `server/discover` is answered with a
complete discovery result, and other early JSON-RPC messages replay in order
through the pinned SDK transport. Versionless `tools/list` and `tools/call`
continue through the SDK's legacy result envelopes. Modern result metadata is
returned for discovery, list, and call responses. The official subscriptions
listen surface is available. Durable Tasks remain explicitly unsupported, and
list responses carry a private zero-TTL hint instead of a reusable server-side
cache. Stateless HTTP project handles are supported on the modern path.
