# Native Hook Session Formation Contract

Status: executable local-diagnostic formation surface for Claude Code hooks.
It is not a confirmatory execution path and is not a replacement for the
canonical equal-evidence baseline family.

## Purpose

`native-session` answers a narrower product question than `trace-replay`:
can Memorix form state through the same command-hook payloads that a Claude
Code session supplies, then make the resulting observation searchable in a
fresh transfer session? It must never be described as replaying a provider
conversation, as an audited human session, or as proof of broad effectiveness.

The source event shape is the official Claude Code command-hook JSON contract:
the client sends event JSON to command hooks on stdin, including `SessionStart`,
`UserPromptSubmit`, and `PostToolUse`. See the [Claude Code hooks
reference](https://code.claude.com/docs/en/hooks).

## Capture Boundary

Raw hook JSONL remains private controller material. It can contain transcript
locations and incidental local paths. The converter accepts one raw Claude
payload per line, or an explicit `{ "sequence", "payload" }` envelope, then
does all of the following before writing a portable capture:

1. Requires the captured workspace to be clean and verifies the supplied
   snapshot hash against its complete Git tree. For a session that edited
   files, the controller first freezes the completed precursor state in a
   commit or other clean snapshot; a dirty post-tool workspace is refused.
2. Removes `transcript_path` and `transcriptPath`.
3. Requires every declared `cwd`, `file_path`, `filePath`, or `path` to stay
   below the supplied Git workspace.
4. Replaces the workspace prefix with the literal `<WORKSPACE>` token.
5. Runs the public safety scanner over the resulting payloads and storage
   probe. Any secret-like value, host path, or outside-workspace path aborts
   output rather than being redacted silently.
6. Commits both the raw portable-file hash and a canonical structured hash.

The converter does not copy the raw JSONL. It cannot prove that an upstream
client generated a source file; that provenance remains `local-diagnostic-v1`
unless an independent worker/vault process supplies the separate evidence
required by the confirmatory protocol.

## Portable Capture Schema

The current `native-hook-capture-v1` file is intentionally narrow:

```json
{
  "schema_version": "native-hook-capture-v1",
  "case_id": "example-case",
  "capture_id": "capture-a",
  "agent": "claude",
  "client_version": "claude-code-pinned",
  "capture_mode": "local-diagnostic-v1",
  "workspace_snapshot_sha256": "<sha256>",
  "redaction_profile": "workspace-token-v1",
  "storage_probe": {
    "query": "unique retained marker",
    "minimum_candidate_refs": 1
  },
  "events": []
}
```

Only Claude Code is supported in v1. Supporting another client requires its
official hook schema, a new versioned adapter, fixture coverage, and a separate
claim boundary. A generic normalized text trace is rejected here; it belongs to
`trace-replay`.

## Formation Execution

The adapter rehydrates only `<WORKSPACE>` into an isolated Git checkout. For
each ordered event it runs the real command:

```text
node <memorix-cli> hook --agent claude
```

with isolated `MEMORIX_DATA_DIR`, `HOME`, and `USERPROFILE` directories and
embedding disabled. It records return/output hashes but not raw payloads. After
the final event it makes a separate bounded Memorix canonical search using the
capture's probe query. Formation fails unless that search returns at least the
declared number of observation references.

The formation receipt binds the capture hashes, capture id, client label,
event count, hook-output hashes, storage-probe query hash, and search result
count. It has `surface = "native-session"`; it cannot be relabeled as
`trace-replay`.

## Trial and Comparison Boundary

A `native-session` case declares:

```toml
[formation]
track = "native-session"

[formation.native_hook_capture]
path = "native-hook-capture.json"
schema_version = "native-hook-capture-v1"
```

The current trial runner permits only `no-memory` and Memorix conditions on
this formation surface. Mem0, AgentMemory, and `last-n` are rejected because a
Memorix-native hook stream is not an equal write interface for those systems.
Pairing requires the same canonical native capture hash. It is therefore a
native product/control diagnostic, reported separately from Track B and from
trace-replay baseline comparisons.

Validation and test cases remain blocked: the confirmatory protocol still
requires independently reviewed transition design, trace-bundle provenance,
private oracles, trusted relay evidence, and KVM worker/vault execution.

## Local Controller Command

Run this only with a private raw-event input and an external artifact root:

```powershell
uv run memorixbench capture-native-hook-session `
  --events <private-hook-events.jsonl> `
  --output <artifact-root>/portable-native-hook-capture.json `
  --case-id <case-id> `
  --capture-id <capture-id> `
  --client-version <pinned-client-version> `
  --workspace <captured-workspace> `
  --workspace-snapshot-sha256 <snapshot-sha256> `
  --storage-probe-query <unique-public-marker>
```

Do not add raw hook events, client configuration, transcript files, or private
captures to the repository or public artifact.

When a real Claude Code command hook must both preserve its original UTF-8
stdin and forward it to Memorix, use `scripts/native-hook-forwarder.ps1` from
an external settings file. Pass the CLI, private JSONL log, data directory, and
home directory as explicit arguments. The script is a byte-preserving transport
helper; its arguments and generated logs remain external to the public release.
