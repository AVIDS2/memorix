/**
 * Query Tier Classification Tests
 *
 * Verifies that classifyQueryTier correctly routes queries:
 * - fast:     single-word, short, actual CLI commands
 * - standard: multi-word English natural language
 * - heavy:    CJK, long complex queries
 *
 * Critical invariant: natural language queries that merely MENTION a tool
 * (memorix, git, npm) must NEVER be classified as fast. Only actual CLI
 * invocations (tool word leads + no natural language markers) may be fast.
 */

import { describe, it, expect } from 'vitest';
import { _classifyQueryTier as classifyQueryTier } from '../../src/store/orama-store.js';

describe('classifyQueryTier', () => {
  // ════════════════════════════════════════════
  // fast tier — only truly short or CLI queries
  // ════════════════════════════════════════════

  it('empty query → fast', () => {
    expect(classifyQueryTier('')).toBe('fast');
  });

  it('single short word → fast', () => {
    expect(classifyQueryTier('hooks')).toBe('fast');
    expect(classifyQueryTier('auth')).toBe('fast');
    expect(classifyQueryTier('cors')).toBe('fast');
  });

  // Real CLI invocations — tool word leads, no NL markers
  it('"git status" → fast (pure command)', () => {
    expect(classifyQueryTier('git status')).toBe('fast');
  });

  it('"git commit -m msg" → fast', () => {
    expect(classifyQueryTier('git commit -m msg')).toBe('fast');
  });

  it('"npm install express" → fast', () => {
    expect(classifyQueryTier('npm install express')).toBe('fast');
  });

  it('"npm publish" → fast', () => {
    expect(classifyQueryTier('npm publish')).toBe('fast');
  });

  it('"memorix search hook" → fast (CLI invocation)', () => {
    expect(classifyQueryTier('memorix search hook')).toBe('fast');
  });

  it('"memorix store entity" → fast', () => {
    expect(classifyQueryTier('memorix store entity')).toBe('fast');
  });

  it('"npx vitest run" → fast', () => {
    expect(classifyQueryTier('npx vitest run')).toBe('fast');
  });

  // ════════════════════════════════════════════
  // standard tier — normal multi-word queries
  // ════════════════════════════════════════════

  it('"hook commit" → standard', () => {
    expect(classifyQueryTier('hook commit')).toBe('standard');
  });

  it('"authentication flow" → standard', () => {
    expect(classifyQueryTier('authentication flow')).toBe('standard');
  });

  it('"embedding cache" → standard', () => {
    expect(classifyQueryTier('embedding cache')).toBe('standard');
  });

  // ════════════════════════════════════════════
  // CRITICAL: tool word at start + NL markers → NOT fast
  // These queries START with a tool word but contain
  // natural language markers (slow, error, issue, etc.)
  // so they must NOT be treated as CLI invocations.
  // ════════════════════════════════════════════

  // ── memorix ──
  it('"memorix search slow" → NOT fast (NL: "slow")', () => {
    expect(classifyQueryTier('memorix search slow')).not.toBe('fast');
  });

  it('"memorix cold start performance" → NOT fast (NL: "performance")', () => {
    expect(classifyQueryTier('memorix cold start performance')).not.toBe('fast');
  });

  it('"memorix rerank issue" → NOT fast (NL: "issue")', () => {
    expect(classifyQueryTier('memorix rerank issue')).not.toBe('fast');
  });

  it('"memorix deduplicate error" → NOT fast (NL: "error")', () => {
    expect(classifyQueryTier('memorix deduplicate error')).not.toBe('fast');
  });

  // ── git ──
  it('"git hook problem" → NOT fast (NL: "problem")', () => {
    expect(classifyQueryTier('git hook problem')).not.toBe('fast');
  });

  it('"git push fail" → NOT fast (NL: "fail")', () => {
    expect(classifyQueryTier('git push fail')).not.toBe('fast');
  });

  // ── npm ──
  it('"npm install error fix" → NOT fast (NL: "error", "fix")', () => {
    expect(classifyQueryTier('npm install error fix')).not.toBe('fast');
  });

  it('"npm publish broken" → NOT fast (NL: "broken")', () => {
    expect(classifyQueryTier('npm publish broken')).not.toBe('fast');
  });

  // ════════════════════════════════════════════
  // CRITICAL: tool word NOT at start → NOT fast
  // Natural language questions with embedded tool mentions.
  // ════════════════════════════════════════════

  it('"why is memorix search slow" → NOT fast', () => {
    expect(classifyQueryTier('why is memorix search slow')).not.toBe('fast');
  });

  it('"how does memorix deduplicate work" → NOT fast', () => {
    expect(classifyQueryTier('how does memorix deduplicate work')).not.toBe('fast');
  });

  it('"how does memorix rerank work" → NOT fast', () => {
    expect(classifyQueryTier('how does memorix rerank work')).not.toBe('fast');
  });

  it('"what makes memorix slow" → NOT fast', () => {
    expect(classifyQueryTier('what makes memorix slow')).not.toBe('fast');
  });

  it('"search performance in memorix" → NOT fast', () => {
    expect(classifyQueryTier('search performance in memorix')).not.toBe('fast');
  });

  it('"why did npm publish fail" → NOT fast', () => {
    expect(classifyQueryTier('why did npm publish fail')).not.toBe('fast');
  });

  it('"how does git hook work" → NOT fast', () => {
    expect(classifyQueryTier('how does git hook work')).not.toBe('fast');
  });

  it('"why does npm install fail" → NOT fast', () => {
    expect(classifyQueryTier('why does npm install fail')).not.toBe('fast');
  });

  // ════════════════════════════════════════════
  // heavy tier — CJK and long queries
  // ════════════════════════════════════════════

  it('CJK query → heavy', () => {
    expect(classifyQueryTier('语义检索为什么变弱')).toBe('heavy');
  });

  it('5+ word English query → heavy', () => {
    expect(classifyQueryTier('why did semantic retrieval get weaker')).toBe('heavy');
  });

  it('mixed CJK+English → heavy when CJK ratio > 0.3', () => {
    expect(classifyQueryTier('搜索性能 search')).toBe('heavy');
  });
});
