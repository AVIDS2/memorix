import path from 'node:path';

/**
 * These sources describe how Memorix learned a workspace binding. They are
 * product facts, intentionally separate from any MCP transport session ID.
 */
export type ProjectBindingSource = 'startup-cwd' | 'mcp-roots' | 'explicit-project-root';

export interface ProjectBindingSnapshot {
  projectRoot: string;
  source: ProjectBindingSource;
  explicit: boolean;
  projectId?: string;
}

export interface MemorixRequestContext extends ProjectBindingSnapshot {
  actorId?: string;
}

function resolveRoot(projectRoot: string): string {
  const value = projectRoot.trim();
  if (!value) throw new Error('Project binding requires a non-empty project root');
  return path.resolve(value);
}

/**
 * One connection may keep this object today, while a future stateless adapter
 * can construct it from fixed server configuration. No HTTP session identifier
 * is accepted or stored here.
 */
export class ProjectBindingController {
  private current: ProjectBindingSnapshot;

  constructor(projectRoot: string) {
    this.current = {
      projectRoot: resolveRoot(projectRoot),
      source: 'startup-cwd',
      explicit: false,
    };
  }

  snapshot(): ProjectBindingSnapshot {
    return { ...this.current };
  }

  requestContext(actorId?: string): MemorixRequestContext {
    return {
      ...this.snapshot(),
      ...(actorId ? { actorId } : {}),
    };
  }

  isExplicit(): boolean {
    return this.current.explicit;
  }

  /** Roots are advisory and may never overwrite an explicit user binding. */
  bindFromRoots(projectRoot: string): boolean {
    if (this.current.explicit) return false;
    this.replace(projectRoot, 'mcp-roots');
    return true;
  }

  bindExplicit(projectRoot: string): void {
    this.replace(projectRoot, 'explicit-project-root');
  }

  bindStartup(projectRoot: string): void {
    if (this.current.explicit) return;
    this.replace(projectRoot, 'startup-cwd');
  }

  /** Set only after the caller has verified the path maps to a real project. */
  recordResolvedProject(projectId: string, projectRoot?: string): void {
    const normalizedProjectId = projectId.trim();
    if (!normalizedProjectId) throw new Error('Project binding requires a non-empty project ID');
    this.current = {
      ...this.current,
      ...(projectRoot ? { projectRoot: resolveRoot(projectRoot) } : {}),
      projectId: normalizedProjectId,
    };
  }

  private replace(projectRoot: string, source: ProjectBindingSource): void {
    this.current = {
      projectRoot: resolveRoot(projectRoot),
      source,
      explicit: source === 'explicit-project-root',
    };
  }
}

export function createProjectBindingController(projectRoot: string): ProjectBindingController {
  return new ProjectBindingController(projectRoot);
}
