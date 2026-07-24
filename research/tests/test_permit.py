from __future__ import annotations

from dataclasses import replace
from datetime import datetime, timedelta, timezone
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
from types import SimpleNamespace

import pytest

import memorixbench.permit as permit_module
import memorixbench.worker_protocol as worker_protocol
from memorixbench.attestation import (
    REMOTE_WORKER_VAULT_PROFILE_ID,
    WORKER_ATTESTATION_SCHEMA_VERSION,
    WorkerAttestation,
    WorkerIsolationSummary,
    sign_worker_attestation,
)
from memorixbench.agents import ModelUsage
from memorixbench.blackbox import SubjectProtocol
from memorixbench.model_relay import (
    MODEL_RELAY_ATTESTATION_SCHEMA_VERSION,
    ModelRelayAttestation,
    sign_model_relay_attestation,
)
from memorixbench.preflight import write_environment_preflight_receipt
from memorixbench.runtime_attestation import (
    RUNTIME_ATTESTATION_SCHEMA_VERSION,
    RuntimeAttestation,
    sign_runtime_attestation,
)
from memorixbench.runtime_measurement import (
    REQUIRED_MEASUREMENTS,
    REQUIRED_NETWORK_POLICY_ID,
    REQUIRED_SUBJECT_ISOLATION_PROFILE,
    RUNTIME_MEASUREMENT_POLICY_SCHEMA_VERSION,
    RUNTIME_MEASUREMENT_RECEIPT_SCHEMA_VERSION,
    RuntimeMeasurementEvidence,
    RuntimeMeasurementPolicy,
    RuntimeMeasurementReceipt,
)
from memorixbench.registry import CaseRegistry, CaseRegistryEntry, CaseRegistryValidation
from memorixbench.sealed_patch import seal_patch
from memorixbench.worker_protocol import (
    WORKER_JOB_SCHEMA_VERSION,
    WORKER_RESULT_SCHEMA_VERSION,
    WorkerJob,
    WorkerProtocolError,
    WorkerResult,
)


def _digest(character: str) -> str:
    return character * 64


def _measurement_policy() -> RuntimeMeasurementPolicy:
    return RuntimeMeasurementPolicy(
        schema_version=RUNTIME_MEASUREMENT_POLICY_SCHEMA_VERSION,
        policy_id="remote-kvm-runtime-v1",
        profile_id=REMOTE_WORKER_VAULT_PROFILE_ID,
        subject_isolation_profile=REQUIRED_SUBJECT_ISOLATION_PROFILE,
        network_policy_id=REQUIRED_NETWORK_POLICY_ID,
        required_measurements=REQUIRED_MEASUREMENTS,
        maximum_receipt_age_seconds=300,
    )


def _protocol() -> SubjectProtocol:
    return SubjectProtocol(
        protocol="stdio-jsonl-v1",
        isolation_profile="microvm-kvm-v1",
        adapter_image="registry.example.invalid/subject@sha256:" + _digest("1"),
        adapter_command=("/adapter/serve",),
        request_schema_sha256=_digest("2"),
        response_schema_sha256=_digest("3"),
        max_requests=3,
        max_request_bytes=1024,
        max_response_bytes=1024,
        startup_timeout_seconds=2,
        request_timeout_seconds=2,
        total_timeout_seconds=10,
    )


def _job(
    controller_policy_sha256: str = _digest("a"),
    protocol: SubjectProtocol | None = None,
) -> WorkerJob:
    protocol = protocol or _protocol()
    prompt = "Repair the public transfer task."
    return WorkerJob(
        schema_version=WORKER_JOB_SCHEMA_VERSION,
        run_id="run-001",
        case_id="case-001",
        condition="memorix-full",
        agent="claude",
        model="model-x",
        prompt=prompt,
        prompt_sha256=hashlib.sha256(prompt.encode("utf-8")).hexdigest(),
        public_case_definition_sha256=_digest("4"),
        public_bundle_sha256=_digest("8"),
        memory_snapshot_sha256=_digest("9"),
        subject_protocol_sha256=protocol.sha256,
        controller_policy_sha256=controller_policy_sha256,
        job_nonce="b" * 32,
        workspace_snapshot_sha256=_digest("5"),
        timeout_seconds=300,
        max_budget_usd=1.0,
        allowed_tools=("Read",),
        config_overrides=(),
        runtime_config_sha256=_digest("0"),
    )


def _policy(
    allowed_signers: Path,
    allowed_model_relay_signers: Path,
    allowed_runtime_attestation_signers: Path,
    runtime_measurement_policy: RuntimeMeasurementPolicy,
    protocol: SubjectProtocol,
) -> permit_module.ControllerTrustPolicy:
    ssh_keygen = Path(shutil.which("ssh-keygen") or allowed_signers).resolve()
    return permit_module.ControllerTrustPolicy(
        policy_id="test-policy",
        allowed_signers=allowed_signers,
        allowed_model_relay_signers=allowed_model_relay_signers,
        allowed_runtime_attestation_signers=allowed_runtime_attestation_signers,
        subject_protocol=protocol,
        expected_worker_runtime_sha256=_digest("a"),
        expected_agent_image="registry.example.invalid/agent@sha256:" + _digest("b"),
        expected_agent_image_id="sha256:" + _digest("c"),
        expected_tool_catalog_sha256=_digest("d"),
        expected_container_inspection_sha256=_digest("e"),
        runtime_measurement_policy=runtime_measurement_policy,
        expected_model_relay_policy_sha256=_digest("f"),
        expected_model_route_id="test-model-route",
        expected_requested_model="model-x",
        expected_actual_model="model-x",
        expected_environment_allowlist_sha256=_digest("1"),
        expected_sentinel_suite_sha256=_digest("2"),
        trusted_ssh_keygen_binary=ssh_keygen,
        trusted_ssh_keygen_sha256=hashlib.sha256(ssh_keygen.read_bytes()).hexdigest(),
    )


