/**
 * Verify FIX-1: Project-level memorix.yml reaches runtime config getters.
 *
 * Before fix: loadYamlConfig() without args ignored project-level config.
 * After fix: initProjectRoot() sets a global default, so all getters work.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, unlinkSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadYamlConfig, initProjectRoot, clearProjectRoot, resetYamlConfigCache } from '../../src/config/yaml-loader.js';

describe('Project-level memorix.yml resolution', () => {
  const testDir = join(tmpdir(), 'memorix-test-yml-' + Date.now());
  const ymlPath = join(testDir, 'memorix.yml');

  beforeEach(() => {
    mkdirSync(testDir, { recursive: true });
    resetYamlConfigCache();
  });

  afterEach(() => {
    resetYamlConfigCache();
    try { unlinkSync(ymlPath); } catch { /* ignore */ }
  });

  it('loadYamlConfig() without args should NOT find project config before initProjectRoot', () => {
    writeFileSync(ymlPath, 'git:\n  autoHook: true\n  maxDiffSize: 999\n', 'utf-8');
    const cfg = loadYamlConfig();
    // Without initProjectRoot, no project root is known
    expect(cfg.git?.maxDiffSize).not.toBe(999);
  });

  it('loadYamlConfig() without args SHOULD find project config after initProjectRoot', () => {
    writeFileSync(ymlPath, 'git:\n  autoHook: true\n  maxDiffSize: 999\nllm:\n  provider: test-provider\n', 'utf-8');
    initProjectRoot(testDir);
    const cfg = loadYamlConfig();
    expect(cfg.git?.autoHook).toBe(true);
    expect(cfg.git?.maxDiffSize).toBe(999);
    expect(cfg.llm?.provider).toBe('test-provider');
  });

  it('explicit projectRoot arg should override globalProjectRoot', () => {
    // Set globalProjectRoot to testDir
    writeFileSync(ymlPath, 'llm:\n  provider: from-global\n', 'utf-8');
    initProjectRoot(testDir);

    // Create a different dir with different config
    const otherDir = join(tmpdir(), 'memorix-test-yml-other-' + Date.now());
    mkdirSync(otherDir, { recursive: true });
    const otherYml = join(otherDir, 'memorix.yml');
    writeFileSync(otherYml, 'llm:\n  provider: from-explicit\n', 'utf-8');

    // Explicit arg should win
    resetYamlConfigCache();
    const cfg = loadYamlConfig(otherDir);
    expect(cfg.llm?.provider).toBe('from-explicit');

    // Cleanup
    try { unlinkSync(otherYml); } catch { /* ignore */ }
  });

  it('initProjectRoot should invalidate cache', () => {
    writeFileSync(ymlPath, 'llm:\n  provider: first\n', 'utf-8');
    initProjectRoot(testDir);
    const cfg1 = loadYamlConfig();
    expect(cfg1.llm?.provider).toBe('first');

    // Update file and re-init
    writeFileSync(ymlPath, 'llm:\n  provider: second\n', 'utf-8');
    initProjectRoot(testDir); // Should invalidate cache
    const cfg2 = loadYamlConfig();
    expect(cfg2.llm?.provider).toBe('second');
  });

  it('clearProjectRoot should stop no-arg loadYamlConfig from using previous project config', () => {
    writeFileSync(ymlPath, 'llm:\n  provider: should-not-leak\n', 'utf-8');
    initProjectRoot(testDir);
    expect(loadYamlConfig().llm?.provider).toBe('should-not-leak');

    clearProjectRoot();
    resetYamlConfigCache();

    expect(loadYamlConfig().llm?.provider).not.toBe('should-not-leak');
  });
});
