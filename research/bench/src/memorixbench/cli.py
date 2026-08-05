from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

from .admission import write_review_packet
from .analysis import write_cohort_analysis
from .cohort import freeze_cohort, run_frozen_cohort
from .docker_runner import DEFAULT_DOCKER_IMAGE, DockerTrialRequest, build_worker_image, run_docker_trial
from .models import CaseSpec, OracleSpec, RouteSpec
from .openrouter import client_for_route
from .preflight import run_native_preflight
from .qualification import qualify_route, qualify_route_window
from .review import ReviewForm, write_review_audit, write_review_form
from .trial import TrialConfig, run_trial


def _validate_case(args: argparse.Namespace) -> int:
    case = CaseSpec.load(args.case)
    print(
        json.dumps(
            {
                "id": case.case_id,
                "class": case.case_class,
                "tier": case.case_tier,
                "evidence_char_budget": case.evidence_char_budget,
                "source_root": str(case.source_root),
                "writable_paths": case.writable_paths,
            },
            indent=2,
        )
    )
    return 0


def _run_trial(args: argparse.Namespace) -> int:
    if args.study_role == "cohort" and not args.container_worker:
        raise ValueError("cohort rows must be started through run-cohort")
    case = CaseSpec.load(args.case)
    oracle = OracleSpec.load(args.oracle)
    route = RouteSpec.load(args.route)
    if args.execution_mode == "docker":
        outcome = run_docker_trial(
            DockerTrialRequest(
                case_path=args.case,
                oracle_path=args.oracle,
                route_path=args.route,
                condition=args.condition,
                artifact_root=args.artifact_root,
                max_steps=args.max_steps,
                surface_profile=args.surface_profile,
                evidence_policy=args.evidence_policy,
                study_role=args.study_role,
                memorix_timeout_seconds=args.memorix_timeout_seconds,
                image=args.docker_image,
            )
        )
        payload = outcome["payload"]
        print(
            json.dumps(
                {
                    "receipt": str(outcome["receipt_path"]),
                    "status": payload["status"],
                    "task_success": payload["task_success"],
                    "execution_mode": "docker",
                },
                indent=2,
            )
        )
        return 0 if payload["status"] == "completed" else 2
    if case.case_tier != "synthetic-engineering-smoke" and not args.container_worker:
        raise ValueError("source-backed trials must use --execution-mode docker")
    config = TrialConfig(
        case=case,
        oracle=oracle,
        condition=args.condition,
        requested_model=route.requested_model,
        artifact_root=args.artifact_root,
        memorix_cli=args.memorix_cli,
        max_steps=args.max_steps,
        memorix_timeout_seconds=args.memorix_timeout_seconds,
        surface_profile=args.surface_profile,
        evidence_policy=args.evidence_policy,
        route=route,
        study_role=args.study_role,
    )
    outcome = run_trial(
        config,
        client_for_route(route),
    )
    payload = outcome["payload"]
    print(json.dumps({"receipt": str(outcome["receipt_path"]), "status": payload["status"], "task_success": payload["task_success"]}, indent=2))
    return 0 if payload["status"] == "completed" else 2


def _build_worker_image(args: argparse.Namespace) -> int:
    payload = build_worker_image(
        image=args.docker_image,
        memorix_version=args.memorix_version,
        base_image=args.base_image,
    )
    print(json.dumps(payload, indent=2))
    return 0


def _preflight_native(args: argparse.Namespace) -> int:
    outcome = run_native_preflight(
        case=CaseSpec.load(args.case),
        oracle=OracleSpec.load(args.oracle),
        artifact_root=args.artifact_root,
        memorix_cli=args.memorix_cli,
        memorix_timeout_seconds=args.memorix_timeout_seconds,
    )
    payload = outcome["payload"]
    print(
        json.dumps(
            {
                "receipt": str(outcome["receipt_path"]),
                "status": payload["status"],
                "failure": payload["failure"],
            },
            indent=2,
        )
    )
    return 0 if payload["status"] == "passed" else 2


def _write_review_packet(args: argparse.Namespace) -> int:
    output = write_review_packet(
        case_path=args.case,
        admission_path=args.admission,
        output_path=args.output,
    )
    print(json.dumps({"review_packet": str(output)}, indent=2))
    return 0


