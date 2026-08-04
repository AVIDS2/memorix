from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import datetime, timezone
import json
from pathlib import Path
import shutil
import subprocess
import sys
import time
from typing import Any, Literal, Protocol
from uuid import uuid4

from .models import CaseSpec, ModelReply, OracleSpec, ToolCall, compact_json, sha256_text, sha256_tree
from .sandbox import ToolSandbox


Condition = Literal["no-memory", "raw-record", "memorix-native"]
SurfaceProfile = Literal["native-product", "canonical-information"]
EvidencePolicy = Literal["optional", "fixed-index"]
PROTOCOL_VERSION = "1.5-draft"


class AgentClient(Protocol):
    def chat(self, messages: list[dict[str, Any]], tools: list[dict[str, Any]]) -> ModelReply: ...


@dataclass(frozen=True)
class TrialConfig:
    case: CaseSpec
    oracle: OracleSpec
    condition: Condition
    requested_model: str
    artifact_root: Path
    memorix_cli: str = "memorix"
    max_steps: int = 24
    memorix_timeout_seconds: int = 120
    surface_profile: SurfaceProfile = "native-product"
    evidence_policy: EvidencePolicy = "optional"


def _tool_definition(name: str, description: str, properties: dict[str, Any], required: list[str] | None = None) -> dict[str, Any]:
    return {
        "type": "function",
        "function": {
            "name": name,
            "description": description,
            "parameters": {
                "type": "object",
                "properties": properties,
                "required": required or [],
                "additionalProperties": False,
            },
        },
    }


def ordinary_tools() -> list[dict[str, Any]]:
    return [
        _tool_definition("list_files", "List visible workspace files below a relative directory.", {"path": {"type": "string"}}),
        _tool_definition("read_file", "Read one UTF-8 workspace file by relative path.", {"path": {"type": "string"}}, ["path"]),
        _tool_definition("write_file", "Write one UTF-8 file within an allowed source directory.", {"path": {"type": "string"}, "content": {"type": "string"}}, ["path", "content"]),
        _tool_definition(
            "replace_text",
            "Replace one exact UTF-8 text fragment in a writable workspace file. The old text must occur exactly once.",
            {"path": {"type": "string"}, "old_text": {"type": "string"}, "new_text": {"type": "string"}},
            ["path", "old_text", "new_text"],
        ),
        _tool_definition("run_verification", "Run the trusted project verification. It accepts no arbitrary command.", {}),
    ]


def canonical_information_tools() -> list[dict[str, Any]]:
    return [
        _tool_definition(
            "project_predecessor_context",
            "Read the bounded index of predecessor project evidence. It may be called once when prior evidence would materially change the plan.",
            {},
        ),
        _tool_definition(
            "project_predecessor_detail",
            "Expand one predecessor record cited by the bounded index. Pass the numeric record id. It may be called once.",
            {"id": {"type": "integer"}},
            ["id"],
        ),
    ]


def agent_tools(condition: Condition, surface_profile: SurfaceProfile = "native-product") -> list[dict[str, Any]]:
    tools = ordinary_tools()
    if surface_profile == "canonical-information":
        return tools + canonical_information_tools()
    if surface_profile != "native-product":
        raise ValueError("unsupported surface profile")
    if condition == "raw-record":
        tools.append(
            _tool_definition(
                "read_predecessor_record",
                "Read one fixed predecessor record under the case evidence-size cap. It may be called once when prior evidence would materially change the plan.",
                {},
            )
        )
    if condition == "memorix-native":
        tools.append(
            _tool_definition(
                "memorix_project_context",
                "Read bounded Memorix project context for the current task. It may be called once when prior project evidence would materially change the plan.",
                {},
            )
        )
        tools.append(
            _tool_definition(
                "memorix_memory_detail",
                "Expand one memory cited by the Memorix project-context brief. Pass the numeric observation id shown after #. It may be called once.",
                {"id": {"type": "integer"}},
                ["id"],
            )
        )
    return tools


def _truncate_evidence(value: str, limit: int) -> str:
    if len(value) <= limit:
        return value
    suffix = "... [truncated by research runner]"
    if limit <= len(suffix):
        return value[:limit]
    return value[: limit - len(suffix)] + suffix


