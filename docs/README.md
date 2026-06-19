# Memorix Documentation

Use this page as the fastest path to the right Memorix document.

The public docs are organized by user intent:

- **Start**: install, run, and connect an agent
- **Use**: memcode, memory search, Git Memory, dashboard
- **Operate**: configuration, Docker, performance, troubleshooting
- **Integrate**: MCP tools, CLI, SDK, agent rules
- **Understand**: architecture and deeper implementation notes
- **Develop**: contributor workflow and release checks

---

## Start

| You want to... | Read this |
| --- | --- |
| Install Memorix and choose a runtime mode | [SETUP.md](SETUP.md) |
| Use the native coding agent | [MEMCODE.md](MEMCODE.md) |
| Configure provider keys, model lanes, and project overrides | [CONFIGURATION.md](CONFIGURATION.md) |
| Connect an IDE or AI coding agent over MCP | [SETUP.md](SETUP.md#4-connect-an-mcp-client) |
| Run the HTTP control plane in Docker | [DOCKER.md](DOCKER.md) |

---

## Use

| Topic | Document |
| --- | --- |
| memcode 1.1 native coding agent | [MEMCODE.md](MEMCODE.md) |
| Operator CLI and MCP tools | [API_REFERENCE.md](API_REFERENCE.md) |
| Git-derived engineering memory | [GIT_MEMORY.md](GIT_MEMORY.md) |
| Memory formation and quality pipeline | [MEMORY_FORMATION_PIPELINE.md](MEMORY_FORMATION_PIPELINE.md) |
| Performance and resource profile | [PERFORMANCE.md](PERFORMANCE.md) |
| Optional Agent Team tasks, messages, locks, handoffs | [API_REFERENCE.md § Agent Team](API_REFERENCE.md#9-agent-team-tools) |
| Multi-agent orchestration | [API_REFERENCE.md](API_REFERENCE.md) and `memorix orchestrate --help` |

---

## Operate

| Topic | Document |
| --- | --- |
| Runtime selection: memcode, stdio MCP, HTTP MCP, dashboard | [SETUP.md](SETUP.md) |
| TOML-first configuration | [CONFIGURATION.md](CONFIGURATION.md) |
| Docker/compose deployment | [DOCKER.md](DOCKER.md) |
| Resource and timeout tuning | [PERFORMANCE.md](PERFORMANCE.md) |
| AI-facing install and troubleshooting playbook | [AGENT_OPERATOR_PLAYBOOK.md](AGENT_OPERATOR_PLAYBOOK.md) |

---

## Integrate

| Topic | Document |
| --- | --- |
| MCP / CLI command surface | [API_REFERENCE.md](API_REFERENCE.md) |
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
| Historical cloud sync and multi-agent research | [CLOUD_SYNC_AND_MULTI_AGENT_RESEARCH.md](CLOUD_SYNC_AND_MULTI_AGENT_RESEARCH.md) |
| Known issues and old roadmap notes | [KNOWN_ISSUES_AND_ROADMAP.md](KNOWN_ISSUES_AND_ROADMAP.md) |

Historical/deep-reference documents may describe older designs. If they conflict with the current product docs, prefer:

1. [README.md](../README.md)
2. [SETUP.md](SETUP.md)
3. [CONFIGURATION.md](CONFIGURATION.md)
4. [MEMCODE.md](MEMCODE.md)
5. [API_REFERENCE.md](API_REFERENCE.md)
6. [AGENT_OPERATOR_PLAYBOOK.md](AGENT_OPERATOR_PLAYBOOK.md)

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

- `memorix` opens memcode, the native coding agent
- `memcode` and `memorix memcode` are direct agent entry points
- `memorix serve` remains the stdio MCP server for external agents
- `memorix background start` runs the shared HTTP MCP control plane and dashboard
- `~/.memorix/config.toml` and project `memorix.toml` are the user-facing configuration model
- legacy `memorix.yml`, `.env`, and `config.json` files are compatibility inputs, not the primary setup path
