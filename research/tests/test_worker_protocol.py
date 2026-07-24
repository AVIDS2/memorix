import json
from dataclasses import replace
from pathlib import Path
import memorixbench.worker_protocol as worker_protocol
import subprocess

import pytest

from memorixbench.worker_protocol import (
    WorkerProtocolError,
    create_worker_job,
    load_worker_job,
    workspace_snapshot_hash,
    write_worker_job,
)
from memorixbench.agents import AgentExecution
from memorixbench.actions import write_action_ledger


def _workspace(tmp_path: Path) -> Path:
    workspace = tmp_path / "workspace"
    workspace.mkdir(parents=True)
    subprocess.run(["git", "init", "--quiet"], cwd=workspace, check=True)
    subprocess.run(["git", "config", "user.name", "MemorixBench Test"], cwd=workspace, check=True)
    subprocess.run(["git", "config", "user.email", "test@example.invalid"], cwd=workspace, check=True)
    (workspace / "value.txt").write_text("transfer\n", encoding="utf-8")
    subprocess.run(["git", "add", "value.txt"], cwd=workspace, check=True)
    subprocess.run(["git", "commit", "--quiet", "-m", "transfer"], cwd=workspace, check=True)
    return workspace


def test_worker_job_has_only_public_committed_inputs(tmp_path: Path) -> None:
    workspace = _workspace(tmp_path)

    job = create_worker_job(
        run_id="run-1",
        case_id="case-1",
        condition="no-memory",
        agent="claude",
        model="fixed-model",
        prompt="Repair the transfer task.",
        public_case_definition_sha256="a" * 64,
        public_bundle_sha256="b" * 64,
        memory_snapshot_sha256="c" * 64,
        subject_protocol_sha256="d" * 64,
        controller_policy_sha256="e" * 64,
        job_nonce="f" * 32,
        workspace=workspace,
        timeout_seconds=60,
        max_budget_usd=1.0,
        allowed_tools=("Read", "Edit"),
    )
    job_path = write_worker_job(job, tmp_path / "job.json")
    loaded = load_worker_job(job_path)

    assert loaded == job
    assert "private_oracle_root" not in json.dumps(loaded.public_payload())
    assert len(job.job_sha256) == 64
    assert workspace_snapshot_hash(workspace) == job.workspace_snapshot_sha256


def test_worker_job_hash_binds_controller_provided_bundle_inputs(tmp_path: Path) -> None:
    workspace = _workspace(tmp_path)
    job = create_worker_job(
        run_id="run-1",
        case_id="case-1",
        condition="no-memory",
        agent="claude",
        model="fixed-model",
        prompt="Repair the transfer task.",
        public_case_definition_sha256="a" * 64,
        public_bundle_sha256="b" * 64,
        memory_snapshot_sha256="c" * 64,
        subject_protocol_sha256="d" * 64,
        controller_policy_sha256="e" * 64,
        job_nonce="f" * 32,
        workspace=workspace,
        timeout_seconds=60,
        max_budget_usd=1.0,
    )

    assert replace(job, memory_snapshot_sha256="1" * 64).job_sha256 != job.job_sha256
    assert replace(job, public_bundle_sha256="2" * 64).job_sha256 != job.job_sha256
    assert replace(job, job_nonce="3" * 32).job_sha256 != job.job_sha256


def test_worker_job_rejects_private_fields_and_prompt_tampering(tmp_path: Path) -> None:
    workspace = _workspace(tmp_path)
    job = create_worker_job(
        run_id="run-1",
        case_id="case-1",
        condition="no-memory",
        agent="codex",
        model=None,
        prompt="Repair the transfer task.",
        public_case_definition_sha256="a" * 64,
        public_bundle_sha256="b" * 64,
        memory_snapshot_sha256="c" * 64,
        subject_protocol_sha256="d" * 64,
        controller_policy_sha256="e" * 64,
        job_nonce="f" * 32,
        workspace=workspace,
        timeout_seconds=60,
        max_budget_usd=None,
    )
    payload = job.public_payload()
    payload["private_oracle_root"] = "C:/private"
    private_path = tmp_path / "private.json"
    private_path.write_text(json.dumps(payload), encoding="utf-8")
    with pytest.raises(WorkerProtocolError, match="private-oracle"):
        load_worker_job(private_path)

    payload = job.public_payload()
    payload["prompt"] = "tampered"
    tampered = tmp_path / "tampered.json"
    tampered.write_text(json.dumps(payload), encoding="utf-8")
    with pytest.raises(WorkerProtocolError, match="prompt commitment"):
        load_worker_job(tampered)


