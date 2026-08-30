import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { buildMemorixServer } from '../../src/cli/commands/setup.js';
import { installAgentGuidance } from '../../src/hooks/installers/index.js';
import { TOOL_PROFILES, isToolInProfile, countToolsInProfile, describeProfile } from '../../src/server/tool-profile.js';

/**
 * Profile-parity exam: the tools an agent is taught must exist in the profile
 * the installed MCP server actually exposes. A taught-but-missing tool is a
 * broken promise that degrades the memory-native experience. Deterministic,
 * offline.
 */

const CLAUDE_MD = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../CLAUDE.md');

const MICRO_TOOLS = [
  'memorix_store',
  'memorix_search',
  'memorix_detail',
  'memorix_project_context',
  'memorix_context_pack',
  'memorix_codegraph_status',
  'memorix_resolve',
  'memorix_session_start',
  'memorix_media',
];

describe('profile parity exam', () => {
  let sandbox = '';

  afterEach(() => {
    if (sandbox) rmSync(sandbox, { recursive: true, force: true });
    sandbox = '';
  });

  it('installed stdio server exposes lite, so taught tools are reachable', () => {
    const stdio = buildMemorixServer('stdio');
    expect(stdio.args).toEqual(['serve', '--mode', 'lite']);
    expect(stdio.command).toBe('memorix');
  });

  it('micro stays the documented 9-tool default surface', () => {
    expect(countToolsInProfile('micro')).toBe(9);
    for (const name of MICRO_TOOLS) {
      expect(isToolInProfile(name, 'micro'), name).toBe(true);
    }
  });

  it('keeps profile descriptions tied to the actual profile map', () => {
    expect(describeProfile('micro')).toContain('9 tools');
    expect(describeProfile('lite')).toContain('20 tools');
    expect(describeProfile('team')).toContain('28 tools');
    expect(describeProfile('full')).toContain('47 tools');
  });

  it('keeps packaged memory skills aware of the reachable lite surface', () => {
    for (const agent of ['claude', 'codebuddy', 'codex', 'copilot', 'cursor', 'pi']) {
      const content = readFileSync(
        path.resolve(path.dirname(fileURLToPath(import.meta.url)), `../../plugins/${agent}/memorix/skills/memorix-memory/SKILL.md`),
        'utf8',
      );
      expect(content, `${agent} memory skill`).toContain('memorix_evidence');
      expect(content, `${agent} memory skill`).toContain('memorix_feedback');
      expect(content, `${agent} memory skill`).toContain('memorix_media');
    }
  });

  it('every MCP tool taught in generated guidance is visible under lite', async () => {
    sandbox = mkdtempSync(path.join(tmpdir(), 'memorix-profile-parity-'));
    const rulesPath = await installAgentGuidance('codex', sandbox, false);
    const content = readFileSync(rulesPath, 'utf-8');
    const taught = [...content.matchAll(/memorix_([a-z_]+)/g)].map((match) => `memorix_${match[1]}`);
    const toolNames = taught.filter((name) => name in TOOL_PROFILES);
    expect(toolNames.length, 'guidance should teach MCP tools').toBeGreaterThan(0);
    for (const name of toolNames) {
      expect(isToolInProfile(name, 'lite'), `${name} must be in the lite profile`).toBe(true);
    }
  });

  it('full-only tools in the repo CLAUDE.md are marked with the MEMORIX_MODE=full hint', () => {
    const content = readFileSync(CLAUDE_MD, 'utf-8');
    for (const name of ['memorix_promote', 'memorix_rules_sync', 'memorix_workspace_sync']) {
      expect(isToolInProfile(name, 'lite'), name).toBe(false);
      const row = content.split('\n').find((line) => line.includes(name));
      expect(row, `${name} should be documented`).toBeTruthy();
      expect(row, `${name} must carry the full-mode hint`).toContain('MEMORIX_MODE=full');
    }
  });
});
