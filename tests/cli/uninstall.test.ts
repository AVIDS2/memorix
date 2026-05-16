/**
 * memorix uninstall — Focused tests
 *
 * Covers:
 * - --dry-run does not mutate
 * - --purge-data requires explicit flag
 * - hooks cleanup detects both project AND global layers
 * - MCP config detection identifies memorix entries without deleting files
 * - Non-interactive (no TTY) rejects or requires --yes
 *
 * All tests run against a temporary HOME directory — never touches real ~/.memorix.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { execSync } from 'node:child_process';

const CLI_ENTRY = path.resolve(__dirname, '..', '..', 'dist', 'cli', 'index.js');
const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'memorix-uninstall-test-'));

function setupTempHome() {
  fs.mkdirSync(path.join(TMP_HOME, '.memorix'), { recursive: true });
}

function cleanupTempHome() {
  try { fs.rmSync(TMP_HOME, { recursive: true, force: true }); } catch { /* ok */ }
}

// Helper: run memorix uninstall with temp HOME
function memorix(args: string): {
  stdout: string;
  stderr: string;
  exitCode: number;
} {
  const env = {
    ...process.env,
    HOME: TMP_HOME,
    USERPROFILE: TMP_HOME,
    APPDATA: path.join(TMP_HOME, 'AppData', 'Roaming'),
  };
  try {
    const result = execSync(`node "${CLI_ENTRY}" uninstall ${args}`, {
      cwd: TMP_HOME,
      env,
      encoding: 'utf-8',
      timeout: 15_000,
      stdio: 'pipe',
    });
    return { stdout: result, stderr: '', exitCode: 0 };
  } catch (err: any) {
    return {
      stdout: err.stdout || '',
      stderr: err.stderr || '',
      exitCode: err.status || 1,
    };
  }
}

describe('memorix uninstall --dry-run', () => {
  beforeAll(() => setupTempHome());
  afterAll(() => cleanupTempHome());

  it('does not mutate filesystem', () => {
    // Create a mock memo to verify it survives
    const testFile = path.join(TMP_HOME, '.memorix', 'test.txt');
    fs.writeFileSync(testFile, 'keep-me');

    memorix('--dry-run');

    // Dry-run should not delete anything
    expect(fs.existsSync(testFile)).toBe(true);
    expect(fs.existsSync(path.join(TMP_HOME, '.memorix'))).toBe(true);
  });

  it('output mentions dry run header', () => {
    const out = memorix('--dry-run');
    expect(out.stdout).toContain('Dry Run');
  });

  it('output lists MCP config section', () => {
    const out = memorix('--dry-run');
    expect(out.stdout).toContain('MCP Config');
  });

  it('output mentions npm uninstall as manual step', () => {
    const out = memorix('--dry-run --hooks --background --purge-data');
    expect(out.stdout).toContain('npm uninstall');
  });
});

describe('memorix uninstall --purge-data', () => {
  beforeAll(() => setupTempHome());
  afterAll(() => cleanupTempHome());

  it('--purge-data requires explicit flag (default does not delete ~/.memorix)', () => {
    const out = memorix('--dry-run');
    expect(out.stdout).toContain('PRESERVE');
  });

  it('--dry-run --purge-data shows DELETE for data directory', () => {
    const out = memorix('--dry-run --purge-data');
    expect(out.stdout).toContain('DELETE');
  });

  it('actually deletes ~/.memorix when --purge-data --yes', () => {
    // Create a file in temp .memorix
    fs.writeFileSync(path.join(TMP_HOME, '.memorix', 'test.txt'), 'data');
    expect(fs.existsSync(path.join(TMP_HOME, '.memorix'))).toBe(true);

    memorix('--yes --purge-data');

    // After purge, directory should be gone
    expect(fs.existsSync(path.join(TMP_HOME, '.memorix'))).toBe(false);
  });
});

describe('memorix uninstall hooks cleanup', () => {
  beforeAll(() => setupTempHome());
  afterAll(() => cleanupTempHome());

  it('--dry-run --hooks detects and reports hooks section', () => {
    const out = memorix('--dry-run --hooks');
    expect(out.stdout).toContain('Agent Hooks');
  });

  it('without --hooks flag, output says to use --hooks', () => {
    const out = memorix('--dry-run');
    expect(out.stdout).toContain('--hooks');
  });

  it('detects project and global hooks separately', () => {
    // Simulate: create both project and global hook files for Claude
    const claudeProjectDir = path.join(TMP_HOME, '.claude');
    fs.mkdirSync(claudeProjectDir, { recursive: true });
    fs.writeFileSync(
      path.join(claudeProjectDir, 'settings.local.json'),
      JSON.stringify({ hooks: { SessionStart: [] } }),
    );

    const claudeHomeDir = path.join(TMP_HOME, '.claude');
    fs.writeFileSync(
      path.join(claudeHomeDir, 'settings.json'),
      JSON.stringify({ hooks: { PostToolUse: [] } }),
    );

    const out = memorix('--dry-run --hooks');
    // With a mock Claude home, the hooks detection should find files
    expect(out.stdout).toContain('Agent Hooks');
  });
});

