import { randomUUID } from 'node:crypto';
import { getDatabase } from '../store/sqlite-db.js';
import type {
  KnowledgePageRecord,
  KnowledgeProposal,
  KnowledgeWorkspace,
  KnowledgeWorkspaceMode,
  KnowledgeWorkspaceStatus,
} from './workspace-types.js';

function arrayValue(raw: unknown): string[] {
  if (typeof raw !== 'string' || !raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

function optionalText(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}

function rowToWorkspace(row: any): KnowledgeWorkspace {
  return {
    id: row.id,
    projectId: row.projectId,
    mode: row.mode,
    rootPath: row.rootPath,
    ...(optionalText(row.projectRoot) ? { projectRoot: row.projectRoot } : {}),
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    ...(optionalText(row.lastCompiledAt) ? { lastCompiledAt: row.lastCompiledAt } : {}),
    ...(optionalText(row.lastLintedAt) ? { lastLintedAt: row.lastLintedAt } : {}),
  };
}

function rowToPage(row: any): KnowledgePageRecord {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    relativePath: row.relativePath,
    title: row.title,
    kind: row.kind,
    status: row.status,
    reviewState: row.reviewState,
    contentHash: row.contentHash,
    sourceHash: row.sourceHash,
    claimIds: arrayValue(row.claimIdsJson),
    ...(optionalText(row.snapshotId) ? { snapshotId: row.snapshotId } : {}),
    tags: arrayValue(row.tagsJson),
    generatedAt: row.generatedAt,
    updatedAt: row.updatedAt,
    ...(optionalText(row.lastLintedAt) ? { lastLintedAt: row.lastLintedAt } : {}),
    ...(optionalText(row.manualContentHash) ? { manualContentHash: row.manualContentHash } : {}),
  };
}

function rowToProposal(row: any): KnowledgeProposal {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    pageId: row.pageId,
    targetPath: row.targetPath,
    proposalPath: row.proposalPath,
    ...(optionalText(row.baseContentHash) ? { baseContentHash: row.baseContentHash } : {}),
    sourceHash: row.sourceHash,
    reason: row.reason,
    status: row.status,
    createdAt: row.createdAt,
    ...(optionalText(row.appliedAt) ? { appliedAt: row.appliedAt } : {}),
  };
}

/**
 * Operational metadata for Markdown workspaces. The Markdown files remain the
 * human-readable source; this store tracks provenance and safe proposal state.
 */
export class KnowledgeWorkspaceStore {
  private db: any = null;

  async init(dataDir: string): Promise<void> {
    this.db = getDatabase(dataDir);
  }

  upsertWorkspace(input: Omit<KnowledgeWorkspace, 'createdAt' | 'updatedAt'> & {
    createdAt?: string;
    updatedAt?: string;
  }): KnowledgeWorkspace {
    const now = input.updatedAt ?? new Date().toISOString();
    const createdAt = input.createdAt ?? now;
    this.db.prepare(
      'INSERT INTO knowledge_workspaces (id, projectId, mode, rootPath, projectRoot, status, createdAt, updatedAt, lastCompiledAt, lastLintedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET mode = excluded.mode, rootPath = excluded.rootPath, projectRoot = excluded.projectRoot, status = excluded.status, updatedAt = excluded.updatedAt, lastCompiledAt = excluded.lastCompiledAt, lastLintedAt = excluded.lastLintedAt',
    ).run(
      input.id,
      input.projectId,
      input.mode,
      input.rootPath,
      input.projectRoot ?? null,
      input.status,
      createdAt,
      now,
      input.lastCompiledAt ?? null,
      input.lastLintedAt ?? null,
    );
    return this.getWorkspace(input.id)!;
  }

  getWorkspace(id: string): KnowledgeWorkspace | undefined {
    const row = this.db.prepare('SELECT * FROM knowledge_workspaces WHERE id = ?').get(id);
    return row ? rowToWorkspace(row) : undefined;
  }

  findWorkspace(projectId: string, mode: KnowledgeWorkspaceMode): KnowledgeWorkspace | undefined {
    const row = this.db.prepare('SELECT * FROM knowledge_workspaces WHERE projectId = ? AND mode = ? ORDER BY updatedAt DESC LIMIT 1').get(projectId, mode);
    return row ? rowToWorkspace(row) : undefined;
  }

  upsertPage(page: KnowledgePageRecord): void {
    this.db.prepare(
      'INSERT INTO knowledge_pages (id, workspaceId, relativePath, title, kind, status, reviewState, contentHash, sourceHash, claimIdsJson, snapshotId, tagsJson, generatedAt, updatedAt, lastLintedAt, manualContentHash) VALUES (@id, @workspaceId, @relativePath, @title, @kind, @status, @reviewState, @contentHash, @sourceHash, @claimIdsJson, @snapshotId, @tagsJson, @generatedAt, @updatedAt, @lastLintedAt, @manualContentHash) ON CONFLICT(workspaceId, relativePath) DO UPDATE SET id = excluded.id, title = excluded.title, kind = excluded.kind, status = excluded.status, reviewState = excluded.reviewState, contentHash = excluded.contentHash, sourceHash = excluded.sourceHash, claimIdsJson = excluded.claimIdsJson, snapshotId = excluded.snapshotId, tagsJson = excluded.tagsJson, generatedAt = excluded.generatedAt, updatedAt = excluded.updatedAt, lastLintedAt = excluded.lastLintedAt, manualContentHash = excluded.manualContentHash',
    ).run({
      ...page,
      claimIdsJson: JSON.stringify(page.claimIds),
      snapshotId: page.snapshotId ?? null,
      tagsJson: JSON.stringify(page.tags),
      lastLintedAt: page.lastLintedAt ?? null,
      manualContentHash: page.manualContentHash ?? null,
    });
  }

