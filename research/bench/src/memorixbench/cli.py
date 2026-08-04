from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

from .models import CaseSpec, OracleSpec, RouteSpec
from .openrouter import client_for_route
from .preflight import run_native_preflight
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
    case = CaseSpec.load(args.case)
    oracle = OracleSpec.load(args.oracle)
    route = RouteSpec.load(args.route)
    config = TrialConfig(
        case=case,
        oracle=oracle,
        condition=args.condition,
        requested_model=route.requested_model,
        artifact_root=args.artifact_root,
        memorix_cli=args.memorix_cli,
        max_steps=args.max_steps,
        surface_profile=args.surface_profile,
        evidence_policy=args.evidence_policy,
        route=route,
    )
    outcome = run_trial(
        config,
        client_for_route(route),
    )
    payload = outcome["payload"]
    print(json.dumps({"receipt": str(outcome["receipt_path"]), "status": payload["status"], "task_success": payload["task_success"]}, indent=2))
    return 0 if payload["status"] == "completed" else 2


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


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="memorixbench")
    subparsers = parser.add_subparsers(dest="command", required=True)
    validate = subparsers.add_parser("validate-case")
    validate.add_argument("case", type=Path)
    validate.set_defaults(handler=_validate_case)
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
    trial.add_argument("--memorix-cli", default="memorix")
    trial.add_argument("--surface-profile", choices=("native-product", "canonical-information"), default="native-product")
    trial.add_argument("--evidence-policy", choices=("optional", "fixed-index"), default="optional")
    trial.add_argument("--max-steps", type=int, default=24)
    trial.set_defaults(handler=_run_trial)
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
