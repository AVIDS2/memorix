/**
 * Git Knowledge Extractor
 *
 * Extracts engineering knowledge from git commits, diffs, and logs.
 * This is the Git→Memory direction — no other memory project does this.
 *
 * Git records code changes. Memorix records engineering knowledge.
 * This module bridges the gap.
 */

import { execSync } from 'node:child_process';

export interface CommitInfo {
  hash: string;
  shortHash: string;
  author: string;
  date: string;
  subject: string;
  body: string;
  filesChanged: string[];
  insertions: number;
  deletions: number;
  diffSummary: string;
}

export interface IngestResult {
  commit: CommitInfo;
  entityName: string;
  type: string;
  title: string;
  narrative: string;
  facts: string[];
  concepts: string[];
  filesModified: string[];
}

/**
 * Get commit info by hash (or HEAD).
 */
export function getCommitInfo(cwd: string, ref = 'HEAD'): CommitInfo {
  const FORMAT = '%H%n%h%n%aN%n%aI%n%s%n%b';
  const raw = execSync(
    `git log -1 --format="${FORMAT}" ${ref}`,
    { cwd, encoding: 'utf-8', timeout: 10000 },
  ).trim();

  const lines = raw.split('\n');
  const hash = lines[0];
  const shortHash = lines[1];
  const author = lines[2];
  const date = lines[3];
  const subject = lines[4];
  const body = lines.slice(5).join('\n').trim();

  // Get diff stat
  const stat = execSync(
    `git diff-tree --no-commit-id --numstat ${hash}`,
    { cwd, encoding: 'utf-8', timeout: 10000 },
  ).trim();

  let insertions = 0;
  let deletions = 0;
  const filesChanged: string[] = [];

  for (const line of stat.split('\n').filter(Boolean)) {
    const parts = line.split('\t');
    if (parts.length >= 3) {
      const ins = parseInt(parts[0], 10) || 0;
      const del = parseInt(parts[1], 10) || 0;
      insertions += ins;
      deletions += del;
      filesChanged.push(parts[2]);
    }
  }

  // Get short diff summary (first 500 chars of diff)
  let diffSummary = '';
  try {
    const diff = execSync(
      `git diff-tree -p --no-commit-id ${hash}`,
      { cwd, encoding: 'utf-8', timeout: 10000, maxBuffer: 1024 * 100 },
    );
    diffSummary = diff.substring(0, 500);
  } catch { /* diff may be too large */ }

  return {
    hash, shortHash, author, date, subject, body,
    filesChanged, insertions, deletions, diffSummary,
  };
}

/**
 * Get recent N commits.
 */
export function getRecentCommits(cwd: string, count = 10): CommitInfo[] {
  const hashes = execSync(
    `git log --format="%H" -${count}`,
    { cwd, encoding: 'utf-8', timeout: 10000 },
  ).trim().split('\n').filter(Boolean);

  return hashes.map(hash => getCommitInfo(cwd, hash));
}

/**
 * Infer observation type from commit message.
 */
function inferType(subject: string, body: string): string {
  // Priority 1: conventional commit prefix (e.g., "fix:", "feat:", "test:")
  const prefix = subject.match(/^(\w+)[\s(:]/)?.[1]?.toLowerCase() ?? '';
  const prefixMap: Record<string, string> = {
    fix: 'problem-solution', bugfix: 'problem-solution', hotfix: 'problem-solution',
    feat: 'what-changed', feature: 'what-changed',
    refactor: 'what-changed', chore: 'what-changed',
    docs: 'how-it-works', doc: 'how-it-works',
    test: 'discovery', spec: 'discovery',
    ci: 'what-changed', cd: 'what-changed',
    security: 'gotcha',
    revert: 'problem-solution',
    deprecate: 'decision',
    perf: 'trade-off',
  };
  if (prefixMap[prefix]) return prefixMap[prefix];

  // Priority 2: keyword scan in full text
  const text = `${subject} ${body}`.toLowerCase();
  if (/\b(fix|bug|crash|error|issue|hotfix|patch)\b/.test(text)) return 'problem-solution';
  if (/\b(feat|feature|add|implement|new)\b/.test(text)) return 'what-changed';
  if (/\b(refactor|clean|restructure|reorganize)\b/.test(text)) return 'what-changed';
  if (/\b(chore|bump|version|release|publish)\b/.test(text)) return 'what-changed';
  if (/\b(doc|readme|changelog)\b/.test(text)) return 'how-it-works';
  if (/\b(test|spec|e2e|coverage)\b/.test(text)) return 'discovery';
  if (/\b(ci|cd|workflow|deploy|docker)\b/.test(text)) return 'what-changed';
  if (/\b(security|vulnerability|cve)\b/.test(text)) return 'gotcha';
  if (/\b(revert|rollback)\b/.test(text)) return 'problem-solution';
  if (/\b(deprecat|remove|drop)\b/.test(text)) return 'decision';
  if (/\b(perf|optim|speed|cache)\b/.test(text)) return 'trade-off';

  return 'what-changed';
}

/**
 * Extract concepts from commit.
 */
function extractConcepts(commit: CommitInfo): string[] {
  const concepts: string[] = [];
  const text = `${commit.subject} ${commit.body}`;

  // Extract technology/library mentions
  const techPatterns = /\b(react|vue|angular|express|fastify|redis|postgres|mysql|docker|nginx|webpack|vite|tsup|vitest|jest)\b/gi;
  for (const match of text.matchAll(techPatterns)) {
    concepts.push(match[0].toLowerCase());
  }

  // Extract conventional commit scope
  const scopeMatch = commit.subject.match(/^\w+\(([^)]+)\)/);
  if (scopeMatch) {
    concepts.push(scopeMatch[1]);
  }

  return [...new Set(concepts)];
}

/**
 * Convert a commit into a memory-ready ingest result.
 */
export function ingestCommit(commit: CommitInfo): IngestResult {
  const type = inferType(commit.subject, commit.body);

  // Entity name from conventional commit scope or first file directory
  let entityName = 'project';
  const scopeMatch = commit.subject.match(/^\w+\(([^)]+)\)/);
  if (scopeMatch) {
    entityName = scopeMatch[1];
  } else if (commit.filesChanged.length > 0) {
    const firstDir = commit.filesChanged[0].split('/')[0];
    if (firstDir && firstDir !== '.') entityName = firstDir;
  }

  // Build narrative from commit message + stats
  const parts: string[] = [];
  parts.push(commit.subject);
  if (commit.body) parts.push(commit.body);
  parts.push(`\n[${commit.shortHash}] ${commit.author} @ ${commit.date}`);
  parts.push(`Files: ${commit.filesChanged.length} changed (+${commit.insertions}/-${commit.deletions})`);

  const narrative = parts.join('\n');

  // Extract facts
  const facts: string[] = [];
  facts.push(`Commit: ${commit.shortHash}`);
  facts.push(`Author: ${commit.author}`);
  if (commit.filesChanged.length <= 5) {
    facts.push(`Files: ${commit.filesChanged.join(', ')}`);
  } else {
    facts.push(`Files: ${commit.filesChanged.length} changed`);
  }
  facts.push(`Changes: +${commit.insertions}/-${commit.deletions}`);

  return {
    commit,
    entityName,
    type,
    title: commit.subject.length > 60 ? commit.subject.substring(0, 60) + '...' : commit.subject,
    narrative,
    facts,
    concepts: extractConcepts(commit),
    filesModified: commit.filesChanged,
  };
}
