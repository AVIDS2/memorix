/**
 * Context Collector — Phase 6a: Gather project context for the planner.
 *
 * Collects file tree, dependencies, git history, and team capabilities
 * so the planner can make informed task decomposition decisions.
 * Pure side-effect-free reads — no LLM calls.
 */

import { execSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { CodeGraphStore } from '../codegraph/store.js';

// ── Types ──────────────────────────────────────────────────────────

export interface PlanningContext {
  /** Truncated file tree (gitignored files excluded) */
  fileTree: string;
  /** package.json dependencies summary (or empty string) */
  dependencies: string;
  /** Recent git log (last 10 commits, one-line) */
  gitLog: string;
  /** Existing CodeGraph Memory summary, if available */
  codeMemory: string;
  /** Available agent names */
  agents: string[];
}

export interface ContextCollectorOpts {
  projectDir: string;
  agents: string[];
  /** Project ID for CodeGraph Memory lookup */
  projectId?: string;
  /** Project display name for CodeGraph Memory summary */
  projectName?: string;
  /** Memorix data directory containing the CodeGraph tables */
  dataDir?: string;
  /** Max entries in file tree (default: 80) */
  maxFileTreeEntries?: number;
  /** Max git log entries (default: 10) */
  maxGitLogEntries?: number;
}

// ── Implementation ─────────────────────────────────────────────────

/**
 * Collect project context. All operations are best-effort —
 * failures produce empty strings rather than throwing.
 */
export function collectPlanningContext(opts: ContextCollectorOpts): PlanningContext {
  const {
    projectDir,
    agents,
    maxFileTreeEntries = 80,
    maxGitLogEntries = 10,
  } = opts;

  return {
    fileTree: collectFileTree(projectDir, maxFileTreeEntries),
    dependencies: collectDependencies(projectDir),
    gitLog: collectGitLog(projectDir, maxGitLogEntries),
    codeMemory: collectCodeMemory(opts),
    agents,
  };
}

/**
 * Serialize context into a prompt-ready string.
 */
export function contextToPromptSection(ctx: PlanningContext): string {
  const sections: string[] = [];

  if (ctx.fileTree) {
    sections.push(`## Project Structure\n\`\`\`\n${ctx.fileTree}\n\`\`\``);
  }
  if (ctx.dependencies) {
    sections.push(`## Dependencies\n\`\`\`\n${ctx.dependencies}\n\`\`\``);
  }
  if (ctx.gitLog) {
    sections.push(`## Recent Git History\n\`\`\`\n${ctx.gitLog}\n\`\`\``);
  }
  if (ctx.codeMemory) {
    sections.push(`## Code Memory\n${ctx.codeMemory}`);
  }
  if (ctx.agents.length > 0) {
    sections.push(`## Available Agents\n${ctx.agents.join(', ')}`);
  }

  return sections.length > 0
    ? `# Project Context\n\n${sections.join('\n\n')}`
    : '';
}

// ── Internals ──────────────────────────────────────────────────────

function collectFileTree(projectDir: string, maxEntries: number): string {
  try {
    // Use git ls-files to respect .gitignore
    const raw = execSync('git ls-files --cached --others --exclude-standard', {
      cwd: projectDir,
      encoding: 'utf-8',
      timeout: 5_000,
      maxBuffer: 512 * 1024,
    }).trim();

    if (!raw) return '';
    const lines = raw.split('\n');
    const truncated = lines.slice(0, maxEntries);
    const suffix = lines.length > maxEntries
      ? `\n... (${lines.length - maxEntries} more files)`
      : '';
    return truncated.join('\n') + suffix;
  } catch {
    return '';
  }
}

function collectDependencies(projectDir: string): string {
  try {
    const pkgPath = join(projectDir, 'package.json');
    if (!existsSync(pkgPath)) return '';
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    const parts: string[] = [];
    if (pkg.dependencies && Object.keys(pkg.dependencies).length > 0) {
      parts.push(`dependencies: ${Object.keys(pkg.dependencies).join(', ')}`);
    }
    if (pkg.devDependencies && Object.keys(pkg.devDependencies).length > 0) {
      parts.push(`devDependencies: ${Object.keys(pkg.devDependencies).join(', ')}`);
    }
    return parts.join('\n');
  } catch {
    return '';
  }
}

function collectGitLog(projectDir: string, maxEntries: number): string {
  try {
    return execSync(`git log --oneline -${maxEntries}`, {
      cwd: projectDir,
      encoding: 'utf-8',
      timeout: 5_000,
    }).trim();
  } catch {
    return '';
  }
}

function collectCodeMemory(opts: ContextCollectorOpts): string {
  if (!opts.projectId || !opts.dataDir) return '';

  try {
    const store = new CodeGraphStore();
    // init() keeps an async signature for store API consistency, but opens SQLite synchronously today.
    void store.init(opts.dataDir);

    const status = store.status(opts.projectId);
    if (status.files === 0) return '';

    const files = store.listFiles(opts.projectId);
    const languages = [...files.reduce((map, file) => {
      const language = file.language ?? 'unknown';
      map.set(language, (map.get(language) ?? 0) + 1);
      return map;
    }, new Map<string, number>()).entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([language, count]) => `${language} ${count}`)
      .join(', ');
    const suggestedReads = files
      .slice(0, 8)
      .map(file => file.path);

    const lines = [
      `Code memory for ${opts.projectName ?? opts.projectId}: ${status.files} files / ${status.symbols} symbols / ${status.edges} relationships / ${status.refs} memory links`,
      `Languages: ${languages || 'none indexed yet'}`,
    ];
    if (status.indexedAt) lines.push(`Last scan: ${status.indexedAt}`);
    if (suggestedReads.length > 0) {
      lines.push('Suggested reads:');
      suggestedReads.forEach((path, index) => lines.push(`${index + 1}. ${path}`));
    }
    return lines.join('\n');
  } catch {
    return '';
  }
}
