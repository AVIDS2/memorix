/**
 * Typed Memory Reference Protocol (Phase 3a)
 *
 * Provides a formal, unambiguous way to reference memory objects
 * (observations and mini-skills) across internal code and the MCP API.
 *
 * String format:
 *   obs:42          — observation #42
 *   skill:3         — mini-skill #3
 *   obs:42@org/proj — observation #42 in project org/proj
 *
 * Legacy support:
 *   42   (bare number)  → obs:42
 *   "42" (bare string)  → obs:42
 *
 * Display short forms (presentation only):
 *   #42  — observation
 *   S3   — mini-skill
 */

import type { MemoryRef } from '../types.js';

// ── Parsing ──────────────────────────────────────────────────────

const TYPED_REF_RE = /^(obs|skill):(\d+)(?:@(.+))?$/;

/**
 * Parse a typed memory reference from a string or number.
 *
 * Accepts:
 *   - "obs:42", "skill:3", "obs:42@org/proj"
 *   - 42 (bare number → obs:42)
 *   - "42" (bare numeric string → obs:42)
 *
 * Throws on invalid input.
 */
export function parseMemoryRef(input: string | number): MemoryRef {
  // Bare number → legacy observation ref
  if (typeof input === 'number') {
    if (!Number.isInteger(input) || input < 0) {
      throw new Error(`Invalid memory ref: ${input} (must be a non-negative integer)`);
    }
    return { kind: 'obs', id: input };
  }

  const trimmed = input.trim();

  // Bare numeric string → legacy observation ref
  if (/^\d+$/.test(trimmed)) {
    return { kind: 'obs', id: parseInt(trimmed, 10) };
  }

  // Typed ref: obs:42 or skill:3 or obs:42@org/proj
  const match = trimmed.match(TYPED_REF_RE);
  if (!match) {
    throw new Error(
      `Invalid memory ref: "${input}". Expected format: obs:<id>, skill:<id>, obs:<id>@<projectId>, or a bare number.`,
    );
  }

  const kind = match[1] as 'obs' | 'skill';
  const id = parseInt(match[2], 10);
  const projectId = match[3] || undefined;

  return { kind, id, projectId };
}

// ── Serialization ────────────────────────────────────────────────

/**
 * Serialize a MemoryRef to its canonical string form.
 *
 * Examples:
 *   { kind: 'obs', id: 42 }                    → "obs:42"
 *   { kind: 'skill', id: 3 }                   → "skill:3"
 *   { kind: 'obs', id: 42, projectId: 'o/p' }  → "obs:42@o/p"
 */
export function serializeMemoryRef(ref: MemoryRef): string {
  const base = `${ref.kind}:${ref.id}`;
  return ref.projectId ? `${base}@${ref.projectId}` : base;
}

// ── Display ──────────────────────────────────────────────────────

/**
 * Format a MemoryRef for human-readable display.
 *
 * Short forms:
 *   obs:42  → "#42"
 *   skill:3 → "S3"
 */
export function displayRef(ref: MemoryRef): string {
  return ref.kind === 'obs' ? `#${ref.id}` : `S${ref.id}`;
}
