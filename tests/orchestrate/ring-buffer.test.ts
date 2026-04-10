/**
 * RingBuffer — bounded line buffer tests.
 */

import { describe, it, expect } from 'vitest';
import { RingBuffer } from '../../src/orchestrate/ring-buffer.js';

describe('RingBuffer', () => {
  it('should store lines up to maxLines', () => {
    const buf = new RingBuffer(3);
    buf.push('line1\nline2\nline3');
    expect(buf.length).toBe(3);
    expect(buf.toString()).toBe('line1\nline2\nline3');
  });

  it('should evict oldest lines when exceeding maxLines', () => {
    const buf = new RingBuffer(2);
    buf.push('a\nb\nc\nd');
    expect(buf.length).toBe(2);
    expect(buf.getLines()).toEqual(['c', 'd']);
  });

  it('should skip empty lines', () => {
    const buf = new RingBuffer(10);
    buf.push('hello\n\n\nworld\n  \n');
    expect(buf.getLines()).toEqual(['hello', 'world']);
  });

  it('should handle multiple push calls', () => {
    const buf = new RingBuffer(5);
    buf.push('first');
    buf.push('second');
    buf.push('third');
    expect(buf.getLines()).toEqual(['first', 'second', 'third']);
  });

  it('should clear all lines', () => {
    const buf = new RingBuffer(5);
    buf.push('data');
    buf.clear();
    expect(buf.length).toBe(0);
    expect(buf.toString()).toBe('');
  });

  it('should return copy from getLines', () => {
    const buf = new RingBuffer(5);
    buf.push('a');
    const lines = buf.getLines();
    lines.push('mutated');
    expect(buf.length).toBe(1); // original unaffected
  });
});
