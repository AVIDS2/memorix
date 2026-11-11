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
