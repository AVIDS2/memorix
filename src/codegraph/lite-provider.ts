import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, type Dirent } from 'node:fs';
import { join, relative } from 'node:path';
import type { CodeEdge, CodeFile, CodeSymbol } from './types.js';
import { makeCodeEdgeId, makeCodeFileId, makeCodeSymbolId, normalizeCodePath } from './ids.js';
import { isCodeGraphExcludedPath, normalizeCodeGraphExcludePatterns } from './exclude.js';
import { CodeGraphStore, type CodeGraphFileDelta } from './store.js';

export interface LiteIndexOptions {
  projectId: string;
  projectRoot: string;
  exclude?: string[];
  maxFiles?: number;
  maxFileBytes?: number;
}

export interface LiteIndexResult {
  files: CodeFile[];
  symbols: CodeSymbol[];
  edges: CodeEdge[];
  skippedOversizedFiles: number;
}

export interface LiteRefreshResult {
  scannedFiles: number;
  changedFiles: number;
  unchangedFiles: number;
  metadataOnlyFiles: number;
  removedFiles: number;
  indexedSymbols: number;
  indexedEdges: number;
  skippedOversizedFiles: number;
  removalScanDeferred: boolean;
}

export const DEFAULT_CODEGRAPH_MAX_FILE_BYTES = 2 * 1024 * 1024;

const LANGUAGE_BY_EXTENSION = new Map<string, string>([
  ['.ts', 'typescript'],
  ['.tsx', 'typescript'],
  ['.js', 'javascript'],
  ['.jsx', 'javascript'],
  ['.mjs', 'javascript'],
  ['.cjs', 'javascript'],
  ['.py', 'python'],
  ['.go', 'go'],
  ['.rs', 'rust'],
  ['.java', 'java'],
  ['.cs', 'csharp'],
  ['.c', 'c'],
  ['.h', 'c'],
  ['.cpp', 'cpp'],
  ['.cc', 'cpp'],
  ['.cxx', 'cpp'],
  ['.hpp', 'cpp'],
  ['.hh', 'cpp'],
  ['.hxx', 'cpp'],
  ['.php', 'php'],
  ['.rb', 'ruby'],
  ['.kt', 'kotlin'],
  ['.kts', 'kotlin'],
]);

const SUPPORTED_EXTENSIONS = new Set(LANGUAGE_BY_EXTENSION.keys());

interface SymbolPattern {
  kind: CodeSymbol['kind'];
  re: RegExp;
}

interface LanguageProfile {
  symbols: SymbolPattern[];
  imports: RegExp[];
}

