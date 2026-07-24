# Legacy Artifact Boundary

Artifacts created before trial schema `1.1` may contain only a manifest hash
and no complete copied case definition. They are retained for engineering
diagnostics, but parse as `unclassified` evidence and cannot enter a
confirmatory comparison.

The maintainer quarantine preserves the development material that existed when
those diagnostics were created. It is useful for debugging, but it is not a
substitute for a complete case-definition snapshot or a preregistered trial.
Future reports must state this boundary rather than retroactively assigning
status to an older run.

The early development corpus was also withdrawn for public-answer leakage. Its
raw cases, traces, transitions, hidden tests, and repairs are quarantined
outside the repository. They are unavailable to the public artifact and cannot
be reclassified as benchmark evidence.
