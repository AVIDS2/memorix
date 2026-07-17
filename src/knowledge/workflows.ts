import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';
import type { AgentTarget } from '../types.js';
import { atomicWriteFile, withFileLock } from '../store/file-lock.js';
import { WorkflowSyncer } from '../workspace/workflow-sync.js';
import { getKnowledgeWorkspacePaths, resolveKnowledgeWorkspaceFile } from './workspace.js';
import { WorkflowStore } from './workflow-store.js';
import type {
  WorkflowAdapterPreview,
  WorkflowAdapterTarget,
  WorkflowPhase,
  WorkflowRun,
  WorkflowRunInput,
  WorkflowSelection,
  WorkflowSpec,
  WorkflowStatus,
} from './workflow-types.js';
import type { KnowledgeWorkspace } from './workspace-types.js';

const KNOWN_AGENTS: AgentTarget[] = [
  'windsurf',
  'cursor',
  'claude-code',
  'codex',
  'copilot',
  'antigravity',
  'gemini-cli',
  'openclaw',
  'hermes',
  'omp',
  'kiro',
  'opencode',
  'trae',
];

export const WORKFLOW_ADAPTER_TARGETS: WorkflowAdapterTarget[] = [
  'codex',
  'claude-code',
  'cursor',
  'windsurf',
];

const STATUS_VALUES: WorkflowStatus[] = ['draft', 'active', 'archived'];

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function now(): string {
  return new Date().toISOString();
}

function slug(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 72);
  return normalized || 'workflow';
}

function titleFromName(name: string): string {
  return name
    .replace(/[-_]+/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map(part => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(' ') || 'Imported Workflow';
}

function requiredText(data: Record<string, unknown>, key: string): string {
  const value = data[key];
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error('workflow frontmatter requires ' + key);
  }
  return value.trim();
}

function optionalText(data: Record<string, unknown>, key: string): string | undefined {
  const value = data[key];
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string') throw new Error('workflow frontmatter field ' + key + ' must be text');
  return value.trim() || undefined;
}

function optionalStringArray(data: Record<string, unknown>, key: string): string[] {
  const value = data[key];
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) {
    throw new Error('workflow frontmatter field ' + key + ' must be a string array');
  }
  return [...new Set(value.map(item => item.trim()).filter(Boolean))];
}

function optionalNumber(data: Record<string, unknown>, key: string, fallback: number): number {
  const value = data[key];
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new Error('workflow frontmatter field ' + key + ' must be a positive integer');
  }
  return value;
}

function optionalStatus(data: Record<string, unknown>): WorkflowStatus {
  const value = data.status;
  if (value === undefined || value === null || value === '') return 'draft';
  if (typeof value !== 'string' || !STATUS_VALUES.includes(value as WorkflowStatus)) {
    throw new Error('workflow frontmatter field status is invalid');
  }
  return value as WorkflowStatus;
}

function normalizeAgents(values: string[]): AgentTarget[] {
  const unknown = values.filter(value => !KNOWN_AGENTS.includes(value as AgentTarget));
  if (unknown.length > 0) {
    throw new Error('workflow frontmatter has unsupported agent: ' + unknown[0]);
  }
  return values as AgentTarget[];
}

function phaseFromValue(value: unknown, index: number): WorkflowPhase {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('workflow frontmatter phases must contain objects');
  }
  const data = value as Record<string, unknown>;
  const title = requiredText(data, 'title');
  const phaseId = optionalText(data, 'id') ?? slug(title) + '-' + (index + 1);
  return {
    id: phaseId,
    title,
    instructions: optionalText(data, 'instructions') ?? '',
    branches: optionalStringArray(data, 'branches'),
    expectedOutputs: optionalStringArray(data, 'expectedOutputs'),
    verificationGates: optionalStringArray(data, 'verificationGates'),
  };
}

