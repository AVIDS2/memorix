from pathlib import Path

import pytest

from memorixbench.baseline import (
    RetrievedMemory,
    build_retrieval,
    canonical_seed_content,
    scrubbed_provider_environment,
    token_count,
)
from memorixbench.mem0_adapter import MEM0_PROVIDER_ID, Mem0LocalAdapter
from memorixbench.schema import MemorySeedSpec
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
                role="user",
                kind="message",
                content="Keep the retry delay bounded.",
            ),
        ),
        source_path=tmp_path / "trace.json",
        source_sha256="source-hash",
        canonical_sha256="canonical-hash",
    )


def test_canonical_seed_content_keeps_policy_and_location_separate() -> None:
    seed = MemorySeedSpec(
        entity_name="retry-delay-policy",
        type="decision",
        title="Retry delay bounds",
        narrative="The reliability policy survives implementation moves.",
        facts=("Minimum: 375ms", "Cadence: 125ms"),
        files_modified=("internal/policy/delay.go",),
        concepts=("retry", "reliability"),
        topic_key="policy/retry-delay",
    )

    content = canonical_seed_content(seed)

    assert "Title: Retry delay bounds" in content
    assert "Narrative: The reliability policy survives implementation moves." in content
    assert "- Minimum: 375ms" in content
    assert "- internal/policy/delay.go" in content


def test_retrieval_context_uses_a_stable_token_budget() -> None:
    retrieval = build_retrieval(
        provider="test",
        provider_version="1",
        query="retry policy",
        records=(
            RetrievedMemory(memory_id="one", content="first " * 30, score=0.9),
            RetrievedMemory(memory_id="two", content="second " * 30, score=0.8),
        ),
        token_budget=45,
    )

    assert retrieval.token_count <= 45
    assert token_count(retrieval.context) == retrieval.token_count
    assert retrieval.context.startswith("Retrieved project memory follows.")
    assert retrieval.truncated


def test_retrieval_receipt_rejects_impossible_call_accounting() -> None:
    with pytest.raises(ValueError, match="round_count cannot exceed"):
        build_retrieval(
            provider="test",
            provider_version="1",
            query="retry policy",
            records=(),
            token_budget=45,
            retrieval_call_count=1,
            retrieval_round_count=2,
        )


def test_scrubbed_environment_removes_provider_credentials() -> None:
    environment = scrubbed_provider_environment(
        {
            "OPENROUTER_API_KEY": "never-copy",
            "ANTHROPIC_AUTH_TOKEN": "never-copy",
            "PATH": "kept",
        }
    )

    assert "OPENROUTER_API_KEY" not in environment
    assert "ANTHROPIC_AUTH_TOKEN" not in environment
    assert environment["PATH"] == "kept"


def test_mem0_adapter_builds_a_pinned_local_request(tmp_path: Path) -> None:
    adapter = Mem0LocalAdapter(
        python_path=tmp_path / "python.exe",
        data_dir=tmp_path / "data",
        artifact_dir=tmp_path / "artifacts",
        collection_name="case-a",
    )

    request = adapter._base_request("preflight")

    assert adapter.worker_path.is_file()
    assert request["action"] == "preflight"
    assert request["collection_name"] == "case-a"
    assert MEM0_PROVIDER_ID == "mem0-2.0.12-local"


def test_mem0_adapter_uses_a_short_shared_model_cache_offline(tmp_path: Path) -> None:
    cache_root = tmp_path / "cache"
    adapter = Mem0LocalAdapter(
        python_path=tmp_path / "python.exe",
        data_dir=tmp_path / "very" / "deep" / "run-data",
        artifact_dir=tmp_path / "artifacts",
        model_cache_root=cache_root,
    )

    environment = adapter._environment()

    assert environment["FASTEMBED_CACHE_PATH"] == str(cache_root / "fastembed")
    assert environment["HF_HOME"] == str(cache_root / "huggingface")
    assert environment["HF_HUB_OFFLINE"] == "1"
    assert environment["TRANSFORMERS_OFFLINE"] == "1"


def test_mem0_trace_ingestion_uses_each_canonical_event_once(tmp_path: Path) -> None:
    adapter = Mem0LocalAdapter(
        python_path=tmp_path / "python.exe",
        data_dir=tmp_path / "data",
        artifact_dir=tmp_path / "artifacts",
    )
    captured: dict[str, object] = {}
    adapter._invoke = lambda action, payload: captured.update({"action": action, "payload": payload}) or {
        "seed_count": 1
    }

    result = adapter.ingest_trace(_trace(tmp_path), project_id="project-a")

    assert captured["action"] == "seed"
    request = captured["payload"]
    assert isinstance(request, dict)
    assert request["seeds"][0]["seed_id"] == "trace:event-1"
    receipt = result["formation_receipt"]
    assert receipt["trace_sha256"] == "canonical-hash"
    assert receipt["source_event_ids"] == ["event-1"]
    assert receipt["write_operation_count"] == 1
