import { inheritProjectRootFromHome, isHomeDirectory } from '../../project/launch-root.js';
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
  source: 'direct' | 'subdir' | 'last-project-root' | 'unresolved';
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
  const hasExplicitRoot = Boolean(options.cwdArg || options.envProjectRoot || options.initCwd);
  const startsAtHome = isHomeDirectory(projectRoot, options.homeDir);

  if (startsAtHome) {
    if (hasExplicitRoot) {
      messages.push(`[memorix] Refusing explicit $HOME project root: ${projectRoot}`);
      messages.push('[memorix] Memorix will wait for MCP Roots or an explicit memorix_session_start projectRoot.');
      return {
        projectRoot,
        detectedProject: null,
        source: 'unresolved',
        messages,
        error: 'Refusing to bind $HOME as a project root. Pass a git project path instead of $HOME.',
      };
    }
    const inherited = inheritProjectRootFromHome({
      homeDir: options.homeDir,
      envProjectRoot: options.envProjectRoot,
    });
    if (inherited) {
      const inheritedProject = deps.detectProject(inherited);
      if (inheritedProject && !isHomeDirectory(inheritedProject.rootPath, options.homeDir)) {
        messages.push(`[memorix] Unreliable launch directory detected: ${projectRoot}`);
        messages.push(`[memorix] Inherited last git project: ${inheritedProject.rootPath}`);
        return {
          projectRoot: inheritedProject.rootPath,
          detectedProject: inheritedProject,
          source: 'last-project-root',
          messages,
        };
      }
    }
    messages.push(`[memorix] Unreliable launch directory detected: ${projectRoot}`);
    messages.push('[memorix] Memorix will wait for MCP Roots or an explicit memorix_session_start projectRoot.');
    messages.push('[memorix] It will not create ~/memorix.db or treat $HOME as a project.');
    return {
      projectRoot,
      detectedProject: null,
      source: 'unresolved',
      messages,
      error: 'No reliable git project was provided by the launcher.',
    };
  }

  let detected = deps.detectProject(projectRoot);
  if (detected && isHomeDirectory(detected.rootPath, options.homeDir)) {
    detected = null;
  }
  if (detected) {
    return {
      projectRoot,
      detectedProject: detected,
      source: 'direct',
      messages,
    };
  }

  if (deps.isSystemDirectory(projectRoot)) {
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
