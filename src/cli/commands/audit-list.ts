/**
 * CLI Command: memorix audit list
 *
 * List all files written by Memorix (audit trail).
 */

import { defineCommand } from 'citty';
import * as p from '@clack/prompts';

export default defineCommand({
  meta: {
    name: 'list',
    description: 'List Memorix-written files (audit trail)',
  },
  args: {
    project: {
      type: 'string',
      description: 'Filter by project (optional)',
      required: false,
    },
  },
  run: async ({ args }) => {
    const { getAllAuditEntries, getProjectId } = await import('../../audit/index.js');
    const os = await import('node:os');
    let cwd: string;
    try {
      cwd = process.cwd();
    } catch {
      cwd = os.homedir();
      console.log(`[WARN] Could not access current directory, using home: ${cwd}`);
    }

    p.intro('Memorix Audit Trail');

    const allEntries = await getAllAuditEntries();

    if (allEntries.length === 0) {
      console.log('No Memorix-written files found.');
      p.outro('Audit trail is empty.');
      return;
    }

    // Filter by project if specified
    let entries = allEntries;
    if (args.project) {
      const targetProjectId = getProjectId(args.project);
      entries = allEntries.filter((e) => e.projectId === targetProjectId);
    }

    if (entries.length === 0) {
      console.log('No Memorix-written files found for this project.');
      p.outro('Audit trail is empty for this project.');
      return;
    }

    // Group by project
    const byProject: Record<string, Array<{ entry: import('../../audit/index.js').AuditEntry }>> = {};
    for (const { projectId, entry } of entries) {
      if (!byProject[projectId]) {
        byProject[projectId] = [];
      }
      byProject[projectId].push({ entry });
    }

    // Display by project
    console.log('');
    for (const [projectId, items] of Object.entries(byProject)) {
      console.log(`Project: ${projectId}`);
      console.log('');

      for (const { entry } of items) {
        const icon = entry.type === 'hook' ? '🔗' : '📋';
        const agent = entry.agent ? ` (${entry.agent})` : '';
        console.log(`${icon} ${entry.path}${agent}`);
        console.log(`   Created: ${entry.createdAt}`);
        console.log('');
      }
    }

    // Summary
    const hookCount = entries.filter((e) => e.entry.type === 'hook').length;
    const ruleCount = entries.filter((e) => e.entry.type === 'rule').length;
    const projectCount = new Set(entries.map((e) => e.projectId)).size;

    p.note(`${projectCount} projects, ${hookCount} hooks, ${ruleCount} rules`);

    p.outro('Audit trail complete.');
  },
});