def test_worker_snapshot_rejects_dirty_public_workspace(tmp_path: Path) -> None:
    workspace = _workspace(tmp_path)
    (workspace / "value.txt").write_text("dirty\n", encoding="utf-8")

    with pytest.raises(WorkerProtocolError, match="start clean"):
        workspace_snapshot_hash(workspace)


def test_worker_snapshot_is_stable_across_distinct_commit_metadata(tmp_path: Path) -> None:
    first = _workspace(tmp_path / "first")
    second = _workspace(tmp_path / "second")

    assert workspace_snapshot_hash(first) == workspace_snapshot_hash(second)


def test_worker_snapshot_rejects_ignored_workspace_files(tmp_path: Path) -> None:
    workspace = _workspace(tmp_path)
    (workspace / ".gitignore").write_text("ignored.txt\n", encoding="utf-8")
    subprocess.run(["git", "add", ".gitignore"], cwd=workspace, check=True)
    subprocess.run(["git", "commit", "--quiet", "-m", "ignore local artifact"], cwd=workspace, check=True)
    (workspace / "ignored.txt").write_text("not part of the source tree\n", encoding="utf-8")

    with pytest.raises(WorkerProtocolError, match="including ignored files"):
        workspace_snapshot_hash(workspace)


def test_worker_snapshot_rejects_linked_worktree_git_metadata(tmp_path: Path) -> None:
    workspace = _workspace(tmp_path)
    (workspace / ".git").rename(workspace / ".git-directory")
    (workspace / ".git").write_text("gitdir: ../external/.git\n", encoding="utf-8")

    with pytest.raises(WorkerProtocolError, match="regular .git directory"):
        workspace_snapshot_hash(workspace)


def test_worker_patch_includes_staged_changes_against_the_initial_head(tmp_path: Path) -> None:
    workspace = _workspace(tmp_path)
    initial_head = worker_protocol._workspace_head(workspace)
    (workspace / "value.txt").write_text("staged change\n", encoding="utf-8")
    subprocess.run(["git", "add", "value.txt"], cwd=workspace, check=True)

    sealed, final_tree = worker_protocol._capture_workspace_patch(
        workspace,
        tmp_path / "sealed.patch",
        expected_head=initial_head,
    )

    assert "+staged change" in sealed.path.read_text(encoding="utf-8")
    assert len(final_tree) == 64


def test_worker_patch_rejects_ignored_residue_or_a_changed_head(tmp_path: Path) -> None:
    ignored_workspace = _workspace(tmp_path / "ignored")
    (ignored_workspace / ".gitignore").write_text("agent-cache/\n", encoding="utf-8")
    subprocess.run(["git", "add", ".gitignore"], cwd=ignored_workspace, check=True)
    subprocess.run(["git", "commit", "--quiet", "-m", "ignore cache"], cwd=ignored_workspace, check=True)
    ignored_head = worker_protocol._workspace_head(ignored_workspace)
    (ignored_workspace / "agent-cache").mkdir()
    (ignored_workspace / "agent-cache" / "state.txt").write_text("leak\n", encoding="utf-8")

    with pytest.raises(WorkerProtocolError, match="ignored files"):
        worker_protocol._capture_workspace_patch(
            ignored_workspace,
            tmp_path / "ignored.patch",
            expected_head=ignored_head,
        )

    committed_workspace = _workspace(tmp_path / "committed")
    original_head = worker_protocol._workspace_head(committed_workspace)
    (committed_workspace / "value.txt").write_text("committed change\n", encoding="utf-8")
    subprocess.run(["git", "add", "value.txt"], cwd=committed_workspace, check=True)
    subprocess.run(["git", "commit", "--quiet", "-m", "agent commit"], cwd=committed_workspace, check=True)

    with pytest.raises(WorkerProtocolError, match="Git HEAD"):
        worker_protocol._capture_workspace_patch(
            committed_workspace,
            tmp_path / "committed.patch",
            expected_head=original_head,
        )


