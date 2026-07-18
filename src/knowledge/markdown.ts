import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';
import { atomicWriteFile } from '../store/file-lock.js';
import type { KnowledgePage, KnowledgePageFrontmatter, KnowledgePageKind, KnowledgePageReviewState, KnowledgePageStatus } from './workspace-types.js';

const PAGE_KINDS: KnowledgePageKind[] = ['topic', 'decision', 'risk', 'index', 'schema', 'log'];
const PAGE_STATUSES: KnowledgePageStatus[] = ['active', 'proposed'];
const REVIEW_STATES: KnowledgePageReviewState[] = ['approved', 'needs-review'];
const LINK_PATTERN = /\[[^\]]+\]\(([^)]+)\)/g;

function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

function stringField(data: Record<string, unknown>, key: string): string {
  const value = data[key];
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error('missing required field ' + key);
  }
  return value.trim();
}

function stringArray(data: Record<string, unknown>, key: string): string[] {
  const value = data[key];
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) {
    throw new Error('field ' + key + ' must be a string array');
  }
  return value.map(item => item.trim()).filter(Boolean);
}

function optionalString(data: Record<string, unknown>, key: string): string | undefined {
  const value = data[key];
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string') throw new Error('field ' + key + ' must be text');
  return value.trim() || undefined;
}

export function validateKnowledgePageFrontmatter(data: Record<string, unknown>): KnowledgePageFrontmatter {
  const kind = stringField(data, 'kind') as KnowledgePageKind;
  const status = stringField(data, 'status') as KnowledgePageStatus;
  const reviewState = stringField(data, 'reviewState') as KnowledgePageReviewState;
  if (!PAGE_KINDS.includes(kind)) throw new Error('field kind is invalid');
  if (!PAGE_STATUSES.includes(status)) throw new Error('field status is invalid');
  if (!REVIEW_STATES.includes(reviewState)) throw new Error('field reviewState is invalid');
  return {
    id: stringField(data, 'id'),
    title: stringField(data, 'title'),
    kind,
    status,
    reviewState,
    claimIds: stringArray(data, 'claimIds'),
    evidenceRefs: stringArray(data, 'evidenceRefs'),
    ...(optionalString(data, 'snapshotId') ? { snapshotId: optionalString(data, 'snapshotId') } : {}),
    tags: stringArray(data, 'tags'),
    sourceHash: stringField(data, 'sourceHash'),
    generatedAt: stringField(data, 'generatedAt'),
    updatedAt: stringField(data, 'updatedAt'),
  };
}

export function extractInternalMarkdownLinks(body: string): string[] {
  const links = new Set<string>();
  for (const match of body.matchAll(LINK_PATTERN)) {
    const raw = match[1].trim();
    if (!raw || raw.startsWith('#') || /^[a-z][a-z0-9+.-]*:/i.test(raw)) continue;
    const pathPart = raw.split('#', 1)[0].replace(/\\/g, '/');
    if (!pathPart.endsWith('.md')) continue;
    links.add(pathPart);
  }
  return [...links].sort();
}

export function resolvePageLink(sourceRelativePath: string, target: string): string | undefined {
  const sourceDir = path.posix.dirname(sourceRelativePath.replace(/\\/g, '/'));
  const normalized = path.posix.normalize(path.posix.join(sourceDir, target.replace(/\\/g, '/')));
  if (!normalized || normalized === '.' || normalized === '..' || normalized.startsWith('../')) return undefined;
  return normalized;
}

export function renderKnowledgePage(frontmatter: KnowledgePageFrontmatter, body: string): string {
  const normalizedBody = body.trimEnd() + '\n';
  return matter.stringify(normalizedBody, {
    id: frontmatter.id,
    title: frontmatter.title,
    kind: frontmatter.kind,
    status: frontmatter.status,
    reviewState: frontmatter.reviewState,
    claimIds: frontmatter.claimIds,
    evidenceRefs: frontmatter.evidenceRefs,
    ...(frontmatter.snapshotId ? { snapshotId: frontmatter.snapshotId } : {}),
    tags: frontmatter.tags,
    sourceHash: frontmatter.sourceHash,
    generatedAt: frontmatter.generatedAt,
    updatedAt: frontmatter.updatedAt,
  });
}

export async function readKnowledgePage(absolutePath: string, workspaceRoot?: string): Promise<KnowledgePage> {
  const raw = await fs.readFile(absolutePath, 'utf8');
  try {
    const parsed = matter(raw);
    const frontmatter = validateKnowledgePageFrontmatter(parsed.data as Record<string, unknown>);
    return {
      absolutePath,
      relativePath: workspaceRoot
        ? path.relative(workspaceRoot, absolutePath).split(path.sep).join('/')
        : path.basename(absolutePath),
      frontmatter,
      body: parsed.content.trim(),
      contentHash: hashContent(raw),
      links: extractInternalMarkdownLinks(parsed.content),
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'invalid page data';
    throw new Error('Malformed knowledge page frontmatter in ' + absolutePath + ': ' + detail);
  }
}

export async function writeKnowledgePage(absolutePath: string, content: string): Promise<string> {
  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  await atomicWriteFile(absolutePath, content);
  return hashContent(content);
}

export function pageContentHash(content: string): string {
  return hashContent(content);
}
