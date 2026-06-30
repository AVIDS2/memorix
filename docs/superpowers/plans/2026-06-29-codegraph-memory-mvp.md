# CodeGraph Memory MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first vertical slice of CodeGraph Memory: structured code facts in SQLite, a CodeGraph Lite provider, memory-to-code references, freshness labels, and a task-ready context pack.

**Architecture:** Keep code structure separate from observation narrative. Add a focused `src/codegraph/` subsystem with small modules for types, IDs, storage, lite indexing, binding, freshness, and context-pack composition. Wire the subsystem into existing CLI/MCP surfaces only after each lower layer has unit coverage.

**Tech Stack:** TypeScript, Node.js built-ins, SQLite via existing `better-sqlite3` compatibility layer, Vitest, existing MCP SDK and citty CLI patterns. No new runtime dependency in the MVP.

---

## File Structure

- Create `src/codegraph/types.ts` — shared CodeGraph data contracts and status enums.
- Create `src/codegraph/ids.ts` — deterministic ID helpers.
- Create `src/codegraph/store.ts` — SQLite-backed store for code files, symbols, edges, and observation refs.
- Create `src/codegraph/lite-provider.ts` — dependency-free TS/JS file inventory, imports, exports, and top-level symbol extraction.
- Create `src/codegraph/freshness.ts` — status transitions for file/symbol references.
- Create `src/codegraph/binder.ts` — links observations to files and obvious symbols.
- Create `src/codegraph/context-pack.ts` — composes memory hits, code facts, freshness warnings, and suggested reads.
- Create `src/cli/commands/codegraph.ts` — `memorix codegraph status|refresh|search`.
- Create `src/cli/commands/context.ts` — `memorix context build`.
- Modify `src/store/sqlite-db.ts` — create CodeGraph tables and indexes.
- Modify `src/types.ts` — add optional `CodeRefStatus`/context-pack exported types only if needed by public API.
- Modify `src/server/tool-profile.ts` — add `memorix_context_pack` and `memorix_codegraph_status`.
- Modify `src/server.ts` — register MCP tools after context-pack module exists.
- Modify `src/cli/index.ts` — register `codegraph` and `context` commands.
- Modify `src/memory/observations.ts` — call binder after successful observation writes.
- Modify `src/compact/engine.ts` or detail formatting area in `src/server.ts` only if code refs need to appear in detail output.

Tests:

- Create `tests/codegraph/ids.test.ts`.
- Create `tests/codegraph/store.test.ts`.
- Create `tests/codegraph/lite-provider.test.ts`.
- Create `tests/codegraph/freshness.test.ts`.
- Create `tests/codegraph/binder.test.ts`.
- Create `tests/codegraph/context-pack.test.ts`.
- Create `tests/cli/codegraph-command.test.ts`.
- Create `tests/integration/codegraph-context-pack.test.ts` only after unit path is stable.

---

## Task 1: CodeGraph Types and Deterministic IDs

**Files:**
- Create: `src/codegraph/types.ts`
- Create: `src/codegraph/ids.ts`
- Test: `tests/codegraph/ids.test.ts`

- [ ] **Step 1: Write the failing ID tests**

Create `tests/codegraph/ids.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { makeCodeEdgeId, makeCodeFileId, makeCodeSymbolId } from '../../src/codegraph/ids.js';

describe('codegraph ids', () => {
  it('creates stable project-scoped file ids with normalized separators', () => {
    expect(makeCodeFileId('org/repo', 'src\\auth\\index.ts')).toBe(makeCodeFileId('org/repo', 'src/auth/index.ts'));
    expect(makeCodeFileId('org/repo', 'src/auth/index.ts')).not.toBe(makeCodeFileId('other/repo', 'src/auth/index.ts'));
    expect(makeCodeFileId('org/repo', 'src/auth/index.ts')).toMatch(/^file:[a-f0-9]{16}$/);
  });

  it('creates stable symbol ids from file path, qualified name, and kind', () => {
    const a = makeCodeSymbolId({
      projectId: 'org/repo',
      path: 'src/auth.ts',
      qualifiedName: 'authMiddleware',
      kind: 'function',
    });
    const b = makeCodeSymbolId({
      projectId: 'org/repo',
      path: 'src/auth.ts',
      qualifiedName: 'authMiddleware',
      kind: 'function',
    });
    const c = makeCodeSymbolId({
      projectId: 'org/repo',
      path: 'src/auth.ts',
      qualifiedName: 'AuthMiddleware',
      kind: 'type',
    });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/^symbol:[a-f0-9]{16}$/);
  });

  it('creates stable edge ids from endpoints and type', () => {
    expect(makeCodeEdgeId('org/repo', 'a', 'calls', 'b')).toBe(makeCodeEdgeId('org/repo', 'a', 'calls', 'b'));
    expect(makeCodeEdgeId('org/repo', 'a', 'calls', 'b')).not.toBe(makeCodeEdgeId('org/repo', 'b', 'calls', 'a'));
    expect(makeCodeEdgeId('org/repo', 'a', 'calls', 'b')).toMatch(/^edge:[a-f0-9]{16}$/);
  });
});
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
npx vitest run tests/codegraph/ids.test.ts
```

Expected: FAIL because `src/codegraph/ids.ts` does not exist.

- [ ] **Step 3: Add shared types**

Create `src/codegraph/types.ts`:

```ts
export type CodeGraphProviderKind = 'external' | 'lite';

export type CodeRefStatus = 'current' | 'suspect' | 'stale' | 'unbound';

export type CodeSymbolKind =
  | 'function'
  | 'class'
  | 'method'
  | 'interface'
  | 'type'
  | 'component'
  | 'constant'
  | 'route'
  | 'unknown';

export type CodeEdgeType =
  | 'imports'
  | 'exports'
  | 'calls'
  | 'defines'
  | 'tests'
  | 'routes_to'
  | 'references';

export interface CodeFile {
  id: string;
  projectId: string;
  path: string;
  language?: string;
  contentHash: string;
  mtimeMs?: number;
  sizeBytes?: number;
  indexedAt: string;
  gitCommit?: string;
}

export interface CodeSymbol {
  id: string;
  projectId: string;
  fileId: string;
  path: string;
  name: string;
  qualifiedName: string;
  kind: CodeSymbolKind;
  startLine?: number;
  endLine?: number;
  signature?: string;
  contentHash?: string;
  indexedAt: string;
  stale?: boolean;
}

export interface CodeEdge {
  id: string;
  projectId: string;
  fromSymbolId?: string;
  toSymbolId?: string;
  fromFileId?: string;
  toFileId?: string;
  type: CodeEdgeType;
  confidence: number;
  evidence?: string;
  indexedAt: string;
}

export interface ObservationCodeRef {
  id: string;
  projectId: string;
  observationId: number;
  fileId?: string;
  symbolId?: string;
  capturedFileHash?: string;
  capturedSymbolHash?: string;
  status: CodeRefStatus;
  reason?: string;
  createdAt: string;
  updatedAt?: string;
}

export interface CodeGraphStatus {
  provider: CodeGraphProviderKind;
  files: number;
  symbols: number;
  edges: number;
  refs: number;
  indexedAt?: string;
}
```

