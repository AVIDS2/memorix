import { describe, it, expect, vi, beforeEach } from 'vitest';
import { collectPlanningContext, contextToPromptSection } from '../../src/orchestrate/context-collector.js';
import * as cp from 'node:child_process';
import * as fs from 'node:fs';

vi.mock('node:child_process', () => ({
  execSync: vi.fn(),
}));

vi.mock('node:fs', () => ({
  readFileSync: vi.fn(),
  existsSync: vi.fn(),
}));

describe('context-collector', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe('collectPlanningContext', () => {
    it('should collect file tree via git ls-files', () => {
      vi.mocked(cp.execSync).mockImplementation((cmd: string) => {
        if (cmd.includes('ls-files')) return 'src/index.ts\nsrc/main.ts\npackage.json';
        if (cmd.includes('git log')) return 'abc1234 initial commit';
        return '';
      });
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const ctx = collectPlanningContext({ projectDir: '/fake', agents: ['claude'] });
      expect(ctx.fileTree).toContain('src/index.ts');
      expect(ctx.agents).toEqual(['claude']);
    });

    it('should truncate file tree to maxFileTreeEntries', () => {
      const files = Array.from({ length: 200 }, (_, i) => `file${i}.ts`).join('\n');
      vi.mocked(cp.execSync).mockImplementation((cmd: string) => {
        if (cmd.includes('ls-files')) return files;
        return '';
      });
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const ctx = collectPlanningContext({ projectDir: '/fake', agents: [], maxFileTreeEntries: 10 });
      const lines = ctx.fileTree.split('\n');
      expect(lines).toHaveLength(11); // 10 files + "... (190 more files)"
      expect(ctx.fileTree).toContain('190 more files');
    });

    it('should collect dependencies from package.json', () => {
      vi.mocked(cp.execSync).mockReturnValue('');
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({
        dependencies: { react: '^18', zod: '^3' },
        devDependencies: { vitest: '^1' },
      }));

      const ctx = collectPlanningContext({ projectDir: '/fake', agents: [] });
      expect(ctx.dependencies).toContain('react');
      expect(ctx.dependencies).toContain('vitest');
    });

    it('should return empty strings when commands fail', () => {
      vi.mocked(cp.execSync).mockImplementation(() => { throw new Error('not a git repo'); });
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const ctx = collectPlanningContext({ projectDir: '/fake', agents: ['codex'] });
      expect(ctx.fileTree).toBe('');
      expect(ctx.dependencies).toBe('');
      expect(ctx.gitLog).toBe('');
      expect(ctx.agents).toEqual(['codex']);
    });
  });

  describe('contextToPromptSection', () => {
    it('should format non-empty context', () => {
      const section = contextToPromptSection({
        fileTree: 'src/index.ts',
        dependencies: 'dependencies: react',
        gitLog: 'abc initial',
        agents: ['claude', 'codex'],
      });
      expect(section).toContain('# Project Context');
      expect(section).toContain('## Project Structure');
      expect(section).toContain('## Dependencies');
      expect(section).toContain('## Recent Git History');
      expect(section).toContain('## Available Agents');
    });

    it('should return empty string when all fields are empty', () => {
      const section = contextToPromptSection({
        fileTree: '',
        dependencies: '',
        gitLog: '',
        agents: [],
      });
      expect(section).toBe('');
    });
  });
});
