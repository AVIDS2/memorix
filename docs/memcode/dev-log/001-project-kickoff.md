# 001 - Project Kickoff

> Date: 2026-06-09
> Phase: Pre-Phase 1
> Branch: feat/memcode-agent

## What Happened

### Deep Analysis Phase
- Used CodeGraph to do symbol-level analysis of both Memorix (218 files) and Pi source (678 files)
- Digested all reference materials:
  - Pi official docs (sessions, session-format)
  - DeepWiki auto-generated code docs
  - wuu73 Agent Harness Field Guide
  - Alejandro AO architecture tutorial
  - Medium anatomy article
- Key files analyzed: `storeObservation`, `runFormation`, `compactSearch`, `runLoop`, `AgentSession`, `SessionManager`, `ToolDefinition`, `ExtensionRunner`

### Design Phase
- Wrote `docs/memcode/DESIGN.md` — 791-line formal development document covering:
  1. Product definition & philosophy
  2. Architecture (layer diagram, package structure, dependency graph)
  3. Build configuration (npm workspaces, tsup, exports, CLI routing)
  4. Storage design (JSONL vs SQLite decision matrix, session metadata index, directory layout)
  5. Seven integration points with code examples and data flows
  6. Agent loop deep dive (dual loop + memory injection/storage hooks)
  7. Extension system (memory extension implementation)
  8. Thinking levels (six-level mapping)
  9. Nine key design decisions
  10. Milestones (Phase 1-4)
  11. References

### De-Pi-ification
- All package names changed from `@memorix/pi-*` to `@memorix/*`
- All "Pi" references removed from product-facing text
- Only `vendor/pi/` directory and external URLs retain "pi" (upstream reference)

### Key Decisions
- Package names: `@memorix/ai`, `@memorix/agent-core`, `@memorix/tui`, `@memorix/memcode`
- Both frontend (TUI) and backend (agent core) are unified architecture — no mixing with Memorix's Ink/React TUI
- JSONL for sessions (tree-structured, append-only, crash-safe)
- SQLite for memory (existing, unchanged)
- Optional SQLite session index for fast /resume
- Embedding default → auto
- No built-in subagents for now
- Data migration: zero — reuse existing ~/.memorix/data/

## Lessons Learned
- CodeGraph is the right tool for symbol-level code analysis across large codebases
- The "dynamic dev log" pattern (progress.txt + entry files) is a real, established practice in the AI agent community (Compound Engineering by Ryan Carson, AWM paper at ICML 2025)
- Branch isolation is critical — main stays clean at v1.0.10

## What's Next
Phase 1: Skeleton — copy Pi source into packages/, set up npm workspaces, configure build, get minimal LLM conversation working. Use ultracode parallel agents.
