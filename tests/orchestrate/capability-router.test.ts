import { describe, it, expect } from 'vitest';
import {
  pickAdapter,
  parseRoutingOverrides,
  extractRoleFromDescription,
} from '../../src/orchestrate/capability-router.js';
import { parseAgentQuotas, buildQuotaMap } from '../../src/orchestrate/adapters/index.js';
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

  describe('parseAgentQuotas', () => {
    it('should parse quota syntax', () => {
      const result = parseAgentQuotas('claude:2,codex:1,gemini:3');
      expect(result).toEqual([
        { name: 'claude', quota: 2 },
        { name: 'codex', quota: 1 },
        { name: 'gemini', quota: 3 },
      ]);
    });

    it('should default quota to 1 for plain names', () => {
      const result = parseAgentQuotas('claude,codex');
      expect(result).toEqual([
        { name: 'claude', quota: 1 },
        { name: 'codex', quota: 1 },
      ]);
    });

    it('should handle mixed syntax', () => {
      const result = parseAgentQuotas('claude:2,codex');
      expect(result).toEqual([
        { name: 'claude', quota: 2 },
        { name: 'codex', quota: 1 },
      ]);
    });

    it('should skip unknown adapters', () => {
      const result = parseAgentQuotas('claude,unknown:3');
      expect(result).toEqual([{ name: 'claude', quota: 1 }]);
    });
  });

  describe('buildQuotaMap', () => {
    it('should build map from quotas', () => {
      const map = buildQuotaMap([
        { name: 'claude', quota: 2 },
        { name: 'codex', quota: 1 },
      ]);
      expect(map).toEqual({ claude: 2, codex: 1 });
    });
  });

  describe('pickAdapter with quotaMap', () => {
    const opencode = mockAdapter('opencode');

    it('should respect per-type quota limits', () => {
      const config = { quotaMap: { claude: 2, codex: 1 } };
      // claude has 1 active dispatch (quota 2) → still available
      const result = pickAdapter('pm', [claude, codex], undefined, config, { claude: 1, codex: 0 });
      expect(result.name).toBe('claude');
    });

    it('should skip adapter at quota capacity', () => {
      const config = { quotaMap: { claude: 1, codex: 2 } };
      // claude at capacity (1/1), codex not (0/2) → picks codex
      const result = pickAdapter('pm', [claude, codex], undefined, config, { claude: 1, codex: 0 });
      expect(result.name).toBe('codex');
    });

    it('should fall back to last resort when all at capacity', () => {
      const config = { quotaMap: { claude: 1, codex: 1 } };
      // both at capacity → returns first adapter (last resort)
      const result = pickAdapter('pm', [claude, codex], undefined, config, { claude: 1, codex: 1 });
      expect(result.name).toBe('claude'); // last resort = available[0]
    });

    it('should use quota=1 for adapters not in quotaMap', () => {
      const config = { quotaMap: { claude: 3 } };
      // codex has quota=1 (default), 1 active → full; claude has 3 quota, 2 active → available
      const result = pickAdapter('engineer', [codex, claude], undefined, config, { codex: 1, claude: 2 });
      expect(result.name).toBe('claude');
    });
  });
});
