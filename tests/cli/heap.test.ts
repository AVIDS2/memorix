import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CLI_HEAP_MB,
  DEFAULT_HOOK_HEAP_MB,
  buildCliHeapBannerPrelude,
  isHookCliInvocation,
  resolveCliHeapMb,
} from '../../src/cli/heap.js';

describe('CLI heap selection', () => {
  it('uses a small heap for memorix hook and keeps the large heap for serve', () => {
    expect(isHookCliInvocation(['hook'])).toBe(true);
    expect(isHookCliInvocation(['hook', '--agent', 'claude'])).toBe(true);
    expect(isHookCliInvocation(['--cwd', '/tmp/project', 'hook'])).toBe(true);
    expect(isHookCliInvocation(['hooks'])).toBe(false);
    expect(isHookCliInvocation(['hooks', 'install'])).toBe(false);
    expect(isHookCliInvocation(['serve'])).toBe(false);
    expect(isHookCliInvocation(['serve-http'])).toBe(false);

    expect(resolveCliHeapMb(['hook'])).toBe(DEFAULT_HOOK_HEAP_MB);
    expect(resolveCliHeapMb(['serve'])).toBe(DEFAULT_CLI_HEAP_MB);
    expect(resolveCliHeapMb(['hooks', 'install'])).toBe(DEFAULT_CLI_HEAP_MB);
    expect(DEFAULT_HOOK_HEAP_MB).toBeLessThanOrEqual(512);
    expect(DEFAULT_CLI_HEAP_MB).toBe(4096);
  });

  it('lets MEMORIX_HOOK_HEAP_MB override only the hook command', () => {
    expect(resolveCliHeapMb(['hook'], { MEMORIX_HOOK_HEAP_MB: '256' })).toBe(256);
    expect(resolveCliHeapMb(['serve'], { MEMORIX_HOOK_HEAP_MB: '256' })).toBe(DEFAULT_CLI_HEAP_MB);
    expect(resolveCliHeapMb(['hook'], { MEMORIX_HOOK_HEAP_MB: 'nope' })).toBe(DEFAULT_HOOK_HEAP_MB);
    expect(resolveCliHeapMb(['serve'], { MEMORIX_HEAP_MB: '2048' })).toBe(2048);
  });

  it('bakes hook-aware heap selection into the CLI respawn banner', () => {
    const banner = buildCliHeapBannerPrelude();
    expect(banner).toContain('--max-old-space-size=');
    expect(banner).toContain('__cmd==="hook"');
    expect(banner).toContain(String(DEFAULT_HOOK_HEAP_MB));
    expect(banner).toContain(String(DEFAULT_CLI_HEAP_MB));
    expect(banner).toContain('MEMORIX_HOOK_HEAP_MB');
  });
});