const identifier = String.raw`([A-Za-z_$][\w$]*)`;
const languageProfiles: Record<string, LanguageProfile> = {
  typescript: {
    symbols: [
      { kind: 'function', re: new RegExp(String.raw`(?:export\s+)?(?:async\s+)?function\s+${identifier}\s*\([^)]*\)`, 'g') },
      { kind: 'class', re: new RegExp(String.raw`(?:export\s+)?class\s+${identifier}\b`, 'g') },
      { kind: 'interface', re: new RegExp(String.raw`(?:export\s+)?interface\s+${identifier}\b`, 'g') },
      { kind: 'type', re: new RegExp(String.raw`(?:export\s+)?type\s+${identifier}\b`, 'g') },
      { kind: 'constant', re: new RegExp(String.raw`(?:export\s+)?const\s+${identifier}\s*=`, 'g') },
    ],
    imports: [/import\s+(?:[^'"]+\s+from\s+)?['"]([^'"]+)['"]/g],
  },
  javascript: {
    symbols: [
      { kind: 'function', re: new RegExp(String.raw`(?:export\s+)?(?:async\s+)?function\s+${identifier}\s*\([^)]*\)`, 'g') },
      { kind: 'class', re: new RegExp(String.raw`(?:export\s+)?class\s+${identifier}\b`, 'g') },
      { kind: 'constant', re: new RegExp(String.raw`(?:export\s+)?const\s+${identifier}\s*=`, 'g') },
    ],
    imports: [/import\s+(?:[^'"]+\s+from\s+)?['"]([^'"]+)['"]/g, /require\(['"]([^'"]+)['"]\)/g],
  },
  python: {
    symbols: [
      { kind: 'class', re: /^class\s+([A-Za-z_][\w]*)\b/gm },
      { kind: 'function', re: /^def\s+([A-Za-z_][\w]*)\s*\(/gm },
      { kind: 'function', re: /^async\s+def\s+([A-Za-z_][\w]*)\s*\(/gm },
    ],
    imports: [/^import\s+([A-Za-z_][\w.]*)(?:\s+as\s+\w+)?/gm, /^from\s+([A-Za-z_][\w.]*)\s+import\s+/gm],
  },
  go: {
    symbols: [
      { kind: 'function', re: /^func\s+(?:\([^)]+\)\s*)?([A-Za-z_][\w]*)\s*\(/gm },
      { kind: 'type', re: /^type\s+([A-Za-z_][\w]*)\s+(?:struct|interface)\b/gm },
    ],
    imports: [/import\s+"([^"]+)"/g, /import\s*\(([\s\S]*?)\)/g],
  },
  rust: {
    symbols: [
      { kind: 'function', re: /(?:pub\s+)?fn\s+([A-Za-z_][\w]*)\s*\(/g },
      { kind: 'class', re: /(?:pub\s+)?struct\s+([A-Za-z_][\w]*)\b/g },
      { kind: 'type', re: /(?:pub\s+)?enum\s+([A-Za-z_][\w]*)\b/g },
      { kind: 'interface', re: /(?:pub\s+)?trait\s+([A-Za-z_][\w]*)\b/g },
    ],
    imports: [/use\s+([^;]+);/g],
  },
  java: {
    symbols: [
      { kind: 'class', re: /\b(?:public|private|protected)?\s*(?:abstract\s+|final\s+)?class\s+([A-Za-z_][\w]*)\b/g },
      { kind: 'interface', re: /\b(?:public|private|protected)?\s*interface\s+([A-Za-z_][\w]*)\b/g },
      { kind: 'method', re: /\b(?:public|private|protected)\s+(?:static\s+)?(?:final\s+)?[A-Za-z_<>\[\], ?]+\s+([A-Za-z_][\w]*)\s*\([^)]*\)\s*\{/g },
    ],
    imports: [/import\s+([^;]+);/g],
  },
  csharp: {
    symbols: [
      { kind: 'class', re: /\b(?:public|private|protected|internal)?\s*(?:abstract\s+|sealed\s+|static\s+)?class\s+([A-Za-z_][\w]*)\b/g },
      { kind: 'interface', re: /\b(?:public|private|protected|internal)?\s*interface\s+([A-Za-z_][\w]*)\b/g },
      { kind: 'method', re: /\b(?:public|private|protected|internal)\s+(?:static\s+)?[A-Za-z_<>\[\], ?]+\s+([A-Za-z_][\w]*)\s*\([^)]*\)\s*\{/g },
    ],
    imports: [/using\s+([^;]+);/g],
  },
  c: {
    symbols: [
      { kind: 'type', re: /\bstruct\s+([A-Za-z_][\w]*)\b/g },
      { kind: 'function', re: /^(?:[A-Za-z_][\w]*\s+)+([A-Za-z_][\w]*)\s*\([^;{}]*\)\s*\{/gm },
    ],
    imports: [/#include\s+[<"]([^>"]+)[>"]/g],
  },
  cpp: {
    symbols: [
      { kind: 'class', re: /\bclass\s+([A-Za-z_][\w]*)\b/g },
      { kind: 'type', re: /\bstruct\s+([A-Za-z_][\w]*)\b/g },
      { kind: 'function', re: /^(?:[A-Za-z_:][\w:<>,~*&\s]*\s+)+([A-Za-z_][\w]*)\s*\([^;{}]*\)\s*\{/gm },
    ],
    imports: [/#include\s+[<"]([^>"]+)[>"]/g],
  },
  php: {
    symbols: [
      { kind: 'class', re: /\bclass\s+([A-Za-z_][\w]*)\b/g },
      { kind: 'interface', re: /\binterface\s+([A-Za-z_][\w]*)\b/g },
      { kind: 'function', re: /\bfunction\s+([A-Za-z_][\w]*)\s*\(/g },
    ],
    imports: [/(?:require|include)(?:_once)?\s*\(?\s*['"]([^'"]+)['"]/g],
  },
  ruby: {
    symbols: [
      { kind: 'class', re: /^class\s+([A-Za-z_][\w]*(?:::[A-Za-z_][\w]*)*)/gm },
      { kind: 'function', re: /^def\s+([A-Za-z_][\w]*[!?=]?)/gm },
    ],
    imports: [/require\s+['"]([^'"]+)['"]/g],
  },
  kotlin: {
    symbols: [
      { kind: 'class', re: /\bclass\s+([A-Za-z_][\w]*)\b/g },
      { kind: 'interface', re: /\binterface\s+([A-Za-z_][\w]*)\b/g },
      { kind: 'function', re: /\bfun\s+([A-Za-z_][\w]*)\s*\(/g },
    ],
    imports: [/import\s+([A-Za-z_][\w.]+)/g],
  },
};

function hashText(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function extension(path: string): string {
  const index = path.lastIndexOf('.');
  return index === -1 ? '' : path.slice(index);
}

function languageForPath(path: string): string {
  const ext = extension(path);
  return LANGUAGE_BY_EXTENSION.get(ext) ?? 'unknown';
}

function resolveMaxFileBytes(value: number | undefined): number {
  if (!Number.isFinite(value)) return DEFAULT_CODEGRAPH_MAX_FILE_BYTES;
  return Math.max(1, Math.floor(value!));
}

function walk(root: string, exclude: string[], maxFiles: number): string[] {
  const out: string[] = [];
  const visit = (dir: string) => {
    if (out.length >= maxFiles) return;
    let entries: Dirent<string>[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const abs = join(dir, entry.name);
      const rel = normalizeCodePath(relative(root, abs));
      if (isCodeGraphExcludedPath(rel, exclude)) continue;
      if (entry.isDirectory()) {
        if (entry.name === '.git' || entry.name === '.worktrees' || entry.name === '.tmp' || entry.name === 'node_modules') continue;
        if (rel === '.claude/worktrees' || rel.startsWith('.claude/worktrees/')) continue;
        visit(abs);
        if (out.length >= maxFiles) return;
        continue;
      }
      if (!entry.isFile()) continue;
      if (!SUPPORTED_EXTENSIONS.has(extension(entry.name))) continue;
      out.push(abs);
      if (out.length >= maxFiles) return;
    }
  };
  visit(root);
  return out;
}

function lineOf(text: string, index: number): number {
  return text.slice(0, index).split(/\r?\n/).length;
}

function extractSymbols(projectId: string, file: CodeFile, text: string, indexedAt: string): CodeSymbol[] {
  const symbols: CodeSymbol[] = [];
  const profile = file.language ? languageProfiles[file.language] : undefined;
  const patterns = profile?.symbols ?? [];

  for (const { kind, re } of patterns) {
    re.lastIndex = 0;
    for (const match of text.matchAll(re)) {
      const name = match[1];
      if (!name || name.includes('\n')) continue;
      const startLine = lineOf(text, match.index ?? 0);
      const id = makeCodeSymbolId({ projectId, path: file.path, qualifiedName: name, kind });
      symbols.push({
        id,
        projectId,
        fileId: file.id,
        path: file.path,
        name,
        qualifiedName: name,
        kind,
        startLine,
        endLine: startLine,
        signature: match[0].slice(0, 160),
        contentHash: hashText(match[0]),
        indexedAt,
      });
    }
  }
  return symbols;
}

function extractImportEdges(projectId: string, file: CodeFile, text: string, indexedAt: string): CodeEdge[] {
  const edges: CodeEdge[] = [];
  const profile = file.language ? languageProfiles[file.language] : undefined;
  const imports = profile?.imports ?? [];

  for (const re of imports) {
    re.lastIndex = 0;
    for (const match of text.matchAll(re)) {
      const target = (match[1] ?? '').trim();
      if (!target) continue;
      if (target.includes('\n')) {
        for (const line of target.split(/\r?\n/).map(item => item.trim().replace(/^"|"$/g, '')).filter(Boolean)) {
          const id = makeCodeEdgeId(projectId, file.id, 'imports', line);
          edges.push({
            id,
            projectId,
            fromFileId: file.id,
            type: 'imports',
            confidence: 0.7,
            evidence: line,
            indexedAt,
          });
        }
        continue;
      }
    const id = makeCodeEdgeId(projectId, file.id, 'imports', target);
    edges.push({
      id,
      projectId,
      fromFileId: file.id,
      type: 'imports',
      confidence: 0.7,
      evidence: target,
      indexedAt,
    });
    }
  }
  return edges;
}

function indexFileLite(
  projectId: string,
  projectRoot: string,
  abs: string,
  indexedAt: string,
  fileStat?: ReturnType<typeof statSync>,
): CodeGraphFileDelta | undefined {
  const rel = normalizeCodePath(relative(projectRoot, abs));
  try {
    const text = readFileSync(abs, 'utf-8');
    const stat = fileStat ?? statSync(abs);
    const file: CodeFile = {
      id: makeCodeFileId(projectId, rel),
      projectId,
      path: rel,
      language: languageForPath(rel),
      contentHash: hashText(text),
      mtimeMs: Math.round(Number(stat.mtimeMs)),
      sizeBytes: Number(stat.size),
      indexedAt,
    };
    return {
      file,
      symbols: extractSymbols(projectId, file, text, indexedAt),
      edges: extractImportEdges(projectId, file, text, indexedAt),
    };
  } catch {
    return undefined;
  }
}

export async function indexProjectLite(options: LiteIndexOptions): Promise<LiteIndexResult> {
  const exclude = normalizeCodeGraphExcludePatterns(options.exclude);
  const maxFiles = options.maxFiles ?? 5000;
  const maxFileBytes = resolveMaxFileBytes(options.maxFileBytes);
  const indexedAt = new Date().toISOString();
  const paths = walk(options.projectRoot, exclude, maxFiles);
  const files: CodeFile[] = [];
  const symbols: CodeSymbol[] = [];
  const edges: CodeEdge[] = [];
  let skippedOversizedFiles = 0;

  for (const abs of paths) {
    let stat: ReturnType<typeof statSync>;
    try {
      stat = statSync(abs);
    } catch {
      continue;
    }
    if (Number(stat.size) > maxFileBytes) {
      skippedOversizedFiles++;
      continue;
    }
    const delta = indexFileLite(options.projectId, options.projectRoot, abs, indexedAt, stat);
    if (!delta) continue;
    files.push(delta.file);
    symbols.push(...delta.symbols);
    edges.push(...delta.edges);
  }

  return { files, symbols, edges, skippedOversizedFiles };
}

/**
 * Refresh the Lite graph incrementally. A directory walk is still necessary to
 * discover deletes, but unchanged files are not read, hashed, or reparsed.
 */
export async function refreshProjectLite(
  store: CodeGraphStore,
  options: LiteIndexOptions,
): Promise<LiteRefreshResult> {
  const exclude = normalizeCodeGraphExcludePatterns(options.exclude);
  const maxFiles = options.maxFiles ?? 5000;
  const maxFileBytes = resolveMaxFileBytes(options.maxFileBytes);
  const indexedAt = new Date().toISOString();
  const paths = walk(options.projectRoot, exclude, maxFiles);
  const existingByPath = new Map(store.listFiles(options.projectId).map((file) => [file.path, file]));
  const changed: CodeGraphFileDelta[] = [];
  const metadataOnly: CodeFile[] = [];
  const seenPaths = new Set<string>();
  const oversizedExistingFileIds = new Set<string>();
  let unchangedFiles = 0;
  let skippedOversizedFiles = 0;

  for (const abs of paths) {
    const rel = normalizeCodePath(relative(options.projectRoot, abs));
    let stat: ReturnType<typeof statSync>;
    try {
      stat = statSync(abs);
    } catch {
      continue;
    }
    seenPaths.add(rel);
    const existing = existingByPath.get(rel);
    const roundedMtime = Math.round(Number(stat.mtimeMs));
    const sizeBytes = Number(stat.size);
    if (sizeBytes > maxFileBytes) {
      skippedOversizedFiles++;
      if (existing) oversizedExistingFileIds.add(existing.id);
      continue;
    }
    if (existing && existing.mtimeMs === roundedMtime && existing.sizeBytes === sizeBytes) {
      unchangedFiles++;
      continue;
    }

    const delta = indexFileLite(options.projectId, options.projectRoot, abs, indexedAt, stat);
    if (!delta) continue;
    if (existing?.contentHash === delta.file.contentHash) {
      metadataOnly.push(delta.file);
      unchangedFiles++;
    } else {
      changed.push(delta);
    }
  }

  // At the file cap, absence from this partial walk is not proof of deletion.
  const removalScanDeferred = paths.length >= maxFiles;
  const removedFileIds = [...new Set([
    ...oversizedExistingFileIds,
    ...(removalScanDeferred
      ? []
      : [...existingByPath.values()]
        .filter((file) => !seenPaths.has(file.path))
        .map((file) => file.id)),
  ])];
  store.applyFileDeltas(options.projectId, {
    changed,
    metadataOnly,
    removedFileIds,
  });

  return {
    scannedFiles: paths.length,
    changedFiles: changed.length,
    unchangedFiles,
    metadataOnlyFiles: metadataOnly.length,
    removedFiles: removedFileIds.length,
    indexedSymbols: changed.reduce((total, delta) => total + delta.symbols.length, 0),
    indexedEdges: changed.reduce((total, delta) => total + delta.edges.length, 0),
    skippedOversizedFiles,
    removalScanDeferred,
  };
}