def _copy_source(source: Path, target: Path) -> None:
    ignored = shutil.ignore_patterns(".git", ".memorix", ".venv", "__pycache__", ".pytest_cache")
    shutil.copytree(source, target, ignore=ignored)


def _run(command: list[str], *, cwd: Path, timeout_seconds: int) -> subprocess.CompletedProcess[str]:
    options: dict[str, Any] = {}
    if sys.platform == "win32":
        options["creationflags"] = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    return subprocess.run(
        command,
        cwd=cwd,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=timeout_seconds,
        check=False,
        **options,
    )


def _resolve_executable(command: str) -> str:
    """Resolve npm's Windows command shim before entering the isolated runner."""
    if Path(command).is_absolute():
        return command
    located = shutil.which(command)
    if located:
        return located
    if sys.platform == "win32" and not Path(command).suffix:
        shim = shutil.which(command + ".cmd")
        if shim:
            return shim
    return command


def _initialize_git(workspace: Path) -> None:
    for command in (
        ["git", "init", "--quiet"],
        ["git", "config", "user.name", "MemorixBench"],
        ["git", "config", "user.email", "memorixbench@example.invalid"],
        ["git", "add", "--all"],
        ["git", "commit", "--quiet", "-m", "Transfer baseline"],
    ):
        completed = _run(list(command), cwd=workspace, timeout_seconds=30)
        if completed.returncode != 0:
            raise RuntimeError("unable to initialize isolated Git workspace")


class RawRecordTool:
    def __init__(self, case: CaseSpec):
        self.case = case
        self.calls = 0
        self.retrieved_chars = 0
        self.record_hashes: list[str] = []

    def read(self) -> dict[str, Any]:
        if self.calls >= 1:
            raise ValueError("read_predecessor_record may be called once per exploratory trial")
        self.calls += 1
        rendered = _truncate_evidence(self.case.predecessor_record, self.case.evidence_char_budget)
        self.retrieved_chars += len(rendered)
        record_sha256 = sha256_text(rendered)
        self.record_hashes.append(record_sha256)
        return {
            "record": rendered,
            "record_sha256": record_sha256,
            "truncated": len(rendered) < len(self.case.predecessor_record),
        }


class CanonicalEvidenceTool:
    """Give every condition the same neutral predecessor-evidence tool shape."""

    def __init__(self, case: CaseSpec, condition: Condition):
        self.case = case
        self.condition = condition
        self.context_calls = 0
        self.detail_calls = 0
        self.retrieved_chars = 0
        self.context_hashes: list[str] = []
        self.detail_hashes: list[str] = []
        self.record_available: bool | None = None

    def context(self) -> dict[str, Any]:
        if self.context_calls >= 1:
            raise ValueError("project_predecessor_context may be called once per exploratory trial")
        self.context_calls += 1
        if self.condition == "no-memory":
            records: list[dict[str, int]] = []
        else:
            records = [{"id": 1}]
        self.record_available = bool(records)
        rendered = compact_json({"records": records})
        context_sha256 = sha256_text(rendered)
        self.context_hashes.append(context_sha256)
        return {"records": records, "context_sha256": context_sha256, "truncated": False}

    def detail(self, record_id: object) -> dict[str, Any]:
        if self.detail_calls >= 1:
            raise ValueError("project_predecessor_detail may be called once per exploratory trial")
        if self.context_calls < 1:
            raise ValueError("project_predecessor_context must be called before detail")
        if not isinstance(record_id, int) or record_id != 1:
            raise ValueError("id must be the record id 1 from the predecessor index")
        self.detail_calls += 1
        if self.condition == "no-memory":
            rendered = "No predecessor evidence is available for this transfer task."
        else:
            remaining = self.case.evidence_char_budget - self.retrieved_chars
            if remaining < 1:
                raise ValueError("case evidence-size budget is exhausted")
            rendered = _truncate_evidence(self.case.predecessor_record, remaining)
            self.retrieved_chars += len(rendered)
        detail_sha256 = sha256_text(rendered)
        self.detail_hashes.append(detail_sha256)
        return {
            "detail": rendered,
            "detail_sha256": detail_sha256,
            "truncated": self.condition != "no-memory" and len(rendered) < len(self.case.predecessor_record),
        }


