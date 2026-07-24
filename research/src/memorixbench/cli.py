from __future__ import annotations

import argparse
from dataclasses import asdict
import hashlib
import json
from pathlib import Path

from .annotation import (
    AnnotationError,
    build_blind_packet,
    finalize_annotations,
    load_blind_packet,
    load_final_annotation,
    load_submission,
    merge_annotation_into_result,
    write_blind_packet,
    write_final_annotation,
)
from .admission import (
    load_admission_review,
    load_admission_review_draft,
    load_reviewer_worksheet,
    validate_admission_review,
    validate_admission_review_worksheets,
    write_admission_review_draft,
)
from .pre_admission import audit_private_draft, write_pre_admission_audit
from .reviewer_packet import audit_reviewer_handoff_packet, build_reviewer_handoff_packet
from .analysis_plan import (
    load_confirmatory_analysis_plan,
    validate_confirmatory_results,
)
from .baseline_preflight import run_baseline_runtime_preflight
from .model_route_preflight import run_model_route_preflight
from .power import build_conservative_power_plan, write_conservative_power_plan
from .public_cohort import (
    load_public_cohort_plan,
    validate_public_cohort_plan,
    validate_public_cohort_results,
)
from .public_analysis import (
    analyze_public_cohort,
    public_cohort_summary_payload,
    write_public_cohort_analysis,
    write_public_cohort_summary,
)
from .public_artifact import (
    audit_public_artifact_manifest,
    build_public_artifact_manifest,
    load_public_artifact_manifest,
    materialize_public_artifact,
    write_public_artifact_manifest,
)
from .public_release import build_public_release_v2_manifest
from .runtime_measurement import (
    RuntimeMeasurementReceipt,
    load_runtime_measurement_policy,
)
from .authoring import verify_case_authoring
from .microvm import inspect_microvm_host, require_microvm_host
from .oracle_assets import resolve_oracle_assets
from .registry import load_case_registry, validate_case_registry
from .source_ledger import (
    audit_source_candidate,
    load_source_ledger,
    validate_source_ledger,
)
from .preflight import write_environment_preflight_receipt
from .capture_session import capture_precursor_session
from .native_client_capture import capture_native_client_session
from .native_hook_capture import load_native_hook_capture, write_native_hook_capture
from .trace_capture import capture_trace_from_streams
from .trace import load_trace_bundle, write_trace_bundle
from .reporting import (
    serialize_authoring_verification,
    serialize_command_results,
    serialize_source_checks,
)
from .schema import ManifestError, load_case_manifest
from .scoring import (
    collect_result_payloads,
    compare_conditions,
    holm_adjust_p_values,
    load_jsonl,
    write_jsonl,
)
from .trial import SUPPORTED_CONDITIONS, run_trial
from .workspace import (
    apply_reference_patch,
    materialize_case,
    phase_passed,
    run_phase_commands,
    run_transfer_evaluation,
)


def _validate_cases(root: Path) -> int:
    manifests = sorted(root.rglob("case.toml"))
    cases = [load_case_manifest(path) for path in manifests]
    for case in cases:
        if case.precursor_trace_bundle is not None:
            load_trace_bundle(case)
        if case.native_hook_capture is not None:
            load_native_hook_capture(
                case.source_path.parent / case.native_hook_capture.path,
                case_id=case.case_id,
            )
    ids = [case.case_id for case in cases]
    duplicates = sorted({case_id for case_id in ids if ids.count(case_id) > 1})
    if duplicates:
        raise ManifestError("duplicate case ids: " + ", ".join(duplicates))
    print(json.dumps({"valid": len(cases), "case_ids": ids}, indent=2))
    return 0


def _validate_registry(registry_path: Path, cases_root: Path) -> int:
    validation = validate_case_registry(
        load_case_registry(registry_path),
        cases_root=cases_root,
    )
    print(json.dumps(validation.public_payload(), indent=2))
    return 0


def _validate_public_cohort_plan(args: argparse.Namespace) -> int:
    plan = load_public_cohort_plan(args.plan)
    registry = load_case_registry(args.registry)
    validate_public_cohort_plan(plan, registry=registry, cases_root=args.cases_root)
    print(json.dumps({
        "plan_id": plan.plan_id,
        "registry_id": plan.registry_id,
        "registry_sha256": plan.registry_sha256,
        "expected_rows": len(plan.expected_keys),
        "conditions": list(plan.conditions),
        "cases": len(plan.case_ids),
        "repetitions": len(plan.repetitions),
    }, indent=2))
    return 0


def _validate_public_cohort_results(args: argparse.Namespace) -> int:
    plan = load_public_cohort_plan(args.plan)
    registry = load_case_registry(args.registry)
    validate_public_cohort_plan(plan, registry=registry, cases_root=args.cases_root)
    validation = validate_public_cohort_results(plan, results_root=args.results_root)
    print(json.dumps(validation.public_payload(), indent=2))
    return 0


def _analyze_public_cohort(args: argparse.Namespace) -> int:
    plan = load_public_cohort_plan(args.plan)
    registry = load_case_registry(args.registry)
    validate_public_cohort_plan(plan, registry=registry, cases_root=args.cases_root)
    analysis = analyze_public_cohort(
        plan,
        results_root=args.results_root,
        bootstrap_samples=args.bootstrap_samples,
        bootstrap_seed=args.bootstrap_seed,
    )
    output = write_public_cohort_analysis(args.output, analysis)
    print(json.dumps({**analysis.public_payload(), "output": str(output)}, indent=2))
    return 0


def _materialize_public_cohort_summary(args: argparse.Namespace) -> int:
    plan = load_public_cohort_plan(args.plan)
    registry = load_case_registry(args.registry)
    validate_public_cohort_plan(plan, registry=registry, cases_root=args.cases_root)
    analysis = analyze_public_cohort(
        plan,
        results_root=args.results_root,
        bootstrap_samples=args.bootstrap_samples,
        bootstrap_seed=args.bootstrap_seed,
    )
    summary = public_cohort_summary_payload(analysis)
    output = write_public_cohort_summary(
        args.output,
        analysis,
        replace_expected_analysis_sha256=args.replace_expected_analysis_sha256,
    )
    print(json.dumps({
        "schema_version": "public-cohort-summary-materialization-v1",
        "analysis_sha256": summary["analysis_sha256"],
        "output": str(output),
    }, indent=2))
    return 0


def _validate_source_ledger(path: Path) -> int:
    validation = validate_source_ledger(load_source_ledger(path))
    print(json.dumps(validation.public_payload(), indent=2))
    return 0


def _audit_source_candidate(args: argparse.Namespace) -> int:
    audit = audit_source_candidate(
        load_source_ledger(args.ledger),
        candidate_id=args.candidate_id,
        repository_cache=args.repository_cache,
    )
    print(json.dumps(audit.public_payload(), indent=2))
    return 0


