import { describe, expect, it } from 'vitest';
import { _testing } from '../../src/cli/commands/background.js';

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

  it('keeps normal CLI errors concise but preserves opt-in diagnostics', () => {
    const error = new Error('Port must be a whole number');
    error.stack = 'Error: Port must be a whole number\n    at internal-frame';

    expect(_testing.formatBackgroundCommandError(error, false)).toBe(
      '[memorix background] Error: Port must be a whole number\n',
    );
    expect(_testing.formatBackgroundCommandError(error, true)).toContain('at internal-frame');
  });
});