- [ ] **Step 4: Add deterministic ID helpers**

Create `src/codegraph/ids.ts`:

```ts
import { createHash } from 'node:crypto';

function digest(input: string): string {
  return createHash('sha256').update(input).digest('hex').slice(0, 16);
}

export function normalizeCodePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+/g, '/');
}

export function makeCodeFileId(projectId: string, path: string): string {
  return `file:${digest(`${projectId}\n${normalizeCodePath(path)}`)}`;
}

export function makeCodeSymbolId(input: {
  projectId: string;
  path: string;
  qualifiedName: string;
  kind: string;
}): string {
  return `symbol:${digest([
    input.projectId,
    normalizeCodePath(input.path),
    input.qualifiedName,
    input.kind,
  ].join('\n'))}`;
}

export function makeCodeEdgeId(projectId: string, from: string, type: string, to: string): string {
  return `edge:${digest([projectId, from, type, to].join('\n'))}`;
}

export function makeObservationCodeRefId(projectId: string, observationId: number, fileId?: string, symbolId?: string): string {
  return `coderef:${digest([projectId, String(observationId), fileId ?? '', symbolId ?? ''].join('\n'))}`;
}
```

- [ ] **Step 5: Verify the test passes**

Run:

```bash
npx vitest run tests/codegraph/ids.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/codegraph/types.ts src/codegraph/ids.ts tests/codegraph/ids.test.ts
git commit -m "feat(codegraph): add core types and stable ids"
```

---

## Task 2: SQLite Schema and CodeGraph Store

**Files:**
- Modify: `src/store/sqlite-db.ts`
- Create: `src/codegraph/store.ts`
- Test: `tests/codegraph/store.test.ts`

- [ ] **Step 1: Write store tests**

Create `tests/codegraph/store.test.ts`:

```ts
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { closeAllDatabases } from '../../src/store/sqlite-db.js';
import { CodeGraphStore } from '../../src/codegraph/store.js';

let dir: string | null = null;

function tempDir(): string {
  dir = mkdtempSync(join(tmpdir(), 'memorix-codegraph-store-'));
  return dir;
}

afterEach(() => {
  closeAllDatabases();
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = null;
});

describe('CodeGraphStore', () => {
  it('upserts files, symbols, edges, and refs', async () => {
    const store = new CodeGraphStore();
    await store.init(tempDir());

    await store.upsertFiles([{
      id: 'file:a',
      projectId: 'org/repo',
      path: 'src/auth.ts',
      language: 'typescript',
      contentHash: 'hash-a',
      indexedAt: '2026-06-29T00:00:00.000Z',
    }]);
    await store.upsertSymbols([{
      id: 'symbol:a',
      projectId: 'org/repo',
      fileId: 'file:a',
      path: 'src/auth.ts',
      name: 'authMiddleware',
      qualifiedName: 'authMiddleware',
      kind: 'function',
      startLine: 1,
      endLine: 3,
      contentHash: 'sym-a',
      indexedAt: '2026-06-29T00:00:00.000Z',
    }]);
    await store.upsertEdges([{
      id: 'edge:a',
      projectId: 'org/repo',
      fromFileId: 'file:a',
      toFileId: 'file:a',
      type: 'references',
      confidence: 1,
      indexedAt: '2026-06-29T00:00:00.000Z',
    }]);
    await store.upsertObservationRefs([{
      id: 'coderef:a',
      projectId: 'org/repo',
      observationId: 42,
      fileId: 'file:a',
      symbolId: 'symbol:a',
      capturedFileHash: 'hash-a',
      capturedSymbolHash: 'sym-a',
      status: 'current',
      createdAt: '2026-06-29T00:00:00.000Z',
    }]);

    expect(store.listFiles('org/repo')).toHaveLength(1);
    expect(store.findSymbols('org/repo', 'auth')).toHaveLength(1);
    expect(store.listEdges('org/repo')).toHaveLength(1);
    expect(store.listObservationRefs('org/repo', 42)).toHaveLength(1);
    expect(store.status('org/repo')).toMatchObject({ files: 1, symbols: 1, edges: 1, refs: 1 });
  });

  it('replaces file and symbol rows by id', async () => {
    const store = new CodeGraphStore();
    await store.init(tempDir());

    await store.upsertFiles([
      { id: 'file:a', projectId: 'org/repo', path: 'src/a.ts', contentHash: 'old', indexedAt: '2026-06-29T00:00:00.000Z' },
      { id: 'file:a', projectId: 'org/repo', path: 'src/a.ts', contentHash: 'new', indexedAt: '2026-06-29T00:01:00.000Z' },
    ]);

    expect(store.getFile('org/repo', 'src/a.ts')?.contentHash).toBe('new');
  });
});
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
npx vitest run tests/codegraph/store.test.ts
```

Expected: FAIL because tables/store do not exist.

- [ ] **Step 3: Add schema DDL to `src/store/sqlite-db.ts`**

Add table DDL constants near the existing graph table constants:

