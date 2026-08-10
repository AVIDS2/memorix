import { randomUUID } from 'node:crypto';

import { getDatabase } from '../store/sqlite-db.js';
import { sanitizeCredentials } from '../memory/secret-filter.js';
import type {
  MediaAsset,
  MediaAssetLink,
  MediaDerivation,
  MediaDerivationMetadata,
  MediaEmbedding,
  MediaEmbeddingProfile,
  MediaJob,
  MediaJobKind,
  MediaJobStatus,
  MediaKind,
  MediaLinkRole,
  MediaSourceKind,
} from './types.js';

function asOptionalText(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function parseRequest(value: unknown): Record<string, unknown> {
  if (typeof value !== 'string' || !value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function sanitizeRequest(value: Record<string, unknown>): Record<string, unknown> {
  const visit = (candidate: unknown): unknown => {
    if (typeof candidate === 'string') return sanitizeCredentials(candidate);
    if (Array.isArray(candidate)) return candidate.map(visit);
    if (candidate && typeof candidate === 'object') {
      return Object.fromEntries(Object.entries(candidate as Record<string, unknown>)
        .map(([key, nested]) => [key, visit(nested)]));
    }
    return candidate;
  };
  return visit(value) as Record<string, unknown>;
}

function parseVector(value: unknown): number[] | undefined {
  if (typeof value !== 'string' || !value) return undefined;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) && parsed.every((item) => typeof item === 'number' && Number.isFinite(item))
      ? parsed
      : undefined;
  } catch {
    return undefined;
  }
}

function parseDerivationMetadata(value: unknown): MediaDerivationMetadata | undefined {
  if (typeof value !== 'string' || !value) return undefined;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as MediaDerivationMetadata
      : undefined;
  } catch {
    return undefined;
  }
}

function rowToAsset(row: any): MediaAsset {
  return {
    id: row.id,
    projectId: row.project_id,
    sha256: row.sha256,
    kind: row.kind as MediaKind,
    mimeType: row.mime_type,
    byteSize: Number(row.byte_size),
    storageRelPath: row.storage_rel_path,
    sourceKind: row.source_kind as MediaSourceKind,
    ...(asOptionalText(row.source_label) ? { sourceLabel: row.source_label } : {}),
    ...(asOptionalText(row.provider) ? { provider: row.provider } : {}),
    ...(asOptionalText(row.model) ? { model: row.model } : {}),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    ...(row.deleted_at != null ? { deletedAt: Number(row.deleted_at) } : {}),
  };
}

function rowToLink(row: any): MediaAssetLink {
  return {
    id: row.id,
    assetId: row.asset_id,
    projectId: row.project_id,
    ...(row.observation_id != null ? { observationId: Number(row.observation_id) } : {}),
    role: row.role as MediaLinkRole,
    createdAt: Number(row.created_at),
  };
}

