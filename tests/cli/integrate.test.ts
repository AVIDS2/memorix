import { describe, expect, it } from 'vitest';

import {
  getIntegrationScopeLabel,
  getIntegrationTargetRoot,
} from '../../src/cli/commands/integrate-shared.js';

describe('integrate-shared', () => {
  it('uses cwd for project integrations', () => {
    expect(getIntegrationTargetRoot(false, 'E:/repo')).toBe('E:/repo');
  });

  it('uses user home for global integrations', () => {
    expect(getIntegrationTargetRoot(true, 'E:/repo', 'C:/Users/tester')).toBe('C:/Users/tester');
  });

  it('labels project integrations clearly', () => {
    expect(getIntegrationScopeLabel(false)).toBe('current project');
  });

  it('labels global integrations clearly', () => {
    expect(getIntegrationScopeLabel(true)).toBe('global defaults');
  });
});
