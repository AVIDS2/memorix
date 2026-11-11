import { describe, expect, it } from 'vitest';
import { parseTcpPort, parseTcpPortOrReport } from '../../src/cli/port.js';

describe('CLI TCP port parsing', () => {
  it('uses the supplied port or an explicit default', () => {
    expect(parseTcpPort(undefined, 3211)).toBe(3211);
    expect(parseTcpPort('43222', 3211)).toBe(43222);
    expect(parseTcpPort(' 43222 ', 3211)).toBe(43222);
  });

  it('rejects partial, non-positive, and out-of-range ports', () => {
    for (const value of ['43222junk', '0', '-1', '65536', 'not-a-port']) {
      expect(() => parseTcpPort(value, 3211)).toThrow(/Port must be a whole number/);
    }
  });

  it('reports expected command input errors without throwing a framework stack', () => {
    const messages: string[] = [];

    expect(parseTcpPortOrReport('43222junk', 3211, (message) => messages.push(message))).toBeUndefined();
    expect(messages).toEqual(['Port must be a whole number between 1 and 65535.']);
  });
});
