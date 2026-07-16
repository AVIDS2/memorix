/**
 * Git Commit Noise Filter
 *
 * Filters out low-value commits that would dilute memory quality.
 * Codex identified this as the #1 priority for Git-Memory maturity:
 * "Not every commit is worth becoming a long-term memory."
 *
 * Built-in heuristics (no LLM needed):
 *   - Merge commit detection
 *   - Low-signal commit message patterns (typo, format, bump, lint, etc.)
 *   - File-only commits (only lockfiles, generated files, etc.)
 *
 * All thresholds are configurable via memorix.yml `git` section.
 */

import type { CommitInfo } from './extractor.js';

// ─── Types ───

export interface NoiseFilterConfig {
  /** Skip merge commits entirely (default: true) */
  skipMergeCommits?: boolean;
  /** File glob patterns to exclude (default: lockfiles, generated files) */
  excludePatterns?: string[];
  /** Additional commit message phrases to skip (literal, case-insensitive) */
  noiseKeywords?: string[];
}

export interface FilterResult {
  /** Whether this commit should be skipped */
  skip: boolean;
  /** Human-readable reason for skipping */
  reason?: string;
}

// ─── Built-in Noise Patterns ───

/**
 * Commit message patterns that indicate low-value commits.
 * These are checked case-insensitively against the full subject line.
 */
const NOISE_MESSAGE_PATTERNS: { pattern: RegExp; reason: string }[] = [
  // Typo / formatting
  { pattern: /^fix(?:ed)?\s*typo/i, reason: 'typo fix' },
  { pattern: /^typo\b/i, reason: 'typo fix' },
  { pattern: /^(?:fix|correct)\s*(?:spelling|grammar|whitespace|indent)/i, reason: 'formatting fix' },
  { pattern: /^(?:format|lint|prettier|eslint|style)\b/i, reason: 'code formatting' },
  { pattern: /^(?:auto-?format|code\s*style)/i, reason: 'auto-formatting' },

  // Lockfile / dependency bumps
  { pattern: /^(?:chore|build)?\(?deps?\)?[:/]?\s*(?:bump|update|upgrade)\b/i, reason: 'dependency bump' },
  { pattern: /^bump\s+\S+\s+(?:from|to)\b/i, reason: 'dependency bump' },
  { pattern: /^(?:yarn|npm|pnpm)\s+(?:lock|update)\b/i, reason: 'lockfile update' },
  { pattern: /^update\s+(?:lock|yarn\.lock|package-lock)/i, reason: 'lockfile update' },

  // Merge noise
  { pattern: /^Merge\s+(?:branch|pull\s+request|remote)/i, reason: 'merge commit' },
  { pattern: /^Merge\s+\S+\s+into\s+\S+/i, reason: 'merge commit' },

  // WIP / temporary
  { pattern: /^wip\b/i, reason: 'work in progress' },
  { pattern: /^(?:temp|tmp|todo|fixme|hack)\b/i, reason: 'temporary commit' },
  { pattern: /^(?:save|saving|checkpoint|backup)\b/i, reason: 'checkpoint commit' },

  // Empty / trivial
  { pattern: /^(?:initial\s+commit|first\s+commit|init)\s*$/i, reason: 'initial commit (no content)' },
  { pattern: /^\.$/i, reason: 'empty message' },
  { pattern: /^(?:update|change|fix|edit|modify)\s*$/i, reason: 'non-descriptive message' },

  // CI automation
  { pattern: /^\[(?:ci|cd)\s+skip\]/i, reason: 'CI skip marker' },

  // Generated
  { pattern: /^(?:auto-?generated|generated\s+by)\b/i, reason: 'auto-generated' },
];

/**
 * File patterns that indicate a commit is "lockfile-only" or "generated-only".
 * If ALL changed files match these patterns, the commit is considered noise.
 */
const NOISE_FILE_PATTERNS: RegExp[] = [
  /^package-lock\.json$/,
  /^yarn\.lock$/,
  /^pnpm-lock\.yaml$/,
  /^Gemfile\.lock$/,
  /^Cargo\.lock$/,
  /^poetry\.lock$/,
  /^composer\.lock$/,
  /^go\.sum$/,
  /\.min\.(js|css)$/,
  /\.map$/,              // source maps
  /^dist\//,             // build output
  /^build\//,            // build output
  /^\.DS_Store$/,
  /^Thumbs\.db$/,
];

