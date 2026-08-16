/**
 * HTTP rerank lane: configured /rerank endpoint, then original order on failure.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { resetTomlConfigCache } from '../../src/config/toml-loader.js';
import { resetYamlConfigCache } from '../../src/config/yaml-loader.js';
import { resetResolvedConfigCache } from '../../src/config/resolved-config.js';

const TMP = join(process.cwd(), '.tmp-neural-rerank-test');
const HOME = join(TMP, 'home');

const ENV_KEYS = [
  'MEMORIX_RERANK_PROVIDER',
  'MEMORIX_RERANK_MODEL',
  'MEMORIX_RERANK_BASE_URL',
  'MEMORIX_RERANK_API_KEY',
  'MEMORIX_LLM_BASE_URL',
  'MEMORIX_LLM_API_KEY',
];

async function loadLane() {
  const { isNeuralRerankEnabled, neuralRerankCandidates } = await import('../../src/rerank/index.js');
  return { isNeuralRerankEnabled, neuralRerankCandidates };
}

describe('neural rerank lane', () => {
  afterEach(() => {
    rmSync(TMP, { recursive: true, force: true });
    resetTomlConfigCache();
    resetYamlConfigCache();
    resetResolvedConfigCache();
    for (const key of ENV_KEYS) delete process.env[key];
    vi.resetModules();
  });

  it('is off by default', async () => {
    mkdirSync(join(HOME, '.memorix'), { recursive: true });
    const { isNeuralRerankEnabled } = await loadLane();
    expect(isNeuralRerankEnabled({ projectRoot: null, homeDir: HOME })).toBe(false);
  });

  it('inherits base URL and bearer from the memory LLM lane', async () => {
    mkdirSync(join(HOME, '.memorix'), { recursive: true });
    writeFileSync(join(HOME, '.memorix', 'config.toml'), [
      '[memory.llm]',
      'base_url = "https://llm.example/v1"',
      'api_key = "llm-from-memory"',
      '',
      '[rerank]',
      'provider = "http"',
      'model = "rerank-v3.5"',
    ].join('\n'), 'utf8');

    const { getResolvedRerankLane } = await import('../../src/config/resolved-config.js');
    const lane = getResolvedRerankLane({ projectRoot: null, homeDir: HOME });
    expect(lane.provider).toBe('http');
    expect(lane.model).toBe('rerank-v3.5');
    expect(lane.baseUrl).toBe('https://llm.example/v1');
    expect(lane.apiKey).toBe('llm-from-memory');
  });

  it('keeps a public Jina-compatible host enabled when configured', async () => {
    mkdirSync(join(HOME, '.memorix'), { recursive: true });
    writeFileSync(join(HOME, '.memorix', 'config.toml'), [
      '[rerank]',
      'provider = "http"',
      'base_url = "https://api.jina.ai/v1"',
      'model = "jina-reranker-v2-base-multilingual"',
      'api_key = "jina-key"',
    ].join('\n'), 'utf8');

    const { getResolvedRerankLane } = await import('../../src/config/resolved-config.js');
    const { isNeuralRerankEnabled } = await loadLane();
    const lane = getResolvedRerankLane({ projectRoot: null, homeDir: HOME });
    expect(lane.provider).toBe('http');
    expect(lane.baseUrl).toBe('https://api.jina.ai/v1');
    expect(lane.model).toBe('jina-reranker-v2-base-multilingual');
    expect(isNeuralRerankEnabled({ projectRoot: null, homeDir: HOME })).toBe(true);
  });

  it('reorders candidates from a Cohere-shaped response', async () => {
    process.env.MEMORIX_RERANK_PROVIDER = 'http';
    process.env.MEMORIX_RERANK_BASE_URL = 'https://rerank.example/v1';
    process.env.MEMORIX_RERANK_MODEL = 'rerank-v3.5';
    process.env.MEMORIX_RERANK_API_KEY = 'rerank-key';
    mkdirSync(join(HOME, '.memorix'), { recursive: true });

    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      results: [
        { index: 2, relevance_score: 0.99 },
        { index: 0, relevance_score: 0.4 },
        { index: 1, relevance_score: 0.1 },
      ],
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchImpl);

    const { neuralRerankCandidates } = await loadLane();
    const reranked = await neuralRerankCandidates('JWT', [
      { id: 'r1', title: 'alpha', type: 'gotcha', score: 1 },
      { id: 'r2', title: 'beta', type: 'gotcha', score: 0.9 },
      { id: 'r3', title: 'gamma', type: 'gotcha', score: 0.8 },
    ], { projectRoot: null, homeDir: HOME });

    expect(reranked?.map((row) => row.id)).toEqual(['r3', 'r1', 'r2']);
    expect(String(fetchImpl.mock.calls[0]?.[0])).toBe('https://rerank.example/v1/rerank');
    vi.unstubAllGlobals();
  });
});
