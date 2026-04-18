import { describe, it, expect } from 'vitest';
import { sanitizeErrorPattern, hashErrorPattern } from '../../src/orchestrate/memorix-bridge.js';

describe('sanitizeErrorPattern', () => {
  it('should replace Windows absolute paths', () => {
    const input = 'Error in C:\\Users\\dev\\project\\src\\index.ts';
    const result = sanitizeErrorPattern(input);
    expect(result).not.toContain('C:\\Users');
    expect(result).toContain('./');
  });

  it('should replace Unix absolute paths', () => {
    const input = 'Error in /home/user/project/src/index.ts';
    const result = sanitizeErrorPattern(input);
    expect(result).not.toContain('/home/user');
    expect(result).toContain('./');
  });

  it('should strip line:column numbers', () => {
    const input = 'src/file.ts:42:10 - error TS2307';
    const result = sanitizeErrorPattern(input);
    expect(result).toContain(':_:_');
    expect(result).not.toContain(':42:10');
  });

  it('should strip "line N" references', () => {
    const input = 'Error at line 42 in module';
    const result = sanitizeErrorPattern(input);
    expect(result).toContain('line _');
    expect(result).not.toContain('line 42');
  });

  it('should strip deep node_modules paths', () => {
    const input = 'at node_modules/@scope/package/dist/index.js:10:5';
    const result = sanitizeErrorPattern(input);
    expect(result).toContain('node_modules/...');
  });
});

describe('hashErrorPattern', () => {
  it('should generate consistent hash for same error', () => {
    const h1 = hashErrorPattern('Error: Cannot find module foo');
    const h2 = hashErrorPattern('Error: Cannot find module foo');
    expect(h1).toBe(h2);
  });

  it('should generate different hash for different errors', () => {
    const h1 = hashErrorPattern('Error: Cannot find module foo');
    const h2 = hashErrorPattern('Error: Type mismatch in bar');
    expect(h1).not.toBe(h2);
  });

  it('should produce 12-char hex string', () => {
    const h = hashErrorPattern('some error');
    expect(h).toMatch(/^[0-9a-f]{12}$/);
  });

  it('should normalize paths before hashing (same error, different paths)', () => {
    const h1 = hashErrorPattern('Error in C:\\Users\\alice\\project\\src\\file.ts:42:10');
    const h2 = hashErrorPattern('Error in C:\\Users\\bob\\project\\src\\file.ts:99:5');
    expect(h1).toBe(h2);
  });
});
