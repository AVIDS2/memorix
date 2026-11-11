export type KnowledgeWorkspaceMode = 'local' | 'versioned';
export type KnowledgeWorkspaceStatus = 'ready' | 'needs-review' | 'error';

export interface KnowledgeWorkspace {
  id: string;
  projectId: string;
  /** Local Memorix data directory used for the operational SQLite index. */
  dataDir?: string;
  mode: KnowledgeWorkspaceMode;
  rootPath: string;
  projectRoot?: string;
  status: KnowledgeWorkspaceStatus;
  createdAt: string;
  updatedAt: string;
  lastCompiledAt?: string;
  lastLintedAt?: string;
}

export type KnowledgePageKind = 'topic' | 'decision' | 'risk' | 'index' | 'schema' | 'log';
export type KnowledgePageStatus = 'active' | 'proposed';
export type KnowledgePageReviewState = 'approved' | 'needs-review';

export interface KnowledgePageFrontmatter {
  id: string;
  title: string;
  kind: KnowledgePageKind;
  status: KnowledgePageStatus;
  reviewState: KnowledgePageReviewState;
  claimIds: string[];
  evidenceRefs: string[];
  snapshotId?: string;
  tags: string[];
  sourceHash: string;
  generatedAt: string;
  updatedAt: string;
}

export interface KnowledgePage {
  absolutePath: string;
  relativePath: string;
  frontmatter: KnowledgePageFrontmatter;
  body: string;
  contentHash: string;
  links: string[];
}

export interface KnowledgePageRecord {
  id: string;
  workspaceId: string;
  relativePath: string;
  title: string;
  kind: KnowledgePageKind;
  status: KnowledgePageStatus;
  reviewState: KnowledgePageReviewState;
  contentHash: string;
  sourceHash: string;
  claimIds: string[];
  snapshotId?: string;
  tags: string[];
  generatedAt: string;
  updatedAt: string;
  lastLintedAt?: string;
  manualContentHash?: string;
}

export type KnowledgeProposalReason = 'new-page' | 'source-changed' | 'manual-edit-protected';
export type KnowledgeProposalStatus = 'pending' | 'applied' | 'superseded';

export interface KnowledgeProposal {
  id: string;
  workspaceId: string;
  pageId: string;
  targetPath: string;
  proposalPath: string;
  baseContentHash?: string;
  sourceHash: string;
  reason: KnowledgeProposalReason;
  status: KnowledgeProposalStatus;
  createdAt: string;
  appliedAt?: string;
}

export type WikiLintIssueKind =
  | 'malformed-frontmatter'
  | 'broken-link'
  | 'orphan-page'
  | 'missing-claim'
  | 'missing-evidence'
  | 'superseded-claim'
  | 'unresolved-conflict'
  | 'stale-snapshot'
  | 'manual-edit-protected';

export interface WikiLintIssue {
  kind: WikiLintIssueKind;
  severity: 'error' | 'warning';
  message: string;
  relativePath?: string;
  claimId?: string;
}

export interface WikiLintResult {
  valid: boolean;
  pagesScanned: number;
  issues: WikiLintIssue[];
}
