from __future__ import annotations

from dataclasses import dataclass
import hashlib
import json
from pathlib import Path
import re
import unicodedata
from typing import Iterable

from .baseline import BaselineRetrieval, RetrievedMemory, token_count
from .public_safety import PublicSafetyError, reject_public_text
from .schema import (
    CaseManifest,
    VALID_TRACE_NORMALIZATIONS,
    VALID_TRACE_PROVENANCE,
    VALID_TRACE_TRUNCATIONS,
)


TRACE_SCHEMA_VERSION = "precursor-trace-v1"
TRACE_BUNDLE_SCHEMA_VERSION = "precursor-trace-bundle-v1"
TRACE_EVENT_ROLES = {"user", "assistant", "tool", "system"}
TRACE_EVENT_KINDS = {"message", "tool_call", "tool_result"}
MAX_EVENT_BYTES = 256 * 1024
MAX_TRACE_BYTES = 8 * 1024 * 1024
class TraceError(ValueError):
    """Raised when a precursor trace is invalid or unsafe for public replay."""


@dataclass(frozen=True)
class PrecursorEvent:
    event_id: str
    session_id: str
    sequence: int
    turn: int
    role: str
    kind: str
    content: str
    tool_name: str | None = None
    tool_call_id: str | None = None

    def replay_content(self) -> str:
        fields = [
            f"session={self.session_id}",
            f"sequence={self.sequence}",
            f"turn={self.turn}",
            f"role={self.role}",
            f"kind={self.kind}",
        ]
        if self.tool_name:
            fields.append(f"tool={self.tool_name}")
        if self.tool_call_id:
            fields.append(f"tool_call_id={self.tool_call_id}")
        return f"[{' '.join(fields)}]\n{self.content}"


@dataclass(frozen=True)
class PrecursorTrace:
    schema_version: str
    case_id: str
    provenance: str
    normalization: str
    events: tuple[PrecursorEvent, ...]
    source_path: Path
    source_sha256: str
    canonical_sha256: str

    @property
    def sha256(self) -> str:
        """Compatibility alias for the canonical, normalized trace commitment."""

        return self.canonical_sha256

    @property
    def session_ids(self) -> tuple[str, ...]:
        return tuple(dict.fromkeys(event.session_id for event in self.events))


@dataclass(frozen=True)
class TraceView:
    """A bounded, event-aligned view of one immutable precursor trace."""

    renderer: str
    trace_sha256: str
    token_budget: int
    token_count: int
    context: str
    retained_event_ids: tuple[str, ...]
    dropped_event_ids: tuple[str, ...]
    truncated: bool
    sha256: str


@dataclass(frozen=True)
class TraceBundleEntry:
    capture_id: str
    trace: PrecursorTrace
    receipt_sha256: str
    workspace_snapshot_sha256: str
    capture_mode: str


@dataclass(frozen=True)
class PrecursorTraceBundle:
    schema_version: str
    case_id: str
    selection: str
    normalization: str
    entries: tuple[TraceBundleEntry, ...]
    source_path: Path
    source_sha256: str


@dataclass(frozen=True)
class ResolvedPrecursorTrace:
    trace: PrecursorTrace
    capture_id: str | None
    selection: str | None
    bundle_sha256: str | None


def _canonical_text(value: str) -> str:
    normalized = unicodedata.normalize("NFC", value.replace("\r\n", "\n").replace("\r", "\n"))
    return "\n".join(line.rstrip() for line in normalized.split("\n")).strip()


def _sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def _sha256_payload(payload: object) -> str:
    encoded = json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return _sha256_bytes(encoded.encode("utf-8"))


def _reject_public_secrets(content: str) -> None:
    try:
        reject_public_text(content)
    except PublicSafetyError as error:
        raise TraceError(f"precursor trace {error}") from error


def _text(raw: object, field: str) -> str:
    if not isinstance(raw, str) or not raw.strip():
        raise TraceError(f"trace event {field} must be a non-empty string")
    return _canonical_text(raw)


def _optional_text(raw: object, field: str) -> str | None:
    if raw is None:
        return None
    return _text(raw, field)


def _non_negative_int(raw: object, field: str, index: int) -> int:
    if isinstance(raw, bool) or not isinstance(raw, int) or raw < 0:
        raise TraceError(f"trace event {index} {field} must be a non-negative integer")
    return raw


