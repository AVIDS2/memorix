import { describe, it, expect } from 'vitest';
import { trimToBudget, trimAndPersist } from '../../src/orchestrate/output-budget.js';
import { join } from 'node:path';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

describe('trimToBudget', () => {
  it('should return text unchanged when within budget', () => {
    const text = 'Hello World';
    expect(trimToBudget(text, 100)).toBe(text);
  });

  it('should trim text exceeding budget with head+tail', () => {
    const text = 'A'.repeat(1000);
    const trimmed = trimToBudget(text, 200);
    expect(trimmed.length).toBeLessThanOrEqual(250); // Some overhead from marker
    expect(trimmed).toContain('bytes omitted');
    expect(trimmed.startsWith('A')).toBe(true);
    expect(trimmed.endsWith('A')).toBe(true);
  });

  it('should handle very small budget', () => {
    const text = 'A'.repeat(1000);
    const trimmed = trimToBudget(text, 50);
    expect(trimmed.length).toBeLessThanOrEqual(60);
  });
});

describe('trimAndPersist', () => {
  it('should not persist when text is within budget', () => {
    const result = trimAndPersist('Hello', '/tmp/unused', 100);
    expect(result.trimmed).toBe('Hello');
    expect(result.persisted).toBe(false);
  });

  it('should persist full text to file and return trimmed version', () => {
    const dir = mkdtempSync(join(tmpdir(), 'output-budget-'));
    const filePath = join(dir, 'output.txt');
    const text = 'X'.repeat(1000);
    const result = trimAndPersist(text, filePath, 200);

    expect(result.persisted).toBe(true);
    expect(result.fullPath).toBe(filePath);
    expect(result.trimmed.length).toBeLessThan(text.length);
    expect(result.trimmed).toContain('bytes omitted');

    // Verify file was written
    const onDisk = readFileSync(filePath, 'utf-8');
    expect(onDisk).toBe(text);

    rmSync(dir, { recursive: true });
  });
});
