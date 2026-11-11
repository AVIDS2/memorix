import { describe, expect, it } from 'vitest';
import { resolveLocalBrowserCommand } from '../../src/runtime/open-browser.js';

describe('local browser launch', () => {
  it('passes a loopback dashboard URL as one argument without a shell', () => {
    expect(resolveLocalBrowserCommand('http://127.0.0.1:3211/', 'win32')).toEqual({
      command: 'explorer.exe',
      args: ['http://127.0.0.1:3211/'],
    });
    expect(resolveLocalBrowserCommand('http://localhost:3211/', 'darwin').command).toBe('open');
    expect(resolveLocalBrowserCommand('http://127.0.0.1:3211/', 'linux').command).toBe('xdg-open');
  });

  it.each([
    'https://example.com/',
    'http://127.0.0.1:3211" & calc',
    'http://user:pass@127.0.0.1:3211/',
    'file:///etc/passwd',
    'http://127.0.0.1/',
  ])('rejects an unsafe dashboard target: %s', (url) => {
    expect(() => resolveLocalBrowserCommand(url, 'win32')).toThrow();
  });
});
