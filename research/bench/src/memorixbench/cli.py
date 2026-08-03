from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

from .models import CaseSpec, OracleSpec
from .openrouter import OpenRouterClient
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
    config = TrialConfig(
        case=case,
        oracle=oracle,
        condition=args.condition,
        requested_model=args.model,
        artifact_root=args.artifact_root,
        memorix_cli=args.memorix_cli,
        max_steps=args.max_steps,
        surface_profile=args.surface_profile,
        evidence_policy=args.evidence_policy,
    )
    outcome = run_trial(
        config,
        OpenRouterClient(
            args.model,
            timeout_seconds=args.provider_timeout_seconds,
            max_output_tokens=args.max_output_tokens,
        ),
    )
    payload = outcome["payload"]
    print(json.dumps({"receipt": str(outcome["receipt_path"]), "status": payload["status"], "task_success": payload["task_success"]}, indent=2))
    return 0 if payload["status"] == "completed" else 2


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="memorixbench")
    subparsers = parser.add_subparsers(dest="command", required=True)
    validate = subparsers.add_parser("validate-case")
    validate.add_argument("case", type=Path)
    validate.set_defaults(handler=_validate_case)
    trial = subparsers.add_parser("run-trial")
    trial.add_argument("--case", type=Path, required=True)
    trial.add_argument("--oracle", type=Path, required=True)
    trial.add_argument("--artifact-root", type=Path, required=True)
    trial.add_argument("--condition", choices=("no-memory", "raw-record", "memorix-native"), required=True)
    trial.add_argument("--model", required=True)
    trial.add_argument("--memorix-cli", default="memorix")
    trial.add_argument("--surface-profile", choices=("native-product", "canonical-information"), default="native-product")
    trial.add_argument("--evidence-policy", choices=("optional", "fixed-index"), default="optional")
    trial.add_argument("--max-steps", type=int, default=24)
    trial.add_argument("--max-output-tokens", type=int, default=1200)
    trial.add_argument("--provider-timeout-seconds", type=int, default=90)
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
