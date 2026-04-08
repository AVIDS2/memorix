import { describe, it, expect } from 'vitest';
import { parseLLMTimeoutMs } from '../../src/llm/provider.js';

describe('parseLLMTimeoutMs', () => {
  it('returns default when env var is undefined', () => {
    expect(parseLLMTimeoutMs(undefined)).toBe(30_000);
  });

  it('returns default when env var is empty string', () => {
    expect(parseLLMTimeoutMs('')).toBe(30_000);
  });

  it('returns default for non-numeric string', () => {
    expect(parseLLMTimeoutMs('abc')).toBe(30_000);
  });

  it('returns default for float string', () => {
    expect(parseLLMTimeoutMs('1500.5')).toBe(30_000);
  });

  it('returns default for NaN-producing input', () => {
    expect(parseLLMTimeoutMs('NaN')).toBe(30_000);
  });

  it('parses valid integer correctly', () => {
    expect(parseLLMTimeoutMs('60000')).toBe(60_000);
  });

  it('clamps to minimum (1000ms) when value is too small', () => {
    expect(parseLLMTimeoutMs('0')).toBe(1_000);
    expect(parseLLMTimeoutMs('500')).toBe(1_000);
    expect(parseLLMTimeoutMs('-5000')).toBe(1_000);
  });

  it('clamps to maximum (300000ms) when value is too large', () => {
    expect(parseLLMTimeoutMs('999999')).toBe(300_000);
    expect(parseLLMTimeoutMs('300001')).toBe(300_000);
  });

  it('accepts boundary values exactly', () => {
    expect(parseLLMTimeoutMs('1000')).toBe(1_000);
    expect(parseLLMTimeoutMs('300000')).toBe(300_000);
  });
});
