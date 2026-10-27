---
name: memorix-mini-skills
description: Use when durable project knowledge, gotchas, workflows, or repeated fixes should become reusable agent guidance instead of ordinary memory.
---

# Memorix Mini-Skills

Promote memories into mini-skills only when they are reusable instructions, not just historical notes.

The default `lite` profile does not expose skill generation or promotion. Discover available tools rather than repeatedly probing hidden ones. For an explicit promotion workflow without changing profiles, use `memorix skills generate` or `memorix memory promote --ids <ids>`.

## Promote When

- The knowledge has been proven by repeated observations or a high-value fix.
- It changes how future agents should act.
- It is specific enough to be actionable and general enough to reuse.

## Do Not Promote

- Command logs, probes, stale memories, one-off status notes, or unverified guesses.
- Anything that should expire after the current task.
