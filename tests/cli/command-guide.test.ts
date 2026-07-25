import { describe, expect, it, vi } from 'vitest';
import { printCliGuideForHelp, renderCliGuide } from '../../src/cli/command-guide.js';

describe('CLI command guide', () => {
  it('renders action-oriented help for manual command namespaces', () => {
    const guide = renderCliGuide('memory');
    expect(guide).toContain('memorix memory store');
    expect(guide).toContain('memorix identity join');
    expect(guide).toContain('--cwd <git-project>');
  });

  it('intercepts namespace --help before generic argument metadata hides actions', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      expect(printCliGuideForHelp(['transfer', '--help'])).toBe(true);
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('memorix transfer import --file'));
      expect(printCliGuideForHelp(['unknown', '--help'])).toBe(false);
    } finally {
      logSpy.mockRestore();
    }
  });
});