// ─── Filter Logic ───

/**
 * Check if a commit is a merge commit (has 2+ parents).
 */
function isMergeCommit(commit: CommitInfo): boolean {
  // Merge commits typically have a subject starting with "Merge"
  return /^Merge\s+/i.test(commit.subject);
}

/**
 * Check if ALL changed files match noise file patterns.
 * (Commit that only touches lockfiles/generated files.)
 */
function isAllFilesNoise(files: string[], extraPatterns?: string[]): boolean {
  if (files.length === 0) return false;

  return files.every((file) =>
    NOISE_FILE_PATTERNS.some((pattern) => pattern.test(file)) ||
    (extraPatterns ?? []).some((pattern) => matchesGlob(file, pattern)),
  );
}

/**
 * Glob matching without compiling user configuration into a JavaScript regex.
 * `*` matches any sequence and `?` matches one character, including `/`, which
 * preserves the old file-pattern semantics while bounding work to O(m*n).
 */
function matchesGlob(file: string, pattern: string): boolean {
  const text = file.replace(/\\/g, '/');
  const glob = pattern.replace(/\\/g, '/');
  if (!glob) return false;

  let previous = new Array<boolean>(text.length + 1).fill(false);
  previous[0] = true;
  for (const token of glob) {
    const current = new Array<boolean>(text.length + 1).fill(false);
    if (token === '*') {
      current[0] = previous[0];
      for (let index = 1; index <= text.length; index++) {
        current[index] = previous[index] || current[index - 1];
      }
    } else {
      for (let index = 1; index <= text.length; index++) {
        current[index] = previous[index - 1] && (token === '?' || token === text[index - 1]);
      }
    }
    previous = current;
  }
  return previous[text.length];
}

/**
 * Determine if a commit should be filtered out as noise.
 *
 * @param commit - The commit to evaluate
 * @param config - Optional config overrides from memorix.yml git section
 * @returns FilterResult with skip=true if the commit should be skipped
 */
export function shouldFilterCommit(
  commit: CommitInfo,
  config?: NoiseFilterConfig,
): FilterResult {
  const skipMerge = config?.skipMergeCommits ?? true;

  // 1. Merge commits
  if (skipMerge && isMergeCommit(commit)) {
    return { skip: true, reason: 'merge commit (git.skipMergeCommits: true)' };
  }

  // 2. Built-in message pattern matching
  for (const { pattern, reason } of NOISE_MESSAGE_PATTERNS) {
    if (pattern.test(commit.subject)) {
      return { skip: true, reason: `noise pattern: ${reason}` };
    }
  }

  // 3. User-defined literal noise keywords from memorix.yml
  if (config?.noiseKeywords) {
    for (const keyword of config.noiseKeywords) {
      const needle = keyword.trim().toLocaleLowerCase();
      if (!needle) continue;
      const message = `${commit.subject}\n${commit.body}`.toLocaleLowerCase();
      if (message.includes(needle)) {
        return { skip: true, reason: `user noise keyword: ${keyword}` };
      }
    }
  }

  // 4. All-noise-files check (lockfile-only, generated-only commits)
  if (commit.filesChanged.length > 0 && isAllFilesNoise(commit.filesChanged, config?.excludePatterns)) {
    return { skip: true, reason: 'all changed files are lockfiles/generated files' };
  }

  // 5. Extremely small commits with non-descriptive messages
  // (e.g., single-character change with vague subject)
  if (
    commit.insertions + commit.deletions <= 2 &&
    commit.subject.length < 15 &&
    !/\b(fix|feat|refactor|security|break)/i.test(commit.subject)
  ) {
    return { skip: true, reason: 'trivial change with non-descriptive message' };
  }

  return { skip: false };
}

/**
 * Filter an array of commits, returning only signal-worthy ones.
 * Returns both kept and skipped with reasons (for CLI reporting).
 */
export function filterCommits(
  commits: CommitInfo[],
  config?: NoiseFilterConfig,
): { kept: CommitInfo[]; skipped: { commit: CommitInfo; reason: string }[] } {
  const kept: CommitInfo[] = [];
  const skipped: { commit: CommitInfo; reason: string }[] = [];

  for (const commit of commits) {
    const result = shouldFilterCommit(commit, config);
    if (result.skip) {
      skipped.push({ commit, reason: result.reason! });
    } else {
      kept.push(commit);
    }
  }

  return { kept, skipped };
}
