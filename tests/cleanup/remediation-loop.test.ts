/**
 * Phase 11: Cleanup Ergonomics & Operator Remediation Loop
 *
 * Tests that cleanup tool outputs include actionable IDs and remediation hints,
 * forming a closed loop: report → stale/audit → resolve → report.
 *
 * These tests replicate the output-building logic from the MCP tool handlers
 * in src/server.ts to verify formatting changes without spinning up a full server.
 */

import { describe, it, expect } from 'vitest';
import {
  getRetentionZone,
  getArchiveCandidates,
  getRetentionSummary,
  explainRetention,
} from '../../src/memory/retention.js';
import type { MemorixDocument } from '../../src/types.js';

// ── Helpers ──

function makeDoc(overrides: Partial<MemorixDocument> = {}): MemorixDocument {
  return {
    id: 'obs-1',
    observationId: 1,
    entityName: 'test-entity',
    type: 'what-changed',
    title: 'Test observation',
    narrative: 'Test narrative',
    facts: '',
    filesModified: '',
    concepts: '',
    tokens: 50,
    createdAt: new Date().toISOString(),
    projectId: 'test-project',
    accessCount: 0,
    lastAccessedAt: '',
    status: 'active',
    source: 'agent',
    sourceDetail: '',
    valueCategory: '',
    ...overrides,
  };
}

function daysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

// ── Stale output builder (mirrors server.ts memorix_retention action="stale") ──

function buildStaleOutput(staleDocs: MemorixDocument[]): string {
  if (staleDocs.length === 0) {
    return '✅ No stale observations. All active memories are within 50% of their retention period.';
  }
  const staleLines: string[] = [
    `## Stale Observations (${staleDocs.length})`,
    '',
    '| ID | Entity | Title | Age | Source | Retention | Why |',
    '|----|--------|-------|-----|--------|-----------|-----|',
  ];
  for (const d of staleDocs) {
    const exp = explainRetention(d);
    const src = d.sourceDetail || '—';
    const vc = d.valueCategory || '—';
    staleLines.push(
      `| ${d.observationId} | ${d.entityName} | ${d.title} | ${exp.ageDays}d | ${src} (${vc}) | ${exp.effectiveRetentionDays}d | ${exp.summary} |`,
    );
  }
  staleLines.push('');
  staleLines.push('> 💡 Stale = past 50% of effective retention. Review or access to keep; otherwise will become archive candidates.');

  // Actionable IDs block
  const staleIds = staleDocs.map(d => d.observationId);
  staleLines.push('');
  staleLines.push('### Suggested Actions');
  staleLines.push(`Suggested IDs: [${staleIds.join(', ')}]`);
  staleLines.push(`- Archive stale observations: \`memorix_resolve\` with \`ids: [${staleIds.join(', ')}]\` and \`status: "archived"\``);
  staleLines.push('- Or review individually with `memorix_detail` before deciding.');

  return staleLines.join('\n');
}

// ── Report output builder (mirrors server.ts memorix_retention action="report") ──

function buildReportOutput(docs: MemorixDocument[]): string {
  const summary = getRetentionSummary(docs);
  const candidates = getArchiveCandidates(docs);

  const lines: string[] = [
    `## Memory Retention Status`,
    ``,
    `| Zone | Count |`,
    `|------|-------|`,
    `| Active | ${summary.active} |`,
    `| Stale | ${summary.stale} |`,
    `| Archive Candidates | ${summary.archiveCandidates} |`,
    `| Immune | ${summary.immune} |`,
    `| **Total** | **${docs.length}** |`,
  ];

  if (candidates.length > 0) {
    lines.push('');
    lines.push(`### Archive Candidates (${candidates.length})`);
    const candidateIds = candidates.map(c => c.observationId);
    lines.push('');
    lines.push(`Candidate IDs: [${candidateIds.slice(0, 20).join(', ')}]${candidateIds.length > 20 ? ` … (${candidateIds.length} total)` : ''}`);
    lines.push(`> 💡 Use \`memorix_retention\` with \`action: "archive"\` to move all, or \`memorix_resolve\` with specific IDs.`);
  }

  return lines.join('\n');
}

