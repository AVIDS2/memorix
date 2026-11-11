import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { CodeGraphStore } from '../codegraph/store.js';
import { withFileLock } from '../store/file-lock.js';
import { ClaimStore } from './claim-store.js';
import { extractInternalMarkdownLinks, pageContentHash, readKnowledgePage, renderKnowledgePage, resolvePageLink, writeKnowledgePage } from './markdown.js';
import { KnowledgeWorkspaceStore } from './workspace-store.js';
import { getKnowledgeWorkspacePaths, resolveKnowledgeWorkspaceFile } from './workspace.js';
import type {
  KnowledgePage,
  KnowledgePageFrontmatter,
  KnowledgePageRecord,
  KnowledgeProposal,
  KnowledgeProposalReason,
  KnowledgeWorkspace,
  WikiLintIssue,
  WikiLintResult,
} from './workspace-types.js';

export { readKnowledgePage } from './markdown.js';

export interface CompileKnowledgeWorkspaceResult {
  proposals: KnowledgeProposal[];
  published: KnowledgePageRecord[];
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function now(): string {
  return new Date().toISOString();
}

async function storeFor(workspace: KnowledgeWorkspace): Promise<KnowledgeWorkspaceStore> {
  if (!workspace.dataDir) throw new Error('Knowledge workspace has no operational data directory');
  const store = new KnowledgeWorkspaceStore();
  await store.init(workspace.dataDir);
  return store;
}

function topicSlug(subject: string): string {
  const safe = subject
    .toLocaleLowerCase('en-US')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return (safe || 'topic') + '-' + hash(subject).slice(0, 8);
}

function groupClaims(claims: ReturnType<ClaimStore['listClaims']>): Map<string, ReturnType<ClaimStore['listClaims']>> {
  const groups = new Map<string, ReturnType<ClaimStore['listClaims']>>();
  for (const claim of claims) {
    const group = groups.get(claim.subject) ?? [];
    group.push(claim);
    groups.set(claim.subject, group);
  }
  return groups;
}

function selectPublishableClaims(claims: ClaimStore, projectId: string) {
  return claims.listClaims(projectId, { statuses: ['active'], limit: 1_000 })
    .filter(claim => claim.reviewState === 'approved');
}

function evidenceRefs(claims: ReturnType<ClaimStore['listClaims']>, store: ClaimStore): string[] {
  const refs = new Set<string>();
  for (const claim of claims) {
    for (const evidence of store.listEvidence(claim.id)) {
      refs.add('claim:' + claim.id + ':evidence:' + evidence.id);
    }
  }
  return [...refs].sort();
}

function snapshotIdForClaims(claims: ReturnType<ClaimStore['listClaims']>, store: ClaimStore): string | undefined {
  const ids = new Set<string>();
  for (const claim of claims) {
    for (const evidence of store.listEvidence(claim.id)) {
      if (evidence.snapshotId) ids.add(evidence.snapshotId);
    }
  }
  return ids.size === 1 ? [...ids][0] : undefined;
}

function sourceHashForClaims(claims: ReturnType<ClaimStore['listClaims']>, store: ClaimStore): string {
  const source = claims.map(claim => ({
    id: claim.id,
    status: claim.status,
    confidence: claim.confidence,
    evidence: store.listEvidence(claim.id).map(item => ({
      id: item.id,
      kind: item.evidenceKind,
      evidenceId: item.evidenceId,
      relation: item.relation,
      snapshotId: item.snapshotId ?? '',
      capturedHash: item.capturedHash ?? '',
    })),
  }));
  return hash(JSON.stringify(source));
}

function renderTopicBody(title: string, claims: ReturnType<ClaimStore['listClaims']>, store: ClaimStore): string {
  const lines = [
    '# ' + title,
    '',
    'This page is compiled from approved source-qualified claims.',
    '',
    '## Current claims',
    '',
  ];
  for (const claim of claims) {
    lines.push('- ' + claim.predicate + ': ' + claim.objectValue + ' (claim ' + claim.id + ')');
  }
  lines.push('');
  lines.push('## Evidence');
  lines.push('');
  for (const claim of claims) {
    lines.push('### Claim ' + claim.id);
    const evidence = store.listEvidence(claim.id);
    if (evidence.length === 0) {
      lines.push('- Missing evidence.');
      continue;
    }
    for (const item of evidence) {
      const location = item.locator ? ' at ' + item.locator : '';
      const snapshot = item.snapshotId ? ' (snapshot ' + item.snapshotId + ')' : '';
      lines.push('- ' + item.evidenceKind + ': ' + item.evidenceId + location + snapshot);
    }
  }
  lines.push('');
  return lines.join('\n');
}

function candidatePage(
  workspace: KnowledgeWorkspace,
  title: string,
  claims: ReturnType<ClaimStore['listClaims']>,
  store: ClaimStore,
): { page: KnowledgePage; content: string; targetRelativePath: string; proposalRelativePath: string } {
  const sourceHash = sourceHashForClaims(claims, store);
  const generatedAt = now();
  const slug = topicSlug(title);
  const targetRelativePath = 'pages/' + slug + '.md';
  const proposalRelativePath = 'proposals/' + slug + '.md';
  const frontmatter: KnowledgePageFrontmatter = {
    id: 'page:' + hash(workspace.projectId + ':' + title).slice(0, 24),
    title,
    kind: 'topic',
    status: 'proposed',
    reviewState: 'needs-review',
    claimIds: claims.map(claim => claim.id).sort(),
    evidenceRefs: evidenceRefs(claims, store),
    ...(snapshotIdForClaims(claims, store) ? { snapshotId: snapshotIdForClaims(claims, store) } : {}),
    tags: ['generated', 'topic'],
    sourceHash,
    generatedAt,
    updatedAt: generatedAt,
  };
  const content = renderKnowledgePage(frontmatter, renderTopicBody(title, claims, store));
  const proposalPath = resolveKnowledgeWorkspaceFile(workspace, proposalRelativePath);
  return {
    page: {
      absolutePath: proposalPath,
      relativePath: proposalRelativePath,
      frontmatter,
      body: renderTopicBody(title, claims, store),
      contentHash: pageContentHash(content),
      links: [],
    },
    content,
    targetRelativePath,
    proposalRelativePath,
  };
}

async function fileHashIfPresent(filePath: string): Promise<string | undefined> {
  try {
    return pageContentHash(await fs.readFile(filePath, 'utf8'));
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error
      ? (error as { code?: string }).code
      : undefined;
    if (code === 'ENOENT') return undefined;
    throw error;
  }
}

async function writeIndex(workspace: KnowledgeWorkspace, store: KnowledgeWorkspaceStore): Promise<void> {
  const paths = getKnowledgeWorkspacePaths(workspace);
  const published = store.listPages(workspace.id)
    .filter(page => page.status === 'active')
    .sort((left, right) => left.title.localeCompare(right.title));
  const pending = store.listProposals(workspace.id, 'pending')
    .sort((left, right) => left.proposalPath.localeCompare(right.proposalPath));
  const lines = ['# Knowledge Workspace', '', '## Published pages', ''];
  if (published.length === 0) {
    lines.push('No published pages yet.');
  } else {
    for (const page of published) lines.push('- [' + page.title + '](' + page.relativePath + ')');
  }
  lines.push('');
  lines.push('## Review queue');
  lines.push('');
  if (pending.length === 0) {
    lines.push('No pending proposals.');
  } else {
    for (const proposal of pending) {
      const relative = path.relative(paths.root, proposal.proposalPath).split(path.sep).join('/');
      lines.push('- [' + path.basename(proposal.proposalPath, '.md') + '](' + relative + ')');
    }
  }
  lines.push('');
  await writeKnowledgePage(paths.index, lines.join('\n'));
}

async function appendLog(workspace: KnowledgeWorkspace, line: string): Promise<void> {
  const logPath = getKnowledgeWorkspacePaths(workspace).log;
  await fs.appendFile(logPath, '- ' + now() + ' ' + line + '\n', 'utf8');
}

function toPageRecord(
  workspace: KnowledgeWorkspace,
  page: KnowledgePage,
  status: KnowledgePageRecord['status'],
  contentHash: string,
  manualContentHash?: string,
): KnowledgePageRecord {
  return {
    id: page.frontmatter.id,
    workspaceId: workspace.id,
    relativePath: page.relativePath.replace(/^proposals\//, 'pages/'),
    title: page.frontmatter.title,
    kind: page.frontmatter.kind,
    status,
    reviewState: page.frontmatter.reviewState,
    contentHash,
    sourceHash: page.frontmatter.sourceHash,
    claimIds: page.frontmatter.claimIds,
    ...(page.frontmatter.snapshotId ? { snapshotId: page.frontmatter.snapshotId } : {}),
    tags: page.frontmatter.tags,
    generatedAt: page.frontmatter.generatedAt,
    updatedAt: page.frontmatter.updatedAt,
    ...(manualContentHash ? { manualContentHash } : {}),
  };
}

export async function compileKnowledgeWorkspace(input: {
  workspace: KnowledgeWorkspace;
  claims: ClaimStore;
}): Promise<CompileKnowledgeWorkspaceResult> {
  const store = await storeFor(input.workspace);
  const published: KnowledgePageRecord[] = [];
  const proposals: KnowledgeProposal[] = [];
  const claims = selectPublishableClaims(input.claims, input.workspace.projectId);

  await withFileLock(getKnowledgeWorkspacePaths(input.workspace).root, async () => {
    for (const [title, group] of groupClaims(claims)) {
      const candidate = candidatePage(input.workspace, title, group, input.claims);
      const targetPath = resolveKnowledgeWorkspaceFile(input.workspace, candidate.targetRelativePath);
      const proposalPath = resolveKnowledgeWorkspaceFile(input.workspace, candidate.proposalRelativePath);
      let existing = store.getPage(input.workspace.id, candidate.targetRelativePath);
      const actualTargetHash = await fileHashIfPresent(targetPath);
      if (actualTargetHash && !existing) {
        const manualRecord = {
          ...toPageRecord(input.workspace, candidate.page, 'active', actualTargetHash, actualTargetHash),
          reviewState: 'needs-review' as const,
          sourceHash: 'manual:' + actualTargetHash,
        };
        store.upsertPage(manualRecord);
        existing = manualRecord;
      }

      if (
        actualTargetHash
        && existing
        && existing.status === 'active'
        && !existing.manualContentHash
        && actualTargetHash === existing.contentHash
        && existing.sourceHash === candidate.page.frontmatter.sourceHash
      ) {
        published.push(existing);
        continue;
      }

      let reason: KnowledgeProposalReason = 'new-page';
      let baseContentHash: string | undefined;
      if (actualTargetHash) {
        baseContentHash = existing?.contentHash;
        if (
          !existing
          || existing.status !== 'active'
          || !!existing.manualContentHash
          || actualTargetHash !== existing.contentHash
        ) {
          reason = 'manual-edit-protected';
        } else {
          reason = 'source-changed';
        }
      }

      if (!actualTargetHash) {
        store.upsertPage(toPageRecord(input.workspace, candidate.page, 'proposed', candidate.page.contentHash));
      }
      await writeKnowledgePage(proposalPath, candidate.content);
      const proposal = store.createProposal({
        workspaceId: input.workspace.id,
        pageId: candidate.page.frontmatter.id,
        targetPath,
        proposalPath,
        ...(baseContentHash ? { baseContentHash } : {}),
        sourceHash: candidate.page.frontmatter.sourceHash,
        reason,
      });
      proposals.push(proposal);
      await appendLog(input.workspace, 'proposed ' + candidate.targetRelativePath + ' (' + reason + ').');
    }
    store.markWorkspaceCompiled(input.workspace.id);
    await writeIndex(input.workspace, store);
  });
  return { proposals, published };
}

export async function applyKnowledgeProposal(input: {
  workspace: KnowledgeWorkspace;
  proposalId: string;
  /** Explicit review acknowledgement before replacing a manually edited page. */
  allowManualOverwrite?: boolean;
}): Promise<{ proposal: KnowledgeProposal; targetPath: string }> {
  const store = await storeFor(input.workspace);
  const proposal = store.getProposal(input.proposalId);
  if (!proposal || proposal.workspaceId !== input.workspace.id) {
    throw new Error('Knowledge proposal was not found for this workspace');
  }
  if (proposal.status !== 'pending') throw new Error('Knowledge proposal is not pending review');
  const root = getKnowledgeWorkspacePaths(input.workspace).root;
  const targetPath = path.resolve(proposal.targetPath);
  const proposalPath = path.resolve(proposal.proposalPath);
  if (!targetPath.startsWith(root + path.sep) || !proposalPath.startsWith(root + path.sep)) {
    throw new Error('Knowledge proposal path escapes its workspace');
  }

  await withFileLock(root, async () => {
    const actualTargetHash = await fileHashIfPresent(targetPath);
    if (
      proposal.baseContentHash
      && actualTargetHash !== proposal.baseContentHash
      && !input.allowManualOverwrite
    ) {
      throw new Error('The target page has manual changes; review the proposal before applying it');
    }
    if (!proposal.baseContentHash && actualTargetHash && !input.allowManualOverwrite) {
      throw new Error('The target page already exists and has no known safe base revision');
    }
    const proposalPage = await readKnowledgePage(proposalPath, root);
    const activeFrontmatter: KnowledgePageFrontmatter = {
      ...proposalPage.frontmatter,
      status: 'active',
      reviewState: 'approved',
      updatedAt: now(),
    };
    const content = renderKnowledgePage(activeFrontmatter, proposalPage.body);
    const contentHash = await writeKnowledgePage(targetPath, content);
    const activePage = await readKnowledgePage(targetPath, root);
    const record = toPageRecord(input.workspace, activePage, 'active', contentHash);
    store.upsertPage(record);
    store.replacePageClaims(record.id, record.claimIds);
    store.replacePageLinks(record.id, activePage.links.map(link => resolvePageLink(record.relativePath, link)).filter((link): link is string => !!link));
    store.markProposalApplied(proposal.id);
    await appendLog(
      input.workspace,
      'applied ' + record.relativePath + (input.allowManualOverwrite ? ' after explicit manual overwrite review.' : '.'),
    );
    await writeIndex(input.workspace, store);
  });
  return { proposal: store.getProposal(proposal.id)!, targetPath };
}

async function markdownFiles(directory: string): Promise<string[]> {
  const files: string[] = [];
  let entries: Array<import('node:fs').Dirent>;
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch {
    return files;
  }
  for (const entry of entries) {
    const filePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await markdownFiles(filePath));
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
      files.push(filePath);
    }
  }
  return files;
}

