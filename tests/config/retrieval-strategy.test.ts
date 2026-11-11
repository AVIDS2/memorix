import { afterEach, describe, expect, it } from 'vitest';
import { getResolvedConfig, resetResolvedConfigCache } from '../../src/config/resolved-config.js';
import { isCjkHeavyQuery, normalizeRetrievalStrategy } from '../../src/config/retrieval-strategy.js';

const HOME = 'D:/memorix-retrieval-strategy-test-home';

afterEach(() => {
  delete process.env.MEMORIX_RETRIEVAL_CJK;
  delete process.env.MEMORIX_RETRIEVAL_ASCII;
  resetResolvedConfigCache();
});

describe('retrieval strategy', () => {
  it('treats a Chinese paraphrase as CJK and an ASCII token as not', () => {
    expect(isCjkHeavyQuery('服务端说工具已连接但是模型看不见')).toBe(true);
    expect(isCjkHeavyQuery('minimax')).toBe(false);
    expect(normalizeRetrievalStrategy('vector')).toBe('vector');
    expect(normalizeRetrievalStrategy('nope')).toBeUndefined();
  });

  it('defaults CJK to vector and ASCII to hybrid, with env override', () => {
    resetResolvedConfigCache();
    expect(getResolvedConfig({ projectRoot: null, homeDir: HOME }).retrieval).toEqual({
      cjk: 'vector',
      ascii: 'hybrid',
    });

    process.env.MEMORIX_RETRIEVAL_CJK = 'hybrid';
    process.env.MEMORIX_RETRIEVAL_ASCII = 'vector';
    resetResolvedConfigCache();
    expect(getResolvedConfig({ projectRoot: null, homeDir: HOME }).retrieval).toEqual({
      cjk: 'hybrid',
      ascii: 'vector',
    });
  });
});