def _event(raw: object, index: int) -> PrecursorEvent:
    if not isinstance(raw, dict):
        raise TraceError(f"trace event {index} must be an object")
    event_id = _text(raw.get("id"), "id")
    session_id = _text(raw.get("session_id"), "session_id")
    role = _text(raw.get("role"), "role")
    kind = _text(raw.get("kind"), "kind")
    if role not in TRACE_EVENT_ROLES:
        raise TraceError(f"trace event {index} has an unsupported role")
    if kind not in TRACE_EVENT_KINDS:
        raise TraceError(f"trace event {index} has an unsupported kind")
    sequence = _non_negative_int(raw.get("sequence"), "sequence", index)
    turn = _non_negative_int(raw.get("turn"), "turn", index)
    content = _text(raw.get("content"), "content")
    if len(content.encode("utf-8")) > MAX_EVENT_BYTES:
        raise TraceError(f"trace event {index} exceeds the size limit")
    _reject_public_secrets(content)
    tool_name = _optional_text(raw.get("tool_name"), "tool_name")
    tool_call_id = _optional_text(raw.get("tool_call_id"), "tool_call_id")
    if tool_name is not None:
        _reject_public_secrets(tool_name)
    if tool_call_id is not None:
        _reject_public_secrets(tool_call_id)
    if kind == "message" and (tool_name or tool_call_id):
        raise TraceError(f"trace event {index} message must not declare tool metadata")
    if kind == "tool_call":
        if role != "assistant" or not tool_name or not tool_call_id:
            raise TraceError(
                f"trace event {index} tool_call requires assistant role, tool_name, and tool_call_id"
            )
    if kind == "tool_result":
        if role != "tool" or not tool_call_id:
            raise TraceError(
                f"trace event {index} tool_result requires tool role and tool_call_id"
            )
    return PrecursorEvent(
        event_id=event_id,
        session_id=session_id,
        sequence=sequence,
        turn=turn,
        role=role,
        kind=kind,
        content=content,
        tool_name=tool_name,
        tool_call_id=tool_call_id,
    )


def _validate_event_order(events: tuple[PrecursorEvent, ...]) -> None:
    if not events:
        raise TraceError("precursor trace must contain at least one event")
    if len({event.event_id for event in events}) != len(events):
        raise TraceError("precursor trace event ids must be unique")
    ordered = tuple(sorted(events, key=lambda event: (event.sequence, event.event_id)))
    if ordered != events:
        raise TraceError("precursor trace events must be in canonical sequence order")
    sequences = [event.sequence for event in events]
    if sequences != list(range(sequences[0], sequences[0] + len(sequences))):
        raise TraceError("precursor trace sequences must be contiguous")

    previous_turn_by_session: dict[str, int] = {}
    tool_calls: set[str] = set()
    resolved_tool_calls: set[str] = set()
    for event in events:
        previous_turn = previous_turn_by_session.get(event.session_id)
        if previous_turn is not None and event.turn < previous_turn:
            raise TraceError("trace event turns must not decrease within a session")
        previous_turn_by_session[event.session_id] = event.turn
        if event.kind == "tool_call":
            assert event.tool_call_id is not None
            if event.tool_call_id in tool_calls:
                raise TraceError("precursor trace tool_call_id values must be unique")
            tool_calls.add(event.tool_call_id)
        elif event.kind == "tool_result":
            assert event.tool_call_id is not None
            if event.tool_call_id not in tool_calls:
                raise TraceError("trace tool_result must reference an earlier tool_call")
            if event.tool_call_id in resolved_tool_calls:
                raise TraceError("precursor trace tool_call may have only one tool_result")
            resolved_tool_calls.add(event.tool_call_id)


def _canonical_payload(
    *,
    schema_version: str,
    case_id: str,
    provenance: str,
    normalization: str,
    events: Iterable[PrecursorEvent],
) -> dict[str, object]:
    return {
        "schema_version": schema_version,
        "case_id": case_id,
        "provenance": provenance,
        "normalization": normalization,
        "events": [
            {
                "id": event.event_id,
                "session_id": event.session_id,
                "sequence": event.sequence,
                "turn": event.turn,
                "role": event.role,
                "kind": event.kind,
                "content": event.content,
                **({"tool_name": event.tool_name} if event.tool_name else {}),
                **({"tool_call_id": event.tool_call_id} if event.tool_call_id else {}),
            }
            for event in events
        ],
    }


