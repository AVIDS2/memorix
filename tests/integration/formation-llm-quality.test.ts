/**
 * Formation Pipeline LLM Quality Test
 *
 * Tests LLM-powered fact extraction and resolution directly,
 * without HTTP server or TUI. Requires LLM API key in config.
 */

import { describe, it, expect, vi } from 'vitest';
import { runExtract } from '../../src/memory/formation/extract.js';
import { runEvaluate } from '../../src/memory/formation/evaluate.js';
import type { FormationInput } from '../../src/memory/formation/types.js';

function makeInput(overrides: Partial<FormationInput> = {}): FormationInput {
  return {
    entityName: 'test-entity',
    type: 'discovery',
    title: 'Test',
    narrative: 'Test narrative.',
    facts: [],
    projectId: 'test',
    source: 'explicit',
    ...overrides,
  };
}

// Live LLM quality tests are intentionally opt-in because upstream model
// behavior can drift and should not make the default test suite flaky.
const runLiveLLMTests = process.env.MEMORIX_RUN_LIVE_LLM_TESTS === '1';

// Load LLM config from ~/.memorix/config.json and set env vars
// so initLLM() works in vitest source mode (where require('../config.js') fails)
let llmAvailable = false;
try {
  const { readFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { homedir } = await import('node:os');
  const configPath = join(homedir(), '.memorix', 'config.json');
  const config = JSON.parse(readFileSync(configPath, 'utf-8'));
  if (config.llm?.apiKey) {
    process.env.MEMORIX_LLM_API_KEY = config.llm.apiKey;
    if (config.llm.provider) process.env.MEMORIX_LLM_PROVIDER = config.llm.provider;
    if (config.llm.model) process.env.MEMORIX_LLM_MODEL = config.llm.model;
    if (config.llm.baseUrl) process.env.MEMORIX_LLM_BASE_URL = config.llm.baseUrl;

    // Set LLM config directly (bypasses initLLM's require('../config.js') which fails in vitest)
    const { setLLMConfig, isLLMEnabled } = await import('../../src/llm/provider.js');
    setLLMConfig({
      provider: (config.llm.provider || 'openai') as 'openai' | 'anthropic' | 'openrouter',
      apiKey: config.llm.apiKey,
      model: config.llm.model || 'gpt-4o-mini',
      baseUrl: config.llm.baseUrl || 'https://api.openai.com/v1',
    });
    llmAvailable = runLiveLLMTests && isLLMEnabled();
    console.log(`LLM: ${config.llm.provider}/${config.llm.model} @ ${config.llm.baseUrl} (enabled: ${llmAvailable})`);
  }
} catch { /* no config */ }

describe('Formation Pipeline LLM Quality', () => {

  it.skipIf(!llmAvailable)('should extract rich facts from complex narrative via LLM', async () => {
    const input = makeInput({
      entityName: 'database-migration',
      type: 'decision',
      title: 'Chose PostgreSQL over MongoDB for ACID compliance',
      narrative: 'After 2 weeks of evaluation, we decided to migrate from MongoDB to PostgreSQL. The main driver was ACID compliance requirements for financial transactions. MongoDB was faster for reads (avg 2ms vs 8ms) but could not guarantee transaction isolation under concurrent writes. We tested with 10000 concurrent transactions and found 0.3% data inconsistency with MongoDB vs 0% with PostgreSQL. The migration involved rewriting 47 query functions, adding 12 new indexes, and updating the ORM from Mongoose to Prisma. Total migration took 3 sprints. Performance mitigation: added Redis caching layer (port 6379) which brought read latency down to 3ms.',
    });

    const start = Date.now();
    const result = await runExtract(input, [], true); // useLLM=true
    const elapsed = Date.now() - start;

    console.log(`\n=== LLM Extract Results (${elapsed}ms) ===`);
    console.log(`Extracted facts: ${result.extractedFacts.length}`);
    for (const f of result.extractedFacts) {
      console.log(`  - ${f}`);
    }
    console.log(`Title improved: ${result.titleImproved}`);
    console.log(`Type corrected: ${result.typeCorrected}`);

    // LLM should extract significantly more facts than rules
    expect(result.extractedFacts.length).toBeGreaterThanOrEqual(3);

    // Evaluate the enriched result
    const evalResult = runEvaluate(result);
    console.log(`\nValue score: ${evalResult.score.toFixed(2)} (${evalResult.category})`);
    console.log(`Reason: ${evalResult.reason}`);

    // Should be high value (decision with rich context)
    expect(evalResult.score).toBeGreaterThanOrEqual(0.5);
    expect(evalResult.category).not.toBe('ephemeral');
  }, 60000); // 60s timeout for LLM call

  it.skipIf(!llmAvailable)('should extract bug-fix facts with causal reasoning', async () => {
    const input = makeInput({
      entityName: 'auth-middleware',
      type: 'problem-solution',
      title: 'JWT refresh token race condition',
      narrative: 'Critical race condition: concurrent API requests both refresh expired JWT. One succeeds, other gets 401 because old token invalidated. Root cause: no mutex in refresh logic. Fixed with semaphore pattern. Reduced 401 errors from 12% to 0.1%. Express.js + Redis port 6379 + PostgreSQL port 5432. Access token TTL 15min, refresh 7 days. PR #128.',
    });

    const start = Date.now();
    const result = await runExtract(input, [], true);
    const elapsed = Date.now() - start;

    console.log(`\n=== Bug Fix LLM Extract (${elapsed}ms) ===`);
    console.log(`Extracted facts: ${result.extractedFacts.length}`);
    for (const f of result.extractedFacts) {
      console.log(`  - ${f}`);
    }

    expect(result.extractedFacts.length).toBeGreaterThanOrEqual(3);

    const evalResult = runEvaluate(result);
    console.log(`Value: ${evalResult.score.toFixed(2)} (${evalResult.category})`);
    expect(evalResult.score).toBeGreaterThanOrEqual(0.5);
  }, 60000);

  it('should still work without LLM (rules fallback)', async () => {
    const input = makeInput({
      narrative: 'Server runs on Port: 3000. Upgraded from v1.2.3 to v2.0.0. Error: ECONNREFUSED.',
    });

    const result = await runExtract(input, [], false); // useLLM=false
    expect(result.extractedFacts.length).toBeGreaterThan(0);

    const evalResult = runEvaluate(result);
    console.log(`\nRules-only value: ${evalResult.score.toFixed(2)} (${evalResult.category})`);
  });
});
