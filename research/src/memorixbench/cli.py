from __future__ import annotations

import argparse
from dataclasses import asdict
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
from .trace_capture import capture_trace_from_streams
from .trace import load_trace_bundle, write_trace_bundle
from .reporting import (
    serialize_authoring_verification,
    serialize_command_results,
    serialize_source_checks,
)
from .schema import ManifestError, load_case_manifest
from .scoring import collect_result_payloads, compare_conditions, load_jsonl, write_jsonl
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
    if not manifests:
        raise ManifestError(f"no case.toml files found under {root}")
    cases = [load_case_manifest(path) for path in manifests]
    for case in cases:
        if case.precursor_trace_bundle is not None:
            load_trace_bundle(case)
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
    comparison = compare_conditions(
        load_jsonl(args.results),
        treatment=args.treatment,
        control=args.control,
        bootstrap_samples=args.bootstrap_samples,
        bootstrap_seed=args.bootstrap_seed,
        require_confirmatory=not args.allow_development,
        include_low_dependency=args.include_low_dependency,
        allow_mixed_models=args.allow_mixed_models,
    )
    print(json.dumps(asdict(comparison), indent=2))
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
        repository_cache=args.repository_cache,
        private_oracle_root=args.private_oracle_root,
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

    source_ledger = subparsers.add_parser("validate-source-ledger")
    source_ledger.add_argument("ledger", type=Path)

    audit_source = subparsers.add_parser("audit-source-candidate")
    audit_source.add_argument("ledger", type=Path)
    audit_source.add_argument("candidate_id")
    audit_source.add_argument("repository_cache", type=Path)

    capture_trace = subparsers.add_parser("capture-trace")
    capture_trace.add_argument("--events", type=Path, required=True)
    capture_trace.add_argument("--timeline", type=Path, required=True)
    capture_trace.add_argument("--case-id", required=True)
    capture_trace.add_argument("--agent", choices=("claude", "codex"), required=True)
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
    capture_session.add_argument("--agent", choices=("claude", "codex"), required=True)
    capture_session.add_argument("--client-version", required=True)
    capture_session.add_argument("--capture-id")
    capture_session.add_argument("--model")
    capture_session.add_argument("--timeout-seconds", type=int, default=240)
    capture_session.add_argument("--max-budget-usd", type=float)
    capture_session.add_argument("--repository-cache", type=Path)
    capture_session.add_argument("--claude-provider-settings", type=Path)

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
    trial.add_argument("--agent", choices=("codex", "claude"), required=True)
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
    trial.add_argument("--repository-cache", type=Path)
    trial.add_argument("--private-oracle-root", type=Path)
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
        if args.command == "validate-source-ledger":
            return _validate_source_ledger(args.ledger)
        if args.command == "audit-source-candidate":
            return _audit_source_candidate(args)
        if args.command == "capture-trace":
            return _capture_trace(args)
        if args.command == "capture-precursor-session":
            return _capture_precursor_session(args)
        if args.command == "record-environment-preflight":
            return _record_environment_preflight(args)
        if args.command == "build-trace-bundle":
            return _build_trace_bundle(args)
        if args.command == "compare":
            return _compare(args)
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
