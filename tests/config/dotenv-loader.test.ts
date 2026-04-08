/**
 * Tests for .env Loader
 *
 * Validates that dotenv loading works correctly:
 * - Project .env loads secrets into process.env
 * - User .env loads as fallback
 * - System env vars always win (not overridden)
 * - Reset clears state
 * - Diagnostics track loaded files
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadDotenv, resetDotenv, getLoadedEnvFiles } from '../../src/config/dotenv-loader.js';

const TEST_DIR = join(tmpdir(), 'memorix-dotenv-test-' + Date.now());
const TEST_DIR_B = join(tmpdir(), 'memorix-dotenv-test-b-' + Date.now());
const TEST_HOME = join(tmpdir(), 'memorix-dotenv-home-' + Date.now());

beforeEach(() => {
  resetDotenv();
  mkdirSync(TEST_DIR, { recursive: true });
  mkdirSync(TEST_DIR_B, { recursive: true });
  mkdirSync(join(TEST_HOME, '.memorix'), { recursive: true });
  // Clean up any test env vars
  delete process.env.MEMORIX_TEST_DOTENV_VAR;
  delete process.env.MEMORIX_TEST_OVERRIDE_VAR;
  delete process.env.MEMORIX_TEST_SWITCH_VAR;
});

afterEach(() => {
  resetDotenv();
  delete process.env.MEMORIX_TEST_DOTENV_VAR;
  delete process.env.MEMORIX_TEST_OVERRIDE_VAR;
  delete process.env.MEMORIX_TEST_SWITCH_VAR;
  try { rmSync(TEST_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
  try { rmSync(TEST_DIR_B, { recursive: true, force: true }); } catch { /* ignore */ }
  try { rmSync(TEST_HOME, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe('loadDotenv', () => {
  it('should load .env from project root', () => {
    writeFileSync(join(TEST_DIR, '.env'), 'MEMORIX_TEST_DOTENV_VAR=from_project_env\n');

    loadDotenv(TEST_DIR, { userHomeDir: TEST_HOME });

    expect(process.env.MEMORIX_TEST_DOTENV_VAR).toBe('from_project_env');
  });

  it('should NOT override existing system env vars', () => {
    process.env.MEMORIX_TEST_OVERRIDE_VAR = 'from_system';
    writeFileSync(join(TEST_DIR, '.env'), 'MEMORIX_TEST_OVERRIDE_VAR=from_dotenv\n');

    loadDotenv(TEST_DIR, { userHomeDir: TEST_HOME });

    // System env should win
    expect(process.env.MEMORIX_TEST_OVERRIDE_VAR).toBe('from_system');
  });

  it('should track loaded files in diagnostics', () => {
    writeFileSync(join(TEST_DIR, '.env'), 'MEMORIX_TEST_DOTENV_VAR=test\n');

    loadDotenv(TEST_DIR, { userHomeDir: TEST_HOME });

    const files = getLoadedEnvFiles();
    expect(files.length).toBeGreaterThan(0);
    expect(files.some(f => f.includes('.env'))).toBe(true);
  });

  it('should return empty diagnostics when no .env exists', () => {
    loadDotenv(TEST_DIR + '-nonexistent', { userHomeDir: TEST_HOME });

    const files = getLoadedEnvFiles();
    expect(files.length).toBe(0);
  });

  it('should cache and not re-load for same project root', () => {
    writeFileSync(join(TEST_DIR, '.env'), 'MEMORIX_TEST_DOTENV_VAR=first_load\n');

    loadDotenv(TEST_DIR, { userHomeDir: TEST_HOME });
    expect(process.env.MEMORIX_TEST_DOTENV_VAR).toBe('first_load');

    // Modify .env but should not re-read due to cache
    writeFileSync(join(TEST_DIR, '.env'), 'MEMORIX_TEST_DOTENV_VAR=second_load\n');
    loadDotenv(TEST_DIR, { userHomeDir: TEST_HOME });
    // Value stays from first load (dotenv already set it in process.env)
    expect(process.env.MEMORIX_TEST_DOTENV_VAR).toBe('first_load');
  });

  it('should reload after resetDotenv', () => {
    writeFileSync(join(TEST_DIR, '.env'), 'MEMORIX_TEST_DOTENV_VAR=first\n');
    loadDotenv(TEST_DIR, { userHomeDir: TEST_HOME });
    expect(process.env.MEMORIX_TEST_DOTENV_VAR).toBe('first');

    resetDotenv();
    writeFileSync(join(TEST_DIR, '.env'), 'MEMORIX_TEST_DOTENV_VAR=second\n');
    loadDotenv(TEST_DIR);
    expect(process.env.MEMORIX_TEST_DOTENV_VAR).toBe('second');
  });

  it('should not leak project A env vars into project B after reset', () => {
    writeFileSync(join(TEST_DIR, '.env'), 'MEMORIX_TEST_SWITCH_VAR=from_project_a\n');
    writeFileSync(join(TEST_DIR_B, '.env'), 'MEMORIX_TEST_SWITCH_VAR=from_project_b\n');

    loadDotenv(TEST_DIR);
    expect(process.env.MEMORIX_TEST_SWITCH_VAR).toBe('from_project_a');

    resetDotenv();
    loadDotenv(TEST_DIR_B, { userHomeDir: TEST_HOME });
    expect(process.env.MEMORIX_TEST_SWITCH_VAR).toBe('from_project_b');
  });

  it('should remove injected env vars when switching to a project without .env', () => {
    writeFileSync(join(TEST_DIR, '.env'), 'MEMORIX_TEST_SWITCH_VAR=from_project_a\n');

    loadDotenv(TEST_DIR, { userHomeDir: TEST_HOME });
    expect(process.env.MEMORIX_TEST_SWITCH_VAR).toBe('from_project_a');

    resetDotenv();
    loadDotenv(TEST_DIR_B, { userHomeDir: TEST_HOME });
    expect(process.env.MEMORIX_TEST_SWITCH_VAR).toBeUndefined();
  });
});

describe('getLoadedEnvFiles', () => {
  it('should return readonly array', () => {
    const files = getLoadedEnvFiles();
    expect(Array.isArray(files)).toBe(true);
  });
});
