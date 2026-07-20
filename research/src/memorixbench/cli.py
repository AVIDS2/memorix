from __future__ import annotations

import argparse
from dataclasses import asdict
import json
from pathlib import Path

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
    ids = [case.case_id for case in cases]
    duplicates = sorted({case_id for case_id in ids if ids.count(case_id) > 1})
    if duplicates:
        raise ManifestError("duplicate case ids: " + ", ".join(duplicates))
    print(json.dumps({"valid": len(cases), "case_ids": ids}, indent=2))
    return 0


def _compare(args: argparse.Namespace) -> int:
    comparison = compare_conditions(
        load_jsonl(args.results),
        treatment=args.treatment,
        control=args.control,
        bootstrap_samples=args.bootstrap_samples,
        bootstrap_seed=args.bootstrap_seed,
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
    )
    payload = asdict(workspace)
    payload["path"] = str(workspace.path)
    print(json.dumps(payload, indent=2))
    return 0


def _grade(args: argparse.Namespace) -> int:
    if not args.allow_case_commands:
        raise ValueError("grading executes trusted case commands; pass --allow-case-commands")
    manifest = load_case_manifest(args.case)
    reference_patch_sha256 = None
    if args.reference:
        if args.phase != "transfer":
            raise ValueError("--reference is only valid for transfer grading")
        reference_patch_sha256 = apply_reference_patch(manifest, args.workspace)
    if args.phase == "precursor":
        results = run_phase_commands(
            manifest.precursor,
            args.workspace,
            timeout_seconds=args.timeout_seconds,
        )
        hidden_patch_sha256 = None
    else:
        evaluation = run_transfer_evaluation(
            manifest,
            args.workspace,
            timeout_seconds=args.timeout_seconds,
        )
        results = list(evaluation.commands)
        hidden_patch_sha256 = evaluation.hidden_patch_sha256
    passed = phase_passed(results)
    print(json.dumps({
        "case_id": manifest.case_id,
        "phase": args.phase,
        "passed": passed,
        "hidden_patch_sha256": hidden_patch_sha256,
        "reference_patch_sha256": reference_patch_sha256,
        "commands": [asdict(result) for result in results],
    }, indent=2))
    return 0 if passed else 1


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
        repetition=args.repetition,
        seed=args.seed,
        timeout_seconds=args.timeout_seconds,
        max_budget_usd=args.max_budget_usd,
        memorix_cli=args.memorix_cli,
        mem0_python=args.mem0_python,
        workspace_root=args.workspace_root,
        claude_provider_settings=args.claude_provider_settings,
    )
    print(json.dumps(asdict(outcome), indent=2))
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="memorixbench")
    subparsers = parser.add_subparsers(dest="command", required=True)

    validate = subparsers.add_parser("validate-cases")
    validate.add_argument("root", type=Path)

    compare = subparsers.add_parser("compare")
    compare.add_argument("results", type=Path)
    compare.add_argument("--treatment", required=True)
    compare.add_argument("--control", required=True)
    compare.add_argument("--bootstrap-samples", type=int, default=10_000)
    compare.add_argument("--bootstrap-seed", type=int, default=1729)

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

    grade = subparsers.add_parser("grade")
    grade.add_argument("case", type=Path)
    grade.add_argument("workspace", type=Path)
    grade.add_argument("--phase", choices=("precursor", "transfer"), default="transfer")
    grade.add_argument("--timeout-seconds", type=int, default=300)
    grade.add_argument("--allow-case-commands", action="store_true")
    grade.add_argument("--reference", action="store_true")

    trial = subparsers.add_parser("run-trial")
    trial.add_argument("case", type=Path)
    trial.add_argument("--artifact-root", type=Path, required=True)
    trial.add_argument("--study-id", default="development-pilot")
    trial.add_argument("--condition", choices=sorted(SUPPORTED_CONDITIONS), required=True)
    trial.add_argument("--agent", choices=("codex", "claude"), required=True)
    trial.add_argument("--model")
    trial.add_argument("--repetition", type=int, default=0)
    trial.add_argument("--seed", type=int, default=1729)
    trial.add_argument("--timeout-seconds", type=int, default=900)
    trial.add_argument("--max-budget-usd", type=float)
    trial.add_argument("--memorix-cli", type=Path)
    trial.add_argument("--mem0-python", type=Path)
    trial.add_argument("--workspace-root", type=Path)
    trial.add_argument("--claude-provider-settings", type=Path)
    trial.add_argument("--allow-agent-execution", action="store_true")
    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    try:
        if args.command == "validate-cases":
            return _validate_cases(args.root)
        if args.command == "compare":
            return _compare(args)
        if args.command == "collect-results":
            return _collect_results(args)
        if args.command == "materialize":
            return _materialize(args)
        if args.command == "grade":
            return _grade(args)
        if args.command == "run-trial":
            return _run_trial(args)
    except (ManifestError, ValueError) as error:
        parser.error(str(error))
    raise AssertionError(f"unhandled command: {args.command}")


if __name__ == "__main__":
    raise SystemExit(main())
