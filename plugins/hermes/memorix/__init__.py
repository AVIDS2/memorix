import json
import subprocess
import sys
from pathlib import Path

SESSION_ID = "hermes-plugin"


def _json_safe(value):
    try:
        json.dumps(value)
        return value
    except TypeError:
        return repr(value)


def _run_memorix(args, input_data=None):
    command = ["memorix", *args]
    try:
        result = subprocess.run(
            command,
            input=input_data,
            capture_output=True,
            text=True,
            timeout=10,
            check=False,
        )
    except Exception as exc:
        return {"error": str(exc)}

    if result.stdout:
        try:
            return json.loads(result.stdout)
        except json.JSONDecodeError:
            return {"text": result.stdout}
    if result.stderr:
        return {"error": result.stderr}
    return {}


def _dispatch_hook(event_name, payload):
    return _run_memorix(
        ["hook", "--agent", "hermes"],
        input_data=json.dumps(
            {
                "agent": "hermes",
                "session_id": SESSION_ID,
                "hook_event_name": event_name,
                "payload": _json_safe(payload),
            }
        ),
    )


def _pre_llm_call(*args, **kwargs):
    output = _dispatch_hook("hermes.pre_llm_call", {"args": args, "kwargs": kwargs})
    if isinstance(output, dict) and output.get("systemMessage"):
        return {"context": output["systemMessage"]}
    return None


def _post_tool_call(*args, **kwargs):
    _dispatch_hook("hermes.post_tool_call", {"args": args, "kwargs": kwargs})


def _post_llm_call(*args, **kwargs):
    _dispatch_hook("hermes.post_llm_call", {"args": args, "kwargs": kwargs})


def _on_session_start(*args, **kwargs):
    _dispatch_hook("hermes.on_session_start", {"args": args, "kwargs": kwargs})


def _on_session_end(*args, **kwargs):
    _dispatch_hook("hermes.on_session_end", {"args": args, "kwargs": kwargs})


def _memorix_command(raw_args=None, **_kwargs):
    query = raw_args if isinstance(raw_args, str) else ""
    args = ["search", query] if query.strip() else ["recent", "--limit", "5"]
    output = _run_memorix(args)
    return output.get("text") or json.dumps(output, indent=2)


def _setup_cli_parser(subparsers):
    parser = subparsers.add_parser("memorix", help="Search Memorix project memory")
    parser.add_argument("query", nargs="*", help="Search query")
    return parser


def _handle_cli_command(args):
    query = " ".join(getattr(args, "query", []) or [])
    output = _run_memorix(["search", query] if query else ["recent", "--limit", "5"])
    sys.stdout.write(output.get("text") or json.dumps(output, indent=2))
    sys.stdout.write("\n")


def register(ctx):
    ctx.register_hook("pre_llm_call", _pre_llm_call)
    ctx.register_hook("post_tool_call", _post_tool_call)
    ctx.register_hook("post_llm_call", _post_llm_call)
    ctx.register_hook("on_session_start", _on_session_start)
    ctx.register_hook("on_session_end", _on_session_end)
    ctx.register_command("memorix", _memorix_command, description="Search Memorix project memory")
    ctx.register_cli_command("memorix", "Search Memorix project memory", _setup_cli_parser, _handle_cli_command)

    skills_dir = Path(__file__).parent / "skills"
    if not skills_dir.exists():
        return
    for child in sorted(skills_dir.iterdir()):
        skill_path = child / "SKILL.md"
        if not skill_path.exists():
            continue
        skill_md = skill_path.read_text(encoding="utf-8")
        ctx.register_skill(child.name, skill_md)