class MemorixContextTool:
    def __init__(self, *, config: TrialConfig, workspace: Path):
        self.config = config
        self.workspace = workspace
        self.cli = _resolve_executable(config.memorix_cli)
        self.calls = 0
        self.detail_calls = 0
        self.seed_receipt: dict[str, Any] | None = None
        self.version: str | None = None
        self.context_hashes: list[str] = []
        self.detail_hashes: list[str] = []
        self.retrieved_chars = 0
        self.formation_elapsed_ms: int | None = None
        self.codegraph_refresh_receipt: dict[str, object] | None = None
        self.codegraph_refresh_elapsed_ms: int | None = None
        self.transfer_prepared = False
        self.seed_observation_id: int | None = None
        self.context_includes_seed: bool | None = None
        self.detail_delivered = False
        self.backend_context_audit: str | None = None

    def _bounded_evidence(self, rendered: str) -> tuple[str, bool]:
        remaining = self.config.case.evidence_char_budget - self.retrieved_chars
        if remaining < 1:
            raise ValueError("case evidence-size budget is exhausted")
        bounded = _truncate_evidence(rendered, remaining)
        self.retrieved_chars += len(bounded)
        return bounded, len(bounded) < len(rendered)

    def seed(self) -> None:
        started = time.monotonic()
        version_probe = _run(
            [self.cli, "--version"],
            cwd=self.workspace,
            timeout_seconds=30,
        )
        if version_probe.returncode != 0:
            raise RuntimeError("Memorix version probe failed")
        self.version = version_probe.stdout.strip() or None
        command = [
            self.cli,
            "memory",
            "store",
            "--text",
            self.config.case.predecessor_record,
            "--title",
            f"Research precursor: {self.config.case.title}",
            "--type",
            self.config.case.predecessor_observation_type,
        ]
        if self.config.case.predecessor_files:
            command.extend(["--files", ",".join(self.config.case.predecessor_files)])
        if self.config.case.predecessor_concepts:
            command.extend(["--concepts", ",".join(self.config.case.predecessor_concepts)])
        command.extend(["--cwd", str(self.workspace), "--json"])
        completed = _run(
            command,
            cwd=self.workspace,
            timeout_seconds=self.config.memorix_timeout_seconds,
        )
        self.seed_receipt = {
            "returncode": completed.returncode,
            "stdout_sha256": sha256_text(completed.stdout),
            "stderr_sha256": sha256_text(completed.stderr),
        }
        if completed.returncode != 0:
            raise RuntimeError("Memorix precursor formation failed")
        try:
            stored = json.loads(completed.stdout)
        except json.JSONDecodeError:
            stored = None
        if isinstance(stored, dict) and isinstance(stored.get("observation"), dict):
            observation_id = stored["observation"].get("id")
            if isinstance(observation_id, int) and observation_id > 0:
                self.seed_observation_id = observation_id
        self.formation_elapsed_ms = round((time.monotonic() - started) * 1000)

    def prepare_transfer(self) -> None:
        """Finish the normal CodeGraph lifecycle before a fresh agent receives context."""
        if self.seed_receipt is None:
            raise RuntimeError("Memorix transfer preparation requires a completed seed")
        if self.transfer_prepared:
            raise ValueError("Memorix transfer preparation may run once per exploratory trial")
        started = time.monotonic()
        completed = _run(
            [self.cli, "codegraph", "refresh", "--cwd", str(self.workspace), "--json"],
            cwd=self.workspace,
            timeout_seconds=self.config.memorix_timeout_seconds,
        )
        self.codegraph_refresh_receipt = {
            "returncode": completed.returncode,
            "stdout_sha256": sha256_text(completed.stdout),
            "stderr_sha256": sha256_text(completed.stderr),
        }
        self.codegraph_refresh_elapsed_ms = round((time.monotonic() - started) * 1000)
        if completed.returncode != 0:
            raise RuntimeError("Memorix CodeGraph refresh failed")
        self.transfer_prepared = True

    def context(self) -> dict[str, Any]:
        if self.calls >= 1:
            raise ValueError("memorix_project_context may be called once per exploratory trial")
        if not self.transfer_prepared:
            raise RuntimeError("Memorix transfer preparation must finish before project context")
        self.calls += 1
        completed = _run(
            [
                self.cli,
                "context",
                self.config.case.task,
                "--cwd",
                str(self.workspace),
                "--json",
            ],
            cwd=self.workspace,
            timeout_seconds=self.config.memorix_timeout_seconds,
        )
        if completed.returncode != 0:
            raise RuntimeError("Memorix project context failed")
        try:
            payload = json.loads(completed.stdout)
        except json.JSONDecodeError as error:
            raise RuntimeError("Memorix project context returned invalid JSON") from error
        self.context_includes_seed = _workset_includes_observation(payload, self.seed_observation_id)
        self.backend_context_audit = _native_context_prompt(payload)
        records = [{"id": 1}] if self.context_includes_seed else []
        rendered = compact_json({"records": records})
        truncated = False
        context_sha256 = sha256_text(rendered)
        self.context_hashes.append(context_sha256)
        return {"records": records, "context_sha256": context_sha256, "truncated": truncated}

    def detail(self, observation_id: object) -> dict[str, Any]:
        if self.detail_calls >= 1:
            raise ValueError("memorix_memory_detail may be called once per exploratory trial")
        if not isinstance(observation_id, int) or observation_id != 1:
            raise ValueError("id must be the record id 1 from the predecessor index")
        if self.context_includes_seed is not True or self.seed_observation_id is None:
            raise ValueError("the native predecessor index did not list an expandable record")
        self.detail_calls += 1
        completed = _run(
            [
                self.cli,
                "memory",
                "detail",
                "--id",
                str(self.seed_observation_id),
                "--cwd",
                str(self.workspace),
                "--json",
            ],
            cwd=self.workspace,
            timeout_seconds=self.config.memorix_timeout_seconds,
        )
        if completed.returncode != 0:
            raise RuntimeError("Memorix memory detail failed")
        try:
            payload = json.loads(completed.stdout)
        except json.JSONDecodeError as error:
            raise RuntimeError("Memorix memory detail returned invalid JSON") from error
        rendered, truncated = self._bounded_evidence(_native_memory_detail(payload))
        detail_sha256 = sha256_text(rendered)
        self.detail_hashes.append(detail_sha256)
        self.detail_delivered = True
        return {"detail": rendered, "detail_sha256": detail_sha256, "truncated": truncated}


