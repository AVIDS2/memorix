/**
 * P9: Attribution Guard tests
 *
 * Covers:
 * - checkProjectAttribution: clean / suspicious / ambiguous / below-threshold
 * - alias-aware grouping: same physical project under two raw IDs
 * - auditProjectObservations: scan returns correct suspicious entries
 * - audit respects alias expansion when filtering the current project's obs
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock alias resolution ──────────────────────────────────────────────────
// We don't have the full alias registry on disk in unit tests.
// Instead, we stub getCanonicalId/resolveAliases to simulate alias groups.

vi.mock('../../src/project/aliases.js', () => {
  // alias map: raw ID → canonical ID
  const aliases: Record<string, string> = {
    'local/blog':    'user/blog',
    'user/blog':     'user/blog',
    'local/relay':   'user/api-relay',
    'user/api-relay':'user/api-relay',
    'user/devlens':  'user/devlens',
  };
  // reverse: canonical → all raw aliases
  const reverseMap: Record<string, string[]> = {
    'user/blog':      ['local/blog', 'user/blog'],
    'user/api-relay': ['local/relay', 'user/api-relay'],
    'user/devlens':   ['user/devlens'],
  };

  return {
    getCanonicalId: vi.fn(async (id: string) => aliases[id] ?? id),
    resolveAliases: vi.fn(async (id: string) => {
      const canonical = aliases[id] ?? id;
      return reverseMap[canonical] ?? [id];
    }),
  };
});

import { checkProjectAttribution, auditProjectObservations } from '../../src/memory/attribution-guard.js';
import type { Observation } from '../../src/types.js';

// ── Helpers ────────────────────────────────────────────────────────────────

function makeObs(
  id: number,
  projectId: string,
  entityName: string,
  opts: Partial<Observation> = {},
): Observation {
  return {
    id,
    projectId,
    entityName,
    type: 'gotcha',
    title: `Title for ${entityName} #${id}`,
    narrative: 'Some narrative.',
    facts: [],
    filesModified: [],
    concepts: [],
    tokens: 20,
    createdAt: new Date().toISOString(),
    status: 'active',
    source: 'agent',
    ...opts,
  } as Observation;
}

// ── checkProjectAttribution ────────────────────────────────────────────────

describe('checkProjectAttribution', () => {
  it('returns not suspicious when entityName exists in current project', async () => {
    const obs = [
      makeObs(1, 'user/blog', 'blog-vps'),
      makeObs(2, 'user/blog', 'blog-vps'),
      makeObs(3, 'user/api-relay', 'api-relay'),
      makeObs(4, 'user/api-relay', 'api-relay'),
    ];
    const result = await checkProjectAttribution('blog-vps', 'user/blog', obs);
    expect(result.suspicious).toBe(false);
  });

  it('returns suspicious when entityName is absent in current project but ≥2× in another', async () => {
    const obs = [
      makeObs(1, 'user/api-relay', 'api-relay'),
      makeObs(2, 'user/api-relay', 'api-relay'),
      makeObs(3, 'user/api-relay', 'api-relay'),
    ];
    const result = await checkProjectAttribution('api-relay', 'user/blog', obs);
    expect(result.suspicious).toBe(true);
    expect(result.knownIn).toBe('user/api-relay');
    expect(result.count).toBe(3);
  });

  it('returns not suspicious when other project count is below threshold', async () => {
    const obs = [
      makeObs(1, 'user/api-relay', 'api-relay'),
    ];
    const result = await checkProjectAttribution('api-relay', 'user/blog', obs, 2);
    expect(result.suspicious).toBe(false);
  });

  it('returns not suspicious when entityName appears in both projects (ambiguous)', async () => {
    const obs = [
      makeObs(1, 'user/blog', 'shared-util'),
      makeObs(2, 'user/api-relay', 'shared-util'),
      makeObs(3, 'user/api-relay', 'shared-util'),
    ];
    const result = await checkProjectAttribution('shared-util', 'user/blog', obs);
    expect(result.suspicious).toBe(false);
  });

  it('returns not suspicious when multiple other projects qualify above threshold', async () => {
    const obs = [
      makeObs(1, 'user/api-relay', 'shared-service'),
      makeObs(2, 'user/api-relay', 'shared-service'),
      makeObs(3, 'user/devlens', 'shared-service'),
      makeObs(4, 'user/devlens', 'shared-service'),
    ];
    const result = await checkProjectAttribution('shared-service', 'user/blog', obs);
    expect(result.suspicious).toBe(false);
  });

  it('returns not suspicious when entity is completely unknown everywhere', async () => {
    const obs = [
      makeObs(1, 'user/api-relay', 'api-relay'),
    ];
    const result = await checkProjectAttribution('brand-new-entity', 'user/blog', obs);
    expect(result.suspicious).toBe(false);
  });

  it('confidence is high when count ≥ 5', async () => {
    const obs = Array.from({ length: 6 }, (_, i) =>
      makeObs(i + 1, 'user/api-relay', 'api-relay'),
    );
    const result = await checkProjectAttribution('api-relay', 'user/blog', obs);
    expect(result.suspicious).toBe(true);
    expect(result.confidence).toBe('high');
  });

  it('confidence is low when count is 2–4', async () => {
    const obs = [
      makeObs(1, 'user/api-relay', 'api-relay'),
      makeObs(2, 'user/api-relay', 'api-relay'),
    ];
    const result = await checkProjectAttribution('api-relay', 'user/blog', obs);
    expect(result.suspicious).toBe(true);
    expect(result.confidence).toBe('low');
  });

  it('is alias-aware: local/relay alias groups with user/api-relay', async () => {
    const obs = [
      makeObs(1, 'local/relay', 'api-relay'),
      makeObs(2, 'user/api-relay', 'api-relay'),
      makeObs(3, 'user/api-relay', 'api-relay'),
    ];
    const result = await checkProjectAttribution('api-relay', 'user/blog', obs);
    expect(result.suspicious).toBe(true);
    // All 3 obs should be counted under same canonical (user/api-relay)
    expect(result.count).toBe(3);
  });

  it('is alias-aware: local/blog and user/blog count as the same project', async () => {
    const obs = [
      makeObs(1, 'local/blog', 'blog-vps'),
      makeObs(2, 'user/api-relay', 'api-relay'),
      makeObs(3, 'user/api-relay', 'api-relay'),
    ];
    // blog-vps exists under local/blog (alias of user/blog) — should not be suspicious
    const result = await checkProjectAttribution('blog-vps', 'user/blog', obs);
    expect(result.suspicious).toBe(false);
  });

  it('ignores archived observations', async () => {
    const obs = [
      makeObs(1, 'user/api-relay', 'api-relay', { status: 'archived' }),
      makeObs(2, 'user/api-relay', 'api-relay', { status: 'archived' }),
    ];
    const result = await checkProjectAttribution('api-relay', 'user/blog', obs);
    expect(result.suspicious).toBe(false);
  });
});

// ── auditProjectObservations ───────────────────────────────────────────────

describe('auditProjectObservations', () => {
  it('returns empty when no suspicious obs in current project', async () => {
    const obs = [
      makeObs(1, 'user/blog', 'blog-vps'),
      makeObs(2, 'user/blog', 'blog-vps'),
      makeObs(3, 'user/api-relay', 'api-relay'),
    ];
    const result = await auditProjectObservations('user/blog', obs);
    expect(result).toHaveLength(0);
  });

  it('flags obs whose entityName is absent in current project but ≥2× in another', async () => {
    const obs = [
      makeObs(1, 'user/blog', 'api-relay'),
      makeObs(2, 'user/api-relay', 'api-relay'),
      makeObs(3, 'user/api-relay', 'api-relay'),
    ];
    const result = await auditProjectObservations('user/blog', obs);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(1);
    expect(result[0].entityName).toBe('api-relay');
    expect(result[0].likelyBelongsTo).toBe('user/api-relay');
    expect(result[0].count).toBe(2);
  });

  it('audit entry contains all required fields', async () => {
    const obs = [
      makeObs(5, 'user/blog', 'api-relay', {
        source: 'agent',
        sourceDetail: 'explicit',
        title: 'Auth bypass bug fix in api-relay',
      }),
      makeObs(6, 'user/api-relay', 'api-relay'),
      makeObs(7, 'user/api-relay', 'api-relay'),
    ];
    const result = await auditProjectObservations('user/blog', obs);
    expect(result).toHaveLength(1);
    const entry = result[0];
    expect(entry.id).toBe(5);
    expect(entry.projectId).toBe('user/blog');
    expect(entry.entityName).toBe('api-relay');
    expect(entry.title).toBe('Auth bypass bug fix in api-relay');
    expect(entry.source).toBe('agent');
    expect(entry.sourceDetail).toBe('explicit');
    expect(entry.likelyBelongsTo).toBeDefined();
    expect(entry.count).toBeGreaterThanOrEqual(2);
    expect(['high', 'low']).toContain(entry.confidence);
  });

  it('is alias-aware: scans obs stored under any alias of current project', async () => {
    const obs = [
      makeObs(10, 'local/blog', 'api-relay'),
      makeObs(11, 'user/api-relay', 'api-relay'),
      makeObs(12, 'user/api-relay', 'api-relay'),
    ];
    // local/blog is an alias of user/blog; audit should include obs #10
    const result = await auditProjectObservations('user/blog', obs);
    expect(result.some(e => e.id === 10)).toBe(true);
  });

  it('does not flag obs when entityName is known in current project too', async () => {
    const obs = [
      makeObs(1, 'user/blog', 'blog-vps'),
      makeObs(2, 'user/blog', 'blog-vps'),
      makeObs(3, 'user/api-relay', 'blog-vps'),
      makeObs(4, 'user/api-relay', 'blog-vps'),
    ];
    const result = await auditProjectObservations('user/blog', obs);
    expect(result).toHaveLength(0);
  });

  it('does not emit audit entries when multiple other projects qualify above threshold', async () => {
    const obs = [
      makeObs(1, 'user/blog', 'shared-service'),
      makeObs(2, 'user/api-relay', 'shared-service'),
      makeObs(3, 'user/api-relay', 'shared-service'),
      makeObs(4, 'user/devlens', 'shared-service'),
      makeObs(5, 'user/devlens', 'shared-service'),
    ];
    const result = await auditProjectObservations('user/blog', obs);
    expect(result).toHaveLength(0);
  });

  it('does not flag archived observations', async () => {
    const obs = [
      makeObs(1, 'user/blog', 'api-relay', { status: 'archived' }),
      makeObs(2, 'user/api-relay', 'api-relay'),
      makeObs(3, 'user/api-relay', 'api-relay'),
    ];
    const result = await auditProjectObservations('user/blog', obs);
    expect(result).toHaveLength(0);
  });
});