// ── Audit output builder (mirrors server.ts memorix_audit_project) ──

interface MockAuditEntry {
  id: number;
  entityName: string;
  title: string;
  source: string;
  sourceDetail?: string;
  likelyBelongsTo: string;
  count: number;
  confidence: string;
}

function buildAuditOutput(entries: MockAuditEntry[], projectId: string): string {
  if (entries.length === 0) {
    return `✅ No suspicious observations found in project "${projectId}".`;
  }

  const lines: string[] = [
    `## Attribution Audit — ${projectId}`,
    `Found **${entries.length}** potentially mis-attributed observation(s).\n`,
    '| ID | Entity | Title | Source | Detail | Likely Belongs To | Count | Confidence |',
    '|----|--------|-------|--------|--------|-------------------|-------|------------|',
  ];

  for (const e of entries) {
    lines.push(
      `| #${e.id} | ${e.entityName} | ${e.title} | ${e.source} | ${e.sourceDetail ?? '-'} | ${e.likelyBelongsTo} | ${e.count} | ${e.confidence} |`,
    );
  }

  // Actionable IDs block
  const auditIds = entries.map(e => e.id);
  const auditPreview = auditIds.slice(0, 20);
  const auditSummary = `[${auditPreview.join(', ')}]${auditIds.length > 20 ? ` … (${auditIds.length} total)` : ''}`;
  lines.push('');
  lines.push('### Suggested Actions');
  lines.push(`Suggested IDs: ${auditSummary}`);
  lines.push('- Archive confirmed mis-attributed observations: use `memorix_resolve` with the specific IDs above and `status: "archived"`.');
  lines.push('- Review first with `memorix_detail` if unsure.');

  return lines.join('\n');
}

// ── Resolve output builder (mirrors server.ts memorix_resolve) ──

function buildResolveOutput(resolved: number[], notFound: number[]): string {
  const parts: string[] = [];
  if (resolved.length > 0) {
    parts.push(`✅ Resolved ${resolved.length} observation(s): #${resolved.join(', #')}`);
  }
  if (notFound.length > 0) {
    parts.push(`⚠️ Not found: #${notFound.join(', #')}`);
  }
  parts.push('\nResolved memories are hidden from default search. Use status="all" to include them.');
  parts.push('📊 Run `memorix_retention` with `action: "report"` to check remaining cleanup status.');
  return parts.join('\n');
}

// ── Tests ──