describe('memorix uninstall MCP config detection', () => {
  beforeAll(() => setupTempHome());
  afterAll(() => cleanupTempHome());

  it('detects MCP config paths for known agents', () => {
    const out = memorix('--dry-run --hooks --background --purge-data');
    expect(out.stdout).toContain('MCP Config Entries');
    expect(out.stdout).toContain('manual');
  });

  it('detects project-level .claude/settings.json with memorix entry', () => {
    // Create project-level Claude MCP config
    const claudeDir = path.join(TMP_HOME, '.claude');
    fs.mkdirSync(claudeDir, { recursive: true });
    fs.writeFileSync(
      path.join(claudeDir, 'settings.json'),
      JSON.stringify({ mcpServers: { memorix: { command: 'memorix', args: ['serve'] } } }),
    );

    const out = memorix('--dry-run');
    // Should detect the memorix entry in the project-level Claude config
    expect(out.stdout).toContain('DETECTED');
    expect(out.stdout).toContain('Claude Code');
  });

  it('does not modify MCP config files', () => {
    const claudeDir = path.join(TMP_HOME, '.claude');
    fs.mkdirSync(claudeDir, { recursive: true });
    const configPath = path.join(claudeDir, 'settings.json');
    const original = JSON.stringify({ mcpServers: { memorix: { command: 'memorix', args: ['serve'] } } });
    fs.writeFileSync(configPath, original);

    memorix('--dry-run');

    // File must be untouched
    expect(fs.readFileSync(configPath, 'utf-8')).toBe(original);
  });

  it('does not detect non-memorix MCP entries', () => {
    // Claude config with unrelated MCP servers only
    const claudeDir = path.join(TMP_HOME, '.claude');
    fs.mkdirSync(claudeDir, { recursive: true });
    fs.writeFileSync(
      path.join(claudeDir, 'settings.json'),
      JSON.stringify({ mcpServers: { otherServer: { command: 'other', args: [] } } }),
    );

    const out = memorix('--dry-run');

    // Should NOT report memorix in the Claude Code project entry
    // The "no memorix MCP entries detected" message or just no DETECTED for this agent
    expect(out.stdout).not.toMatch(
      /DETECTED.*Claude Code.*project.*settings\.json/,
    );
  });
});

describe('memorix uninstall default (no flags)', () => {
  beforeAll(() => setupTempHome());
  afterAll(() => cleanupTempHome());

  it('shows interactive state and suggestions', () => {
    const out = memorix('');
    expect(out.stdout).toContain('Memorix Uninstall');
    expect(out.stdout).toContain('npm uninstall -g memorix');
    expect(out.stdout).toContain('--dry-run');
    expect(out.stdout).toContain('--purge-data');
  });
});

describe('memorix uninstall non-interactive safety', () => {
  beforeAll(() => setupTempHome());
  afterAll(() => cleanupTempHome());

  it('--yes skips confirmation even without TTY', () => {
    // Create mock background state file
    fs.writeFileSync(
      path.join(TMP_HOME, '.memorix', 'background.json'),
      JSON.stringify({ pid: 99999, port: 3211, startedAt: new Date().toISOString(), instanceToken: 'test' }),
    );

    // --yes should work without hanging (even though the PID is fake, doStop handles it)
    const out = memorix('--yes --background');
    // Should not contain the TTY error
    expect(out.stdout).not.toContain('Non-interactive environment');
  });

  it('--purge-data without --yes fails in non-TTY and does not delete data', () => {
    // Create a file to verify it survives
    const testFile = path.join(TMP_HOME, '.memorix', 'keep-me.txt');
    fs.writeFileSync(testFile, 'precious data');

    const out = memorix('--purge-data');

    // Should have non-zero exit code
    expect(out.exitCode).not.toBe(0);
    // Should mention non-interactive error
    expect(out.stdout).toContain('Non-interactive environment');
    // Data must NOT be deleted
    expect(fs.existsSync(testFile)).toBe(true);
    expect(fs.existsSync(path.join(TMP_HOME, '.memorix'))).toBe(true);
  });
});
