import { describe, expect, it } from 'vitest';
import { countToolsInProfile, isToolInProfile, resolveToolProfile } from '../../src/server/tool-profile.js';

describe('context pack tool profile', () => {
  it('exposes context pack and codegraph status in micro, lite, team, and full profiles', () => {
    for (const profile of ['micro', 'lite', 'team', 'full'] as const) {
      expect(isToolInProfile('memorix_project_context', profile)).toBe(true);
      expect(isToolInProfile('memorix_context_pack', profile)).toBe(true);
      expect(isToolInProfile('memorix_codegraph_status', profile)).toBe(true);
    }
  });

  it('keeps the default micro profile compact enough for agent tool lists', () => {
    expect(countToolsInProfile('micro')).toBeLessThan(countToolsInProfile('lite'));
    expect(countToolsInProfile('micro')).toBeLessThanOrEqual(8);
    expect(isToolInProfile('memorix_store', 'micro')).toBe(true);
    expect(isToolInProfile('memorix_search', 'micro')).toBe(true);
    expect(isToolInProfile('memorix_detail', 'micro')).toBe(true);
    expect(isToolInProfile('memorix_session_end', 'micro')).toBe(false);
    expect(isToolInProfile('memorix_transfer', 'micro')).toBe(false);
    expect(isToolInProfile('team_manage', 'micro')).toBe(false);
  });

  it('resolves micro as a valid explicit and environment profile', () => {
    expect(resolveToolProfile({ explicit: 'micro', envValue: null, fallback: 'lite' })).toBe('micro');
    expect(resolveToolProfile({ explicit: null, envValue: 'micro', fallback: 'lite' })).toBe('micro');
  });
});