function phasesFromBody(body: string): WorkflowPhase[] {
  const headers = [...body.matchAll(/^##\s+(.+?)\s*$/gm)];
  if (headers.length === 0) {
    const instructions = body.trim();
    return instructions
      ? [{
        id: 'execute',
        title: 'Execute',
        instructions,
        branches: [],
        expectedOutputs: [],
        verificationGates: [],
      }]
      : [];
  }
  return headers.map((match, index) => {
    const title = match[1].trim();
    const start = (match.index ?? 0) + match[0].length;
    const end = index + 1 < headers.length
      ? (headers[index + 1].index ?? body.length)
      : body.length;
    return {
      id: slug(title) + '-' + (index + 1),
      title,
      instructions: body.slice(start, end).trim(),
      branches: [],
      expectedOutputs: [],
      verificationGates: [],
    };
  });
}

function normalizeSourcePath(sourcePath: string): string {
  const normalized = sourcePath.replace(/\\/g, '/');
  if (
    !normalized.startsWith('workflows/')
    || !normalized.toLowerCase().endsWith('.md')
    || normalized.includes('../')
    || path.posix.normalize(normalized) !== normalized
  ) {
    throw new Error('workflow source path must be a safe workflows/*.md path');
  }
  return normalized;
}

function sourceHashFor(workflow: Omit<WorkflowSpec, 'sourceHash' | 'contentHash'> | WorkflowSpec): string {
  return hash(JSON.stringify({
    id: workflow.id,
    title: workflow.title,
    description: workflow.description,
    status: workflow.status,
    version: workflow.version,
    taskLenses: workflow.taskLenses,
    triggers: workflow.triggers,
    assumptions: workflow.assumptions,
    requiredContext: workflow.requiredContext,
    guardrails: workflow.guardrails,
    allowedTools: workflow.allowedTools,
    phases: workflow.phases,
    verificationGates: workflow.verificationGates,
    claimIds: workflow.claimIds,
    evidenceRefs: workflow.evidenceRefs,
    codeRefs: workflow.codeRefs,
    compatibleAgents: workflow.compatibleAgents,
    body: workflow.body,
    sourcePath: workflow.sourcePath,
    importedFrom: workflow.importedFrom ?? null,
  }));
}

function workflowFrontmatter(workflow: WorkflowSpec, sourceHash: string): Record<string, unknown> {
  return {
    id: workflow.id,
    title: workflow.title,
    description: workflow.description,
    status: workflow.status,
    version: workflow.version,
    taskLenses: workflow.taskLenses,
    triggers: workflow.triggers,
    assumptions: workflow.assumptions,
    requiredContext: workflow.requiredContext,
    guardrails: workflow.guardrails,
    allowedTools: workflow.allowedTools,
    phases: workflow.phases.map(phase => ({
      id: phase.id,
      title: phase.title,
      ...(phase.instructions ? { instructions: phase.instructions } : {}),
      ...(phase.branches.length ? { branches: phase.branches } : {}),
      ...(phase.expectedOutputs.length ? { expectedOutputs: phase.expectedOutputs } : {}),
      ...(phase.verificationGates.length ? { verificationGates: phase.verificationGates } : {}),
    })),
    verificationGates: workflow.verificationGates,
    claimIds: workflow.claimIds,
    evidenceRefs: workflow.evidenceRefs,
    codeRefs: workflow.codeRefs,
    compatibleAgents: workflow.compatibleAgents,
    sourceHash,
    createdAt: workflow.createdAt,
    updatedAt: workflow.updatedAt,
    ...(workflow.importedFrom ? { importedFrom: workflow.importedFrom } : {}),
  };
}

export function renderWorkflowMarkdown(workflow: WorkflowSpec): string {
  const sourceHash = sourceHashFor(workflow);
  return matter.stringify(workflow.body.trimEnd() + '\n', workflowFrontmatter(workflow, sourceHash));
}

function parsedWorkflow(data: Record<string, unknown>, body: string, input: {
  workspaceId: string;
  sourcePath: string;
  contentHash: string;
}): WorkflowSpec {
  const phasesValue = data.phases;
  const parsedPhases = phasesValue === undefined || phasesValue === null
    ? phasesFromBody(body)
    : Array.isArray(phasesValue)
      ? phasesValue.map(phaseFromValue)
      : (() => { throw new Error('workflow frontmatter field phases must be an array'); })();
  const candidate: WorkflowSpec = {
    id: requiredText(data, 'id'),
    workspaceId: input.workspaceId,
    title: requiredText(data, 'title'),
    description: optionalText(data, 'description') ?? '',
    status: optionalStatus(data),
    version: optionalNumber(data, 'version', 1),
    taskLenses: optionalStringArray(data, 'taskLenses'),
    triggers: optionalStringArray(data, 'triggers'),
    assumptions: optionalStringArray(data, 'assumptions'),
    requiredContext: optionalStringArray(data, 'requiredContext'),
    guardrails: optionalStringArray(data, 'guardrails'),
    allowedTools: optionalStringArray(data, 'allowedTools'),
    phases: parsedPhases,
    verificationGates: optionalStringArray(data, 'verificationGates'),
    claimIds: optionalStringArray(data, 'claimIds'),
    evidenceRefs: optionalStringArray(data, 'evidenceRefs'),
    codeRefs: optionalStringArray(data, 'codeRefs'),
    compatibleAgents: normalizeAgents(optionalStringArray(data, 'compatibleAgents').length
      ? optionalStringArray(data, 'compatibleAgents')
      : optionalStringArray(data, 'allowedAgents')),
    body: body.trim(),
    sourcePath: normalizeSourcePath(input.sourcePath),
    sourceHash: '',
    contentHash: input.contentHash,
    createdAt: optionalText(data, 'createdAt') ?? now(),
    updatedAt: optionalText(data, 'updatedAt') ?? now(),
    ...(optionalText(data, 'importedFrom') ? { importedFrom: optionalText(data, 'importedFrom') } : {}),
  };
  if (candidate.phases.length === 0) {
    throw new Error('workflow must contain at least one phase or a non-empty body');
  }
  return { ...candidate, sourceHash: sourceHashFor(candidate) };
}

export function parseWorkflowMarkdown(raw: string, input: {
  workspaceId: string;
  sourcePath: string;
}): WorkflowSpec {
  let parsed: matter.GrayMatterFile<string>;
  try {
    parsed = matter(raw);
  } catch (error) {
    throw new Error('Malformed workflow Markdown: ' + (error instanceof Error ? error.message : String(error)));
  }
  return parsedWorkflow(parsed.data as Record<string, unknown>, parsed.content, {
    workspaceId: input.workspaceId,
    sourcePath: input.sourcePath,
    contentHash: hash(raw),
  });
}

function workflowStoreDataDir(workspace: KnowledgeWorkspace): string {
  if (!workspace.dataDir) throw new Error('Knowledge workspace is missing its local data directory');
  return workspace.dataDir;
}

async function storeFor(workspace: KnowledgeWorkspace): Promise<WorkflowStore> {
  const store = new WorkflowStore();
  await store.init(workflowStoreDataDir(workspace));
  return store;
}

function materializeWorkflow(workflow: WorkflowSpec): WorkflowSpec {
  const updatedAt = workflow.updatedAt || now();
  const withDates = {
    ...workflow,
    createdAt: workflow.createdAt || updatedAt,
    updatedAt,
  };
  const sourceHash = sourceHashFor(withDates);
  const content = renderWorkflowMarkdown({ ...withDates, sourceHash, contentHash: '' });
  return {
    ...withDates,
    sourceHash,
    contentHash: hash(content),
  };
}

export async function writeCanonicalWorkflow(input: {
  workspace: KnowledgeWorkspace;
  workflow: WorkflowSpec;
}): Promise<WorkflowSpec> {
  const paths = getKnowledgeWorkspacePaths(input.workspace);
  const workflow = materializeWorkflow({
    ...input.workflow,
    workspaceId: input.workspace.id,
    sourcePath: normalizeSourcePath(input.workflow.sourcePath),
  });
  const filePath = resolveKnowledgeWorkspaceFile(input.workspace, workflow.sourcePath);
  const content = renderWorkflowMarkdown(workflow);
  await withFileLock(paths.root, async () => {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await atomicWriteFile(filePath, content);
  });
  const store = await storeFor(input.workspace);
  return store.upsertWorkflow({ ...workflow, contentHash: hash(content) });
}

async function markdownFiles(directory: string): Promise<string[]> {
  let entries: Array<import('node:fs').Dirent>;
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch {
    return [];
  }
  const files: string[] = [];
  for (const entry of entries) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await markdownFiles(absolutePath));
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
      files.push(absolutePath);
    }
  }
  return files;
}

