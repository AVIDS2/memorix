import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { delimiter, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { sanitizeCredentials } from '../memory/secret-filter.js';
import { isCodeGraphExcludedPath } from './exclude.js';
import { normalizeCodePath } from './ids.js';
import type {
  CodeGraphExternalMode,
  CodeGraphProviderQuality,
  ExternalCodeGraphHealth,
  ExternalCodeGraphOutline,
  ExternalCodeGraphRelation,
  ExternalCodeGraphSymbol,
} from './types.js';

// The bundled Windows CodeGraph CLI takes roughly 600 ms just to start cold.
// Keep the default useful in real sessions while still bounding a local call.
export const DEFAULT_EXTERNAL_CODEGRAPH_TIMEOUT_MS = 1_200;
export const MAX_EXTERNAL_CODEGRAPH_TIMEOUT_MS = 5_000;
export const MAX_EXTERNAL_CODEGRAPH_OUTPUT_BYTES = 256 * 1024;
const MAX_EXTERNAL_NODE_COUNT = 16;
const MAX_EXTERNAL_EDGE_COUNT = 24;
const MAX_EXTERNAL_FILE_COUNT = 12;
const MAX_EXTERNAL_TEXT_LENGTH = 320;

const LITE_SUPPORTED_LANGUAGES = [
  'typescript',
  'javascript',
  'python',
  'go',
  'rust',
  'java',
  'csharp',
  'c',
  'cpp',
  'php',
  'ruby',
  'kotlin',
];

export interface ExternalCodeGraphCommandInput {
  command?: string;
  args: string[];
  cwd: string;
  timeoutMs: number;
  maxOutputBytes: number;
}

export interface ExternalCodeGraphCommandResult {
  ok: boolean;
  stdout: string;
  stderr?: string;
  exitCode?: number;
  timedOut?: boolean;
  outputLimited?: boolean;
  error?: string;
}

/** Injectable boundary keeps provider tests independent from a global install. */
export interface ExternalCodeGraphRunner {
  run(input: ExternalCodeGraphCommandInput): Promise<ExternalCodeGraphCommandResult>;
}

export interface InspectExternalCodeGraphInput {
  projectRoot: string;
  mode?: CodeGraphExternalMode;
  command?: string;
  timeoutMs?: number;
  runner?: ExternalCodeGraphRunner;
}

export interface InspectExternalCodeGraphResult {
  quality: CodeGraphProviderQuality;
  health: ExternalCodeGraphHealth;
}

export interface ExternalCodeGraphContextInput extends InspectExternalCodeGraphInput {
  task: string;
  exclude?: string[];
}

export interface ExternalCodeGraphContextResult extends InspectExternalCodeGraphResult {
  outline?: ExternalCodeGraphOutline;
  /** Only present when a detected external graph could not safely contribute. */
  caution?: string;
}

interface RawExternalStatus {
  initialized: boolean;
  projectPath: string;
  fileCount: number;
  nodeCount: number;
  edgeCount: number;
  languages: string[];
  pendingChanges: {
    added: number;
    modified: number;
    removed: number;
  };
  worktreeMismatch: string | null;
}

interface RawExternalNode {
  id: string;
  kind: string;
  name: string;
  qualifiedName?: string;
  filePath: string;
  language?: string;
  startLine?: number;
  endLine?: number;
}

interface ResolvedLaunch {
  executable: string;
  prefixArgs: string[];
}

function boundedTimeout(value: number | undefined): number {
  if (!Number.isFinite(value)) return DEFAULT_EXTERNAL_CODEGRAPH_TIMEOUT_MS;
  return Math.max(100, Math.min(Math.floor(value!), MAX_EXTERNAL_CODEGRAPH_TIMEOUT_MS));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function nonNegativeInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined;
}

function safeText(value: unknown, maxLength = MAX_EXTERNAL_TEXT_LENGTH): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = sanitizeCredentials(value).replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!normalized || normalized.length > maxLength) return undefined;
  return normalized;
}

function sameProjectRoot(left: string, right: string): boolean {
  const normalizedLeft = resolve(left).replace(/\\/g, '/');
  const normalizedRight = resolve(right).replace(/\\/g, '/');
  return process.platform === 'win32'
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight;
}

