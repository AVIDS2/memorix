import { getDatabase } from '../store/sqlite-db.js';
import type { CodeEdge, CodeFile, CodeGraphStatus, CodeSymbol, ObservationCodeRef } from './types.js';
import { normalizeCodePath } from './ids.js';

export interface CodeGraphFileDelta {
  file: CodeFile;
  symbols: CodeSymbol[];
  edges: CodeEdge[];
}

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
      for (const file of items) {
        stmt.run({
          id: file.id,
          projectId: file.projectId,
          path: normalizeCodePath(file.path),
          language: file.language ?? null,
          contentHash: file.contentHash,
          mtimeMs: file.mtimeMs ?? null,
          sizeBytes: file.sizeBytes ?? null,
          indexedAt: file.indexedAt,
          gitCommit: file.gitCommit ?? null,
        });
      }
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
      for (const symbol of items) {
        stmt.run({
          id: symbol.id,
          projectId: symbol.projectId,
          fileId: symbol.fileId,
          path: normalizeCodePath(symbol.path),
          name: symbol.name,
          qualifiedName: symbol.qualifiedName,
          kind: symbol.kind,
          startLine: symbol.startLine ?? null,
          endLine: symbol.endLine ?? null,
          signature: symbol.signature ?? null,
          contentHash: symbol.contentHash ?? null,
          indexedAt: symbol.indexedAt,
          stale: symbol.stale ? 1 : 0,
        });
      }
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
      for (const edge of items) {
        stmt.run({
          id: edge.id,
          projectId: edge.projectId,
          fromSymbolId: edge.fromSymbolId ?? null,
          toSymbolId: edge.toSymbolId ?? null,
          fromFileId: edge.fromFileId ?? null,
          toFileId: edge.toFileId ?? null,
          type: edge.type,
          confidence: edge.confidence,
          evidence: edge.evidence ?? null,
          indexedAt: edge.indexedAt,
        });
      }
    });
    tx(edges);
  }

  replaceProjectIndex(
    projectId: string,
    index: { files: CodeFile[]; symbols: CodeSymbol[]; edges: CodeEdge[] },
  ): void {
    const deleteEdges = this.db.prepare(`DELETE FROM code_edges WHERE projectId = ?`);
    const staleSymbols = this.db.prepare(`UPDATE code_symbols SET stale = 1 WHERE projectId = ?`);
    const deleteFiles = this.db.prepare(`DELETE FROM code_files WHERE projectId = ?`);
    const insertFile = this.db.prepare(`
      INSERT OR REPLACE INTO code_files
        (id, projectId, path, language, contentHash, mtimeMs, sizeBytes, indexedAt, gitCommit)
      VALUES
        (@id, @projectId, @path, @language, @contentHash, @mtimeMs, @sizeBytes, @indexedAt, @gitCommit)
    `);
    const insertSymbol = this.db.prepare(`
      INSERT OR REPLACE INTO code_symbols
        (id, projectId, fileId, path, name, qualifiedName, kind, startLine, endLine, signature, contentHash, indexedAt, stale)
      VALUES
        (@id, @projectId, @fileId, @path, @name, @qualifiedName, @kind, @startLine, @endLine, @signature, @contentHash, @indexedAt, @stale)
    `);
    const insertEdge = this.db.prepare(`
      INSERT OR REPLACE INTO code_edges
        (id, projectId, fromSymbolId, toSymbolId, fromFileId, toFileId, type, confidence, evidence, indexedAt)
      VALUES
        (@id, @projectId, @fromSymbolId, @toSymbolId, @fromFileId, @toFileId, @type, @confidence, @evidence, @indexedAt)
    `);

    const tx = this.db.transaction(() => {
      deleteEdges.run(projectId);
      staleSymbols.run(projectId);
      deleteFiles.run(projectId);

      for (const file of index.files) {
        insertFile.run({
          id: file.id,
          projectId: file.projectId,
          path: normalizeCodePath(file.path),
          language: file.language ?? null,
          contentHash: file.contentHash,
          mtimeMs: file.mtimeMs ?? null,
          sizeBytes: file.sizeBytes ?? null,
          indexedAt: file.indexedAt,
          gitCommit: file.gitCommit ?? null,
        });
      }

      for (const symbol of index.symbols) {
        insertSymbol.run({
          id: symbol.id,
          projectId: symbol.projectId,
          fileId: symbol.fileId,
          path: normalizeCodePath(symbol.path),
          name: symbol.name,
          qualifiedName: symbol.qualifiedName,
          kind: symbol.kind,
          startLine: symbol.startLine ?? null,
          endLine: symbol.endLine ?? null,
          signature: symbol.signature ?? null,
          contentHash: symbol.contentHash ?? null,
          indexedAt: symbol.indexedAt,
          stale: 0,
        });
      }

      for (const edge of index.edges) {
        insertEdge.run({
          id: edge.id,
          projectId: edge.projectId,
          fromSymbolId: edge.fromSymbolId ?? null,
          toSymbolId: edge.toSymbolId ?? null,
          fromFileId: edge.fromFileId ?? null,
          toFileId: edge.toFileId ?? null,
          type: edge.type,
          confidence: edge.confidence,
          evidence: edge.evidence ?? null,
          indexedAt: edge.indexedAt,
        });
      }
    });

    tx();
  }

  /**
   * Reconcile only files whose source changed plus files that disappeared.
   * Refs tied to replaced sources become stale instead of being silently kept.
   */
  applyFileDeltas(
    projectId: string,
    input: {
      changed: CodeGraphFileDelta[];
      metadataOnly?: CodeFile[];
      removedFileIds?: string[];
    },
  ): void {
    const changed = input.changed.filter((delta) => delta.file.projectId === projectId);
    const metadataOnly = (input.metadataOnly ?? []).filter((file) => file.projectId === projectId);
    const removedFileIds = input.removedFileIds ?? [];
    if (changed.length === 0 && metadataOnly.length === 0 && removedFileIds.length === 0) return;

    const staleRefsForFile = this.db.prepare(`
      UPDATE observation_code_refs
      SET status = 'stale', updatedAt = ?
      WHERE projectId = ? AND (
        fileId = ? OR symbolId IN (
          SELECT id FROM code_symbols WHERE projectId = ? AND fileId = ?
        )
      )
    `);
    const deleteEdgesForFile = this.db.prepare(`
      DELETE FROM code_edges
      WHERE projectId = ? AND (fromFileId = ? OR toFileId = ?)
    `);
    const deleteSymbolsForFile = this.db.prepare(`DELETE FROM code_symbols WHERE projectId = ? AND fileId = ?`);
    const deleteFile = this.db.prepare(`DELETE FROM code_files WHERE projectId = ? AND id = ?`);
    const upsertFile = this.db.prepare(`
      INSERT OR REPLACE INTO code_files
        (id, projectId, path, language, contentHash, mtimeMs, sizeBytes, indexedAt, gitCommit)
      VALUES
        (@id, @projectId, @path, @language, @contentHash, @mtimeMs, @sizeBytes, @indexedAt, @gitCommit)
    `);
    const upsertSymbol = this.db.prepare(`
      INSERT OR REPLACE INTO code_symbols
        (id, projectId, fileId, path, name, qualifiedName, kind, startLine, endLine, signature, contentHash, indexedAt, stale)
      VALUES
        (@id, @projectId, @fileId, @path, @name, @qualifiedName, @kind, @startLine, @endLine, @signature, @contentHash, @indexedAt, @stale)
    `);
    const upsertEdge = this.db.prepare(`
      INSERT OR REPLACE INTO code_edges
        (id, projectId, fromSymbolId, toSymbolId, fromFileId, toFileId, type, confidence, evidence, indexedAt)
      VALUES
        (@id, @projectId, @fromSymbolId, @toSymbolId, @fromFileId, @toFileId, @type, @confidence, @evidence, @indexedAt)
    `);
    const writeFile = (file: CodeFile) => upsertFile.run({
      id: file.id,
      projectId: file.projectId,
      path: normalizeCodePath(file.path),
      language: file.language ?? null,
      contentHash: file.contentHash,
      mtimeMs: file.mtimeMs ?? null,
      sizeBytes: file.sizeBytes ?? null,
      indexedAt: file.indexedAt,
      gitCommit: file.gitCommit ?? null,
    });

    const tx = this.db.transaction(() => {
      const staleAt = new Date().toISOString();
      for (const fileId of removedFileIds) {
        staleRefsForFile.run(staleAt, projectId, fileId, projectId, fileId);
        deleteEdgesForFile.run(projectId, fileId, fileId);
        deleteSymbolsForFile.run(projectId, fileId);
        deleteFile.run(projectId, fileId);
      }

      for (const delta of changed) {
        const fileId = delta.file.id;
        staleRefsForFile.run(staleAt, projectId, fileId, projectId, fileId);
        deleteEdgesForFile.run(projectId, fileId, fileId);
        deleteSymbolsForFile.run(projectId, fileId);
        writeFile(delta.file);

        for (const symbol of delta.symbols) {
          upsertSymbol.run({
            id: symbol.id,
            projectId: symbol.projectId,
            fileId: symbol.fileId,
            path: normalizeCodePath(symbol.path),
            name: symbol.name,
            qualifiedName: symbol.qualifiedName,
            kind: symbol.kind,
            startLine: symbol.startLine ?? null,
            endLine: symbol.endLine ?? null,
            signature: symbol.signature ?? null,
            contentHash: symbol.contentHash ?? null,
            indexedAt: symbol.indexedAt,
            stale: symbol.stale ? 1 : 0,
          });
        }

        for (const edge of delta.edges) {
          upsertEdge.run({
            id: edge.id,
            projectId: edge.projectId,
            fromSymbolId: edge.fromSymbolId ?? null,
            toSymbolId: edge.toSymbolId ?? null,
            fromFileId: edge.fromFileId ?? null,
            toFileId: edge.toFileId ?? null,
            type: edge.type,
            confidence: edge.confidence,
            evidence: edge.evidence ?? null,
            indexedAt: edge.indexedAt,
          });
        }
      }

      for (const file of metadataOnly) writeFile(file);
    });
    tx();
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
      for (const ref of items) {
        stmt.run({
          id: ref.id,
          projectId: ref.projectId,
          observationId: ref.observationId,
          fileId: ref.fileId ?? null,
          symbolId: ref.symbolId ?? null,
          capturedFileHash: ref.capturedFileHash ?? null,
          capturedSymbolHash: ref.capturedSymbolHash ?? null,
          status: ref.status,
          reason: ref.reason ?? null,
          createdAt: ref.createdAt,
          updatedAt: ref.updatedAt ?? null,
        });
      }
    });
    tx(refs);
  }

  replaceObservationRefs(projectId: string, observationId: number, refs: ObservationCodeRef[]): void {
    const deleteRefs = this.db.prepare(`
      DELETE FROM observation_code_refs
      WHERE projectId = ? AND observationId = ?
    `);
    const insertRef = this.db.prepare(`
      INSERT OR REPLACE INTO observation_code_refs
        (id, projectId, observationId, fileId, symbolId, capturedFileHash, capturedSymbolHash, status, reason, createdAt, updatedAt)
      VALUES
        (@id, @projectId, @observationId, @fileId, @symbolId, @capturedFileHash, @capturedSymbolHash, @status, @reason, @createdAt, @updatedAt)
    `);
    const tx = this.db.transaction(() => {
      deleteRefs.run(projectId, observationId);
      for (const ref of refs) {
        insertRef.run({
          id: ref.id,
          projectId: ref.projectId,
          observationId: ref.observationId,
          fileId: ref.fileId ?? null,
          symbolId: ref.symbolId ?? null,
          capturedFileHash: ref.capturedFileHash ?? null,
          capturedSymbolHash: ref.capturedSymbolHash ?? null,
          status: ref.status,
          reason: ref.reason ?? null,
          createdAt: ref.createdAt,
          updatedAt: ref.updatedAt ?? null,
        });
      }
    });
    tx();
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

  listSymbols(projectId: string): CodeSymbol[] {
    return this.db.prepare(`
      SELECT * FROM code_symbols
      WHERE projectId = ? AND stale = 0
      ORDER BY path, startLine
    `).all(projectId).map(rowToSymbol);
  }

  findSymbolsByNames(projectId: string, names: string[], fileIds: string[] = []): CodeSymbol[] {
    const candidates = [...new Set(names.map(name => name.trim()).filter(Boolean))];
    if (candidates.length === 0) return [];
    const candidateJson = JSON.stringify(candidates);
    const hintedFiles = [...new Set(fileIds.map(fileId => fileId.trim()).filter(Boolean))];
    if (hintedFiles.length > 0) {
      return this.db.prepare(`
        SELECT * FROM code_symbols
        WHERE projectId = ?
          AND stale = 0
          AND name IN (SELECT value FROM json_each(?))
          AND fileId IN (SELECT value FROM json_each(?))
        ORDER BY path, startLine
      `).all(projectId, candidateJson, JSON.stringify(hintedFiles)).map(rowToSymbol);
    }

    return this.db.prepare(`
      SELECT symbols.*
      FROM code_symbols AS symbols
      INNER JOIN (
        SELECT name
        FROM code_symbols
        WHERE projectId = ?
          AND stale = 0
          AND name IN (SELECT value FROM json_each(?))
        GROUP BY name
        HAVING COUNT(*) = 1
      ) AS unambiguous ON unambiguous.name = symbols.name
      WHERE symbols.projectId = ? AND symbols.stale = 0
      ORDER BY symbols.path, symbols.startLine
    `).all(projectId, candidateJson, projectId).map(rowToSymbol);
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

  listProjectObservationRefs(projectId: string): ObservationCodeRef[] {
    return this.db.prepare(`
      SELECT * FROM observation_code_refs
      WHERE projectId = ?
      ORDER BY observationId, status, id
    `).all(projectId).map(rowToRef);
  }

  listReferencedSymbols(projectId: string): CodeSymbol[] {
    return this.db.prepare(`
      SELECT DISTINCT symbols.*
      FROM code_symbols AS symbols
      INNER JOIN observation_code_refs AS refs ON refs.symbolId = symbols.id
      WHERE refs.projectId = ? AND symbols.projectId = ? AND symbols.stale = 0
      ORDER BY symbols.path, symbols.startLine
    `).all(projectId, projectId).map(rowToSymbol);
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
