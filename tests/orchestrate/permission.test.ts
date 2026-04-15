import { describe, it, expect } from 'vitest';
import { classifyTool, TaskToolTracker, compareTiers } from '../../src/orchestrate/permission.js';

describe('classifyTool', () => {
  it('should classify read_file as safe', () => {
    expect(classifyTool('read_file')).toBe('safe');
  });

  it('should classify edit as moderate', () => {
    expect(classifyTool('edit')).toBe('moderate');
  });

  it('should classify run_command as dangerous', () => {
    expect(classifyTool('run_command')).toBe('dangerous');
  });

  it('should classify unknown tool as moderate by default', () => {
    expect(classifyTool('some_unknown_tool')).toBe('moderate');
  });

  it('should use heuristic for tools with delete in name', () => {
    expect(classifyTool('delete_something')).toBe('dangerous');
  });

  it('should use heuristic for tools with write in name', () => {
    expect(classifyTool('write_something')).toBe('moderate');
  });
});

describe('TaskToolTracker', () => {
  it('should track tool usage', () => {
    const tracker = new TaskToolTracker('task-1');
    tracker.record('read_file');
    tracker.record('read_file');
    tracker.record('edit');

    const profile = tracker.getProfile();
    expect(profile.totalCalls).toBe(3);
    expect(profile.maxTier).toBe('moderate');
    expect(profile.tools).toHaveLength(2);
  });

  it('should detect dangerous tier', () => {
    const tracker = new TaskToolTracker('task-2');
    tracker.record('read_file');
    tracker.record('run_command');

    const profile = tracker.getProfile();
    expect(profile.maxTier).toBe('dangerous');
  });

  it('should handle empty tracker', () => {
    const tracker = new TaskToolTracker('task-3');
    const profile = tracker.getProfile();
    expect(profile.totalCalls).toBe(0);
    expect(profile.maxTier).toBe('safe');
  });

  it('should format summary', () => {
    const tracker = new TaskToolTracker('task-4');
    tracker.record('run_command');
    tracker.record('run_command');
    const summary = tracker.formatSummary();
    expect(summary).toContain('dangerous');
    expect(summary).toContain('run_command');
    expect(summary).toContain('2x');
  });
});

describe('compareTiers', () => {
  it('should order safe < moderate < dangerous', () => {
    expect(compareTiers('safe', 'moderate')).toBeLessThan(0);
    expect(compareTiers('moderate', 'dangerous')).toBeLessThan(0);
    expect(compareTiers('safe', 'dangerous')).toBeLessThan(0);
    expect(compareTiers('dangerous', 'safe')).toBeGreaterThan(0);
    expect(compareTiers('safe', 'safe')).toBe(0);
  });
});
