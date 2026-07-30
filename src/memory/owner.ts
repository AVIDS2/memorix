import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

const ID_PATTERN = /^[A-Za-z0-9:_-]{3,160}$/;

export interface LocalMemoryOwner {
  id: string;
  source: 'environment' | 'local-file';
}

interface OwnerFile {
  version: 1;
  id: string;
  createdAt: string;
}

function ownerPath(dataDir: string): string {
  const resolved = path.resolve(dataDir);
  // The normal runtime data directory is ~/.memorix/data, so keep identity
  // beside it. Custom data directories and isolated tests own their identity
  // inside the supplied directory instead of accidentally sharing a temp root.
  const home = path.basename(resolved).toLocaleLowerCase('en-US') === 'data'
    ? path.dirname(resolved)
    : resolved;
  return path.join(home, 'memorix-user.json');
}

function normalizedOwnerId(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed && ID_PATTERN.test(trimmed) ? trimmed : undefined;
}

async function readOwnerFile(filePath: string): Promise<LocalMemoryOwner | undefined> {
  try {
    const value = JSON.parse(await fs.readFile(filePath, 'utf8')) as Partial<OwnerFile>;
    const id = typeof value.id === 'string' ? normalizedOwnerId(value.id) : undefined;
    return id ? { id, source: 'local-file' } : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Resolve a local stable user identity without deriving anything from prompts,
 * host names, or account details. Reads do not create an identity; first write
 * creates one atomically enough for normal local CLI/MCP use.
 */
export async function resolveLocalMemoryOwner(
  dataDir: string,
  options: { create?: boolean } = {},
): Promise<LocalMemoryOwner | undefined> {
  const configured = normalizedOwnerId(process.env.MEMORIX_USER_ID);
  if (configured) return { id: configured, source: 'environment' };

  const filePath = ownerPath(dataDir);
  const existing = await readOwnerFile(filePath);
  if (existing || !options.create) return existing;

  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const created: OwnerFile = {
    version: 1,
    id: 'local-' + randomUUID(),
    createdAt: new Date().toISOString(),
  };
  try {
    await fs.writeFile(filePath, JSON.stringify(created, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' });
    return { id: created.id, source: 'local-file' };
  } catch (error: any) {
    if (error?.code !== 'EEXIST') throw error;
    const concurrent = await readOwnerFile(filePath);
    if (concurrent) return concurrent;
    throw new Error('Memorix could not establish a valid local memory owner identity.');
  }
}
