# Memorix Docs Map

Use this page as the shortest path to the right Memorix document.

Memorix docs are intentionally split by **user intent**, not by a giant flat list.

---

## Start Here

| You want to... | Read this |
| --- | --- |
| Install Memorix and choose between stdio vs HTTP control-plane mode | [SETUP.md](SETUP.md) |
| Run Memorix in Docker / compose as an HTTP control plane | [DOCKER.md](DOCKER.md) |
| Understand resource usage and performance trade-offs | [PERFORMANCE.md](PERFORMANCE.md) |
| Configure `memorix.yml`, `.env`, and project overrides | [CONFIGURATION.md](CONFIGURATION.md) |
| Operate Memorix correctly as an AI coding agent | [AGENT_OPERATOR_PLAYBOOK.md](AGENT_OPERATOR_PLAYBOOK.md) |
| Understand the MCP / HTTP / CLI command surface | [API_REFERENCE.md](API_REFERENCE.md) |
| Operate sessions, memory, tasks, locks, and team state from a terminal | [API_REFERENCE.md](API_REFERENCE.md) |

---

## Product and Runtime

| Topic | Document |
| --- | --- |
| System shape, control plane, storage, and retrieval architecture | [ARCHITECTURE.md](ARCHITECTURE.md) |
| Resource profile, heavier paths, and tuning knobs | [PERFORMANCE.md](PERFORMANCE.md) |
| Memory formation, enrichment, and quality pipeline | [MEMORY_FORMATION_PIPELINE.md](MEMORY_FORMATION_PIPELINE.md) |
| Git-derived engineering memory | [GIT_MEMORY.md](GIT_MEMORY.md) |
| Agent Team: autonomous agents, tasks, messages, locks, poll | [API_REFERENCE.md §9](API_REFERENCE.md#9-agent-team-tools) |
| Multi-agent orchestration loop | [API_REFERENCE.md](API_REFERENCE.md) — `memorix orchestrate` |
| Workspace & rules sync across agents | [API_REFERENCE.md §8](API_REFERENCE.md#8-workspace-and-rules-tools) |
| Project skills and mini-skill promotion | [API_REFERENCE.md §7](API_REFERENCE.md#7-skills-and-promotion-tools) |

---

## Development

| Topic | Document |
| --- | --- |
| Contributor workflow and current release baseline | [DEVELOPMENT.md](DEVELOPMENT.md) |
| Major design choices and ADR-style rationale | [DESIGN_DECISIONS.md](DESIGN_DECISIONS.md) |
| Module-by-module implementation notes | [MODULES.md](MODULES.md) |

---

## AI-Facing Context

| Topic | Document |
| --- | --- |
| Canonical operator guidance for coding agents | [AGENT_OPERATOR_PLAYBOOK.md](AGENT_OPERATOR_PLAYBOOK.md) |
| Compact AI context note | [AI_CONTEXT.md](AI_CONTEXT.md) |
| LLM-friendly context bundle | [../llms.txt](../llms.txt) |
| Extended LLM-friendly context bundle | [../llms-full.txt](../llms-full.txt) |

---

## Release Truth vs Historical Reference

For `1.0.8`, treat the following as the **release-truth** docs:

- [SETUP.md](SETUP.md)
- [DOCKER.md](DOCKER.md)
- [PERFORMANCE.md](PERFORMANCE.md)
- [CONFIGURATION.md](CONFIGURATION.md)
- [AGENT_OPERATOR_PLAYBOOK.md](AGENT_OPERATOR_PLAYBOOK.md)
- [API_REFERENCE.md](API_REFERENCE.md)
- [ARCHITECTURE.md](ARCHITECTURE.md)
- [DEVELOPMENT.md](DEVELOPMENT.md)

The following are still useful, but they are **deeper reference / historical context** rather than the first source of operational truth:

- [DESIGN_DECISIONS.md](DESIGN_DECISIONS.md)
- [MODULES.md](MODULES.md)
- [KNOWN_ISSUES_AND_ROADMAP.md](KNOWN_ISSUES_AND_ROADMAP.md)
- [CLOUD_SYNC_AND_MULTI_AGENT_RESEARCH.md](CLOUD_SYNC_AND_MULTI_AGENT_RESEARCH.md)

If any deep reference conflicts with the release-truth docs above, prefer the release-truth docs.
