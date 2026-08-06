import { randomUUID } from 'node:crypto';
import { posix as pathPosix } from 'node:path';
import { getDatabase } from '../store/sqlite-db.js';
import type {
  CodeEdge,
  CodeFile,
  CodeGraphImpactSlice,
  CodeGraphStatus,
  CodeStateDiff,
  CodeStateFileChange,
  CodeStateSnapshotFile,
  CodeStateScanCompleteness,
  CodeStateSnapshot,
  CodeStateSnapshotInput,
  CodeSymbol,
  ObservationCodeRef,
} from './types.js';
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
    ...(row.snapshotId ? { snapshotId: row.snapshotId } : {}),
    ...(row.sourceEpoch != null ? { sourceEpoch: Number(row.sourceEpoch) } : {}),
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
    ...(row.snapshotId ? { snapshotId: row.snapshotId } : {}),
    ...(row.sourceEpoch != null ? { sourceEpoch: Number(row.sourceEpoch) } : {}),
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
    ...(row.snapshotId ? { snapshotId: row.snapshotId } : {}),
    ...(row.sourceEpoch != null ? { sourceEpoch: Number(row.sourceEpoch) } : {}),
  } as CodeEdge;
}

function resolveRelativeImportTarget(
  sourcePath: string,
  evidence: string | undefined,
  fileByPath: Map<string, CodeFile>,
): CodeFile | undefined {
  const target = evidence?.trim().replace(/\\/g, '/');
  if (!target?.startsWith('.')) return undefined;
  const base = normalizeCodePath(pathPosix.normalize(pathPosix.join(pathPosix.dirname(sourcePath), target)));
  if (!base || base === '..' || base.startsWith('../')) return undefined;
  const candidates = [base];
  const extensionMatch = base.match(/(\.[A-Za-z0-9]+)$/);
  const hasExtension = Boolean(extensionMatch);
  if (!hasExtension) {
    const extensions = [...new Set([...fileByPath.keys()]
      .map(path => path.match(/(\.[A-Za-z0-9]+)$/)?.[1])
      .filter((extension): extension is string => Boolean(extension)))];
    for (const extension of extensions) {
      candidates.push(`${base}${extension}`, `${base}/index${extension}`);
    }
  } else {
    // Node ESM projects commonly import the emitted .js path from a .ts source.
    // Keep an exact path first, then resolve only equivalent local source forms.
    const sourceStem = base.slice(0, -extensionMatch![1].length);
    const sourceExtensions = extensionMatch![1] === '.js'
      ? ['.ts', '.tsx', '.js', '.jsx']
      : extensionMatch![1] === '.mjs'
        ? ['.mts', '.mjs']
        : extensionMatch![1] === '.cjs'
          ? ['.cts', '.cjs']
          : [];
    for (const extension of sourceExtensions) candidates.push(`${sourceStem}${extension}`);
  }
  return candidates.map(candidate => fileByPath.get(candidate)).find((file): file is CodeFile => Boolean(file));
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
    ...(row.snapshotId ? { snapshotId: row.snapshotId } : {}),
  } as ObservationCodeRef;
}

function parseCompleteness(raw: unknown): CodeStateScanCompleteness {
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid completeness');
    return {
      scannedFiles: Number((parsed as any).scannedFiles) || 0,
      maxFiles: Number((parsed as any).maxFiles) || 0,
      changedFiles: Number((parsed as any).changedFiles) || 0,
      unchangedFiles: Number((parsed as any).unchangedFiles) || 0,
      metadataOnlyFiles: Number((parsed as any).metadataOnlyFiles) || 0,
      removedFiles: Number((parsed as any).removedFiles) || 0,
      skippedOversizedFiles: Number((parsed as any).skippedOversizedFiles) || 0,
      unreadableFiles: Number((parsed as any).unreadableFiles) || 0,
      removalScanDeferred: Boolean((parsed as any).removalScanDeferred),
    };
  } catch {
    return {
      scannedFiles: 0,
      maxFiles: 0,
      changedFiles: 0,
      unchangedFiles: 0,
      metadataOnlyFiles: 0,
      removedFiles: 0,
      skippedOversizedFiles: 0,
      unreadableFiles: 0,
      removalScanDeferred: false,
    };
  }
}

