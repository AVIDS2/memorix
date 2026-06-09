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
export declare function parseMemoryRef(input: string | number): MemoryRef;
/**
 * Serialize a MemoryRef to its canonical string form.
 *
 * Examples:
 *   { kind: 'obs', id: 42 }                    → "obs:42"
 *   { kind: 'skill', id: 3 }                   → "skill:3"
 *   { kind: 'obs', id: 42, projectId: 'o/p' }  → "obs:42@o/p"
 */
export declare function serializeMemoryRef(ref: MemoryRef): string;
/**
 * Format a MemoryRef for human-readable display.
 *
 * Short forms:
 *   obs:42  → "#42"
 *   skill:3 → "S3"
 */
export declare function displayRef(ref: MemoryRef): string;
//# sourceMappingURL=refs.d.ts.map