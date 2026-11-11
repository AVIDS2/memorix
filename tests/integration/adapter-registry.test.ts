import { describe, expect, it } from 'vitest';
import {
  getAgentIntegrationEntries,
  getSetupAgentTargets,
  MEMORIX_INTEGRATIONS,
  validateIntegrationRegistry,
} from '../../src/integrations/registry.js';

describe('integration capability registry', () => {
  it('covers every supported agent exactly once', () => {
    const entries = getAgentIntegrationEntries();
    expect(entries).toHaveLength(19);
    expect(new Set(entries.map(entry => entry.agent)).size).toBe(19);
    expect(entries.map(entry => entry.agent)).toContain('qwen');
    expect(getSetupAgentTargets()).not.toContain('qwen');
  });

  it('gives every agent a complete capability manifest', () => {
    for (const entry of getAgentIntegrationEntries()) {
      const manifest = entry.capabilities;
      expect(manifest).toMatchObject({
        schemaVersion: '1',
        agent: entry.agent,
        name: entry.name,
        artifacts: expect.any(Object),
        hooks: expect.any(Object),
        lifecycle: {
          install: true,
          uninstall: true,
        },
        hostCompatibility: expect.any(Object),
        requirements: expect.any(Object),
        source: {
          registry: 'src/integrations/registry.ts',
        },
      });
      expect(manifest.source.generatedBy.length).toBeGreaterThan(0);
      expect(manifest.source.documentation.length).toBeGreaterThan(0);
      if (manifest.hooks.supported) expect(manifest.hooks.events.length).toBeGreaterThan(0);
    }
    expect(getAgentIntegrationEntries().find(entry => entry.agent === 'qwen')?.capabilities.lifecycle).toMatchObject({
      install: true,
      repair: false,
      doctor: false,
      uninstall: true,
    });
  });

  it('passes registry validation and keeps setup rows derived from it', () => {
    expect(validateIntegrationRegistry()).toEqual([]);
    const setupRows = MEMORIX_INTEGRATIONS.filter(entry => entry.setup !== false && entry.agent !== 'memcode' && entry.agent !== 'any-mcp');
    expect(setupRows.map(entry => entry.agent)).toEqual(getSetupAgentTargets());
  });
});
