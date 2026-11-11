import { describe, it, expect, vi, beforeEach } from 'vitest';
import { compressNarrative, rerankResults, type RerankCandidate } from '../../src/llm/quality.js';
import * as provider from '../../src/llm/provider.js';

// ── Mock LLM provider ───────────────────────────────────────────

vi.mock('../../src/llm/provider.js', () => ({
  isLLMEnabled: vi.fn(() => false),
  callLLM: vi.fn(async () => ({ content: '' })),
}));

const mockIsLLMEnabled = vi.mocked(provider.isLLMEnabled);
const mockCallLLM = vi.mocked(provider.callLLM);

function setLLM(enabled: boolean, response = '') {
  mockIsLLMEnabled.mockReturnValue(enabled);
  mockCallLLM.mockResolvedValue({ content: response });
}

// ── Narrative Compression Tests ──────────────────────────────────

describe('compressNarrative', () => {
  beforeEach(() => setLLM(false));

  it('should return original when LLM is disabled', async () => {
    const { compressed, saved, usedLLM } = await compressNarrative('A long narrative about something important');
    expect(compressed).toBe('A long narrative about something important');
    expect(saved).toBe(0);
    expect(usedLLM).toBe(false);
  });

  it('should skip short narratives even with LLM enabled', async () => {
    setLLM(true, 'compressed');
    const { compressed, usedLLM } = await compressNarrative('Short text');
    expect(compressed).toBe('Short text');
    expect(usedLLM).toBe(false);
  });

  it('should compress long narratives with LLM', async () => {
    const longNarrative = '我在调试过程中发现JWT token的refresh机制存在问题，具体来说是因为服务端没有实现自动续签，导致用户在24小时后会遇到静默的认证失败，之前我一直以为是网络问题但后来排查发现是token过期了，所以我们需要修复这个问题。这个bug影响了所有使用JWT认证的用户，需要在下一个版本中优先修复，否则会导致大量用户投诉。';
    setLLM(true, 'JWT refresh无自动续签→24h后静默认证失败');

    const { compressed, saved, usedLLM } = await compressNarrative(longNarrative);
    expect(compressed).toBe('JWT refresh无自动续签→24h后静默认证失败');
    expect(saved).toBeGreaterThan(0);
    expect(usedLLM).toBe(true);
  });

  it('should keep original if LLM returns longer text', async () => {
    const original = 'A moderately long narrative that we want to compress into something shorter for storage efficiency';
    setLLM(true, original + ' but now it is even longer than before');

    const { compressed } = await compressNarrative(original);
    expect(compressed).toBe(original);
  });

  it('should include facts context in prompt', async () => {
    setLLM(true, 'compressed version');
    const narrative = 'A long narrative about database migration from MySQL to PostgreSQL with various considerations and tradeoffs that we discussed at length during the architecture review meeting last week and need to document properly for future reference';

    await compressNarrative(narrative, ['Fact 1', 'Fact 2']);

    expect(mockCallLLM).toHaveBeenCalledWith(
      expect.any(String),
      expect.stringContaining('Fact 1'),
    );
  });
});

// ── Search Reranking Tests ───────────────────────────────────────

describe('rerankResults', () => {
  const candidates: RerankCandidate[] = [
    { id: 1, title: 'Auth module JWT config', type: 'decision', score: 0.8 },
    { id: 2, title: 'Database migration script', type: 'what-changed', score: 0.75 },
    { id: 3, title: 'JWT token expiry gotcha', type: 'gotcha', score: 0.7 },
    { id: 4, title: 'API rate limiting setup', type: 'how-it-works', score: 0.65 },
    { id: 5, title: 'CORS configuration', type: 'problem-solution', score: 0.6 },
  ];

  beforeEach(() => setLLM(false));

  it('should return original order when LLM is disabled', async () => {
    const { reranked, usedLLM } = await rerankResults('JWT auth', candidates);
    expect(reranked.map(c => c.id)).toEqual([1, 2, 3, 4, 5]);
    expect(usedLLM).toBe(false);
  });

  it('should skip reranking for 2 or fewer results', async () => {
    setLLM(true, '[2, 1]');
    const { usedLLM } = await rerankResults('test', candidates.slice(0, 2));
    expect(usedLLM).toBe(false);
  });

  it('should rerank with LLM when enabled', async () => {
    setLLM(true, '[3, 1, 2, 4, 5]');

    const { reranked, usedLLM } = await rerankResults('JWT token expiry', candidates);
    expect(usedLLM).toBe(true);
    // LLM moved #3 (JWT gotcha) to first position
    expect(reranked[0].id).toBe(3);
    expect(reranked[1].id).toBe(1);
  });

  it('should handle LLM returning subset of IDs (safety)', async () => {
    setLLM(true, '[3, 1]'); // LLM only returned 2 of 5

    const { reranked } = await rerankResults('JWT', candidates);
    // Should still have all 5 candidates
    expect(reranked).toHaveLength(5);
    // First two should be in LLM order
    expect(reranked[0].id).toBe(3);
    expect(reranked[1].id).toBe(1);
    // Remaining should still be present
    const ids = reranked.map(c => c.id);
    expect(ids).toContain(2);
    expect(ids).toContain(4);
    expect(ids).toContain(5);
  });

  it('should handle markdown-wrapped JSON response', async () => {
    setLLM(true, '```json\n[3, 1, 2, 4, 5]\n```');

    const { reranked, usedLLM } = await rerankResults('JWT', candidates);
    expect(usedLLM).toBe(true);
    expect(reranked[0].id).toBe(3);
  });

  it('should fallback to original order on LLM error', async () => {
    setLLM(true, 'invalid json response');

    const { reranked, usedLLM } = await rerankResults('test', candidates);
    // Should return original order (JSON parse fails → catch block)
    expect(reranked.map(c => c.id)).toEqual([1, 2, 3, 4, 5]);
  });
});
