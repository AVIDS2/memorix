from __future__ import annotations

from datetime import datetime, timezone
import json
from pathlib import Path
import time
from typing import Any, Protocol
from uuid import uuid4

from .models import ModelReply, RouteSpec, sha256_file, sha256_text


class RouteClient(Protocol):
    def chat(self, messages: list[dict[str, Any]], tools: list[dict[str, Any]]) -> ModelReply:
        ...


_QUALIFICATION_MESSAGES = [
    {
        "role": "user",
        "content": "Reply with OK only. Do not call tools.",
    }
]
_WINDOW_ATTEMPTS = 3


def _validated_artifact_root(value: Path) -> Path:
    root = value.resolve()
    repository_root = Path(__file__).resolve().parents[4]
    allowed = (repository_root / "research" / "artifacts").resolve()
    if root != allowed and allowed not in root.parents:
        raise ValueError("route qualification artifacts must stay below research/artifacts in the repository")
    return root


def qualify_route(
    *,
    route: RouteSpec,
    client: RouteClient,
    artifact_root: Path,
) -> dict[str, Any]:
    """Perform a non-cohort transport check and retain only a sanitized receipt."""
    root = _validated_artifact_root(artifact_root)
    root.mkdir(parents=True, exist_ok=True)
    run_id = f"route-qualification-{uuid4().hex[:12]}"
    receipt_path = root / "route-qualifications" / f"{run_id}.json"
    receipt_path.parent.mkdir(parents=True, exist_ok=True)

    started = time.monotonic()
    reply: ModelReply | None = None
    failure: str | None = None
    try:
        reply = client.chat(_QUALIFICATION_MESSAGES, [])
        total_tokens = (
            reply.input_tokens + reply.output_tokens
            if isinstance(reply.input_tokens, int)
            and not isinstance(reply.input_tokens, bool)
            and isinstance(reply.output_tokens, int)
            and not isinstance(reply.output_tokens, bool)
            else None
        )
        violation = route.reply_violation(reply, reply.cost_usd, total_tokens)
        if violation is not None:
            failure = f"route:{violation}"
    except Exception as error:  # The receipt retains a safe classification only.
        failure = f"infrastructure:{getattr(error, 'code', type(error).__name__)}"

    subscription_route = route.cost_policy.kind == "subscription-quota"
    payload = {
        "schema_version": "route-qualification-v1",
        "qualification_type": "non-cohort-transport",
        "run_id": run_id,
        "recorded_at": datetime.now(timezone.utc).isoformat(),
        "status": "passed" if failure is None else "failed",
        "failure": failure,
        "route": route.receipt_payload(),
        "actual_model": reply.model if reply is not None else None,
        "response_id_sha256": sha256_text(reply.response_id) if reply and reply.response_id else None,
        "resource_usage": {
            "input_tokens": reply.input_tokens if reply is not None else None,
            "output_tokens": reply.output_tokens if reply is not None else None,
            "total_tokens": (
                reply.input_tokens + reply.output_tokens
                if reply is not None
                and isinstance(reply.input_tokens, int)
                and not isinstance(reply.input_tokens, bool)
                and isinstance(reply.output_tokens, int)
                and not isinstance(reply.output_tokens, bool)
                else None
            ),
            "cost_usd": None if subscription_route else (reply.cost_usd if reply is not None else None),
            "provider_reported_request_price_usd": (
                reply.cost_usd if subscription_route and reply is not None else None
            ),
            "cost_accounting": route.cost_policy.kind,
        },
        "elapsed_ms": round((time.monotonic() - started) * 1000),
    }
    receipt_path.write_text(json.dumps(payload, indent=2, ensure_ascii=True) + "\n", encoding="utf-8")
    return {"receipt_path": receipt_path, "payload": payload}


def qualify_route_window(
    *,
    route: RouteSpec,
    client: RouteClient,
    artifact_root: Path,
) -> dict[str, Any]:
    """Run the fixed three-probe route gate without outcome-driven retries."""
    root = _validated_artifact_root(artifact_root)
    root.mkdir(parents=True, exist_ok=True)
    started_at = datetime.now(timezone.utc).isoformat()
    attempts: list[dict[str, object]] = []
    for sequence in range(1, _WINDOW_ATTEMPTS + 1):
        outcome = qualify_route(route=route, client=client, artifact_root=root)
        receipt_path = Path(outcome["receipt_path"])
        receipt = outcome["payload"]
        attempts.append(
            {
                "sequence": sequence,
                "receipt_filename": receipt_path.name,
                "receipt_sha256": sha256_file(receipt_path),
                "status": receipt["status"],
                "failure": receipt["failure"],
                "actual_model": receipt["actual_model"],
                "total_tokens": receipt["resource_usage"]["total_tokens"],
            }
        )
    window_id = f"route-stability-window-{uuid4().hex[:12]}"
    summary_path = root / "route-qualification-windows" / f"{window_id}.json"
    summary_path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "schema_version": "route-qualification-window-v1",
        "qualification_type": "fixed-three-probe-transport-window",
        "window_id": window_id,
        "started_at": started_at,
        "route": route.receipt_payload(),
        "attempt_count": _WINDOW_ATTEMPTS,
        "all_passed": all(attempt["status"] == "passed" for attempt in attempts),
        "attempts": attempts,
    }
    summary_path.write_text(json.dumps(payload, indent=2, ensure_ascii=True) + "\n", encoding="utf-8")
    return {"summary_path": summary_path, "payload": payload}
