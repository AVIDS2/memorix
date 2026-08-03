# ICSE NIER Submission Candidate

This directory contains the anonymous IEEE conference-paper source for the NIER
candidate, `When Does Project Memory Help Coding Agents? A Fail-Closed Boundary
Study`. It presents a bounded evaluation design for fresh-agent project memory
and reports only an archived public pilot plus a clearly non-efficacy local
runner smoke.

The paper is intentionally not an efficacy claim. The public cohort is an
archived diagnostic with limited statistical sensitivity; confirmatory
engineering claims remain gated on private cases, independent admission,
isolated execution, and replication.

## Build

The checked local recipe uses the bundled paper skill and the Git-provided Perl
available on this Windows host:

```powershell
$gitPerl = Join-Path $env:ProgramFiles 'Git\usr\bin'
$paperSkill = Join-Path $env:USERPROFILE '.agents\skills\latex-paper-en\scripts\compile.py'
$env:Path = "$gitPerl;$env:Path"
uv run python -B $paperSkill main.tex --recipe pdflatex-bibtex
```

The resulting `main.pdf` is an anonymous review draft. Generated LaTeX files
are not source artifacts.

## Submission Boundary

This is a submission candidate, not a submitted paper. It intentionally uses a
neutral benchmark name and does not identify the target product or repository.
The official call, paper-format rules, deadline, submission portal metadata,
conflicts, and final anonymity review must be checked again at upload time. See
`SUBMISSION-CHECKLIST.md` for the required human and external-system steps.

The supplemental material is assembled outside the repository from an explicit
allowlist. It must contain no Git history, author metadata, raw client events,
private task transitions, reference patches, credentials, or user-specific
configuration.
