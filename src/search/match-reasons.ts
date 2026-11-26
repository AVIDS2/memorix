/**
 * 向量排序留下和纯词法 fuzzy 分开的标记。
 * mode 为 vector 或 vector-only 时，没有字段贴上就标 vector，不再只剩 fuzzy。
 */
export function labelMatchReasons(fieldHits: readonly string[], mode: string): string[] {
  const reasons = [...fieldHits];
  const rankedByVector = mode === 'vector' || mode.startsWith('vector-only') || mode.startsWith('vector ');
  if (reasons.length === 0) reasons.push(rankedByVector ? 'vector' : 'fuzzy');
  else if (rankedByVector && !reasons.includes('vector')) reasons.push('vector');
  return reasons;
}

const OVERLAP_SYNONYMS: Array<[string, string[]]> = [
  ['密钥', ['凭据', 'credential', 'secret']],
  ['泄露', ['leak']],
  ['复盘', ['收尾']],
];

export function queryOverlapTokens(query: string): string[] {
  const raw = query.normalize('NFKC').toLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? [];
  const tokens = new Set<string>();
  for (const token of raw) {
    if (token.length > 1) tokens.add(token);
    for (const run of token.match(/[\u4e00-\u9fff]+/gu) ?? []) {
      for (let index = 0; index < run.length - 1; index += 1) tokens.add(run.slice(index, index + 2));
      for (const [needle, extras] of OVERLAP_SYNONYMS) {
        if (!run.includes(needle)) continue;
        for (const extra of extras) tokens.add(extra);
      }
    }
  }
  return [...tokens];
}

export function textOverlap(text: string, tokens: readonly string[]): number {
  const haystack = text.toLowerCase();
  return tokens.reduce((count, token) => count + (haystack.includes(token) ? 1 : 0), 0);
}

/**
 * 窗口里词重叠更少的位置，换成窗口外重叠严格更多的近邻。
 * 第 1 名保持不动。重叠数相同则保持原来的顺序。
 */
export function promoteOverlappingNeighbors<T extends { title?: string; entityName?: string }>(
  entries: readonly T[],
  limit: number,
  tokens: readonly string[],
): T[] {
  const next = [...entries];
  if (tokens.length === 0 || limit <= 1) return next;
  const overlapOf = (entry: T) => textOverlap(`${entry.title ?? ''} ${entry.entityName ?? ''}`, tokens);
  for (;;) {
    let weakestIndex = -1;
    let weakestOverlap = Number.POSITIVE_INFINITY;
    const window = Math.min(limit, next.length);
    for (let index = 1; index < window; index += 1) {
      const overlap = overlapOf(next[index]);
      if (overlap < weakestOverlap) {
        weakestOverlap = overlap;
        weakestIndex = index;
      }
    }
    let strongestIndex = -1;
    let strongestOverlap = -1;
    for (let index = limit; index < next.length; index += 1) {
      const overlap = overlapOf(next[index]);
      if (overlap > strongestOverlap) {
        strongestOverlap = overlap;
        strongestIndex = index;
      }
    }
    if (weakestIndex === -1 || strongestIndex === -1 || strongestOverlap <= weakestOverlap) break;
    const displaced = next[weakestIndex];
    next[weakestIndex] = next[strongestIndex];
    next[strongestIndex] = displaced;
  }
  return next;
}
