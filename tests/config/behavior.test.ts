import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { getBehaviorConfig, resetBehaviorConfigCache } from '../../src/config/behavior.js';
import { resetResolvedConfigCache } from '../../src/config/resolved-config.js';
import { resetTomlConfigCache } from '../../src/config/toml-loader.js';
import { resetYamlConfigCache } from '../../src/config/yaml-loader.js';

const TEMP_ROOT = join(process.cwd(), '.tmp-behavior-config-test');
const HOME = join(TEMP_ROOT, 'home');
const PROJECT = join(TEMP_ROOT, 'project');

beforeEach(() => {
  rmSync(TEMP_ROOT, { recursive: true, force: true });
  mkdirSync(join(HOME, '.memorix'), { recursive: true });
  mkdirSync(PROJECT, { recursive: true });
  resetBehaviorConfigCache();
  resetResolvedConfigCache();
  resetTomlConfigCache();
  resetYamlConfigCache();
});

afterEach(() => {
  rmSync(TEMP_ROOT, { recursive: true, force: true });
  resetBehaviorConfigCache();
  resetResolvedConfigCache();
  resetTomlConfigCache();
  resetYamlConfigCache();
});

describe('behavior config resolution', () => {
  it('uses resolved TOML behavior settings instead of only legacy config.json', () => {
    writeFileSync(join(HOME, '.memorix', 'config.toml'), [
      '[memory]',
      'inject = "silent"',
      'formation = "shadow"',
      'auto_cleanup = false',
      'sync_advisory = false',
    ].join('\n'), 'utf8');

    expect(getBehaviorConfig({ projectRoot: PROJECT, homeDir: HOME })).toEqual({
      sessionInject: 'silent',
      formationMode: 'shadow',
      autoCleanup: false,
      syncAdvisory: false,
    });
  });

  it('uses project YAML behavior settings when TOML is absent', () => {
    writeFileSync(join(PROJECT, 'memorix.yml'), [
      'behavior:',
      '  sessionInject: full',
      '  formationMode: fallback',
      '  autoCleanup: false',
      '  syncAdvisory: false',
    ].join('\n'), 'utf8');

    expect(getBehaviorConfig({ projectRoot: PROJECT, homeDir: HOME })).toEqual({
      sessionInject: 'full',
      formationMode: 'fallback',
      autoCleanup: false,
      syncAdvisory: false,
    });
  });

  it('falls back to legacy behavior when resolved config is temporarily malformed', () => {
    writeFileSync(join(HOME, '.memorix', 'config.toml'), '[memory\n', 'utf8');
    writeFileSync(join(HOME, '.memorix', 'config.json'), JSON.stringify({
      behavior: {
        sessionInject: 'silent',
        formationMode: 'shadow',
        autoCleanup: false,
        syncAdvisory: false,
      },
    }), 'utf8');

    expect(getBehaviorConfig({ projectRoot: PROJECT, homeDir: HOME })).toEqual({
      sessionInject: 'silent',
      formationMode: 'shadow',
      autoCleanup: false,
      syncAdvisory: false,
    });
  });
});
