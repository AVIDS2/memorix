/**
 * Verify Gates — Phase 7, Step 1: Compile + test verification after agent completion.
 *
 * Runs configurable shell commands (e.g. `tsc --noEmit`, `vitest run`) in the
 * task's working directory. Returns a structured result used by the coordinator
 * to decide whether to mark a task completed or enter the fix loop.
 *
 * Design principle: gates are OPTIONAL. If no command is configured, the gate
 * is skipped and the task completes as before (backward compatible).
 */

import { spawn, execSync } from 'node:child_process';

// ── Types ──────────────────────────────────────────────────────────

export interface GateResult {
  gate: 'compile' | 'test';
  passed: boolean;
  /** Combined stdout + stderr, trimmed to budget */
  output: string;
  /** Wall-clock duration in ms */
  durationMs: number;
  /** The command that was executed */
  command: string;
}

export interface GateConfig {
  /** Shell command to run for compile gate (e.g. 'npm run build', 'tsc --noEmit') */
  compileCommand?: string;
  /** Shell command to run for test gate (e.g. 'npm test', 'npx vitest run') */
  testCommand?: string;
  /** Compile gate timeout in ms (default: 120_000) */
  compileTimeoutMs?: number;
  /** Test gate timeout in ms (default: 300_000) */
  testTimeoutMs?: number;
  /** Max output bytes to keep in memory (default: 32_768 = 32KB) */
  outputBudget?: number;
}

// ── Constants ──────────────────────────────────────────────────────

const DEFAULT_COMPILE_TIMEOUT = 120_000;
const DEFAULT_TEST_TIMEOUT = 300_000;
const DEFAULT_OUTPUT_BUDGET = 32_768; // 32KB

// ── Core ───────────────────────────────────────────────────────────

/**
 * Run a single gate command. Resolves with the result — never throws.
 *
 * The command is run in a shell (`/bin/sh -c` on Unix, `cmd /c` on Windows)
 * so pipes, redirects, and chained commands work naturally.
 */
export function runGate(
  gate: 'compile' | 'test',
  command: string,
  cwd: string,
  timeoutMs: number,
  outputBudget: number = DEFAULT_OUTPUT_BUDGET,
): Promise<GateResult> {
  const start = Date.now();

  return new Promise<GateResult>((resolve) => {
    const chunks: Buffer[] = [];
    let totalBytes = 0;

    const proc = spawn(command, {
      cwd,
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' },
    });

    const collectOutput = (data: Buffer) => {
      if (totalBytes < outputBudget) {
        const remaining = outputBudget - totalBytes;
        chunks.push(data.length > remaining ? data.subarray(0, remaining) : data);
      }
      totalBytes += data.length;
    };

    proc.stdout?.on('data', collectOutput);
    proc.stderr?.on('data', collectOutput);

    let killed = false;
    const killTree = () => {
      try {
        if (process.platform === 'win32') {
          // Windows: kill entire process tree via taskkill
          execSync(`taskkill /F /T /PID ${proc.pid}`, { stdio: 'ignore' });
        } else {
          // Unix: kill process group
          process.kill(-proc.pid!, 'SIGKILL');
        }
      } catch {
        // Fallback: kill the process directly
        try { proc.kill('SIGKILL'); } catch { /* already dead */ }
      }
    };

    const timer = setTimeout(() => {
      killed = true;
      killTree();
    }, timeoutMs);

    proc.on('close', (code) => {
      clearTimeout(timer);
      const output = Buffer.concat(chunks).toString('utf-8');
      const durationMs = Date.now() - start;

      if (killed) {
        resolve({
          gate,
          passed: false,
          output: output + `\n[TIMEOUT] Gate "${gate}" killed after ${timeoutMs}ms`,
          durationMs,
          command,
        });
        return;
      }

      resolve({
        gate,
        passed: code === 0,
        output,
        durationMs,
        command,
      });
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      resolve({
        gate,
        passed: false,
        output: `[ERROR] Failed to spawn gate command: ${err.message}`,
        durationMs: Date.now() - start,
        command,
      });
    });
  });
}

/**
 * Run compile and test gates sequentially.
 *
 * - If compileCommand is not set → skip compile gate
 * - If testCommand is not set → skip test gate
 * - If compile fails → do NOT run test gate (no point testing broken code)
 * - Returns array of GateResults (0, 1, or 2 items)
 *
 * Never throws — all failures are captured in GateResult.
 */
export async function runVerifyGates(
  cwd: string,
  gateConfig: GateConfig,
): Promise<GateResult[]> {
  const {
    compileCommand,
    testCommand,
    compileTimeoutMs = DEFAULT_COMPILE_TIMEOUT,
    testTimeoutMs = DEFAULT_TEST_TIMEOUT,
    outputBudget = DEFAULT_OUTPUT_BUDGET,
  } = gateConfig;

  const results: GateResult[] = [];

  // No gates configured → empty results (task completes as before)
  if (!compileCommand && !testCommand) {
    return results;
  }

  // Compile gate
  if (compileCommand) {
    const compileResult = await runGate('compile', compileCommand, cwd, compileTimeoutMs, outputBudget);
    results.push(compileResult);

    // If compile fails, skip test gate
    if (!compileResult.passed) {
      return results;
    }
  }

  // Test gate
  if (testCommand) {
    const testResult = await runGate('test', testCommand, cwd, testTimeoutMs, outputBudget);
    results.push(testResult);
  }

  return results;
}

/**
 * Check if any gate failed.
 */
export function hasGateFailure(results: GateResult[]): boolean {
  return results.some(r => !r.passed);
}

/**
 * Get the first failed gate result, or null if all passed.
 */
export function getFirstFailure(results: GateResult[]): GateResult | null {
  return results.find(r => !r.passed) ?? null;
}

/**
 * Format gate results for human-readable output (logs, evidence).
 */
export function formatGateResults(results: GateResult[]): string {
  if (results.length === 0) return 'No gates configured';

  return results.map(r => {
    const status = r.passed ? 'PASS' : 'FAIL';
    const duration = `${(r.durationMs / 1000).toFixed(1)}s`;
    return `[${status}] ${r.gate} (${duration}): ${r.command}\n${r.output}`;
  }).join('\n\n');
}
