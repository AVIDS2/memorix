import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promisify } from 'node:util';
import type {
  CodeGraphProviderKind,
  CodeStateScanCompleteness,
  CodeStateSnapshotInput,
  CodeStateWorktreeState,
} from './types.js';

const execFileAsync = promisify(execFile);
const GIT_TIMEOUT_MS = 3_000;
const GIT_MAX_BUFFER_BYTES = 256 * 1024;

interface GitResult {
  ok: boolean;
  output: Buffer;
}

async function runGit(rootPath: string, args: string[]): Promise<GitResult> {
  try {
    const result = await execFileAsync('git', ['-C', rootPath, ...args], {
      encoding: 'buffer',
      windowsHide: true,
      timeout: GIT_TIMEOUT_MS,
      maxBuffer: GIT_MAX_BUFFER_BYTES,
    });
    const output = Buffer.isBuffer(result.stdout)
      ? result.stdout
      : Buffer.from(result.stdout ?? '');
    return { ok: true, output };
  } catch {
    return { ok: false, output: Buffer.alloc(0) };
  }
}

function changedPathCount(status: Buffer): number {
  const entries = status.toString('utf8').split('\0');
  let count = 0;
  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index];
    if (!entry) continue;
    count++;
    const code = entry.slice(0, 2);
    if (code.includes('R') || code.includes('C')) index++;
  }
  return count;
}

function fingerprint(baseRevision: string | undefined, status: Buffer): string {
  return createHash('sha256')
    .update(baseRevision ?? '')
    .update('\0')
    .update(status)
    .digest('hex');
}

export interface CollectCodeStateInput {
  projectId: string;
  projectRoot: string;
  provider: CodeGraphProviderKind;
  indexedAt: string;
  completeness: CodeStateScanCompleteness;
}

/**
 * Capture bounded Git metadata for a completed scan. No source file contents
 * are copied into the snapshot, and an unavailable Git executable is explicit
 * instead of being treated as a clean worktree.
 */
export async function collectCodeStateSnapshot(
  input: CollectCodeStateInput,
): Promise<CodeStateSnapshotInput> {
  const [revision, status] = await Promise.all([
    runGit(input.projectRoot, ['rev-parse', 'HEAD']),
    runGit(input.projectRoot, ['status', '--porcelain=v1', '-z', '--untracked-files=normal']),
  ]);
  const baseRevision = revision.ok
    ? revision.output.toString('utf8').trim() || undefined
    : undefined;
  const worktreeState: CodeStateWorktreeState = status.ok
    ? (status.output.length > 0 ? 'dirty' : 'clean')
    : 'unavailable';

  return {
    projectId: input.projectId,
    provider: input.provider,
    ...(baseRevision ? { baseRevision } : {}),
    worktreeFingerprint: fingerprint(baseRevision, status.ok ? status.output : Buffer.alloc(0)),
    worktreeState,
    changedPathCount: status.ok ? changedPathCount(status.output) : 0,
    indexedAt: input.indexedAt,
    completeness: input.completeness,
  };
}
