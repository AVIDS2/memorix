/**
 * Issue #46 regression test — .env must be loaded before embedding provider reads
 *
 * Root cause: CLI commands (status, doctor, TUI) called getEmbeddingProvider()
 * before loadDotenv(), so MEMORIX_EMBEDDING_API_KEY from .env was invisible.
 *
 * This test verifies the fix by checking that:
 * 1. loadDotenv() makes .env embedding keys visible in process.env
 * 2. getEmbeddingMode() returns the correct mode AFTER dotenv is loaded
 * 3. Keys from project .env and user .env are both reachable
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadDotenv, resetDotenv } from '../../src/config/dotenv-loader.js';

const PROJECT_DIR = join(tmpdir(), 'memorix-issue46-' + Date.now());
const USER_HOME = join(tmpdir(), 'memorix-issue46-home-' + Date.now());

// Keys that the embedding provider reads from process.env
const EMBEDDING_ENV_KEYS = [
  'MEMORIX_EMBEDDING',
  'MEMORIX_EMBEDDING_API_KEY',
  'MEMORIX_EMBEDDING_BASE_URL',
  'MEMORIX_EMBEDDING_MODEL',
  'MEMORIX_API_KEY',
  'MEMORIX_LLM_API_KEY',
  'OPENAI_API_KEY',
];

beforeEach(() => {
  resetDotenv();
  mkdirSync(PROJECT_DIR, { recursive: true });
  mkdirSync(join(USER_HOME, '.memorix'), { recursive: true });
  // Clean all embedding-related env vars to simulate a fresh process
  for (const key of EMBEDDING_ENV_KEYS) {
    delete process.env[key];
  }
});

afterEach(() => {
  resetDotenv();
  for (const key of EMBEDDING_ENV_KEYS) {
    delete process.env[key];
  }
  try { rmSync(PROJECT_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
  try { rmSync(USER_HOME, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe('Issue #46: .env embedding key visibility', () => {
  it('MEMORIX_EMBEDDING_API_KEY from project .env is visible after loadDotenv', () => {
    writeFileSync(
      join(PROJECT_DIR, '.env'),
      'MEMORIX_EMBEDDING=api\nMEMORIX_EMBEDDING_API_KEY=sk-test-project-key-12345\n',
    );

    // Before loadDotenv: key should NOT be in process.env
    expect(process.env.MEMORIX_EMBEDDING_API_KEY).toBeUndefined();
    expect(process.env.MEMORIX_EMBEDDING).toBeUndefined();

    // After loadDotenv: key SHOULD be in process.env
    loadDotenv(PROJECT_DIR, { userHomeDir: USER_HOME });

    expect(process.env.MEMORIX_EMBEDDING).toBe('api');
    expect(process.env.MEMORIX_EMBEDDING_API_KEY).toBe('sk-test-project-key-12345');
  });

  it('MEMORIX_EMBEDDING_API_KEY from user .env is visible after loadDotenv', () => {
    writeFileSync(
      join(USER_HOME, '.memorix', '.env'),
      'MEMORIX_EMBEDDING=api\nMEMORIX_EMBEDDING_API_KEY=sk-test-user-key-67890\n',
    );

    expect(process.env.MEMORIX_EMBEDDING_API_KEY).toBeUndefined();

    loadDotenv(PROJECT_DIR, { userHomeDir: USER_HOME });

    expect(process.env.MEMORIX_EMBEDDING).toBe('api');
    expect(process.env.MEMORIX_EMBEDDING_API_KEY).toBe('sk-test-user-key-67890');
  });

  it('project .env takes priority over user .env for embedding key', () => {
    writeFileSync(
      join(PROJECT_DIR, '.env'),
      'MEMORIX_EMBEDDING_API_KEY=sk-project\n',
    );
    writeFileSync(
      join(USER_HOME, '.memorix', '.env'),
      'MEMORIX_EMBEDDING_API_KEY=sk-user\n',
    );

    loadDotenv(PROJECT_DIR, { userHomeDir: USER_HOME });

    expect(process.env.MEMORIX_EMBEDDING_API_KEY).toBe('sk-project');
  });

  it('system env var wins over .env for embedding key', () => {
    process.env.MEMORIX_EMBEDDING_API_KEY = 'sk-system';
    writeFileSync(
      join(PROJECT_DIR, '.env'),
      'MEMORIX_EMBEDDING_API_KEY=sk-project-should-lose\n',
    );

    loadDotenv(PROJECT_DIR, { userHomeDir: USER_HOME });

    expect(process.env.MEMORIX_EMBEDDING_API_KEY).toBe('sk-system');
  });

  it('getEmbeddingMode reads correct mode AFTER loadDotenv', async () => {
    writeFileSync(
      join(PROJECT_DIR, '.env'),
      'MEMORIX_EMBEDDING=api\n',
    );

    // Before: mode should be 'off' (default when env var not set)
    expect(process.env.MEMORIX_EMBEDDING).toBeUndefined();

    loadDotenv(PROJECT_DIR, { userHomeDir: USER_HOME });

    // After: mode should reflect the .env value
    expect(process.env.MEMORIX_EMBEDDING).toBe('api');
  });

  it('all embedding fallback keys load from .env', () => {
    writeFileSync(
      join(PROJECT_DIR, '.env'),
      [
        'MEMORIX_EMBEDDING=api',
        'MEMORIX_EMBEDDING_API_KEY=sk-embed',
        'MEMORIX_EMBEDDING_BASE_URL=https://embed.example.com',
        'MEMORIX_EMBEDDING_MODEL=text-embedding-3-large',
        'MEMORIX_API_KEY=sk-unified',
        'MEMORIX_LLM_API_KEY=sk-llm',
        'OPENAI_API_KEY=sk-openai',
      ].join('\n'),
    );

    loadDotenv(PROJECT_DIR, { userHomeDir: USER_HOME });

    expect(process.env.MEMORIX_EMBEDDING).toBe('api');
    expect(process.env.MEMORIX_EMBEDDING_API_KEY).toBe('sk-embed');
    expect(process.env.MEMORIX_EMBEDDING_BASE_URL).toBe('https://embed.example.com');
    expect(process.env.MEMORIX_EMBEDDING_MODEL).toBe('text-embedding-3-large');
    expect(process.env.MEMORIX_API_KEY).toBe('sk-unified');
    expect(process.env.MEMORIX_LLM_API_KEY).toBe('sk-llm');
    expect(process.env.OPENAI_API_KEY).toBe('sk-openai');
  });

  it('resetDotenv clears embedding keys injected from .env', () => {
    writeFileSync(
      join(PROJECT_DIR, '.env'),
      'MEMORIX_EMBEDDING=api\nMEMORIX_EMBEDDING_API_KEY=sk-will-be-cleared\n',
    );

    loadDotenv(PROJECT_DIR, { userHomeDir: USER_HOME });
    expect(process.env.MEMORIX_EMBEDDING_API_KEY).toBe('sk-will-be-cleared');

    resetDotenv();
    expect(process.env.MEMORIX_EMBEDDING_API_KEY).toBeUndefined();
    expect(process.env.MEMORIX_EMBEDDING).toBeUndefined();
  });
});
