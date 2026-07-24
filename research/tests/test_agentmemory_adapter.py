import json
from pathlib import Path
from http.client import RemoteDisconnected

import pytest

from memorixbench.agentmemory_adapter import (
    AGENTMEMORY_PROVIDER_ID,
    AGENTMEMORY_STATIC_PORT,
    AgentMemoryAdapterError,
    AgentMemoryFullAdapter,
    ENGINE_PORT_OFFSETS,
    PERSISTENCE_SETTLE_SECONDS,
    _narrative_content,
)
from memorixbench.trace import PrecursorEvent, PrecursorTrace


def _trace(tmp_path: Path) -> PrecursorTrace:
    return PrecursorTrace(
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
                role="assistant",
                kind="message",
                content="The cache policy has changed.",
            ),
        ),
        source_path=tmp_path / "trace.json",
        source_sha256="source-hash",
        canonical_sha256="canonical-hash",
    )


def _adapter(tmp_path: Path) -> AgentMemoryFullAdapter:
    package_root = tmp_path / "runtime" / "node_modules" / "@agentmemory" / "agentmemory"
    (package_root / "dist").mkdir(parents=True)
    (package_root / "dist" / "cli.mjs").write_text("// fixture", encoding="utf-8")
    (package_root / "docker-compose.yml").write_text("services: {}\n", encoding="utf-8")
    (package_root / "package.json").write_text(
        json.dumps({"version": "0.9.28"}), encoding="utf-8"
    )
    return AgentMemoryFullAdapter(
        runtime_root=tmp_path / "runtime",
        data_dir=tmp_path / "data",
        artifact_dir=tmp_path / "artifacts",
        project_name="memorixbench_agentmemory_test",
        lock_path=tmp_path / "locks" / "agentmemory-3111.lock",
    )


def test_agentmemory_adapter_scrubs_provider_state_and_uses_isolated_home(
    tmp_path: Path,
    monkeypatch,
) -> None:
    monkeypatch.setenv("OPENROUTER_API_KEY", "never-copy")
    monkeypatch.setenv("ANTHROPIC_BASE_URL", "https://provider.invalid")
    adapter = _adapter(tmp_path)

    environment = adapter._environment()

    assert environment["AGENTMEMORY_USE_DOCKER"] == "1"
    assert environment["AGENTMEMORY_AUTO_COMPRESS"] == "false"
    assert environment["AGENTMEMORY_INJECT_CONTEXT"] == "false"
    assert environment["HOME"] == str(adapter.home_dir)
    assert environment["COMPOSE_PROJECT_NAME"] == adapter.project_name
    assert "OPENROUTER_API_KEY" not in environment
    assert "ANTHROPIC_BASE_URL" not in environment
    assert PERSISTENCE_SETTLE_SECONDS == 12
    assert AGENTMEMORY_STATIC_PORT == 3111
    assert ENGINE_PORT_OFFSETS == (0, 1, 2, 6_353, 46_023)


def test_agentmemory_adapter_rejects_ports_not_exposed_by_pinned_compose(
    tmp_path: Path,
) -> None:
    with pytest.raises(AgentMemoryAdapterError, match="fixed ports"):
        AgentMemoryFullAdapter(
            runtime_root=tmp_path / "runtime",
            data_dir=tmp_path / "data",
            artifact_dir=tmp_path / "artifacts",
            project_name="memorixbench_agentmemory_test",
            port=3112,
        )


def test_agentmemory_compose_cleanup_only_removes_volumes_after_final_stop(
    tmp_path: Path,
    monkeypatch,
) -> None:
    adapter = _adapter(tmp_path)
    monkeypatch.setattr("memorixbench.agentmemory_adapter.shutil.which", lambda _: "docker")

    restart_command = adapter._compose_down_command(preserve_state=True)
    final_command = adapter._compose_down_command(preserve_state=False)

    assert restart_command[-1] == "down"
    assert final_command[-2:] == ["down", "--volumes"]


def test_agentmemory_adapter_normalizes_scoped_search_results(tmp_path: Path) -> None:
    adapter = _adapter(tmp_path)
    adapter._search_raw = lambda **_: {
        "results": [
            {
                "score": 0.9,
                "observation": {
                    "id": "memory-1",
                    "narrative": "Durable retry policy",
                },
            },
            {
                "score": 0.4,
                "observation": {"id": "memory-2", "facts": ["Fallback fact"]},
            },
        ]
    }

    retrieval = adapter.retrieve(
        project_id="project-a",
        query="retry policy",
        top_k=8,
        token_budget=80,
    )

    assert retrieval.provider == AGENTMEMORY_PROVIDER_ID
    assert retrieval.provider_version == "0.9.28"
    assert [record.memory_id for record in retrieval.records] == ["memory-1", "memory-2"]
    assert "Durable retry policy" in retrieval.context
    assert (adapter.artifact_dir / "retrieve.json").is_file()


def test_agentmemory_adapter_treats_startup_disconnect_as_retryable(tmp_path: Path, monkeypatch) -> None:
    adapter = _adapter(tmp_path)
    monkeypatch.setattr(
        "memorixbench.agentmemory_adapter.urlopen",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(RemoteDisconnected("starting")),
    )

    with pytest.raises(AgentMemoryAdapterError, match="starting"):
        adapter._request_json("/agentmemory/livez", timeout_seconds=1)


def test_agentmemory_narrative_content_prefers_full_narrative() -> None:
    assert _narrative_content(
        {"narrative": "full evidence", "facts": ["short evidence"]}
    ) == "full evidence"
    assert _narrative_content({"facts": ["one", "two"]}) == "one\ntwo"


def test_agentmemory_trace_ingestion_records_event_receipt(tmp_path: Path) -> None:
    adapter = _adapter(tmp_path)
    calls: list[dict[str, str]] = []
    adapter._remember = lambda **kwargs: calls.append(kwargs) or {"ok": True}

    result = adapter.ingest_trace(_trace(tmp_path), project_id="project-a")

    assert calls == [{
        "project_id": "project-a",
        "content": "[session=session-1 sequence=0 turn=0 role=assistant kind=message]\nThe cache policy has changed.",
    }]
    receipt = result["formation_receipt"]
    assert receipt["trace_sha256"] == "canonical-hash"
    assert receipt["transport_call_count"] == 1
    assert (adapter.artifact_dir / "trace-seed.json").is_file()
