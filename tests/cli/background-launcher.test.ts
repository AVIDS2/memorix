import { describe, expect, it, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { _testing } from '../../src/cli/commands/background.js';

describe('background start lock (prevents duplicate serve-http spawns)', () => {
  let lockPath: string;

  afterEach(() => {
    if (lockPath) {
      try { fs.unlinkSync(lockPath); } catch { /* already gone */ }
    }
  });

  it('lets a second caller acquire the lock only after the first releases it', async () => {
    lockPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'memorix-lock-')), 'background.lock');

    const first = await _testing.acquireBackgroundLock(lockPath);
    expect(first.acquired).toBe(true);
    expect(fs.existsSync(lockPath)).toBe(true);

    // Second caller must not acquire while the first still holds it — this is
    // exactly the race that let two `background start` calls both pass the
    // `isPortInUse` check and each spawn a duplicate `serve-http` process.
    const second = await _testing.acquireBackgroundLock(lockPath, 15_000, 300);
    expect(second.acquired).toBe(false);

    _testing.releaseBackgroundLock(first);
    expect(fs.existsSync(lockPath)).toBe(false);

    const third = await _testing.acquireBackgroundLock(lockPath);
    expect(third.acquired).toBe(true);
    _testing.releaseBackgroundLock(third);
  });

  it('reclaims a stale lock left behind by a crashed holder', async () => {
    lockPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'memorix-lock-')), 'background.lock');
    fs.writeFileSync(lockPath, '999999'); // simulate a lock from a dead/crashed process
    const past = Date.now() / 1000 - 60; // 60s old — well past the staleness threshold
    fs.utimesSync(lockPath, past, past);

    const lock = await _testing.acquireBackgroundLock(lockPath, 15_000, 2_000);
    expect(lock.acquired).toBe(true);
    _testing.releaseBackgroundLock(lock);
  });
});

describe('Windows background launcher', () => {
  it('builds a hidden, independent PowerShell launch command with quoted paths', () => {
    const script = _testing.buildWindowsBackgroundStartScript({
      nodePath: 'C:\\Program Files\\nodejs\\node.exe',
      cliEntry: 'C:\\Users\\Test User\\AppData\\Roaming\\npm\\node_modules\\memorix\\dist\\cli\\index.js',
      port: 43219,
      cwd: 'C:\\Users\\Test User\\project folder',
      stdoutLogFile: 'C:\\Users\\Test User\\.memorix\\background.log.stdout',
      stderrLogFile: 'C:\\Users\\Test User\\.memorix\\background.log',
    });

    expect(script).toContain('Start-Process');
    expect(script).toContain('-WindowStyle Hidden');
    expect(script).toContain('-RedirectStandardOutput');
    expect(script).toContain('-RedirectStandardError');
    expect(script).toContain('"C:\\Users\\Test User\\AppData\\Roaming\\npm\\node_modules\\memorix\\dist\\cli\\index.js"');
    expect(script).toContain('serve-http --port 43219');
  });

  it('escapes quote characters for Windows command-line arguments', () => {
    expect(_testing.quoteWindowsCommandArgument('plain')).toBe('plain');
    expect(_testing.quoteWindowsCommandArgument('folder with spaces')).toBe('"folder with spaces"');
    expect(_testing.quoteWindowsCommandArgument('a"quoted"value')).toBe('"a\\"quoted\\"value"');
  });

  it('rejects malformed ports and log line limits before service startup', () => {
    expect(_testing.parseBackgroundPort(undefined)).toBe(3211);
    expect(_testing.parseBackgroundPort('43222')).toBe(43222);
    expect(() => _testing.parseBackgroundPort('43222junk')).toThrow(/Port must be/);
    expect(() => _testing.parseBackgroundPort('0')).toThrow(/Port must be/);
    expect(() => _testing.parseBackgroundPort('65536')).toThrow(/Port must be/);

    expect(_testing.parseLogLines(undefined)).toBe(50);
    expect(() => _testing.parseLogLines('0')).toThrow(/Log line count must be/);
    expect(() => _testing.parseLogLines('10001')).toThrow(/Log line count must be/);
  });

  it('falls back to argv[1] when this module is not a compiled dist sibling', () => {
    const fallback = '/tmp/wrong-memorix/dist/cli/index.js';
    expect(_testing.resolveBackgroundCliEntry(fallback)).toBe(fallback);
  });

  it('spawns the bundled CLI file, not the library stdio entry', () => {
    const bundledCli = '/opt/memorix/dist/cli/index.js';
    const libraryStdio = '/opt/memorix/dist/index.js';
    expect(_testing.resolveBackgroundCliEntryFrom(bundledCli, libraryStdio)).toBe(bundledCli);
  });

  it('refuses to launch the control plane from $HOME without an inherited git root', () => {
    expect(() => _testing.resolveBackgroundCwd('/Users/tester', '/Users/tester')).toThrow(/Refusing to bind \$HOME/);
    expect(_testing.resolveBackgroundCwd('/Users/tester/Projects/app', '/Users/tester')).toBe(
      '/Users/tester/Projects/app',
    );
  });

  it('keeps normal CLI errors concise but preserves opt-in diagnostics', () => {
    const error = new Error('Port must be a whole number');
    error.stack = 'Error: Port must be a whole number\n    at internal-frame';

    expect(_testing.formatBackgroundCommandError(error, false)).toBe(
      '[memorix background] Error: Port must be a whole number\n',
    );
    expect(_testing.formatBackgroundCommandError(error, true)).toContain('at internal-frame');
  });
});
