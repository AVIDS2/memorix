import { describe, expect, it } from 'vitest';
import { labelMatchReasons, promoteOverlappingNeighbors, queryOverlapTokens } from '../../src/search/match-reasons.js';

describe('labelMatchReasons', () => {
  it('marks a vector hit that shares no field tokens as vector, not fuzzy', () => {
    expect(labelMatchReasons([], 'vector')).toEqual(['vector']);
  });

  it('keeps a lexical miss as fuzzy when the mode is hybrid', () => {
    expect(labelMatchReasons([], 'hybrid')).toEqual(['fuzzy']);
  });

  it('appends vector beside real field hits', () => {
    expect(labelMatchReasons(['title', 'narrative'], 'vector')).toEqual(['title', 'narrative', 'vector']);
  });

  it('treats vector-only fallback as vector ranking', () => {
    expect(labelMatchReasons([], 'vector-only (hybrid empty fallback)')).toEqual(['vector']);
  });
});

describe('promoteOverlappingNeighbors', () => {
  it('swaps a zero-overlap card inside the window with an overlapping neighbor outside it', () => {
    const entries = [
      { title: 'clash yaml 双端' },
      { title: 'Ollama pull insecure' },
      { title: 'CMFA 导入 yaml' },
    ];
    const promoted = promoteOverlappingNeighbors(entries, 2, ['clash', 'yaml', '导入']);
    expect(promoted.map((entry) => entry.title)[1]).toBe('CMFA 导入 yaml');
  });

  it('keeps the first hit and replaces a weaker later hit with a stronger neighbor', () => {
    const entries = [
      { title: '语义第一名没有这些词' },
      { title: 'clash' },
      { title: 'clash yaml dialer proxy CMFA 导入' },
    ];
    const promoted = promoteOverlappingNeighbors(entries, 2, ['clash', 'yaml', 'dialer', 'proxy', 'cmfa', '导入']);
    expect(promoted[0].title).toBe('语义第一名没有这些词');
    expect(promoted[1].title).toBe('clash yaml dialer proxy CMFA 导入');
  });

  it('keeps a zero-overlap first hit when nothing outside the window shares a query token', () => {
    const entries = [
      { title: '语义改写没有共同词' },
      { title: '另一个零重叠' },
    ];
    expect(promoteOverlappingNeighbors(entries, 1, ['完全不同的词'])).toEqual(entries);
  });
});

describe('queryOverlapTokens', () => {
  it('bridges 密钥泄露复盘 to the words on the secrets-scan card', () => {
    const tokens = queryOverlapTokens('提交代码前没有拦住密钥泄露怎么复盘');
    expect(tokens).toContain('凭据');
    expect(tokens).toContain('收尾');
    expect(tokens).toContain('credential');
  });
});
