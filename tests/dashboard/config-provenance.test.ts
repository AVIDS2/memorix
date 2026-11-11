import { afterEach, describe, expect, it } from 'vitest';
import { resolveDashboardKeySource } from '../../src/dashboard/config-provenance.js';

const fallbackKeys = [
  'MEMORIX_LLM_API_KEY',
  'MEMORIX_API_KEY',
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
  'OPENROUTER_API_KEY',
];

afterEach(() => {
  for (const key of fallbackKeys) delete process.env[key];
});

describe('Dashboard key provenance', () => {
  it.each(['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'OPENROUTER_API_KEY'])(
    'labels %s as the actual environment source',
    (key) => {
      process.env[key] = `${key}-secret`;

      expect(resolveDashboardKeySource({
        value: process.env[key],
        envKeys: fallbackKeys,
        configSource: 'config.toml',
      })).toBe(`env:${key}`);
    },
  );

  it('uses config provenance when no environment candidate resolved the key', () => {
    expect(resolveDashboardKeySource({
      value: 'toml-secret',
      envKeys: fallbackKeys,
      configSource: 'config.toml',
    })).toBe('config.toml');
  });
});
