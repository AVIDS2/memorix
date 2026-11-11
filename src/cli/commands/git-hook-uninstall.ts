/**
 * CLI Command: memorix git-hook uninstall
 *
 * Removes the memorix post-commit hook from the git repository.
 * If the hook file contains other content, only the memorix section is removed.
 */

import { defineCommand } from 'citty';
import * as p from '@clack/prompts';
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { resolveHooksDir } from '../../git/hooks-path.js';

const HOOK_MARKER = '# [memorix-git-hook]';

export default defineCommand({
  meta: {
    name: 'git-hook-uninstall',
    description: 'Remove memorix git post-commit hook',
  },
  args: {
    cwd: {
      type: 'string',
      description: 'Project directory (default: current directory)',
      required: false,
    },
  },
  run: async ({ args }) => {
    const projectDir = args.cwd || process.cwd();

    p.intro('Uninstall Git post-commit hook');

    const resolved = resolveHooksDir(projectDir);
    if (!resolved) {
      p.log.warn('No .git found (checked both directory and worktree file).');
      p.outro('Nothing to uninstall.');
      return;
    }
    const { hookPath } = resolved;

    if (!existsSync(hookPath)) {
      p.log.warn('No post-commit hook found.');
      p.outro('Nothing to uninstall.');
      return;
    }

    const content = readFileSync(hookPath, 'utf-8');

    if (!content.includes(HOOK_MARKER)) {
      p.log.warn('Post-commit hook exists but does not contain memorix hook.');
      p.outro('Nothing to uninstall.');
      return;
    }

    // Remove the memorix section (from marker to next blank line or EOF)
    const lines = content.split('\n');
    const filtered: string[] = [];
    let inMemorixBlock = false;

    for (const line of lines) {
      if (line.includes(HOOK_MARKER)) {
        inMemorixBlock = true;
        continue;
      }
      if (inMemorixBlock) {
        // End of memorix block: empty line or next shebang/marker
        if (line.trim() === '' || line.startsWith('#!') || line.startsWith('# [')) {
          if (line.trim() !== '') filtered.push(line);
          inMemorixBlock = false;
        }
        continue;
      }
      filtered.push(line);
    }

    const remaining = filtered.join('\n').trim();

    if (!remaining || remaining === '#!/bin/sh') {
      // Hook file only contained memorix content — delete it
      unlinkSync(hookPath);
      p.log.success('Git post-commit hook removed.');
    } else {
      // Other hook content remains — keep it
      writeFileSync(hookPath, remaining + '\n', 'utf-8');
      p.log.success('Memorix section removed from post-commit hook.');
      p.log.info('Other hook content was preserved.');
    }

    p.outro('Done.');
  },
});
