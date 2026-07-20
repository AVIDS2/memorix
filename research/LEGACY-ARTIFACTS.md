# Legacy Artifact Boundary

Artifacts created before trial schema `1.1` may contain only a manifest hash
and no complete copied case definition. They are retained for engineering
diagnostics, but parse as `unclassified` evidence and cannot enter a
confirmatory comparison.

The current repository history preserves the development manifests that existed
when those diagnostics were created. That history is useful for debugging, but
it is not a substitute for the complete case-definition snapshot now archived
with every new trial. Future reports must state this boundary rather than
retroactively assigning preregistered status to an older run.
