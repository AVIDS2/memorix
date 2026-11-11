import path from 'node:path';
import type { ResolvedMemorixConfig } from '../config/resolved-config.js';

type Frozen<T> = T extends readonly (infer Item)[]
  ? readonly Frozen<Item>[]
  : T extends object
    ? { readonly [Key in keyof T]: Frozen<T[Key]> }
    : T;

export interface RuntimeContext {
  readonly projectId: string;
  readonly projectRoot: string;
  readonly dataDir: string;
  readonly config: Frozen<ResolvedMemorixConfig>;
}

function freezeTree<T>(value: T): Frozen<T> {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freezeTree(child);
    Object.freeze(value);
  }
  return value as Frozen<T>;
}

/** Capture one verified project and its resolved config for a request. */
export function createRuntimeContext(input: {
  projectId: string;
  projectRoot: string;
  dataDir: string;
  config: ResolvedMemorixConfig;
}): RuntimeContext {
  const projectId = input.projectId.trim();
  if (!projectId || !input.projectRoot.trim() || !input.dataDir.trim()) {
    throw new Error('Runtime context requires a resolved project and data directory');
  }
  return Object.freeze({
    projectId,
    projectRoot: path.resolve(input.projectRoot),
    dataDir: path.resolve(input.dataDir),
    config: freezeTree(structuredClone(input.config)),
  });
}
