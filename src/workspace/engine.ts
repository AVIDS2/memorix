import { readFileSync, readdirSync, existsSync, cpSync, mkdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { homedir } from 'node:os';
import type {
  AgentTarget,
  MCPServerEntry,
  MCPConfigAdapter,
  WorkflowEntry,
  WorkspaceSyncResult,
  RuleSource,
  SkillEntry,
  SkillConflict,
} from '../types.js';
import { WindsurfMCPAdapter } from './mcp-adapters/windsurf.js';
import { CursorMCPAdapter } from './mcp-adapters/cursor.js';
import { CodexMCPAdapter } from './mcp-adapters/codex.js';
import { ClaudeCodeMCPAdapter } from './mcp-adapters/claude-code.js';
import { WorkflowSyncer } from './workflow-sync.js';
import { RulesSyncer } from '../rules/syncer.js';
import { sanitize } from './sanitizer.js';
import { WorkspaceSyncApplier, type ApplyResult } from './applier.js';

/** Scan result from workspace analysis */
export interface WorkspaceScanResult {
  mcpConfigs: Record<AgentTarget, MCPServerEntry[]>;
  workflows: WorkflowEntry[];
  rulesCount: number;
  skills: SkillEntry[];
  skillConflicts: SkillConflict[];
}

/**
 * WorkspaceSyncEngine — orchestrates cross-agent workspace migration.
 *
 * Capabilities:
 * 1. MCP config sync (JSON ↔ TOML across 4 agents)
 * 2. Workflow sync (Windsurf workflows → Codex skills / Cursor rules / CLAUDE.md)
 * 3. Rules sync (via existing RulesSyncer)
 */
export class WorkspaceSyncEngine {
  private adapters: Map<AgentTarget, MCPConfigAdapter>;
  private workflowSyncer: WorkflowSyncer;
  private rulesSyncer: RulesSyncer;

  constructor(private projectRoot: string) {
    this.adapters = new Map<AgentTarget, MCPConfigAdapter>([
      ['windsurf', new WindsurfMCPAdapter()],
      ['cursor', new CursorMCPAdapter()],
      ['codex', new CodexMCPAdapter()],
      ['claude-code', new ClaudeCodeMCPAdapter()],
    ]);
    this.workflowSyncer = new WorkflowSyncer();
    this.rulesSyncer = new RulesSyncer(projectRoot);
  }

  /**
   * Scan the workspace for all agent configs, workflows, and rules.
   */
  async scan(): Promise<WorkspaceScanResult> {
    const mcpConfigs: Record<AgentTarget, MCPServerEntry[]> = {
      windsurf: [],
      cursor: [],
      codex: [],
      'claude-code': [],
    };

    // Scan MCP configs from each agent
    for (const [target, adapter] of this.adapters) {
      const configPath = adapter.getConfigPath(this.projectRoot);
      const globalPath = adapter.getConfigPath();

      // Try project-level first, then global
      for (const path of [configPath, globalPath]) {
        if (existsSync(path)) {
          try {
            const content = readFileSync(path, 'utf-8');
            const servers = adapter.parse(content);
            if (servers.length > 0) {
              mcpConfigs[target] = servers;
              break;
            }
          } catch {
            // Skip unreadable configs
          }
        }
      }
    }

    // Scan Windsurf workflows
    const workflows = this.scanWorkflows();

    // Scan rules
    let rulesCount = 0;
    try {
      const rules = await this.rulesSyncer.scanRules();
      rulesCount = rules.length;
    } catch {
      // Rules scan may fail if no rules exist
    }

    // Scan skills across all agents
    const { skills, conflicts: skillConflicts } = this.scanSkills();

    return { mcpConfigs, workflows, rulesCount, skills, skillConflicts };
  }

  /**
   * Migrate workspace configs to a target agent format.
   * @param items — optional list of specific item names (MCP servers / skills) to sync.
   *               When provided, only matching items are included. Omit to sync all.
   */
  async migrate(target: AgentTarget, items?: string[]): Promise<WorkspaceSyncResult> {
    const scan = await this.scan();
    const result: WorkspaceSyncResult = {
      mcpServers: { scanned: [], generated: [] },
      workflows: { scanned: [], generated: [] },
      rules: { scanned: 0, generated: 0 },
      skills: { scanned: [], conflicts: [], copied: [], skipped: [] },
    };

    const itemFilter = items && items.length > 0
      ? new Set(items.map(i => i.toLowerCase()))
      : null;

    // 1. Merge all MCP servers from all sources (dedup by name)
    const allServers = new Map<string, MCPServerEntry>();
    for (const servers of Object.values(scan.mcpConfigs)) {
      for (const s of servers) {
        if (!allServers.has(s.name)) {
          if (!itemFilter || itemFilter.has(s.name.toLowerCase())) {
            allServers.set(s.name, s);
          }
        }
      }
    }
    result.mcpServers.scanned = Array.from(allServers.values());

    // Generate target MCP config (sanitize sensitive values in output)
    if (result.mcpServers.scanned.length > 0) {
      const adapter = this.adapters.get(target)!;
      const configContent = adapter.generate(result.mcpServers.scanned);
      const configPath = adapter.getConfigPath(this.projectRoot);
      result.mcpServers.generated.push({
        filePath: configPath,
        content: sanitize(configContent),
      });
    }

    // 2. Convert workflows to target format
    result.workflows.scanned = scan.workflows;
    if (scan.workflows.length > 0) {
      result.workflows.generated = this.workflowSyncer.convertAll(scan.workflows, target);
    }

    // 3. Rules sync
    try {
      const rules = await this.rulesSyncer.scanRules();
      result.rules.scanned = rules.length;
      if (rules.length > 0) {
        const deduped = this.rulesSyncer.deduplicateRules(rules);
        const ruleSource = this.agentToRuleSource(target);
        if (ruleSource) {
          const files = this.rulesSyncer.generateForTarget(deduped, ruleSource);
          result.rules.generated = files.length;
        }
      }
    } catch {
      // Rules may not exist
    }

    // 4. Skills sync (no format conversion, just copy folders)
    result.skills.scanned = itemFilter
      ? scan.skills.filter(sk => itemFilter.has(sk.name.toLowerCase()))
      : scan.skills;
    result.skills.conflicts = scan.skillConflicts;

    return result;
  }

  // ---- Private helpers ----

  /** Skills directories per agent */
  private static SKILLS_DIRS: Record<AgentTarget, string[]> = {
    codex: ['.codex/skills', '.agents/skills'],
    cursor: ['.cursor/skills', '.cursor/skills-cursor'],
    windsurf: ['.windsurf/skills'],
    'claude-code': ['.claude/skills'],
  };

  /** Get the target skills directory for an agent */
  private getTargetSkillsDir(target: AgentTarget): string {
    const dirs = WorkspaceSyncEngine.SKILLS_DIRS[target];
    return join(this.projectRoot, dirs[0]);
  }

  /**
   * Scan all agent skills directories and collect unique skills.
   */
  private scanSkills(): { skills: SkillEntry[]; conflicts: SkillConflict[] } {
    const skills: SkillEntry[] = [];
    const conflicts: SkillConflict[] = [];
    const seen = new Map<string, SkillEntry>();
    const home = homedir();

    for (const [agent, dirs] of Object.entries(WorkspaceSyncEngine.SKILLS_DIRS)) {
      for (const dir of dirs) {
        // Check project-level and global
        const paths = [
          join(this.projectRoot, dir),
          join(home, dir),
        ];

        for (const skillsRoot of paths) {
          if (!existsSync(skillsRoot)) continue;

          try {
            const entries = readdirSync(skillsRoot, { withFileTypes: true });
            for (const entry of entries) {
              if (!entry.isDirectory()) continue;

              const skillMd = join(skillsRoot, entry.name, 'SKILL.md');
              if (!existsSync(skillMd)) continue;

              // Parse description from frontmatter
              let description = '';
              try {
                const content = readFileSync(skillMd, 'utf-8');
                const match = content.match(/^---[\s\S]*?description:\s*["']?(.+?)["']?\s*$/m);
                if (match) description = match[1];
              } catch { /* skip */ }

              const newEntry: SkillEntry = {
                name: entry.name,
                description,
                sourcePath: join(skillsRoot, entry.name),
                sourceAgent: agent as AgentTarget,
              };

              const existing = seen.get(entry.name);
              if (existing) {
                // Conflict: same name from different agent
                if (existing.sourceAgent !== agent) {
                  conflicts.push({
                    name: entry.name,
                    kept: existing,
                    skipped: newEntry,
                  });
                }
                continue;
              }

              seen.set(entry.name, newEntry);
              skills.push(newEntry);
            }
          } catch { /* skip unreadable dirs */ }
        }
      }
    }

    return { skills, conflicts };
  }

  /**
   * Copy skills to a target agent's skills directory.
   * Returns list of copied skill names.
   */
  copySkills(skills: SkillEntry[], target: AgentTarget): { copied: string[]; skipped: string[] } {
    const targetDir = this.getTargetSkillsDir(target);
    const copied: string[] = [];
    const skipped: string[] = [];

    for (const skill of skills) {
      // Don't copy a skill back to its own agent
      if (skill.sourceAgent === target) continue;

      const dest = join(targetDir, skill.name);
      if (existsSync(dest)) {
        skipped.push(`${skill.name} (already exists in ${target})`);
        continue;
      }

      try {
        mkdirSync(targetDir, { recursive: true });
        cpSync(skill.sourcePath, dest, { recursive: true });
        copied.push(skill.name);
      } catch { /* skip on error */ }
    }

    return { copied, skipped };
  }

  private scanWorkflows(): WorkflowEntry[] {
    const workflows: WorkflowEntry[] = [];
    const wfDir = join(this.projectRoot, '.windsurf', 'workflows');

    if (!existsSync(wfDir)) return workflows;

    try {
      const files = readdirSync(wfDir).filter((f) => f.endsWith('.md'));
      for (const file of files) {
        try {
          const content = readFileSync(join(wfDir, file), 'utf-8');
          workflows.push(this.workflowSyncer.parseWindsurfWorkflow(file, content));
        } catch {
          // Skip unreadable files
        }
      }
    } catch {
      // Directory read error
    }

    return workflows;
  }

  /**
   * Apply migration results to disk with backup and rollback.
   *
   * Safety features:
   *   - Backs up every existing file before overwriting
   *   - Atomic writes (temp → rename)
   *   - Auto-rollback on any failure
   *   - Returns backup paths for manual rollback if needed
   */
  async apply(target: AgentTarget, items?: string[]): Promise<ApplyResult & { migrationSummary: string }> {
    const syncResult = await this.migrate(target, items);
    const applier = new WorkspaceSyncApplier();

    // Collect all files to write
    const filesToWrite = [
      ...syncResult.mcpServers.generated,
      ...syncResult.workflows.generated,
    ];

    const applyResult = await applier.apply(filesToWrite);

    // Copy skills (no format conversion needed)
    let skillResult = { copied: [] as string[], skipped: [] as string[] };
    if (syncResult.skills.scanned.length > 0) {
      skillResult = this.copySkills(syncResult.skills.scanned, target);
    }

    // Build summary
    const lines: string[] = [];
    if (applyResult.success) {
      lines.push(`✅ Applied ${applyResult.filesWritten.length} file(s) for ${target}`);
      for (const f of applyResult.filesWritten) {
        lines.push(`  → ${f}`);
      }
      if (skillResult.copied.length > 0) {
        lines.push(`\n🧩 Copied ${skillResult.copied.length} skill(s):`);
        for (const sk of skillResult.copied) {
          lines.push(`  → ${sk}`);
        }
      }
      if (skillResult.skipped.length > 0) {
        lines.push(`\n⏭️ Skipped ${skillResult.skipped.length} skill(s):`);
        for (const sk of skillResult.skipped) {
          lines.push(`  → ${sk}`);
        }
      }
      if (syncResult.skills.conflicts.length > 0) {
        lines.push(`\n⚠️ Name conflicts (${syncResult.skills.conflicts.length}):`);
        for (const c of syncResult.skills.conflicts) {
          lines.push(`  → "${c.name}": kept ${c.kept.sourceAgent}, skipped ${c.skipped.sourceAgent}`);
        }
      }
      if (applyResult.backups.length > 0) {
        lines.push(`\n📦 Backups created (${applyResult.backups.length}):`);
        for (const b of applyResult.backups) {
          lines.push(`  ${b.originalPath} → ${b.backupPath}`);
        }
      }
      // Clean up backups after successful apply
      applier.cleanBackups(applyResult.backups);
    } else {
      lines.push(`❌ Apply failed for ${target}`);
      for (const e of applyResult.errors) {
        lines.push(`  Error: ${e}`);
      }
      if (applyResult.backups.length > 0) {
        lines.push(`\n🔄 Rolled back ${applyResult.backups.length} file(s)`);
      }
    }

    return {
      ...applyResult,
      migrationSummary: lines.join('\n'),
    };
  }

  // ---- Private helpers ----

  private agentToRuleSource(target: AgentTarget): RuleSource | null {
    const map: Record<AgentTarget, RuleSource> = {
      cursor: 'cursor',
      'claude-code': 'claude-code',
      codex: 'codex',
      windsurf: 'windsurf',
    };
    return map[target] ?? null;
  }
}
