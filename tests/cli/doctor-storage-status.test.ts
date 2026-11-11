import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import os from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';

const detectProjectMock = vi.fn();
const initObservationStoreMock = vi.fn();
const getObservationStoreMock = vi.fn();

let tempDir: string | undefined;

vi.mock('../../src/project/detector.js', () => ({
  detectProjectWithDiagnostics: detectProjectMock,
}));

vi.mock('../../src/store/obs-store.js', () => ({
  initObservationStore: initObservationStoreMock,
  getObservationStore: getObservationStoreMock,
}));

afterEach(() => {
  vi.clearAllMocks();
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = undefined;
});

function captureJson(): { lines: string[] } {
  const lines: string[] = [];
  vi.spyOn(console, 'log').mockImplementation((value?: unknown) => {
    lines.push(String(value));
  });
  return { lines };
}

async function runDoctor(): Promise<Record<string, unknown>> {
  const { lines } = captureJson();
  const doctor = (await import('../../src/cli/commands/doctor.js')).default;
  await doctor.run?.({ args: { json: true } } as never);
  const payload = lines.find((l) => l.trimStart().startsWith('{'));
  return payload ? JSON.parse(payload) : {};
}

/**
 * `doctor` must never present an unreadable store as an empty one.
 *
 * Reporting "0 observations" with an [OK] marker is indistinguishable from a
 * project that genuinely has no memories yet, so an operator has no signal
 * that persistence is broken.
 */
describe('doctor storage status', () => {
  it('reports a failure when the observation store cannot be opened', async () => {
    tempDir = mkdtempSync(join(os.tmpdir(), 'memorix-doctor-'));
    detectProjectMock.mockReturnValue({
      project: {
        id: 'local/probe',
        name: 'probe',
        rootPath: tempDir,
        dataDir: tempDir,
        gitRemote: '',
      },
    });
    initObservationStoreMock.mockRejectedValue(new Error('database is locked'));

    const report = await runDoctor();
    const issues = (report.issues ?? []) as string[];

    expect(issues.some((i) => /could not be opened|database is locked/i.test(i))).toBe(true);
  });

  it('reports a failure when the store falls back to the degraded backend', async () => {
    tempDir = mkdtempSync(join(os.tmpdir(), 'memorix-doctor-'));
    detectProjectMock.mockReturnValue({
      project: {
        id: 'local/probe',
        name: 'probe',
        rootPath: tempDir,
        dataDir: tempDir,
        gitRemote: '',
      },
    });
    initObservationStoreMock.mockResolvedValue(undefined);
    getObservationStoreMock.mockReturnValue({
      getBackendName: () => 'degraded',
      loadAll: async () => [],
    });

    const report = await runDoctor();
    const issues = (report.issues ?? []) as string[];

    expect(issues.some((i) => /SQLite backend unavailable/i.test(i))).toBe(true);
  });
});
