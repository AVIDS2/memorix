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

  it('keeps checkpoint guide actions aligned with the checkpoint command', () => {
    const guide = renderCliGuide('checkpoint');
    expect(guide).toContain('memorix checkpoint list');
    expect(guide).toContain('memorix checkpoint show --id <checkpoint-id>');
    expect(guide).toContain('memorix checkpoint context');
    expect(guide).toContain('memorix checkpoint archive');
  });

  it('surfaces the implemented evidence, feedback, media, and knowledge actions', () => {
    expect(renderCliGuide('evidence')).toContain('memorix evidence events --id 42');
    expect(renderCliGuide('feedback')).toContain('memorix feedback record');
    expect(renderCliGuide('media')).toContain('memorix media embed|similar --asset <asset-id>');
    expect(renderCliGuide('knowledge')).toContain('memorix knowledge claims');
    expect(renderCliGuide('codegraph')).toContain('memorix codegraph impact');
  });
});
