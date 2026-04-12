import { describe, it, expect } from 'vitest';
import {
  createLedger,
  appendEntry,
  ledgerToPromptSection,
  type LedgerEntry,
} from '../../src/orchestrate/ledger.js';

function makeEntry(overrides: Partial<LedgerEntry> = {}): LedgerEntry {
  return {
    taskId: 'task-1',
    role: 'engineer',
    agent: 'claude',
    status: 'completed',
    summary: 'Built the landing page HTML/CSS',
    outputFiles: ['index.html'],
    durationMs: 60_000,
    timestamp: Date.now(),
    ...overrides,
  };
}

describe('ledger', () => {
  describe('createLedger', () => {
    it('should create an empty ledger', () => {
      const l = createLedger('pipe-1', 'Build a game', 'PM then Eng then QA', 5);
      expect(l.pipelineId).toBe('pipe-1');
      expect(l.entries).toHaveLength(0);
      expect(l.totalTasks).toBe(5);
    });
  });

  describe('appendEntry', () => {
    it('should append entries', () => {
      const l = createLedger('pipe-1', 'goal', 'plan', 3);
      appendEntry(l, makeEntry());
      appendEntry(l, makeEntry({ taskId: 'task-2', role: 'qa', status: 'failed' }));
      expect(l.entries).toHaveLength(2);
    });

    it('should clamp summary to 200 chars', () => {
      const l = createLedger('pipe-1', 'goal', 'plan', 3);
      const longSummary = 'x'.repeat(300);
      appendEntry(l, makeEntry({ summary: longSummary }));
      expect(l.entries[0].summary.length).toBeLessThanOrEqual(200);
      expect(l.entries[0].summary).toMatch(/\.\.\.$/);
    });
  });

  describe('ledgerToPromptSection', () => {
    it('should render non-empty ledger', () => {
      const l = createLedger('pipe-1', 'Build a game', 'PM writes spec, Eng builds', 5);
      appendEntry(l, makeEntry({ role: 'pm', summary: 'Wrote spec' }));
      appendEntry(l, makeEntry({ role: 'engineer', summary: 'Built HTML' }));

      const section = ledgerToPromptSection(l);
      expect(section).toContain('Pipeline Progress');
      expect(section).toContain('Build a game');
      expect(section).toContain('Wrote spec');
      expect(section).toContain('Built HTML');
      expect(section).toContain('2 completed');
    });

    it('should render empty ledger', () => {
      const l = createLedger('pipe-1', 'goal', 'plan', 3);
      const section = ledgerToPromptSection(l);
      expect(section).toContain('Pipeline Progress');
      expect(section).toContain('0 completed');
      expect(section).toContain('3 remaining');
    });

    it('should include task position when provided', () => {
      const l = createLedger('pipe-1', 'goal', 'plan', 5);
      appendEntry(l, makeEntry());
      const section = ledgerToPromptSection(l, { taskIndex: 2 });
      expect(section).toContain('task 3/5');
    });

    it('should truncate when over maxChars', () => {
      const l = createLedger('pipe-1', 'goal', 'plan', 20);
      for (let i = 0; i < 15; i++) {
        appendEntry(l, makeEntry({
          taskId: `task-${i}`,
          summary: `Completed step ${i} of the very complex build process with details`,
        }));
      }
      const section = ledgerToPromptSection(l, { maxChars: 1000 });
      expect(section.length).toBeLessThan(1200); // some slack for formatting
      expect(section).toContain('omitted');
    });
  });
});
