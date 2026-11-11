import { isAbsolute, relative, resolve } from 'node:path';
import { sanitizeCredentials } from '../memory/secret-filter.js';
import { isCodeGraphExcludedPath } from './exclude.js';
import { normalizeCodePath } from './ids.js';
import type { CodeGraphOutline, ExternalCodeGraphRelation, ExternalCodeGraphSymbol } from './types.js';

/**
 * SCIP is intentionally an input boundary here, not a second persistence
 * format. The normalized outline is bounded and remains separate from the
 * canonical local CodeGraph tables.
 */
export interface ScipOutlineOptions {
  projectRoot: string;
  exclude?: string[];
  maxNodes?: number;
  maxEdges?: number;
  maxFiles?: number;
}

const DEFAULT_MAX_NODES = 16;
const DEFAULT_MAX_EDGES = 24;
const DEFAULT_MAX_FILES = 12;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function text(value: unknown, max = 240): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = sanitizeCredentials(value).replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim();
  return normalized && normalized.length <= max ? normalized : undefined;
}

function safeRelativePath(projectRoot: string, value: unknown, exclude?: string[]): string | undefined {
  const raw = text(value, 1_024);
  if (!raw || isAbsolute(raw)) return undefined;
  const absolute = resolve(projectRoot, raw);
  const fromRoot = relative(resolve(projectRoot), absolute);
  if (!fromRoot || fromRoot === '..' || fromRoot.startsWith('..\\') || fromRoot.startsWith('../') || isAbsolute(fromRoot)) return undefined;
  const normalized = normalizeCodePath(fromRoot);
  return isCodeGraphExcludedPath(normalized, exclude) ? undefined : normalized;
}

function integer(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined;
}

function lineFromRange(value: unknown): number | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  const line = integer(value[0]);
  return line === undefined ? undefined : line + 1;
}

function symbolKind(value: unknown): string {
  if (typeof value === 'string' && value.trim()) return value.trim().slice(0, 80);
  if (typeof value === 'number' && Number.isInteger(value)) return `scip-kind-${value}`;
  return 'symbol';
}

function symbolName(symbolId: string, value: unknown): string {
  const displayName = text(value, 180);
  if (displayName) return displayName;
  const pieces = symbolId.split(/[/#.:]/).filter(Boolean);
  return (pieces[pieces.length - 1] || symbolId).slice(0, 180);
}

function relationKind(relationship: Record<string, unknown>): string {
  if (relationship.isImplementation === true || relationship.is_implementation === true) return 'implements';
  if (relationship.isDefinition === true || relationship.is_definition === true) return 'defines';
  if (relationship.isReference === true || relationship.is_reference === true) return 'references';
  return 'references';
}

interface ScipNodeInfo {
  symbolId: string;
  node: ExternalCodeGraphSymbol;
  defined: boolean;
  line?: number;
  relationships: Array<{ target: string; kind: string }>;
}

/** Normalize a bounded `scip print --json` payload into Memorix's outline. */
export function normalizeScipOutline(value: unknown, options: ScipOutlineOptions): CodeGraphOutline | undefined {
  if (!isRecord(value) || !Array.isArray(value.documents)) return undefined;
  const maxNodes = Math.max(2, Math.min(64, Math.floor(options.maxNodes ?? DEFAULT_MAX_NODES)));
  const maxEdges = Math.max(1, Math.min(96, Math.floor(options.maxEdges ?? DEFAULT_MAX_EDGES)));
  const maxFiles = Math.max(1, Math.min(32, Math.floor(options.maxFiles ?? DEFAULT_MAX_FILES)));
  const nodes = new Map<string, ScipNodeInfo>();
  const relatedFiles = new Set<string>();
  const definitions = new Set<string>();

  for (const document of value.documents.slice(0, maxFiles * 4)) {
    if (!isRecord(document)) continue;
    const filePath = safeRelativePath(options.projectRoot, document.relativePath ?? document.relative_path, options.exclude);
    if (!filePath || relatedFiles.size >= maxFiles && !relatedFiles.has(filePath)) continue;
    relatedFiles.add(filePath);
    const occurrences = Array.isArray(document.occurrences) ? document.occurrences : [];
    const definitionLines = new Map<string, number>();
    for (const occurrence of occurrences) {
      if (!isRecord(occurrence)) continue;
      const id = text(occurrence.symbol, 240);
      const isDefinition = occurrence.isDefinition === true || occurrence.is_definition === true;
      const rawRoles = occurrence.symbolRoles ?? occurrence.symbol_roles;
      if (!id || (rawRoles === undefined && !isDefinition)) continue;
      const roles = integer(rawRoles) ?? 0;
      // SCIP SymbolRole.Definition is bit 1. Accept the explicit boolean used
      // by a few JSON emitters as well, without trusting arbitrary roles.
      if ((roles & 1) !== 0 || isDefinition) {
        definitions.add(id);
        const line = lineFromRange(occurrence.range);
        if (line !== undefined) definitionLines.set(id, line);
      }
    }

    const symbolInfos = Array.isArray(document.symbols) ? document.symbols : [];
    for (const rawSymbol of symbolInfos) {
      if (!isRecord(rawSymbol)) continue;
      const id = text(rawSymbol.symbol, 240);
      if (!id || nodes.has(id)) continue;
      const relationships: Array<{ target: string; kind: string }> = [];
      if (Array.isArray(rawSymbol.relationships)) {
        for (const rawRelationship of rawSymbol.relationships.slice(0, 32)) {
          if (!isRecord(rawRelationship)) continue;
          const target = text(rawRelationship.symbol, 240);
          if (target) relationships.push({ target, kind: relationKind(rawRelationship) });
        }
      }
      nodes.set(id, {
        symbolId: id,
        node: {
          id,
          name: symbolName(id, rawSymbol.displayName ?? rawSymbol.display_name),
          qualifiedName: text(rawSymbol.displayName ?? rawSymbol.display_name, 220),
          kind: symbolKind(rawSymbol.kind),
          path: filePath,
          language: text(document.language, 80),
          ...(definitionLines.has(id) ? { startLine: definitionLines.get(id) } : {}),
        },
        defined: definitions.has(id),
        ...(definitionLines.has(id) ? { line: definitionLines.get(id) } : {}),
        relationships,
      });
    }
  }

  if (nodes.size === 0) return undefined;

  const selectedNodes = [...nodes.values()]
    .sort((left, right) => Number(right.defined) - Number(left.defined) || left.node.path.localeCompare(right.node.path) || left.node.name.localeCompare(right.node.name))
    .slice(0, maxNodes);
  const selectedById = new Map(selectedNodes.map(item => [item.symbolId, item]));
  const relations: ExternalCodeGraphRelation[] = [];
  for (const source of selectedNodes) {
    for (const relationship of source.relationships) {
      const target = selectedById.get(relationship.target);
      if (!target || relations.length >= maxEdges) continue;
      relations.push({
        from: source.node,
        to: target.node,
        kind: relationship.kind,
        ...(source.line ? { line: source.line } : {}),
      });
    }
  }

  const entryPoints = selectedNodes
    .filter(item => item.defined)
    .slice(0, 5)
    .map(item => item.node);
  return {
    provider: 'external',
    entryPoints: entryPoints.length > 0 ? entryPoints : selectedNodes.slice(0, 5).map(item => item.node),
    relations,
    relatedFiles: [...new Set(selectedNodes.map(item => item.node.path))].slice(0, maxFiles),
    stats: {
      nodes: nodes.size,
      edges: relations.length,
      files: relatedFiles.size,
    },
  };
}
