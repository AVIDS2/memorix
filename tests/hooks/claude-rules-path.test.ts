import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { getHookStatus, installHooks } from '../../src/hooks/installers/index.js';

const originalUserProfile = process.env.USERPROFILE;
const originalHome = process.env.HOME;

function makeTmpDir(): string {
  return fsSync.mkdtempSync(path.join(os.tmpdir(), 'memorix-claude-rules-test-'));
}

const OFFICIAL_SKILL_NAMES = [
  'memorix-memory',
  'memorix-reasoning',
  'memorix-sessions',
  'memorix-git-memory',
  'memorix-mini-skills',
  'memorix-orchestrate',
  'memorix-troubleshooting',
];

afterEach(() => {
  if (originalUserProfile === undefined) delete process.env.USERPROFILE;
  else process.env.USERPROFILE = originalUserProfile;
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
});

describe('Claude integration guidance path', () => {
  it('writes Claude guidance to CLAUDE.md, not Copilot instructions', async () => {
    const tmpDir = makeTmpDir();
    try {
      await installHooks('claude', tmpDir);

      const claudeMd = path.join(tmpDir, 'CLAUDE.md');
      const copilotInstructions = path.join(tmpDir, '.github', 'copilot-instructions.md');

      const content = await fs.readFile(claudeMd, 'utf-8');
      expect(content).toContain('# Memorix');
      await expect(fs.access(copilotInstructions)).rejects.toThrow();
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('appends Claude guidance to an existing CLAUDE.md without replacing user content', async () => {
    const tmpDir = makeTmpDir();
    try {
      const claudeMd = path.join(tmpDir, 'CLAUDE.md');
      await fs.writeFile(claudeMd, '# Existing Rules\n\nKeep replies concise.\n', 'utf-8');

      await installHooks('claude', tmpDir);

      const content = await fs.readFile(claudeMd, 'utf-8');
      expect(content).toContain('# Existing Rules');
      expect(content).toContain('Keep replies concise.');
      expect(content).toContain('# Memorix');
      expect(content).toContain('memorix_search');
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});

describe('global guidance scope', () => {
  it('writes global Codex guidance under home with workspace-safe wording', async () => {
    const tmpDir = makeTmpDir();
    const fakeHome = path.join(tmpDir, 'home');
    const projectDir = path.join(tmpDir, 'project');
    try {
      process.env.USERPROFILE = fakeHome;
      process.env.HOME = fakeHome;
      await fs.mkdir(projectDir, { recursive: true });

      const result = await installHooks('codex', projectDir, true);
      const agentsMd = path.join(fakeHome, '.codex', 'AGENTS.md');

      expect(result.configPath).toBe(agentsMd);
      const content = await fs.readFile(agentsMd, 'utf-8');
      expect(content).toContain('# Memorix — Memory Tools for Active Workspaces');
      expect(content).toContain('active workspace');
      expect(content).not.toContain('This project uses Memorix');
      await expect(fs.access(path.join(projectDir, '.codex', 'AGENTS.md'))).rejects.toThrow();
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});

describe('OpenCode integration files', () => {
  it('writes the local plugin, AGENTS.md guidance, and an OpenCode-discoverable skill', async () => {
    const tmpDir = makeTmpDir();
    try {
      const result = await installHooks('opencode', tmpDir);

      const pluginPath = path.join(tmpDir, '.opencode', 'plugins', 'memorix.js');
      const agentsMd = path.join(tmpDir, 'AGENTS.md');
      const skillPath = path.join(tmpDir, '.opencode', 'skills', 'memorix-memory', 'SKILL.md');

      expect(result.configPath).toBe(pluginPath);
      const plugin = await fs.readFile(pluginPath, 'utf-8');
      expect(plugin).toContain('export const MemorixPlugin');
      expect(plugin).toContain("shell: process.platform === 'win32'");
      expect(await fs.readFile(agentsMd, 'utf-8')).toContain('memorix_search');
      const skill = await fs.readFile(skillPath, 'utf-8');
      expect(skill).toContain('name: memorix-memory');
      expect(skill).toContain('active workspace');
      expect(skill).toContain('CLI fallback');
      expect(skill).not.toContain("project's shared memory layer");
      expect(result.generated.skillPath).toBe(skillPath);
      expect(result.generated.skillPaths).toHaveLength(OFFICIAL_SKILL_NAMES.length);
      for (const name of OFFICIAL_SKILL_NAMES) {
        const content = await fs.readFile(path.join(tmpDir, '.opencode', 'skills', name, 'SKILL.md'), 'utf-8');
        expect(content).toContain(`name: ${name}`);
      }
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('uses workspace-safe wording in plugin package skills', async () => {
    const pluginRoots = [
      path.resolve('plugins/claude/memorix/skills'),
      path.resolve('plugins/codex/memorix/skills'),
      path.resolve('plugins/copilot/memorix/skills'),
      path.resolve('plugins/pi/memorix/skills'),
    ];

    for (const root of pluginRoots) {
      for (const name of OFFICIAL_SKILL_NAMES) {
        const skill = await fs.readFile(path.join(root, name, 'SKILL.md'), 'utf-8');
        expect(skill).toContain(`name: ${name}`);
        expect(skill).toContain('CLI fallback');
        expect(skill).not.toContain("project's shared memory layer");
        expect(skill).not.toContain('This project uses Memorix');
      }
    }
  });
});

describe('rules plus skills integration files', () => {
  it('writes official skills for Cursor alongside rules and hooks', async () => {
    const tmpDir = makeTmpDir();
    try {
      const result = await installHooks('cursor', tmpDir);

      const rulesPath = path.join(tmpDir, '.cursor', 'rules', 'memorix.mdc');
      expect(await fs.readFile(rulesPath, 'utf-8')).toContain('Memorix');
      expect(result.generated.skillPaths).toHaveLength(OFFICIAL_SKILL_NAMES.length);

      const troubleshooting = path.join(tmpDir, '.cursor', 'skills', 'memorix-troubleshooting', 'SKILL.md');
      const content = await fs.readFile(troubleshooting, 'utf-8');
      expect(content).toContain('MCP is an integration surface');
      expect(content).toContain('memorix setup --agent <agent>');
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});

describe('Pi package hook boundary', () => {
  it('does not create fallback hook config outside the Pi package entrypoint', async () => {
    const tmpDir = makeTmpDir();
    try {
      const result = await installHooks('pi', tmpDir);
      const extensionPath = path.join(tmpDir, '.pi', 'packages', 'memorix', 'extensions', 'memorix.js');

      expect(result.configPath).toBe(extensionPath);
      expect(result.events).toContain('user_prompt');
      expect(result.generated.note).toContain('memorix setup --agent pi');
      await expect(fs.access(extensionPath)).rejects.toThrow();
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('reports a Pi package extension when setup has installed it', async () => {
    const tmpDir = makeTmpDir();
    try {
      const extensionPath = path.join(tmpDir, '.pi', 'packages', 'memorix', 'extensions', 'memorix.js');
      await fs.mkdir(path.dirname(extensionPath), { recursive: true });
      await fs.writeFile(extensionPath, 'export default {};\n', 'utf-8');

      const status = await getHookStatus(tmpDir);
      const pi = status.find(item => item.agent === 'pi');

      expect(pi?.installed).toBe(true);
      expect(pi?.verified).toBe(false);
      expect(pi?.configPath).toBe(extensionPath);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
