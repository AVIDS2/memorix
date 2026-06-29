import type { CodeFile, CodeSymbol, ObservationCodeRef } from './types.js';
import { makeObservationCodeRefId, normalizeCodePath } from './ids.js';
import type { CodeGraphStore } from './store.js';

export interface BindableObservation {
  id: number;
  projectId: string;
  title: string;
  narrative: string;
  facts?: string[];
  filesModified?: string[];
  createdAt: string;
}

export interface CodeRefBackfillResult {
  observationsScanned: number;
  observationsBackfilled: number;
  refsBackfilled: number;
}

function observationText(obs: BindableObservation): string {
  return [obs.title, obs.narrative, ...(obs.facts ?? [])].join('\n');
}

function mentionsSymbol(text: string, symbol: CodeSymbol): boolean {
  const name = symbol.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^\\w$])${name}([^\\w$]|$)`).test(text);
}

function fileRef(projectId: string, obs: BindableObservation, file: CodeFile): ObservationCodeRef {
  return {
    id: makeObservationCodeRefId(projectId, obs.id, file.id),
    projectId,
    observationId: obs.id,
    fileId: file.id,
    capturedFileHash: file.contentHash,
    status: 'current',
    reason: 'bound by file path',
    createdAt: obs.createdAt,
  };
}

function symbolRef(projectId: string, obs: BindableObservation, file: CodeFile, symbol: CodeSymbol): ObservationCodeRef {
  return {
    id: makeObservationCodeRefId(projectId, obs.id, file.id, symbol.id),
    projectId,
    observationId: obs.id,
    fileId: file.id,
    symbolId: symbol.id,
    capturedFileHash: file.contentHash,
    ...(symbol.contentHash ? { capturedSymbolHash: symbol.contentHash } : {}),
    status: 'current',
    reason: 'bound by symbol mention',
    createdAt: obs.createdAt,
  };
}

export async function bindObservationToCode(
  store: CodeGraphStore,
  obs: BindableObservation,
): Promise<ObservationCodeRef[]> {
  const refs = new Map<string, ObservationCodeRef>();
  const text = observationText(obs);
  const candidateFiles = new Map<string, CodeFile>();

  for (const rawPath of obs.filesModified ?? []) {
    const file = store.getFile(obs.projectId, normalizeCodePath(rawPath));
    if (!file) continue;
    candidateFiles.set(file.id, file);
    const ref = fileRef(obs.projectId, obs, file);
    refs.set(ref.id, ref);
  }

  const symbols = store.findSymbols(obs.projectId, '', 500);
  for (const symbol of symbols) {
    if (!mentionsSymbol(text, symbol)) continue;
    const file = candidateFiles.get(symbol.fileId) ?? store.getFile(obs.projectId, symbol.path);
    if (!file) continue;
    candidateFiles.set(file.id, file);
    const ref = symbolRef(obs.projectId, obs, file, symbol);
    refs.set(ref.id, ref);
  }

  const result = [...refs.values()];
  store.replaceObservationRefs(obs.projectId, obs.id, result);
  return result;
}

export async function backfillMissingObservationCodeRefs(
  store: CodeGraphStore,
  observations: BindableObservation[],
): Promise<CodeRefBackfillResult> {
  let observationsBackfilled = 0;
  let refsBackfilled = 0;

  for (const observation of observations) {
    if (store.listObservationRefs(observation.projectId, observation.id).length > 0) continue;
    const refs = await bindObservationToCode(store, observation);
    if (refs.length === 0) continue;
    observationsBackfilled += 1;
    refsBackfilled += refs.length;
  }

  return {
    observationsScanned: observations.length,
    observationsBackfilled,
    refsBackfilled,
  };
}