def _native_context_prompt(payload: object) -> str:
    """Expose the same bounded agent brief, never the operator JSON envelope."""
    if isinstance(payload, dict):
        workset = payload.get("workset")
        if isinstance(workset, dict):
            prompt = workset.get("prompt")
            if isinstance(prompt, str) and prompt.strip():
                return prompt.strip()
        prompt = payload.get("prompt")
        if isinstance(prompt, str) and prompt.strip():
            return prompt.strip()
    raise RuntimeError("Memorix project context has no bounded agent prompt")


def _native_memory_detail(payload: object) -> str:
    """Retain agent-relevant fields and remove operator-only project metadata."""
    if not isinstance(payload, dict) or not isinstance(payload.get("documents"), list):
        raise RuntimeError("Memorix memory detail has no documents")
    allowed_fields = ("id", "observationId", "type", "title", "narrative", "facts", "filesModified", "concepts", "status")
    documents: list[dict[str, object]] = []
    for document in payload["documents"]:
        if not isinstance(document, dict):
            continue
        cleaned = {field: document[field] for field in allowed_fields if document.get(field) not in (None, "")}
        if cleaned:
            documents.append(cleaned)
    if not documents:
        raise RuntimeError("Memorix memory detail has no usable document")
    return compact_json({"documents": documents})


def _workset_includes_observation(payload: object, observation_id: int | None) -> bool | None:
    if observation_id is None:
        return None
    if not isinstance(payload, dict) or not isinstance(payload.get("workset"), dict):
        return False
    workset = payload["workset"]
    for field in ("reliableMemory", "cautionMemory"):
        values = workset.get(field)
        if isinstance(values, list) and any(
            isinstance(item, dict) and item.get("id") == observation_id for item in values
        ):
            return True
    evidence_ids = workset.get("evidenceIds")
    return isinstance(evidence_ids, list) and f"memory:{observation_id}" in evidence_ids