```ts
const CREATE_CODE_FILES_TABLE = `
CREATE TABLE IF NOT EXISTS code_files (
  id              TEXT PRIMARY KEY,
  projectId       TEXT NOT NULL,
  path            TEXT NOT NULL,
  language        TEXT,
  contentHash     TEXT NOT NULL,
  mtimeMs         INTEGER,
  sizeBytes       INTEGER,
  indexedAt       TEXT NOT NULL,
  gitCommit       TEXT,
  UNIQUE(projectId, path)
);
`;

const CREATE_CODE_SYMBOLS_TABLE = `
CREATE TABLE IF NOT EXISTS code_symbols (
  id              TEXT PRIMARY KEY,
  projectId       TEXT NOT NULL,
  fileId          TEXT NOT NULL,
  path            TEXT NOT NULL,
  name            TEXT NOT NULL,
  qualifiedName   TEXT NOT NULL,
  kind            TEXT NOT NULL,
  startLine       INTEGER,
  endLine         INTEGER,
  signature       TEXT,
  contentHash     TEXT,
  indexedAt       TEXT NOT NULL,
  stale           INTEGER NOT NULL DEFAULT 0,
  UNIQUE(projectId, fileId, qualifiedName, kind)
);
`;

const CREATE_CODE_EDGES_TABLE = `
CREATE TABLE IF NOT EXISTS code_edges (
  id              TEXT PRIMARY KEY,
  projectId       TEXT NOT NULL,
  fromSymbolId    TEXT,
  toSymbolId      TEXT,
  fromFileId      TEXT,
  toFileId        TEXT,
  type            TEXT NOT NULL,
  confidence      REAL NOT NULL DEFAULT 1.0,
  evidence        TEXT,
  indexedAt       TEXT NOT NULL
);
`;

const CREATE_OBSERVATION_CODE_REFS_TABLE = `
CREATE TABLE IF NOT EXISTS observation_code_refs (
  id                 TEXT PRIMARY KEY,
  projectId          TEXT NOT NULL,
  observationId      INTEGER NOT NULL,
  fileId             TEXT,
  symbolId           TEXT,
  capturedFileHash   TEXT,
  capturedSymbolHash TEXT,
  status             TEXT NOT NULL,
  reason             TEXT,
  createdAt          TEXT NOT NULL,
  updatedAt          TEXT
);
`;
```

Execute them in `getDatabase()` after graph tables:

```ts
db.exec(CREATE_CODE_FILES_TABLE);
db.exec(CREATE_CODE_SYMBOLS_TABLE);
db.exec(CREATE_CODE_EDGES_TABLE);
db.exec(CREATE_OBSERVATION_CODE_REFS_TABLE);
```

Add indexes to `CREATE_INDEXES`:

```sql
CREATE INDEX IF NOT EXISTS idx_code_files_project ON code_files(projectId);
CREATE INDEX IF NOT EXISTS idx_code_symbols_project_name ON code_symbols(projectId, name);
CREATE INDEX IF NOT EXISTS idx_code_symbols_file ON code_symbols(fileId);
CREATE INDEX IF NOT EXISTS idx_code_edges_project ON code_edges(projectId, type);
CREATE INDEX IF NOT EXISTS idx_observation_code_refs_obs ON observation_code_refs(projectId, observationId);
CREATE INDEX IF NOT EXISTS idx_observation_code_refs_status ON observation_code_refs(projectId, status);
```

- [ ] **Step 4: Implement `CodeGraphStore`**

Create `src/codegraph/store.ts`:

