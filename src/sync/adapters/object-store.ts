/**
 * S3-compatible object-store sync.
 *
 * Configuration is read from:
 * - MEMORIX_SYNC_S3_BUCKET
 * - MEMORIX_SYNC_S3_ENDPOINT
 * - MEMORIX_SYNC_S3_ACCESS_KEY_ID
 * - MEMORIX_SYNC_S3_SECRET_ACCESS_KEY
 * - MEMORIX_SYNC_S3_REGION
 * - MEMORIX_SYNC_S3_PREFIX (optional; key namespace so a shared bucket can
 *   host other data or several independent stores)
 */

import { emptyCursor } from '../types.js';
import type { ChangeBatch, SyncCursor, SyncRemote } from '../types.js';

export interface ObjectStoreClient {
  putIfAbsent(key: string, body: string): Promise<void>;
  get(key: string): Promise<string | undefined>;
  put(key: string, body: string): Promise<void>;
  list(prefix: string): Promise<string[]>;
}

interface BatchObject {
  key: string;
  deviceId: string;
  sequence: number;
}

const SEQUENCE_WIDTH = 20;
const BATCH_KEY = /^batches\/([^/]+)\/(\d+)\.json$/;

export class ObjectStoreRemote implements SyncRemote {
  readonly kind = 's3';
  /** Key namespace so a shared bucket can host other data or several stores. */
  private readonly prefix: string;

  constructor(private readonly client: ObjectStoreClient, prefix = '') {
    this.prefix = prefix === '' ? '' : `${prefix.replace(/\/+$/, '')}/`;
  }

  async init(): Promise<void> {}

  async getCursor(deviceId: string): Promise<SyncCursor> {
    const body = await this.client.get(`${this.prefix}cursors/${deviceId}.json`);
    return body === undefined ? emptyCursor() : JSON.parse(body) as SyncCursor;
  }

  async setCursor(deviceId: string, cursor: SyncCursor): Promise<void> {
    await this.client.put(`${this.prefix}cursors/${deviceId}.json`, JSON.stringify(cursor));
  }

  async push(batch: ChangeBatch): Promise<void> {
    const sequence = String(batch.sequence).padStart(SEQUENCE_WIDTH, '0');
    await this.client.putIfAbsent(
      `${this.prefix}batches/${batch.deviceId}/${sequence}.json`,
      JSON.stringify(batch),
    );
  }

  async pull(since: Record<string, number>): Promise<ChangeBatch[]> {
    const objects: BatchObject[] = [];
    for (const key of await this.client.list(`${this.prefix}batches/`)) {
      const match = BATCH_KEY.exec(key.slice(this.prefix.length));
      if (match === null) continue;
      const [, deviceId, encodedSequence] = match;
      const sequence = Number(encodedSequence);
      if (!Number.isSafeInteger(sequence) || sequence <= (since[deviceId] ?? 0)) continue;
      objects.push({ key, deviceId, sequence });
    }

    objects.sort((left, right) => {
      if (left.deviceId < right.deviceId) return -1;
      if (left.deviceId > right.deviceId) return 1;
      return left.sequence - right.sequence;
    });

    const batches: ChangeBatch[] = [];
    for (const object of objects) {
      const body = await this.client.get(object.key);
      if (body !== undefined) batches.push(JSON.parse(body) as ChangeBatch);
    }
    return batches;
  }

  async close(): Promise<void> {}
}

type S3Command = new (input: Record<string, unknown>) => unknown;

interface S3Response {
  Body?: { transformToString(): Promise<string> };
  Contents?: Array<{ Key?: string }>;
  IsTruncated?: boolean;
  NextContinuationToken?: string;
  $metadata?: { httpStatusCode?: number };
}

interface S3Client {
  send(command: unknown): Promise<S3Response>;
}

interface S3Module {
  S3Client: new (config: Record<string, unknown>) => S3Client;
  GetObjectCommand: S3Command;
  ListObjectsV2Command: S3Command;
  PutObjectCommand: S3Command;
}

export async function createS3ObjectStore(
  env: NodeJS.ProcessEnv = process.env,
): Promise<ObjectStoreClient> {
  const bucket = requiredEnv(env, 'MEMORIX_SYNC_S3_BUCKET');
  const endpoint = requiredEnv(env, 'MEMORIX_SYNC_S3_ENDPOINT');
  const accessKeyId = requiredEnv(env, 'MEMORIX_SYNC_S3_ACCESS_KEY_ID');
  const secretAccessKey = requiredEnv(env, 'MEMORIX_SYNC_S3_SECRET_ACCESS_KEY');
  const region = requiredEnv(env, 'MEMORIX_SYNC_S3_REGION');

  const moduleName = '@aws-sdk/client-s3';
  // The SDK is optional by design, so a static import would make every install require it.
  let sdk: S3Module;
  try {
    sdk = await import(moduleName) as unknown as S3Module;
  } catch (cause) {
    throw new Error(
      'S3 sync requires @aws-sdk/client-s3. Install it in the application using Memorix.',
      { cause },
    );
  }

  const s3 = new sdk.S3Client({
    endpoint,
    region,
    credentials: { accessKeyId, secretAccessKey },
  });

  const client: ObjectStoreClient = {
    async putIfAbsent(key, body) {
      try {
        await s3.send(new sdk.PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: body,
          IfNoneMatch: '*',
        }));
      } catch (error) {
        if (!isPreconditionFailure(error)) throw error;
      }
    },

    async get(key) {
      try {
        const response = await s3.send(new sdk.GetObjectCommand({ Bucket: bucket, Key: key }));
        return response.Body?.transformToString();
      } catch (error) {
        if (isNotFound(error)) return undefined;
        throw error;
      }
    },

    async put(key, body) {
      await s3.send(new sdk.PutObjectCommand({ Bucket: bucket, Key: key, Body: body }));
    },

    async list(prefix) {
      const keys: string[] = [];
      let continuationToken: string | undefined;
      do {
        const response = await s3.send(new sdk.ListObjectsV2Command({
          Bucket: bucket,
          Prefix: prefix,
          ContinuationToken: continuationToken,
        }));
        for (const object of response.Contents ?? []) {
          if (object.Key !== undefined) keys.push(object.Key);
        }
        continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
      } while (continuationToken !== undefined);
      return keys;
    },
  };

  return client;
}

function requiredEnv(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`Missing required environment variable ${name}`);
  }
  return value;
}

function errorDetails(error: unknown): { name?: string; status?: number } {
  if (typeof error !== 'object' || error === null) return {};
  const candidate = error as { name?: unknown; $metadata?: { httpStatusCode?: unknown } };
  return {
    name: typeof candidate.name === 'string' ? candidate.name : undefined,
    status: typeof candidate.$metadata?.httpStatusCode === 'number'
      ? candidate.$metadata.httpStatusCode
      : undefined,
  };
}

function isPreconditionFailure(error: unknown): boolean {
  const details = errorDetails(error);
  return details.status === 412 || details.name === 'PreconditionFailed';
}

function isNotFound(error: unknown): boolean {
  const details = errorDetails(error);
  return details.status === 404 || details.name === 'NoSuchKey' || details.name === 'NotFound';
}
