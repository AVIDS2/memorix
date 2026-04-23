import { describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_FORMATION_TIMEOUT_MS,
  FORMATION_TIMEOUT_MAX_MS,
  FORMATION_TIMEOUT_MIN_MS,
  parseFormationTimeoutMs,
} from '../../src/server/formation-timeout.js';

describe('parseFormationTimeoutMs', () => {
  it('returns default when env var is undefined', () => {
    expect(parseFormationTimeoutMs(undefined)).toBe(DEFAULT_FORMATION_TIMEOUT_MS);
  });

  it('returns default when env var is empty', () => {
    expect(parseFormationTimeoutMs('')).toBe(DEFAULT_FORMATION_TIMEOUT_MS);
    expect(parseFormationTimeoutMs('   ')).toBe(DEFAULT_FORMATION_TIMEOUT_MS);
  });

  it('parses a valid positive integer', () => {
    expect(parseFormationTimeoutMs('45000')).toBe(45_000);
  });

  it('falls back to default and warns on invalid values', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(parseFormationTimeoutMs('not-a-number')).toBe(DEFAULT_FORMATION_TIMEOUT_MS);
    expect(parseFormationTimeoutMs('1500.5')).toBe(DEFAULT_FORMATION_TIMEOUT_MS);

    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('clamps too-small values to the minimum', () => {
    expect(parseFormationTimeoutMs('0')).toBe(FORMATION_TIMEOUT_MIN_MS);
    expect(parseFormationTimeoutMs('-10')).toBe(FORMATION_TIMEOUT_MIN_MS);
    expect(parseFormationTimeoutMs('999')).toBe(FORMATION_TIMEOUT_MIN_MS);
  });

  it('clamps too-large values to the maximum', () => {
    expect(parseFormationTimeoutMs('999999')).toBe(FORMATION_TIMEOUT_MAX_MS);
  });
});
