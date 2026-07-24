# Anonymous NIER Submission Checklist

Status: local candidate package only. No venue upload has been performed.

## Paper Source

- [x] IEEE conference class and anonymous author block are used.
- [x] The paper states that the public cohort is descriptive, not a general
  effectiveness result.
- [x] Future plans are included as required by the NIER format.
- [x] The bibliography is generated from the local `references.bib` file.
- [x] The checked local PDF has four total pages and no undefined references or
  overfull boxes.
- [x] On 2026-07-24, the manuscript was rebuilt with the documented
  `pdflatex-bibtex` recipe. Strict format and table checks passed; the
  bibliography has no missing or unused citation keys.
- [x] On 2026-07-24, all four rendered PDF pages were visually checked. The
  narrow-table underfull-box warnings are intentional line wrapping; no text,
  table, header, or reference is clipped or overlapped.
- [x] On 2026-07-24, the current
  [ICSE 2027 NIER call](https://conf.researchr.org/track/icse-2027/icse-2027-new-ideas-and-emerging-results--nier-)
  was checked: this source uses the required IEEEtran class, fits within the
  four-main-page plus reference-page limit, and includes the required `Future
  Plans` section.
- [x] The same call permits named systems when their provenance is written in
  the third person. The manuscript retains `Memorix` as a system name, but has
  no repository URL, first-person ownership claim, author name, affiliation,
  acknowledgement, or identifying PDF author metadata.
- [ ] Recheck the official venue page-count rule immediately before upload.
- [ ] Read the final PDF as a reviewer and remove accidental self-identifiers,
  acknowledgements, repository links, and author metadata.

## Supplement

- [x] Build a fresh external staging tree from the explicit anonymous
  allowlist.
- [x] Verify that the staging tree has no `.git` directory, symlinks, raw
  client events, private oracle material, credentials, local paths, or
  user-specific configuration.
- [x] Search the staged text for author, organization, and repository
  identifiers before upload.
- [x] Rerun the materialized public tests in the staging tree.
- [ ] Upload only the staged archive, never a working checkout.

## External Submission Tasks

- [ ] Create or use the official submission account.
- [ ] Enter author names, affiliations, conflicts, and required declarations
  only in the submission system, not in this anonymous manuscript.
- [ ] Verify the selected track, deadline, page policy, and artifact policy on
  the official venue site at the time of submission.
- [ ] Record the generated submission identifier and portal receipt outside the
  anonymous artifact.

## Claim Boundary

Do not describe this candidate as evidence that a memory system generally
improves coding agents. It supports an executable evaluation design and a
reproducible, inconclusive public cohort. Strong claims require the separate
confirmatory gates stated in the paper.