def test_controller_policy_requires_separate_model_relay_trust_file(tmp_path: Path) -> None:
    signers = tmp_path / "shared-signers"
    signers.write_text("test key\n", encoding="utf-8")

    with pytest.raises(permit_module.ConfirmatoryPermitError, match="separate worker"):
        _policy(signers, signers, signers, _measurement_policy(), _protocol()).validate()


@pytest.mark.skipif(shutil.which("ssh-keygen") is None, reason="OpenSSH ssh-keygen is unavailable")
def test_controller_policy_rejects_the_same_key_in_distinct_signer_files(tmp_path: Path) -> None:
    private_key = tmp_path / "shared-key"
    created = subprocess.run(
        ["ssh-keygen", "-q", "-t", "ed25519", "-N", "", "-f", str(private_key)],
        check=False,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    assert created.returncode == 0
    public_key = private_key.with_suffix(".pub").read_text(encoding="utf-8").strip()
    worker_signers = tmp_path / "worker-signers"
    relay_signers = tmp_path / "relay-signers"
    runtime_signers = tmp_path / "runtime-signers"
    worker_signers.write_text(f"worker-alpha {public_key}\n", encoding="utf-8")
    relay_signers.write_text(f"relay-alpha {public_key}\n", encoding="utf-8")
    runtime_signers.write_text(f"runtime-alpha {public_key}\n", encoding="utf-8")

    with pytest.raises(permit_module.ConfirmatoryPermitError, match="share a trust key"):
        _policy(
            worker_signers,
            relay_signers,
            runtime_signers,
            _measurement_policy(),
            _protocol(),
        ).validate()


def _worker_patch(tmp_path: Path):
    patch_path = tmp_path / "sealed.patch"
    patch_path.parent.mkdir(parents=True, exist_ok=True)
    patch_path.write_text(
        """diff --git a/value.txt b/value.txt
index df967b9..a0a6f7e 100644
--- a/value.txt
+++ b/value.txt
@@ -1 +1 @@
-old
+new
""",
        encoding="utf-8",
    )
    return seal_patch(patch_path)


def _result(job: WorkerJob, patch) -> WorkerResult:
    return WorkerResult(
        schema_version=WORKER_RESULT_SCHEMA_VERSION,
        run_id=job.run_id,
        job_sha256=job.job_sha256,
        case_id=job.case_id,
        condition=job.condition,
        agent=job.agent,
        model=job.model,
        public_bundle_sha256=job.public_bundle_sha256,
        memory_snapshot_sha256=job.memory_snapshot_sha256,
        subject_protocol_sha256=job.subject_protocol_sha256,
        controller_policy_sha256=job.controller_policy_sha256,
        job_nonce=job.job_nonce,
        workspace_snapshot_sha256=job.workspace_snapshot_sha256,
        sealed_patch_sha256=patch.sha256,
        sealed_patch_bytes=patch.byte_count,
        changed_paths=patch.changed_paths,
        agent_returncode=0,
        timed_out=False,
        completed=True,
        failure_reason=None,
        wall_seconds=1.0,
        input_tokens=None,
        cached_input_tokens=None,
        output_tokens=None,
        reasoning_output_tokens=None,
        cost_usd=None,
        reported_models=("model-x",),
        model_usage=(
            ModelUsage(
                model="model-x",
                input_tokens=2,
                cached_input_tokens=None,
                output_tokens=1,
                cost_usd=0.001,
            ),
        ),
        model_profile="single",
        event_count=0,
        command_count=0,
        tool_call_count=0,
        successful_tool_call_count=0,
        action_ledger_sha256=_digest("6"),
        sanitized_action_ledger_sha256=_digest("7"),
        action_count=0,
        action_timing_source="stream-observed-monotonic-v1",
        runtime_config_sha256=job.runtime_config_sha256,
        final_workspace_sha256=_digest("e"),
        model_request_count=1,
        provider_request_ids_sha256=_digest("f"),
    )


def _manifest(transition_sha256: str = _digest("c")) -> SimpleNamespace:
    return SimpleNamespace(
        case_id="case-001",
        split="test",
        study_track="C",
        dependency_classification_status="preregistered",
        repository=SimpleNamespace(
            source_type="git",
            url="https://github.com/example/project",
            base_revision="a" * 40,
        ),
        transition=SimpleNamespace(commitment_sha256=transition_sha256),
        oracle=SimpleNamespace(
            visibility="private",
            required_isolation_profile=REMOTE_WORKER_VAULT_PROFILE_ID,
            verifier_mode="black-box-controller-v1",
        ),
    )


def _source_admission(tmp_path: Path, transition_sha256: str) -> tuple[Path, str]:
    reviewed_at = datetime.now(timezone.utc).isoformat()
    bootstrap_log = tmp_path / "bootstrap.log"
    offline_log = tmp_path / "offline.log"
    bootstrap_log.write_text("bootstrap passed\n", encoding="utf-8")
    offline_log.write_text("offline passed\n", encoding="utf-8")
    environment_receipt = tmp_path / "environment-receipt.json"
    write_environment_preflight_receipt(
        path=environment_receipt,
        candidate_id="example-source",
        base_revision="a" * 40,
        public_transition_revision="b" * 40,
        bootstrap_command="test bootstrap",
        bootstrap_exit_code=0,
        bootstrap_log=bootstrap_log,
        offline_command="test offline",
        offline_exit_code=0,
        offline_log=offline_log,
        runtime="test-runtime",
        offline_policy="python-index-off-v1",
        observed_at_utc=reviewed_at,
    )
    review = tmp_path / "admission-review.json"
    review.write_text(json.dumps({
        "schema_version": "case-admission-review-v2",
        "candidate_id": "example-source",
        "repository_url": "https://github.com/example/project",
        "base_revision": "a" * 40,
        "public_transition_revision": "b" * 40,
        "author_id": "author-alpha",
        "author_history_access": "provenance-only-v1",
        "private_transition_commitment_sha256": transition_sha256,
        "private_task_brief_sha256": _digest("d"),
        "public_history_comparison_sha256": _digest("e"),
        "reviewer_ids": ["reviewer-beta", "reviewer-gamma"],
        "reviewer_kind": "independent-human-v1",
        "findings": [
            "independent-transition-v1",
            "not-public-solution-isomorphic-v1",
            "predecessor-dependency-reviewed-v1",
            "current-source-sufficiency-reviewed-v1",
        ],
        "reviewer_attestations": [
            {
                "reviewer_id": reviewer_id,
                "findings": [
                    "independent-transition-v1",
                    "not-public-solution-isomorphic-v1",
                    "predecessor-dependency-reviewed-v1",
                    "current-source-sufficiency-reviewed-v1",
                ],
            }
            for reviewer_id in ["reviewer-beta", "reviewer-gamma"]
        ],
        "decision": "approved-for-development",
        "reviewed_at_utc": reviewed_at,
    }, indent=2) + "\n", encoding="utf-8")
    environment_sha256 = hashlib.sha256(environment_receipt.read_bytes()).hexdigest()
    review_sha256 = hashlib.sha256(review.read_bytes()).hexdigest()
    ledger = tmp_path / "SOURCE-LEDGER.toml"
    ledger.write_text(
        f'''schema_version = "0.1"
ledger_id = "test-source-ledger"

[[candidate]]
id = "example-source"
status = "admitted"
language = "python"
repository_family_id = "example-project"
repository_url = "https://github.com/example/project"
base_revision = "{'a' * 40}"
public_transition_revision = "{'b' * 40}"
base_selection = "first-parent-of-public-transition"
license_spdx = "MIT"
license_path = "LICENSE"
license_url = "https://github.com/example/project/blob/{'a' * 40}/LICENSE"
license_sha256 = "{'f' * 64}"
source_urls = ["https://github.com/example/project/pull/1"]
causal_chain = "standalone-pr"
environment_readiness = "offline-ready"
environment_receipt_path = "{environment_receipt.name}"
environment_receipt_sha256 = "{environment_sha256}"
admission_review_path = "{review.name}"
admission_review_sha256 = "{review_sha256}"
benchmark_overlap = "none-confirmed"
model_exposure = "public-history-documented"
public_solution_exists = true
transition_plan = "private-post-snapshot"
decision_rationale = "A separately authored private transition requires independent review."
''',
        encoding="utf-8",
    )
    return ledger, "example-source"


def _registry(tmp_path: Path, job: WorkerJob) -> tuple[CaseRegistry, CaseRegistryEntry]:
    source = tmp_path / "REGISTRY.toml"
    source.write_text('schema_version = "0.3"\nregistry_id = "test-registry"\n', encoding="utf-8")
    entry = CaseRegistryEntry(
        case_id=job.case_id,
        path="test/case-001/case.toml",
        enrollment="confirmatory",
        case_definition_sha256=job.public_case_definition_sha256,
        corpus_split="test",
        repository_family_id="test-repository",
        task_family_id="test-task",
        trace_family_id="test-trace",
        authoring_batch="test-batch",
        source_class="public-repository",
        contamination_risk="public-history-documented",
        transition_exposure="post-snapshot-private",
        dependency_rationale="A durable policy is necessary after the transition.",
        minimal_sufficient_evidence="The prior policy record.",
        plausible_distractor="A stale implementation detail.",
        no_memory_expectation="The transfer snapshot is insufficient.",
        captured_trace_count=2,
    )
    return CaseRegistry(
        schema_version="0.3",
        registry_id="test-registry",
        entries=(entry,),
        source_path=source,
    ), entry


def _attestation(
    job: WorkerJob,
    result: WorkerResult,
    protocol: SubjectProtocol,
) -> WorkerAttestation:
    issued_at = datetime.now(timezone.utc)
    return WorkerAttestation(
        schema_version=WORKER_ATTESTATION_SCHEMA_VERSION,
        profile_id=REMOTE_WORKER_VAULT_PROFILE_ID,
        run_id=job.run_id,
        case_id=job.case_id,
        condition=job.condition,
        agent=job.agent,
        job_sha256=job.job_sha256,
        public_case_definition_sha256=job.public_case_definition_sha256,
        public_bundle_sha256=_digest("8"),
        prompt_sha256=job.prompt_sha256,
        memory_snapshot_sha256=_digest("9"),
        workspace_snapshot_sha256=job.workspace_snapshot_sha256,
        sealed_patch_sha256=result.sealed_patch_sha256,
        sealed_patch_bytes=result.sealed_patch_bytes,
        worker_runtime_sha256=_digest("a"),
        subject_protocol_sha256=protocol.sha256,
        controller_policy_sha256=job.controller_policy_sha256,
        job_nonce=job.job_nonce,
        agent_image="registry.example.invalid/agent@sha256:" + _digest("b"),
        agent_image_id="sha256:" + _digest("c"),
        tool_catalog_sha256=_digest("d"),
        container_inspection_sha256=_digest("e"),
        model_relay_policy_sha256=_digest("f"),
        environment_allowlist_sha256=_digest("1"),
        sentinel_suite_sha256=_digest("2"),
        isolation=WorkerIsolationSummary(
            network_policy_id="model-relay-only-v1",
            privileged=False,
            read_only_rootfs=True,
            dropped_capabilities=("ALL",),
            no_new_privileges=True,
            host_pid_namespace=False,
            host_ipc_namespace=False,
            host_uts_namespace=False,
            host_user_namespace=False,
            host_network=False,
            workspace_mount_count=1,
            runtime_config_mount_count=1,
            oracle_mount_count=0,
            socket_mount_count=0,
            device_mount_count=0,
            credential_mount_count=0,
            unexpected_mount_count=0,
            agent_container_destroyed=True,
            destruction_receipt_sha256=_digest("3"),
        ),
        issued_at=issued_at.isoformat(),
        expires_at=(issued_at + timedelta(minutes=15)).isoformat(),
        worker_result_sha256=result.result_sha256,
    )


def _model_relay_attestation(
    job: WorkerJob,
    policy: permit_module.ControllerTrustPolicy,
    result: WorkerResult,
) -> ModelRelayAttestation:
    issued_at = datetime.now(timezone.utc)
    return ModelRelayAttestation(
        schema_version=MODEL_RELAY_ATTESTATION_SCHEMA_VERSION,
        relay_policy_sha256=policy.expected_model_relay_policy_sha256,
        route_id=policy.expected_model_route_id,
        run_id=job.run_id,
        job_sha256=job.job_sha256,
        job_nonce=job.job_nonce,
        requested_model=policy.expected_requested_model,
        actual_models=(policy.expected_actual_model,),
        request_count=1,
        provider_request_ids_sha256=_digest("f"),
        input_tokens=2,
        output_tokens=1,
        issued_at=issued_at.isoformat(),
        expires_at=(issued_at + timedelta(minutes=15)).isoformat(),
        worker_result_sha256=result.result_sha256,
    )


def _runtime_attestation(
    job: WorkerJob,
    policy: permit_module.ControllerTrustPolicy,
    result: WorkerResult,
    signed_worker,
    runtime_measurement_receipt: RuntimeMeasurementReceipt,
) -> RuntimeAttestation:
    issued_at = datetime.now(timezone.utc)
    return RuntimeAttestation(
        schema_version=RUNTIME_ATTESTATION_SCHEMA_VERSION,
        profile_id=REMOTE_WORKER_VAULT_PROFILE_ID,
        run_id=job.run_id,
        job_sha256=job.job_sha256,
        job_nonce=job.job_nonce,
        worker_result_sha256=result.result_sha256,
        controller_policy_sha256=policy.sha256,
        runtime_measurement_policy_sha256=(
            policy.expected_runtime_measurement_policy_sha256
        ),
        worker_runtime_sha256=policy.expected_worker_runtime_sha256,
        agent_image=policy.expected_agent_image,
        agent_image_id=policy.expected_agent_image_id,
        tool_catalog_sha256=policy.expected_tool_catalog_sha256,
        container_inspection_sha256=policy.expected_container_inspection_sha256,
        network_policy_id=signed_worker.attestation.isolation.network_policy_id,
        isolation_measurement_sha256=runtime_measurement_receipt.sha256,
        destruction_receipt_sha256=(
            signed_worker.attestation.isolation.destruction_receipt_sha256
        ),
        issued_at=issued_at.isoformat(),
        expires_at=(issued_at + timedelta(minutes=15)).isoformat(),
    )


def _runtime_measurement_receipt(
    job: WorkerJob,
    policy: permit_module.ControllerTrustPolicy,
    result: WorkerResult,
    signed_worker,
) -> RuntimeMeasurementReceipt:
    observed_at = datetime.now(timezone.utc)
    measurement_policy = policy.runtime_measurement_policy
    return RuntimeMeasurementReceipt(
        schema_version=RUNTIME_MEASUREMENT_RECEIPT_SCHEMA_VERSION,
        policy_sha256=measurement_policy.sha256,
        profile_id=measurement_policy.profile_id,
        subject_isolation_profile=measurement_policy.subject_isolation_profile,
        network_policy_id=measurement_policy.network_policy_id,
        run_id=job.run_id,
        job_sha256=job.job_sha256,
        job_nonce=job.job_nonce,
        worker_result_sha256=result.result_sha256,
        evidence=tuple(
            RuntimeMeasurementEvidence(
                measurement_id=measurement_id,
                evidence_sha256=_digest(str(index)),
            )
            for index, measurement_id in enumerate(REQUIRED_MEASUREMENTS, start=4)
        ),
        destruction_receipt_sha256=(
            signed_worker.attestation.isolation.destruction_receipt_sha256
        ),
        observed_at=observed_at.isoformat(),
    )


def _install_registry_validation(
    monkeypatch: pytest.MonkeyPatch,
    registry: CaseRegistry,
    job: WorkerJob,
) -> None:
    monkeypatch.setattr(
        permit_module,
        "validate_case_registry",
        lambda *_args, **_kwargs: CaseRegistryValidation(
            registry_id=registry.registry_id,
            registry_sha256=registry.sha256,
            entry_count=1,
            development_pilot_count=0,
            confirmatory_count=1,
            repository_family_count=1,
            task_family_count=1,
            trace_family_count=1,
            case_ids=("case-001",),
        ),
    )
    monkeypatch.setattr(
        permit_module,
        "public_case_definition_hash",
        lambda _manifest: job.public_case_definition_sha256,
    )


@pytest.mark.skipif(shutil.which("ssh-keygen") is None, reason="OpenSSH ssh-keygen is unavailable")
def test_confirmatory_permit_requires_registry_signature_and_exact_protocol(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    protocol = _protocol()
    private_key = tmp_path / "worker-key"
    created = subprocess.run(
        ["ssh-keygen", "-q", "-t", "ed25519", "-N", "", "-f", str(private_key)],
        check=False,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    assert created.returncode == 0
    allowed_signers = tmp_path / "allowed-signers"
    allowed_signers.write_text(
        "worker-alpha " + private_key.with_suffix(".pub").read_text(encoding="utf-8").strip() + "\n",
        encoding="utf-8",
    )
    relay_private_key = tmp_path / "relay-key"
    relay_created = subprocess.run(
        ["ssh-keygen", "-q", "-t", "ed25519", "-N", "", "-f", str(relay_private_key)],
        check=False,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    assert relay_created.returncode == 0
    allowed_model_relay_signers = tmp_path / "allowed-model-relay-signers"
    allowed_model_relay_signers.write_text(
        "relay-alpha "
        + relay_private_key.with_suffix(".pub").read_text(encoding="utf-8").strip()
        + "\n",
        encoding="utf-8",
    )
    runtime_private_key = tmp_path / "runtime-key"
    runtime_created = subprocess.run(
        ["ssh-keygen", "-q", "-t", "ed25519", "-N", "", "-f", str(runtime_private_key)],
        check=False,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    assert runtime_created.returncode == 0
    allowed_runtime_attestation_signers = tmp_path / "allowed-runtime-attestation-signers"
    allowed_runtime_attestation_signers.write_text(
        "runtime-alpha "
        + runtime_private_key.with_suffix(".pub").read_text(encoding="utf-8").strip()
        + "\n",
        encoding="utf-8",
    )
    policy = _policy(
        allowed_signers,
        allowed_model_relay_signers,
        allowed_runtime_attestation_signers,
        _measurement_policy(),
        protocol,
    )
    job = _job(policy.sha256, protocol)
    patch = _worker_patch(tmp_path)
    result = _result(job, patch)
    manifest = _manifest()
    source_ledger_path, source_candidate_id = _source_admission(
        tmp_path,
        manifest.transition.commitment_sha256,
    )
    admission_kwargs = {
        "source_ledger_path": source_ledger_path,
        "source_candidate_id": source_candidate_id,
    }
    registry, _entry = _registry(tmp_path, job)
    _install_registry_validation(monkeypatch, registry, job)
    signed = sign_worker_attestation(
        _attestation(job, result, protocol),
        signer_principal="worker-alpha",
        private_key=private_key,
    )
    signed_relay = sign_model_relay_attestation(
        _model_relay_attestation(job, policy, result),
        signer_principal="relay-alpha",
        private_key=relay_private_key,
    )
    runtime_measurement_receipt = _runtime_measurement_receipt(
        job,
        policy,
        result,
        signed,
    )
    signed_runtime = sign_runtime_attestation(
        _runtime_attestation(
            job,
            policy,
            result,
            signed,
            runtime_measurement_receipt,
        ),
        signer_principal="runtime-alpha",
        private_key=runtime_private_key,
    )

    permit = permit_module.issue_confirmatory_execution_permit(
        registry=registry,
        cases_root=tmp_path / "cases",
        **admission_kwargs,
        manifest=manifest,
        worker_job=job,
        worker_result=result,
        worker_patch=patch,
        controller_policy=policy,
        signed_worker_attestation=signed,
        signed_model_relay_attestation=signed_relay,
        signed_runtime_attestation=signed_runtime,
        runtime_measurement_receipt=runtime_measurement_receipt,
    )

    assert permit.case_id == job.case_id
    assert permit.registry_sha256 == registry.sha256
    assert permit.source_candidate_id == source_candidate_id
    assert permit.subject_protocol_sha256 == protocol.sha256
    assert permit.actual_model == "model-x"
    assert permit.model_relay_signer_principal == "relay-alpha"
    assert permit.runtime_attestation_signer_principal == "runtime-alpha"
    assert permit.runtime_measurement_policy_sha256 == policy.runtime_measurement_policy.sha256
    assert len(permit.permit_sha256) == 64
    permit_module.validate_confirmatory_execution_permit(
        permit,
        registry=registry,
        cases_root=tmp_path / "cases",
        **admission_kwargs,
        manifest=manifest,
        worker_job=job,
        worker_result=result,
        worker_patch=patch,
        controller_policy=policy,
        signed_worker_attestation=signed,
        signed_model_relay_attestation=signed_relay,
        signed_runtime_attestation=signed_runtime,
        runtime_measurement_receipt=runtime_measurement_receipt,
    )

    ledger = permit_module.PermitRedemptionLedger(tmp_path / "controller" / "permit-ledger.sqlite")
    reconstruction_workspace = tmp_path / "controller" / "public-reconstruction"

    def reject_reconstruction(**_kwargs: object) -> str:
        raise WorkerProtocolError("final tree mismatch")

    monkeypatch.setattr(permit_module, "reconstruct_sealed_patch_in_vault", reject_reconstruction)
    with pytest.raises(permit_module.ConfirmatoryPermitError, match="reconstruction failed"):
        permit_module.redeem_confirmatory_execution_permit(
            permit,
            redemption_ledger=ledger,
            reconstruction_workspace=reconstruction_workspace,
            registry=registry,
            cases_root=tmp_path / "cases",
            **admission_kwargs,
            manifest=manifest,
            worker_job=job,
            worker_result=result,
            worker_patch=patch,
            controller_policy=policy,
            signed_worker_attestation=signed,
            signed_model_relay_attestation=signed_relay,
            signed_runtime_attestation=signed_runtime,
            runtime_measurement_receipt=runtime_measurement_receipt,
        )

    reconstruction_calls: list[dict[str, object]] = []

    def accept_reconstruction(**kwargs: object) -> str:
        reconstruction_calls.append(kwargs)
        return result.final_workspace_sha256

    monkeypatch.setattr(permit_module, "reconstruct_sealed_patch_in_vault", accept_reconstruction)
    redemption = permit_module.redeem_confirmatory_execution_permit(
        permit,
        redemption_ledger=ledger,
        reconstruction_workspace=reconstruction_workspace,
        registry=registry,
        cases_root=tmp_path / "cases",
        **admission_kwargs,
        manifest=manifest,
        worker_job=job,
        worker_result=result,
        worker_patch=patch,
        controller_policy=policy,
        signed_worker_attestation=signed,
        signed_model_relay_attestation=signed_relay,
        signed_runtime_attestation=signed_runtime,
        runtime_measurement_receipt=runtime_measurement_receipt,
    )
    assert redemption.permit_sha256 == permit.permit_sha256
    assert reconstruction_calls[0]["expected_final_workspace_sha256"] == result.final_workspace_sha256

    with pytest.raises(permit_module.ConfirmatoryPermitError, match="already redeemed"):
        permit_module.redeem_confirmatory_execution_permit(
            permit,
            redemption_ledger=ledger,
            reconstruction_workspace=reconstruction_workspace,
            registry=registry,
            cases_root=tmp_path / "cases",
            **admission_kwargs,
            manifest=manifest,
            worker_job=job,
            worker_result=result,
            worker_patch=patch,
            controller_policy=policy,
            signed_worker_attestation=signed,
            signed_model_relay_attestation=signed_relay,
            signed_runtime_attestation=signed_runtime,
            runtime_measurement_receipt=runtime_measurement_receipt,
        )

    with pytest.raises(permit_module.ConfirmatoryPermitError, match="does not bind"):
        permit_module.validate_confirmatory_execution_permit(
            replace(permit, worker_profile_id="forged-profile"),
            registry=registry,
            cases_root=tmp_path / "cases",
            **admission_kwargs,
            manifest=manifest,
            worker_job=job,
            worker_result=result,
            worker_patch=patch,
            controller_policy=policy,
            signed_worker_attestation=signed,
            signed_model_relay_attestation=signed_relay,
            signed_runtime_attestation=signed_runtime,
            runtime_measurement_receipt=runtime_measurement_receipt,
        )

    with pytest.raises(permit_module.ConfirmatoryPermitError, match="controller policy"):
        permit_module.issue_confirmatory_execution_permit(
            registry=registry,
            cases_root=tmp_path / "cases",
            **admission_kwargs,
            manifest=manifest,
            worker_job=job,
            worker_result=result,
            worker_patch=patch,
            controller_policy=replace(
                policy,
                subject_protocol=replace(protocol, max_requests=4),
            ),
            signed_worker_attestation=signed,
            signed_model_relay_attestation=signed_relay,
            signed_runtime_attestation=signed_runtime,
            runtime_measurement_receipt=runtime_measurement_receipt,
        )

    with pytest.raises(permit_module.ConfirmatoryPermitError, match="runtime attestation"):
        permit_module.issue_confirmatory_execution_permit(
            registry=registry,
            cases_root=tmp_path / "cases",
            **admission_kwargs,
            manifest=manifest,
            worker_job=job,
            worker_result=result,
            worker_patch=patch,
            controller_policy=policy,
            signed_worker_attestation=signed,
            signed_model_relay_attestation=signed_relay,
            signed_runtime_attestation=replace(
                signed_runtime,
                attestation=replace(signed_runtime.attestation, run_id="forged-run"),
            ),
            runtime_measurement_receipt=runtime_measurement_receipt,
        )

    with pytest.raises(permit_module.ConfirmatoryPermitError, match="measurement receipt"):
        permit_module.issue_confirmatory_execution_permit(
            registry=registry,
            cases_root=tmp_path / "cases",
            **admission_kwargs,
            manifest=manifest,
            worker_job=job,
            worker_result=result,
            worker_patch=patch,
            controller_policy=policy,
            signed_worker_attestation=signed,
            signed_model_relay_attestation=signed_relay,
            signed_runtime_attestation=signed_runtime,
            runtime_measurement_receipt=replace(
                runtime_measurement_receipt,
                evidence=(
                    replace(
                        runtime_measurement_receipt.evidence[0],
                        evidence_sha256=_digest("a"),
                    ),
                    *runtime_measurement_receipt.evidence[1:],
                ),
            ),
        )

    with pytest.raises(permit_module.ConfirmatoryPermitError, match="memory_snapshot_sha256"):
        permit_module.issue_confirmatory_execution_permit(
            registry=registry,
            cases_root=tmp_path / "cases",
            **admission_kwargs,
            manifest=manifest,
            worker_job=job,
            worker_result=replace(result, memory_snapshot_sha256=_digest("0")),
            worker_patch=patch,
            controller_policy=policy,
            signed_worker_attestation=signed,
            signed_model_relay_attestation=signed_relay,
            signed_runtime_attestation=signed_runtime,
            runtime_measurement_receipt=runtime_measurement_receipt,
        )

    with pytest.raises(permit_module.ConfirmatoryPermitError, match="public_bundle_sha256"):
        permit_module.issue_confirmatory_execution_permit(
            registry=registry,
            cases_root=tmp_path / "cases",
            **admission_kwargs,
            manifest=manifest,
            worker_job=job,
            worker_result=replace(result, public_bundle_sha256=_digest("0")),
            worker_patch=patch,
            controller_policy=policy,
            signed_worker_attestation=signed,
            signed_model_relay_attestation=signed_relay,
            signed_runtime_attestation=signed_runtime,
            runtime_measurement_receipt=runtime_measurement_receipt,
        )

    mismatched_policy = replace(policy, expected_worker_runtime_sha256=_digest("0"))
    mismatched_job = _job(mismatched_policy.sha256, protocol)
    mismatched_patch = _worker_patch(tmp_path / "mismatched")
    mismatched_result = _result(mismatched_job, mismatched_patch)
    mismatched_signed = sign_worker_attestation(
        _attestation(mismatched_job, mismatched_result, protocol),
        signer_principal="worker-alpha",
        private_key=private_key,
    )
    mismatched_relay = sign_model_relay_attestation(
        _model_relay_attestation(mismatched_job, mismatched_policy, mismatched_result),
        signer_principal="relay-alpha",
        private_key=relay_private_key,
    )
    with pytest.raises(permit_module.ConfirmatoryPermitError, match="does not match the controller policy"):
        permit_module.issue_confirmatory_execution_permit(
            registry=registry,
            cases_root=tmp_path / "cases",
            **admission_kwargs,
            manifest=manifest,
            worker_job=mismatched_job,
            worker_result=mismatched_result,
            worker_patch=mismatched_patch,
            controller_policy=mismatched_policy,
            signed_worker_attestation=mismatched_signed,
            signed_model_relay_attestation=mismatched_relay,
            signed_runtime_attestation=signed_runtime,
            runtime_measurement_receipt=runtime_measurement_receipt,
        )

    with pytest.raises(permit_module.ConfirmatoryPermitError, match="signed worker attestation"):
        permit_module.issue_confirmatory_execution_permit(
            registry=registry,
            cases_root=tmp_path / "cases",
            **admission_kwargs,
            manifest=manifest,
            worker_job=job,
            worker_result=replace(result, reported_models=("helper-model",)),
            worker_patch=patch,
            controller_policy=policy,
            signed_worker_attestation=signed,
            signed_model_relay_attestation=signed_relay,
            signed_runtime_attestation=signed_runtime,
            runtime_measurement_receipt=runtime_measurement_receipt,
        )

    partial_relay = sign_model_relay_attestation(
        replace(_model_relay_attestation(job, policy, result), request_count=2),
        signer_principal="relay-alpha",
        private_key=relay_private_key,
    )
    with pytest.raises(permit_module.ConfirmatoryPermitError, match="relay request inventory"):
        permit_module.issue_confirmatory_execution_permit(
            registry=registry,
            cases_root=tmp_path / "cases",
            **admission_kwargs,
            manifest=manifest,
            worker_job=job,
            worker_result=result,
            worker_patch=patch,
            controller_policy=policy,
            signed_worker_attestation=signed,
            signed_model_relay_attestation=partial_relay,
            signed_runtime_attestation=signed_runtime,
            runtime_measurement_receipt=runtime_measurement_receipt,
        )

    token_mismatch_relay = sign_model_relay_attestation(
        replace(_model_relay_attestation(job, policy, result), input_tokens=3),
        signer_principal="relay-alpha",
        private_key=relay_private_key,
    )
    with pytest.raises(permit_module.ConfirmatoryPermitError, match="relay token accounting"):
        permit_module.issue_confirmatory_execution_permit(
            registry=registry,
            cases_root=tmp_path / "cases",
            **admission_kwargs,
            manifest=manifest,
            worker_job=job,
            worker_result=result,
            worker_patch=patch,
            controller_policy=policy,
            signed_worker_attestation=signed,
            signed_model_relay_attestation=token_mismatch_relay,
            signed_runtime_attestation=signed_runtime,
            runtime_measurement_receipt=runtime_measurement_receipt,
        )


def test_confirmatory_permit_rejects_a_nonconfirmatory_registry_entry(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    job = _job()
    registry, entry = _registry(tmp_path, job)
    registry = replace(registry, entries=(replace(entry, enrollment="development-pilot"),))
    _install_registry_validation(monkeypatch, registry, job)

    with pytest.raises(permit_module.ConfirmatoryPermitError, match="registry entry"):
        permit_module._require_confirmatory_registry_entry(
            registry,
            tmp_path / "cases",
            _manifest(),
        )


def test_source_admission_rejects_a_transition_other_than_the_reviewed_one(
    tmp_path: Path,
) -> None:
    reviewed_manifest = _manifest()
    source_ledger_path, source_candidate_id = _source_admission(
        tmp_path,
        reviewed_manifest.transition.commitment_sha256,
    )

    binding = permit_module._require_source_admission(
        source_ledger_path=source_ledger_path,
        source_candidate_id=source_candidate_id,
        manifest=reviewed_manifest,
    )

    assert binding[1] == source_candidate_id
    with pytest.raises(permit_module.ConfirmatoryPermitError, match="transition commitment"):
        permit_module._require_source_admission(
            source_ledger_path=source_ledger_path,
            source_candidate_id=source_candidate_id,
            manifest=_manifest(_digest("0")),
        )


@pytest.mark.parametrize(
    ("asset_name", "timestamp_key", "expected_message"),
    [
        ("admission-review.json", "reviewed_at_utc", "admission review is older"),
        ("environment-receipt.json", "observed_at_utc", "environment receipt is older"),
    ],
)
def test_source_admission_rejects_stale_review_or_environment_evidence(
    tmp_path: Path,
    asset_name: str,
    timestamp_key: str,
    expected_message: str,
) -> None:
    manifest = _manifest()
    source_ledger_path, source_candidate_id = _source_admission(
        tmp_path,
        manifest.transition.commitment_sha256,
    )
    asset_path = tmp_path / asset_name
    original_sha256 = hashlib.sha256(asset_path.read_bytes()).hexdigest()
    payload = json.loads(asset_path.read_text(encoding="utf-8"))
    payload[timestamp_key] = (datetime.now(timezone.utc) - timedelta(days=15)).isoformat()
    asset_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    updated_sha256 = hashlib.sha256(asset_path.read_bytes()).hexdigest()
    source_ledger_path.write_text(
        source_ledger_path.read_text(encoding="utf-8").replace(
            original_sha256,
            updated_sha256,
        ),
        encoding="utf-8",
    )

    with pytest.raises(permit_module.ConfirmatoryPermitError, match=expected_message):
        permit_module._require_source_admission(
            source_ledger_path=source_ledger_path,
            source_candidate_id=source_candidate_id,
            manifest=manifest,
        )


def test_permit_redemption_is_single_use(
    tmp_path: Path,
) -> None:
    permit = SimpleNamespace(
        permit_sha256=_digest("f"),
        job_sha256=_digest("e"),
        job_nonce="d" * 32,
    )
    ledger = permit_module.PermitRedemptionLedger(tmp_path / "permit-redemptions.sqlite")

    receipt = ledger._record_redeemed(permit)

    assert receipt.permit_sha256 == permit.permit_sha256
    assert receipt.job_sha256 == permit.job_sha256
    assert receipt.job_nonce == permit.job_nonce
    assert receipt.schema_version == permit_module.PERMIT_REDEMPTION_SCHEMA_VERSION
    with pytest.raises(permit_module.ConfirmatoryPermitError, match="already redeemed"):
        ledger._record_redeemed(permit)
    replacement = SimpleNamespace(
        permit_sha256=_digest("a"),
        job_sha256=permit.job_sha256,
        job_nonce=permit.job_nonce,
    )
    with pytest.raises(permit_module.ConfirmatoryPermitError, match="already redeemed"):
        ledger._record_redeemed(replacement)


def _reconstruction_workspace(root: Path) -> Path:
    workspace = root / "workspace"
    workspace.mkdir(parents=True)
    subprocess.run(["git", "init", "--quiet"], cwd=workspace, check=True)
    subprocess.run(["git", "config", "user.name", "MemorixBench Test"], cwd=workspace, check=True)
    subprocess.run(["git", "config", "user.email", "test@example.invalid"], cwd=workspace, check=True)
    (workspace / "value.txt").write_text("baseline\n", encoding="utf-8")
    subprocess.run(["git", "add", "value.txt"], cwd=workspace, check=True)
    subprocess.run(["git", "commit", "--quiet", "-m", "baseline"], cwd=workspace, check=True)
    return workspace


def test_confirmatory_reconstruction_rejects_a_signed_wrong_final_tree(
    tmp_path: Path,
) -> None:
    worker_workspace = _reconstruction_workspace(tmp_path / "worker")
    baseline = worker_protocol.workspace_snapshot_hash(worker_workspace)
    worker_head = worker_protocol._workspace_head(worker_workspace)
    (worker_workspace / "value.txt").write_text("worker final\n", encoding="utf-8")
    patch, final_tree = worker_protocol._capture_workspace_patch(
        worker_workspace,
        tmp_path / "worker.patch",
        expected_head=worker_head,
    )
    vault_workspace = _reconstruction_workspace(tmp_path / "vault")
    job = SimpleNamespace(workspace_snapshot_sha256=baseline)
    result = SimpleNamespace(final_workspace_sha256="0" * 64)

    with pytest.raises(permit_module.ConfirmatoryPermitError, match="reconstruction failed"):
        permit_module._reconstruct_confirmatory_public_worker_output(
            reconstruction_workspace=vault_workspace,
            worker_job=job,
            worker_result=result,
            worker_patch=patch,
        )

    retry_workspace = _reconstruction_workspace(tmp_path / "retry")
    assert permit_module._reconstruct_confirmatory_public_worker_output(
        reconstruction_workspace=retry_workspace,
        worker_job=job,
        worker_result=SimpleNamespace(final_workspace_sha256=final_tree),
        worker_patch=patch,
    ) == final_tree
