import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { ProjectInfo } from '../types.js';

export interface CurrentProjectFacts {
  packageVersion?: string;
  latestChangelog?: {
    version: string;
    date?: string;
  };
  git: {
    available: boolean;
    branch?: string;
    commit?: string;
    latestCommit?: string;
    dirty: boolean;
    detached: boolean;
  };
  staleNotes: ProjectStaleNote[];
}

export interface ProjectStaleNote {
  path: string;
  lastUpdated?: string;
  branchHint?: string;
  reason: string;
}

const STALE_NOTE_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

function readTextIfExists(filePath: string): string | null {
  try {
    if (!existsSync(filePath)) return null;
    return readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
}

function readPackageVersion(rootPath: string): string | undefined {
  const text = readTextIfExists(path.join(rootPath, 'package.json'));
  if (!text) return undefined;
  try {
    const parsed = JSON.parse(text) as { version?: unknown };
    return typeof parsed.version === 'string' ? parsed.version : undefined;
  } catch {
    return undefined;
  }
}

function readLatestChangelog(rootPath: string): CurrentProjectFacts['latestChangelog'] {
  const text = readTextIfExists(path.join(rootPath, 'CHANGELOG.md'));
  if (!text) return undefined;
  const match = text.match(/^##\s+\[?v?([^\]\s]+)\]?\s*(?:-\s*(\d{4}-\d{2}-\d{2}))?/m);
  if (!match) return undefined;
  return {
    version: match[1],
    ...(match[2] ? { date: match[2] } : {}),
  };
}

function runGit(rootPath: string, args: string[]): string | undefined {
  try {
    return execFileSync('git', ['-C', rootPath, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 3000,
    }).trim() || undefined;
  } catch {
    return undefined;
  }
}

function readGitFacts(rootPath: string): CurrentProjectFacts['git'] {
  const available = runGit(rootPath, ['rev-parse', '--is-inside-work-tree']) === 'true';
  if (!available) {
    return { available: false, dirty: false, detached: false };
  }

  const branch = runGit(rootPath, ['symbolic-ref', '--quiet', '--short', 'HEAD'])
    ?? runGit(rootPath, ['branch', '--show-current']);
  const commit = runGit(rootPath, ['rev-parse', '--short', 'HEAD']);
  const latestCommit = runGit(rootPath, ['log', '-1', '--pretty=%s']);
  const dirty = Boolean(runGit(rootPath, ['status', '--porcelain']));
  return {
    available: true,
    ...(branch ? { branch } : {}),
    ...(commit ? { commit } : {}),
    ...(latestCommit ? { latestCommit } : {}),
    dirty,
    detached: !branch,
  };
}

export function formatGitFact(git: CurrentProjectFacts['git']): string {
  if (!git.available) return 'Git: unavailable';
  const parts: string[] = [];
  if (git.detached) parts.push('detached HEAD');
  else if (git.branch) parts.push('branch ' + git.branch);
  if (git.commit) parts.push('commit ' + git.commit);
  parts.push(git.dirty ? 'dirty worktree' : 'clean worktree');
  return 'Git: ' + parts.join(', ');
}

function parseProgressNote(content: string): Pick<ProjectStaleNote, 'lastUpdated' | 'branchHint'> {
  const lastUpdated = content.match(/Last updated\*\*:\s*(\d{4}-\d{2}-\d{2})/i)
    ?? content.match(/Last updated:\s*(\d{4}-\d{2}-\d{2})/i);
  const branchHint = content.match(/Branch\*\*:\s*([^\r\n]+)/i)
    ?? content.match(/Branch:\s*([^\r\n]+)/i);
  return {
    ...(lastUpdated?.[1] ? { lastUpdated: lastUpdated[1].trim() } : {}),
    ...(branchHint?.[1] ? { branchHint: branchHint[1].trim().replace(/^`|`$/g, '') } : {}),
  };
}

function compareDateStrings(a?: string, b?: string): number | null {
  if (!a || !b) return null;
  const aMs = Date.parse(`${a}T00:00:00Z`);
  const bMs = Date.parse(`${b}T00:00:00Z`);
  if (!Number.isFinite(aMs) || !Number.isFinite(bMs)) return null;
  return aMs - bMs;
}

function detectStaleProgressNotes(input: {
  rootPath: string;
  latestChangelog?: CurrentProjectFacts['latestChangelog'];
  now: Date;
}): ProjectStaleNote[] {
  const candidates = [
    'progress.txt',
    'docs/dev-log/progress.txt',
    'docs/memcode/dev-log/progress.txt',
  ];
  const notes: ProjectStaleNote[] = [];

  for (const relPath of candidates) {
    const content = readTextIfExists(path.join(input.rootPath, relPath));
    if (!content) continue;
    const parsed = parseProgressNote(content);
    const olderThanChangelog = compareDateStrings(parsed.lastUpdated, input.latestChangelog?.date);
    const updatedAtMs = parsed.lastUpdated ? Date.parse(`${parsed.lastUpdated}T00:00:00Z`) : NaN;
    const olderThanAgeLimit = Number.isFinite(updatedAtMs)
      ? input.now.getTime() - updatedAtMs > STALE_NOTE_MAX_AGE_MS
      : false;

    if (olderThanChangelog !== null && olderThanChangelog < 0) {
      notes.push({
        path: relPath,
        ...parsed,
        reason: `older than latest changelog ${input.latestChangelog?.version}${input.latestChangelog?.date ? ` (${input.latestChangelog.date})` : ''}`,
      });
    } else if (olderThanAgeLimit) {
      notes.push({
        path: relPath,
        ...parsed,
        reason: 'older than 14 days',
      });
    }
  }

  return notes;
}

export function collectCurrentProjectFacts(input: {
  project: Pick<ProjectInfo, 'rootPath'>;
  now: Date;
}): CurrentProjectFacts {
  const latestChangelog = readLatestChangelog(input.project.rootPath);
  const packageVersion = readPackageVersion(input.project.rootPath);
  return {
    ...(packageVersion ? { packageVersion } : {}),
    ...(latestChangelog ? { latestChangelog } : {}),
    git: readGitFacts(input.project.rootPath),
    staleNotes: detectStaleProgressNotes({
      rootPath: input.project.rootPath,
      latestChangelog,
      now: input.now,
    }),
  };
}
