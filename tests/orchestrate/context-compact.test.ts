import { describe, it, expect } from 'vitest';
import { compactLedgerEntries, compactFixHistory, compactPipelineContext, type LedgerEntry, type FixAttemptRecord } from '../../src/orchestrate/context-compact.js';

const makeEntry = (i: number, status: 'completed' | 'failed' = 'completed'): LedgerEntry => ({
  taskId: `task-${i}`, role: `engineer`, agent: 'claude',
  status, summary: `Did thing ${i}`, durationMs: 5000 * i,
});

describe('compactLedgerEntries', () => {
  it('should return full entries when within limit', () => {
    const entries = [makeEntry(1), makeEntry(2)];
    const result = compactLedgerEntries(entries, { maxFullEntries: 5, fixHistoryBudget: 2000, pipelineCompactThreshold: 20, recentTaskWindow: 5 });
    expect(result).toContain('Did thing 1');
    expect(result).toContain('Did thing 2');
  });

  it('should compact older entries beyond limit', () => {
    const entries = Array.from({ length: 10 }, (_, i) => makeEntry(i + 1));
    const result = compactLedgerEntries(entries, { maxFullEntries: 3, fixHistoryBudget: 2000, pipelineCompactThreshold: 20, recentTaskWindow: 5 });
    expect(result).toContain('compacted');
    expect(result).toContain('Recent tasks');
  });
});

describe('compactFixHistory', () => {
  it('should return empty for no attempts', () => {
    expect(compactFixHistory([])).toBe('');
  });

  it('should return full detail for single attempt', () => {
    const attempts: FixAttemptRecord[] = [
      { attempt: 1, gate: 'compile', errorOutput: 'TS2307', fixOutput: 'Added import', passed: false },
    ];
    const result = compactFixHistory(attempts);
    expect(result).toContain('Attempt 1');
    expect(result).toContain('TS2307');
  });

  it('should summarize older and show latest for multiple attempts', () => {
    const attempts: FixAttemptRecord[] = [
      { attempt: 1, gate: 'compile', errorOutput: 'TS2307', fixOutput: 'Added import', passed: false },
      { attempt: 2, gate: 'compile', errorOutput: 'TS2345', fixOutput: 'Changed type', passed: false },
      { attempt: 3, gate: 'compile', errorOutput: 'TS2345', fixOutput: 'Fixed type cast', passed: true },
    ];
    const result = compactFixHistory(attempts);
    expect(result).toContain('Previous fix attempts');
    expect(result).toContain('Latest attempt');
  });
});

describe('compactPipelineContext', () => {
  it('should use basic compaction for small pipelines', () => {
    const entries = Array.from({ length: 5 }, (_, i) => makeEntry(i + 1));
    const result = compactPipelineContext(entries);
    expect(result).toContain('Did thing 1');
  });

  it('should apply pipeline-level compaction for large pipelines', () => {
    const entries = Array.from({ length: 25 }, (_, i) => makeEntry(i + 1, i % 5 === 0 ? 'failed' : 'completed'));
    const result = compactPipelineContext(entries, { maxFullEntries: 5, fixHistoryBudget: 2000, pipelineCompactThreshold: 20, recentTaskWindow: 5 });
    expect(result).toContain('Pipeline progress');
    expect(result).toContain('25 total tasks');
    expect(result).toContain('Recent tasks');
  });
});
