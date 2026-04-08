import path from 'node:path';

export type InitScope = 'global' | 'project';

export interface InitArgs {
  global?: boolean;
  project?: boolean;
}

export function resolveInitScope(args: InitArgs, selectedScope?: InitScope): InitScope {
  if (args.global && args.project) {
    throw new Error('Choose either --global or --project, not both.');
  }

  if (args.global) {
    return 'global';
  }

  if (args.project) {
    return 'project';
  }

  return selectedScope ?? 'global';
}

export function getInitTargetDir(scope: InitScope, cwd: string, homeDir: string): string {
  return scope === 'global'
    ? path.join(homeDir, '.memorix')
    : cwd;
}

export function getInitScopeDescription(scope: InitScope): string {
  return scope === 'global'
    ? 'Global defaults for all projects on this machine'
    : 'Project-level overrides for the current repository';
}

export function shouldOfferDotenv(scope: InitScope): boolean {
  return scope === 'global' || scope === 'project';
}
