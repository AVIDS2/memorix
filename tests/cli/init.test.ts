import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  getInitScopeDescription,
  getInitTargetDir,
  getInitConfigFilename,
  getInitProjectConfigFilename,
  resolveInitScope,
  shouldOfferDotenv,
} from '../../src/cli/commands/init-shared.js';

describe('init-shared', () => {
  it('defaults to global scope when nothing is specified', () => {
    expect(resolveInitScope({})).toBe('global');
  });

  it('prefers explicit global flag', () => {
    expect(resolveInitScope({ global: true })).toBe('global');
  });

  it('prefers explicit project flag', () => {
    expect(resolveInitScope({ project: true })).toBe('project');
  });

  it('uses selected interactive scope when flags are absent', () => {
    expect(resolveInitScope({}, 'project')).toBe('project');
  });

  it('rejects conflicting global and project flags', () => {
    expect(() => resolveInitScope({ global: true, project: true })).toThrow(
      'Choose either --global or --project, not both.',
    );
  });

  it('returns the correct target dir for global scope', () => {
    expect(getInitTargetDir('global', 'E:/repo', 'C:/Users/tester')).toBe(
      path.join('C:/Users/tester', '.memorix'),
    );
  });

  it('returns the current project dir for project scope', () => {
    expect(getInitTargetDir('project', 'E:/repo', 'C:/Users/tester')).toBe('E:/repo');
  });

  it('describes global scope clearly', () => {
    expect(getInitScopeDescription('global')).toContain('Global defaults');
  });

  it('describes project scope clearly', () => {
    expect(getInitScopeDescription('project')).toContain('Project-level overrides');
  });

  it('offers dotenv files in both supported scopes', () => {
    expect(shouldOfferDotenv('global')).toBe(true);
    expect(shouldOfferDotenv('project')).toBe(true);
  });

  it('uses TOML config filenames for new init flows', () => {
    expect(getInitConfigFilename()).toBe('config.toml');
    expect(getInitProjectConfigFilename()).toBe('memorix.toml');
  });
});

describe('init TOML templates', () => {
  it('shows agent, memory, and embedding lanes in global config with local key slots', async () => {
    const { buildInitTomlConfig } = await import('../../src/cli/commands/init.js');

    const content = buildInitTomlConfig({
      scope: 'global',
      llmProvider: 'custom',
      embeddingProvider: 'api',
      gitAutoHook: false,
      sessionInject: 'minimal',
      date: '2026-06-15',
    });

    expect(content).toContain('[agent]');
    expect(content).toContain('# api_key = "..."');
    expect(content).toContain('[memory.llm]');
    expect(content).toContain('provider = "openai"');
    expect(content).toContain('[embedding]');
    expect(content).toContain('# api_key = "..."');
    expect(content).toContain('Global config may store local credentials');
  });

  it('keeps project config templates secret-free by default', async () => {
    const { buildInitTomlConfig } = await import('../../src/cli/commands/init.js');

    const content = buildInitTomlConfig({
      scope: 'project',
      llmProvider: 'openai',
      embeddingProvider: 'api',
      gitAutoHook: true,
      sessionInject: 'full',
      date: '2026-06-15',
    });

    expect(content).toContain('[agent]');
    expect(content).toContain('[memory.llm]');
    expect(content).toContain('[embedding]');
    expect(content).toContain('Project config should not store credentials');
    expect(content).not.toContain('api_key');
  });
});