describe('Phase 11: Cleanup Remediation Loop', () => {

  describe('memorix_retention action="stale" output', () => {
    it('should include Suggested IDs block with observation IDs', () => {
      // what-changed type has 30d retention, so 20d old = stale (>50%)
      const staleDocs = [
        makeDoc({ observationId: 42, createdAt: daysAgo(20), type: 'what-changed', entityName: 'auth-module' }),
        makeDoc({ observationId: 78, createdAt: daysAgo(25), type: 'what-changed', entityName: 'db-schema', id: 'obs-2' }),
      ];
      // Verify they are actually stale
      expect(getRetentionZone(staleDocs[0])).toBe('stale');
      expect(getRetentionZone(staleDocs[1])).toBe('stale');

      const output = buildStaleOutput(staleDocs);
      expect(output).toContain('Suggested IDs: [42, 78]');
      expect(output).toContain('### Suggested Actions');
      expect(output).toContain('memorix_resolve');
      expect(output).toContain('status: "archived"');
      expect(output).toContain('memorix_detail');
    });

    it('should not include actionable block when no stale observations', () => {
      const output = buildStaleOutput([]);
      expect(output).not.toContain('Suggested IDs');
      expect(output).not.toContain('### Suggested Actions');
      expect(output).toContain('No stale observations');
    });
  });

  describe('memorix_retention action="report" output', () => {
    it('should include Candidate IDs summary for archive candidates', () => {
      // what-changed type = 30d retention, 35d old = archive-candidate (>100%)
      const docs = [
        makeDoc({ observationId: 12, createdAt: daysAgo(35), type: 'what-changed' }),
        makeDoc({ observationId: 34, createdAt: daysAgo(40), type: 'what-changed', id: 'obs-2' }),
        makeDoc({ observationId: 99, createdAt: daysAgo(1), type: 'decision', id: 'obs-3' }),
      ];
      expect(getRetentionZone(docs[0])).toBe('archive-candidate');
      expect(getRetentionZone(docs[1])).toBe('archive-candidate');
      expect(getRetentionZone(docs[2])).toBe('active');

      const output = buildReportOutput(docs);
      expect(output).toContain('Candidate IDs: [12, 34]');
      expect(output).toContain('memorix_resolve');
    });

    it('should not include Candidate IDs when no archive candidates', () => {
      const docs = [
        makeDoc({ observationId: 1, createdAt: daysAgo(1), type: 'decision' }),
      ];
      const output = buildReportOutput(docs);
      expect(output).not.toContain('Candidate IDs');
    });

    it('should stay concise — no Suggested Actions section in report', () => {
      const docs = [
        makeDoc({ observationId: 12, createdAt: daysAgo(35), type: 'what-changed' }),
      ];
      const output = buildReportOutput(docs);
      // report should NOT have the verbose "### Suggested Actions" block
      expect(output).not.toContain('### Suggested Actions');
    });
  });

  describe('memorix_audit_project output', () => {
    it('should include Suggested IDs block with audit entry IDs', () => {
      const entries: MockAuditEntry[] = [
        { id: 23, entityName: 'wrong-entity', title: 'Misplaced obs', source: 'agent', likelyBelongsTo: 'other-project', count: 5, confidence: 'high' },
        { id: 45, entityName: 'another-wrong', title: 'Also wrong', source: 'hook', sourceDetail: 'hook', likelyBelongsTo: 'other-project', count: 3, confidence: 'medium' },
      ];
      const output = buildAuditOutput(entries, 'my-project');
      expect(output).toContain('Suggested IDs: [23, 45]');
      expect(output).toContain('### Suggested Actions');
      expect(output).toContain('memorix_resolve');
      expect(output).toContain('status: "archived"');
      expect(output).toContain('memorix_detail');
    });

    it('should cap Suggested IDs display for large audit result sets', () => {
      const entries = Array.from({ length: 25 }, (_, i) => ({
        id: i + 1,
        entityName: `entity-${i + 1}`,
        title: `Wrong obs ${i + 1}`,
        source: 'agent',
        likelyBelongsTo: 'other-project',
        count: 3,
        confidence: 'medium',
      }));
      const output = buildAuditOutput(entries, 'my-project');
      expect(output).toContain('Suggested IDs: [1, 2, 3, 4, 5');
      expect(output).toContain('… (25 total)');
      expect(output).not.toContain('`ids: [1, 2, 3');
    });

    it('should not include actionable block when no suspicious entries', () => {
      const output = buildAuditOutput([], 'my-project');
      expect(output).not.toContain('Suggested IDs');
      expect(output).not.toContain('### Suggested Actions');
      expect(output).toContain('No suspicious observations');
    });
  });

  describe('memorix_resolve output', () => {
    it('should include remediation loop hint back to retention report', () => {
      const output = buildResolveOutput([42, 78], []);
      expect(output).toContain('Resolved 2 observation(s)');
      expect(output).toContain('memorix_retention');
      expect(output).toContain('action: "report"');
      expect(output).toContain('remaining cleanup status');
    });

    it('should include remediation hint even when some IDs not found', () => {
      const output = buildResolveOutput([42], [99]);
      expect(output).toContain('Not found: #99');
      expect(output).toContain('memorix_retention');
    });
  });
});
