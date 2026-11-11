/**
 * Formation Pipeline Rules-Only Fallback Test
 *
 * Tests that fact extraction works without LLM (rules-only path).
 * This test runs in the default suite; live LLM quality tests are opt-in
 * via `npm run test:llm-live`.
 */

import { describe, it, expect } from 'vitest';
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

describe('Formation Pipeline rules-only fallback', () => {
  it('should extract facts without LLM (rules-only path)', async () => {
    const input = makeInput({
      narrative: 'Server runs on Port: 3000. Upgraded from v1.2.3 to v2.0.0. Error: ECONNREFUSED.',
    });

    const result = await runExtract(input, [], false); // useLLM=false
    expect(result.extractedFacts.length).toBeGreaterThan(0);

    const evalResult = runEvaluate(result);
    expect(evalResult.score).toBeGreaterThan(0);
  });
});
