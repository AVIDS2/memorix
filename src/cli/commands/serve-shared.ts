import path from 'node:path';

import type { ProjectInfo } from '../../types.js';

export interface ResolveServeProjectOptions {
  cwdArg?: string;
  envProjectRoot?: string;
  initCwd?: string;
  processCwd: string;
  homeDir: string;
}

export interface ResolveServeProjectDeps {
  detectProject: (cwd: string) => ProjectInfo | null;
  findGitInSubdirs: (dir: string) => string | null;
  isSystemDirectory: (dir: string) => boolean;
}

export interface ServeProjectResolution {
  projectRoot: string;
  detectedProject: ProjectInfo | null;
  source: 'direct' | 'subdir' | 'unresolved';
  messages: string[];
  error?: string;
}

export function resolveServeProject(
  options: ResolveServeProjectOptions,
  deps: ResolveServeProjectDeps,
): ServeProjectResolution {
  let projectRoot =
    options.cwdArg ||
    options.envProjectRoot ||
    options.initCwd ||
    options.processCwd;

  const messages: string[] = [`[memorix] Starting with cwd: ${projectRoot}`];

  let detected = deps.detectProject(projectRoot);
  if (detected) {
    return {
      projectRoot,
      detectedProject: detected,
      source: 'direct',
      messages,
    };
  }

  const hasExplicitRoot = Boolean(options.cwdArg || options.envProjectRoot || options.initCwd);
  const startsAtHome = path.resolve(projectRoot) === path.resolve(options.homeDir);
  if (deps.isSystemDirectory(projectRoot) || (!hasExplicitRoot && startsAtHome)) {
    messages.push(`[memorix] Unreliable launch directory detected: ${projectRoot}`);
    messages.push('[memorix] Memorix will wait for MCP Roots or an explicit memorix_session_start projectRoot.');
    messages.push('[memorix] It will not restore a previous project automatically, to prevent cross-project memory access.');
    return {
      projectRoot,
      detectedProject: null,
      source: 'unresolved',
      messages,
      error: 'No reliable git project was provided by the launcher.',
    };
  }

  const subGit = deps.findGitInSubdirs(projectRoot);
  if (subGit) {
    projectRoot = subGit;
    detected = deps.detectProject(subGit);
    if (detected) {
      messages.push(`[memorix] Found .git in subdirectory: ${subGit}`);
      return {
        projectRoot,
        detectedProject: detected,
        source: 'subdir',
        messages,
      };
    }
  }

  messages.push('[memorix] Unable to establish a reliable git-backed project context.');
  messages.push('[memorix] Memorix now refuses to silently fall back to untracked/* in stdio mode.');

  return {
    projectRoot,
    detectedProject: null,
    source: 'unresolved',
    messages,
    error:
      'No git project could be resolved from the current workspace. Open the repo root, pass --cwd, or use an MCP client that sends workspace roots.',
  };
}
