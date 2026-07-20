from pathlib import Path

from memorixbench.baseline import (
    RetrievedMemory,
    build_retrieval,
    canonical_seed_content,
    scrubbed_provider_environment,
    token_count,
)
from memorixbench.mem0_adapter import MEM0_PROVIDER_ID, Mem0LocalAdapter
from memorixbench.schema import MemorySeedSpec


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