def _canonicalize_events(events: Iterable[PrecursorEvent]) -> tuple[PrecursorEvent, ...]:
    normalized: list[PrecursorEvent] = []
    for index, event in enumerate(events, start=1):
        raw: dict[str, object] = {
            "id": event.event_id,
            "session_id": event.session_id,
            "sequence": event.sequence,
            "turn": event.turn,
            "role": event.role,
            "kind": event.kind,
            "content": event.content,
        }
        if event.tool_name is not None:
            raw["tool_name"] = event.tool_name
        if event.tool_call_id is not None:
            raw["tool_call_id"] = event.tool_call_id
        normalized.append(_event(raw, index))
    ordered = tuple(normalized)
    _validate_event_order(ordered)
    return ordered


def load_trace_file(
    *,
    path: str | Path,
    case_id: str,
    provenance: str,
    normalization: str,
) -> PrecursorTrace:
    source = Path(path).resolve()
    if not source.is_file():
        raise TraceError("precursor trace path is unavailable")
    raw_bytes = source.read_bytes()
    if len(raw_bytes) > MAX_TRACE_BYTES:
        raise TraceError("precursor trace exceeds the size limit")
    try:
        raw = json.loads(raw_bytes.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise TraceError("precursor trace must be UTF-8 JSON") from error
    if not isinstance(raw, dict):
        raise TraceError("precursor trace must be a JSON object")
    if raw.get("schema_version") != TRACE_SCHEMA_VERSION:
        raise TraceError("precursor trace schema version is unsupported")
    if raw.get("case_id") != case_id:
        raise TraceError("precursor trace case id does not match the case")
    if raw.get("provenance") != provenance:
        raise TraceError("precursor trace provenance does not match the case")
    if raw.get("normalization") != normalization:
        raise TraceError("precursor trace normalization does not match the case")
    raw_events = raw.get("events")
    if not isinstance(raw_events, list):
        raise TraceError("precursor trace must contain an events array")
    events = _canonicalize_events(
        _event(item, index) for index, item in enumerate(raw_events, 1)
    )
    payload = _canonical_payload(
        schema_version=TRACE_SCHEMA_VERSION,
        case_id=case_id,
        provenance=provenance,
        normalization=normalization,
        events=events,
    )
    return PrecursorTrace(
        schema_version=TRACE_SCHEMA_VERSION,
        case_id=case_id,
        provenance=provenance,
        normalization=normalization,
        events=events,
        source_path=source,
        source_sha256=_sha256_bytes(raw_bytes),
        canonical_sha256=_sha256_payload(payload),
    )


def load_precursor_trace(
    manifest: CaseManifest,
    path: str | Path | None = None,
) -> PrecursorTrace:
    spec = manifest.precursor_trace
    if spec is None:
        raise TraceError(f"case {manifest.case_id} has no direct precursor trace")
    source = Path(path or (manifest.source_path.parent / spec.path)).resolve()
    root = manifest.source_path.parent.resolve()
    if source == root or root not in source.parents:
        raise TraceError("precursor trace path is outside the case")
    return load_trace_file(
        path=source,
        case_id=manifest.case_id,
        provenance=spec.provenance,
        normalization=spec.normalization,
    )


def _bundle_case_asset(manifest: CaseManifest, value: str) -> Path:
    root = manifest.source_path.parent.resolve()
    path = Path(value)
    if path.is_absolute() or ".." in path.parts:
        raise TraceError("trace bundle asset path must stay inside the case")
    candidate = (root / path).resolve()
    if candidate == root or root not in candidate.parents or not candidate.is_file():
        raise TraceError("trace bundle asset is unavailable or outside the case")
    return candidate


def _bundle_public_path_is_covered(manifest: CaseManifest, value: str) -> bool:
    normalized = Path(value).as_posix()
    return any(
        normalized == declared
        or normalized.startswith(declared.rstrip("/") + "/")
        for declared in manifest.public_bundle_paths
    )


def _required_bundle_text(value: object, *, label: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise TraceError(f"trace bundle {label} must be a non-empty string")
    return value.strip()


def _bundle_sha256(value: object, *, label: str) -> str:
    digest = _required_bundle_text(value, label=label)
    if not re.fullmatch(r"[0-9a-f]{64}", digest):
        raise TraceError(f"trace bundle {label} must be a lowercase SHA-256")
    return digest


def _bundle_normalization(raw: dict[str, object]) -> str:
    legacy_fields = {"schema_version", "case_id", "selection", "captures"}
    current_fields = legacy_fields | {"normalization"}
    fields = set(raw)
    if fields == legacy_fields:
        # Bundles written before normalization became explicit were v1-only.
        return "event-normalize-v1"
    if fields != current_fields:
        raise TraceError("trace bundle has unexpected fields")
    normalization = _required_bundle_text(raw.get("normalization"), label="normalization")
    if normalization not in VALID_TRACE_NORMALIZATIONS:
        raise TraceError("trace bundle normalization is unsupported")
    return normalization


def _trace_file_normalization(path: Path) -> str:
    raw_bytes = path.read_bytes()
    if len(raw_bytes) > MAX_TRACE_BYTES:
        raise TraceError("precursor trace exceeds the size limit")
    try:
        raw = json.loads(raw_bytes.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise TraceError("precursor trace must be UTF-8 JSON") from error
    if not isinstance(raw, dict):
        raise TraceError("precursor trace must be a JSON object")
    normalization = _required_bundle_text(raw.get("normalization"), label="normalization")
    if normalization not in VALID_TRACE_NORMALIZATIONS:
        raise TraceError("precursor trace normalization is unsupported")
    return normalization


def load_trace_bundle(manifest: CaseManifest) -> PrecursorTraceBundle:
    spec = manifest.precursor_trace_bundle
    if spec is None:
        raise TraceError(f"case {manifest.case_id} has no precursor trace bundle")
    bundle_path = _bundle_case_asset(manifest, spec.path)
    raw_bytes = bundle_path.read_bytes()
    try:
        raw = json.loads(raw_bytes.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise TraceError("trace bundle must be UTF-8 JSON") from error
    if not isinstance(raw, dict):
        raise TraceError("trace bundle must be an object")
    normalization = _bundle_normalization(raw)
    if raw.get("schema_version") != TRACE_BUNDLE_SCHEMA_VERSION or raw.get("schema_version") != spec.schema_version:
        raise TraceError("trace bundle schema version is unsupported")
    if raw.get("case_id") != manifest.case_id:
        raise TraceError("trace bundle case id does not match the case")
    if raw.get("selection") != spec.selection:
        raise TraceError("trace bundle selection does not match the case")
    captures = raw.get("captures")
    if not isinstance(captures, list) or len(captures) < 2:
        raise TraceError("trace bundle requires at least two captured sessions")
    from .trace_capture import TraceCaptureError, load_trace_capture_receipt

    entries: list[TraceBundleEntry] = []
    seen_capture_ids: set[str] = set()
    seen_trace_hashes: set[str] = set()
    snapshot_hashes: set[str] = set()
    for index, capture in enumerate(captures, start=1):
        if not isinstance(capture, dict):
            raise TraceError(f"trace bundle capture {index} must be an object")
        capture_fields = {
            "capture_id",
            "trace_path",
            "trace_source_sha256",
            "canonical_trace_sha256",
            "receipt_path",
            "receipt_sha256",
        }
        if set(capture) != capture_fields:
            raise TraceError(f"trace bundle capture {index} has unexpected fields")
        capture_id = _required_bundle_text(capture.get("capture_id"), label="capture_id")
        if not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", capture_id):
            raise TraceError("trace bundle capture id must be lowercase kebab-case")
        if capture_id in seen_capture_ids:
            raise TraceError("trace bundle capture ids must be unique")
        trace_path_text = _required_bundle_text(capture.get("trace_path"), label="trace_path")
        receipt_path_text = _required_bundle_text(capture.get("receipt_path"), label="receipt_path")
        trace_path = _bundle_case_asset(manifest, trace_path_text)
        receipt_path = _bundle_case_asset(manifest, receipt_path_text)
        if manifest.split in {"validation", "test"} and (
            not _bundle_public_path_is_covered(manifest, trace_path_text)
            or not _bundle_public_path_is_covered(manifest, receipt_path_text)
        ):
            raise TraceError("confirmatory trace bundle assets must be public-bundle allowlisted")
        trace_source_sha256 = _bundle_sha256(
            capture.get("trace_source_sha256"),
            label="trace_source_sha256",
        )
        canonical_trace_sha256 = _bundle_sha256(
            capture.get("canonical_trace_sha256"),
            label="canonical_trace_sha256",
        )
        receipt_sha256 = _bundle_sha256(capture.get("receipt_sha256"), label="receipt_sha256")
        if _sha256_bytes(trace_path.read_bytes()) != trace_source_sha256:
            raise TraceError("trace bundle trace source hash does not match")
        if _sha256_bytes(receipt_path.read_bytes()) != receipt_sha256:
            raise TraceError("trace bundle receipt hash does not match")
        try:
            receipt = load_trace_capture_receipt(receipt_path)
        except TraceCaptureError as error:
            raise TraceError("trace bundle capture receipt is invalid") from error
        trace = load_trace_file(
            path=trace_path,
            case_id=manifest.case_id,
            provenance="captured-session-v1",
            normalization=normalization,
        )
        if (
            receipt.capture_id != capture_id
            or receipt.case_id != manifest.case_id
            or receipt.trace_source_sha256 != trace_source_sha256
            or receipt.canonical_trace_sha256 != canonical_trace_sha256
            or trace.source_sha256 != trace_source_sha256
            or trace.canonical_sha256 != canonical_trace_sha256
        ):
            raise TraceError("trace bundle capture does not bind its trace receipt")
        if manifest.split in {"validation", "test"} and receipt.capture_mode != "isolated-worker-v1":
            raise TraceError("confirmatory trace bundle requires isolated-worker captures")
        if canonical_trace_sha256 in seen_trace_hashes:
            raise TraceError("trace bundle captures must have distinct canonical traces")
        seen_capture_ids.add(capture_id)
        seen_trace_hashes.add(canonical_trace_sha256)
        snapshot_hashes.add(receipt.workspace_snapshot_sha256)
        entries.append(TraceBundleEntry(
            capture_id=capture_id,
            trace=trace,
            receipt_sha256=receipt_sha256,
            workspace_snapshot_sha256=receipt.workspace_snapshot_sha256,
            capture_mode=receipt.capture_mode,
        ))
    if len(snapshot_hashes) != 1:
        raise TraceError("trace bundle captures must share one workspace snapshot")
    return PrecursorTraceBundle(
        schema_version=TRACE_BUNDLE_SCHEMA_VERSION,
        case_id=manifest.case_id,
        selection=spec.selection,
        normalization=normalization,
        entries=tuple(entries),
        source_path=bundle_path,
        source_sha256=_sha256_bytes(raw_bytes),
    )


def resolve_precursor_trace(
    manifest: CaseManifest,
    *,
    seed: int,
    repetition: int,
) -> ResolvedPrecursorTrace:
    if isinstance(seed, bool) or not isinstance(seed, int) or seed < 0:
        raise TraceError("trace selection seed must be a non-negative integer")
    if isinstance(repetition, bool) or not isinstance(repetition, int) or repetition < 0:
        raise TraceError("trace selection repetition must be a non-negative integer")
    if manifest.precursor_trace is not None:
        return ResolvedPrecursorTrace(
            trace=load_precursor_trace(manifest),
            capture_id=None,
            selection=None,
            bundle_sha256=None,
        )
    bundle = load_trace_bundle(manifest)
    if bundle.selection != "hash-bucket-v1":
        raise TraceError("trace bundle selection is unsupported")
    index = int.from_bytes(
        hashlib.sha256(
            f"{manifest.case_id}:{seed}:{repetition}".encode("utf-8")
        ).digest()[:8],
        "big",
    ) % len(bundle.entries)
    selected = bundle.entries[index]
    return ResolvedPrecursorTrace(
        trace=selected.trace,
        capture_id=selected.capture_id,
        selection=bundle.selection,
        bundle_sha256=bundle.source_sha256,
    )


def write_trace_bundle(
    *,
    path: str | Path,
    case_root: str | Path,
    case_id: str,
    trace_paths: Iterable[str | Path],
    receipt_paths: Iterable[str | Path],
    selection: str = "hash-bucket-v1",
) -> Path:
    """Write a verified public bundle from independently captured trace receipts."""

    root = Path(case_root).resolve()
    if not root.is_dir():
        raise TraceError("trace bundle case root is unavailable")
    target = Path(path).resolve()
    if target == root or root not in target.parents:
        raise TraceError("trace bundle output must stay inside the case root")
    if target.exists():
        raise TraceError("trace bundle output path already exists")
    traces = tuple(Path(value).resolve() for value in trace_paths)
    receipts = tuple(Path(value).resolve() for value in receipt_paths)
    if len(traces) != len(receipts) or len(traces) < 2:
        raise TraceError("trace bundle requires matching trace and receipt pairs for at least two captures")
    if selection != "hash-bucket-v1":
        raise TraceError("trace bundle selection is unsupported")
    from .trace_capture import TraceCaptureError, load_trace_capture_receipt

    captures: list[dict[str, str]] = []
    capture_ids: set[str] = set()
    canonical_hashes: set[str] = set()
    snapshot_hashes: set[str] = set()
    bundle_normalization: str | None = None
    for trace_path, receipt_path in zip(traces, receipts, strict=True):
        for asset in (trace_path, receipt_path):
            if asset == root or root not in asset.parents or not asset.is_file():
                raise TraceError("trace bundle input must stay inside the case root")
        try:
            receipt = load_trace_capture_receipt(receipt_path)
        except TraceCaptureError as error:
            raise TraceError("trace bundle receipt is invalid") from error
        trace_normalization = _trace_file_normalization(trace_path)
        if bundle_normalization is None:
            bundle_normalization = trace_normalization
        elif trace_normalization != bundle_normalization:
            raise TraceError("trace bundle captures must share one normalization")
        trace = load_trace_file(
            path=trace_path,
            case_id=case_id,
            provenance="captured-session-v1",
            normalization=trace_normalization,
        )
        if (
            receipt.case_id != case_id
            or receipt.trace_source_sha256 != trace.source_sha256
            or receipt.canonical_trace_sha256 != trace.canonical_sha256
        ):
            raise TraceError("trace bundle receipt does not bind its trace")
        if receipt.capture_id in capture_ids:
            raise TraceError("trace bundle capture ids must be unique")
        if trace.canonical_sha256 in canonical_hashes:
            raise TraceError("trace bundle captures must have distinct canonical traces")
        capture_ids.add(receipt.capture_id)
        canonical_hashes.add(trace.canonical_sha256)
        snapshot_hashes.add(receipt.workspace_snapshot_sha256)
        captures.append({
            "capture_id": receipt.capture_id,
            "trace_path": trace_path.relative_to(root).as_posix(),
            "trace_source_sha256": trace.source_sha256,
            "canonical_trace_sha256": trace.canonical_sha256,
            "receipt_path": receipt_path.relative_to(root).as_posix(),
            "receipt_sha256": _sha256_bytes(receipt_path.read_bytes()),
        })
    if len(snapshot_hashes) != 1:
        raise TraceError("trace bundle captures must share one workspace snapshot")
    if bundle_normalization is None:
        raise TraceError("trace bundle requires at least one normalization")
    payload = {
        "schema_version": TRACE_BUNDLE_SCHEMA_VERSION,
        "case_id": case_id,
        "selection": selection,
        "normalization": bundle_normalization,
        "captures": captures,
    }
    target.parent.mkdir(parents=True, exist_ok=True)
    with target.open("w", encoding="utf-8", newline="\n") as handle:
        handle.write(json.dumps(payload, indent=2, ensure_ascii=False) + "\n")
    return target


def trace_records(trace: PrecursorTrace) -> tuple[RetrievedMemory, ...]:
    return tuple(
        RetrievedMemory(
            memory_id=f"trace:{event.event_id}",
            content=event.replay_content(),
        )
        for event in trace.events
    )


def _trace_header() -> str:
    return (
        "Here is the bounded normalized record from the previous project session. "
        "Verify it against the current source.\n"
    )


def _render_trace_events(events: Iterable[PrecursorEvent]) -> str:
    rendered = "\n\n".join(event.replay_content() for event in events)
    return _trace_header() + rendered if rendered else _trace_header().rstrip()


def render_trace_view(
    trace: PrecursorTrace,
    *,
    token_budget: int,
    truncation: str = "event-suffix-v1",
) -> TraceView:
    """Render a bounded raw-replay control without cutting through an event."""

    if token_budget <= 0:
        raise TraceError("trace context token budget must be positive")
    if truncation not in VALID_TRACE_TRUNCATIONS:
        raise TraceError(f"unsupported trace truncation strategy: {truncation}")
    header = _trace_header().rstrip()
    if token_count(header) > token_budget:
        raise TraceError("trace context token budget cannot contain the required header")

    retained: list[PrecursorEvent] = []
    for event in reversed(trace.events):
        candidate = (event, *retained)
        if token_count(_render_trace_events(candidate)) > token_budget:
            break
        retained = list(candidate)
    if not retained:
        raise TraceError(
            "trace context cannot retain a complete event within the token budget"
        )
    context = _render_trace_events(retained).rstrip()
    retained_ids = tuple(event.event_id for event in retained)
    retained_set = set(retained_ids)
    dropped_ids = tuple(event.event_id for event in trace.events if event.event_id not in retained_set)
    payload = {
        "renderer": truncation,
        "trace_sha256": trace.canonical_sha256,
        "token_budget": token_budget,
        "retained_event_ids": retained_ids,
        "dropped_event_ids": dropped_ids,
        "context": context,
    }
    return TraceView(
        renderer=truncation,
        trace_sha256=trace.canonical_sha256,
        token_budget=token_budget,
        token_count=token_count(context),
        context=context,
        retained_event_ids=retained_ids,
        dropped_event_ids=dropped_ids,
        truncated=bool(dropped_ids),
        sha256=_sha256_payload(payload),
    )


def trace_context(trace: PrecursorTrace, *, token_budget: int) -> tuple[str, int, bool]:
    """Compatibility renderer for callers that only need the prompt payload."""

    view = render_trace_view(trace, token_budget=token_budget)
    return view.context, view.token_count, view.truncated


def render_trace_retrieval(
    trace: PrecursorTrace,
    *,
    query: str,
    token_budget: int,
) -> BaselineRetrieval:
    """Render a deterministic, event-aligned replay context for diagnostics."""

    view = render_trace_view(trace, token_budget=token_budget)
    retained = set(view.retained_event_ids)
    records = tuple(
        record
        for record in trace_records(trace)
        if record.memory_id.removeprefix("trace:") in retained
    )
    return BaselineRetrieval(
        provider="trace-replay-canonical-v1",
        provider_version=trace.schema_version,
        query=query,
        records=records,
        context=view.context,
        token_budget=view.token_budget,
        token_count=view.token_count,
        truncated=view.truncated,
        retrieval_call_count=1,
        retrieval_round_count=1,
    )


def canonical_trace_sha256(
    *,
    case_id: str,
    provenance: str,
    normalization: str,
    events: Iterable[PrecursorEvent],
) -> str:
    """Return the canonical trace commitment without writing a public artifact."""

    if provenance not in VALID_TRACE_PROVENANCE:
        raise TraceError(f"unsupported trace provenance: {provenance}")
    if normalization not in VALID_TRACE_NORMALIZATIONS:
        raise TraceError(f"unsupported trace normalization: {normalization}")
    ordered = _canonicalize_events(events)
    for event in ordered:
        _reject_public_secrets(event.content)
    return _sha256_payload(_canonical_payload(
        schema_version=TRACE_SCHEMA_VERSION,
        case_id=case_id,
        provenance=provenance,
        normalization=normalization,
        events=ordered,
    ))


def write_canonical_trace(
    *,
    path: str | Path,
    case_id: str,
    provenance: str,
    normalization: str,
    events: Iterable[PrecursorEvent],
) -> Path:
    ordered = tuple(events)
    ordered = _canonicalize_events(ordered)
    canonical_trace_sha256(
        case_id=case_id,
        provenance=provenance,
        normalization=normalization,
        events=ordered,
    )
    payload = _canonical_payload(
        schema_version=TRACE_SCHEMA_VERSION,
        case_id=case_id,
        provenance=provenance,
        normalization=normalization,
        events=ordered,
    )
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    with target.open("w", encoding="utf-8", newline="\n") as handle:
        handle.write(json.dumps(payload, indent=2, ensure_ascii=False) + "\n")
    return target