```ts
import { getDatabase } from '../store/sqlite-db.js';
import type { CodeEdge, CodeFile, CodeGraphStatus, CodeSymbol, ObservationCodeRef } from './types.js';
import { normalizeCodePath } from './ids.js';

function rowToFile(row: any): CodeFile {
  return {
    id: row.id,
    projectId: row.projectId,
    path: row.path,
    ...(row.language ? { language: row.language } : {}),
    contentHash: row.contentHash,
    ...(row.mtimeMs != null ? { mtimeMs: row.mtimeMs } : {}),
    ...(row.sizeBytes != null ? { sizeBytes: row.sizeBytes } : {}),
    indexedAt: row.indexedAt,
    ...(row.gitCommit ? { gitCommit: row.gitCommit } : {}),
  };
}

function rowToSymbol(row: any): CodeSymbol {
  return {
    id: row.id,
    projectId: row.projectId,
    fileId: row.fileId,
    path: row.path,
    name: row.name,
    qualifiedName: row.qualifiedName,
    kind: row.kind,
    ...(row.startLine != null ? { startLine: row.startLine } : {}),
    ...(row.endLine != null ? { endLine: row.endLine } : {}),
    ...(row.signature ? { signature: row.signature } : {}),
    ...(row.contentHash ? { contentHash: row.contentHash } : {}),
    indexedAt: row.indexedAt,
    stale: !!row.stale,
  } as CodeSymbol;
}

function rowToEdge(row: any): CodeEdge {
  return {
    id: row.id,
    projectId: row.projectId,
    ...(row.fromSymbolId ? { fromSymbolId: row.fromSymbolId } : {}),
    ...(row.toSymbolId ? { toSymbolId: row.toSymbolId } : {}),
    ...(row.fromFileId ? { fromFileId: row.fromFileId } : {}),
    ...(row.toFileId ? { toFileId: row.toFileId } : {}),
    type: row.type,
    confidence: row.confidence,
    ...(row.evidence ? { evidence: row.evidence } : {}),
    indexedAt: row.indexedAt,
  } as CodeEdge;
}

function rowToRef(row: any): ObservationCodeRef {
  return {
    id: row.id,
    projectId: row.projectId,
    observationId: row.observationId,
    ...(row.fileId ? { fileId: row.fileId } : {}),
    ...(row.symbolId ? { symbolId: row.symbolId } : {}),
    ...(row.capturedFileHash ? { capturedFileHash: row.capturedFileHash } : {}),
    ...(row.capturedSymbolHash ? { capturedSymbolHash: row.capturedSymbolHash } : {}),
    status: row.status,
    ...(row.reason ? { reason: row.reason } : {}),
    createdAt: row.createdAt,
    ...(row.updatedAt ? { updatedAt: row.updatedAt } : {}),
  } as ObservationCodeRef;
}

export class CodeGraphStore {
  private db: any = null;

  async init(dataDir: string): Promise<void> {
    this.db = getDatabase(dataDir);
  }

  upsertFiles(files: CodeFile[]): void {
    if (files.length === 0) return;
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO code_files
        (id, projectId, path, language, contentHash, mtimeMs, sizeBytes, indexedAt, gitCommit)
      VALUES
        (@id, @projectId, @path, @language, @contentHash, @mtimeMs, @sizeBytes, @indexedAt, @gitCommit)
    `);
    const tx = this.db.transaction((items: CodeFile[]) => {
      for (const file of items) stmt.run({ ...file, path: normalizeCodePath(file.path) });
    });
    tx(files);
  }

  upsertSymbols(symbols: CodeSymbol[]): void {
    if (symbols.length === 0) return;
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO code_symbols
        (id, projectId, fileId, path, name, qualifiedName, kind, startLine, endLine, signature, contentHash, indexedAt, stale)
      VALUES
        (@id, @projectId, @fileId, @path, @name, @qualifiedName, @kind, @startLine, @endLine, @signature, @contentHash, @indexedAt, @stale)
    `);
    const tx = this.db.transaction((items: CodeSymbol[]) => {
      for (const symbol of items) stmt.run({ ...symbol, path: normalizeCodePath(symbol.path), stale: symbol.stale ? 1 : 0 });
    });
    tx(symbols);
  }

  upsertEdges(edges: CodeEdge[]): void {
    if (edges.length === 0) return;
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO code_edges
        (id, projectId, fromSymbolId, toSymbolId, fromFileId, toFileId, type, confidence, evidence, indexedAt)
      VALUES
        (@id, @projectId, @fromSymbolId, @toSymbolId, @fromFileId, @toFileId, @type, @confidence, @evidence, @indexedAt)
    `);
    const tx = this.db.transaction((items: CodeEdge[]) => {
      for (const edge of items) stmt.run(edge);
    });
    tx(edges);
  }

  upsertObservationRefs(refs: ObservationCodeRef[]): void {
    if (refs.length === 0) return;
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO observation_code_refs
        (id, projectId, observationId, fileId, symbolId, capturedFileHash, capturedSymbolHash, status, reason, createdAt, updatedAt)
      VALUES
        (@id, @projectId, @observationId, @fileId, @symbolId, @capturedFileHash, @capturedSymbolHash, @status, @reason, @createdAt, @updatedAt)
    `);
    const tx = this.db.transaction((items: ObservationCodeRef[]) => {
      for (const ref of items) stmt.run(ref);
    });
    tx(refs);
  }

  getFile(projectId: string, path: string): CodeFile | null {
    const row = this.db.prepare(`SELECT * FROM code_files WHERE projectId = ? AND path = ?`).get(projectId, normalizeCodePath(path));
    return row ? rowToFile(row) : null;
  }

  listFiles(projectId: string): CodeFile[] {
    return this.db.prepare(`SELECT * FROM code_files WHERE projectId = ? ORDER BY path`).all(projectId).map(rowToFile);
  }

  findSymbols(projectId: string, query: string, limit = 20): CodeSymbol[] {
    const like = `%${query.trim()}%`;
    return this.db.prepare(`
      SELECT * FROM code_symbols
      WHERE projectId = ? AND stale = 0 AND (name LIKE ? OR qualifiedName LIKE ? OR path LIKE ?)
      ORDER BY path, startLine
      LIMIT ?
    `).all(projectId, like, like, like, limit).map(rowToSymbol);
  }

  listSymbolsForFile(fileId: string): CodeSymbol[] {
    return this.db.prepare(`SELECT * FROM code_symbols WHERE fileId = ? AND stale = 0 ORDER BY startLine`).all(fileId).map(rowToSymbol);
  }

  listEdges(projectId: string): CodeEdge[] {
    return this.db.prepare(`SELECT * FROM code_edges WHERE projectId = ? ORDER BY type, id`).all(projectId).map(rowToEdge);
  }

  listObservationRefs(projectId: string, observationId: number): ObservationCodeRef[] {
    return this.db.prepare(`
      SELECT * FROM observation_code_refs
      WHERE projectId = ? AND observationId = ?
      ORDER BY status, id
    `).all(projectId, observationId).map(rowToRef);
  }

  status(projectId: string): CodeGraphStatus {
    const files = this.db.prepare(`SELECT COUNT(*) AS count FROM code_files WHERE projectId = ?`).get(projectId).count;
    const symbols = this.db.prepare(`SELECT COUNT(*) AS count FROM code_symbols WHERE projectId = ? AND stale = 0`).get(projectId).count;
    const edges = this.db.prepare(`SELECT COUNT(*) AS count FROM code_edges WHERE projectId = ?`).get(projectId).count;
    const refs = this.db.prepare(`SELECT COUNT(*) AS count FROM observation_code_refs WHERE projectId = ?`).get(projectId).count;
    const latest = this.db.prepare(`SELECT MAX(indexedAt) AS indexedAt FROM code_files WHERE projectId = ?`).get(projectId);
    return { provider: 'lite', files, symbols, edges, refs, ...(latest?.indexedAt ? { indexedAt: latest.indexedAt } : {}) };
  }
}
```

- [ ] **Step 5: Verify store tests pass**

Run:

```bash
npx vitest run tests/codegraph/store.test.ts
```

Expected: PASS.

- [ ] **Step 6: Run existing SQLite tests**

Run:

```bash
npx vitest run tests/store/sqlite-store.test.ts tests/store/sqlite-loader.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/store/sqlite-db.ts src/codegraph/store.ts tests/codegraph/store.test.ts
git commit -m "feat(codegraph): add sqlite-backed codegraph store"
```

---

## Task 3: CodeGraph Lite Provider

**Files:**
- Create: `src/codegraph/lite-provider.ts`
- Test: `tests/codegraph/lite-provider.test.ts`

- [ ] **Step 1: Write Lite provider tests**

Create `tests/codegraph/lite-provider.test.ts`:

```ts
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { indexProjectLite } from '../../src/codegraph/lite-provider.js';

let root: string | null = null;

function makeRoot(): string {
  root = join(tmpdir(), `memorix-lite-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(root, { recursive: true });
  return root;
}

afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
  root = null;
});

describe('CodeGraph Lite provider', () => {
  it('indexes TS files, imports, exports, and top-level symbols', async () => {
    const dir = makeRoot();
    mkdirSync(join(dir, 'src'), { recursive: true });
    writeFileSync(join(dir, 'src', 'auth.ts'), [
      "import { verifyJwt } from './jwt';",
      'export function authMiddleware(req: Request) {',
      '  return verifyJwt(req);',
      '}',
      'export class AuthService {}',
      'export type AuthResult = { ok: boolean };',
    ].join('\n'));
    writeFileSync(join(dir, 'src', 'jwt.ts'), 'export const verifyJwt = () => true;\n');
    mkdirSync(join(dir, 'dist'), { recursive: true });
    writeFileSync(join(dir, 'dist', 'ignored.ts'), 'export function ignored() {}\n');

    const result = await indexProjectLite({ projectId: 'org/repo', projectRoot: dir, exclude: ['dist/**'] });

    expect(result.files.map((f) => f.path).sort()).toEqual(['src/auth.ts', 'src/jwt.ts']);
    expect(result.symbols.map((s) => s.name)).toEqual(expect.arrayContaining(['authMiddleware', 'AuthService', 'AuthResult', 'verifyJwt']));
    expect(result.edges.some((e) => e.type === 'imports' && e.evidence?.includes('./jwt'))).toBe(true);
  });
});
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
npx vitest run tests/codegraph/lite-provider.test.ts
```

Expected: FAIL because the provider does not exist.

- [ ] **Step 3: Implement dependency-free Lite provider**

Create `src/codegraph/lite-provider.ts` with:

```ts
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

