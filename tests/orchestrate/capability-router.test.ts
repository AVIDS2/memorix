import { describe, it, expect } from 'vitest';
import {
  pickAdapter,
  parseRoutingOverrides,
  extractRoleFromDescription,
  extractRole,
  buildRoutingDecision,
  buildIdleReasons,
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

  describe('extractRole', () => {
    it('should prefer metadata.role over description text', () => {
      const task = { description: '[Role: Engineer] Build something', metadata: { role: 'reviewer' } };
      expect(extractRole(task)).toBe('reviewer');
    });

    it('should fall back to description when metadata.role is absent', () => {
      const task = { description: '[Role: Engineer] Build something', metadata: {} };
      expect(extractRole(task)).toBe('engineer');
    });

    it('should fall back to description when metadata is null', () => {
      const task = { description: '[Role: QA Tester] Test everything', metadata: null };
      expect(extractRole(task)).toBe('qa');
    });

    it('should parse JSON string metadata', () => {
      const task = { description: '[Role: Engineer] Build something', metadata: '{"role":"pm"}' };
      expect(extractRole(task)).toBe('pm');
    });

    it('should handle invalid JSON metadata gracefully', () => {
      const task = { description: '[Role: Engineer] Build something', metadata: 'not-json' };
      expect(extractRole(task)).toBe('engineer');
    });

    it('should default to engineer when no role found anywhere', () => {
      const task = { description: 'Just do the thing', metadata: null };
      expect(extractRole(task)).toBe('engineer');
    });
  });

  describe('buildRoutingDecision', () => {
    it('should report default_preference when top-ranked adapter selected', () => {
      const selected = claude;
      const decision = buildRoutingDecision('pm', [codex, claude, gemini], selected);
      expect(decision.role).toBe('pm');
      expect(decision.selected).toBe('claude');
      expect(decision.reason).toBe('default_preference');
    });

    it('should report cli_override when selected via user override', () => {
      const selected = codex;
      const config = { overrides: { pm: ['codex'] } };
      const decision = buildRoutingDecision('pm', [claude, codex], selected, config);
      expect(decision.reason).toBe('cli_override');
    });

    it('should report quota_fallback when preferred adapter at capacity', () => {
      const selected = gemini; // 2nd preference for pm, claude is at capacity
      const config = { quotaMap: { claude: 1, gemini: 2 } };
      const decision = buildRoutingDecision('pm', [claude, gemini], selected, config, { claude: 1, gemini: 0 });
      expect(decision.reason).toBe('quota_fallback');
    });

    it('should report excluded_failed when preferred adapter excluded', () => {
      const selected = gemini; // 2nd preference for pm, claude excluded
      const decision = buildRoutingDecision('pm', [claude, gemini], selected, undefined, undefined, new Set(['claude']));
      expect(decision.reason).toBe('excluded_failed');
    });

    it('should report last_resort for fallback selection', () => {
      const unknown = mockAdapter('unknown-agent');
      const decision = buildRoutingDecision('pm', [unknown], unknown);
      expect(decision.reason).toBe('last_resort');
    });

    it('should include available adapter names', () => {
      const decision = buildRoutingDecision('pm', [codex, claude, gemini], claude);
      expect(decision.available).toEqual(['codex', 'claude', 'gemini']);
    });
  });

  describe('buildIdleReasons', () => {
    it('should report idle agents with preference rank reason', () => {
      const dispatched = new Set(['claude']);
      const reasons = buildIdleReasons([claude, codex, gemini], dispatched);
      expect(reasons).toHaveLength(2);
      expect(reasons.find(r => r.name === 'codex')?.reason).toContain('preference rank');
      expect(reasons.find(r => r.name === 'gemini')?.reason).toContain('preference rank');
    });

    it('should report excluded agents', () => {
      const dispatched = new Set(['claude']);
      const reasons = buildIdleReasons([claude, codex, gemini], dispatched, undefined, new Set(['codex']));
      const codexReason = reasons.find(r => r.name === 'codex');
      expect(codexReason?.reason).toContain('excluded');
    });

    it('should return empty when all agents dispatched', () => {
      const dispatched = new Set(['claude', 'codex', 'gemini']);
      const reasons = buildIdleReasons([claude, codex, gemini], dispatched);
      expect(reasons).toHaveLength(0);
    });
  });

  describe('balanced scheduling', () => {
    it('should rotate among equally-preferred adapters', () => {
      const opencode = mockAdapter('opencode');
      const config = { scheduling: 'balanced' as const, overrides: { engineer: ['codex', 'claude', 'opencode'] } };
      // First call: codex (index 0)
      const r1 = pickAdapter('engineer', [codex, claude, opencode], undefined, config);
      expect(r1.name).toBe('codex');
      // Second call: claude (index 1)
      const r2 = pickAdapter('engineer', [codex, claude, opencode], undefined, config);
      expect(r2.name).toBe('claude');
      // Third call: opencode (index 2)
      const r3 = pickAdapter('engineer', [codex, claude, opencode], undefined, config);
      expect(r3.name).toBe('opencode');
      // Fourth call: wraps back to codex (index 0)
      const r4 = pickAdapter('engineer', [codex, claude, opencode], undefined, config);
      expect(r4.name).toBe('codex');
    });

    it('should use best-fit by default', () => {
      const opencode = mockAdapter('opencode');
      const config = { overrides: { engineer: ['codex', 'claude', 'opencode'] } };
      // Both calls should return codex (first preference)
      const r1 = pickAdapter('engineer', [codex, claude, opencode], undefined, config);
      const r2 = pickAdapter('engineer', [codex, claude, opencode], undefined, config);
      expect(r1.name).toBe('codex');
      expect(r2.name).toBe('codex');
    });
  });
});