function rowToSnapshot(row: any): CodeStateSnapshot {
  return {
    id: row.id,
    projectId: row.projectId,
    provider: row.provider,
    ...(row.baseRevision ? { baseRevision: row.baseRevision } : {}),
    worktreeFingerprint: row.worktreeFingerprint,
    worktreeState: row.worktreeState,
    changedPathCount: Number(row.changedPathCount),
    indexedAt: row.indexedAt,
    sourceEpoch: Number(row.sourceEpoch),
    completeness: parseCompleteness(row.completenessJson),
    ...(row.previousSnapshotId ? { previousSnapshotId: row.previousSnapshotId } : {}),
  } as CodeStateSnapshot;
}

function rowToSnapshotFile(row: any): CodeStateSnapshotFile {
  return {
    snapshotId: row.snapshotId,
    projectId: row.projectId,
    fileId: row.fileId,
    path: row.path,
    contentHash: row.contentHash,
  };
}

function snapshotIsIncomplete(snapshot: CodeStateSnapshot): boolean {
  return snapshot.completeness.skippedOversizedFiles > 0
    || (snapshot.completeness.unreadableFiles ?? 0) > 0
    || snapshot.completeness.removalScanDeferred;
}

export class CodeGraphStore {
  private db: any = null;
  private dataDir: string | null = null;

  async init(dataDir: string): Promise<void> {
    this.dataDir = dataDir;
    this.db = getDatabase(dataDir);
  }