function isExcluded(path: string, exclude: string[]): boolean {
  const normalized = normalizeCodePath(path);
  return exclude.some((pattern) => {
    const p = normalizeCodePath(pattern);
    if (p.endsWith('/**')) return normalized === p.slice(0, -3) || normalized.startsWith(p.slice(0, -2));
    if (p.startsWith('**/')) return normalized.endsWith(p.slice(3));
    return normalized === p || normalized.startsWith(`${p}/`);
  });
}

function walk(root: string, exclude: string[], maxFiles: number): string[] {
  const out: string[] = [];
  const visit = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const abs = join(dir, entry.name);
      const rel = normalizeCodePath(relative(root, abs));
      if (isExcluded(rel, exclude)) continue;
      if (entry.isDirectory()) {
        if (entry.name === '.git' || entry.name === 'node_modules') continue;
        visit(abs);
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
      language: 'typescript',
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
```

- [ ] **Step 4: Verify Lite provider tests pass**

Run:

```bash
npx vitest run tests/codegraph/lite-provider.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/codegraph/lite-provider.ts tests/codegraph/lite-provider.test.ts
git commit -m "feat(codegraph): add lite project indexer"
```

---

## Task 4: Freshness Checker

**Files:**
- Create: `src/codegraph/freshness.ts`
- Test: `tests/codegraph/freshness.test.ts`

- [ ] **Step 1: Write freshness tests**

Create `tests/codegraph/freshness.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { evaluateCodeRefFreshness } from '../../src/codegraph/freshness.js';

describe('evaluateCodeRefFreshness', () => {
  it('returns current when captured hashes still match', () => {
    expect(evaluateCodeRefFreshness({
      ref: { status: 'current', capturedFileHash: 'a', capturedSymbolHash: 'b' },
      file: { contentHash: 'a' },
      symbol: { contentHash: 'b' },
    })).toEqual({ status: 'current', reason: 'file and symbol hashes still match' });
  });

  it('returns suspect when file changed but symbol still exists', () => {
    expect(evaluateCodeRefFreshness({
      ref: { status: 'current', capturedFileHash: 'old' },
      file: { contentHash: 'new' },
      symbol: { contentHash: 'same' },
    }).status).toBe('suspect');
  });

  it('returns stale when file or symbol is missing', () => {
    expect(evaluateCodeRefFreshness({ ref: { status: 'current', capturedFileHash: 'a' }, file: null, symbol: null }).status).toBe('stale');
    expect(evaluateCodeRefFreshness({ ref: { status: 'current', capturedFileHash: 'a', capturedSymbolHash: 'b' }, file: { contentHash: 'a' }, symbol: null }).status).toBe('stale');
  });
});
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
npx vitest run tests/codegraph/freshness.test.ts
```

Expected: FAIL because `freshness.ts` does not exist.

- [ ] **Step 3: Implement freshness logic**

Create `src/codegraph/freshness.ts`:

```ts
import type { CodeRefStatus } from './types.js';

export function evaluateCodeRefFreshness(input: {
  ref: { capturedFileHash?: string; capturedSymbolHash?: string; status?: CodeRefStatus };
  file: { contentHash?: string } | null;
  symbol?: { contentHash?: string } | null;
}): { status: CodeRefStatus; reason: string } {
  if (!input.file) {
    return { status: 'stale', reason: 'referenced file no longer exists' };
  }
  if (input.ref.capturedSymbolHash && !input.symbol) {
    return { status: 'stale', reason: 'referenced symbol no longer exists' };
  }
  if (input.ref.capturedSymbolHash && input.symbol?.contentHash === input.ref.capturedSymbolHash) {
    if (!input.ref.capturedFileHash || input.file.contentHash === input.ref.capturedFileHash) {
      return { status: 'current', reason: 'file and symbol hashes still match' };
    }
    return { status: 'current', reason: 'symbol hash still matches after file changed' };
  }
  if (input.ref.capturedFileHash && input.file.contentHash !== input.ref.capturedFileHash) {
    return { status: 'suspect', reason: 'referenced file changed since memory capture' };
  }
  return { status: 'current', reason: 'referenced file hash still matches' };
}
```

- [ ] **Step 4: Verify freshness tests pass**

Run:

```bash
npx vitest run tests/codegraph/freshness.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/codegraph/freshness.ts tests/codegraph/freshness.test.ts
git commit -m "feat(codegraph): add code ref freshness evaluation"
```

---

## Task 5: Observation Code Reference Binder

**Files:**
- Create: `src/codegraph/binder.ts`
- Test: `tests/codegraph/binder.test.ts`

- [ ] **Step 1: Write binder tests**

Create `tests/codegraph/binder.test.ts`:

```ts
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CodeGraphStore } from '../../src/codegraph/store.js';
import { bindObservationToCode } from '../../src/codegraph/binder.js';
import { closeAllDatabases } from '../../src/store/sqlite-db.js';

let dir: string | null = null;

function tempDir(): string {
  dir = mkdtempSync(join(tmpdir(), 'memorix-codegraph-binder-'));
  return dir;
}

afterEach(() => {
  closeAllDatabases();
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = null;
});

describe('bindObservationToCode', () => {
  it('binds observation files and exact symbols in those files', async () => {
    const store = new CodeGraphStore();
    await store.init(tempDir());
    await store.upsertFiles([{ id: 'file:a', projectId: 'org/repo', path: 'src/auth.ts', contentHash: 'filehash', indexedAt: '2026-06-29T00:00:00.000Z' }]);
    await store.upsertSymbols([{ id: 'symbol:a', projectId: 'org/repo', fileId: 'file:a', path: 'src/auth.ts', name: 'authMiddleware', qualifiedName: 'authMiddleware', kind: 'function', contentHash: 'symhash', indexedAt: '2026-06-29T00:00:00.000Z' }]);

    const refs = await bindObservationToCode(store, {
      id: 7,
      projectId: 'org/repo',
      title: 'authMiddleware decision',
      narrative: 'Use authMiddleware for API routes',
      facts: [],
      filesModified: ['src/auth.ts'],
    });

    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({
      observationId: 7,
      fileId: 'file:a',
      symbolId: 'symbol:a',
      capturedFileHash: 'filehash',
      capturedSymbolHash: 'symhash',
      status: 'current',
    });
  });
});
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
npx vitest run tests/codegraph/binder.test.ts
```

Expected: FAIL because binder does not exist.

- [ ] **Step 3: Implement binder**

Create `src/codegraph/binder.ts`:

```ts
import type { ObservationCodeRef } from './types.js';
import type { CodeGraphStore } from './store.js';
import { makeObservationCodeRefId, normalizeCodePath } from './ids.js';

export interface BindableObservation {
  id: number;
  projectId: string;
  title: string;
  narrative: string;
  facts?: string[];
  filesModified?: string[];
}

function textTokens(obs: BindableObservation): Set<string> {
  const text = [obs.title, obs.narrative, ...(obs.facts ?? [])].join(' ');
  return new Set((text.match(/[A-Za-z_$][\w$]*/g) ?? []).map((token) => token.toLowerCase()));
}

export async function bindObservationToCode(store: CodeGraphStore, obs: BindableObservation): Promise<ObservationCodeRef[]> {
  const now = new Date().toISOString();
  const tokens = textTokens(obs);
  const refs: ObservationCodeRef[] = [];

  for (const rawFile of obs.filesModified ?? []) {
    const file = store.getFile(obs.projectId, normalizeCodePath(rawFile));
    if (!file) continue;
    const symbols = store.listSymbolsForFile(file.id);
    const symbol = symbols.find((candidate) => tokens.has(candidate.name.toLowerCase()));
    const ref: ObservationCodeRef = {
      id: makeObservationCodeRefId(obs.projectId, obs.id, file.id, symbol?.id),
      projectId: obs.projectId,
      observationId: obs.id,
      fileId: file.id,
      ...(symbol ? { symbolId: symbol.id } : {}),
      capturedFileHash: file.contentHash,
      ...(symbol?.contentHash ? { capturedSymbolHash: symbol.contentHash } : {}),
      status: 'current',
      reason: symbol ? 'matched file path and symbol name' : 'matched file path',
      createdAt: now,
    };
    refs.push(ref);
  }

  store.upsertObservationRefs(refs);
  return refs;
}
```

- [ ] **Step 4: Verify binder tests pass**

Run:

```bash
npx vitest run tests/codegraph/binder.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/codegraph/binder.ts tests/codegraph/binder.test.ts
git commit -m "feat(codegraph): bind observations to code refs"
```

---

## Task 6: Context Pack Builder MVP

**Files:**
- Create: `src/codegraph/context-pack.ts`
- Test: `tests/codegraph/context-pack.test.ts`

- [ ] **Step 1: Write context pack tests**

Create `tests/codegraph/context-pack.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { buildContextPackPrompt } from '../../src/codegraph/context-pack.js';

describe('buildContextPackPrompt', () => {
  it('renders memories, code facts, freshness warnings, reads, and verification', () => {
    const text = buildContextPackPrompt({
      task: 'continue auth bug',
      memories: [{ id: 1, title: 'Use jose for auth', type: 'decision', status: 'current', reason: 'matched authMiddleware' }],
      codeFacts: [{ path: 'src/auth.ts', symbol: 'authMiddleware', kind: 'function', line: 3 }],
      warnings: [{ id: 2, title: 'Old auth file', status: 'stale', reason: 'referenced file no longer exists' }],
      suggestedReads: ['src/auth.ts', 'tests/auth.test.ts'],
      suggestedVerification: ['npm test -- auth'],
    });

    expect(text).toContain('## Task');
    expect(text).toContain('#1 current: [decision] Use jose for auth');
    expect(text).toContain('authMiddleware');
    expect(text).toContain('#2 stale: Old auth file');
    expect(text).toContain('src/auth.ts');
    expect(text).toContain('npm test -- auth');
  });
});
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
npx vitest run tests/codegraph/context-pack.test.ts
```

Expected: FAIL because context-pack module does not exist.

- [ ] **Step 3: Implement prompt renderer**

Create `src/codegraph/context-pack.ts`:

```ts
import type { CodeRefStatus } from './types.js';

export interface ContextPackMemory {
  id: number;
  title: string;
  type: string;
  status: CodeRefStatus | 'unbound';
  reason: string;
}

export interface ContextPackCodeFact {
  path: string;
  symbol?: string;
  kind?: string;
  line?: number;
}

export interface ContextPackWarning {
  id: number;
  title: string;
  status: CodeRefStatus;
  reason: string;
}

export interface ContextPack {
  task: string;
  memories: ContextPackMemory[];
  codeFacts: ContextPackCodeFact[];
  warnings: ContextPackWarning[];
  suggestedReads: string[];
  suggestedVerification: string[];
}

export function buildContextPackPrompt(pack: ContextPack): string {
  const lines: string[] = ['## Task', pack.task, '', '## Relevant Memories'];
  if (pack.memories.length === 0) lines.push('- none');
  for (const memory of pack.memories) {
    lines.push(`- #${memory.id} ${memory.status}: [${memory.type}] ${memory.title} (${memory.reason})`);
  }

  lines.push('', '## Current Code Facts');
  if (pack.codeFacts.length === 0) lines.push('- none');
  for (const fact of pack.codeFacts) {
    const location = fact.line ? `${fact.path}:${fact.line}` : fact.path;
    const symbol = fact.symbol ? ` ${fact.symbol}${fact.kind ? ` (${fact.kind})` : ''}` : '';
    lines.push(`- ${location}${symbol}`);
  }

  lines.push('', '## Freshness Warnings');
  if (pack.warnings.length === 0) lines.push('- none');
  for (const warning of pack.warnings) {
    lines.push(`- #${warning.id} ${warning.status}: ${warning.title} (${warning.reason})`);
  }

  lines.push('', '## Suggested Next Reads');
  if (pack.suggestedReads.length === 0) lines.push('- none');
  pack.suggestedReads.forEach((path, index) => lines.push(`${index + 1}. ${path}`));

  lines.push('', '## Suggested Verification');
  if (pack.suggestedVerification.length === 0) lines.push('- none');
  for (const command of pack.suggestedVerification) lines.push(`- ${command}`);

  return lines.join('\n');
}
```

- [ ] **Step 4: Verify context pack test passes**

Run:

```bash
npx vitest run tests/codegraph/context-pack.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/codegraph/context-pack.ts tests/codegraph/context-pack.test.ts
git commit -m "feat(codegraph): render task context packs"
```

---

## Task 7: CLI Surface for CodeGraph Status and Refresh

**Files:**
- Create: `src/cli/commands/codegraph.ts`
- Modify: `src/cli/index.ts`
- Test: `tests/cli/codegraph-command.test.ts`

- [ ] **Step 1: Write CLI command test**

Create `tests/cli/codegraph-command.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import command from '../../src/cli/commands/codegraph.js';

describe('codegraph CLI command', () => {
  it('exports a citty command with status and refresh subcommands', () => {
    expect(command.meta?.name).toBe('codegraph');
    expect(command.subCommands?.status).toBeTypeOf('function');
    expect(command.subCommands?.refresh).toBeTypeOf('function');
  });
});
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
npx vitest run tests/cli/codegraph-command.test.ts
```

Expected: FAIL because command does not exist.

- [ ] **Step 3: Add CLI command**

Create `src/cli/commands/codegraph.ts`:

```ts
import { defineCommand } from 'citty';

async function resolveProject() {
  const { detectProject } = await import('../../project/detector.js');
  const project = detectProject(process.cwd());
  if (!project) throw new Error('No git project detected. Run inside a git repository.');
  const { getProjectDataDir } = await import('../../store/persistence.js');
  return { project, dataDir: await getProjectDataDir(project.id) };
}

export default defineCommand({
  meta: {
    name: 'codegraph',
    description: 'Inspect and refresh Memorix CodeGraph Memory',
  },
  subCommands: {
    status: () => Promise.resolve(defineCommand({
      meta: { name: 'status', description: 'Show CodeGraph Memory status' },
      run: async () => {
        const { project, dataDir } = await resolveProject();
        const { CodeGraphStore } = await import('../../codegraph/store.js');
        const store = new CodeGraphStore();
        await store.init(dataDir);
        const status = store.status(project.id);
        console.log(`Provider: ${status.provider}`);
        console.log(`Files: ${status.files}`);
        console.log(`Symbols: ${status.symbols}`);
        console.log(`Edges: ${status.edges}`);
        console.log(`Refs: ${status.refs}`);
      },
    })),
    refresh: () => Promise.resolve(defineCommand({
      meta: { name: 'refresh', description: 'Refresh CodeGraph Lite index' },
      run: async () => {
        const { project, dataDir } = await resolveProject();
        const { CodeGraphStore } = await import('../../codegraph/store.js');
        const { indexProjectLite } = await import('../../codegraph/lite-provider.js');
        const store = new CodeGraphStore();
        await store.init(dataDir);
        const result = await indexProjectLite({ projectId: project.id, projectRoot: project.rootPath });
        store.upsertFiles(result.files);
        store.upsertSymbols(result.symbols);
        store.upsertEdges(result.edges);
        console.log(`Indexed ${result.files.length} files, ${result.symbols.length} symbols, ${result.edges.length} edges.`);
      },
    })),
  },
});
```

- [ ] **Step 4: Register command in `src/cli/index.ts`**

Add to `subCommands`:

```ts
codegraph: () => import('./commands/codegraph.js').then(m => m.default),
```

Add to help command list if needed:

```ts
console.error('  codegraph  Inspect and refresh CodeGraph Memory');
```

- [ ] **Step 5: Verify CLI test passes**

Run:

```bash
npx vitest run tests/cli/codegraph-command.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/cli/commands/codegraph.ts src/cli/index.ts tests/cli/codegraph-command.test.ts
git commit -m "feat(cli): add codegraph status and refresh commands"
```

---

## Task 8: MCP Context Pack Tool

**Files:**
- Modify: `src/server/tool-profile.ts`
- Modify: `src/server.ts`
- Test: `tests/server/context-pack-tool-profile.test.ts`

- [ ] **Step 1: Write tool profile test**

Create `tests/server/context-pack-tool-profile.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { isToolInProfile } from '../../src/server/tool-profile.js';

describe('context pack tool profile', () => {
  it('exposes context pack and codegraph status in lite/team/full profiles', () => {
    for (const profile of ['lite', 'team', 'full'] as const) {
      expect(isToolInProfile('memorix_context_pack', profile)).toBe(true);
      expect(isToolInProfile('memorix_codegraph_status', profile)).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run failing test**

Run:

```bash
npx vitest run tests/server/context-pack-tool-profile.test.ts
```

Expected: FAIL until tool profile entries are added.

- [ ] **Step 3: Add profile entries**

Modify `src/server/tool-profile.ts` in the lite block:

```ts
memorix_context_pack:      ['lite', 'team', 'full'],
memorix_codegraph_status:  ['lite', 'team', 'full'],
```

- [ ] **Step 4: Register minimal MCP tools in `src/server.ts`**

Add two guarded registrations near `memorix_graph_context`:

```ts
if (isToolInProfile('memorix_codegraph_status', toolProfile)) {
  server.registerTool(
    'memorix_codegraph_status',
    {
      description: 'Show CodeGraph Memory provider and index status for the current project.',
      inputSchema: {},
    },
    async () => {
      const { CodeGraphStore } = await import('./codegraph/store.js');
      const store = new CodeGraphStore();
      await store.init(await getProjectDataDir(project.id));
      const status = store.status(project.id);
      return { content: [{ type: 'text' as const, text: JSON.stringify(status, null, 2) }] };
    },
  );
}

if (isToolInProfile('memorix_context_pack', toolProfile)) {
  server.registerTool(
    'memorix_context_pack',
    {
      description: 'Build a prompt-ready working context pack for a coding task. Returns relevant memories, code facts, freshness warnings, suggested reads, and verification hints.',
      inputSchema: {
        task: z.string().describe('Current coding task or question'),
      },
    },
    async ({ task }) => {
      const { buildContextPackPrompt } = await import('./codegraph/context-pack.js');
      const observations = await withFreshIndex(() => getProjectObservations(project.id));
      const memories = observations.slice(0, 5).map((obs) => ({
        id: obs.id,
        title: obs.title,
        type: obs.type,
        status: 'unbound' as const,
        reason: 'memory search integration pending',
      }));
      const text = buildContextPackPrompt({
        task,
        memories,
        codeFacts: [],
        warnings: [],
        suggestedReads: [],
        suggestedVerification: [],
      });
      return { content: [{ type: 'text' as const, text }] };
    },
  );
}
```

If `getProjectObservations` is not imported in `src/server.ts`, add it to the existing observations import.

- [ ] **Step 5: Verify tests**

Run:

```bash
npx vitest run tests/server/context-pack-tool-profile.test.ts
npx tsc --noEmit
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/server/tool-profile.ts src/server.ts tests/server/context-pack-tool-profile.test.ts
git commit -m "feat(mcp): expose context pack tools"
```

---

## Task 9: Integrate Binder After Observation Writes

**Files:**
- Modify: `src/memory/observations.ts`
- Test: `tests/integration/codegraph-context-pack.test.ts`

- [ ] **Step 1: Write integration test**

Create `tests/integration/codegraph-context-pack.test.ts` with a focused store-level flow:

```ts
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CodeGraphStore } from '../../src/codegraph/store.js';
import { closeAllDatabases } from '../../src/store/sqlite-db.js';
import { initObservationStore } from '../../src/store/obs-store.js';
import { initObservations, storeObservation } from '../../src/memory/observations.js';

let dir: string | null = null;

function tempDir(): string {
  dir = mkdtempSync(join(tmpdir(), 'memorix-codegraph-integration-'));
  return dir;
}

afterEach(() => {
  closeAllDatabases();
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = null;
});

describe('observation code refs integration', () => {
  it('stores code refs after an observation references an indexed file', async () => {
    const dataDir = tempDir();
    await initObservationStore(dataDir);
    await initObservations(dataDir);
    const codeStore = new CodeGraphStore();
    await codeStore.init(dataDir);
    await codeStore.upsertFiles([{ id: 'file:a', projectId: 'org/repo', path: 'src/auth.ts', contentHash: 'filehash', indexedAt: '2026-06-29T00:00:00.000Z' }]);
    await codeStore.upsertSymbols([{ id: 'symbol:a', projectId: 'org/repo', fileId: 'file:a', path: 'src/auth.ts', name: 'authMiddleware', qualifiedName: 'authMiddleware', kind: 'function', contentHash: 'symhash', indexedAt: '2026-06-29T00:00:00.000Z' }]);

    const result = await storeObservation({
      entityName: 'auth',
      type: 'decision',
      title: 'authMiddleware uses jose',
      narrative: 'Keep authMiddleware in src/auth.ts.',
      filesModified: ['src/auth.ts'],
      projectId: 'org/repo',
    });

    const refs = codeStore.listObservationRefs('org/repo', result.observation.id);
    expect(refs).toHaveLength(1);
    expect(refs[0].symbolId).toBe('symbol:a');
  });
});
```

- [ ] **Step 2: Run failing integration test**

Run:

```bash
npx vitest run tests/integration/codegraph-context-pack.test.ts
```

Expected: FAIL because `storeObservation` does not call binder.

- [ ] **Step 3: Wire binder in `storeObservation`**

In `src/memory/observations.ts`, after the observation has been persisted and inserted into Orama, add a best-effort binder call:

```ts
    try {
      if (projectDir && observation.filesModified.length > 0) {
        const { CodeGraphStore } = await import('../codegraph/store.js');
        const { bindObservationToCode } = await import('../codegraph/binder.js');
        const codeStore = new CodeGraphStore();
        await codeStore.init(projectDir);
        await bindObservationToCode(codeStore, observation);
      }
    } catch {
      // Best-effort: code refs must never block memory writes.
    }
```

Place it after `await insertObservation(doc);` and before asynchronous embedding scheduling, so refs are available soon after the write.

- [ ] **Step 4: Verify integration test passes**

Run:

```bash
npx vitest run tests/integration/codegraph-context-pack.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run focused memory tests**

Run:

```bash
npx vitest run tests/memory/topic-upsert.test.ts tests/memory/auto-enrichment.test.ts tests/integration/codegraph-context-pack.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/memory/observations.ts tests/integration/codegraph-context-pack.test.ts
git commit -m "feat(memory): attach observations to code refs"
```

---

## Task 10: Documentation and Final Verification

**Files:**
- Modify: `docs/API_REFERENCE.md`
- Modify: `docs/README.md`
- Modify: `docs/superpowers/specs/2026-06-29-codegraph-memory-context-fabric-design.md`

- [ ] **Step 1: Document new CLI and MCP surfaces**

Add a short section to `docs/API_REFERENCE.md`:

```md
## CodeGraph Memory and Context Packs

`memorix_context_pack` builds a task-ready working context packet. It combines relevant memories, CodeGraph Memory facts, freshness warnings, and suggested next reads.

CLI:

```bash
memorix codegraph status
memorix codegraph refresh
memorix context build "continue auth bug"
```
```

- [ ] **Step 2: Update docs index if needed**

Ensure `docs/README.md` links both the design spec and API reference section.

- [ ] **Step 3: Run full focused verification**

Run:

```bash
npx vitest run tests/codegraph tests/server/context-pack-tool-profile.test.ts tests/cli/codegraph-command.test.ts tests/integration/codegraph-context-pack.test.ts
npx tsc --noEmit
```

Expected: PASS.

- [ ] **Step 4: Check repository status**

Run:

```bash
git status --short --branch
```

Expected: only intended docs changes are present before commit.

- [ ] **Step 5: Commit**

```bash
git add docs/API_REFERENCE.md docs/README.md docs/superpowers/specs/2026-06-29-codegraph-memory-context-fabric-design.md
git commit -m "docs: document codegraph memory mvp"
```

---

## Self-Review Notes

- Spec coverage: schema/store, provider, Lite fallback, codeRefs, freshness, context pack, CLI/MCP, tests, and docs are covered.
- Scope intentionally excludes full external provider implementation from the MVP execution path; the interface remains in the design and can be implemented after Lite and context packs stabilize.
- No new runtime dependency is required in the first vertical slice.
- Context pack output stays intentionally compact while using task-ranked memory selection before code-ref and freshness filtering.
