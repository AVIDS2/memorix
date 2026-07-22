import json
from pathlib import Path

from memorixbench.memorix_adapter import (
    MEMORIX_CANONICAL_PROVIDER_ID,
    PROVIDER_ENV_KEYS,
    _isolated_process_env,
    _parse_mcp_body,
    ingest_memorix_trace,
    retrieve_memorix_canonical,
    write_claude_mcp_config,
)
from memorixbench.trace import PrecursorEvent, PrecursorTrace


def test_parses_sse_mcp_response() -> None:
    body = 'event: message\ndata: {"jsonrpc":"2.0","id":1,"result":{"ok":true}}\n\n'
    assert _parse_mcp_body(body)["result"] == {"ok": True}


def test_writes_isolated_claude_mcp_config(tmp_path: Path) -> None:
    path = write_claude_mcp_config(
        path=tmp_path / "mcp.json",
        cli_path=Path("C:/memorix/dist/cli/index.js"),
        workspace=Path("C:/case"),
        data_dir=Path("C:/data"),
        home_dir=Path("C:/home"),
        mode="micro",
    )
    payload = json.loads(path.read_text(encoding="utf-8"))
    server = payload["mcpServers"]["memorix"]
    assert server["args"][-1] == "micro"
    assert server["env"]["MEMORIX_EMBEDDING"] == "off"
    assert server["env"]["OPENROUTER_API_KEY"] == ""


def test_isolated_process_env_scrubs_provider_credentials(monkeypatch) -> None:
    for key in PROVIDER_ENV_KEYS:
        monkeypatch.setenv(key, "do-not-inherit")

    isolated = _isolated_process_env({"MEMORIX_LLM_MODEL": "controlled-model"})

    assert isolated["MEMORIX_LLM_MODEL"] == "controlled-model"
    assert "OPENROUTER_API_KEY" not in isolated
    assert "OPENAI_API_KEY" not in isolated


def test_memorix_trace_ingestion_never_scans_the_precursor_workspace(tmp_path: Path, monkeypatch) -> None:
    import memorixbench.memorix_adapter as module

    calls: list[tuple[str, dict[str, object]]] = []

    class FakeControlPlane:
        def __init__(self, **_kwargs) -> None:
            pass

        def __enter__(self):
            return self

        def __exit__(self, *_args) -> None:
            return None

        def tool(self, name: str, arguments: dict[str, object]) -> dict[str, object]:
            calls.append((name, arguments))
            if name == "memorix_project_context":
                return {"structuredContent": {"project": {"id": "project-a"}}}
            return {"structuredContent": {"ok": True}}

        def poll_maintenance(self, _project_id: str) -> dict[str, object]:
            return {"summary": {}, "poll_count": 2}

    monkeypatch.setattr(module, "MemorixControlPlane", FakeControlPlane)
    trace = PrecursorTrace(
        schema_version="precursor-trace-v1",
        case_id="case-a",
        provenance="captured-session-v1",
        normalization="event-normalize-v1",
        events=(
            PrecursorEvent(
                event_id="event-1",
                session_id="session-1",
                sequence=0,
                turn=0,
                role="user",
                kind="message",
                content="Do not scan this workspace during formation.",
            ),
        ),
        source_path=tmp_path / "trace.json",
        source_sha256="source-hash",
        canonical_sha256="canonical-hash",
    )

    result = ingest_memorix_trace(
        trace=trace,
        workspace=tmp_path / "workspace",
        cli_path=tmp_path / "cli.js",
        data_dir=tmp_path / "data",
        home_dir=tmp_path / "home",
        artifact_dir=tmp_path / "artifacts",
    )

    assert calls[0] == (
        "memorix_project_context",
        {
            "task": "Replay the precursor session for benchmark formation.",
            "format": "json",
            "refresh": "never",
        },
    )
    assert calls[1][0] == "memorix_store"
    receipt = result["formation_receipt"]
    assert receipt["transport_call_count"] == 4
    assert receipt["source_event_ids"] == ["event-1"]


def test_memorix_canonical_retrieval_uses_one_logical_search_round(tmp_path: Path, monkeypatch) -> None:
    import memorixbench.memorix_adapter as module

    calls: list[tuple[str, dict[str, object]]] = []

    class FakeControlPlane:
        def __init__(self, **_kwargs) -> None:
            pass

        def __enter__(self):
            return self

        def __exit__(self, *_args) -> None:
            return None

        def tool(self, name: str, arguments: dict[str, object]) -> dict[str, object]:
            calls.append((name, arguments))
            if name == "memorix_search":
                return {"content": [{"type": "text", "text": "| obs:7@project-a | decision |"}]}
            return {"content": [{"type": "text", "text": "Full durable policy evidence"}]}

    monkeypatch.setattr(module, "MemorixControlPlane", FakeControlPlane)

    result = retrieve_memorix_canonical(
        workspace=tmp_path / "workspace",
        cli_path=tmp_path / "cli.js",
        data_dir=tmp_path / "data",
        home_dir=tmp_path / "home",
        artifact_dir=tmp_path / "artifact",
        query="repair policy",
        top_k=8,
        token_budget=180,
    )

    assert result.retrieval.provider == MEMORIX_CANONICAL_PROVIDER_ID
    assert result.retrieval.retrieval_call_count == 1
    assert result.retrieval.retrieval_round_count == 1
    assert result.transport_call_count == 2
    assert result.candidate_refs == ("obs:7@project-a",)
    assert calls[0][0] == "memorix_search"
    assert calls[1] == ("memorix_detail", {"typedRefs": ["obs:7@project-a"]})