  /** Data directory shared with the rest of the local project evidence stores. */
  getDataDir(): string {
    if (!this.dataDir) throw new Error('CodeGraphStore is not initialized');
    return this.dataDir;
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
    this.reconcileLocalImportTargets(projectId);
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
    if (changed.length === 0 && metadataOnly.length === 0 && removedFileIds.length === 0) {
      this.reconcileLocalImportTargets(projectId);
      return;
    }

    const staleRefsForFile = this.db.prepare(`
      UPDATE observation_code_refs
      SET status = 'stale', updatedAt = ?
      WHERE projectId = ? AND (
        fileId = ? OR symbolId IN (
          SELECT id FROM code_symbols WHERE projectId = ? AND fileId = ?
        )
      )
    `);
    const deleteEdgesFromFile = this.db.prepare(`
      DELETE FROM code_edges
      WHERE projectId = ? AND fromFileId = ?
    `);
    const clearImportTargetsForFile = this.db.prepare(`
      UPDATE code_edges
      SET toFileId = NULL
      WHERE projectId = ? AND toFileId = ? AND type = 'imports'
    `);
    const deleteOtherIncomingEdgesForFile = this.db.prepare(`
      DELETE FROM code_edges
      WHERE projectId = ? AND toFileId = ? AND type != 'imports'
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
        deleteEdgesFromFile.run(projectId, fileId);
        clearImportTargetsForFile.run(projectId, fileId);
        deleteOtherIncomingEdgesForFile.run(projectId, fileId);
        deleteSymbolsForFile.run(projectId, fileId);
        deleteFile.run(projectId, fileId);
      }

      for (const delta of changed) {
        const fileId = delta.file.id;
        staleRefsForFile.run(staleAt, projectId, fileId, projectId, fileId);
        deleteEdgesFromFile.run(projectId, fileId);
        clearImportTargetsForFile.run(projectId, fileId);
        deleteOtherIncomingEdgesForFile.run(projectId, fileId);
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
    this.reconcileLocalImportTargets(projectId);
  }

  upsertObservationRefs(refs: ObservationCodeRef[]): void {
    if (refs.length === 0) return;
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO observation_code_refs
        (id, projectId, observationId, fileId, symbolId, capturedFileHash, capturedSymbolHash, status, reason, createdAt, updatedAt, snapshotId)
      VALUES
        (@id, @projectId, @observationId, @fileId, @symbolId, @capturedFileHash, @capturedSymbolHash, @status, @reason, @createdAt, @updatedAt, @snapshotId)
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
          snapshotId: ref.snapshotId ?? this.latestSnapshot(ref.projectId)?.id ?? null,
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
        (id, projectId, observationId, fileId, symbolId, capturedFileHash, capturedSymbolHash, status, reason, createdAt, updatedAt, snapshotId)
      VALUES
        (@id, @projectId, @observationId, @fileId, @symbolId, @capturedFileHash, @capturedSymbolHash, @status, @reason, @createdAt, @updatedAt, @snapshotId)
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
          snapshotId: ref.snapshotId ?? this.latestSnapshot(ref.projectId)?.id ?? null,
        });
      }
    });
    tx();
  }

  /**
   * Lite import extraction records the original import text first. Resolve only
   * local relative imports against the current index after each refresh, so an
   * added or removed target cannot leave a fabricated file-to-file relation.
   */
  reconcileLocalImportTargets(projectId: string): void {
    const fileById = new Map(this.listFiles(projectId).map(file => [file.id, file]));
    const fileByPath = new Map([...fileById.values()].map(file => [file.path, file]));
    const update = this.db.prepare('UPDATE code_edges SET toFileId = ? WHERE id = ?');
    const tx = this.db.transaction(() => {
      for (const edge of this.listEdges(projectId)) {
        if (edge.type !== 'imports' || !edge.fromFileId) continue;
        const source = fileById.get(edge.fromFileId);
        const target = source ? resolveRelativeImportTarget(source.path, edge.evidence, fileByPath) : undefined;
        update.run(target?.id ?? null, edge.id);
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

  /** Count distinct observations whose binding to these exact files is stale. */
  countStaleObservationRefsForFiles(projectId: string, fileIds: string[]): number {
    const ids = [...new Set(fileIds.filter(Boolean))];
    if (ids.length === 0) return 0;
    const placeholders = ids.map(() => '?').join(', ');
    const row = this.db.prepare(`
      SELECT COUNT(DISTINCT observationId) AS count
      FROM observation_code_refs
      WHERE projectId = ? AND status = 'stale' AND fileId IN (${placeholders})
    `).get(projectId, ...ids);
    return Number(row?.count ?? 0);
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

  latestSnapshot(projectId: string): CodeStateSnapshot | undefined {
    const row = this.db.prepare(
      'SELECT * FROM code_state_snapshots WHERE projectId = ? ORDER BY sourceEpoch DESC LIMIT 1',
    ).get(projectId);
    return row ? rowToSnapshot(row) : undefined;
  }

  listSnapshots(projectId: string, limit = 20): CodeStateSnapshot[] {
    const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.min(200, Math.floor(limit))) : 20;
    return this.db.prepare(
      'SELECT * FROM code_state_snapshots WHERE projectId = ? ORDER BY sourceEpoch DESC LIMIT ?',
    ).all(projectId, safeLimit).map(rowToSnapshot);
  }

  listSnapshotFiles(snapshotId: string): CodeStateSnapshotFile[] {
    return this.db.prepare(`
      SELECT snapshotId, projectId, fileId, path, contentHash
      FROM code_state_snapshot_files
      WHERE snapshotId = ?
      ORDER BY path
    `).all(snapshotId).map(rowToSnapshotFile);
  }

  diffSnapshots(projectId: string, fromSnapshotId: string, toSnapshotId: string): CodeStateDiff {
    const snapshots = this.db.prepare(`
      SELECT * FROM code_state_snapshots WHERE id IN (?, ?)
    `).all(fromSnapshotId, toSnapshotId).map(rowToSnapshot) as CodeStateSnapshot[];
    if (snapshots.length !== 2) {
      return { projectId, fromSnapshotId, toSnapshotId, available: false, reason: 'missing-snapshot', changes: [] };
    }
    if (snapshots.some(snapshot => snapshot.projectId !== projectId)) {
      return { projectId, fromSnapshotId, toSnapshotId, available: false, reason: 'project-mismatch', changes: [] };
    }
    if (snapshots.some(snapshotIsIncomplete)) {
      return { projectId, fromSnapshotId, toSnapshotId, available: false, reason: 'incomplete-snapshot', changes: [] };
    }
    const before = this.listSnapshotFiles(fromSnapshotId);
    const after = this.listSnapshotFiles(toSnapshotId);
    if (before.length === 0 || after.length === 0) {
      return {
        projectId,
        fromSnapshotId,
        toSnapshotId,
        available: false,
        reason: 'legacy-snapshot-without-manifest',
        changes: [],
      };
    }
    const beforeByPath = new Map(before.map(file => [file.path, file]));
    const afterByPath = new Map(after.map(file => [file.path, file]));
    const paths = [...new Set([...beforeByPath.keys(), ...afterByPath.keys()])].sort();
    const changes: CodeStateFileChange[] = [];
    for (const path of paths) {
      const oldFile = beforeByPath.get(path);
      const newFile = afterByPath.get(path);
      if (!oldFile && newFile) {
        changes.push({ path, kind: 'added', afterHash: newFile.contentHash });
      } else if (oldFile && !newFile) {
        changes.push({ path, kind: 'removed', beforeHash: oldFile.contentHash });
      } else if (oldFile && newFile && oldFile.contentHash !== newFile.contentHash) {
        changes.push({ path, kind: 'modified', beforeHash: oldFile.contentHash, afterHash: newFile.contentHash });
      }
    }
    return { projectId, fromSnapshotId, toSnapshotId, available: true, changes };
  }

  impactSlice(projectId: string, changedPaths: string[], maxRelations = 24): CodeGraphImpactSlice {
    const safeLimit = Number.isFinite(maxRelations) ? Math.max(1, Math.min(100, Math.floor(maxRelations))) : 24;
    const normalizedPaths = [...new Set(changedPaths.map(normalizeCodePath).filter(Boolean))].sort();
    const files = this.listFiles(projectId);
    const fileById = new Map(files.map(file => [file.id, file.path]));
    const fileIdBySymbolId = new Map(this.listSymbols(projectId).map(symbol => [symbol.id, symbol.fileId]));
    const changedIds = new Set(files.filter(file => normalizedPaths.includes(file.path)).map(file => file.id));
    const direct = new Set<string>();
    let relationCount = 0;
    let truncated = false;
    for (const edge of this.listEdges(projectId)) {
      const endpoints = [
        edge.fromFileId,
        edge.toFileId,
        edge.fromSymbolId ? fileIdBySymbolId.get(edge.fromSymbolId) : undefined,
        edge.toSymbolId ? fileIdBySymbolId.get(edge.toSymbolId) : undefined,
      ].filter((id): id is string => Boolean(id));
      if (!endpoints.some(id => changedIds.has(id))) continue;
      const relatedPaths = endpoints
        .filter(id => !changedIds.has(id))
        .map(id => fileById.get(id))
        .filter((path): path is string => Boolean(path));
      if (relatedPaths.length === 0) continue;
      if (relationCount >= safeLimit) {
        truncated = true;
        break;
      }
      relationCount += 1;
      for (const path of relatedPaths) direct.add(path);
    }
    const snapshot = this.latestSnapshot(projectId);
    return {
      projectId,
      ...(snapshot ? { snapshotId: snapshot.id } : {}),
      changedPaths: normalizedPaths,
      directlyConnectedPaths: [...direct].sort(),
      relationCount,
      truncated,
      provider: snapshot?.provider ?? 'lite',
    };
  }

  /**
   * Record a completed scan and mark all current structural facts with its
   * epoch. The snapshot is written only after refresh reconciliation succeeds,
   * so an interrupted scan cannot be advertised as complete.
   */
  recordCodeStateSnapshot(input: CodeStateSnapshotInput): CodeStateSnapshot {
    const id = randomUUID();
    let snapshot: CodeStateSnapshot | undefined;
    const tx = this.db.transaction(() => {
      const previous = this.db.prepare(
        'SELECT id, sourceEpoch FROM code_state_snapshots WHERE projectId = ? ORDER BY sourceEpoch DESC LIMIT 1',
      ).get(input.projectId);
      const sourceEpoch = Number(previous?.sourceEpoch ?? 0) + 1;
      const previousSnapshotId = previous?.id as string | undefined;
      this.db.prepare(
        'INSERT INTO code_state_snapshots (id, projectId, provider, baseRevision, worktreeFingerprint, worktreeState, changedPathCount, indexedAt, sourceEpoch, completenessJson, previousSnapshotId) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      ).run(
        id,
        input.projectId,
        input.provider,
        input.baseRevision ?? null,
        input.worktreeFingerprint,
        input.worktreeState,
        input.changedPathCount,
        input.indexedAt,
        sourceEpoch,
        JSON.stringify(input.completeness),
        previousSnapshotId ?? null,
      );
      this.db.prepare(
        'UPDATE code_files SET snapshotId = ?, sourceEpoch = ?, gitCommit = COALESCE(?, gitCommit) WHERE projectId = ?',
      ).run(id, sourceEpoch, input.baseRevision ?? null, input.projectId);
      this.db.prepare(
        'UPDATE code_symbols SET snapshotId = ?, sourceEpoch = ? WHERE projectId = ? AND stale = 0',
      ).run(id, sourceEpoch, input.projectId);
      this.db.prepare(
        'UPDATE code_edges SET snapshotId = ?, sourceEpoch = ? WHERE projectId = ?',
      ).run(id, sourceEpoch, input.projectId);
      this.db.prepare(
        "UPDATE observation_code_refs SET snapshotId = ? WHERE projectId = ? AND status = 'current'",
      ).run(id, input.projectId);
      const snapshotFileRows = this.db.prepare(`
        SELECT id, projectId, path, contentHash FROM code_files WHERE projectId = ? ORDER BY path
      `).all(input.projectId) as Array<{ id: string; projectId: string; path: string; contentHash: string }>;
      const insertSnapshotFile = this.db.prepare(`
        INSERT INTO code_state_snapshot_files (snapshotId, projectId, fileId, path, contentHash)
        VALUES (?, ?, ?, ?, ?)
      `);
      for (const file of snapshotFileRows) {
        insertSnapshotFile.run(id, file.projectId, file.id, file.path, file.contentHash);
      }
      snapshot = {
        ...input,
        id,
        sourceEpoch,
        ...(previousSnapshotId ? { previousSnapshotId } : {}),
      };
    });
    tx();
    return snapshot!;
  }

  status(projectId: string): CodeGraphStatus {
    const files = this.db.prepare(`SELECT COUNT(*) AS count FROM code_files WHERE projectId = ?`).get(projectId).count;
    const symbols = this.db.prepare(`SELECT COUNT(*) AS count FROM code_symbols WHERE projectId = ? AND stale = 0`).get(projectId).count;
    const edges = this.db.prepare(`SELECT COUNT(*) AS count FROM code_edges WHERE projectId = ?`).get(projectId).count;
    const refs = this.db.prepare(`SELECT COUNT(*) AS count FROM observation_code_refs WHERE projectId = ?`).get(projectId).count;
    const latest = this.db.prepare(`SELECT MAX(indexedAt) AS indexedAt FROM code_files WHERE projectId = ?`).get(projectId);
    const latestSnapshot = this.latestSnapshot(projectId);
    return {
      provider: 'lite',
      files,
      symbols,
      edges,
      refs,
      ...(latest?.indexedAt ? { indexedAt: latest.indexedAt } : {}),
      ...(latestSnapshot ? { latestSnapshot } : {}),
    };
  }
}
