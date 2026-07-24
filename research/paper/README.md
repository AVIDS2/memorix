# Manuscript Status

This directory contains an English LaTeX manuscript skeleton for the
MemorixBench-Transfer research program.

It is deliberately not a submission-ready effectiveness paper yet. It now
includes two bounded public-fixture cohorts: a 144-run Qwen cohort and a
separately frozen 72-run DeepSeek replication. Both are descriptive evidence
only. No confirmatory result exists until an independently reviewed real
repository corpus, trusted single-model route, and KVM worker/vault execution
are complete.

The skeleton is useful now because it keeps claims tied to evidence. Before a
submission, it needs a bibliography audit, independently reviewed real
repository corpus, regenerated tables and figures, independent artifact review,
a passing public-artifact manifest audit, and a venue-specific pass.
`../SUBMISSION-READINESS.md` records the current public evidence and each
remaining gate.

Compile from this directory with the bundled LaTeX workflow after the source is
changed. Do not add effect sizes, p-values, or baseline rankings unless they are
regenerated from a frozen result corpus and labeled with its public or
confirmatory evidence tier.

The default `latexmk` recipe needs a Perl runtime. The existing Git-bundled
Perl is sufficient when placed temporarily on the build-process `PATH`; no
global dependency is needed. The current related-work citations are verified
against primary arXiv metadata and build through the documented
`pdflatex-bibtex` workflow.
