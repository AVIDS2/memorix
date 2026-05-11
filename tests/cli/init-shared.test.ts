import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { getEnvTemplateTarget } from '../../src/cli/commands/init-shared.js';

describe('getEnvTemplateTarget', () => {
  const targetDir = path.join('C:', 'workspace', 'memorix-project');

  it('uses .env.example when the project does not already have one', () => {
    expect(getEnvTemplateTarget(targetDir, { hasDotenvExample: false }))
      .toBe(path.join(targetDir, '.env.example'));
  });

  it('falls back to .env.memorix-example when .env.example already exists', () => {
    expect(getEnvTemplateTarget(targetDir, { hasDotenvExample: true }))
      .toBe(path.join(targetDir, '.env.memorix-example'));
  });
});
