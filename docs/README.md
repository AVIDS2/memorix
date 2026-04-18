# Memorix Docs Map

Use this page as the shortest path to the right Memorix document.

Memorix docs are intentionally split by **user intent**, not by a giant flat list.

---

## Start Here

| You want to... | Read this |
| --- | --- |
| Install Memorix and choose between stdio vs HTTP control-plane mode | [SETUP.md](SETUP.md) |
| Configure `memorix.yml`, `.env`, and project overrides | [CONFIGURATION.md](CONFIGURATION.md) |
| Operate Memorix correctly as an AI coding agent | [AGENT_OPERATOR_PLAYBOOK.md](AGENT_OPERATOR_PLAYBOOK.md) |
| Understand the MCP / HTTP / CLI command surface | [API_REFERENCE.md](API_REFERENCE.md) |

---

## Product and Runtime

| Topic | Document |
| --- | --- |
| System shape, control plane, storage, and retrieval architecture | [ARCHITECTURE.md](ARCHITECTURE.md) |
| Memory formation, enrichment, and quality pipeline | [MEMORY_FORMATION_PIPELINE.md](MEMORY_FORMATION_PIPELINE.md) |
| Git-derived engineering memory | [GIT_MEMORY.md](GIT_MEMORY.md) |

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

For `1.0.7`, treat the following as the **release-truth** docs:

- [SETUP.md](SETUP.md)
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
