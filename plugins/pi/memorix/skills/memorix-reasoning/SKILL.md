---
name: memorix-reasoning
description: Use when a technical decision, trade-off, rejected alternative, architecture rationale, or design risk should be recorded or recovered.
---

# Memorix Reasoning

Use reasoning memory for why a decision was made. Use ordinary memory for what happened.

## Use Reasoning When

- The answer depends on alternatives considered, constraints, expected outcomes, or accepted risks.
- A future agent may otherwise reopen the same debate.
- The user chose a direction and the reason matters more than the implementation details.
- A Git Memory entry says what changed, but not why it changed.
- Link important rationale to the commits that provide its evidence.

## Do Not Use Reasoning For

- Simple progress notes.
- Mechanical refactors with no decision.
- Facts that belong in `memorix_store` as `how-it-works`, `what-changed`, or `problem-solution`.
