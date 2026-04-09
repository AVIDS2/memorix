import { describe, expect, it } from 'vitest';

import {
  CONTROL_PLANE_HEALTH_PATH,
  isLikelyMemorixServeHttpCommand,
  isMemorixBackgroundProcess,
} from '../../src/cli/commands/control-plane-shared.js';

describe('control-plane-shared', () => {
  it('uses the team API as the HTTP control-plane health endpoint', () => {
    expect(CONTROL_PLANE_HEALTH_PATH).toBe('/api/team');
  });

  it('recognizes memorix serve-http commands', () => {
    expect(isLikelyMemorixServeHttpCommand('node /tmp/memorix serve-http --port 3211')).toBe(true);
    expect(isLikelyMemorixServeHttpCommand('/opt/homebrew/bin/node /Users/ravi/.bun/bin/memorix serve-http --port 3211')).toBe(true);
  });

  it('rejects unrelated commands for PID reuse checks', () => {
    expect(isLikelyMemorixServeHttpCommand('node some-other-server.js')).toBe(false);
    expect(isLikelyMemorixServeHttpCommand('memorix serve')).toBe(false);
  });

  it('only treats a pid as memorix when the inspected command matches serve-http', () => {
    expect(isMemorixBackgroundProcess(123, () => 'node /Users/test/.bun/bin/memorix serve-http --port 3211')).toBe(true);
    expect(isMemorixBackgroundProcess(123, () => 'node unrelated.js')).toBe(false);
  });
});