def test_vault_reconstructs_a_sealed_patch_to_the_worker_final_tree(tmp_path: Path) -> None:
    worker_workspace = _workspace(tmp_path / "worker")
    baseline = workspace_snapshot_hash(worker_workspace)
    worker_head = worker_protocol._workspace_head(worker_workspace)
    (worker_workspace / "value.txt").write_text("worker final\n", encoding="utf-8")
    sealed, worker_final = worker_protocol._capture_workspace_patch(
        worker_workspace,
        tmp_path / "sealed.patch",
        expected_head=worker_head,
    )
    vault_workspace = _workspace(tmp_path / "vault")

    assert worker_protocol.reconstruct_sealed_patch_in_vault(
        workspace=vault_workspace,
        worker_patch=sealed,
        expected_workspace_snapshot_sha256=baseline,
        expected_final_workspace_sha256=worker_final,
    ) == worker_final

    retry_workspace = _workspace(tmp_path / "vault-tampered")
    with pytest.raises(WorkerProtocolError, match="expected final tree"):
        worker_protocol.reconstruct_sealed_patch_in_vault(
            workspace=retry_workspace,
            worker_patch=sealed,
            expected_workspace_snapshot_sha256=baseline,
            expected_final_workspace_sha256="0" * 64,
        )


def test_worker_snapshot_rejects_a_reparse_workspace_root(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    workspace = _workspace(tmp_path)
    original = worker_protocol._is_reparse_point

    def root_only(path: Path) -> bool:
        return path.resolve() == workspace.resolve() or original(path)

    monkeypatch.setattr(worker_protocol, "_is_reparse_point", root_only)
    with pytest.raises(WorkerProtocolError, match="workspace root"):
        workspace_snapshot_hash(workspace)


def test_worker_result_does_not_export_raw_agent_artifacts(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    workspace = _workspace(tmp_path)
    job = create_worker_job(
        run_id="run-1",
        case_id="case-1",
        condition="no-memory",
        agent="codex",
        model=None,
        prompt="Repair the transfer task.",
        public_case_definition_sha256="a" * 64,
        public_bundle_sha256="b" * 64,
        memory_snapshot_sha256="c" * 64,
        subject_protocol_sha256="d" * 64,
        controller_policy_sha256="e" * 64,
        job_nonce="f" * 32,
        workspace=workspace,
        timeout_seconds=60,
        max_budget_usd=None,
    )

    def fake_run_agent(**kwargs: object) -> AgentExecution:
        artifact_dir = Path(str(kwargs["artifact_dir"]))
        artifact_dir.mkdir(parents=True, exist_ok=True)
        (artifact_dir / "events.jsonl").write_text("secret raw event\n", encoding="utf-8")
        (workspace / "value.txt").write_text("changed\n", encoding="utf-8")
        timeline = artifact_dir / "timeline.jsonl"
        timeline.write_text("", encoding="utf-8")
        ledger = write_action_ledger(
            agent="codex",
            timeline_path=timeline,
            path=artifact_dir / "action-ledger.json",
        )
        empty = artifact_dir / "empty"
        empty.write_text("", encoding="utf-8")
        return AgentExecution(
            agent="codex",
            model=None,
            reported_models=(),
            model_usage=(),
            returncode=0,
            timed_out=False,
            completed=True,
            failure_reason=None,
            wall_seconds=0.1,
            input_tokens=None,
            cached_input_tokens=None,
            output_tokens=None,
            reasoning_output_tokens=None,
            cost_usd=None,
            event_count=1,
            command_count=0,
            tool_call_count=0,
            tool_names=(),
            tool_call_names=(),
            successful_tool_call_count=0,
            successful_tool_names=(),
            successful_tool_call_names=(),
            permission_denials=(),
            unavailable_tool_attempts=(),
            bash_commands=(),
            final_message="done",
            events_path=artifact_dir / "events.jsonl",
            timeline_path=timeline,
            action_ledger_path=artifact_dir / "action-ledger.json",
            action_ledger_sha256=ledger.sha256,
            action_count=0,
            action_timing_source="stream-observed-monotonic-v1",
            stderr_path=empty,
            patch_path=empty,
        )

    monkeypatch.setattr("memorixbench.worker_protocol.run_agent", fake_run_agent)
    from memorixbench.worker_protocol import run_worker_job

    output = tmp_path / "worker-output"
    result = run_worker_job(job, workspace=workspace, output_root=output)

    assert (output / "sealed.patch").is_file()
    assert (output / "worker-result.json").is_file()
    assert not (output / "agent-internal").exists()
    assert not (output.parent / "worker-output.internal").exists()
    assert len(result.action_ledger_sha256) == 64
    assert len(result.sanitized_action_ledger_sha256) == 64
    assert result.action_count == 0
    assert (output / "action-ledger.json").is_file()
    delivered_bytes = b"".join(
        path.read_bytes()
        for path in output.rglob("*")
        if path.is_file()
    )
    assert b"secret raw event" not in delivered_bytes
