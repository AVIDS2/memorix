import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { getCliVersion } from '../../src/cli/version.js';

describe('CLI version wiring', () => {
  it('returns a valid semver string', () => {
    expect(getCliVersion()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('does not runtime-require package.json from the bundled TUI entry', () => {
    const src = readFileSync(
      join(__dirname, '../../src/cli/tui/index.ts'),
      'utf-8',
    );

    expect(src).not.toContain("../../../package.json");
    expect(src).toContain('getCliVersion');
  });
});
