import { describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_PROJECT_DETECTION_CACHE_TTL_MS,
  createCachedProjectDetector,
} from '../../src/cli/commands/project-detection-cache.js';

const project = { id: 'local/demo', name: 'demo', rootPath: '/repo/demo' };

describe('createCachedProjectDetector', () => {
  it('runs detection once per path within the TTL, including negative results', () => {
    const detect = vi.fn((root: string) => (root === '/repo/demo' ? project : null));
    let clock = 0;
    const cached = createCachedProjectDetector(detect, { now: () => clock });

    expect(cached('/repo/demo')).toEqual(project);
    expect(cached('/not-a-repo')).toBeNull();
    clock += DEFAULT_PROJECT_DETECTION_CACHE_TTL_MS - 1;
    expect(cached('/repo/demo')).toEqual(project);
    expect(cached('/not-a-repo')).toBeNull();
    expect(detect).toHaveBeenCalledTimes(2);
  });

  it('detects again once the TTL has elapsed', () => {
    const detect = vi.fn((): typeof project | null => null);
    let clock = 0;
    const cached = createCachedProjectDetector(detect, { ttlMs: 1_000, now: () => clock });

    expect(cached('/repo/new')).toBeNull();
    detect.mockReturnValue(project);
    clock += 1_000;
    expect(cached('/repo/new')).toEqual(project);
    expect(detect).toHaveBeenCalledTimes(2);
  });

  it('keeps at most maxEntries paths, evicting the oldest', () => {
    const detect = vi.fn(() => null);
    const cached = createCachedProjectDetector(detect, { maxEntries: 2 });

    cached('/a');
    cached('/b');
    cached('/c');
    expect(cached.size()).toBe(2);
    cached('/b');
    cached('/c');
    expect(detect).toHaveBeenCalledTimes(3);
    cached('/a');
    expect(detect).toHaveBeenCalledTimes(4);
    cached.clear();
    expect(cached.size()).toBe(0);
  });
});
