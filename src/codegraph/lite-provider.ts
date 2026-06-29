import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { CodeEdge, CodeFile, CodeSymbol } from './types.js';
import { makeCodeEdgeId, makeCodeFileId, makeCodeSymbolId, normalizeCodePath } from './ids.js';

export interface LiteIndexOptions {
  projectId: string;
  projectRoot: string;
  exclude?: string[];
  maxFiles?: number;
}

export interface LiteIndexResult {
  files: CodeFile[];
  symbols: CodeSymbol[];
  edges: CodeEdge[];
}

const SUPPORTED_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);

function hashText(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function extension(path: string): string {
  const index = path.lastIndexOf('.');
  return index === -1 ? '' : path.slice(index);
}

function languageForPath(path: string): string {
  const ext = extension(path);
  if (ext === '.ts' || ext === '.tsx') return 'typescript';
  if (ext === '.js' || ext === '.jsx' || ext === '.mjs' || ext === '.cjs') return 'javascript';
  return 'unknown';
}

function isExcluded(path: string, exclude: string[]): boolean {
  const normalized = normalizeCodePath(path);
  return exclude.some((pattern) => {
    const p = normalizeCodePath(pattern);
    if (p.endsWith('/**')) {
      const base = p.slice(0, -3);
      return normalized === base || normalized.startsWith(`${base}/`);
    }
    if (p.startsWith('**/')) return normalized.endsWith(p.slice(3));
    return normalized === p || normalized.startsWith(`${p}/`);
  });
}

function walk(root: string, exclude: string[], maxFiles: number): string[] {
  const out: string[] = [];
  const visit = (dir: string) => {
    if (out.length >= maxFiles) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const abs = join(dir, entry.name);
      const rel = normalizeCodePath(relative(root, abs));
      if (isExcluded(rel, exclude)) continue;
      if (entry.isDirectory()) {
        if (entry.name === '.git' || entry.name === 'node_modules') continue;
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
  const patterns: Array<{ kind: CodeSymbol['kind']; re: RegExp }> = [
    { kind: 'function', re: /(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\([^)]*\)/g },
    { kind: 'class', re: /(?:export\s+)?class\s+([A-Za-z_$][\w$]*)\b/g },
    { kind: 'interface', re: /(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)\b/g },
    { kind: 'type', re: /(?:export\s+)?type\s+([A-Za-z_$][\w$]*)\b/g },
    { kind: 'constant', re: /(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=/g },
  ];

  for (const { kind, re } of patterns) {
    for (const match of text.matchAll(re)) {
      const name = match[1];
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
  const importRe = /import\s+(?:[^'"]+\s+from\s+)?['"]([^'"]+)['"]/g;
  for (const match of text.matchAll(importRe)) {
    const target = match[1];
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
  return edges;
}

export async function indexProjectLite(options: LiteIndexOptions): Promise<LiteIndexResult> {
  const exclude = options.exclude ?? ['node_modules/**', 'dist/**', '.git/**'];
  const maxFiles = options.maxFiles ?? 5000;
  const indexedAt = new Date().toISOString();
  const paths = walk(options.projectRoot, exclude, maxFiles);
  const files: CodeFile[] = [];
  const symbols: CodeSymbol[] = [];
  const edges: CodeEdge[] = [];

  for (const abs of paths) {
    const rel = normalizeCodePath(relative(options.projectRoot, abs));
    const text = readFileSync(abs, 'utf-8');
    const stat = statSync(abs);
    const file: CodeFile = {
      id: makeCodeFileId(options.projectId, rel),
      projectId: options.projectId,
      path: rel,
      language: languageForPath(rel),
      contentHash: hashText(text),
      mtimeMs: Math.round(stat.mtimeMs),
      sizeBytes: stat.size,
      indexedAt,
    };
    files.push(file);
    symbols.push(...extractSymbols(options.projectId, file, text, indexedAt));
    edges.push(...extractImportEdges(options.projectId, file, text, indexedAt));
  }

  return { files, symbols, edges };
}
