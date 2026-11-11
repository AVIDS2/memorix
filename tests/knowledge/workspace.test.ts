import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ClaimStore } from '../../src/knowledge/claim-store.js';
import { supersedeClaim, writeClaim } from '../../src/knowledge/claims.js';
import { applyKnowledgeProposal, compileKnowledgeWorkspace, lintKnowledgeWorkspace, readKnowledgePage } from '../../src/knowledge/wiki.js';
import { initializeKnowledgeWorkspace } from '../../src/knowledge/workspace.js';
import { closeAllDatabases } from '../../src/store/sqlite-db.js';

let root: string | null = null;

function tempRoot(): string {
  root = mkdtempSync(path.join(tmpdir(), 'memorix-knowledge-workspace-'));
  return root;
}

async function claimStore(dataDir: string): Promise<ClaimStore> {
  const store = new ClaimStore();
  await store.init(dataDir);
  return store;
}

function evidence(id: string) {
  return {
    evidenceKind: 'observation' as const,
    evidenceId: 'observation:' + id,
    relation: 'supports' as const,
    locator: 'observation/' + id,
    capturedHash: 'hash-' + id,
  };
}

function addClaim(store: ClaimStore, subject: string, predicate: string, objectValue: string, evidenceId: string) {
  return writeClaim(store, {
    projectId: 'org/repo',
    subject,
    predicate,
    objectValue,
    scope: 'project',
    evidence: [evidence(evidenceId)],
  }).claim;
}