def _qualify_route(args: argparse.Namespace) -> int:
    route = RouteSpec.load(args.route)
    outcome = qualify_route(
        route=route,
        client=client_for_route(route),
        artifact_root=args.artifact_root,
    )
    payload = outcome["payload"]
    print(
        json.dumps(
            {
                "receipt": str(outcome["receipt_path"]),
                "status": payload["status"],
                "actual_model": payload["actual_model"],
            },
            indent=2,
        )
    )
    return 0 if payload["status"] == "passed" else 2


def _qualify_route_window(args: argparse.Namespace) -> int:
    route = RouteSpec.load(args.route)
    outcome = qualify_route_window(
        route=route,
        client=client_for_route(route),
        artifact_root=args.artifact_root,
    )
    payload = outcome["payload"]
    print(
        json.dumps(
            {
                "summary": str(outcome["summary_path"]),
                "all_passed": payload["all_passed"],
                "attempt_count": payload["attempt_count"],
            },
            indent=2,
        )
    )
    return 0 if payload["all_passed"] else 2


def _write_review_form(args: argparse.Namespace) -> int:
    output = write_review_form(
        packet_path=args.packet,
        reviewer_code=args.reviewer_code,
        output_path=args.output,
    )
    print(json.dumps({"review_form": str(output)}, indent=2))
    return 0


def _validate_review_form(args: argparse.Namespace) -> int:
    review = ReviewForm.load(args.review, packet_path=args.packet)
    print(
        json.dumps(
            {
                "case_id": review.case_id,
                "reviewer_code": review.reviewer_code,
                "decision": review.decision,
                "review_sha256": review.definition_sha256,
            },
            indent=2,
        )
    )
    return 0


def _audit_review_set(args: argparse.Namespace) -> int:
    output = write_review_audit(
        packet_dir=args.packet_dir,
        review_root=args.review_root,
        reviewer_codes=args.reviewer_codes,
        output_path=args.output,
    )
    print(json.dumps({"review_audit": str(output)}, indent=2))
    return 0


def _freeze_cohort(args: argparse.Namespace) -> int:
    output = freeze_cohort(
        case_bank=args.case_bank,
        review_audit_path=args.review_audit,
        route_paths=args.route,
        route_window_paths=args.route_window,
        action_calibration_paths=args.action_calibration,
        analysis_plan_path=args.analysis_plan,
        output_path=args.output,
        docker_image=args.docker_image,
    )
    print(json.dumps({"cohort_receipt": str(output)}, indent=2))
    return 0


def _run_cohort(args: argparse.Namespace) -> int:
    outcome = run_frozen_cohort(
        cohort_path=args.cohort,
        case_bank=args.case_bank,
        route_paths=args.route,
        artifact_root=args.artifact_root,
        max_rows=args.max_rows,
    )
    print(
        json.dumps(
            {
                "ledger": str(outcome["ledger_path"]),
                "completed_rows": outcome["completed_rows"],
                "remaining_rows": outcome["remaining_rows"],
            },
            indent=2,
        )
    )
    return 0