function rowToDerivation(row: any): MediaDerivation {
  const metadata = parseDerivationMetadata(row.metadata_json);
  return {
    id: row.id,
    assetId: row.asset_id,
    projectId: row.project_id,
    kind: row.kind,
    ...(asOptionalText(row.profile_key) ? { profileKey: row.profile_key } : {}),
    content: row.content,
    ...(metadata ? { metadata } : {}),
    status: row.status,
    ...(asOptionalText(row.error) ? { error: row.error } : {}),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

function rowToJob(row: any): MediaJob {
  return {
    id: row.id,
    projectId: row.project_id,
    kind: row.kind as MediaJobKind,
    status: row.status as MediaJobStatus,
    request: parseRequest(row.request_json),
    ...(asOptionalText(row.provider_task_id) ? { providerTaskId: row.provider_task_id } : {}),
    ...(asOptionalText(row.asset_id) ? { assetId: row.asset_id } : {}),
    ...(asOptionalText(row.last_error) ? { lastError: row.last_error } : {}),
    attempts: Number(row.attempts),
    attachOnComplete: Number(row.attach_on_complete) === 1,
    ...(asOptionalText(row.observation_title) ? { observationTitle: row.observation_title } : {}),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    ...(row.completed_at != null ? { completedAt: Number(row.completed_at) } : {}),
  };
}

export class MediaStore {
  private readonly db: any;

  constructor(dataDir: string) {
    this.db = getDatabase(dataDir);
  }

  findAssetByHash(projectId: string, sha256: string): MediaAsset | undefined {
    const row = this.db.prepare(`
      SELECT * FROM media_assets WHERE project_id = ? AND sha256 = ? LIMIT 1
    `).get(projectId, sha256);
    return row ? rowToAsset(row) : undefined;
  }

  getAsset(projectId: string, id: string, options: { includeDeleted?: boolean } = {}): MediaAsset | undefined {
    const row = this.db.prepare(`
      SELECT * FROM media_assets
      WHERE project_id = ? AND id = ? ${options.includeDeleted ? '' : 'AND deleted_at IS NULL'}
      LIMIT 1
    `).get(projectId, id);
    return row ? rowToAsset(row) : undefined;
  }

  listAssets(projectId: string, options: { kind?: MediaKind; includeDeleted?: boolean; limit?: number } = {}): MediaAsset[] {
    const clauses = ['project_id = ?'];
    const values: unknown[] = [projectId];
    if (!options.includeDeleted) clauses.push('deleted_at IS NULL');
    if (options.kind) {
      clauses.push('kind = ?');
      values.push(options.kind);
    }
    const limit = Math.min(500, Math.max(1, Math.floor(options.limit ?? 100)));
    const rows = this.db.prepare(`
      SELECT * FROM media_assets WHERE ${clauses.join(' AND ')}
      ORDER BY created_at DESC LIMIT ?
    `).all(...values, limit);
    return rows.map(rowToAsset);
  }

  createOrReviveAsset(input: Omit<MediaAsset, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt'>): { asset: MediaAsset; deduplicated: boolean } {
    const now = Date.now();
    const existing = this.findAssetByHash(input.projectId, input.sha256);
    if (existing) {
      this.db.prepare(`
        UPDATE media_assets
        SET storage_rel_path = ?, byte_size = ?, mime_type = ?, kind = ?, source_kind = ?,
            source_label = ?, provider = ?, model = ?, updated_at = ?, deleted_at = NULL
        WHERE id = ?
      `).run(
        input.storageRelPath,
        input.byteSize,
        input.mimeType,
        input.kind,
        input.sourceKind,
        input.sourceLabel ?? null,
        input.provider ?? null,
        input.model ?? null,
        now,
        existing.id,
      );
      return { asset: this.getAsset(input.projectId, existing.id)!, deduplicated: true };
    }

    const asset: MediaAsset = {
      id: randomUUID(),
      ...input,
      createdAt: now,
      updatedAt: now,
    };
    this.db.prepare(`
      INSERT INTO media_assets (
        id, project_id, sha256, kind, mime_type, byte_size, storage_rel_path,
        source_kind, source_label, provider, model, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      asset.id,
      asset.projectId,
      asset.sha256,
      asset.kind,
      asset.mimeType,
      asset.byteSize,
      asset.storageRelPath,
      asset.sourceKind,
      asset.sourceLabel ?? null,
      asset.provider ?? null,
      asset.model ?? null,
      now,
      now,
    );
    return { asset, deduplicated: false };
  }

  markAssetDeleted(projectId: string, assetId: string): void {
    const result = this.db.prepare(`
      UPDATE media_assets SET deleted_at = ?, updated_at = ?
      WHERE project_id = ? AND id = ? AND deleted_at IS NULL
    `).run(Date.now(), Date.now(), projectId, assetId);
    if (Number(result.changes ?? 0) !== 1) throw new Error(`Media asset not found: ${assetId}`);
  }

  /**
   * Remove all active metadata for an asset as one SQLite transaction. The
   * caller owns the corresponding file move and can restore it if this fails.
   */
  removeAssetMetadata(projectId: string, assetId: string, options: { force?: boolean } = {}): { detachedLinks: number } {
    return this.db.transaction(() => {
      const asset = this.getAsset(projectId, assetId);
      if (!asset) throw new Error(`Media asset not found: ${assetId}`);

      const linkCount = Number(this.db.prepare(`
        SELECT COUNT(*) AS count FROM media_asset_links WHERE project_id = ? AND asset_id = ?
      `).get(projectId, assetId)?.count ?? 0);
      if (linkCount > 0 && !options.force) {
        throw new Error(`Media asset ${assetId} is attached to ${linkCount} memory record(s); rerun with --force to detach it`);
      }

      const detachedLinks = Number(this.db.prepare(`
        DELETE FROM media_asset_links WHERE project_id = ? AND asset_id = ?
      `).run(projectId, assetId).changes ?? 0);
      this.db.prepare('DELETE FROM media_derivations WHERE project_id = ? AND asset_id = ?').run(projectId, assetId);
      this.db.prepare('DELETE FROM media_embeddings WHERE project_id = ? AND asset_id = ?').run(projectId, assetId);
      // Assets are soft-deleted so SQLite's ON DELETE SET NULL does not fire.
      // Do not leave completed jobs advertising an asset that `media show` can
      // no longer retrieve.
      this.db.prepare(`
        UPDATE media_jobs SET asset_id = NULL, updated_at = ?
        WHERE project_id = ? AND asset_id = ?
      `).run(Date.now(), projectId, assetId);
      const result = this.db.prepare(`
        UPDATE media_assets SET deleted_at = ?, updated_at = ?
        WHERE project_id = ? AND id = ? AND deleted_at IS NULL
      `).run(Date.now(), Date.now(), projectId, assetId);
      if (Number(result.changes ?? 0) !== 1) throw new Error(`Media asset not found: ${assetId}`);
      return { detachedLinks };
    })();
  }

  linkAsset(input: { projectId: string; assetId: string; observationId?: number; role: MediaLinkRole }): MediaAssetLink {
    const existing = this.db.prepare(`
      SELECT * FROM media_asset_links
      WHERE asset_id = ? AND observation_id IS ? AND role = ? LIMIT 1
    `).get(input.assetId, input.observationId ?? null, input.role);
    if (existing) return rowToLink(existing);
    const link: MediaAssetLink = {
      id: randomUUID(),
      assetId: input.assetId,
      projectId: input.projectId,
      ...(input.observationId !== undefined ? { observationId: input.observationId } : {}),
      role: input.role,
      createdAt: Date.now(),
    };
    this.db.prepare(`
      INSERT INTO media_asset_links (id, asset_id, project_id, observation_id, role, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(link.id, link.assetId, link.projectId, link.observationId ?? null, link.role, link.createdAt);
    return link;
  }

  listLinks(projectId: string, assetId: string): MediaAssetLink[] {
    return this.db.prepare(`
      SELECT * FROM media_asset_links WHERE project_id = ? AND asset_id = ? ORDER BY created_at ASC
    `).all(projectId, assetId).map(rowToLink);
  }

  unlinkAsset(projectId: string, assetId: string): number {
    return Number(this.db.prepare(`
      DELETE FROM media_asset_links WHERE project_id = ? AND asset_id = ?
    `).run(projectId, assetId).changes ?? 0);
  }

  addDerivation(input: Omit<MediaDerivation, 'id' | 'createdAt' | 'updatedAt'>): MediaDerivation {
    const now = Date.now();
    const content = sanitizeCredentials(input.content);
    const error = input.error ? sanitizeCredentials(input.error).slice(0, 1_000) : undefined;
    const metadataJson = input.metadata ? JSON.stringify(input.metadata) : null;
    const existing = this.db.prepare(`
      SELECT * FROM media_derivations
      WHERE asset_id = ? AND kind = ? AND profile_key IS ? LIMIT 1
    `).get(input.assetId, input.kind, input.profileKey ?? null);
    if (existing) {
      this.db.prepare(`
        UPDATE media_derivations SET content = ?, metadata_json = ?, status = ?, error = ?, updated_at = ? WHERE id = ?
      `).run(content, metadataJson, input.status, error ?? null, now, existing.id);
      return rowToDerivation(this.db.prepare('SELECT * FROM media_derivations WHERE id = ?').get(existing.id));
    }
    const derivation: MediaDerivation = {
      id: randomUUID(),
      ...input,
      content,
      ...(error ? { error } : {}),
      createdAt: now,
      updatedAt: now,
    };
    this.db.prepare(`
      INSERT INTO media_derivations (id, asset_id, project_id, kind, profile_key, content, metadata_json, status, error, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      derivation.id,
      derivation.assetId,
      derivation.projectId,
      derivation.kind,
      derivation.profileKey ?? null,
      derivation.content,
      metadataJson,
      derivation.status,
      error ?? null,
      now,
      now,
    );
    return derivation;
  }

  listDerivations(projectId: string, assetId: string): MediaDerivation[] {
    return this.db.prepare(`
      SELECT * FROM media_derivations WHERE project_id = ? AND asset_id = ? ORDER BY created_at ASC
    `).all(projectId, assetId).map(rowToDerivation);
  }

  upsertEmbeddingProfile(input: Omit<MediaEmbeddingProfile, 'createdAt'>): MediaEmbeddingProfile {
    const existing = this.db.prepare('SELECT * FROM media_embedding_profiles WHERE profile_key = ?').get(input.key);
    if (existing) return {
      key: existing.profile_key,
      provider: existing.provider,
      model: existing.model,
      dimensions: Number(existing.dimensions),
      modality: existing.modality as MediaKind,
      createdAt: Number(existing.created_at),
    };
    const profile = { ...input, createdAt: Date.now() };
    this.db.prepare(`
      INSERT INTO media_embedding_profiles (profile_key, provider, model, dimensions, modality, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(profile.key, profile.provider, profile.model, profile.dimensions, profile.modality, profile.createdAt);
    return profile;
  }

  upsertEmbedding(input: Omit<MediaEmbedding, 'createdAt' | 'updatedAt'>): MediaEmbedding {
    const now = Date.now();
    this.db.prepare(`
      INSERT INTO media_embeddings (asset_id, project_id, profile_key, intent, dimensions, vector_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(asset_id, profile_key, intent) DO UPDATE SET
        dimensions = excluded.dimensions, vector_json = excluded.vector_json, updated_at = excluded.updated_at
    `).run(
      input.assetId,
      input.projectId,
      input.profileKey,
      input.intent,
      input.dimensions,
      JSON.stringify(input.vector),
      now,
      now,
    );
    return { ...input, createdAt: now, updatedAt: now };
  }

  listEmbeddings(projectId: string, profileKey: string): MediaEmbedding[] {
    const rows = this.db.prepare(`
      SELECT * FROM media_embeddings WHERE project_id = ? AND profile_key = ?
    `).all(projectId, profileKey);
    return rows.flatMap((row: any) => {
      const vector = parseVector(row.vector_json);
      return vector ? [{
        assetId: row.asset_id,
        projectId: row.project_id,
        profileKey: row.profile_key,
        intent: row.intent,
        dimensions: Number(row.dimensions),
        vector,
        createdAt: Number(row.created_at),
        updatedAt: Number(row.updated_at),
      } satisfies MediaEmbedding] : [];
    });
  }

  createJob(input: {
    projectId: string;
    kind: MediaJobKind;
    request: Record<string, unknown>;
    attachOnComplete?: boolean;
    observationTitle?: string;
  }): MediaJob {
    const now = Date.now();
    const job: MediaJob = {
      id: randomUUID(),
      projectId: input.projectId,
      kind: input.kind,
      status: 'queued',
      request: sanitizeRequest(input.request),
      attempts: 0,
      attachOnComplete: input.attachOnComplete === true,
      ...(input.observationTitle ? { observationTitle: sanitizeCredentials(input.observationTitle) } : {}),
      createdAt: now,
      updatedAt: now,
    };
    this.db.prepare(`
      INSERT INTO media_jobs (
        id, project_id, kind, status, request_json, attempts, attach_on_complete,
        observation_title, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      job.id, job.projectId, job.kind, job.status, JSON.stringify(job.request), job.attempts,
      job.attachOnComplete ? 1 : 0, job.observationTitle ?? null, now, now,
    );
    return job;
  }

  getJob(projectId: string, id: string): MediaJob | undefined {
    const row = this.db.prepare('SELECT * FROM media_jobs WHERE project_id = ? AND id = ?').get(projectId, id);
    return row ? rowToJob(row) : undefined;
  }

  updateJob(projectId: string, id: string, input: {
    status: MediaJobStatus;
    providerTaskId?: string;
    assetId?: string;
    lastError?: string;
    incrementAttempts?: boolean;
  }): MediaJob {
    const updated = this.updateJobInternal(projectId, id, input, false);
    if (!updated) throw new Error(`Media job not found: ${id}`);
    return updated;
  }

  /**
   * Atomically preserve a user cancellation against a worker that was already
   * downloading or attaching media when the cancellation arrived.
   */
  updateJobIfNotCancelled(projectId: string, id: string, input: {
    status: MediaJobStatus;
    providerTaskId?: string;
    assetId?: string;
    lastError?: string;
    incrementAttempts?: boolean;
  }): MediaJob | undefined {
    return this.updateJobInternal(projectId, id, input, true);
  }

  private updateJobInternal(projectId: string, id: string, input: {
    status: MediaJobStatus;
    providerTaskId?: string;
    assetId?: string;
    lastError?: string;
    incrementAttempts?: boolean;
  }, rejectCancelled: boolean): MediaJob | undefined {
    const existing = this.getJob(projectId, id);
    if (!existing) return undefined;
    const now = Date.now();
    const attempts = existing.attempts + (input.incrementAttempts ? 1 : 0);
    const completedAt = input.status === 'completed' ? now : null;
    const result = this.db.prepare(`
      UPDATE media_jobs
      SET status = ?, provider_task_id = COALESCE(?, provider_task_id), asset_id = COALESCE(?, asset_id),
          last_error = ?, attempts = ?, updated_at = ?, completed_at = ?
      WHERE project_id = ? AND id = ? ${rejectCancelled ? "AND status <> 'cancelled'" : ''}
    `).run(
      input.status,
      input.providerTaskId ?? null,
      input.assetId ?? null,
      input.lastError ? sanitizeCredentials(input.lastError).slice(0, 1000) : null,
      attempts,
      now,
      completedAt,
      projectId,
      id,
    );
    if (Number(result.changes ?? 0) !== 1) return undefined;
    return this.getJob(projectId, id);
  }

  cancelJob(projectId: string, id: string): MediaJob {
    const job = this.getJob(projectId, id);
    if (!job) throw new Error(`Media job not found: ${id}`);
    if (job.status === 'completed') throw new Error('Completed media jobs cannot be cancelled');
    return this.updateJob(projectId, id, { status: 'cancelled' });
  }

  listUnlinkedAssets(projectId: string): MediaAsset[] {
    const rows = this.db.prepare(`
      SELECT a.* FROM media_assets a
      LEFT JOIN media_asset_links l ON l.asset_id = a.id AND l.project_id = a.project_id
      WHERE a.project_id = ? AND a.deleted_at IS NULL
      GROUP BY a.id
      HAVING COUNT(l.id) = 0
      ORDER BY a.created_at ASC
    `).all(projectId);
    return rows.map(rowToAsset);
  }

  activeByteSize(projectId: string): number {
    const row = this.db.prepare(`
      SELECT COALESCE(SUM(byte_size), 0) AS total FROM media_assets
      WHERE project_id = ? AND deleted_at IS NULL
    `).get(projectId);
    return Number(row?.total ?? 0);
  }

  deleteDerivedData(projectId: string, assetId: string): void {
    this.db.prepare('DELETE FROM media_derivations WHERE project_id = ? AND asset_id = ?').run(projectId, assetId);
    this.db.prepare('DELETE FROM media_embeddings WHERE project_id = ? AND asset_id = ?').run(projectId, assetId);
  }
}
