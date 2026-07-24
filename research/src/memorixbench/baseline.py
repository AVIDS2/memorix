from __future__ import annotations

from dataclasses import dataclass
import os
import re
from typing import Iterable, Mapping, Sequence

from .schema import MemorySeedSpec


TOKENIZER_NAME = "lexical-token-proxy-v1"
PROVIDER_ENV_KEYS = (
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_AUTH_TOKEN",
    "OPENAI_API_KEY",
    "OPENROUTER_API_KEY",
    "OPENROUTER_MODEL",
    "GEMINI_API_KEY",
    "GOOGLE_API_KEY",
    "MINIMAX_API_KEY",
    "DEEPSEEK_API_KEY",
    "XAI_API_KEY",
    "COHERE_API_KEY",
    "TOGETHER_API_KEY",
    "VOYAGE_API_KEY",
    "AWS_ACCESS_KEY_ID",
    "AWS_SECRET_ACCESS_KEY",
    "AWS_SESSION_TOKEN",
)
_TOKEN_PATTERN = re.compile(r"[A-Za-z0-9_]+|[^\sA-Za-z0-9_]")


@dataclass(frozen=True)
class RetrievedMemory:
    memory_id: str
    content: str
    score: float | None = None


@dataclass(frozen=True)
class BaselineRetrieval:
    provider: str
    provider_version: str | None
    query: str
    records: tuple[RetrievedMemory, ...]
    context: str
    token_budget: int
    token_count: int
    truncated: bool
    retrieval_call_count: int = 1
    retrieval_round_count: int = 1


def canonical_seed_id(seed: MemorySeedSpec) -> str:
    return seed.topic_key or seed.entity_name


def canonical_seed_content(seed: MemorySeedSpec) -> str:
    """Represent every system's seed with the same durable textual evidence."""
    lines = [
        f"Title: {seed.title}",
        f"Type: {seed.type}",
        f"Narrative: {seed.narrative}",
    ]
    if seed.facts:
        lines.append("Facts:")
        lines.extend(f"- {fact}" for fact in seed.facts)
    if seed.files_modified:
        lines.append("Files:")
        lines.extend(f"- {path}" for path in seed.files_modified)
    if seed.concepts:
        lines.append("Concepts: " + ", ".join(seed.concepts))
    if seed.related_entities:
        lines.append("Related entities: " + ", ".join(seed.related_entities))
    return "\n".join(lines)


def token_count(text: str) -> int:
    return sum(1 for _ in _TOKEN_PATTERN.finditer(text))


def truncate_to_tokens(text: str, budget: int) -> tuple[str, bool]:
    if budget < 0:
        raise ValueError("token budget must not be negative")
    matches = tuple(_TOKEN_PATTERN.finditer(text))
    if len(matches) <= budget:
        return text, False
    if budget == 0:
        return "", True
    return text[: matches[budget - 1].end()], True


def render_retrieved_context(
    *,
    provider: str,
    records: Sequence[RetrievedMemory],
    token_budget: int,
) -> tuple[str, int, bool]:
    """Create a provider-neutral, bounded context block from ranked results."""
    if token_budget <= 0:
        raise ValueError("token budget must be positive")
    header = (
        "Retrieved project memory follows. It may contain stale implementation "
        "details; verify it against the current source.\n"
    )
    context, truncated = truncate_to_tokens(header, token_budget)
    remaining = token_budget - token_count(context)
    for index, record in enumerate(records, 1):
        if remaining <= 0:
            truncated = True
            break
        block = f"\n[{index}] {record.content.strip()}\n"
        rendered, block_truncated = truncate_to_tokens(block, remaining)
        context += rendered
        remaining -= token_count(rendered)
        truncated = truncated or block_truncated
        if block_truncated:
            break
    return context.rstrip(), token_count(context.rstrip()), truncated


def build_retrieval(
    *,
    provider: str,
    provider_version: str | None,
    query: str,
    records: Iterable[RetrievedMemory],
    token_budget: int,
    retrieval_call_count: int = 1,
    retrieval_round_count: int = 1,
) -> BaselineRetrieval:
    if retrieval_call_count <= 0:
        raise ValueError("retrieval_call_count must be positive")
    if retrieval_round_count <= 0:
        raise ValueError("retrieval_round_count must be positive")
    if retrieval_round_count > retrieval_call_count:
        raise ValueError("retrieval_round_count cannot exceed retrieval_call_count")
    normalized = tuple(
        record
        for record in records
        if record.memory_id.strip() and record.content.strip()
    )
    context, used, truncated = render_retrieved_context(
        provider=provider,
        records=normalized,
        token_budget=token_budget,
    )
    return BaselineRetrieval(
        provider=provider,
        provider_version=provider_version,
        query=query,
        records=normalized,
        context=context,
        token_budget=token_budget,
        token_count=used,
        truncated=truncated,
        retrieval_call_count=retrieval_call_count,
        retrieval_round_count=retrieval_round_count,
    )


def scrubbed_provider_environment(
    base: Mapping[str, str] | None = None,
) -> dict[str, str]:
    env = dict(os.environ if base is None else base)
    for key in PROVIDER_ENV_KEYS:
        env.pop(key, None)
    return env
