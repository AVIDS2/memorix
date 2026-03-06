/**
 * Rules Syncer
 *
 * Core sync engine for cross-agent rule synchronization.
 * Scans project for rule files from all supported agents,
 * deduplicates by content hash, detects conflicts, and
 * generates output in any target agent format.
 *
 * This is the ~15% original logic in Memorix — dedup and
 * conflict detection are not found in any existing tool.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { UnifiedRule, RuleSource, RuleFormatAdapter } from '../types.js';
import { CursorAdapter } from './adapters/cursor.js';
import { ClaudeCodeAdapter } from './adapters/claude-code.js';
import { CodexAdapter } from './adapters/codex.js';
import { WindsurfAdapter } from './adapters/windsurf.js';
import { AntigravityAdapter } from './adapters/antigravity.js';
import { CopilotAdapter } from './adapters/copilot.js';
import { KiroAdapter } from './adapters/kiro.js';
import { TraeAdapter } from './adapters/trae.js';

/** A detected conflict between two rules */
export interface RuleConflict {
  ruleA: UnifiedRule;
  ruleB: UnifiedRule;
  reason: string;
}

/** Sync status report */
export interface SyncStatus {
  totalRules: number;
  uniqueRules: number;
  sources: RuleSource[];
  conflicts: RuleConflict[];
}

/** File scan patterns for each adapter */
interface ScanEntry {
  adapter: RuleFormatAdapter;
  paths: string[];
}

export class RulesSyncer {
  private readonly projectRoot: string;
  private readonly adapters: Map<RuleSource, RuleFormatAdapter>;

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
    this.adapters = new Map();

    const all: RuleFormatAdapter[] = [
      new CursorAdapter(),
      new ClaudeCodeAdapter(),
      new CodexAdapter(),
      new WindsurfAdapter(),
      new AntigravityAdapter(),
      new CopilotAdapter(),
      new KiroAdapter(),
      new TraeAdapter(),
    ];
    for (const a of all) {
      this.adapters.set(a.source, a);
    }
  }

  /** Scan the project root for all known rule files and parse them */
  async scanRules(): Promise<UnifiedRule[]> {
    const rules: UnifiedRule[] = [];

    const scanEntries = this.buildScanEntries();

    for (const entry of scanEntries) {
      for (const scanPath of entry.paths) {
        const found = await this.findFiles(scanPath);
        for (const filePath of found) {
          try {
            const content = await fs.readFile(filePath, 'utf-8');
            const relativePath = path.relative(this.projectRoot, filePath).replace(/\\/g, '/');
            const parsed = entry.adapter.parse(relativePath, content);
            rules.push(...parsed);
          } catch {
            // Skip unreadable files
          }
        }
      }
    }

    return rules;
  }

  /** Remove duplicate rules by content hash, keeping highest priority */
  deduplicateRules(rules: UnifiedRule[]): UnifiedRule[] {
    const byHash = new Map<string, UnifiedRule>();

    for (const rule of rules) {
      const existing = byHash.get(rule.hash);
      if (!existing || rule.priority > existing.priority) {
        byHash.set(rule.hash, rule);
      }
    }

    return Array.from(byHash.values());
  }

  /** Detect conflicts: rules with overlapping paths but different content */
  detectConflicts(rules: UnifiedRule[]): RuleConflict[] {
    const conflicts: RuleConflict[] = [];

    for (let i = 0; i < rules.length; i++) {
      for (let j = i + 1; j < rules.length; j++) {
        const a = rules[i];
        const b = rules[j];

        // Only compare rules from different sources
        if (a.source === b.source) continue;
        // Only compare if both have overlapping paths
        if (a.scope === 'path-specific' && b.scope === 'path-specific') {
          if (this.pathsOverlap(a.paths || [], b.paths || [])) {
            conflicts.push({
              ruleA: a,
              ruleB: b,
              reason: `Overlapping paths: ${a.source} vs ${b.source}`,
            });
          }
        }
      }
    }

    return conflicts;
  }

  /** Generate rule files for a target agent format */
  generateForTarget(
    rules: UnifiedRule[],
    target: RuleSource,
  ): { filePath: string; content: string }[] {
    const adapter = this.adapters.get(target);
    if (!adapter) {
      throw new Error(`No adapter for target: ${target}`);
    }
    return adapter.generate(rules);
  }

  /** Get a full sync status report */
  async syncStatus(): Promise<SyncStatus> {
    const rules = await this.scanRules();
    const deduped = this.deduplicateRules(rules);
    const conflicts = this.detectConflicts(deduped);
    const sources = [...new Set(rules.map(r => r.source))];

    return {
      totalRules: rules.length,
      uniqueRules: deduped.length,
      sources,
      conflicts,
    };
  }

  /** Build scan entries mapping adapters to their file search paths */
  private buildScanEntries(): ScanEntry[] {
    const entries: ScanEntry[] = [];

    for (const adapter of this.adapters.values()) {
      const absolutePaths = adapter.filePatterns.map(p =>
        path.join(this.projectRoot, p),
      );
      entries.push({ adapter, paths: absolutePaths });
    }

    return entries;
  }

  /** Find files matching a glob-like path (simple implementation) */
  private async findFiles(pattern: string): Promise<string[]> {
    const dir = path.dirname(pattern);
    const fileGlob = path.basename(pattern);

    try {
      const stat = await fs.stat(dir);
      if (!stat.isDirectory()) {
        // It's a direct file path
        try {
          await fs.access(pattern);
          return [pattern];
        } catch {
          return [];
        }
      }
    } catch {
      // If dir doesn't exist, check if pattern itself is a file
      try {
        await fs.access(pattern);
        return [pattern];
      } catch {
        return [];
      }
    }

    // If it's a glob pattern (contains *), list dir and filter
    if (fileGlob.includes('*')) {
      try {
        const files = await fs.readdir(dir);
        const ext = fileGlob.replace('*', '');
        return files
          .filter(f => ext ? f.endsWith(ext) : true)
          .map(f => path.join(dir, f));
      } catch {
        return [];
      }
    }

    // Direct file
    try {
      await fs.access(path.join(dir, fileGlob));
      return [path.join(dir, fileGlob)];
    } catch {
      return [];
    }
  }

  /** Check if two sets of glob paths overlap (simplified: exact match) */
  private pathsOverlap(a: string[], b: string[]): boolean {
    for (const pa of a) {
      for (const pb of b) {
        if (pa === pb) return true;
      }
    }
    return false;
  }
}
