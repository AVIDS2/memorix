import matter from '../utils/frontmatter.js';
import type { AgentTarget, WorkflowEntry } from '../types.js';

/**
 * WorkflowSyncer — converts workflows between agent formats.
 *
 * Supported conversions:
 *   Windsurf .windsurf/workflows/*.md  →  Codex SKILL.md
 *   Windsurf .windsurf/workflows/*.md  →  Cursor .cursor/rules/*.mdc
 *   Windsurf .windsurf/workflows/*.md  →  Claude Code CLAUDE.md section
 */
export class WorkflowSyncer {
  /**
   * Parse a Windsurf workflow markdown file into a WorkflowEntry.
   */
  parseWindsurfWorkflow(fileName: string, raw: string): WorkflowEntry {
    const name = fileName.replace(/\.md$/i, '');
    let description = '';
    let content = raw;

    try {
      const parsed = matter(raw);
      description = typeof parsed.data?.description === 'string' ? parsed.data.description : '';
      content = parsed.content.trim();
    } catch {
      // No frontmatter — use raw content
    }

    return {
      name,
      description,
      content,
      source: 'windsurf',
      filePath: `.windsurf/workflows/${fileName}`,
    };
  }

  /**
   * Convert a workflow to Codex SKILL.md format.
   */
  toCodexSkill(wf: WorkflowEntry): { filePath: string; content: string } {
    const safeName = this.sanitizeName(wf.name);
    const fm: Record<string, string> = { name: safeName };
    if (wf.description) {
      fm.description = wf.description;
    }
    const content = matter.stringify(wf.content, fm);
    return {
      filePath: `.agents/skills/${safeName}/SKILL.md`,
      content,
    };
  }

  /**
   * Convert a workflow to Cursor .mdc rule format.
   */
  toCursorRule(wf: WorkflowEntry): { filePath: string; content: string } {
    const safeName = this.sanitizeName(wf.name);
    const fm: Record<string, string> = {};
    if (wf.description) {
      fm.description = wf.description;
    }
    fm.globs = '';
    fm.alwaysApply = 'false';
    const content = matter.stringify(wf.content, fm);
    return {
      filePath: `.cursor/rules/${safeName}.mdc`,
      content,
    };
  }

  /**
   * Convert a workflow to a CLAUDE.md section string.
   */
  toClaudeSection(wf: WorkflowEntry): string {
    const lines: string[] = [];
    lines.push(`## Workflow: ${wf.name}`);
    if (wf.description) {
      lines.push('');
      lines.push(`> ${wf.description}`);
    }
    lines.push('');
    lines.push(wf.content);
    return lines.join('\n');
  }

  /**
   * Convert all workflows to the target agent format.
   * Returns an array of { filePath, content } for each generated file.
   */
  convertAll(
    workflows: WorkflowEntry[],
    target: AgentTarget,
  ): { filePath: string; content: string }[] {
    if (target === 'windsurf') {
      // No conversion needed — already in Windsurf format
      return [];
    }

    if (target === 'codex') {
      return workflows.map((wf) => this.toCodexSkill(wf));
    }

    if (target === 'cursor') {
      return workflows.map((wf) => this.toCursorRule(wf));
    }

    if (target === 'claude-code') {
      // Merge all workflows into a single CLAUDE.md
      const sections = workflows.map((wf) => this.toClaudeSection(wf));
      return [
        {
          filePath: 'CLAUDE.md',
          content: sections.join('\n\n'),
        },
      ];
    }

    return [];
  }

  // ---- Helpers ----

  private sanitizeName(name: string): string {
    return name
      .replace(/[^a-zA-Z0-9_-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      || 'workflow';
  }
}