function initGitRepository(dir: string): void {
  execFileSync('git', ['init'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'tests@memorix.local'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.name', 'Memorix Tests'], { cwd: dir, stdio: 'ignore' });
  writeFileSync(path.join(dir, 'README.md'), '# fixture\n', 'utf8');
  execFileSync('git', ['add', '.'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['commit', '-m', 'initial fixture'], { cwd: dir, stdio: 'ignore' });
}

afterEach(() => {
  closeAllDatabases();
  if (root) rmSync(root, { recursive: true, force: true });
  root = null;
});

describe('Knowledge Workspace', () => {
  it('initializes private local artifacts without writing to the project repository', async () => {
    const sandbox = tempRoot();
    const projectRoot = path.join(sandbox, 'repo');
    const dataDir = path.join(sandbox, 'data');
    mkdirSync(projectRoot, { recursive: true });
    initGitRepository(projectRoot);

    const workspace = await initializeKnowledgeWorkspace({
      projectId: 'org/repo',
      dataDir,
      mode: 'local',
    });

    expect(workspace.rootPath.startsWith(dataDir)).toBe(true);
    expect(workspace.rootPath.startsWith(projectRoot)).toBe(false);
    expect(readFileSync(path.join(workspace.rootPath, 'schema.md'), 'utf8')).toContain('Knowledge Workspace');
    expect(readFileSync(path.join(workspace.rootPath, 'index.md'), 'utf8')).toContain('Knowledge Workspace');
    expect(readFileSync(path.join(workspace.rootPath, 'log.md'), 'utf8')).toContain('Knowledge log');
  });

  it('requires an explicit, trackable versioned path inside the Git project', async () => {
    const sandbox = tempRoot();
    const projectRoot = path.join(sandbox, 'repo');
    const dataDir = path.join(sandbox, 'data');
    mkdirSync(projectRoot, { recursive: true });
    initGitRepository(projectRoot);
    writeFileSync(path.join(projectRoot, '.gitignore'), 'ignored-knowledge/\n', 'utf8');

    await expect(initializeKnowledgeWorkspace({
      projectId: 'org/repo',
      dataDir,
      mode: 'versioned',
      projectRoot,
      rootPath: path.join(projectRoot, 'ignored-knowledge'),
    })).rejects.toThrow(/ignored/i);

    const workspace = await initializeKnowledgeWorkspace({
      projectId: 'org/repo',
      dataDir,
      mode: 'versioned',
      projectRoot,
      rootPath: path.join(projectRoot, 'docs', 'knowledge'),
    });

    expect(workspace.mode).toBe('versioned');
    expect(workspace.rootPath).toBe(path.join(projectRoot, 'docs', 'knowledge'));
  });

  it('creates a reviewable proposal before publishing a page and protects manual edits until explicit review', async () => {
    const sandbox = tempRoot();
    const dataDir = path.join(sandbox, 'data');
    const store = await claimStore(dataDir);
    addClaim(store, 'authentication', 'decision', 'use signed cookies', '1');
    const workspace = await initializeKnowledgeWorkspace({
      projectId: 'org/repo',
      dataDir,
      mode: 'local',
    });

    const compiled = await compileKnowledgeWorkspace({ workspace, claims: store });

    expect(compiled.proposals).toHaveLength(1);
    expect(compiled.published).toHaveLength(0);
    expect(readFileSync(compiled.proposals[0].proposalPath, 'utf8')).toContain('status: proposed');
    expect(existsSync(compiled.proposals[0].targetPath)).toBe(false);

    const applied = await applyKnowledgeProposal({
      workspace,
      proposalId: compiled.proposals[0].id,
    });
    const published = await readKnowledgePage(applied.targetPath);
    expect(published.frontmatter.status).toBe('active');
    expect(published.frontmatter.claimIds).toHaveLength(1);
    expect(readFileSync(path.join(workspace.rootPath, 'index.md'), 'utf8')).toContain('pages/');

    writeFileSync(applied.targetPath, readFileSync(applied.targetPath, 'utf8') + '\nManual editorial note.\n', 'utf8');
    addClaim(store, 'authentication', 'requires', 'session rotation coverage', '2');
    const changed = await compileKnowledgeWorkspace({ workspace, claims: store });

    expect(changed.proposals).toEqual(expect.arrayContaining([
      expect.objectContaining({ reason: 'manual-edit-protected' }),
    ]));
    await expect(applyKnowledgeProposal({
      workspace,
      proposalId: changed.proposals[0].id,
    })).rejects.toThrow(/manual/i);
    expect(readFileSync(applied.targetPath, 'utf8')).toContain('Manual editorial note.');

    await applyKnowledgeProposal({
      workspace,
      proposalId: changed.proposals[0].id,
      allowManualOverwrite: true,
    });
    expect(readFileSync(applied.targetPath, 'utf8')).not.toContain('Manual editorial note.');
  });

  it('lints broken links and superseded primary claims instead of treating them as current knowledge', async () => {
    const sandbox = tempRoot();
    const dataDir = path.join(sandbox, 'data');
    const store = await claimStore(dataDir);
    const older = addClaim(store, 'api transport', 'uses', 'REST', '1');
    const workspace = await initializeKnowledgeWorkspace({
      projectId: 'org/repo',
      dataDir,
      mode: 'local',
    });
    const compiled = await compileKnowledgeWorkspace({ workspace, claims: store });
    const applied = await applyKnowledgeProposal({
      workspace,
      proposalId: compiled.proposals[0].id,
    });

    const replacement = addClaim(store, 'api transport', 'uses', 'GraphQL', '2');
    supersedeClaim(store, {
      claimId: older.id,
      replacementClaimId: replacement.id,
      evidence: [{
        evidenceKind: 'git',
        evidenceId: 'git:transport-migration',
        relation: 'verifies',
        locator: 'git:transport-migration',
        capturedHash: 'transport-migration',
      }],
    });
    writeFileSync(applied.targetPath, readFileSync(applied.targetPath, 'utf8') + '\n[broken](missing-page.md)\n', 'utf8');
    writeFileSync(path.join(workspace.rootPath, 'pages', 'malformed.md'), '---\nid: bad\n---\n', 'utf8');

    const lint = await lintKnowledgeWorkspace({ workspace, claims: store });
    const kinds = lint.issues.map(issue => issue.kind);

    expect(kinds).toContain('broken-link');
    expect(kinds).toContain('superseded-claim');
    expect(kinds).toContain('malformed-frontmatter');
    expect(lint.valid).toBe(false);
  });
});
