/**
 * Index Formatter
 *
 * Formats search, timeline, and detail outputs for the compact engine.
 */

import type { IndexEntry, TimelineContext } from '../types.js';
import { sourceBadge, resolveSourceDetail, resolveEvidenceBasis, evidenceBasisLine } from '../memory/disclosure-policy.js';

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
  const badges = entries.map((e) => sourceBadge(e.sourceDetail, e.source));
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
  // Show Src column when at least one entry has provenance (sourceDetail or legacy source='git')
  const hasSrc = entries.some((e) => !!e.sourceDetail || e.source === 'git');

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
    if (hasSrc) row.push(sourceBadge(entry.sourceDetail, entry.source) || '-');
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
 * When any entry carries sourceDetail provenance, adds a Src column and
 * annotates the anchor with its evidence kind. Falls back to the original
 * table format when no provenance is present (backward-compat).
 */
export function formatTimeline(timeline: TimelineContext): string {
  if (!timeline.anchorEntry) {
    return `Observation #${timeline.anchorId} not found.`;
  }

  const anchor = timeline.anchorEntry;

  // Detect provenance across all entries — conditional Src column
  // Includes legacy source='git' fallback.
  const allEntries = [...timeline.before, anchor, ...timeline.after];
  const hasSrc = allEntries.some((e) => !!e.sourceDetail || e.source === 'git');

  const tableHeader = hasSrc ? '| ID | Time | T | Title | Tokens | Src |' : '| ID | Time | T | Title | Tokens |';
  const tableDivider = hasSrc ? '|----|------|---|-------|--------|-----|' : '|----|------|---|-------|--------|';

  const entryRow = (e: IndexEntry): string => {
    const base = `| #${e.id} | ${e.time} | ${e.icon} | ${e.title} | ~${e.tokens} |`;
    return hasSrc ? `${base} ${sourceBadge(e.sourceDetail, e.source) || '-'} |` : base;
  };

  const lines: string[] = [];
  lines.push(`Timeline around #${timeline.anchorId}:`);

  // Anchor kind annotation — shown when provenance is available (sourceDetail or legacy source='git')
  const anchorEffectiveSource = resolveSourceDetail(anchor.sourceDetail, anchor.source);
  if (hasSrc && anchorEffectiveSource) {
    const anchorBasis = resolveEvidenceBasis({ sourceDetail: anchor.sourceDetail, source: anchor.source });
    const basisLine = evidenceBasisLine(anchorBasis);
    const basisSuffix = basisLine ? ` — ${basisLine.toLowerCase()}` : '';
    lines.push(`*Expanding: ${sourceKindLabel(anchorEffectiveSource)}${basisSuffix}*`);
  }
  lines.push('');

  if (timeline.before.length > 0) {
    lines.push('**Before:**');
    lines.push(tableHeader);
    lines.push(tableDivider);
    for (const entry of timeline.before) {
      lines.push(entryRow(entry));
    }
    lines.push('');
  }

  lines.push('**Anchor:**');
  lines.push(tableHeader);
  lines.push(tableDivider);
  lines.push(entryRow(anchor));
  lines.push('');

  if (timeline.after.length > 0) {
    lines.push('**After:**');
    lines.push(tableHeader);
    lines.push(tableDivider);
    for (const entry of timeline.after) {
      lines.push(entryRow(entry));
    }
    lines.push('');
  }

  lines.push(getProgressiveDisclosureHint(false));
  return lines.join('\n');
}

/**
 * Format full observation details (Layer 3).
 * When sourceDetail/valueCategory are present, prepends a provenance header
 * that clearly identifies the evidence kind before the main #ID block.
 * Backward-compatible: if neither field is set, output is identical to before.
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
  sourceDetail?: string;
  valueCategory?: string;
  source?: string;
  commitHash?: string;
  relatedCommits?: string[];
}): string {
  const icon = getTypeIcon(doc.type);
  const lines: string[] = [];

  // Provenance header — shown before #ID when sourceDetail (or legacy source='git') is set
  const header = buildProvenanceHeader(doc.sourceDetail, doc.valueCategory, doc.source, doc.commitHash, doc.relatedCommits);
  if (header) {
    lines.push(header);
    lines.push('');
  }

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

/**
 * Build a compact provenance header for detail output.
 * Returns empty string when no provenance can be resolved (backward-compat).
 * Supports legacy source='git' via resolveSourceDetail fallback.
 */
function buildProvenanceHeader(
  sourceDetail?: string,
  valueCategory?: string,
  source?: string,
  commitHash?: string,
  relatedCommits?: string[],
): string {
  const sd = resolveSourceDetail(sourceDetail, source);
  if (!sd) return '';

  const label = sourceKindLabel(sd);
  const layer = sd === 'git-ingest' ? 'L3 — evidence'
    : sd === 'hook' ? 'L1 — activity routing signal'
    : 'L2 — durable working context';

  const lines = [`${label}  [${layer}]`];

  // Verification line — shown only for repository-backed memories
  const basis = resolveEvidenceBasis({ sourceDetail, source, commitHash, relatedCommits });
  const verificationLine = evidenceBasisLine(basis, commitHash);
  if (verificationLine) {
    lines.push(verificationLine);
  }

  if (valueCategory === 'core') {
    lines.push('★ Core — immune to decay');
  } else if (valueCategory === 'ephemeral') {
    lines.push('⚠ Ephemeral — short-lived signal');
  }

  return lines.join('\n');
}

/** Short label for a resolved sourceDetail value, used in headers and timeline annotations. */
function sourceKindLabel(sd: string): string {
  if (sd === 'git-ingest') return '📌 Git Repository Evidence';
  if (sd === 'hook') return '🔗 Hook Trace';
  return '💾 Explicit Working Memory';
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
