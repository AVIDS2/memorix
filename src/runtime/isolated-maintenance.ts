import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { MaintenanceJob, MaintenanceJobKind, MaintenanceJobRunResult } from './maintenance-jobs.js';
import { sanitizeCredentials } from '../memory/secret-filter.js';

export const MAINTENANCE_RESULT_PREFIX = '__MEMORIX_MAINTENANCE_RESULT__';

export const ISOLATED_MAINTENANCE_JOB_KINDS: readonly MaintenanceJobKind[] = [
  'retention-archive',
  'consolidation',
  'codegraph-refresh',
  'observation-qualify',
  'claim-derive',
  'claim-requalification',
  'knowledge-compile',
  'knowledge-lint',
  'workflow-index',
];
const DEFAULT_TIMEOUT_MS = 5 * 60_000;
const MAX_CHILD_OUTPUT_BYTES = 1_000_000;

export interface IsolatedMaintenanceRequest {
  job: MaintenanceJob;
  projectRoot: string;
  dataDir: string;
}

export interface IsolatedMaintenanceOptions {
  runnerPath?: string;
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isMaintenanceResult(value: unknown): value is MaintenanceJobRunResult {
  if (!isRecord(value)) return false;
  if (value.action === 'complete') return true;
  return value.action === 'reschedule' && typeof value.delayMs === 'number';
}

function childError(prefix: string, detail: string): Error {
  const cleaned = sanitizeCredentials(detail.trim()).slice(0, 4_000);
  return new Error(cleaned ? `${prefix}: ${cleaned}` : prefix);
}

/**
 * Resolve the runner beside the compiled package entry. The CLI bundle lives
 * in dist/cli while the library entry lives directly in dist.
 */
export function resolveMaintenanceRunnerPath(moduleUrl = import.meta.url): string {
  const moduleDir = path.dirname(fileURLToPath(moduleUrl));
  const distDir = path.basename(moduleDir) === 'cli'
    ? path.dirname(moduleDir)
    : path.basename(moduleDir) === 'runtime' && path.basename(path.dirname(moduleDir)) === 'src'
      ? path.join(path.dirname(path.dirname(moduleDir)), 'dist')
      : moduleDir;
  return path.join(distDir, 'maintenance-runner.js');
}

export function parseMaintenanceRunnerOutput(output: string): MaintenanceJobRunResult {
  const line = output
    .split(/\r?\n/)
    .reverse()
    .find((candidate) => candidate.startsWith(MAINTENANCE_RESULT_PREFIX));
  if (!line) {
    throw childError('Maintenance runner did not return a result', output);
  }

  try {
    const parsed = JSON.parse(line.slice(MAINTENANCE_RESULT_PREFIX.length));
    if (!isMaintenanceResult(parsed)) {
      throw new Error('result shape is invalid');
    }
    return parsed;
  } catch (error) {
    throw childError(
      'Maintenance runner returned an invalid result',
      error instanceof Error ? error.message : String(error),
    );
  }
}

function validateRequest(request: IsolatedMaintenanceRequest): void {
  if (!ISOLATED_MAINTENANCE_JOB_KINDS.includes(request.job.kind)) {
    throw new Error(`Maintenance job ${request.job.kind} cannot run in an isolated worker`);
  }
  if (!path.isAbsolute(request.projectRoot)) {
    throw new Error('Maintenance runner requires an absolute project root');
  }
  if (!path.isAbsolute(request.dataDir)) {
    throw new Error('Maintenance runner requires an absolute data directory');
  }
}

function collectOutput(
  stream: NodeJS.ReadableStream,
  limit: number,
  onOverflow: () => void,
): Promise<string> {
  return new Promise((resolve, reject) => {
    let value = '';
    let size = 0;
    stream.setEncoding('utf8');
    stream.on('data', (chunk: string) => {
      size += Buffer.byteLength(chunk);
      if (size > limit) {
        onOverflow();
        reject(new Error('maintenance runner output exceeded its safety limit'));
        return;
      }
      value += chunk;
    });
    stream.on('error', reject);
    stream.on('end', () => resolve(value));
  });
}

/**
 * Runs CPU/disk-heavy maintenance out of the MCP process. The parent keeps
 * the durable queue lease; the child gets only one job and returns one result.
 */
export async function runMaintenanceInChildProcess(
  request: IsolatedMaintenanceRequest,
  options: IsolatedMaintenanceOptions = {},
): Promise<MaintenanceJobRunResult> {
  validateRequest(request);
  const runnerPath = options.runnerPath ?? resolveMaintenanceRunnerPath();
  if (!existsSync(runnerPath)) {
    throw new Error(`Maintenance runner is unavailable at ${runnerPath}. Reinstall or rebuild Memorix.`);
  }

  const timeoutMs = Number.isFinite(options.timeoutMs)
    ? Math.max(1_000, Math.floor(options.timeoutMs!))
    : DEFAULT_TIMEOUT_MS;
  const env = { ...process.env, ...options.env };

  return new Promise<MaintenanceJobRunResult>((resolve, reject) => {
    let settled = false;
    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn(process.execPath, [runnerPath], {
        cwd: request.projectRoot,
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      });
    } catch (error) {
      reject(error);
      return;
    }

    const settle = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      fn();
    };
    const terminateForOutput = (): void => {
      child.kill();
    };
    const stdout = collectOutput(child.stdout, MAX_CHILD_OUTPUT_BYTES, terminateForOutput);
    const stderr = collectOutput(child.stderr, MAX_CHILD_OUTPUT_BYTES, terminateForOutput);
    const timeout = setTimeout(() => {
      child.kill();
      settle(() => reject(new Error(`Maintenance runner timed out after ${timeoutMs}ms`)));
    }, timeoutMs);

    child.once('error', (error) => settle(() => reject(error)));
    child.once('close', async (code, signal) => {
      try {
        const [out, err] = await Promise.all([stdout, stderr]);
        if (code !== 0) {
          settle(() => reject(childError(
            `Maintenance runner exited with ${signal ? `signal ${signal}` : `code ${code ?? 'unknown'}`}`,
            err || out,
          )));
          return;
        }
        settle(() => resolve(parseMaintenanceRunnerOutput(out)));
      } catch (error) {
        settle(() => reject(error));
      }
    });

    child.stdin.end(JSON.stringify(request));
  });
}
