import { describe, expect, it } from 'vitest';
import { isToolInProfile } from '../../src/server/tool-profile.js';

describe('context pack tool profile', () => {
  it('exposes context pack and codegraph status in lite, team, and full profiles', () => {
    for (const profile of ['lite', 'team', 'full'] as const) {
      expect(isToolInProfile('memorix_project_context', profile)).toBe(true);
      expect(isToolInProfile('memorix_context_pack', profile)).toBe(true);
      expect(isToolInProfile('memorix_codegraph_status', profile)).toBe(true);
    }
  });
});
