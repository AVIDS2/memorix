import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import {
  getGlobalConfigTomlPath,
  getProjectConfigTomlPath,
} from '../../src/config/config-paths.js';

describe('config paths', () => {
  it('builds global and project TOML paths deterministically', () => {
    expect(getGlobalConfigTomlPath('C:\\Users\\Test')).toBe(join('C:\\Users\\Test', '.memorix', 'config.toml'));
    expect(getProjectConfigTomlPath('E:\\repo\\demo')).toBe(join('E:\\repo\\demo', 'memorix.toml'));
  });
});