def _validate_admission_review(args: argparse.Namespace) -> int:
    ledger = load_source_ledger(args.ledger)
    candidate = next(
        (entry for entry in ledger.entries if entry.candidate_id == args.candidate_id),
        None,
    )
    if candidate is None:
        raise ValueError(f"unknown source candidate: {args.candidate_id}")
    review = load_admission_review(args.review)
    validate_admission_review(
        review,
        candidate_id=candidate.candidate_id,
        repository_url=candidate.repository_url,
        base_revision=candidate.base_revision,
        public_transition_revision=candidate.public_transition_revision,
    )
    print(json.dumps(review.public_payload(), indent=2))
    return 0


def _validate_admission_review_worksheets(args: argparse.Namespace) -> int:
    ledger = load_source_ledger(args.ledger)
    candidate = next(
        (entry for entry in ledger.entries if entry.candidate_id == args.candidate_id),
        None,
    )
    if candidate is None:
        raise ValueError(f"unknown source candidate: {args.candidate_id}")
    review = load_admission_review(args.review)
    validate_admission_review(
        review,
        candidate_id=candidate.candidate_id,
        repository_url=candidate.repository_url,
        base_revision=candidate.base_revision,
        public_transition_revision=candidate.public_transition_revision,
    )
    draft = load_admission_review_draft(args.draft)
    worksheets = tuple(
        load_reviewer_worksheet(path, draft=draft)
        for path in args.worksheet
    )
    validate_admission_review_worksheets(
        review,
        draft=draft,
        worksheets=worksheets,
    )
    print(json.dumps({
        "candidate_id": review.candidate_id,
        "decision": review.decision,
        "reviewer_ids": list(review.reviewer_ids),
        "reviewer_worksheet_sha256": [item.sha256 for item in worksheets],
    }, indent=2))
    return 0


def _validate_analysis_plan(args: argparse.Namespace) -> int:
    plan = load_confirmatory_analysis_plan(args.plan)
    print(json.dumps({**plan.public_payload(), "analysis_plan_sha256": plan.sha256}, indent=2))
    return 0


