/**
 * Typed Memory Reference Protocol — Phase 3a
 */
import { describe, it, expect } from 'vitest';
import { parseMemoryRef, serializeMemoryRef, displayRef } from '../../src/memory/refs.js';

describe('parseMemoryRef', () => {
  it('parses obs:42', () => {
    expect(parseMemoryRef('obs:42')).toEqual({ kind: 'obs', id: 42 });
  });

  it('parses skill:3', () => {
    expect(parseMemoryRef('skill:3')).toEqual({ kind: 'skill', id: 3 });
  });

  it('parses obs:42@org/proj', () => {
    expect(parseMemoryRef('obs:42@org/proj')).toEqual({ kind: 'obs', id: 42, projectId: 'org/proj' });
  });

  it('parses bare number as obs ref (legacy)', () => {
    expect(parseMemoryRef(42)).toEqual({ kind: 'obs', id: 42 });
  });

  it('parses bare numeric string as obs ref (legacy)', () => {
    expect(parseMemoryRef('42')).toEqual({ kind: 'obs', id: 42 });
  });

  it('trims whitespace', () => {
    expect(parseMemoryRef('  obs:10  ')).toEqual({ kind: 'obs', id: 10 });
  });

  it('throws on invalid input', () => {
    expect(() => parseMemoryRef('foo:bar')).toThrow('Invalid memory ref');
    expect(() => parseMemoryRef('')).toThrow('Invalid memory ref');
  });

  it('throws on negative bare number', () => {
    expect(() => parseMemoryRef(-1)).toThrow('non-negative integer');
  });
});

describe('serializeMemoryRef', () => {
  it('serializes obs ref', () => {
    expect(serializeMemoryRef({ kind: 'obs', id: 42 })).toBe('obs:42');
  });

  it('serializes skill ref', () => {
    expect(serializeMemoryRef({ kind: 'skill', id: 3 })).toBe('skill:3');
  });

  it('serializes ref with projectId', () => {
    expect(serializeMemoryRef({ kind: 'obs', id: 42, projectId: 'org/proj' })).toBe('obs:42@org/proj');
  });

  it('round-trips correctly', () => {
    const refs = [
      { kind: 'obs' as const, id: 42 },
      { kind: 'skill' as const, id: 3 },
      { kind: 'obs' as const, id: 1, projectId: 'a/b' },
    ];
    for (const ref of refs) {
      expect(parseMemoryRef(serializeMemoryRef(ref))).toEqual(ref);
    }
  });
});

describe('displayRef', () => {
  it('displays obs as #N', () => {
    expect(displayRef({ kind: 'obs', id: 42 })).toBe('#42');
  });

  it('displays skill as SN', () => {
    expect(displayRef({ kind: 'skill', id: 3 })).toBe('S3');
  });
});
