/**
 * Index Formatter
 *
 * Formats search, timeline, and detail outputs for the compact engine.
 */

import type { IndexEntry, TimelineContext } from '../types.js';
import { sourceBadge } from '../memory/disclosure-policy.js';

/**
 * Format a list of IndexEntries as a compact markdown table.
 */
export function formatIndexTable(entries: IndexEntry[], query?: string, forceProjectColumn = false): string {
  if (entries.length === 0) {
    return query
      ? `No observations found matching "${query}".`
      : 'No observations found.';
  }

  const lines: string[] = [];

  // Tier summary: shown when entries have mixed provenance
  const badges = entries.map((e) => sourceBadge(e.sourceDetail));
  const distinctBadges = new Set(badges.filter(Boolean));
  if (distinctBadges.size > 1 || (distinctBadges.size === 1 && badges.some((b) => !b))) {
    const exCount = badges.filter((b) => b === 'ex').length;
    const hkCount = badges.filter((b) => b === 'hk').length;
    const gitCount = badges.filter((b) => b === 'git').length;
    const unknownCount = badges.filter((b) => !b).length;
    const parts: string[] = [];
    if (exCount > 0) parts.push(`${exCount} explicit`);
    if (unknownCount > 0) parts.push(`${unknownCount} legacy`);
    if (hkCount > 0) parts.push(`${hkCount} hook`);
    if (gitCount > 0) parts.push(`${gitCount} git`);
    lines.push(`Sources: ${parts.join('  ·  ')}`);
    lines.push('');
  }

  if (query) {
    lines.push(`Found ${entries.length} observation(s) matching "${query}":`);
    lines.push('');
  }

  const distinctProjects = [...new Set(entries.map((entry) => entry.projectId).filter(Boolean))];
  const hasProject = forceProjectColumn || distinctProjects.length > 1;
  const hasExplanation = entries.some((entry) => (entry.matchedFields?.length ?? 0) > 0);
  // Show Src column only when at least one entry has a sourceDetail value
  const hasSrc = entries.some((e) => !!e.sourceDetail);

  const header = ['ID', 'Time', 'T', 'Title', 'Tokens'];
  const divider = ['----', '------', '---', '-------', '--------'];
  if (hasSrc) {
    header.push('Src');
    divider.push('---');
  }
  if (hasProject) {
    header.push('Project');
    divider.push('---------');
  }
  if (hasExplanation) {
    header.push('Matched');
    divider.push('---------');
  }

  lines.push(`| ${header.join(' | ')} |`);
  lines.push(`|${divider.map((part) => ` ${part} `).join('|')}|`);

  for (const entry of entries) {
    const row = [`#${entry.id}`, entry.time, entry.icon, entry.title, `~${entry.tokens}`];
    if (hasSrc) row.push(sourceBadge(entry.sourceDetail) || '-');
    if (hasProject) row.push(entry.projectId ?? '-');
    if (hasExplanation) row.push(entry.matchedFields?.join(', ') ?? '-');
    lines.push(`| ${row.join(' | ')} |`);
  }

  lines.push('');
  lines.push(getProgressiveDisclosureHint(hasProject));

  return lines.join('\n');
}

/**
 * Format a timeline context around an anchor observation.
 */
export function formatTimeline(timeline: TimelineContext): string {
  if (!timeline.anchorEntry) {
    return `Observation #${timeline.anchorId} not found.`;
  }

  const lines: string[] = [];
  lines.push(`Timeline around #${timeline.anchorId}:`);
  lines.push('');

  if (timeline.before.length > 0) {
    lines.push('**Before:**');
    lines.push('| ID | Time | T | Title | Tokens |');
    lines.push('|----|------|---|-------|--------|');
    for (const entry of timeline.before) {
      lines.push(`| #${entry.id} | ${entry.time} | ${entry.icon} | ${entry.title} | ~${entry.tokens} |`);
    }
    lines.push('');
  }

  lines.push('**Anchor:**');
  lines.push('| ID | Time | T | Title | Tokens |');
  lines.push('|----|------|---|-------|--------|');
  const anchor = timeline.anchorEntry;
  lines.push(`| #${anchor.id} | ${anchor.time} | ${anchor.icon} | ${anchor.title} | ~${anchor.tokens} |`);
  lines.push('');

  if (timeline.after.length > 0) {
    lines.push('**After:**');
    lines.push('| ID | Time | T | Title | Tokens |');
    lines.push('|----|------|---|-------|--------|');
    for (const entry of timeline.after) {
      lines.push(`| #${entry.id} | ${entry.time} | ${entry.icon} | ${entry.title} | ~${entry.tokens} |`);
    }
    lines.push('');
  }

  lines.push(getProgressiveDisclosureHint(false));
  return lines.join('\n');
}

/**
 * Format full observation details (Layer 3).
 */
export function formatObservationDetail(doc: {
  observationId: number;
  type: string;
  title: string;
  narrative: string;
  facts: string;
  filesModified: string;
  concepts: string;
  createdAt: string;
  projectId: string;
  entityName: string;
}): string {
  const icon = getTypeIcon(doc.type);
  const lines: string[] = [];

  lines.push(`#${doc.observationId} ${icon} ${doc.title}`);
  lines.push('='.repeat(50));
  lines.push(`Date: ${new Date(doc.createdAt).toLocaleString()}`);
  lines.push(`Type: ${doc.type}`);
  lines.push(`Entity: ${doc.entityName}`);
  lines.push(`Project: ${doc.projectId}`);
  lines.push('');
  lines.push(`Narrative: ${doc.narrative}`);

  const facts = doc.facts ? doc.facts.split('\n').filter(Boolean) : [];
  if (facts.length > 0) {
    lines.push('');
    lines.push('Facts:');
    for (const fact of facts) {
      lines.push(`- ${fact}`);
    }
  }

  const files = doc.filesModified ? doc.filesModified.split('\n').filter(Boolean) : [];
  if (files.length > 0) {
    lines.push('');
    lines.push('Files Modified:');
    for (const file of files) {
      lines.push(`- ${file}`);
    }
  }

  if (doc.concepts) {
    lines.push('');
    lines.push(`Concepts: ${doc.concepts}`);
  }

  return lines.join('\n');
}

function getTypeIcon(type: string): string {
  const icons: Record<string, string> = {
    'session-request': '🎯',
    'gotcha': '🔴',
    'problem-solution': '🟡',
    'how-it-works': '🔵',
    'what-changed': '🟢',
    'discovery': '🟣',
    'why-it-exists': '🟠',
    'decision': '🟤',
    'trade-off': '⚖️',
    'reasoning': '🧠',
  };
  return icons[type] ?? '❓';
}

function getProgressiveDisclosureHint(hasProject: boolean): string {
  const lines = [
    '💡 **Progressive Disclosure:** This index shows WHAT exists and retrieval COST.',
    '- Use `memorix_detail` to fetch full observation details by ID',
    '- Use `memorix_timeline` to see chronological context around an observation',
    '- Critical types (🔴 gotcha, 🟤 decision, ⚖️ trade-off) are often worth fetching immediately',
  ];

  if (hasProject) {
    lines.push('- For global results, prefer `memorix_detail refs=[{ id, projectId }]` to avoid cross-project ID ambiguity');
  }

  return lines.join('\n');
}