function resolveCommandCandidates(command: string | undefined): string[] {
  const requested = command?.trim() || 'codegraph';
  if (isAbsolute(requested) || requested.includes('/') || requested.includes('\\')) {
    return [resolve(requested)];
  }

  const names = extname(requested)
    ? [requested]
    : process.platform === 'win32'
      ? [requested + '.exe', requested + '.cmd', requested + '.js', requested]
      : [requested];
  const directories = [
    ...(process.platform === 'win32' && process.env.LOCALAPPDATA
      ? [join(process.env.LOCALAPPDATA, 'codegraph', 'current', 'bin')]
      : []),
    ...(process.env.PATH ?? '').split(delimiter).filter(Boolean),
  ];
  return [...new Set(directories.flatMap(directory => names.map(name => join(directory, name))))];
}

function resolveLaunch(command: string | undefined): ResolvedLaunch | undefined {
  for (const candidate of resolveCommandCandidates(command)) {
    if (!existsSync(candidate)) continue;
    const extension = extname(candidate).toLowerCase();
    if (extension === '.cmd') {
      // The official Windows bundle is a small cmd shim. Resolve its Node
      // runtime and JS entrypoint directly so task text never enters a shell.
      const bundleRoot = resolve(dirname(candidate), '..');
      const node = join(bundleRoot, 'node.exe');
      const entry = join(bundleRoot, 'lib', 'dist', 'bin', 'codegraph.js');
      if (existsSync(node) && existsSync(entry)) {
        return { executable: node, prefixArgs: ['--liftoff-only', entry] };
      }
      // Common npm shims are cmd wrappers around a JavaScript entrypoint. Read
      // the entrypoint path and invoke Node directly rather than interpolating
      // task text into cmd.exe. This deliberately supports only a real local
      // JS file, never arbitrary cmd syntax.
      try {
        const shim = readFileSync(candidate, 'utf8');
        const match = shim.match(/["']([^"']*%(?:~)?dp0%?[^"']*\.m?js)["']/i);
        if (match?.[1]) {
          const base = dirname(candidate).endsWith(sep) ? dirname(candidate) : dirname(candidate) + sep;
          const entry = resolve(match[1].replace(/%(?:~)?dp0%?/gi, base));
          if (existsSync(entry)) return { executable: process.execPath, prefixArgs: [entry] };
        }
      } catch {
        // A broken shim is reported as unavailable below, never executed.
      }
      continue;
    }
    if (extension === '.js') {
      return { executable: process.execPath, prefixArgs: [candidate] };
    }
    return { executable: candidate, prefixArgs: [] };
  }
  return undefined;
}

const defaultRunner: ExternalCodeGraphRunner = {
  async run(input): Promise<ExternalCodeGraphCommandResult> {
    const launch = resolveLaunch(input.command);
    if (!launch) {
      return {
        ok: false,
        stdout: '',
        error: 'CodeGraph executable was not found or is not safely runnable.',
      };
    }

    return new Promise((resolveResult) => {
      let stdout = Buffer.alloc(0);
      let stderr = Buffer.alloc(0);
      let settled = false;
      let timedOut = false;
      let outputLimited = false;
      let spawnError: string | undefined;
      let timeout: ReturnType<typeof setTimeout> | undefined;
      const finish = (result: ExternalCodeGraphCommandResult) => {
        if (settled) return;
        settled = true;
        if (timeout) clearTimeout(timeout);
        resolveResult(result);
      };
      let child: ReturnType<typeof spawn>;
      try {
        child = spawn(launch.executable, [...launch.prefixArgs, ...input.args], {
          cwd: input.cwd,
          shell: false,
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe'],
        });
      } catch (error) {
        finish({
          ok: false,
          stdout: '',
          error: error instanceof Error ? error.message : String(error),
        });
        return;
      }

      const stop = () => {
        try {
          child.kill();
        } catch {
          // The close/error event will settle the result.
        }
      };
      timeout = setTimeout(() => {
        timedOut = true;
        stop();
      }, input.timeoutMs);

      const collect = (target: 'stdout' | 'stderr', chunk: Buffer | string) => {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        if (stdout.length + stderr.length + buffer.length > input.maxOutputBytes) {
          outputLimited = true;
          stop();
          return;
        }
        if (target === 'stdout') stdout = Buffer.concat([stdout, buffer]);
        else stderr = Buffer.concat([stderr, buffer]);
      };
      child.stdout?.on('data', (chunk) => collect('stdout', chunk));
      child.stderr?.on('data', (chunk) => collect('stderr', chunk));
      child.on('error', (error) => {
        spawnError = error instanceof Error ? error.message : String(error);
        finish({ ok: false, stdout: stdout.toString('utf8'), stderr: stderr.toString('utf8'), error: spawnError });
      });
      child.on('close', (exitCode) => {
        finish({
          ok: exitCode === 0 && !timedOut && !outputLimited && !spawnError,
          stdout: stdout.toString('utf8'),
          stderr: stderr.toString('utf8'),
          ...(typeof exitCode === 'number' ? { exitCode } : {}),
          ...(timedOut ? { timedOut } : {}),
          ...(outputLimited ? { outputLimited } : {}),
          ...(spawnError ? { error: spawnError } : {}),
        });
      });
    });
  },
};

function providerQuality(input: {
  mode: CodeGraphExternalMode;
  health: ExternalCodeGraphHealth;
  selected?: 'lite' | 'external';
}): CodeGraphProviderQuality {
  const selected = input.selected ?? 'lite';
  return {
    selected,
    selectedQuality: selected === 'external' ? 'semantic' : 'heuristic',
    mode: input.mode,
    lite: {
      quality: 'heuristic',
      capabilities: {
        declarations: true,
        importHints: true,
        resolvedRelations: false,
        exactLocations: false,
      },
      supportedLanguages: LITE_SUPPORTED_LANGUAGES,
    },
    external: input.health,
  };
}

function parseJson(stdout: string): unknown | undefined {
  if (Buffer.byteLength(stdout, 'utf8') > MAX_EXTERNAL_CODEGRAPH_OUTPUT_BYTES) return undefined;
  try {
    return JSON.parse(stdout);
  } catch {
    return undefined;
  }
}

function parseStatus(value: unknown, projectRoot: string): RawExternalStatus | undefined {
  if (!isRecord(value)) return undefined;
  const initialized = value.initialized;
  const projectPath = safeText(value.projectPath, 4_096);
  const fileCount = nonNegativeInteger(value.fileCount);
  const nodeCount = nonNegativeInteger(value.nodeCount);
  const edgeCount = nonNegativeInteger(value.edgeCount);
  const pending = value.pendingChanges;
  const worktreeMismatch = value.worktreeMismatch;
  if (typeof initialized !== 'boolean' || !projectPath || !sameProjectRoot(projectPath, projectRoot)) return undefined;
  // CodeGraph intentionally emits a minimal payload before its first index.
  // That is a supported optional-provider state, not malformed evidence.
  if (!initialized) {
    return {
      initialized: false,
      projectPath,
      fileCount: 0,
      nodeCount: 0,
      edgeCount: 0,
      languages: [],
      pendingChanges: { added: 0, modified: 0, removed: 0 },
      worktreeMismatch: null,
    };
  }
  if (fileCount === undefined || nodeCount === undefined || edgeCount === undefined) return undefined;
  if (!isRecord(pending)) return undefined;
  const added = nonNegativeInteger(pending.added);
  const modified = nonNegativeInteger(pending.modified);
  const removed = nonNegativeInteger(pending.removed);
  if (added === undefined || modified === undefined || removed === undefined) return undefined;
  if (worktreeMismatch !== null && typeof worktreeMismatch !== 'string') return undefined;
  const languages = Array.isArray(value.languages)
    ? value.languages.map(item => safeText(item, 80)).filter((item): item is string => Boolean(item)).slice(0, 32)
    : [];
  return {
    initialized,
    projectPath,
    fileCount,
    nodeCount,
    edgeCount,
    languages,
    pendingChanges: { added, modified, removed },
    worktreeMismatch,
  };
}

function healthFromStatus(status: RawExternalStatus): ExternalCodeGraphHealth {
  if (!status.initialized) return { state: 'not-initialized', reason: 'The local CodeGraph index is not initialized.' };
  const pending = status.pendingChanges.added + status.pendingChanges.modified + status.pendingChanges.removed;
  if (pending > 0 || status.worktreeMismatch) {
    return {
      state: 'stale',
      reason: 'The local CodeGraph index has pending changes or a worktree mismatch.',
      indexedFiles: status.fileCount,
      indexedNodes: status.nodeCount,
      indexedEdges: status.edgeCount,
      languages: status.languages,
    };
  }
  return {
    state: 'ready',
    indexedFiles: status.fileCount,
    indexedNodes: status.nodeCount,
    indexedEdges: status.edgeCount,
    languages: status.languages,
  };
}

function unavailableHealth(result: ExternalCodeGraphCommandResult): ExternalCodeGraphHealth {
  if (result.timedOut) return { state: 'timed-out', reason: 'A local CodeGraph command timed out.' };
  if (result.outputLimited) return { state: 'invalid', reason: 'A local CodeGraph response exceeded the safety limit.' };
  return { state: 'unavailable', reason: 'A local CodeGraph command did not complete.' };
}

async function runSafely(
  runner: ExternalCodeGraphRunner,
  input: ExternalCodeGraphCommandInput,
): Promise<ExternalCodeGraphCommandResult> {
  try {
    return await runner.run(input);
  } catch {
    return { ok: false, stdout: '', error: 'CodeGraph command runner failed.' };
  }
}

export async function inspectExternalCodeGraph(input: InspectExternalCodeGraphInput): Promise<InspectExternalCodeGraphResult> {
  const mode = input.mode ?? 'auto';
  if (mode === 'off') {
    const health: ExternalCodeGraphHealth = { state: 'disabled', reason: 'External CodeGraph is disabled by configuration.' };
    return { health, quality: providerQuality({ mode, health }) };
  }
  if (!existsSync(join(input.projectRoot, '.codegraph'))) {
    const health: ExternalCodeGraphHealth = { state: 'not-detected', reason: 'No local .codegraph index is present for this project.' };
    return { health, quality: providerQuality({ mode, health }) };
  }

  const result = await runSafely(input.runner ?? defaultRunner, {
    command: input.command,
    args: ['status', input.projectRoot, '--json'],
    cwd: input.projectRoot,
    timeoutMs: boundedTimeout(input.timeoutMs),
    maxOutputBytes: MAX_EXTERNAL_CODEGRAPH_OUTPUT_BYTES,
  });
  if (!result.ok) {
    const health = unavailableHealth(result);
    return { health, quality: providerQuality({ mode, health }) };
  }
  const status = parseStatus(parseJson(result.stdout), input.projectRoot);
  if (!status) {
    const health: ExternalCodeGraphHealth = { state: 'invalid', reason: 'The local CodeGraph status payload was invalid for this project.' };
    return { health, quality: providerQuality({ mode, health }) };
  }
  const health = healthFromStatus(status);
  return { health, quality: providerQuality({ mode, health }) };
}

function safeRelativePath(projectRoot: string, value: unknown, exclude?: string[]): string | undefined {
  const path = safeText(value, 1_024);
  if (!path || isAbsolute(path)) return undefined;
  const absolute = resolve(projectRoot, path);
  const fromRoot = relative(projectRoot, absolute);
  if (!fromRoot || fromRoot === '..' || fromRoot.startsWith('..\\') || fromRoot.startsWith('../') || isAbsolute(fromRoot)) return undefined;
  const normalized = normalizeCodePath(fromRoot);
  if (isCodeGraphExcludedPath(normalized, exclude)) return undefined;
  return normalized;
}

function parseNode(value: unknown, projectRoot: string, exclude?: string[]): RawExternalNode | undefined {
  if (!isRecord(value)) return undefined;
  const id = safeText(value.id, 180);
  const kind = safeText(value.kind, 80);
  const name = safeText(value.name, 180);
  const filePath = safeRelativePath(projectRoot, value.filePath, exclude);
  if (!id || !kind || !name || !filePath) return undefined;
  const startLine = value.startLine === undefined ? undefined : nonNegativeInteger(value.startLine);
  const endLine = value.endLine === undefined ? undefined : nonNegativeInteger(value.endLine);
  if ((value.startLine !== undefined && (!startLine || startLine < 1)) || (value.endLine !== undefined && (!endLine || endLine < 1))) return undefined;
  const qualifiedName = value.qualifiedName === undefined ? undefined : safeText(value.qualifiedName, 220);
  const language = value.language === undefined ? undefined : safeText(value.language, 80);
  return {
    id,
    kind,
    name,
    filePath,
    ...(qualifiedName ? { qualifiedName } : {}),
    ...(language ? { language } : {}),
    ...(startLine ? { startLine } : {}),
    ...(endLine ? { endLine } : {}),
  };
}

function externalSymbol(raw: RawExternalNode): ExternalCodeGraphSymbol {
  return {
    id: raw.id,
    name: raw.name,
    ...(raw.qualifiedName ? { qualifiedName: raw.qualifiedName } : {}),
    kind: raw.kind,
    path: raw.filePath,
    ...(raw.startLine ? { startLine: raw.startLine } : {}),
    ...(raw.endLine ? { endLine: raw.endLine } : {}),
    ...(raw.language ? { language: raw.language } : {}),
  };
}

function parseOutline(value: unknown, projectRoot: string, exclude?: string[]): ExternalCodeGraphOutline | undefined {
  if (!isRecord(value) || !Array.isArray(value.entryPoints) || !Array.isArray(value.nodes)
    || !Array.isArray(value.edges) || !Array.isArray(value.relatedFiles)) return undefined;
  if ('codeBlocks' in value && (!Array.isArray(value.codeBlocks) || value.codeBlocks.length > 0)) return undefined;
  if (value.entryPoints.length > MAX_EXTERNAL_NODE_COUNT || value.nodes.length > MAX_EXTERNAL_NODE_COUNT
    || value.edges.length > MAX_EXTERNAL_EDGE_COUNT || value.relatedFiles.length > MAX_EXTERNAL_FILE_COUNT) return undefined;

  const nodes = [...value.entryPoints, ...value.nodes]
    .map(item => parseNode(item, projectRoot, exclude));
  if (nodes.some(node => !node)) return undefined;
  const byId = new Map<string, ExternalCodeGraphSymbol>();
  for (const node of nodes as RawExternalNode[]) {
    byId.set(node.id, externalSymbol(node));
  }
  const entryPoints = value.entryPoints
    .map(item => parseNode(item, projectRoot, exclude))
    .filter((node): node is RawExternalNode => Boolean(node))
    .map(externalSymbol)
    .filter((node, index, items) => items.findIndex(item => item.id === node.id) === index)
    .slice(0, 5);

  const relations: ExternalCodeGraphRelation[] = [];
  for (const rawEdge of value.edges) {
    if (!isRecord(rawEdge)) return undefined;
    const source = safeText(rawEdge.source, 180);
    const target = safeText(rawEdge.target, 180);
    const kind = safeText(rawEdge.kind, 80);
    const line = rawEdge.line === undefined ? undefined : nonNegativeInteger(rawEdge.line);
    if (!source || !target || !kind || (rawEdge.line !== undefined && (!line || line < 1))) return undefined;
    const from = byId.get(source);
    const to = byId.get(target);
    if (!from || !to) continue;
    relations.push({ from, to, kind, ...(line ? { line } : {}) });
  }

  const relatedFiles = value.relatedFiles.map(item => safeRelativePath(projectRoot, item, exclude));
  if (relatedFiles.some(file => !file)) return undefined;
  if (!isRecord(value.stats)) return undefined;
  const nodeCount = nonNegativeInteger(value.stats.nodeCount);
  const edgeCount = nonNegativeInteger(value.stats.edgeCount);
  const fileCount = nonNegativeInteger(value.stats.fileCount);
  if (nodeCount === undefined || edgeCount === undefined || fileCount === undefined) return undefined;
  return {
    provider: 'external',
    entryPoints,
    relations: relations.slice(0, 6),
    relatedFiles: [...new Set(relatedFiles as string[])].slice(0, 5),
    stats: { nodes: nodeCount, edges: edgeCount, files: fileCount },
  };
}

function fallbackCaution(health: ExternalCodeGraphHealth): string | undefined {
  if (health.state === 'disabled' || health.state === 'not-detected'
    || health.state === 'not-initialized' || health.state === 'ready') return undefined;
  return 'External semantic CodeGraph is ' + health.state + '; using Lite structural evidence for this brief.';
}

export async function getExternalCodeGraphContext(input: ExternalCodeGraphContextInput): Promise<ExternalCodeGraphContextResult> {
  const inspected = await inspectExternalCodeGraph(input);
  if (inspected.health.state !== 'ready') {
    return { ...inspected, caution: fallbackCaution(inspected.health) };
  }

  const mode = input.mode ?? 'auto';
  const result = await runSafely(input.runner ?? defaultRunner, {
    command: input.command,
    args: ['context', '--path', input.projectRoot, '--format', 'json', '--max-nodes', '8', '--no-code', input.task],
    cwd: input.projectRoot,
    timeoutMs: boundedTimeout(input.timeoutMs),
    maxOutputBytes: MAX_EXTERNAL_CODEGRAPH_OUTPUT_BYTES,
  });
  if (!result.ok) {
    const health = unavailableHealth(result);
    return {
      health,
      quality: providerQuality({ mode, health }),
      caution: fallbackCaution(health),
    };
  }
  const outline = parseOutline(parseJson(result.stdout), input.projectRoot, input.exclude);
  if (!outline) {
    const health: ExternalCodeGraphHealth = { state: 'invalid', reason: 'The local CodeGraph context payload failed validation.' };
    return {
      health,
      quality: providerQuality({ mode, health }),
      caution: fallbackCaution(health),
    };
  }
  const contributes = outline.entryPoints.length > 0 || outline.relations.length > 0 || outline.relatedFiles.length > 0;
  return {
    ...inspected,
    ...(contributes ? { outline } : {}),
    quality: providerQuality({ mode, health: inspected.health, ...(contributes ? { selected: 'external' as const } : {}) }),
  };
}