export async function lintKnowledgeWorkspace(input: {
  workspace: KnowledgeWorkspace;
  claims: ClaimStore;
  codeStore?: CodeGraphStore;
}): Promise<WikiLintResult> {
  const store = await storeFor(input.workspace);
  const paths = getKnowledgeWorkspacePaths(input.workspace);
  const issues: WikiLintIssue[] = [];
  const validPages: KnowledgePage[] = [];
  const files = await markdownFiles(paths.pages);

  for (const filePath of files) {
    try {
      validPages.push(await readKnowledgePage(filePath, paths.root));
    } catch (error) {
      issues.push({
        kind: 'malformed-frontmatter',
        severity: 'error',
        message: error instanceof Error ? error.message : 'Malformed knowledge page.',
        relativePath: path.relative(paths.root, filePath).split(path.sep).join('/'),
      });
    }
  }

  const indexed = new Set<string>();
  try {
    const index = await fs.readFile(paths.index, 'utf8');
    for (const link of extractInternalMarkdownLinks(index)) {
      const resolved = resolvePageLink('index.md', link);
      if (resolved) indexed.add(resolved);
    }
  } catch {
    issues.push({
      kind: 'broken-link',
      severity: 'error',
      message: 'Knowledge index is missing.',
      relativePath: 'index.md',
    });
  }

  const latestSnapshotId = input.codeStore?.latestSnapshot(input.workspace.projectId)?.id;
  for (const page of validPages) {
    if (!indexed.has(page.relativePath)) {
      issues.push({
        kind: 'orphan-page',
        severity: 'warning',
        message: 'Page is not linked from index.md.',
        relativePath: page.relativePath,
      });
    }
    for (const link of page.links) {
      const target = resolvePageLink(page.relativePath, link);
      if (!target || !await fileHashIfPresent(resolveKnowledgeWorkspaceFile(input.workspace, target))) {
        issues.push({
          kind: 'broken-link',
          severity: 'error',
          message: 'Internal Markdown link does not resolve to a workspace page.',
          relativePath: page.relativePath,
        });
      }
    }
    for (const claimId of page.frontmatter.claimIds) {
      const claim = input.claims.getClaim(claimId);
      if (!claim) {
        issues.push({
          kind: 'missing-claim',
          severity: 'error',
          message: 'Page references a claim that is not present in the ledger.',
          relativePath: page.relativePath,
          claimId,
        });
        continue;
      }
      if (input.claims.listEvidence(claim.id).length === 0) {
        issues.push({
          kind: 'missing-evidence',
          severity: 'error',
          message: 'Page claim has no source evidence.',
          relativePath: page.relativePath,
          claimId,
        });
      }
      if (claim.status === 'superseded') {
        issues.push({
          kind: 'superseded-claim',
          severity: 'error',
          message: 'Page still presents a superseded primary claim.',
          relativePath: page.relativePath,
          claimId,
        });
      }
      if (claim.status === 'disputed') {
        issues.push({
          kind: 'unresolved-conflict',
          severity: 'error',
          message: 'Page claim has an unresolved competing assertion.',
          relativePath: page.relativePath,
          claimId,
        });
      }
    }
    if (latestSnapshotId && page.frontmatter.snapshotId && page.frontmatter.snapshotId !== latestSnapshotId) {
      issues.push({
        kind: 'stale-snapshot',
        severity: 'warning',
        message: 'Page was compiled against an older code snapshot.',
        relativePath: page.relativePath,
      });
    }
  }

  for (const proposal of store.listProposals(input.workspace.id, 'pending')) {
    if (proposal.reason === 'manual-edit-protected') {
      issues.push({
        kind: 'manual-edit-protected',
        severity: 'warning',
        message: 'A newer proposal was held because the target page has manual edits.',
        relativePath: path.relative(paths.root, proposal.targetPath).split(path.sep).join('/'),
      });
    }
  }

  const valid = !issues.some(issue => issue.severity === 'error');
  store.markWorkspaceLinted(input.workspace.id, valid ? 'ready' : 'needs-review');
  return { valid, pagesScanned: validPages.length, issues };
}
