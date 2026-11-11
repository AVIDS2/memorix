// Rules Syncer Tests — TDD RED Phase
//
// Tests the core sync logic:
// - Scan project for rule files across all agents
// - Deduplicate rules by content hash
// - Detect conflicts (same scope, different content from different sources)
// - Generate output for target agent format

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { RulesSyncer } from '../../src/rules/syncer.js';
import type { UnifiedRule } from '../../src/types.js';

let testDir: string;

beforeEach(async () => {
  testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'memorix-syncer-'));
});

afterEach(async () => {
  await fs.rm(testDir, { recursive: true, force: true });
});

// Helper: write a file in testDir
async function writeFile(relativePath: string, content: string) {
  const fullPath = path.join(testDir, relativePath);
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.writeFile(fullPath, content, 'utf-8');
}

describe('RulesSyncer', () => {
  describe('scanRules', () => {
    it('should scan .cursorrules file', async () => {
      await writeFile('.cursorrules', '- Use TypeScript strict mode');
      const syncer = new RulesSyncer(testDir);
      const rules = await syncer.scanRules();
      expect(rules.length).toBeGreaterThanOrEqual(1);
      expect(rules.some(r => r.source === 'cursor')).toBe(true);
    });

    it('should scan CLAUDE.md file', async () => {
      await writeFile('CLAUDE.md', '# Rules\n- Write tests first');
      const syncer = new RulesSyncer(testDir);
      const rules = await syncer.scanRules();
      expect(rules.some(r => r.source === 'claude-code')).toBe(true);
    });

    it('should scan .windsurf/rules/*.md files', async () => {
      await writeFile('.windsurf/rules/style.md', '---\ndescription: "Style"\n---\n- Use semicolons');
      const syncer = new RulesSyncer(testDir);
      const rules = await syncer.scanRules();
      expect(rules.some(r => r.source === 'windsurf')).toBe(true);
    });

    it('should scan .cursor/rules/*.mdc files', async () => {
      await writeFile('.cursor/rules/api.mdc', '---\ndescription: "API rules"\nalwaysApply: false\n---\n- Validate inputs');
      const syncer = new RulesSyncer(testDir);
      const rules = await syncer.scanRules();
      expect(rules.some(r => r.source === 'cursor' && r.content.includes('Validate'))).toBe(true);
    });

    it('should scan multiple sources simultaneously', async () => {
      await writeFile('.cursorrules', '- Rule from Cursor');
      await writeFile('CLAUDE.md', '- Rule from Claude');
      await writeFile('.windsurfrules', '- Rule from Windsurf');

      const syncer = new RulesSyncer(testDir);
      const rules = await syncer.scanRules();
      expect(rules.length).toBe(3);

      const sources = new Set(rules.map(r => r.source));
      expect(sources.has('cursor')).toBe(true);
      expect(sources.has('claude-code')).toBe(true);
      expect(sources.has('windsurf')).toBe(true);
    });

    it('should return empty array for project with no rule files', async () => {
      const syncer = new RulesSyncer(testDir);
      const rules = await syncer.scanRules();
      expect(rules).toEqual([]);
    });
  });

  describe('deduplicateRules', () => {
    it('should remove duplicate rules with same content hash', () => {
      const syncer = new RulesSyncer(testDir);
      const rules: UnifiedRule[] = [
        { id: 'cursor:r1', content: '- Use TypeScript', source: 'cursor', scope: 'project', priority: 5, hash: 'same-hash' },
        { id: 'windsurf:r2', content: '- Use TypeScript', source: 'windsurf', scope: 'project', priority: 5, hash: 'same-hash' },
      ];

      const deduped = syncer.deduplicateRules(rules);
      expect(deduped).toHaveLength(1);
    });

    it('should keep rules with different content', () => {
      const syncer = new RulesSyncer(testDir);
      const rules: UnifiedRule[] = [
        { id: 'cursor:r1', content: '- Use TypeScript', source: 'cursor', scope: 'project', priority: 5, hash: 'hash-a' },
        { id: 'windsurf:r2', content: '- Use ESLint', source: 'windsurf', scope: 'project', priority: 5, hash: 'hash-b' },
      ];

      const deduped = syncer.deduplicateRules(rules);
      expect(deduped).toHaveLength(2);
    });

    it('should prefer higher priority rule when deduplicating', () => {
      const syncer = new RulesSyncer(testDir);
      const rules: UnifiedRule[] = [
        { id: 'cursor:r1', content: '- Same rule', source: 'cursor', scope: 'project', priority: 3, hash: 'same' },
        { id: 'claude:r2', content: '- Same rule', source: 'claude-code', scope: 'global', priority: 10, hash: 'same' },
      ];

      const deduped = syncer.deduplicateRules(rules);
      expect(deduped).toHaveLength(1);
      expect(deduped[0].priority).toBe(10);
    });
  });

  describe('detectConflicts', () => {
    it('should detect no conflicts when rules are unique', () => {
      const syncer = new RulesSyncer(testDir);
      const rules: UnifiedRule[] = [
        { id: 'r1', content: '- Rule A', source: 'cursor', scope: 'project', priority: 5, hash: 'a' },
        { id: 'r2', content: '- Rule B', source: 'windsurf', scope: 'project', priority: 5, hash: 'b' },
      ];

      const conflicts = syncer.detectConflicts(rules);
      expect(conflicts).toHaveLength(0);
    });

    it('should detect conflicts for overlapping path-specific rules', () => {
      const syncer = new RulesSyncer(testDir);
      const rules: UnifiedRule[] = [
        { id: 'r1', content: '- Use tabs', source: 'cursor', scope: 'path-specific', paths: ['src/**/*.ts'], priority: 5, hash: 'a' },
        { id: 'r2', content: '- Use spaces', source: 'claude-code', scope: 'path-specific', paths: ['src/**/*.ts'], priority: 5, hash: 'b' },
      ];

      const conflicts = syncer.detectConflicts(rules);
      expect(conflicts.length).toBeGreaterThanOrEqual(1);
      expect(conflicts[0].ruleA.id).toBe('r1');
      expect(conflicts[0].ruleB.id).toBe('r2');
    });
  });

  describe('generateForTarget', () => {
    it('should generate rules in cursor format', () => {
      const syncer = new RulesSyncer(testDir);
      const rules: UnifiedRule[] = [
        { id: 'test-1', content: '- TypeScript strict', description: 'TS rules', source: 'claude-code', scope: 'project', priority: 5, hash: 'x' },
      ];

      const files = syncer.generateForTarget(rules, 'cursor');
      expect(files.length).toBeGreaterThanOrEqual(1);
      expect(files[0].filePath).toMatch(/\.cursor\/rules\/.*\.mdc$/);
    });

    it('should generate rules in claude-code format', () => {
      const syncer = new RulesSyncer(testDir);
      const rules: UnifiedRule[] = [
        { id: 'test-1', content: '- Use ESM', source: 'cursor', scope: 'project', priority: 5, hash: 'y' },
      ];

      const files = syncer.generateForTarget(rules, 'claude-code');
      expect(files.some(f => f.filePath.includes('CLAUDE.md'))).toBe(true);
    });

    it('should generate rules in codex SKILL.md format', () => {
      const syncer = new RulesSyncer(testDir);
      const rules: UnifiedRule[] = [
        { id: 'test-1', content: '# TDD Skill\nWrite tests first.', description: 'TDD skill', source: 'windsurf', scope: 'project', priority: 5, hash: 'z' },
      ];

      const files = syncer.generateForTarget(rules, 'codex');
      expect(files[0].filePath).toMatch(/\.agents\/skills\/.*\/SKILL\.md$/);
    });

    it('should generate rules in windsurf format', () => {
      const syncer = new RulesSyncer(testDir);
      const rules: UnifiedRule[] = [
        { id: 'test-1', content: '- Lint before commit', source: 'cursor', scope: 'project', priority: 5, hash: 'w' },
      ];

      const files = syncer.generateForTarget(rules, 'windsurf');
      expect(files[0].filePath).toMatch(/\.windsurf\/rules\/.*\.md$/);
    });
  });

  describe('syncStatus', () => {
    it('should report status with sources, rule count, and conflicts', async () => {
      await writeFile('.cursorrules', '- Use TypeScript');
      await writeFile('CLAUDE.md', '- Write tests');

      const syncer = new RulesSyncer(testDir);
      const status = await syncer.syncStatus();

      expect(status.totalRules).toBe(2);
      expect(status.sources).toContain('cursor');
      expect(status.sources).toContain('claude-code');
      expect(status.conflicts).toEqual([]);
      expect(status.uniqueRules).toBe(2);
    });
  });

  describe('end-to-end: scan → dedup → generate', () => {
    it('should sync rules from cursor to windsurf format', async () => {
      await writeFile('.cursorrules', '- Always use TypeScript strict mode');
      await writeFile('.cursor/rules/api.mdc', '---\ndescription: "API standards"\nalwaysApply: false\n---\n- Validate all inputs\n- Return proper error codes');

      const syncer = new RulesSyncer(testDir);
      const rules = await syncer.scanRules();
      const deduped = syncer.deduplicateRules(rules);
      const output = syncer.generateForTarget(deduped, 'windsurf');

      expect(output.length).toBeGreaterThanOrEqual(1);
      // All output should be windsurf format
      for (const file of output) {
        expect(file.filePath).toMatch(/\.windsurf\/rules\/.*\.md$/);
      }
    });
  });
});