def _messages(case: CaseSpec, evidence_policy: EvidencePolicy = "optional") -> list[dict[str, str]]:
    system = (
        "You are a coding agent working in an isolated project. Use the supplied tools to inspect, edit, and verify the current checkout. "
        "Do not claim a change is complete until the trusted verification passes. If trusted verification fails, use the remaining steps to diagnose, "
        "make an allowed source edit when a repair is available, and verify again. Do not stop solely because verification failed. "
        "You have no shell, network, process, or host-file access beyond these tools."
    )
    if evidence_policy == "fixed-index":
        system += (
            " Before your first source edit, call project_predecessor_context once. "
            "If its index lists a numbered record, call project_predecessor_detail once for that listed record before your first source edit. "
            "This neutral evidence policy applies to every study condition; an empty index is an explicit empty result."
        )
    return [{"role": "system", "content": system}, {"role": "user", "content": case.task}]


def _fixed_index_violation(
    canonical_tool: CanonicalEvidenceTool | None,
    memory_tool: MemorixContextTool | None,
) -> str | None:
    context_calls = canonical_tool.context_calls if canonical_tool is not None else (memory_tool.calls if memory_tool else 0)
    detail_calls = canonical_tool.detail_calls if canonical_tool is not None else (memory_tool.detail_calls if memory_tool else 0)
    if context_calls != 1:
        return "predecessor index was not called exactly once"
    record_available = canonical_tool.record_available if canonical_tool is not None else (
        memory_tool.context_includes_seed if memory_tool else None
    )
    if record_available is None:
        return "predecessor index delivery could not be audited"
    if record_available and detail_calls != 1:
        return "listed predecessor record was not expanded exactly once"
    return None


def _termination_reason(
    *,
    invalid_reason: str | None,
    final_verification_passed: bool,
    assistant_finished: bool,
    agent_verification_results: list[bool],
) -> str:
    if invalid_reason == "tool-step-limit":
        return "tool-step-budget-exhausted"
    if invalid_reason:
        return "invalid-run"
    if final_verification_passed:
        return "verification-passed"
    if assistant_finished and any(not passed for passed in agent_verification_results):
        return "assistant-stopped-after-failed-verification"
    if assistant_finished:
        return "assistant-stopped-before-passing-verification"
    return "runner-ended-without-passing-verification"


def _assistant_wire(reply: ModelReply) -> dict[str, Any]:
    payload: dict[str, Any] = {"role": "assistant", "content": reply.content}
    if reply.tool_calls:
        payload["tool_calls"] = [
            {
                "id": call.call_id,
                "type": "function",
                "function": {"name": call.name, "arguments": compact_json(call.arguments)},
            }
            for call in reply.tool_calls
        ]
    return payload


def _receipt_path(root: Path, run_id: str) -> Path:
    return root / "receipts" / f"{run_id}.json"


def _runner_source_tree_sha256() -> str:
    """Fingerprint the executable study surface without recording a local path."""
    return sha256_tree(Path(__file__).resolve().parents[2])


