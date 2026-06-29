import type { CodeFile, CodeRefStatus, CodeSymbol, ObservationCodeRef } from './types.js';

export interface CodeRefFreshness {
  status: CodeRefStatus;
  reason: string;
}

export function evaluateCodeRefFreshness(
  ref: ObservationCodeRef,
  file?: CodeFile,
  symbol?: CodeSymbol,
): CodeRefFreshness {
  if (!file) {
    return { status: 'stale', reason: 'referenced file is no longer indexed' };
  }

  if (ref.symbolId && !symbol) {
    return { status: 'stale', reason: 'referenced symbol is no longer indexed' };
  }

  if (ref.capturedSymbolHash && symbol?.contentHash) {
    if (symbol.contentHash !== ref.capturedSymbolHash) {
      return { status: 'stale', reason: 'referenced symbol content changed' };
    }
    return { status: 'current', reason: 'referenced symbol content still matches' };
  }

  if (ref.capturedFileHash && file.contentHash !== ref.capturedFileHash) {
    return { status: 'suspect', reason: 'referenced file changed since capture' };
  }

  return { status: 'current', reason: 'referenced file still matches' };
}
