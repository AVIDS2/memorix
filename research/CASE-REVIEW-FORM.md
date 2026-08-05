# Outcome-Blind Case Review Form

Use one completed form for one reviewer and one outcome-blind review packet.
This form is for P3 case admission, not for judging model behavior.

## Reviewer Rules

- Do not inspect model receipts, model outputs, private oracle code, reference
  repairs, or aggregate results before submitting this form.
- Do not use the project owner as one of the two independent reviewers.
- Store completed forms only below the ignored research/artifacts boundary.
  Use a stable private reviewer code such as R1 or R2 in the form; keep any
  real identity or contact proof outside the repository.
- Read the corresponding generated JSON packet in full before deciding.
- Choose admit, revise, or reject. A short specific rationale is required.

## Form Template

Copy this JSON into a new ignored file for each review. Do not add fields that
could leak an outcome, oracle, reference repair, or raw model text.

    {
      "schema_version": "memorixbench-outcome-blind-review-v1",
      "reviewer_code": "R1",
      "reviewer_is_owner": false,
      "outcomes_seen": false,
      "reviewed_on": "YYYY-MM-DD",
      "packet_sha256": "<SHA-256 of the packet JSON bytes>",
      "case_id": "<packet case id>",
      "proposed_class": "<class shown in packet>",
      "reviewer_selected_class": "<source-sufficient-control | durable-decision-dependency | stale-conflict>",
      "current_source_assessment": "<source-sufficient | predecessor-material | stale-record-recoverable | unclear>",
      "patch_answer_leak": "<none | possible | clear>",
      "provenance_and_scope_adequate": true,
      "decision": "<admit | revise | reject>",
      "rationale": "<30-600 characters: explain the structural reason>",
      "attestation": "I reviewed this packet without seeing model outcomes or private oracle material."
    }

## Decision Guide

Mark admit only when all of the following are true:

1. The proposed class matches the packet or a clearly justified alternate
   class is selected.
2. The current source and the predecessor record have the stated relationship:
   current source is sufficient, a durable predecessor decision resolves a real
   ambiguity, or a stale record can be rejected using recoverable current
   evidence.
3. The task and record describe an engineering goal rather than a patch-shaped
   answer.
4. Source provenance, license, frozen scope, relevant files, and writable
   boundary are adequate.

Mark revise when the case could become valid after changing its class, wording,
scope, or rationale. Mark reject when it cannot support a fair comparison
without exposing private behavior or relying on an unverifiable story.

If the two independent decisions disagree, collect a third outcome-blind review
or exclude the case. Do not average decisions and do not ask reviewers to
change an answer after outcomes are known.
