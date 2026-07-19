import { describe, expect, it } from 'vitest';
import { resolveTaskLens } from '../../src/codegraph/task-lens.js';

describe('task lens routing', () => {
  it('does not treat a prohibited publish command as release intent', () => {
    const task = 'You have just joined this repository to decide what should happen next after an authentication retry incident. Work like a careful maintainer: establish the current project state, identify the safest next action and its verification, and then assess whether the available project context was sufficient, missing, or noisy. Do not edit files, change settings, or run publish commands.';

    expect(resolveTaskLens(task).id).toBe('bugfix');
  });

  it('keeps an explicit release request as release when publishing is deferred', () => {
    expect(resolveTaskLens('Prepare the 1.2.1 release, but do not publish until maintainer approval.').id).toBe('release');
    expect(resolveTaskLens('\u51c6\u5907 1.2.1 \u53d1\u7248\uff0c\u4f46\u4e0d\u8981\u7acb\u5373\u53d1\u5e03\u3002').id).toBe('release');
  });

  it('does not promote a Chinese no-publish instruction to release', () => {
    expect(resolveTaskLens('\u4e0d\u8981\u53d1\u5e03\uff0c\u5148\u6392\u67e5\u8ba4\u8bc1\u6545\u969c\u5e76\u8fd0\u884c\u5b9a\u5411\u6d4b\u8bd5\u3002').id).toBe('bugfix');
  });
});
