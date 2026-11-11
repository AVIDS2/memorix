/**
 * P8-B: Secret Filter tests
 *
 * Covers:
 * - containsCredential detection
 * - sanitizeCredentials / redactCredentials (same logic)
 * - all 5 pattern categories
 * - low-false-positive cases (discussion text, short values)
 */

import { describe, it, expect } from 'vitest';
import { containsCredential, sanitizeCredentials, redactCredentials } from '../../src/memory/secret-filter.js';
// sanitizeCredentials is also exported directly; alias used for the idempotency test
const san = sanitizeCredentials;

describe('containsCredential', () => {
  it('detects password=value', () => {
    expect(containsCredential('password=abc123xyz')).toBe(true);
  });

  it('detects token: "value"', () => {
    expect(containsCredential('token: "supersecrettoken"')).toBe(true);
  });

  it('detects api_key = value', () => {
    expect(containsCredential('api_key = myLongApiKey1234')).toBe(true);
  });

  it('detects Bearer token', () => {
    expect(containsCredential('Authorization: Bearer eyAbc1234567890abcdefgh')).toBe(true);
  });

  it('detects GitHub token', () => {
    expect(containsCredential('ghp_abcdefghijklmnopqrstuvwxyz123456789012')).toBe(true);
  });

  it('detects OpenAI key', () => {
    expect(containsCredential('sk-abcdefghijklmnopqrstuv123456')).toBe(true);
  });

  it('detects JWT', () => {
    expect(containsCredential('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjMifQ.abc')).toBe(true);
  });

  it('does NOT flag discussion text without assignment', () => {
    expect(containsCredential('the password must be at least 8 characters long')).toBe(false);
  });

  it('does NOT flag short values (< 6 chars)', () => {
    expect(containsCredential('pwd=abc')).toBe(false);
  });

  it('does NOT flag empty string', () => {
    expect(containsCredential('')).toBe(false);
  });

  it('does NOT flag generic auth discussion', () => {
    expect(containsCredential('token-based authentication is recommended over sessions')).toBe(false);
  });

  it('does NOT flag api_key concept without value', () => {
    expect(containsCredential('store the api_key in an environment variable')).toBe(false);
  });
});

describe('redactCredentials', () => {
  it('redacts value in password=value, preserves key', () => {
    const result = redactCredentials('password=supersecret99');
    expect(result).toContain('password=');
    expect(result).toContain('[REDACTED]');
    expect(result).not.toContain('supersecret99');
  });

  it('redacts value in token: "value", preserves key', () => {
    const result = redactCredentials('token: "myTokenValue123"');
    expect(result).toContain('token:');
    expect(result).toContain('[REDACTED]');
    expect(result).not.toContain('myTokenValue123');
  });

  it('redacts Bearer token, preserves Bearer prefix', () => {
    const result = redactCredentials('Authorization: Bearer eyAbc1234567890abcdefghijklmnop');
    expect(result).toContain('Bearer [REDACTED]');
  });

  it('redacts GitHub token entirely', () => {
    const token = 'ghp_abcdefghijklmnopqrstuvwxyz123456789012';
    const result = redactCredentials(`my token is ${token} use it`);
    expect(result).toContain('[REDACTED]');
    expect(result).not.toContain(token);
  });

  it('redacts OpenAI key', () => {
    const result = redactCredentials('key = sk-abcdefghijklmnopqrstuv123456');
    expect(result).not.toContain('sk-abcdefghijklmnopqrstuv123456');
  });

  it('does not alter text with no credentials', () => {
    const clean = 'the password must be at least 8 characters long';
    expect(redactCredentials(clean)).toBe(clean);
  });

  it('handles empty string', () => {
    expect(redactCredentials('')).toBe('');
  });

  it('is idempotent: redacting twice gives same result', () => {
    const input = 'password=supersecret99';
    expect(redactCredentials(redactCredentials(input))).toBe(redactCredentials(input));
  });
});

describe('sanitizeCredentials', () => {
  it('same behaviour as redactCredentials (same underlying logic)', () => {
    const input = 'api_key=myLongApiKey1234';
    expect(san(input)).toBe(redactCredentials(input));
  });
});

describe('session summary redaction (P8 coverage)', () => {
  it('redacts credential in session handoff summary', () => {
    const summary = '## Goal\nDeployed blog-VPS. SSH password=hunter2xx used for login.';
    const result = redactCredentials(summary);
    expect(result).not.toContain('hunter2xx');
    expect(result).toContain('[REDACTED]');
    expect(result).toContain('password=');
  });

  it('redacts credential in session history snippet (first line)', () => {
    const firstLine = 'Authorization: Bearer AbcDefGhiJklMnoPqrStuVwxYz12345678901';
    const result = redactCredentials(firstLine);
    expect(result).not.toContain('AbcDefGhiJklMnoPqrStuVwxYz12345678901');
    expect(result).toContain('Bearer [REDACTED]');
  });

  it('sanitizeCredentials applied at endSession write-time prevents storing raw secret', () => {
    const rawSummary = 'Connected to VPS. root password=P@ssw0rdSecret123';
    const stored = sanitizeCredentials(rawSummary);
    expect(stored).not.toContain('P@ssw0rdSecret123');
    expect(stored).toContain('[REDACTED]');
  });
});
