export const DEFAULT_FORMATION_TIMEOUT_MS = 12_000;
export const FORMATION_TIMEOUT_MIN_MS = 1_000;
export const FORMATION_TIMEOUT_MAX_MS = 300_000;

/**
 * Parse and validate MEMORIX_FORMATION_TIMEOUT_MS.
 * - Must be a valid integer in the range 1000-300000ms.
 * - Invalid values fall back to the default and log a warning.
 * - Out-of-range values are clamped to the nearest bound.
 * Default: 12000ms (12s).
 */
export function parseFormationTimeoutMs(raw: string | undefined): number {
  const value = raw?.trim();
  if (!value) return DEFAULT_FORMATION_TIMEOUT_MS;

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || Number.isNaN(parsed)) {
    console.warn(
      `[memorix] MEMORIX_FORMATION_TIMEOUT_MS="${raw}" is invalid (must be a positive integer between ${FORMATION_TIMEOUT_MIN_MS}-${FORMATION_TIMEOUT_MAX_MS}ms). Using default ${DEFAULT_FORMATION_TIMEOUT_MS}ms.`,
    );
    return DEFAULT_FORMATION_TIMEOUT_MS;
  }

  if (parsed < FORMATION_TIMEOUT_MIN_MS) return FORMATION_TIMEOUT_MIN_MS;
  if (parsed > FORMATION_TIMEOUT_MAX_MS) return FORMATION_TIMEOUT_MAX_MS;
  return parsed;
}
