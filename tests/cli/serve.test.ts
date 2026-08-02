import { describe, expect, it } from 'vitest';

import { mcpFileUriToPath } from '../../src/cli/mcp-root-path.js';
import { resolveServeProject } from '../../src/cli/commands/serve-shared.js';
import type { ProjectInfo } from '../../src/types.js';

function makeProject(id: string, rootPath: string): ProjectInfo {
  return {
    id,
    name: id.split('/').pop() || id,
    rootPath,
  };
}

describe('serve-shared', () => {
  it('resolves a direct git-backed project from cwd', () => {
    const result = resolveServeProject(
      {
        processCwd: 'E:/repo',
        homeDir: 'C:/Users/tester',
      },
      {
        detectProject: (cwd) => (cwd === 'E:/repo' ? makeProject('AVIDS2/repo', cwd) : null),
        findGitInSubdirs: () => null,
        isSystemDirectory: () => false,
      },
    );

    expect(result.detectedProject?.id).toBe('AVIDS2/repo');
    expect(result.source).toBe('direct');
    expect(result.error).toBeUndefined();
  });

  it('resolves the first git-backed subdirectory when workspace root itself is not a repo', () => {
    const result = resolveServeProject(
      {
        processCwd: 'E:/workspace',
        homeDir: 'C:/Users/tester',
      },
      {
        detectProject: (cwd) => (cwd === 'E:/workspace/app' ? makeProject('AVIDS2/app', cwd) : null),
        findGitInSubdirs: (cwd) => (cwd === 'E:/workspace' ? 'E:/workspace/app' : null),
        isSystemDirectory: () => false,
      },
    );

    expect(result.detectedProject?.id).toBe('AVIDS2/app');
    expect(result.projectRoot).toBe('E:/workspace/app');
    expect(result.source).toBe('subdir');
  });

  it('refuses to restore a last known project when launched from a system directory', () => {
    const result = resolveServeProject(
      {
        processCwd: 'C:/Windows/System32',
        homeDir: 'C:/Users/tester',
      },
      {
        detectProject: (cwd) => (cwd === 'E:/repo' ? makeProject('AVIDS2/repo', cwd) : null),
        findGitInSubdirs: () => null,
        isSystemDirectory: (cwd) => cwd.includes('System32'),
      },
    );

    expect(result.detectedProject).toBeNull();
    expect(result.projectRoot).toBe('C:/Windows/System32');
    expect(result.source).toBe('unresolved');
    expect(result.messages.join('\n')).toContain('will not restore a previous project automatically');
  });

  it('fails fast instead of falling back to untracked/* when no reliable project can be found', () => {
    const result = resolveServeProject(
      {
        processCwd: 'E:/tools/CockpitTools',
        homeDir: 'C:/Users/tester',
      },
      {
        detectProject: () => null,
        findGitInSubdirs: () => null,
        isSystemDirectory: () => false,
      },
    );

    expect(result.detectedProject).toBeNull();
    expect(result.source).toBe('unresolved');
    expect(result.error).toContain('No git project could be resolved');
    expect(result.messages.join('\n')).toContain('refuses to silently fall back');
  });

  it('fails closed for system directories without probing home or a prior project', () => {
    const result = resolveServeProject(
      {
        processCwd: 'C:/Windows/System32',
        homeDir: 'C:/Users/tester',
      },
      {
        detectProject: () => null,
        findGitInSubdirs: () => null,
        isSystemDirectory: (cwd) => cwd.includes('System32'),
      },
    );

    expect(result.detectedProject).toBeNull();
    expect(result.error).toContain('No reliable git project');
    expect(result.messages.join('\n')).toContain('Unreliable launch directory');
  });

  it('keeps MCP file roots native to the host platform', () => {
    expect(mcpFileUriToPath('file:///home/tester/project', 'linux')).toBe('/home/tester/project');
    expect(mcpFileUriToPath('file:///E:/repo/project', 'win32')).toBe('E:\\repo\\project');
    expect(mcpFileUriToPath('https://example.com/repo', 'linux')).toBeNull();
  });
});