/**
 * Make manually authored canonical files visible to selection without changing
 * them. Invalid files are returned as diagnostics instead of being treated as
 * active project instructions.
 */
export async function syncCanonicalWorkflows(workspace: KnowledgeWorkspace): Promise<{
  workflows: WorkflowSpec[];
  errors: Array<{ sourcePath: string; message: string }>;
}> {
  const paths = getKnowledgeWorkspacePaths(workspace);
  const store = await storeFor(workspace);
  const workflows: WorkflowSpec[] = [];
  const errors: Array<{ sourcePath: string; message: string }> = [];
  for (const absolutePath of await markdownFiles(paths.workflows)) {
    const sourcePath = path.relative(paths.root, absolutePath).split(path.sep).join('/');
    try {
      const raw = await fs.readFile(absolutePath, 'utf8');
      const workflow = parseWorkflowMarkdown(raw, { workspaceId: workspace.id, sourcePath });
      workflows.push(store.upsertWorkflow(workflow));
    } catch (error) {
      errors.push({
        sourcePath,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return { workflows, errors };
}

const LENS_TERMS: Record<string, string[]> = {
  release: ['release', 'publish', 'npm', 'version', '发版', '发布'],
  bugfix: ['bug', 'fix', 'error', 'failure', 'issue', 'repair', '修复', '报错', '故障'],
  migration: ['migration', 'migrate', 'upgrade', '迁移', '升级'],
  review: ['review', 'audit', 'pr', 'code review', '审查', '评审'],
  onboarding: ['onboard', 'onboarding', 'understand', 'introduce', '接手', '了解'],
  refactor: ['refactor', 'cleanup', 'restructure', '重构', '整理'],
  test: ['test', 'verify', 'smoke', '测试', '验证'],
};

function inferTaskLenses(value: string): string[] {
  const text = value.toLowerCase();
  return Object.entries(LENS_TERMS)
    .filter(([, terms]) => terms.some(term => text.includes(term)))
    .map(([lens]) => lens);
}

function taskScore(workflow: WorkflowSpec, task: string): { score: number; reasons: string[] } {
  const text = task.toLowerCase();
  let score = 0;
  const reasons: string[] = [];
  for (const lens of workflow.taskLenses) {
    const terms = LENS_TERMS[lens.toLowerCase()] ?? [lens.toLowerCase()];
    if (terms.some(term => text.includes(term))) {
      score += 20;
      reasons.push('matches ' + lens + ' workflow');
    }
  }
  for (const trigger of workflow.triggers) {
    const term = trigger.toLowerCase().trim();
    if (term.length >= 2 && text.includes(term)) {
      score += 8;
      reasons.push('matches trigger "' + trigger + '"');
    }
  }
  return { score, reasons: [...new Set(reasons)] };
}

export function selectWorkflows(input: {
  workflows: WorkflowSpec[];
  task: string;
  projectId?: string;
  store?: WorkflowStore;
  limit?: number;
}): WorkflowSelection[] {
  const selected = input.workflows
    .filter(workflow => workflow.status === 'active')
    .map(workflow => {
      const match = taskScore(workflow, input.task);
      const cautions = input.store && input.projectId
        ? input.store.recentFailureCautions(input.projectId, workflow.id)
        : [];
      return {
        workflow,
        score: match.score,
        reasons: match.reasons,
        firstPhase: workflow.phases[0],
        cautions,
      };
    })
    .filter(item => item.score > 0)
    .sort((left, right) => right.score - left.score || left.workflow.title.localeCompare(right.workflow.title));
  return selected.slice(0, Math.max(1, Math.min(input.limit ?? 2, 2)));
}

function importedWorkflowSpec(input: {
  workspace: KnowledgeWorkspace;
  sourceName: string;
  sourcePath: string;
  raw: string;
}): WorkflowSpec {
  const entry = new WorkflowSyncer().parseWindsurfWorkflow(input.sourceName, input.raw);
  const content = entry.content.trim() || '## Execute\n\nFollow the imported workflow.';
  const lenses = inferTaskLenses(entry.name + '\n' + entry.description + '\n' + content);
  const createdAt = now();
  const sourcePath = 'workflows/' + slug(entry.name) + '.md';
  const spec: WorkflowSpec = {
    id: 'workflow:' + hash(input.workspace.id + ':' + sourcePath).slice(0, 24),
    workspaceId: input.workspace.id,
    title: titleFromName(entry.name),
    description: entry.description || 'Imported from ' + input.sourcePath,
    status: 'active',
    version: 1,
    taskLenses: lenses,
    triggers: lenses,
    assumptions: [],
    requiredContext: [],
    guardrails: [],
    allowedTools: [],
    phases: phasesFromBody(content),
    verificationGates: [],
    claimIds: [],
    evidenceRefs: [],
    codeRefs: [],
    compatibleAgents: WORKFLOW_ADAPTER_TARGETS,
    body: content,
    sourcePath,
    sourceHash: '',
    contentHash: '',
    createdAt,
    updatedAt: createdAt,
    importedFrom: input.sourcePath.replace(/\\/g, '/'),
  };
  return materializeWorkflow(spec);
}

/**
 * Import legacy Windsurf workflows into canonical Markdown. The original
 * source is read only; existing canonical workflow files are not overwritten.
 */
export async function importWindsurfWorkflows(input: {
  workspace: KnowledgeWorkspace;
  projectRoot: string;
}): Promise<{
  imported: WorkflowSpec[];
  skipped: Array<{ sourcePath: string; reason: string }>;
}> {
  const sourceDirectory = path.join(path.resolve(input.projectRoot), '.windsurf', 'workflows');
  const paths = getKnowledgeWorkspacePaths(input.workspace);
  const imported: WorkflowSpec[] = [];
  const skipped: Array<{ sourcePath: string; reason: string }> = [];
  let entries: Array<import('node:fs').Dirent>;
  try {
    entries = await fs.readdir(sourceDirectory, { withFileTypes: true });
  } catch {
    return { imported, skipped };
  }
  for (const entry of entries.filter(item => item.isFile() && item.name.toLowerCase().endsWith('.md'))) {
    const originalPath = path.join(sourceDirectory, entry.name);
    const sourcePath = path.relative(path.resolve(input.projectRoot), originalPath).split(path.sep).join('/');
    try {
      const raw = await fs.readFile(originalPath, 'utf8');
      const workflow = importedWorkflowSpec({
        workspace: input.workspace,
        sourceName: entry.name,
        sourcePath,
        raw,
      });
      const targetPath = resolveKnowledgeWorkspaceFile(input.workspace, workflow.sourcePath);
      try {
        await fs.access(targetPath);
        skipped.push({ sourcePath, reason: 'canonical workflow already exists and was preserved' });
        continue;
      } catch {
        // The generated canonical path is available.
      }
      imported.push(await writeCanonicalWorkflow({ workspace: input.workspace, workflow }));
    } catch (error) {
      skipped.push({
        sourcePath,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }
  await fs.mkdir(paths.workflows, { recursive: true });
  return { imported, skipped };
}

function isWithin(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative !== '' && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
}

function adapterRelativePath(workflow: WorkflowSpec, agent: WorkflowAdapterTarget): string {
  const name = 'memorix-workflow-' + slug(workflow.id.replace(/^workflow:/, ''));
  if (agent === 'codex') return '.agents/skills/' + name + '/SKILL.md';
  if (agent === 'claude-code') return '.claude/skills/' + name + '/SKILL.md';
  if (agent === 'cursor') return '.cursor/rules/' + name + '.mdc';
  return '.windsurf/workflows/' + name + '.md';
}

function adapterMarker(workflow: WorkflowSpec): string {
  return '<!-- memorix:workflow-adapter id="' + workflow.id + '" -->';
}

function adapterContent(workflow: WorkflowSpec, agent: WorkflowAdapterTarget): string {
  const marker = adapterMarker(workflow);
  const firstPhase = workflow.phases[0];
  const gates = workflow.verificationGates.length
    ? workflow.verificationGates
    : firstPhase.verificationGates;
  if (agent === 'codex' || agent === 'claude-code') {
    return matter.stringify([
      marker,
      '',
      '# ' + workflow.title,
      '',
      workflow.description,
      '',
      '## Start',
      '',
      firstPhase.instructions || firstPhase.title,
      '',
      '## Verification',
      '',
      ...(gates.length ? gates.map(gate => '- ' + gate) : ['- Follow the project verification standards.']),
      '',
      '## Full workflow',
      '',
      workflow.body.trim(),
      '',
    ].join('\n'), {
      name: 'memorix-workflow-' + slug(workflow.id.replace(/^workflow:/, '')),
      description: workflow.description || workflow.title,
    });
  }
  if (agent === 'cursor') {
    return matter.stringify([
      marker,
      '',
      '# ' + workflow.title,
      '',
      workflow.body.trim(),
      '',
    ].join('\n'), {
      description: workflow.description || workflow.title,
      globs: '',
      alwaysApply: false,
    });
  }
  return matter.stringify([
    marker,
    '',
    '# ' + workflow.title,
    '',
    workflow.body.trim(),
    '',
  ].join('\n'), {
    description: workflow.description || workflow.title,
  });
}

function isWorkflowAdapterTarget(agent: AgentTarget): agent is WorkflowAdapterTarget {
  return WORKFLOW_ADAPTER_TARGETS.includes(agent as WorkflowAdapterTarget);
}

export async function previewWorkflowAdapter(input: {
  workflow: WorkflowSpec;
  projectRoot: string;
  agent: AgentTarget;
}): Promise<WorkflowAdapterPreview> {
  if (!isWorkflowAdapterTarget(input.agent)) {
    return {
      agent: input.agent,
      workflowId: input.workflow.id,
      status: 'unsupported',
      reason: 'This agent has no safe native workflow adapter. Use Memorix Project Context instead.',
    };
  }
  if (
    input.workflow.compatibleAgents.length > 0
    && !input.workflow.compatibleAgents.includes(input.agent)
  ) {
    return {
      agent: input.agent,
      workflowId: input.workflow.id,
      status: 'unsupported',
      reason: 'The canonical workflow does not declare compatibility with this agent.',
    };
  }
  const projectRoot = path.resolve(input.projectRoot);
  const targetPath = path.resolve(projectRoot, adapterRelativePath(input.workflow, input.agent));
  if (!isWithin(projectRoot, targetPath)) {
    throw new Error('Workflow adapter target escapes the project root');
  }
  const content = adapterContent(input.workflow, input.agent);
  let existing: string | undefined;
  try {
    existing = await fs.readFile(targetPath, 'utf8');
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error
      ? (error as { code?: string }).code
      : undefined;
    if (code !== 'ENOENT') throw error;
  }
  if (existing === undefined) {
    return { agent: input.agent, workflowId: input.workflow.id, targetPath, content, status: 'create', reason: 'No existing project adapter file.' };
  }
  if (existing === content) {
    return { agent: input.agent, workflowId: input.workflow.id, targetPath, content, status: 'unchanged', reason: 'Existing Memorix adapter already matches the canonical workflow.' };
  }
  if (existing.includes(adapterMarker(input.workflow))) {
    return { agent: input.agent, workflowId: input.workflow.id, targetPath, content, status: 'update', reason: 'Existing Memorix-owned adapter will be updated.' };
  }
  return { agent: input.agent, workflowId: input.workflow.id, targetPath, content, status: 'conflict', reason: 'A user-owned project file already occupies this adapter path.' };
}

export async function applyWorkflowAdapter(input: {
  workflow: WorkflowSpec;
  projectRoot: string;
  agent: AgentTarget;
}): Promise<WorkflowAdapterPreview> {
  const initial = await previewWorkflowAdapter(input);
  if (initial.status === 'unsupported' || initial.status === 'conflict' || initial.status === 'unchanged') {
    return initial;
  }
  const projectRoot = path.resolve(input.projectRoot);
  return withFileLock(projectRoot, async () => {
    const current = await previewWorkflowAdapter(input);
    if (current.status !== 'create' && current.status !== 'update') return current;
    await fs.mkdir(path.dirname(current.targetPath!), { recursive: true });
    await atomicWriteFile(current.targetPath!, current.content!);
    return current;
  });
}

export async function recordWorkflowRun(input: {
  workspace: KnowledgeWorkspace;
  run: WorkflowRunInput;
}): Promise<WorkflowRun> {
  const store = await storeFor(input.workspace);
  const workflow = store.getWorkflow(input.run.workflowId);
  if (!workflow || workflow.workspaceId !== input.workspace.id) {
    throw new Error('Workflow was not found for this workspace');
  }
  if (!input.run.task.trim()) throw new Error('Workflow run task is required');
  return store.recordRun(input.run);
}

export async function selectWorkspaceWorkflows(input: {
  workspace: KnowledgeWorkspace;
  task: string;
  limit?: number;
}): Promise<{ selections: WorkflowSelection[]; errors: Array<{ sourcePath: string; message: string }> }> {
  const synced = await syncCanonicalWorkflows(input.workspace);
  const store = await storeFor(input.workspace);
  return {
    selections: selectWorkflows({
      workflows: synced.workflows,
      task: input.task,
      projectId: input.workspace.projectId,
      store,
      limit: input.limit,
    }),
    errors: synced.errors,
  };
}
