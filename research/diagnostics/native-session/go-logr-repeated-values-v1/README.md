# go-logr Native-Session Diagnostic

This is a local product diagnostic, not a MemorixBench public-cohort or
confirmatory case. It is intentionally stored outside `research/cases/`, so
the frozen public registry and paper result tables cannot ingest it.

The source snapshot is the parent of upstream go-logr commit
`2750c5e1e7efb600100aef497f1b11908d4ecb34` (2021-11-24), whose public change
fixed repeated `WithValues` calls when `RenderValuesHook` is configured. The
transition reproduces only the public example change from that commit.

The precursor task adds one predeclared explanatory comment and changes no
runtime behavior. A real isolated Claude Code session must reproduce that
exact patch through a `PostToolUse` Edit hook before the portable capture is
accepted. The transfer task is current-source sufficient: its purpose is to
check that native Memorix can abstain rather than introduce irrelevant context.

Any resulting capture and trial artifact may report client discovery, MCP call
or abstention behavior, route integrity, and safety failures. It must not be
combined with the frozen public cohort, used to estimate an efficacy effect,
or presented as confirmatory evidence.