def _analyze_cohort(args: argparse.Namespace) -> int:
    output = write_cohort_analysis(
        cohort_path=args.cohort,
        artifact_root=args.artifact_root,
        output_path=args.output,
    )
    print(json.dumps({"cohort_analysis": str(output)}, indent=2))
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="memorixbench")
    subparsers = parser.add_subparsers(dest="command", required=True)
    validate = subparsers.add_parser("validate-case")
    validate.add_argument("case", type=Path)
    validate.set_defaults(handler=_validate_case)
    packet = subparsers.add_parser("write-review-packet")
    packet.add_argument("--case", type=Path, required=True)
    packet.add_argument("--admission", type=Path, required=True)
    packet.add_argument("--output", type=Path, required=True)
    packet.set_defaults(handler=_write_review_packet)
    qualification = subparsers.add_parser("qualify-route")
    qualification.add_argument("--route", type=Path, required=True)
    qualification.add_argument("--artifact-root", type=Path, required=True)
    qualification.set_defaults(handler=_qualify_route)
    qualification_window = subparsers.add_parser("qualify-route-window")
    qualification_window.add_argument("--route", type=Path, required=True)
    qualification_window.add_argument("--artifact-root", type=Path, required=True)
    qualification_window.set_defaults(handler=_qualify_route_window)
    review_form = subparsers.add_parser("write-review-form")
    review_form.add_argument("--packet", type=Path, required=True)
    review_form.add_argument("--reviewer-code", required=True)
    review_form.add_argument("--output", type=Path, required=True)
    review_form.set_defaults(handler=_write_review_form)
    validate_review = subparsers.add_parser("validate-review-form")
    validate_review.add_argument("--packet", type=Path, required=True)
    validate_review.add_argument("--review", type=Path, required=True)
    validate_review.set_defaults(handler=_validate_review_form)
    review_audit = subparsers.add_parser("audit-review-set")
    review_audit.add_argument("--packet-dir", type=Path, required=True)
    review_audit.add_argument("--review-root", type=Path, required=True)
    review_audit.add_argument("--reviewer-codes", nargs="+", required=True)
    review_audit.add_argument("--output", type=Path, required=True)
    review_audit.set_defaults(handler=_audit_review_set)
    cohort = subparsers.add_parser("freeze-cohort")
    cohort.add_argument("--case-bank", type=Path, required=True)
    cohort.add_argument("--review-audit", type=Path, required=True)
    cohort.add_argument("--route", type=Path, action="append", required=True)
    cohort.add_argument("--route-window", type=Path, action="append", required=True)
    cohort.add_argument("--action-calibration", type=Path, action="append", required=True)
    cohort.add_argument("--analysis-plan", type=Path, required=True)
    cohort.add_argument("--output", type=Path, required=True)
    cohort.add_argument("--docker-image", default=DEFAULT_DOCKER_IMAGE)
    cohort.set_defaults(handler=_freeze_cohort)
    run_cohort = subparsers.add_parser("run-cohort")
    run_cohort.add_argument("--cohort", type=Path, required=True)
    run_cohort.add_argument("--case-bank", type=Path, required=True)
    run_cohort.add_argument("--route", type=Path, action="append", required=True)
    run_cohort.add_argument("--artifact-root", type=Path, required=True)
    run_cohort.add_argument("--max-rows", type=int)
    run_cohort.set_defaults(handler=_run_cohort)
    analyze_cohort = subparsers.add_parser("analyze-cohort")
    analyze_cohort.add_argument("--cohort", type=Path, required=True)
    analyze_cohort.add_argument("--artifact-root", type=Path, required=True)
    analyze_cohort.add_argument("--output", type=Path, required=True)
    analyze_cohort.set_defaults(handler=_analyze_cohort)
    preflight = subparsers.add_parser("preflight-native")
    preflight.add_argument("--case", type=Path, required=True)
    preflight.add_argument("--oracle", type=Path, required=True)
    preflight.add_argument("--artifact-root", type=Path, required=True)
    preflight.add_argument("--memorix-cli", default="memorix")
    preflight.add_argument("--memorix-timeout-seconds", type=int, default=120)
    preflight.set_defaults(handler=_preflight_native)
    trial = subparsers.add_parser("run-trial")
    trial.add_argument("--case", type=Path, required=True)
    trial.add_argument("--oracle", type=Path, required=True)
    trial.add_argument("--artifact-root", type=Path, required=True)
    trial.add_argument("--condition", choices=("no-memory", "raw-record", "memorix-native"), required=True)
    trial.add_argument("--route", type=Path, required=True)
    trial.add_argument("--study-role", choices=("ad-hoc", "action-calibration", "cohort"), default="ad-hoc")
    trial.add_argument("--memorix-cli", default="memorix")
    trial.add_argument("--memorix-timeout-seconds", type=int, default=120)
    trial.add_argument("--surface-profile", choices=("native-product", "canonical-information"), default="native-product")
    trial.add_argument("--evidence-policy", choices=("optional", "fixed-index"), default="optional")
    trial.add_argument("--max-steps", type=int, default=24)
    trial.add_argument("--execution-mode", choices=("docker", "host"), default="docker")
    trial.add_argument("--docker-image", default=DEFAULT_DOCKER_IMAGE)
    trial.add_argument("--container-worker", action="store_true", help=argparse.SUPPRESS)
    trial.set_defaults(handler=_run_trial)
    image = subparsers.add_parser("build-worker-image")
    image.add_argument("--docker-image", default=DEFAULT_DOCKER_IMAGE)
    image.add_argument("--memorix-version", default="1.4.1")
    image.add_argument("--base-image", default="node:22-bookworm-slim")
    image.set_defaults(handler=_build_worker_image)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        return args.handler(args)
    except (OSError, RuntimeError, ValueError) as error:
        print(f"memorixbench: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
