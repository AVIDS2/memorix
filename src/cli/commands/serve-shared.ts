import type { ProjectInfo } from '../../types.js';

export interface ResolveServeProjectOptions {
  cwdArg?: string;
  envProjectRoot?: string;
  initCwd?: string;
  processCwd: string;
  homeDir: string;
  lastKnownProjectRoot?: string;
}

export interface ResolveServeProjectDeps {
  detectProject: (cwd: string) => ProjectInfo | null;
  findGitInSubdirs: (dir: string) => string | null;
  isSystemDirectory: (dir: string) => boolean;
}

export interface ServeProjectResolution {
  projectRoot: string;
  detectedProject: ProjectInfo | null;
  source: 'direct' | 'subdir' | 'last-known' | 'home' | 'home-subdir' | 'unresolved';
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

  if (deps.isSystemDirectory(projectRoot)) {
    messages.push(`[memorix] System directory detected: ${projectRoot}`);
    messages.push('[memorix] Your IDE launched memorix from a non-workspace directory.');
    messages.push('[memorix] Fix: add --cwd to your MCP config, or use an IDE/client that exposes workspace roots.');

    if (options.lastKnownProjectRoot) {
      detected = deps.detectProject(options.lastKnownProjectRoot);
      if (detected) {
        messages.push(`[memorix] Restored last known project: ${options.lastKnownProjectRoot}`);
        return {
          projectRoot: options.lastKnownProjectRoot,
          detectedProject: detected,
          source: 'last-known',
          messages,
        };
      }
    }

    detected = deps.detectProject(options.homeDir);
    if (detected) {
      messages.push(`[memorix] Restored project from home directory: ${options.homeDir}`);
      return {
        projectRoot: options.homeDir,
        detectedProject: detected,
        source: 'home',
        messages,
      };
    }

    const homeSubGit = deps.findGitInSubdirs(options.homeDir);
    if (homeSubGit) {
      detected = deps.detectProject(homeSubGit);
      if (detected) {
        messages.push(`[memorix] Found .git in home subdirectory: ${homeSubGit}`);
        return {
          projectRoot: homeSubGit,
          detectedProject: detected,
          source: 'home-subdir',
          messages,
        };
      }
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
