import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { atomicWriteFile, withFileLock } from '../store/file-lock.js';
import { KnowledgeWorkspaceStore } from './workspace-store.js';
import type { KnowledgeWorkspace, KnowledgeWorkspaceMode } from './workspace-types.js';

const execFileAsync = promisify(execFile);

export interface KnowledgeWorkspacePaths {
  root: string;
  pages: string;
  proposals: string;
  workflows: string;
  index: string;
  log: string;
  schema: string;
}

export interface InitializeKnowledgeWorkspaceInput {
  projectId: string;
  dataDir: string;
  mode: KnowledgeWorkspaceMode;
  projectRoot?: string;
  rootPath?: string;
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function workspaceId(projectId: string, mode: KnowledgeWorkspaceMode): string {
  return 'workspace:' + hash(projectId + ':' + mode).slice(0, 24);
}

function localWorkspacePath(dataDir: string, projectId: string): string {
  return path.join(path.resolve(dataDir), 'knowledge-workspaces', hash(projectId).slice(0, 24));
}

function isWithin(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative !== '' && !relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative);
}

function ensureVersionedPath(projectRoot: string, rootPath: string): string {
  if (!path.isAbsolute(rootPath)) {
    throw new Error('A versioned knowledge workspace requires an explicit absolute path');
  }
  const resolvedProject = path.resolve(projectRoot);
  const resolvedWorkspace = path.resolve(rootPath);
  if (!isWithin(resolvedProject, resolvedWorkspace)) {
    throw new Error('A versioned knowledge workspace must live inside the Git project');
  }
  const segments = path.relative(resolvedProject, resolvedWorkspace).split(path.sep);
  if (segments.includes('.git') || segments.includes('node_modules') || segments.includes('dist')) {
    throw new Error('The selected knowledge workspace path is not safe for project artifacts');
  }
  return resolvedWorkspace;
}

async function isIgnoredByGit(projectRoot: string, workspaceRoot: string): Promise<boolean> {
  const relative = path.relative(projectRoot, workspaceRoot).split(path.sep).join('/');
  const probes = [relative, relative.replace(/\/+$/, '') + '/.memorix-workspace-probe'];
  for (const probe of probes) {
    try {
      await execFileAsync('git', ['-C', projectRoot, 'check-ignore', '--quiet', '--no-index', '--', probe], {
        timeout: 3_000,
        windowsHide: true,
      });
      return true;
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error
        ? (error as { code?: number | string }).code
        : undefined;
      if (code === 1 || code === '1') continue;
      return false;
    }
  }
  return false;
}

async function assertNoSymlinkEscape(projectRoot: string, workspaceRoot: string): Promise<void> {
  const [realProject, realWorkspace] = await Promise.all([
    fs.realpath(projectRoot),
    fs.realpath(workspaceRoot),
  ]);
  if (!isWithin(realProject, realWorkspace)) {
    throw new Error('The selected knowledge workspace resolves outside the Git project');
  }
}

export function getKnowledgeWorkspacePaths(workspace: Pick<KnowledgeWorkspace, 'rootPath'>): KnowledgeWorkspacePaths {
  const root = path.resolve(workspace.rootPath);
  return {
    root,
    pages: path.join(root, 'pages'),
    proposals: path.join(root, 'proposals'),
    workflows: path.join(root, 'workflows'),
    index: path.join(root, 'index.md'),
    log: path.join(root, 'log.md'),
    schema: path.join(root, 'schema.md'),
  };
}

export function resolveKnowledgeWorkspaceFile(workspace: Pick<KnowledgeWorkspace, 'rootPath'>, relativePath: string): string {
  if (!relativePath || path.isAbsolute(relativePath)) {
    throw new Error('Knowledge workspace paths must be relative');
  }
  const root = path.resolve(workspace.rootPath);
  const candidate = path.resolve(root, relativePath);
  if (candidate === root || !isWithin(root, candidate)) {
    throw new Error('Knowledge workspace path escapes its root');
  }
  return candidate;
}

async function writeIfMissing(filePath: string, content: string): Promise<void> {
  try {
    await fs.access(filePath);
  } catch {
    await atomicWriteFile(filePath, content);
  }
}

function schemaContent(): string {
  return [
    '# Memorix Knowledge Workspace',
    '',
    'This workspace is compiled from source-qualified Memorix claims.',
    'Topic pages are proposal-first: review and apply a proposal before relying',
    'on it as a published project knowledge page.',
    '',
    'Do not remove claim ids, evidence references, source hashes, or snapshot',
    'references from page frontmatter. Manual body edits are preserved and cause',
    'later compiler output to remain a proposal.',
    '',
  ].join('\n');
}

function indexContent(): string {
  return [
    '# Knowledge Workspace',
    '',
    '## Published pages',
    '',
    'No published pages yet.',
    '',
    '## Review queue',
    '',
    'No pending proposals.',
    '',
  ].join('\n');
}

function logContent(): string {
  return '# Knowledge log\n\n';
}

export async function initializeKnowledgeWorkspace(input: InitializeKnowledgeWorkspaceInput): Promise<KnowledgeWorkspace> {
  if (!input.projectId.trim()) throw new Error('Knowledge workspace project id is required');
  if (!input.dataDir.trim()) throw new Error('Knowledge workspace data directory is required');

  let rootPath: string;
  let projectRoot: string | undefined;
  if (input.mode === 'local') {
    rootPath = localWorkspacePath(input.dataDir, input.projectId);
  } else {
    if (!input.projectRoot || !input.rootPath) {
      throw new Error('A versioned knowledge workspace requires projectRoot and rootPath');
    }
    projectRoot = path.resolve(input.projectRoot);
    rootPath = ensureVersionedPath(projectRoot, input.rootPath);
    if (await isIgnoredByGit(projectRoot, rootPath)) {
      throw new Error('The selected versioned knowledge workspace is ignored by Git');
    }
  }

  const paths = getKnowledgeWorkspacePaths({ rootPath });
  await fs.mkdir(paths.pages, { recursive: true });
  await Promise.all([
    fs.mkdir(paths.proposals, { recursive: true }),
    fs.mkdir(paths.workflows, { recursive: true }),
  ]);
  if (projectRoot) await assertNoSymlinkEscape(projectRoot, paths.root);

  const workspace: KnowledgeWorkspace = {
    id: workspaceId(input.projectId, input.mode),
    projectId: input.projectId,
    dataDir: path.resolve(input.dataDir),
    mode: input.mode,
    rootPath: paths.root,
    ...(projectRoot ? { projectRoot } : {}),
    status: 'ready',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  await withFileLock(paths.root, async () => {
    await writeIfMissing(paths.schema, schemaContent());
    await writeIfMissing(paths.index, indexContent());
    await writeIfMissing(paths.log, logContent());
  });

  const store = new KnowledgeWorkspaceStore();
  await store.init(input.dataDir);
  return { ...store.upsertWorkspace(workspace), dataDir: workspace.dataDir };
}

export async function loadKnowledgeWorkspace(input: {
  projectId: string;
  dataDir: string;
  mode?: KnowledgeWorkspaceMode;
}): Promise<KnowledgeWorkspace | undefined> {
  const store = new KnowledgeWorkspaceStore();
  await store.init(input.dataDir);
  const workspace = store.findWorkspace(input.projectId, input.mode ?? 'local');
  return workspace ? { ...workspace, dataDir: path.resolve(input.dataDir) } : undefined;
}
