import { describe, it, expect } from 'vitest';
import { sanitize, sanitizeRecord } from '../../src/workspace/sanitizer.js';

describe('sanitize', () => {
  it('should mask GitHub PAT (fine-grained)', () => {
    const input = 'GITHUB_PERSONAL_ACCESS_TOKEN = "github_pat_11XXXXX0XyA8BPkOvAvC_FAKE_TOKEN_FOR_TEST_lHZ4QoF5jyJpdJUtE1ykEsS2YVRAGA3QV7Abx3"';
    const result = sanitize(input);
    expect(result).toContain('github_pat_***');
    expect(result).not.toContain('11BJBW2HI');
  });

  it('should mask GitHub PAT (classic ghp_)', () => {
    const input = '"token": "ghp_aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789"';
    const result = sanitize(input);
    expect(result).toContain('ghp_***');
  });

  it('should mask Context7 API keys', () => {
    const input = '"CONTEXT7_API_KEY": "ctx7sk-8dd2767f-9304-4114-87b0-8416dd8b469a"';
    const result = sanitize(input);
    expect(result).toContain('ctx7sk-***');
    expect(result).not.toContain('8dd2767f');
  });

  it('should mask OpenAI-style keys', () => {
    const input = 'sk-proj-abcdefghijklmnopqrstuvwxyz12345678';
    const result = sanitize(input);
    expect(result).toContain('sk-***');
  });

  it('should not mask short strings or normal text', () => {
    const input = 'command = "npx"\nargs = ["-y", "memorix"]';
    expect(sanitize(input)).toBe(input);
  });

  it('should mask generic long tokens in quotes', () => {
    const input = '"bearer_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9abcdefghijk"';
    const result = sanitize(input);
    expect(result).toContain('"***"');
  });
});

describe('sanitizeRecord', () => {
  it('should mask values with sensitive key names', () => {
    const record = {
      GITHUB_PERSONAL_ACCESS_TOKEN: 'ghp_abc123',
      API_KEY: 'some-secret',
      NORMAL_SETTING: 'hello',
    };
    const result = sanitizeRecord(record)!;
    expect(result.GITHUB_PERSONAL_ACCESS_TOKEN).toBe('***');
    expect(result.API_KEY).toBe('***');
    expect(result.NORMAL_SETTING).toBe('hello');
  });

  it('should return undefined for null/undefined', () => {
    expect(sanitizeRecord(null)).toBeUndefined();
    expect(sanitizeRecord(undefined)).toBeUndefined();
  });
});