def _validate_runtime_measurement(args: argparse.Namespace) -> int:
    policy = load_runtime_measurement_policy(args.policy)
    try:
        payload = json.loads(args.receipt.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ValueError("runtime measurement receipt cannot be read") from error
    receipt = RuntimeMeasurementReceipt.from_public_payload(payload, policy=policy)
    print(json.dumps({
        "policy_id": policy.policy_id,
        "policy_sha256": policy.sha256,
        "receipt_sha256": receipt.sha256,
        "run_id": receipt.run_id,
        "job_sha256": receipt.job_sha256,
        "worker_result_sha256": receipt.worker_result_sha256,
        "measurement_ids": [item.measurement_id for item in receipt.evidence],
        "observed_at": receipt.observed_at,
    }, indent=2))
    return 0


def _build_public_artifact_manifest(args: argparse.Namespace) -> int:
    manifest = build_public_artifact_manifest(
        root=args.root,
        release_id=args.release_id,
        evidence_tier=args.evidence_tier,
        paths=tuple(args.include),
        created_at=args.created_at,
    )
    write_public_artifact_manifest(manifest, args.output)
    print(json.dumps({
        "release_id": manifest.release_id,
        "evidence_tier": manifest.evidence_tier,
        "manifest_sha256": manifest.sha256,
        "entry_count": len(manifest.entries),
    }, indent=2))
    return 0


def _audit_public_artifact_manifest(args: argparse.Namespace) -> int:
    audit = audit_public_artifact_manifest(
        load_public_artifact_manifest(args.manifest),
        root=args.root,
        require_exact_tree=args.require_exact_tree,
    )
    print(json.dumps(audit.public_payload(), indent=2))
    return 0


def _build_public_release(args: argparse.Namespace) -> int:
    manifest = build_public_release_v2_manifest(
        root=args.root,
        created_at=args.created_at,
    )
    write_public_artifact_manifest(manifest, args.output)
    print(json.dumps({
        "release_id": manifest.release_id,
        "evidence_tier": manifest.evidence_tier,
        "manifest_sha256": manifest.sha256,
        "entry_count": len(manifest.entries),
    }, indent=2))
    return 0


def _materialize_public_artifact(args: argparse.Namespace) -> int:
    materialized = materialize_public_artifact(
        load_public_artifact_manifest(args.manifest),
        root=args.root,
        target=args.target,
    )
    print(json.dumps(materialized.public_payload(), indent=2))
    return 0


def _build_admission_review_draft(args: argparse.Namespace) -> int:
    ledger = load_source_ledger(args.ledger)
    candidate = next(
        (entry for entry in ledger.entries if entry.candidate_id == args.candidate_id),
        None,
    )
    if candidate is None:
        raise ValueError(f"unknown source candidate: {args.candidate_id}")
    draft = write_admission_review_draft(
        candidate_id=candidate.candidate_id,
        repository_url=candidate.repository_url,
        base_revision=candidate.base_revision,
        public_transition_revision=candidate.public_transition_revision,
        author_id=args.author_id,
        author_history_access=args.author_history_access,
        private_transition=args.private_transition,
        private_task_brief=args.private_task_brief,
        public_history_comparison=args.public_history_comparison,
        output=args.output,
    )
    print(json.dumps({
        "candidate_id": draft.candidate_id,
        "admission_review_draft_sha256": draft.sha256,
        "output": str(args.output.resolve()),
    }, indent=2))
    return 0


def _audit_private_draft(args: argparse.Namespace) -> int:
    audit = audit_private_draft(
        ledger=load_source_ledger(args.ledger),
        candidate_id=args.candidate_id,
        draft_root=args.draft_root,
        repository_cache=args.repository_cache,
        audited_at_utc=args.audited_at_utc,
    )
    output = write_pre_admission_audit(audit, output=args.output)
    print(json.dumps({
        "candidate_id": audit.candidate_id,
        "audit_kind": audit.audit_kind,
        "pre_admission_audit_sha256": audit.sha256,
        "admission_decision": audit.admission_decision,
        "remaining_admission_gates": list(audit.remaining_admission_gates),
        "output": str(output.resolve()),
    }, indent=2))
    return 0


def _build_reviewer_handoff_packet(args: argparse.Namespace) -> int:
    packet = build_reviewer_handoff_packet(
        ledger=load_source_ledger(args.ledger),
        candidate_id=args.candidate_id,
        draft_root=args.draft_root,
        repository_cache=args.repository_cache,
        reviewer_guide=args.reviewer_guide,
        packet_id=args.packet_id,
        output=args.output,
        audited_at_utc=args.audited_at_utc,
    )
    print(json.dumps({
        "candidate_id": packet.candidate_id,
        "reviewer_handoff_packet_sha256": packet.sha256,
        "file_count": len(packet.files),
        "output": str(args.output.resolve()),
    }, indent=2))
    return 0


def _audit_reviewer_handoff_packet(args: argparse.Namespace) -> int:
    packet = audit_reviewer_handoff_packet(args.root)
    print(json.dumps({
        "candidate_id": packet.candidate_id,
        "reviewer_handoff_packet_sha256": packet.sha256,
        "file_count": len(packet.files),
        "disposition": packet.disposition,
    }, indent=2))
    return 0


def _capture_trace(args: argparse.Namespace) -> int:
    receipt = capture_trace_from_streams(
        events_path=args.events,
        timeline_path=args.timeline,
        case_id=args.case_id,
        agent=args.agent,
        prompt=args.prompt_file.read_text(encoding="utf-8"),
        output_path=args.output,
        receipt_path=args.receipt,
        client_version=args.client_version,
        workspace_snapshot_sha256=args.workspace_snapshot_sha256,
        workspace_roots=args.workspace_root,
        requested_model=args.model,
        capture_id=args.capture_id,
        capture_mode=args.capture_mode,
        tool_result_mode=args.tool_result_mode,
        captured_at_utc=args.captured_at_utc,
    )
    print(json.dumps(receipt.public_payload(), indent=2))
    return 0


def _capture_precursor_session(args: argparse.Namespace) -> int:
    manifest = load_case_manifest(args.case)
    capture = capture_precursor_session(
        manifest=manifest,
        prompt=args.prompt_file.read_text(encoding="utf-8"),
        artifact_root=args.artifact_root,
        public_output_root=args.public_output_root,
        workspace_root=args.workspace_root,
        agent=args.agent,
        client_version=args.client_version,
        capture_id=args.capture_id,
        model=args.model,
        timeout_seconds=args.timeout_seconds,
        max_budget_usd=args.max_budget_usd,
        repository_cache=args.repository_cache,
        claude_provider_settings=args.claude_provider_settings,
    )
    print(json.dumps(capture.public_payload(), indent=2))
    return 0


def _capture_native_hook_session(args: argparse.Namespace) -> int:
    capture = write_native_hook_capture(
        events_path=args.events,
        output_path=args.output,
        case_id=args.case_id,
        capture_id=args.capture_id,
        client_version=args.client_version,
        capture_mode=args.capture_mode,
        workspace=args.workspace,
        workspace_snapshot_sha256=args.workspace_snapshot_sha256,
        storage_probe_query=args.storage_probe_query,
        minimum_candidate_refs=args.minimum_candidate_refs,
    )
    print(json.dumps({
        "schema_version": capture.schema_version,
        "case_id": capture.case_id,
        "capture_id": capture.capture_id,
        "agent": capture.agent,
        "capture_mode": capture.capture_mode,
        "capture_source_sha256": capture.source_sha256,
        "capture_sha256": capture.canonical_sha256,
        "event_count": len(capture.events),
    }, indent=2))
    return 0


def _capture_native_client_session(args: argparse.Namespace) -> int:
    manifest = load_case_manifest(args.case)
    capture = capture_native_client_session(
        manifest=manifest,
        prompt=args.prompt_file.read_text(encoding="utf-8"),
        artifact_root=args.artifact_root,
        portable_output=args.output,
        workspace_root=args.workspace_root,
        memorix_cli=args.memorix_cli,
        claude_provider_settings=args.claude_provider_settings,
        client_version=args.client_version,
        storage_probe_query=args.storage_probe_query,
        capture_id=args.capture_id,
        model=args.model,
        timeout_seconds=args.timeout_seconds,
        max_budget_usd=args.max_budget_usd,
        repository_cache=args.repository_cache,
    )
    print(json.dumps(capture.public_payload(), indent=2))
    return 0


def _record_environment_preflight(args: argparse.Namespace) -> int:
    ledger = load_source_ledger(args.ledger)
    candidate = next(
        (entry for entry in ledger.entries if entry.candidate_id == args.candidate_id),
        None,
    )
    if candidate is None:
        raise ValueError(f"unknown source candidate: {args.candidate_id}")
    receipt = write_environment_preflight_receipt(
        path=args.output,
        candidate_id=candidate.candidate_id,
        base_revision=candidate.base_revision,
        public_transition_revision=candidate.public_transition_revision,
        bootstrap_command=args.bootstrap_command,
        bootstrap_exit_code=args.bootstrap_exit_code,
        bootstrap_log=args.bootstrap_log,
        offline_command=args.offline_command,
        offline_exit_code=args.offline_exit_code,
        offline_log=args.offline_log,
        runtime=args.runtime,
        offline_policy=args.offline_policy,
        observed_at_utc=args.observed_at_utc,
    )
    print(json.dumps(receipt.public_payload(), indent=2))
    return 0


def _run_baseline_runtime_preflight(args: argparse.Namespace) -> int:
    receipt = run_baseline_runtime_preflight(
        provider=args.provider,
        output_dir=args.output,
        mem0_python=args.mem0_python,
        model_cache_root=args.model_cache_root,
        agentmemory_runtime=args.agentmemory_runtime,
    )
    print(json.dumps({**receipt, "output": str(args.output.resolve())}, indent=2))
    return 0


def _run_model_route_preflight(args: argparse.Namespace) -> int:
    receipt = run_model_route_preflight(
        output_dir=args.output,
        claude_provider_settings=args.claude_provider_settings,
        expected_reported_model=args.expected_reported_model,
        model=args.model,
        uniform_role_model=args.uniform_role_model,
        timeout_seconds=args.timeout_seconds,
        max_budget_usd=args.max_budget_usd,
    )
    print(json.dumps({**receipt, "output": str(args.output.resolve())}, indent=2))
    return 0 if receipt["passed"] else 1


def _plan_conservative_power(args: argparse.Namespace) -> int:
    plan = build_conservative_power_plan(
        planning_id=args.planning_id,
        treatment_condition=args.treatment_condition,
        control_condition=args.control_condition,
        absolute_minimum_detectable_difference=args.minimum_detectable_difference,
        expected_discordances=tuple(args.discordance),
        alpha=args.alpha,
        family_size=args.family_size,
        target_power=args.target_power,
        repetitions_per_cluster=args.repetitions_per_cluster,
        min_clusters=args.min_clusters,
        max_clusters=args.max_clusters,
        step=args.step,
    )
    output = write_conservative_power_plan(args.output, plan)
    print(json.dumps({**plan.public_payload(), "output": str(output)}, indent=2))
    return 0 if plan.required_clusters is not None else 1


def _build_trace_bundle(args: argparse.Namespace) -> int:
    path = write_trace_bundle(
        path=args.output,
        case_root=args.case_root,
        case_id=args.case_id,
        trace_paths=args.trace,
        receipt_paths=args.receipt,
        selection=args.selection,
    )
    print(json.dumps({"bundle": str(path)}, indent=2))
    return 0


def _compare(args: argparse.Namespace) -> int:
    if not args.allow_development:
        raise ValueError(
            "confirmatory comparisons require compare-family with --analysis-plan; "
            "pass --allow-development for a diagnostic single comparison"
        )
    comparison = compare_conditions(
        load_jsonl(args.results),
        treatment=args.treatment,
        control=args.control,
        bootstrap_samples=args.bootstrap_samples,
        bootstrap_seed=args.bootstrap_seed,
        require_confirmatory=False,
        include_low_dependency=args.include_low_dependency,
        allow_mixed_models=args.allow_mixed_models,
    )
    print(json.dumps(asdict(comparison), indent=2))
    return 0


def _parse_family_comparison(value: str) -> tuple[str, str, str]:
    parts = value.split(":")
    if len(parts) != 3 or any(not item.strip() for item in parts):
        raise ValueError(
            "family comparison must use comparison-id:treatment-condition:control-condition"
        )
    comparison_id, treatment, control = (item.strip() for item in parts)
    if treatment == control:
        raise ValueError("family comparison treatment and control must differ")
    return comparison_id, treatment, control


def _canonical_payload_sha256(payload: dict[str, object]) -> str:
    encoded = json.dumps(
        payload,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=True,
    ).encode("ascii")
    return hashlib.sha256(encoded).hexdigest()


def _write_new_json(path: Path, payload: dict[str, object]) -> Path:
    target = path.resolve()
    if target.exists():
        raise ValueError("comparison-family output must not already exist")
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return target


def _compare_family(args: argparse.Namespace) -> int:
    family_id = args.family_id.strip()
    if not family_id:
        raise ValueError("family_id must be non-empty")
    if not 0 < args.alpha <= 1:
        raise ValueError("family alpha must be a probability greater than zero and at most one")
    specifications = [_parse_family_comparison(value) for value in args.comparison]
    comparison_ids = [item[0] for item in specifications]
    duplicates = sorted({item for item in comparison_ids if comparison_ids.count(item) > 1})
    if duplicates:
        raise ValueError("duplicate family comparison ids: " + ", ".join(duplicates))

    results = load_jsonl(args.results)
    analysis_plan = None
    if not args.allow_development:
        if args.analysis_plan is None:
            raise ValueError("confirmatory comparison families require --analysis-plan")
        analysis_plan = load_confirmatory_analysis_plan(args.analysis_plan)
        if args.alpha != analysis_plan.alpha:
            raise ValueError("family alpha does not match the frozen analysis plan")
        results = validate_confirmatory_results(
            analysis_plan,
            family_id=family_id,
            comparisons=specifications,
            results=results,
        )
    comparisons: list[tuple[str, str, str, object]] = []
    raw_p_values: dict[str, float] = {}
    for comparison_id, treatment, control in specifications:
        comparison = compare_conditions(
            results,
            treatment=treatment,
            control=control,
            bootstrap_samples=args.bootstrap_samples,
            bootstrap_seed=args.bootstrap_seed,
            require_confirmatory=not args.allow_development,
            include_low_dependency=args.include_low_dependency,
            allow_mixed_models=args.allow_mixed_models,
        )
        comparisons.append((comparison_id, treatment, control, comparison))
        raw_p_values[comparison_id] = comparison.cluster_sign_flip_p

    adjusted_p_values = holm_adjust_p_values(raw_p_values)
    payload: dict[str, object] = {
        "schema_version": "paired-comparison-family-v1",
        "family_id": family_id,
        "status": (
            "development-analysis-output"
            if args.allow_development
            else "confirmatory-analysis-output"
        ),
        "analysis_plan_id": None if analysis_plan is None else analysis_plan.plan_id,
        "analysis_plan_sha256": None if analysis_plan is None else analysis_plan.sha256,
        "input_results_sha256": hashlib.sha256(args.results.read_bytes()).hexdigest(),
        "alpha": args.alpha,
        "evidence_policy": {
            "require_confirmatory": not args.allow_development,
            "include_low_dependency": args.include_low_dependency,
            "allow_mixed_models": args.allow_mixed_models,
        },
        "multiplicity_method": "holm-bonferroni-v1",
        "comparisons": [
            {
                "comparison_id": comparison_id,
                "treatment_condition": treatment,
                "control_condition": control,
                "raw_p_value": raw_p_values[comparison_id],
                "holm_adjusted_p_value": adjusted_p_values[comparison_id],
                "reject_at_alpha": adjusted_p_values[comparison_id] <= args.alpha,
                "result": asdict(comparison),
            }
            for comparison_id, treatment, control, comparison in comparisons
        ],
    }
    payload["family_result_sha256"] = _canonical_payload_sha256(payload)
    output = _write_new_json(args.output, payload)
    print(json.dumps({**payload, "output": str(output)}, indent=2))
    return 0


def _collect_results(args: argparse.Namespace) -> int:
    payloads = collect_result_payloads(args.root)
    if args.study_id:
        payloads = [row for row in payloads if row.get("study_id") == args.study_id]
    count = write_jsonl(args.output, payloads)
    print(json.dumps({"results": count, "output": str(args.output.resolve())}, indent=2))
    return 0


def _materialize(args: argparse.Namespace) -> int:
    workspace = materialize_case(
        load_case_manifest(args.case),
        args.target,
        stage=args.stage,
        repository_cache=args.repository_cache,
    )
    payload = asdict(workspace)
    payload["path"] = str(workspace.path)
    print(json.dumps(payload, indent=2))
    return 0


def _grade(args: argparse.Namespace) -> int:
    if not args.allow_case_commands:
        raise ValueError("grading executes trusted case commands; pass --allow-case-commands")
    manifest = load_case_manifest(args.case)
    oracle_assets = resolve_oracle_assets(manifest, args.private_oracle_root)
    reference_patch_sha256 = None
    if args.reference:
        if args.phase != "transfer":
            raise ValueError("--reference is only valid for transfer grading")
        reference_patch_sha256 = apply_reference_patch(
            manifest,
            args.workspace,
            oracle_assets=oracle_assets,
        )
    if args.phase == "precursor":
        results = run_phase_commands(
            manifest.precursor,
            args.workspace,
            timeout_seconds=args.timeout_seconds,
        )
        hidden_patch_sha256 = None
        source_checks = ()
        source_check_phase = None
    else:
        evaluation = run_transfer_evaluation(
            manifest,
            args.workspace,
            timeout_seconds=args.timeout_seconds,
            oracle_assets=oracle_assets,
        )
        results = list(evaluation.commands)
        hidden_patch_sha256 = evaluation.hidden_patch_sha256
        source_checks = evaluation.source_checks
        source_check_phase = evaluation.source_check_phase
    passed = phase_passed(results) and all(check.passed for check in source_checks)
    print(json.dumps({
        "case_id": manifest.case_id,
        "phase": args.phase,
        "passed": passed,
        "hidden_patch_sha256": hidden_patch_sha256,
        "reference_patch_sha256": reference_patch_sha256,
        "commands": serialize_command_results(
            results,
            private_oracle=oracle_assets.visibility == "private",
        ),
        "source_checks": serialize_source_checks(
            source_checks,
            private_oracle=oracle_assets.visibility == "private",
        ),
        "source_check_phase": source_check_phase,
    }, indent=2))
    return 0 if passed else 1


def _verify_case(args: argparse.Namespace) -> int:
    if not args.allow_case_commands:
        raise ValueError("case verification executes trusted commands; pass --allow-case-commands")
    manifest = load_case_manifest(args.case)
    verification = verify_case_authoring(
        manifest,
        args.target_root,
        timeout_seconds=args.timeout_seconds,
        repository_cache=args.repository_cache,
        oracle_assets=resolve_oracle_assets(manifest, args.private_oracle_root),
    )
    print(
        json.dumps(
            serialize_authoring_verification(
                verification,
                private_oracle=manifest.oracle.visibility == "private",
            ),
            indent=2,
        )
    )
    return 0 if verification.passed else 1


def _preflight_microvm(_args: argparse.Namespace) -> int:
    capability = inspect_microvm_host()
    print(json.dumps(capability.public_payload(), indent=2))
    require_microvm_host(capability)
    return 0


def _run_trial(args: argparse.Namespace) -> int:
    if not args.allow_agent_execution:
        raise ValueError("agent execution may consume paid model quota; pass --allow-agent-execution")
    outcome = run_trial(
        case_path=args.case,
        artifact_root=args.artifact_root,
        study_id=args.study_id,
        condition=args.condition,
        agent=args.agent,
        model=args.model,
        required_single_model=args.required_single_model,
        repetition=args.repetition,
        seed=args.seed,
        timeout_seconds=args.timeout_seconds,
        max_budget_usd=args.max_budget_usd,
        memorix_cli=args.memorix_cli,
        mem0_python=args.mem0_python,
        agentmemory_runtime=args.agentmemory_runtime,
        workspace_root=args.workspace_root,
        claude_provider_settings=args.claude_provider_settings,
        uniform_role_model=args.uniform_role_model,
        repository_cache=args.repository_cache,
        private_oracle_root=args.private_oracle_root,
        registry_path=args.registry,
    )
    print(json.dumps(asdict(outcome), indent=2))
    return 0


def _read_nonempty(path: Path, *, label: str) -> str:
    value = path.read_text(encoding="utf-8").strip()
    if not value:
        raise ValueError(f"{label} file must not be empty")
    return value


def _build_annotation_packet(args: argparse.Namespace) -> int:
    packet = build_blind_packet(
        result_path=args.result,
        sanitized_action_ledger_path=args.sanitized_action_ledger,
        task=_read_nonempty(args.task_file, label="task"),
        rubric=_read_nonempty(args.rubric_file, label="rubric"),
        blind_salt=_read_nonempty(args.blind_salt_file, label="blind salt"),
        forbidden_strings=tuple(
            _read_nonempty(path, label="forbidden string")
            for path in args.forbidden_string_file
        ),
    )
    output = write_blind_packet(packet, args.output)
    print(json.dumps({
        "packet_sha256": packet.sha256,
        "blind_run_id": packet.blind_run_id,
        "actions": len(packet.actions),
        "output": str(output.resolve()),
    }, indent=2))
    return 0


def _finalize_annotations(args: argparse.Namespace) -> int:
    packet = load_blind_packet(args.packet)
    annotation = finalize_annotations(
        packet,
        load_submission(args.first),
        load_submission(args.second),
        adjudication=load_submission(args.adjudication) if args.adjudication else None,
    )
    output = write_final_annotation(annotation, args.output)
    print(json.dumps({
        **asdict(annotation),
        "annotation_sha256": annotation.sha256,
        "output": str(output.resolve()),
    }, indent=2))
    return 0


def _merge_annotation(args: argparse.Namespace) -> int:
    merged = merge_annotation_into_result(
        args.result,
        load_final_annotation(args.annotation),
    )
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(merged, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"output": str(args.output.resolve())}, indent=2))
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="memorixbench")
    subparsers = parser.add_subparsers(dest="command", required=True)

    validate = subparsers.add_parser("validate-cases")
    validate.add_argument("root", type=Path)

    registry = subparsers.add_parser("validate-registry")
    registry.add_argument("registry", type=Path)
    registry.add_argument("cases_root", type=Path)

    public_cohort_plan = subparsers.add_parser("validate-public-cohort-plan")
    public_cohort_plan.add_argument("plan", type=Path)
    public_cohort_plan.add_argument("--registry", type=Path, required=True)
    public_cohort_plan.add_argument("--cases-root", type=Path, required=True)

    public_cohort_results = subparsers.add_parser("validate-public-cohort-results")
    public_cohort_results.add_argument("plan", type=Path)
    public_cohort_results.add_argument("--registry", type=Path, required=True)
    public_cohort_results.add_argument("--cases-root", type=Path, required=True)
    public_cohort_results.add_argument("--results-root", type=Path, required=True)

    public_cohort_analysis = subparsers.add_parser("analyze-public-cohort")
    public_cohort_analysis.add_argument("plan", type=Path)
    public_cohort_analysis.add_argument("--registry", type=Path, required=True)
    public_cohort_analysis.add_argument("--cases-root", type=Path, required=True)
    public_cohort_analysis.add_argument("--results-root", type=Path, required=True)
    public_cohort_analysis.add_argument("--output", type=Path, required=True)
    public_cohort_analysis.add_argument("--bootstrap-samples", type=int, default=10_000)
    public_cohort_analysis.add_argument("--bootstrap-seed", type=int, default=1729)

    public_cohort_summary = subparsers.add_parser("materialize-public-cohort-summary")
    public_cohort_summary.add_argument("plan", type=Path)
    public_cohort_summary.add_argument("--registry", type=Path, required=True)
    public_cohort_summary.add_argument("--cases-root", type=Path, required=True)
    public_cohort_summary.add_argument("--results-root", type=Path, required=True)
    public_cohort_summary.add_argument("--output", type=Path, required=True)
    public_cohort_summary.add_argument("--bootstrap-samples", type=int, default=10_000)
    public_cohort_summary.add_argument("--bootstrap-seed", type=int, default=1729)
    public_cohort_summary.add_argument("--replace-expected-analysis-sha256")

    source_ledger = subparsers.add_parser("validate-source-ledger")
    source_ledger.add_argument("ledger", type=Path)

    audit_source = subparsers.add_parser("audit-source-candidate")
    audit_source.add_argument("ledger", type=Path)
    audit_source.add_argument("candidate_id")
    audit_source.add_argument("repository_cache", type=Path)

    admission_review = subparsers.add_parser("validate-admission-review")
    admission_review.add_argument("review", type=Path)
    admission_review.add_argument("--ledger", type=Path, required=True)
    admission_review.add_argument("--candidate-id", required=True)

    admission_worksheets = subparsers.add_parser("validate-admission-review-worksheets")
    admission_worksheets.add_argument("review", type=Path)
    admission_worksheets.add_argument("--draft", type=Path, required=True)
    admission_worksheets.add_argument("--worksheet", type=Path, action="append", required=True)
    admission_worksheets.add_argument("--ledger", type=Path, required=True)
    admission_worksheets.add_argument("--candidate-id", required=True)

    analysis_plan = subparsers.add_parser("validate-analysis-plan")
    analysis_plan.add_argument("plan", type=Path)

    runtime_measurement = subparsers.add_parser("validate-runtime-measurement")
    runtime_measurement.add_argument("policy", type=Path)
    runtime_measurement.add_argument("receipt", type=Path)

    public_manifest = subparsers.add_parser("build-public-artifact-manifest")
    public_manifest.add_argument("--root", type=Path, required=True)
    public_manifest.add_argument("--release-id", required=True)
    public_manifest.add_argument(
        "--evidence-tier",
        choices=("design-only-v1", "public-reproducible-summary-v1"),
        required=True,
    )
    public_manifest.add_argument("--include", action="append", required=True)
    public_manifest.add_argument("--created-at")
    public_manifest.add_argument("--output", type=Path, required=True)

    public_release = subparsers.add_parser("build-public-release")
    public_release.add_argument("--root", type=Path, required=True)
    public_release.add_argument("--created-at")
    public_release.add_argument("--output", type=Path, required=True)

    audit_public_manifest = subparsers.add_parser("audit-public-artifact-manifest")
    audit_public_manifest.add_argument("--root", type=Path, required=True)
    audit_public_manifest.add_argument("--manifest", type=Path, required=True)
    audit_public_manifest.add_argument("--require-exact-tree", action="store_true")

    materialize_public_manifest = subparsers.add_parser("materialize-public-artifact")
    materialize_public_manifest.add_argument("--root", type=Path, required=True)
    materialize_public_manifest.add_argument("--manifest", type=Path, required=True)
    materialize_public_manifest.add_argument("--target", type=Path, required=True)

    admission_draft = subparsers.add_parser("build-admission-review-draft")
    admission_draft.add_argument("ledger", type=Path)
    admission_draft.add_argument("candidate_id")
    admission_draft.add_argument("--author-id", required=True)
    admission_draft.add_argument(
        "--author-history-access",
        choices=("provenance-only-v1", "public-solution-reviewed-v1"),
        required=True,
    )
    admission_draft.add_argument("--private-transition", type=Path, required=True)
    admission_draft.add_argument("--private-task-brief", type=Path, required=True)
    admission_draft.add_argument("--public-history-comparison", type=Path, required=True)
    admission_draft.add_argument("--output", type=Path, required=True)

    private_draft_audit = subparsers.add_parser("audit-private-draft")
    private_draft_audit.add_argument("ledger", type=Path)
    private_draft_audit.add_argument("candidate_id")
    private_draft_audit.add_argument("--draft-root", type=Path, required=True)
    private_draft_audit.add_argument("--repository-cache", type=Path, required=True)
    private_draft_audit.add_argument("--output", type=Path, required=True)
    private_draft_audit.add_argument("--audited-at-utc")

    reviewer_handoff_packet = subparsers.add_parser("build-reviewer-handoff-packet")
    reviewer_handoff_packet.add_argument("ledger", type=Path)
    reviewer_handoff_packet.add_argument("candidate_id")
    reviewer_handoff_packet.add_argument("--draft-root", type=Path, required=True)
    reviewer_handoff_packet.add_argument("--repository-cache", type=Path, required=True)
    reviewer_handoff_packet.add_argument("--reviewer-guide", type=Path, required=True)
    reviewer_handoff_packet.add_argument("--packet-id", required=True)
    reviewer_handoff_packet.add_argument("--output", type=Path, required=True)
    reviewer_handoff_packet.add_argument("--audited-at-utc")

    reviewer_handoff_packet_audit = subparsers.add_parser("audit-reviewer-handoff-packet")
    reviewer_handoff_packet_audit.add_argument("root", type=Path)

    capture_trace = subparsers.add_parser("capture-trace")
    capture_trace.add_argument("--events", type=Path, required=True)
    capture_trace.add_argument("--timeline", type=Path, required=True)
    capture_trace.add_argument("--case-id", required=True)
    capture_trace.add_argument("--agent", choices=("claude", "codex", "pi"), required=True)
    capture_trace.add_argument("--prompt-file", type=Path, required=True)
    capture_trace.add_argument("--output", type=Path, required=True)
    capture_trace.add_argument("--receipt", type=Path, required=True)
    capture_trace.add_argument("--client-version", required=True)
    capture_trace.add_argument("--workspace-snapshot-sha256", required=True)
    capture_trace.add_argument("--workspace-root", type=Path, action="append", required=True)
    capture_trace.add_argument("--model")
    capture_trace.add_argument("--capture-id")
    capture_trace.add_argument(
        "--capture-mode",
        choices=("local-diagnostic-v1",),
        default="local-diagnostic-v1",
    )
    capture_trace.add_argument(
        "--tool-result-mode",
        choices=("verbatim", "metadata-only"),
        default="verbatim",
    )
    capture_trace.add_argument("--captured-at-utc")

    capture_session = subparsers.add_parser("capture-precursor-session")
    capture_session.add_argument("case", type=Path)
    capture_session.add_argument("--prompt-file", type=Path, required=True)
    capture_session.add_argument("--artifact-root", type=Path, required=True)
    capture_session.add_argument("--public-output-root", type=Path, required=True)
    capture_session.add_argument("--workspace-root", type=Path, required=True)
    capture_session.add_argument("--agent", choices=("claude", "codex", "pi"), required=True)
    capture_session.add_argument("--client-version", required=True)
    capture_session.add_argument("--capture-id")
    capture_session.add_argument("--model")
    capture_session.add_argument("--timeout-seconds", type=int, default=240)
    capture_session.add_argument("--max-budget-usd", type=float)
    capture_session.add_argument("--repository-cache", type=Path)
    capture_session.add_argument("--claude-provider-settings", type=Path)

    capture_native_hook = subparsers.add_parser("capture-native-hook-session")
    capture_native_hook.add_argument("--events", type=Path, required=True)
    capture_native_hook.add_argument("--output", type=Path, required=True)
    capture_native_hook.add_argument("--case-id", required=True)
    capture_native_hook.add_argument("--capture-id", required=True)
    capture_native_hook.add_argument("--client-version", required=True)
    capture_native_hook.add_argument(
        "--capture-mode",
        choices=("local-diagnostic-v1", "isolated-worker-v1"),
        default="local-diagnostic-v1",
    )
    capture_native_hook.add_argument("--workspace", type=Path, required=True)
    capture_native_hook.add_argument("--workspace-snapshot-sha256", required=True)
    capture_native_hook.add_argument("--storage-probe-query", required=True)
    capture_native_hook.add_argument("--minimum-candidate-refs", type=int, default=1)

    capture_native_client = subparsers.add_parser("capture-native-client-session")
    capture_native_client.add_argument("case", type=Path)
    capture_native_client.add_argument("--prompt-file", type=Path, required=True)
    capture_native_client.add_argument("--artifact-root", type=Path, required=True)
    capture_native_client.add_argument("--output", type=Path, required=True)
    capture_native_client.add_argument("--workspace-root", type=Path, required=True)
    capture_native_client.add_argument("--memorix-cli", type=Path, required=True)
    capture_native_client.add_argument("--claude-provider-settings", type=Path, required=True)
    capture_native_client.add_argument("--client-version", required=True)
    capture_native_client.add_argument("--storage-probe-query", required=True)
    capture_native_client.add_argument("--capture-id")
    capture_native_client.add_argument("--model", required=True)
    capture_native_client.add_argument("--timeout-seconds", type=int, default=240)
    capture_native_client.add_argument("--max-budget-usd", type=float)
    capture_native_client.add_argument("--repository-cache", type=Path)

    preflight = subparsers.add_parser("record-environment-preflight")
    preflight.add_argument("ledger", type=Path)
    preflight.add_argument("candidate_id")
    preflight.add_argument("--bootstrap-command", required=True)
    preflight.add_argument("--bootstrap-exit-code", type=int, required=True)
    preflight.add_argument("--bootstrap-log", type=Path, required=True)
    preflight.add_argument("--offline-command", required=True)
    preflight.add_argument("--offline-exit-code", type=int, required=True)
    preflight.add_argument("--offline-log", type=Path, required=True)
    preflight.add_argument("--runtime", required=True)
    preflight.add_argument(
        "--offline-policy",
        choices=("go-proxy-off-v1", "node-offline-store-v1", "python-index-off-v1"),
        required=True,
    )
    preflight.add_argument("--output", type=Path, required=True)
    preflight.add_argument("--observed-at-utc")

    baseline_preflight = subparsers.add_parser("preflight-baseline-runtime")
    baseline_preflight.add_argument(
        "--provider",
        choices=("mem0", "agentmemory"),
        required=True,
    )
    baseline_preflight.add_argument("--output", type=Path, required=True)
    baseline_preflight.add_argument("--mem0-python", type=Path)
    baseline_preflight.add_argument("--model-cache-root", type=Path)
    baseline_preflight.add_argument("--agentmemory-runtime", type=Path)

    model_route_preflight = subparsers.add_parser("preflight-model-route")
    model_route_preflight.add_argument("--output", type=Path, required=True)
    model_route_preflight.add_argument("--claude-provider-settings", type=Path, required=True)
    model_route_preflight.add_argument("--model")
    model_route_preflight.add_argument("--uniform-role-model")
    model_route_preflight.add_argument("--expected-reported-model")
    model_route_preflight.add_argument("--timeout-seconds", type=int, default=120)
    model_route_preflight.add_argument("--max-budget-usd", type=float, default=0.25)

    power_plan = subparsers.add_parser("plan-conservative-power")
    power_plan.add_argument("--output", type=Path, required=True)
    power_plan.add_argument("--planning-id", required=True)
    power_plan.add_argument("--treatment-condition", required=True)
    power_plan.add_argument("--control-condition", required=True)
    power_plan.add_argument("--minimum-detectable-difference", type=float, required=True)
    power_plan.add_argument(
        "--discordance",
        type=float,
        action="append",
        required=True,
        help="Predeclared paired-discordance scenario; pass once per envelope point.",
    )
    power_plan.add_argument("--alpha", type=float, default=0.05)
    power_plan.add_argument("--family-size", type=int, default=1)
    power_plan.add_argument("--target-power", type=float, default=0.8)
    power_plan.add_argument("--repetitions-per-cluster", type=int, default=3)
    power_plan.add_argument("--min-clusters", type=int, default=50)
    power_plan.add_argument("--max-clusters", type=int, default=300)
    power_plan.add_argument("--step", type=int, default=5)

    trace_bundle = subparsers.add_parser("build-trace-bundle")
    trace_bundle.add_argument("--case-root", type=Path, required=True)
    trace_bundle.add_argument("--case-id", required=True)
    trace_bundle.add_argument("--trace", type=Path, action="append", required=True)
    trace_bundle.add_argument("--receipt", type=Path, action="append", required=True)
    trace_bundle.add_argument("--output", type=Path, required=True)
    trace_bundle.add_argument("--selection", default="hash-bucket-v1")

    compare = subparsers.add_parser("compare")
    compare.add_argument("results", type=Path)
    compare.add_argument("--treatment", required=True)
    compare.add_argument("--control", required=True)
    compare.add_argument("--bootstrap-samples", type=int, default=10_000)
    compare.add_argument("--bootstrap-seed", type=int, default=1729)
    compare.add_argument("--allow-development", action="store_true")
    compare.add_argument("--include-low-dependency", action="store_true")
    compare.add_argument("--allow-mixed-models", action="store_true")

    compare_family = subparsers.add_parser("compare-family")
    compare_family.add_argument("results", type=Path)
    compare_family.add_argument("--family-id", required=True)
    compare_family.add_argument(
        "--comparison",
        action="append",
        required=True,
        help="comparison-id:treatment-condition:control-condition",
    )
    compare_family.add_argument("--output", type=Path, required=True)
    compare_family.add_argument("--analysis-plan", type=Path)
    compare_family.add_argument("--alpha", type=float, default=0.05)
    compare_family.add_argument("--bootstrap-samples", type=int, default=10_000)
    compare_family.add_argument("--bootstrap-seed", type=int, default=1729)
    compare_family.add_argument("--allow-development", action="store_true")
    compare_family.add_argument("--include-low-dependency", action="store_true")
    compare_family.add_argument("--allow-mixed-models", action="store_true")

    collect = subparsers.add_parser("collect-results")
    collect.add_argument("root", type=Path)
    collect.add_argument("--output", type=Path, required=True)
    collect.add_argument("--study-id")

    materialize = subparsers.add_parser("materialize")
    materialize.add_argument("case", type=Path)
    materialize.add_argument("target", type=Path)
    materialize.add_argument(
        "--stage",
        choices=("base", "precursor", "transfer"),
        default="transfer",
    )
    materialize.add_argument("--repository-cache", type=Path)

    grade = subparsers.add_parser("grade")
    grade.add_argument("case", type=Path)
    grade.add_argument("workspace", type=Path)
    grade.add_argument("--phase", choices=("precursor", "transfer"), default="transfer")
    grade.add_argument("--timeout-seconds", type=int, default=300)
    grade.add_argument("--allow-case-commands", action="store_true")
    grade.add_argument("--reference", action="store_true")
    grade.add_argument("--private-oracle-root", type=Path)

    verify_case = subparsers.add_parser("verify-case")
    verify_case.add_argument("case", type=Path)
    verify_case.add_argument("--target-root", type=Path, required=True)
    verify_case.add_argument("--timeout-seconds", type=int, default=300)
    verify_case.add_argument("--allow-case-commands", action="store_true")
    verify_case.add_argument("--repository-cache", type=Path)
    verify_case.add_argument("--private-oracle-root", type=Path)

    microvm = subparsers.add_parser("preflight-microvm")

    trial = subparsers.add_parser("run-trial")
    trial.add_argument("case", type=Path)
    trial.add_argument("--artifact-root", type=Path, required=True)
    trial.add_argument("--study-id", default="development-pilot")
    trial.add_argument("--condition", choices=sorted(SUPPORTED_CONDITIONS), required=True)
    trial.add_argument("--agent", choices=("codex", "claude", "openrouter"), required=True)
    trial.add_argument("--model")
    trial.add_argument("--required-single-model")
    trial.add_argument("--repetition", type=int, default=0)
    trial.add_argument("--seed", type=int, default=1729)
    trial.add_argument("--timeout-seconds", type=int, default=900)
    trial.add_argument("--max-budget-usd", type=float)
    trial.add_argument("--memorix-cli", type=Path)
    trial.add_argument("--mem0-python", type=Path)
    trial.add_argument("--agentmemory-runtime", type=Path)
    trial.add_argument("--workspace-root", type=Path)
    trial.add_argument("--claude-provider-settings", type=Path)
    trial.add_argument("--uniform-role-model")
    trial.add_argument("--repository-cache", type=Path)
    trial.add_argument("--private-oracle-root", type=Path)
    trial.add_argument("--registry", type=Path)
    trial.add_argument("--allow-agent-execution", action="store_true")

    annotation_packet = subparsers.add_parser("build-annotation-packet")
    annotation_packet.add_argument("result", type=Path)
    annotation_packet.add_argument("sanitized_action_ledger", type=Path)
    annotation_packet.add_argument("--task-file", type=Path, required=True)
    annotation_packet.add_argument("--rubric-file", type=Path, required=True)
    annotation_packet.add_argument("--blind-salt-file", type=Path, required=True)
    annotation_packet.add_argument(
        "--forbidden-string-file",
        type=Path,
        action="append",
        default=[],
    )
    annotation_packet.add_argument("--output", type=Path, required=True)

    finalize = subparsers.add_parser("finalize-annotations")
    finalize.add_argument("packet", type=Path)
    finalize.add_argument("first", type=Path)
    finalize.add_argument("second", type=Path)
    finalize.add_argument("--adjudication", type=Path)
    finalize.add_argument("--output", type=Path, required=True)

    merge_annotation = subparsers.add_parser("merge-annotation")
    merge_annotation.add_argument("result", type=Path)
    merge_annotation.add_argument("annotation", type=Path)
    merge_annotation.add_argument("--output", type=Path, required=True)
    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    try:
        if args.command == "validate-cases":
            return _validate_cases(args.root)
        if args.command == "validate-registry":
            return _validate_registry(args.registry, args.cases_root)
        if args.command == "validate-public-cohort-plan":
            return _validate_public_cohort_plan(args)
        if args.command == "validate-public-cohort-results":
            return _validate_public_cohort_results(args)
        if args.command == "analyze-public-cohort":
            return _analyze_public_cohort(args)
        if args.command == "materialize-public-cohort-summary":
            return _materialize_public_cohort_summary(args)
        if args.command == "validate-source-ledger":
            return _validate_source_ledger(args.ledger)
        if args.command == "audit-source-candidate":
            return _audit_source_candidate(args)
        if args.command == "validate-admission-review":
            return _validate_admission_review(args)
        if args.command == "validate-admission-review-worksheets":
            return _validate_admission_review_worksheets(args)
        if args.command == "validate-analysis-plan":
            return _validate_analysis_plan(args)
        if args.command == "validate-runtime-measurement":
            return _validate_runtime_measurement(args)
        if args.command == "build-public-artifact-manifest":
            return _build_public_artifact_manifest(args)
        if args.command == "build-public-release":
            return _build_public_release(args)
        if args.command == "audit-public-artifact-manifest":
            return _audit_public_artifact_manifest(args)
        if args.command == "materialize-public-artifact":
            return _materialize_public_artifact(args)
        if args.command == "build-admission-review-draft":
            return _build_admission_review_draft(args)
        if args.command == "audit-private-draft":
            return _audit_private_draft(args)
        if args.command == "build-reviewer-handoff-packet":
            return _build_reviewer_handoff_packet(args)
        if args.command == "audit-reviewer-handoff-packet":
            return _audit_reviewer_handoff_packet(args)
        if args.command == "capture-trace":
            return _capture_trace(args)
        if args.command == "capture-precursor-session":
            return _capture_precursor_session(args)
        if args.command == "capture-native-hook-session":
            return _capture_native_hook_session(args)
        if args.command == "capture-native-client-session":
            return _capture_native_client_session(args)
        if args.command == "record-environment-preflight":
            return _record_environment_preflight(args)
        if args.command == "preflight-baseline-runtime":
            return _run_baseline_runtime_preflight(args)
        if args.command == "preflight-model-route":
            return _run_model_route_preflight(args)
        if args.command == "plan-conservative-power":
            return _plan_conservative_power(args)
        if args.command == "build-trace-bundle":
            return _build_trace_bundle(args)
        if args.command == "compare":
            return _compare(args)
        if args.command == "compare-family":
            return _compare_family(args)
        if args.command == "collect-results":
            return _collect_results(args)
        if args.command == "materialize":
            return _materialize(args)
        if args.command == "grade":
            return _grade(args)
        if args.command == "verify-case":
            return _verify_case(args)
        if args.command == "preflight-microvm":
            return _preflight_microvm(args)
        if args.command == "run-trial":
            return _run_trial(args)
        if args.command == "build-annotation-packet":
            return _build_annotation_packet(args)
        if args.command == "finalize-annotations":
            return _finalize_annotations(args)
        if args.command == "merge-annotation":
            return _merge_annotation(args)
    except (AnnotationError, ManifestError, ValueError) as error:
        parser.error(str(error))
    raise AssertionError(f"unhandled command: {args.command}")


if __name__ == "__main__":
    raise SystemExit(main())
