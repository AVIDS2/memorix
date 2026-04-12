import { describe, it, expect } from 'vitest';
import {
  pickAdapter,
  parseRoutingOverrides,
  extractRoleFromDescription,
} from '../../src/orchestrate/capability-router.js';
import type { AgentAdapter } from '../../src/orchestrate/adapters/types.js';

function mockAdapter(name: string): AgentAdapter {
  return {
    name,
    available: async () => true,
    spawn: () => ({ pid: 0, completion: Promise.resolve({ exitCode: 0, signal: null, tailOutput: '', killed: false }), abort: () => {} }),
  };
}

describe('capability-router', () => {
  const claude = mockAdapter('claude');
  const codex = mockAdapter('codex');
  const gemini = mockAdapter('gemini');

  describe('pickAdapter', () => {
    it('should prefer claude for pm role', () => {
      const result = pickAdapter('pm', [codex, claude, gemini]);
      expect(result.name).toBe('claude');
    });

    it('should prefer codex for engineer role', () => {
      const result = pickAdapter('engineer', [claude, codex, gemini]);
      expect(result.name).toBe('codex');
    });

    it('should skip busy adapters', () => {
      const result = pickAdapter('engineer', [claude, codex, gemini], new Set(['codex']));
      expect(result.name).toBe('claude');
    });

    it('should fallback to first available if all preferred are busy', () => {
      const result = pickAdapter('pm', [codex], new Set(['claude', 'gemini']));
      expect(result.name).toBe('codex');
    });

    it('should respect user overrides', () => {
      const result = pickAdapter('pm', [claude, codex], undefined, {
        overrides: { pm: ['codex'] },
      });
      expect(result.name).toBe('codex');
    });

    it('should throw if no adapters available', () => {
      expect(() => pickAdapter('pm', [])).toThrow('no adapters available');
    });

    it('should handle unknown role gracefully', () => {
      const result = pickAdapter('designer', [claude, codex]);
      // Should fall back to first available
      expect(['claude', 'codex']).toContain(result.name);
    });
  });

  describe('parseRoutingOverrides', () => {
    it('should parse simple overrides', () => {
      const result = parseRoutingOverrides('pm=claude,engineer=codex');
      expect(result).toEqual({ pm: ['claude'], engineer: ['codex'] });
    });

    it('should parse multi-agent overrides with +', () => {
      const result = parseRoutingOverrides('engineer=codex+claude');
      expect(result).toEqual({ engineer: ['codex', 'claude'] });
    });

    it('should return empty for empty string', () => {
      expect(parseRoutingOverrides('')).toEqual({});
    });
  });

  describe('extractRoleFromDescription', () => {
    it('should extract PM role', () => {
      expect(extractRoleFromDescription('[Role: PM / UX Planner] Write spec')).toBe('pm');
    });

    it('should extract Engineer role', () => {
      expect(extractRoleFromDescription('[Role: Engineer] Build the page')).toBe('engineer');
    });

    it('should extract Reviewer role', () => {
      expect(extractRoleFromDescription('[Role: Reviewer — Quality Gate] Review')).toBe('reviewer');
    });

    it('should extract QA role', () => {
      expect(extractRoleFromDescription('[Role: QA Tester] Test everything')).toBe('qa');
    });

    it('should default to engineer if no role found', () => {
      expect(extractRoleFromDescription('Just do the thing')).toBe('engineer');
    });
  });
});
