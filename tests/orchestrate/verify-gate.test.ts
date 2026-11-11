/**
 * Verify Gates — Phase 7, Step 1 tests.
 */
import { describe, it, expect } from 'vitest';
import { runGate, runVerifyGates, hasGateFailure, getFirstFailure, formatGateResults, type GateResult } from '../../src/orchestrate/verify-gate.js';

// ── runGate ────────────────────────────────────────────────────────

describe('runGate', () => {
  it('should return passed=true for exit code 0', async () => {
    const result = await runGate('compile', 'node -e "process.exit(0)"', process.cwd(), 10_000);
    expect(result.gate).toBe('compile');
    expect(result.passed).toBe(true);
    expect(result.durationMs).toBeGreaterThan(0);
    expect(result.command).toBe('node -e "process.exit(0)"');
  });

  it('should return passed=false for non-zero exit code', async () => {
    const result = await runGate('test', 'node -e "process.exit(1)"', process.cwd(), 10_000);
    expect(result.gate).toBe('test');
    expect(result.passed).toBe(false);
  });

  it('should capture stdout and stderr in output', async () => {
    const result = await runGate(
      'compile',
      'node -e "console.log(\'hello\'); console.error(\'world\')"',
      process.cwd(),
      10_000,
    );
    expect(result.passed).toBe(true);
    expect(result.output).toContain('hello');
    expect(result.output).toContain('world');
  });

  it('should timeout and return passed=false', async () => {
    // Sleep for 5s, but timeout is 500ms
    const result = await runGate(
      'compile',
      'node -e "setTimeout(() => {}, 10000)"',
      process.cwd(),
      500,
    );
    expect(result.passed).toBe(false);
    expect(result.output).toContain('[TIMEOUT]');
  }, 10_000);

  it('should truncate output to budget', async () => {
    // Generate 10KB of output, budget is 512 bytes
    const result = await runGate(
      'test',
      'node -e "console.log(\'x\'.repeat(10240))"',
      process.cwd(),
      10_000,
      512,
    );
    expect(result.passed).toBe(true);
    expect(result.output.length).toBeLessThanOrEqual(600); // some buffer for encoding
  });

  it('should handle command not found gracefully', async () => {
    const result = await runGate('compile', 'nonexistent_command_xyz_123', process.cwd(), 5_000);
    expect(result.passed).toBe(false);
    // Either the shell reports error or spawn fails
    expect(result.output.length).toBeGreaterThan(0);
  });
});

// ── runVerifyGates ─────────────────────────────────────────────────

describe('runVerifyGates', () => {
  it('should return empty array when no gates configured', async () => {
    const results = await runVerifyGates(process.cwd(), {});
    expect(results).toEqual([]);
  });

  it('should run compile gate only when only compileCommand is set', async () => {
    const results = await runVerifyGates(process.cwd(), {
      compileCommand: 'node -e "process.exit(0)"',
    });
    expect(results).toHaveLength(1);
    expect(results[0].gate).toBe('compile');
    expect(results[0].passed).toBe(true);
  });

  it('should run test gate only when only testCommand is set', async () => {
    const results = await runVerifyGates(process.cwd(), {
      testCommand: 'node -e "process.exit(0)"',
    });
    expect(results).toHaveLength(1);
    expect(results[0].gate).toBe('test');
    expect(results[0].passed).toBe(true);
  });

  it('should run both gates sequentially when both configured', async () => {
    const results = await runVerifyGates(process.cwd(), {
      compileCommand: 'node -e "process.exit(0)"',
      testCommand: 'node -e "process.exit(0)"',
    });
    expect(results).toHaveLength(2);
    expect(results[0].gate).toBe('compile');
    expect(results[1].gate).toBe('test');
    expect(results[0].passed).toBe(true);
    expect(results[1].passed).toBe(true);
  });

  it('should skip test gate when compile gate fails', async () => {
    const results = await runVerifyGates(process.cwd(), {
      compileCommand: 'node -e "process.exit(1)"',
      testCommand: 'node -e "process.exit(0)"',
    });
    expect(results).toHaveLength(1); // Only compile result, test was skipped
    expect(results[0].gate).toBe('compile');
    expect(results[0].passed).toBe(false);
  });

  it('should report test failure when compile passes but test fails', async () => {
    const results = await runVerifyGates(process.cwd(), {
      compileCommand: 'node -e "process.exit(0)"',
      testCommand: 'node -e "console.error(\'test failed\'); process.exit(1)"',
    });
    expect(results).toHaveLength(2);
    expect(results[0].passed).toBe(true);
    expect(results[1].passed).toBe(false);
    expect(results[1].output).toContain('test failed');
  });
});

// ── Helpers ────────────────────────────────────────────────────────

describe('hasGateFailure', () => {
  it('should return false for empty results', () => {
    expect(hasGateFailure([])).toBe(false);
  });

  it('should return false when all pass', () => {
    const results: GateResult[] = [
      { gate: 'compile', passed: true, output: '', durationMs: 100, command: 'tsc' },
      { gate: 'test', passed: true, output: '', durationMs: 200, command: 'vitest' },
    ];
    expect(hasGateFailure(results)).toBe(false);
  });

  it('should return true when any gate fails', () => {
    const results: GateResult[] = [
      { gate: 'compile', passed: true, output: '', durationMs: 100, command: 'tsc' },
      { gate: 'test', passed: false, output: 'FAIL', durationMs: 200, command: 'vitest' },
    ];
    expect(hasGateFailure(results)).toBe(true);
  });
});

describe('getFirstFailure', () => {
  it('should return null for empty results', () => {
    expect(getFirstFailure([])).toBeNull();
  });

  it('should return null when all pass', () => {
    const results: GateResult[] = [
      { gate: 'compile', passed: true, output: '', durationMs: 100, command: 'tsc' },
    ];
    expect(getFirstFailure(results)).toBeNull();
  });

  it('should return the first failed gate', () => {
    const results: GateResult[] = [
      { gate: 'compile', passed: false, output: 'TS2307', durationMs: 100, command: 'tsc' },
      { gate: 'test', passed: false, output: 'FAIL', durationMs: 200, command: 'vitest' },
    ];
    const failure = getFirstFailure(results);
    expect(failure?.gate).toBe('compile');
    expect(failure?.output).toBe('TS2307');
  });
});

describe('formatGateResults', () => {
  it('should return descriptive text for no gates', () => {
    expect(formatGateResults([])).toBe('No gates configured');
  });

  it('should format pass and fail results', () => {
    const results: GateResult[] = [
      { gate: 'compile', passed: true, output: 'OK', durationMs: 1500, command: 'tsc' },
      { gate: 'test', passed: false, output: 'FAIL: 2 tests', durationMs: 3200, command: 'vitest' },
    ];
    const formatted = formatGateResults(results);
    expect(formatted).toContain('[PASS] compile');
    expect(formatted).toContain('[FAIL] test');
    expect(formatted).toContain('1.5s');
    expect(formatted).toContain('3.2s');
  });
});
