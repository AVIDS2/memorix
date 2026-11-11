import { describe, it, expect } from 'vitest';
import { detectQueryIntent, applyIntentBoost } from '../../src/search/intent-detector.js';

describe('detectQueryIntent', () => {
  it('should detect WHY intent', () => {
    const r1 = detectQueryIntent('Why did we choose Orama over SQLite?');
    expect(r1.intent).toBe('why');
    expect(r1.confidence).toBeGreaterThan(0.3);
    expect(r1.typeBoosts['decision']).toBe(3.0);
    expect(r1.typeBoosts['trade-off']).toBe(2.5);

    const r2 = detectQueryIntent('What was the rationale for using fastembed?');
    expect(r2.intent).toBe('why');

    const r3 = detectQueryIntent('为什么选择这个架构？');
    expect(r3.intent).toBe('why');
  });

  it('should detect WHEN intent', () => {
    const r1 = detectQueryIntent('When did we deploy the dashboard?');
    expect(r1.intent).toBe('when');
    expect(r1.preferChronological).toBe(true);

    const r2 = detectQueryIntent('What happened last week?');
    expect(r2.intent).toBe('when');

    const r3 = detectQueryIntent('最近有什么变化？');
    expect(r3.intent).toBe('when');
  });

  it('should detect HOW intent', () => {
    const r1 = detectQueryIntent('How does the hybrid search work?');
    expect(r1.intent).toBe('how');
    expect(r1.typeBoosts['how-it-works']).toBe(3.0);

    const r2 = detectQueryIntent('Explain the architecture of the retention system');
    expect(r2.intent).toBe('how');

    const r3 = detectQueryIntent('如何实现跨Agent共享？');
    expect(r3.intent).toBe('how');
  });

  it('should detect WHAT_CHANGED intent', () => {
    const r1 = detectQueryIntent('What changed in the dashboard?');
    expect(r1.intent).toBe('what_changed');
    expect(r1.typeBoosts['what-changed']).toBe(3.0);

    const r2 = detectQueryIntent('What was modified in the handler refactor?');
    expect(r2.intent).toBe('what_changed');

    const r3 = detectQueryIntent('dashboard改了什么？');
    expect(r3.intent).toBe('what_changed');
  });

  it('should detect PROBLEM intent', () => {
    const r1 = detectQueryIntent('What bugs were found in the embedding provider?');
    expect(r1.intent).toBe('problem');
    expect(r1.typeBoosts['problem-solution']).toBe(3.0);
    expect(r1.typeBoosts['gotcha']).toBe(2.5);

    const r2 = detectQueryIntent('How to fix the crash in orama-store?');
    expect(r2.intent).toBe('problem');

    const r3 = detectQueryIntent('这个报错怎么修复？');
    expect(r3.intent).toBe('problem');
  });

  it('should return general for ambiguous queries', () => {
    const r1 = detectQueryIntent('memorix dashboard');
    expect(r1.intent).toBe('general');
    expect(r1.confidence).toBe(0);

    const r2 = detectQueryIntent('orama store');
    expect(r2.intent).toBe('general');
  });

  it('should handle empty/short queries', () => {
    expect(detectQueryIntent('').intent).toBe('general');
    expect(detectQueryIntent('a').intent).toBe('general');
    expect(detectQueryIntent('').confidence).toBe(0);
  });

  it('should provide field boosts for WHY queries', () => {
    const r = detectQueryIntent('Why did we use this approach?');
    expect(r.fieldBoosts).toBeDefined();
    expect(r.fieldBoosts!.narrative).toBeGreaterThan(2);
  });

  it('should provide field boosts for PROBLEM queries', () => {
    const r = detectQueryIntent('What bugs exist in the search module?');
    expect(r.fieldBoosts).toBeDefined();
    expect(r.fieldBoosts!.facts).toBe(2);
    expect(r.fieldBoosts!.filesModified).toBe(1.5);
  });
});

describe('applyIntentBoost', () => {
  it('should boost matching types', () => {
    const intent = detectQueryIntent('Why did we choose this?');
    const boosted = applyIntentBoost(1.0, 'decision', intent);
    expect(boosted).toBeGreaterThan(1.0);
  });

  it('should not boost non-matching types', () => {
    const intent = detectQueryIntent('Why did we choose this?');
    const boosted = applyIntentBoost(1.0, 'what-changed', intent);
    expect(boosted).toBe(1.0); // No boost defined for what-changed in WHY intent
  });

  it('should skip boosting at low confidence', () => {
    const intent = detectQueryIntent('memorix');
    const boosted = applyIntentBoost(1.0, 'decision', intent);
    expect(boosted).toBe(1.0); // confidence too low
  });

  it('should scale boost by confidence', () => {
    const highConfIntent = detectQueryIntent('Why did we decide to choose this rationale?');
    const lowConfIntent = detectQueryIntent('Why?');

    const highBoosted = applyIntentBoost(1.0, 'decision', highConfIntent);
    const lowBoosted = applyIntentBoost(1.0, 'decision', lowConfIntent);

    // Higher confidence → higher boost
    expect(highBoosted).toBeGreaterThanOrEqual(lowBoosted);
  });

  describe('state intent (resumption queries)', () => {
    it('detects English resumption phrasing', () => {
      expect(detectQueryIntent('what is the progress and what are the next steps').intent).toBe('state');
      expect(detectQueryIntent('where did we leave off, anything remaining?').intent).toBe('state');
    });

    it('detects Chinese resumption phrasing', () => {
      expect(detectQueryIntent('现在进度怎么样，下一步做什么').intent).toBe('state');
      expect(detectQueryIntent('上次做到哪了，还剩下什么待办').intent).toBe('state');
    });

    it('prefers the types that carry handoff state', () => {
      const intent = detectQueryIntent('当前进度如何，下一步待办是什么');
      const sessionRequest = applyIntentBoost(1.0, 'session-request', intent);
      const howItWorks = applyIntentBoost(1.0, 'how-it-works', intent);
      expect(sessionRequest).toBeGreaterThan(howItWorks);
    });

    it('leaves unrelated queries alone', () => {
      expect(detectQueryIntent('why did we choose this database').intent).toBe('why');
    });
  });
});
