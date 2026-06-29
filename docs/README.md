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
| CodeGraph Memory and context packs | [API_REFERENCE.md § CodeGraph Memory and Context Packs](API_REFERENCE.md#codegraph-memory-and-context-packs) and [design spec](superpowers/specs/2026-06-29-codegraph-memory-context-fabric-design.md) |
| Git-derived engineering memory | [GIT_MEMORY.md](GIT_MEMORY.md) |
| Memory formation and quality pipeline | [MEMORY_FORMATION_PIPELINE.md](MEMORY_FORMATION_PIPELINE.md) |
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
| AI-facing install and troubleshooting playbook | [Agent Playbook](AGENT_OPERATOR_PLAYBOOK.md) |

---

## Integrate

| Topic | Document |
| --- | --- |
| MCP / CLI commands | [API_REFERENCE.md](API_REFERENCE.md) |
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
| CodeGraph Memory / Context Fabric design | [2026-06-29-codegraph-memory-context-fabric-design.md](superpowers/specs/2026-06-29-codegraph-memory-context-fabric-design.md) |
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

These docs target the **1.1 release line**, where:

- `memorix setup --agent <agent> --global` is the default agent integration command
- `memorix serve` is the manual stdio MCP server for external agents
- `memorix background start` runs the shared HTTP MCP service and dashboard
- `memorix integrate --agent <agent>` and `memorix hooks install --agent <agent>` remain manual/fallback generation commands
- `memorix` / `memcode` open memcode, the bundled terminal agent that uses the same Memorix memory pool
- `~/.memorix/config.toml` and project `memorix.toml` are the user-facing configuration model
- legacy `memorix.yml`, `.env`, and `config.json` files are still read for compatibility, but new setups should use TOML