def run_trial(config: TrialConfig, client: AgentClient) -> dict[str, Any]:
    if config.max_steps < 1 or config.max_steps > 80:
        raise ValueError("max_steps must be between 1 and 80")
    if config.surface_profile not in {"native-product", "canonical-information"}:
        raise ValueError("unsupported surface profile")
    if config.evidence_policy not in {"optional", "fixed-index"}:
        raise ValueError("unsupported evidence policy")
    if config.evidence_policy == "fixed-index" and config.surface_profile != "canonical-information":
        raise ValueError("fixed-index policy requires the canonical-information profile")
    run_id = f"exploratory-{config.case.case_id}-{uuid4().hex[:12]}"
    artifact_root = config.artifact_root.resolve()
    workspace = artifact_root / "workspaces" / run_id
    receipt_path = _receipt_path(artifact_root, run_id)
    receipt_path.parent.mkdir(parents=True, exist_ok=True)
    if workspace.exists():
        raise RuntimeError("trial workspace collision")
    _copy_source(config.case.source_root, workspace)
    _initialize_git(workspace)
    sandbox = ToolSandbox(workspace, config.case.writable_paths, config.oracle)
    raw_record_tool = RawRecordTool(config.case) if config.surface_profile == "native-product" and config.condition == "raw-record" else None
    canonical_tool = CanonicalEvidenceTool(config.case, config.condition) if config.surface_profile == "canonical-information" and config.condition != "memorix-native" else None
    memory_tool = MemorixContextTool(config=config, workspace=workspace) if config.condition == "memorix-native" else None
    tool_definitions = agent_tools(config.condition, config.surface_profile)
    tool_schema_sha256 = sha256_text(compact_json(tool_definitions))
    start_hash = sha256_tree(workspace)
    messages: list[dict[str, Any]] = _messages(config.case, config.evidence_policy)
    actual_models: list[str] = []
    response_ids: list[str] = []
    input_tokens = 0
    output_tokens = 0
    costs: list[float] = []
    final_sha256: str | None = None
    invalid_reason: str | None = None
    failure_stage = "setup"
    transfer_started: float | None = None
    policy_violations: list[str] = []
    evidence_payload_events: list[dict[str, Any]] = []
    agent_turn_count = 0
    assistant_finished = False
    agent_ordinary_tool_sequence: list[str] = []
    agent_verification_results: list[bool] = []
    source_edit_attempted = False
    source_edit_succeeded = False
    try:
        if memory_tool is not None:
            failure_stage = "memory-seed"
            memory_tool.seed()
            failure_stage = "memory-codegraph-refresh"
            memory_tool.prepare_transfer()
        transfer_started = time.monotonic()
        for _step in range(config.max_steps):
            failure_stage = "provider-chat"
            reply = client.chat(messages, tool_definitions)
            agent_turn_count += 1
            if reply.model:
                actual_models.append(reply.model)
            if reply.response_id:
                response_ids.append(reply.response_id)
            input_tokens += reply.input_tokens or 0
            output_tokens += reply.output_tokens or 0
            if reply.cost_usd is not None:
                costs.append(reply.cost_usd)
            messages.append(_assistant_wire(reply))
            if not reply.tool_calls:
                final_sha256 = sha256_text(reply.content or "")
                assistant_finished = True
                break
            for call in reply.tool_calls:
                if call.name in {"list_files", "read_file", "write_file", "replace_text", "run_verification"}:
                    agent_ordinary_tool_sequence.append(call.name)
                if call.name in {"write_file", "replace_text"}:
                    source_edit_attempted = True
                try:
                    failure_stage = f"tool:{call.name}"
                    if call.name == "read_predecessor_record":
                        if raw_record_tool is None:
                            raise ValueError("tool is not available")
                        result = raw_record_tool.read()
                    elif call.name == "project_predecessor_context":
                        if config.condition == "memorix-native":
                            if memory_tool is None:
                                raise ValueError("tool is not available")
                            result = memory_tool.context()
                        else:
                            if canonical_tool is None:
                                raise ValueError("tool is not available")
                            result = canonical_tool.context()
                    elif call.name == "project_predecessor_detail":
                        if config.condition == "memorix-native":
                            if memory_tool is None:
                                raise ValueError("tool is not available")
                            result = memory_tool.detail(call.arguments.get("id"))
                        else:
                            if canonical_tool is None:
                                raise ValueError("tool is not available")
                            result = canonical_tool.detail(call.arguments.get("id"))
                    elif call.name == "memorix_project_context":
                        if memory_tool is None:
                            raise ValueError("tool is not available")
                        result = memory_tool.context()
                    elif call.name == "memorix_memory_detail":
                        if memory_tool is None:
                            raise ValueError("tool is not available")
                        result = memory_tool.detail(call.arguments.get("id"))
                    elif call.name in {"list_files", "read_file", "write_file", "replace_text", "run_verification"}:
                        if config.evidence_policy == "fixed-index" and call.name in {"write_file", "replace_text"}:
                            violation = _fixed_index_violation(canonical_tool, memory_tool)
                            if violation:
                                if violation not in policy_violations:
                                    policy_violations.append(violation)
                                result = {"error": "fixed-index policy requires predecessor evidence before source edits"}
                            else:
                                result = sandbox.dispatch(call.name, call.arguments)
                        else:
                            result = sandbox.dispatch(call.name, call.arguments)
                    else:
                        raise ValueError("tool is not available")
                except RuntimeError:
                    # A native-memory failure is an infrastructure failure, not a
                    # disguised no-memory task outcome.
                    raise
                except ValueError as error:
                    result = {"error": str(error)}
                if call.name == "run_verification":
                    agent_verification_results.append(bool(result.get("passed")))
                if call.name in {"write_file", "replace_text"} and (result.get("written") or result.get("replaced")):
                    source_edit_succeeded = True
                if call.name in {
                    "read_predecessor_record",
                    "project_predecessor_context",
                    "project_predecessor_detail",
                    "memorix_project_context",
                    "memorix_memory_detail",
                }:
                    event: dict[str, Any] = {
                        "sequence": len(evidence_payload_events) + 1,
                        "recorded_at": datetime.now(timezone.utc).isoformat(),
                        "tool": call.name,
                        "result": result,
                    }
                    if call.name == "project_predecessor_context" and memory_tool is not None:
                        event["native_backend_context"] = memory_tool.backend_context_audit
                    evidence_payload_events.append(event)
                messages.append({"role": "tool", "tool_call_id": call.call_id, "content": compact_json(result)})
        else:
            invalid_reason = "tool-step-limit"
    except Exception as error:  # The receipt must preserve infrastructure failures.
        invalid_reason = f"infrastructure:{failure_stage}:{type(error).__name__}"

    policy_context_calls = canonical_tool.context_calls if canonical_tool is not None else (memory_tool.calls if memory_tool else 0)
    policy_detail_calls = canonical_tool.detail_calls if canonical_tool is not None else (memory_tool.detail_calls if memory_tool else 0)
    policy_record_available = canonical_tool.record_available if canonical_tool is not None else (
        memory_tool.context_includes_seed if memory_tool else None
    )
    if config.evidence_policy == "fixed-index":
        violation = _fixed_index_violation(canonical_tool, memory_tool)
        if violation and violation not in policy_violations:
            policy_violations.append(violation)
        if policy_violations and invalid_reason is None:
            invalid_reason = "policy:" + policy_violations[0]

    final_verification = sandbox.run_verification({})
    status = "invalid" if invalid_reason else "completed"
    source_tree_after_hash = sha256_tree(workspace)
    termination_reason = _termination_reason(
        invalid_reason=invalid_reason,
        final_verification_passed=bool(final_verification["passed"]),
        assistant_finished=assistant_finished,
        agent_verification_results=agent_verification_results,
    )
    evidence_tool_calls = (
        canonical_tool.context_calls + canonical_tool.detail_calls
        if canonical_tool is not None
        else (raw_record_tool.calls if raw_record_tool is not None else (memory_tool.calls + memory_tool.detail_calls if memory_tool else 0))
    )
    evidence_chars_retrieved = (
        canonical_tool.retrieved_chars
        if canonical_tool is not None
        else (raw_record_tool.retrieved_chars if raw_record_tool is not None else (memory_tool.retrieved_chars if memory_tool else 0))
    )
    evidence_sidecar = {
        "schema_version": "exploratory-evidence-payload-v1",
        "run_id": run_id,
        "case_id": config.case.case_id,
        "condition": config.condition,
        "surface_profile": config.surface_profile,
        "evidence_policy": config.evidence_policy,
        "system_prompt_sha256": sha256_text(messages[0]["content"]),
        "events": evidence_payload_events,
    }
    evidence_serialized = json.dumps(evidence_sidecar, indent=2, ensure_ascii=True) + "\n"
    evidence_path = artifact_root / "evidence-payloads" / f"{run_id}.json"
    evidence_path.parent.mkdir(parents=True, exist_ok=True)
    # The digest is calculated from this exact UTF-8 representation. Text-mode
    # writes would translate newlines on Windows and make the receipt unverifiable.
    evidence_path.write_bytes(evidence_serialized.encode("utf-8"))
    payload = {
        "schema_version": "exploratory-sealed-local-v2",
        "evidence_tier": "exploratory-sealed-local",
        "runner": {
            "protocol_version": PROTOCOL_VERSION,
            "source_tree_sha256": _runner_source_tree_sha256(),
        },
        "run_id": run_id,
        "case_id": config.case.case_id,
        "condition": config.condition,
        "surface_profile": config.surface_profile,
        "evidence_policy": {
            "mode": config.evidence_policy,
            "context_calls": policy_context_calls,
            "detail_calls": policy_detail_calls,
            "index_record_available": policy_record_available,
            "system_prompt_sha256": sha256_text(messages[0]["content"]),
            "compliant": None if config.evidence_policy == "optional" else not policy_violations,
            "violations": policy_violations,
        },
        "tool_schema_sha256": tool_schema_sha256,
        "requested_model": config.requested_model,
        "actual_models": sorted(set(actual_models)),
        "response_id_sha256": [sha256_text(value) for value in response_ids],
        "status": status,
        "invalid_reason": invalid_reason,
        "task_success": final_verification["passed"] if status == "completed" else None,
        "verification": {"passed": final_verification["passed"]},
        "resource_usage": {
            "input_tokens": input_tokens or None,
            "output_tokens": output_tokens or None,
            "cost_usd": sum(costs) if costs else None,
            "transfer_elapsed_ms": round((time.monotonic() - transfer_started) * 1000) if transfer_started is not None else None,
            "tool_call_count": len(agent_ordinary_tool_sequence) + evidence_tool_calls,
            "ordinary_tool_call_count": len(agent_ordinary_tool_sequence),
            "trusted_final_verification_count": 1,
            "evidence_tool_call_count": evidence_tool_calls,
            "evidence_chars_retrieved": evidence_chars_retrieved,
            "memory_context_calls": memory_tool.calls if memory_tool else 0,
            "memory_detail_calls": memory_tool.detail_calls if memory_tool else 0,
            "raw_record_calls": raw_record_tool.calls if raw_record_tool else 0,
            "canonical_context_calls": canonical_tool.context_calls if canonical_tool else 0,
            "canonical_detail_calls": canonical_tool.detail_calls if canonical_tool else 0,
        },
        "case": {
            "class": config.case.case_class,
            "tier": config.case.case_tier,
            "evidence_char_budget": config.case.evidence_char_budget,
            "source_tree_before_sha256": start_hash,
            "source_tree_after_sha256": source_tree_after_hash,
            "predecessor_record_sha256": sha256_text(config.case.predecessor_record),
            "predecessor_memory": {
                "type": config.case.predecessor_observation_type,
                "files_sha256": sha256_text(compact_json(list(config.case.predecessor_files))),
                "concepts_sha256": sha256_text(compact_json(list(config.case.predecessor_concepts))),
            },
            "task_sha256": sha256_text(config.case.task),
            "oracle_definition_sha256": config.oracle.definition_sha256,
        },
        "memorix_formation": (
            {
                "cli_version": memory_tool.version,
                "seed": memory_tool.seed_receipt,
                "codegraph_refresh": memory_tool.codegraph_refresh_receipt,
                "context_sha256": memory_tool.context_hashes,
                "detail_sha256": memory_tool.detail_hashes,
                "retrieved_chars": memory_tool.retrieved_chars,
                "formation_elapsed_ms": memory_tool.formation_elapsed_ms,
                "codegraph_refresh_elapsed_ms": memory_tool.codegraph_refresh_elapsed_ms,
                "seed_observation_id_sha256": (
                    sha256_text(str(memory_tool.seed_observation_id))
                    if memory_tool.seed_observation_id is not None
                    else None
                ),
                "context_includes_seed": memory_tool.context_includes_seed,
                "detail_delivered": memory_tool.detail_delivered,
            }
            if memory_tool
            else None
        ),
        "raw_record": (
            {
                "record_sha256": raw_record_tool.record_hashes,
                "retrieved_chars": raw_record_tool.retrieved_chars,
            }
            if raw_record_tool
            else None
        ),
        "canonical_evidence": (
            {
                "context_sha256": canonical_tool.context_hashes,
                "detail_sha256": canonical_tool.detail_hashes,
                "retrieved_chars": canonical_tool.retrieved_chars,
            }
            if canonical_tool
            else None
        ),
        "agent_action": {
            "turn_count": agent_turn_count,
            "max_steps": config.max_steps,
            "ordinary_tool_sequence": agent_ordinary_tool_sequence,
            "source_edit_attempted": source_edit_attempted,
            "source_edit_succeeded": source_edit_succeeded,
            "source_changed": start_hash != source_tree_after_hash,
            "agent_verification_call_count": len(agent_verification_results),
            "agent_verification_failure_count": sum(not passed for passed in agent_verification_results),
            "termination_reason": termination_reason,
        },
        "tool_events": sandbox.event_payload(),
        "evidence_payload_sha256": sha256_text(evidence_serialized),
        "final_response_sha256": final_sha256,
        "finished_at": datetime.now(timezone.utc).isoformat(),
    }
    receipt_path.write_text(json.dumps(payload, indent=2, ensure_ascii=True) + "\n", encoding="utf-8")
    return {"receipt_path": receipt_path, "evidence_path": evidence_path, "payload": payload}