  getPage(workspaceId: string, relativePath: string): KnowledgePageRecord | undefined {
    const row = this.db.prepare('SELECT * FROM knowledge_pages WHERE workspaceId = ? AND relativePath = ?').get(workspaceId, relativePath);
    return row ? rowToPage(row) : undefined;
  }

  getPageById(id: string): KnowledgePageRecord | undefined {
    const row = this.db.prepare('SELECT * FROM knowledge_pages WHERE id = ?').get(id);
    return row ? rowToPage(row) : undefined;
  }

  listPages(workspaceId: string): KnowledgePageRecord[] {
    return this.db.prepare('SELECT * FROM knowledge_pages WHERE workspaceId = ? ORDER BY relativePath').all(workspaceId).map(rowToPage);
  }

  replacePageClaims(pageId: string, claimIds: string[]): void {
    const remove = this.db.prepare('DELETE FROM knowledge_page_claims WHERE pageId = ?');
    const insert = this.db.prepare("INSERT OR IGNORE INTO knowledge_page_claims (pageId, claimId, role) VALUES (?, ?, 'primary')");
    this.db.transaction(() => {
      remove.run(pageId);
      for (const claimId of [...new Set(claimIds)]) insert.run(pageId, claimId);
    })();
  }

  replacePageLinks(pageId: string, targets: string[]): void {
    const remove = this.db.prepare('DELETE FROM knowledge_page_links WHERE sourcePageId = ?');
    const insert = this.db.prepare('INSERT OR IGNORE INTO knowledge_page_links (sourcePageId, targetPath) VALUES (?, ?)');
    this.db.transaction(() => {
      remove.run(pageId);
      for (const target of [...new Set(targets)]) insert.run(pageId, target);
    })();
  }

  createProposal(input: Omit<KnowledgeProposal, 'id' | 'createdAt' | 'status'> & {
    id?: string;
    createdAt?: string;
    status?: KnowledgeProposal['status'];
  }): KnowledgeProposal {
    const proposal: KnowledgeProposal = {
      id: input.id ?? randomUUID(),
      ...input,
      status: input.status ?? 'pending',
      createdAt: input.createdAt ?? new Date().toISOString(),
    };
    this.db.prepare(
      'INSERT INTO knowledge_proposals (id, workspaceId, pageId, targetPath, proposalPath, baseContentHash, sourceHash, reason, status, createdAt, appliedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(workspaceId, proposalPath) DO UPDATE SET pageId = excluded.pageId, targetPath = excluded.targetPath, baseContentHash = excluded.baseContentHash, sourceHash = excluded.sourceHash, reason = excluded.reason, status = excluded.status, createdAt = excluded.createdAt, appliedAt = excluded.appliedAt',
    ).run(
      proposal.id,
      proposal.workspaceId,
      proposal.pageId,
      proposal.targetPath,
      proposal.proposalPath,
      proposal.baseContentHash ?? null,
      proposal.sourceHash,
      proposal.reason,
      proposal.status,
      proposal.createdAt,
      proposal.appliedAt ?? null,
    );
    const row = this.db.prepare('SELECT * FROM knowledge_proposals WHERE workspaceId = ? AND proposalPath = ?').get(proposal.workspaceId, proposal.proposalPath);
    return rowToProposal(row);
  }

  getProposal(id: string): KnowledgeProposal | undefined {
    const row = this.db.prepare('SELECT * FROM knowledge_proposals WHERE id = ?').get(id);
    return row ? rowToProposal(row) : undefined;
  }

  listProposals(workspaceId: string, status?: KnowledgeProposal['status']): KnowledgeProposal[] {
    const rows = status
      ? this.db.prepare('SELECT * FROM knowledge_proposals WHERE workspaceId = ? AND status = ? ORDER BY createdAt DESC, id').all(workspaceId, status)
      : this.db.prepare('SELECT * FROM knowledge_proposals WHERE workspaceId = ? ORDER BY createdAt DESC, id').all(workspaceId);
    return rows.map(rowToProposal);
  }

  markProposalApplied(id: string, appliedAt = new Date().toISOString()): KnowledgeProposal {
    this.db.prepare("UPDATE knowledge_proposals SET status = 'applied', appliedAt = ? WHERE id = ?").run(appliedAt, id);
    return this.getProposal(id)!;
  }

  markWorkspaceCompiled(id: string, at = new Date().toISOString()): void {
    this.db.prepare('UPDATE knowledge_workspaces SET lastCompiledAt = ?, updatedAt = ? WHERE id = ?').run(at, at, id);
  }

  markWorkspaceLinted(id: string, status: KnowledgeWorkspaceStatus, at = new Date().toISOString()): void {
    this.db.prepare('UPDATE knowledge_workspaces SET status = ?, lastLintedAt = ?, updatedAt = ? WHERE id = ?').run(status, at, at, id);
  }
}
