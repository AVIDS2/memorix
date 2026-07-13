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

function identifierCandidates(text: string): string[] {
  return [...new Set(text.match(/[A-Za-z_$][\w$]*(?:::[A-Za-z_$][\w$]*)*[!?=]?/g) ?? [])];
}

function codeIdentifierCandidates(text: string): string[] {
  const explicit = new Set<string>();
  for (const match of text.matchAll(/`([A-Za-z_$][\w$]*(?:::[A-Za-z_$][\w$]*)*[!?=]?)`/g)) explicit.add(match[1]);
  for (const match of text.matchAll(/\b([A-Za-z_$][\w$]*(?:::[A-Za-z_$][\w$]*)*[!?=]?)\s*\(/g)) explicit.add(match[1]);
  return identifierCandidates(text).filter(candidate =>
    explicit.has(candidate) ||
    candidate.includes('::') ||
    /[!?=]$/.test(candidate) ||
    /^[A-Z]/.test(candidate) ||
    /[_$]/.test(candidate) ||
    /[a-z0-9][A-Z]/.test(candidate) ||
    /[A-Z]{2}/.test(candidate));
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

interface CodeBindingLookup {
  findFile(path: string): CodeFile | undefined;
  findSymbols(names: string[], hintedFileIds: string[]): CodeSymbol[];
}

function resolveObservationCodeRefs(
  obs: BindableObservation,
  lookup: CodeBindingLookup,
): ObservationCodeRef[] {
  const refs = new Map<string, ObservationCodeRef>();
  const text = observationText(obs);
  const candidateFiles = new Map<string, CodeFile>();

  for (const rawPath of obs.filesModified ?? []) {
    const file = lookup.findFile(normalizeCodePath(rawPath));
    if (!file) continue;
    candidateFiles.set(file.id, file);
    const ref = fileRef(obs.projectId, obs, file);
    refs.set(ref.id, ref);
  }

  const hintedFileIds = new Set(candidateFiles.keys());
  const symbolNames = hintedFileIds.size > 0 ? identifierCandidates(text) : codeIdentifierCandidates(text);
  const symbols = lookup.findSymbols(symbolNames, [...hintedFileIds]);
  const symbolsByName = new Map<string, CodeSymbol[]>();
  for (const symbol of symbols) {
    const group = symbolsByName.get(symbol.name) ?? [];
    group.push(symbol);
    symbolsByName.set(symbol.name, group);
  }

  for (const group of symbolsByName.values()) {
    const candidates = group.length === 1 ? group : [];
    for (const symbol of candidates) {
      if (!mentionsSymbol(text, symbol)) continue;
      const file = candidateFiles.get(symbol.fileId) ?? lookup.findFile(symbol.path);
      if (!file) continue;
      candidateFiles.set(file.id, file);
      const ref = symbolRef(obs.projectId, obs, file, symbol);
      refs.set(ref.id, ref);
    }
  }

  return [...refs.values()];
}

function createStoreLookup(store: CodeGraphStore, projectId: string): CodeBindingLookup {
  return {
    findFile: path => store.getFile(projectId, path) ?? undefined,
    findSymbols: (names, hintedFileIds) => store.findSymbolsByNames(projectId, names, hintedFileIds),
  };
}

function createSnapshotLookup(files: CodeFile[], symbols: CodeSymbol[]): CodeBindingLookup {
  const filesByPath = new Map(files.map(file => [normalizeCodePath(file.path), file]));
  const symbolsByName = new Map<string, CodeSymbol[]>();
  for (const symbol of symbols) {
    const group = symbolsByName.get(symbol.name) ?? [];
    group.push(symbol);
    symbolsByName.set(symbol.name, group);
  }

  return {
    findFile: path => filesByPath.get(normalizeCodePath(path)),
    findSymbols: (names, hintedFileIds) => {
      const hinted = new Set(hintedFileIds);
      const found: CodeSymbol[] = [];
      for (const name of names) {
        const candidates = symbolsByName.get(name) ?? [];
        found.push(...(hinted.size > 0 ? candidates.filter(symbol => hinted.has(symbol.fileId)) : candidates));
      }
      return found;
    },
  };
}

export async function bindObservationToCode(
  store: CodeGraphStore,
  obs: BindableObservation,
): Promise<ObservationCodeRef[]> {
  const refs = resolveObservationCodeRefs(obs, createStoreLookup(store, obs.projectId));
  store.replaceObservationRefs(obs.projectId, obs.id, refs);
  return refs;
}

export async function backfillMissingObservationCodeRefs(
  store: CodeGraphStore,
  observations: BindableObservation[],
): Promise<CodeRefBackfillResult> {
  let observationsBackfilled = 0;
  let refsBackfilled = 0;
  const boundObservationIdsByProject = new Map<string, Set<number>>();
  const lookupByProject = new Map<string, CodeBindingLookup>();

  for (const projectId of new Set(observations.map(observation => observation.projectId))) {
    boundObservationIdsByProject.set(
      projectId,
      new Set(store.listProjectObservationRefs(projectId).map(ref => ref.observationId)),
    );
    lookupByProject.set(
      projectId,
      createSnapshotLookup(store.listFiles(projectId), store.listSymbols(projectId)),
    );
  }

  const refsToInsert: ObservationCodeRef[] = [];
  for (const observation of observations) {
    if (boundObservationIdsByProject.get(observation.projectId)?.has(observation.id)) continue;
    if ((observation.filesModified?.length ?? 0) === 0 && codeIdentifierCandidates(observationText(observation)).length === 0) {
      continue;
    }
    const lookup = lookupByProject.get(observation.projectId);
    if (!lookup) continue;
    const refs = resolveObservationCodeRefs(observation, lookup);
    if (refs.length === 0) continue;
    observationsBackfilled += 1;
    refsBackfilled += refs.length;
    refsToInsert.push(...refs);
  }
  store.upsertObservationRefs(refsToInsert);

  return {
    observationsScanned: observations.length,
    observationsBackfilled,
    refsBackfilled,
  };
}
