/**
 * LLM Quality Benchmark — Real API测试
 *
 * 用真实 observations + 真实 LLM API 测量：
 * 1. 压缩率：narrative 压缩前后 token 数对比
 * 2. Reranking：LLM 重排 vs 原始排序的差异
 * 3. CJK 检索：中文 query 找英文 memory 的召回率
 *
 * 运行: npx tsx tests/benchmarks/llm-quality-benchmark.ts
 *
 * 自动从 Memorix 配置读取 provider/model，不再硬编码。
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { getLLMApiKey, getLLMBaseUrl, getLLMModel, getLLMProvider, loadDotenv } from '../../src/config.ts';
import { initProjectRoot } from '../../src/config/yaml-loader.ts';

const DATA_DIR = process.env.MEMORIX_DATA_DIR || path.join(os.homedir(), '.memorix', 'data');

// ── Bootstrap config: load .env + set project root (same as production) ──
const projectRoot = process.cwd();
initProjectRoot(projectRoot);
loadDotenv(projectRoot);

// ── Resolve live LLM config from Memorix config chain ─────────────
const PROVIDER_DEFAULTS: Record<string, { baseUrl: string; model: string }> = {
  openai: { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4.1-nano' },
  anthropic: { baseUrl: 'https://api.anthropic.com/v1', model: 'claude-3-5-haiku-latest' },
  openrouter: { baseUrl: 'https://openrouter.ai/api/v1', model: 'openai/gpt-4.1-nano' },
  custom: { baseUrl: 'http://localhost:11434/v1', model: 'llama3' },
};
const provider = getLLMProvider() || 'openai';
const defs = PROVIDER_DEFAULTS[provider] ?? PROVIDER_DEFAULTS.openai;

const API_KEY = getLLMApiKey() || '';
const API_BASE = getLLMBaseUrl(defs.baseUrl);
const API_MODEL = getLLMModel(defs.model);

if (!API_KEY) {
  console.error('❌ No LLM API key found.');
  console.error('  Checked: MEMORIX_LLM_API_KEY, memorix.yml, config.json, OPENAI_API_KEY');
  console.error('  Run `memorix init` or set MEMORIX_LLM_API_KEY to configure.');
  process.exit(1);
}

// ── LLM Call ─────────────────────────────────────────────────────

async function callLLM(system: string, user: string): Promise<string> {
  let base = API_BASE.replace(/\/+$/, '');
  if (!base.endsWith('/v1')) base += '/v1';

  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({
      model: API_MODEL,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      temperature: 0.1,
      max_tokens: 512,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`API ${res.status}: ${err}`);
  }

  const data = await res.json() as any;
  return data.choices[0]?.message?.content ?? '';
}

// ── Token Estimator ──────────────────────────────────────────────

function estimateTokens(text: string): number {
  const cjk = (text.match(/[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]/g) || []).length;
  const other = text.length - cjk;
  return Math.ceil(cjk / 1.5 + other / 4);
}

// ── Compression Benchmark ────────────────────────────────────────

const COMPRESS_PROMPT = `You are a memory compression engine for a coding assistant.
Compress the given narrative into the shortest possible form that preserves ALL technical facts.
Rules:
- Aggressively remove: filler words, background context, debugging journey, repeated info
- Compress to MINIMUM viable length — aim for 50% or less of original
- Keep ONLY: specific values, file paths, error messages, version numbers, config keys, causal relationships
- Merge related points into single dense sentences
- Output the compressed text ONLY, no explanation or wrapper

Examples:
Input: "Final deployment model for shadcn-blog is stable: GitHub Actions build locally, SCP artifacts to VPS, systemd manages the process. Docker was considered but rejected due to complexity overhead for a simple blog. The whole pipeline takes about 2 minutes from push to live."
Output: "shadcn-blog部署: GH Actions构建→SCP到VPS→systemd管理, 弃Docker(复杂度过高), push到上线~2min"`;

async function benchmarkCompression() {
  console.log('\n' + '═'.repeat(60));
  console.log('📊 COMPRESSION BENCHMARK');
  console.log('═'.repeat(60));

  const raw = await fs.readFile(path.join(DATA_DIR, 'observations.json'), 'utf-8');
  const all = JSON.parse(raw) as any[];

  // Smart filter: only compress narrative-worthy content (skip commands, paths, short auto-captured)
  const SKIP_PATTERNS = [
    /^(?:Command|Run|Execute):\s/i,
    /^(?:File|Edit|Changed):\s/i,
    /^git\s+(?:add|commit|push|pull|log)/i,
    /^(?:npm|npx|pnpm|yarn|bun)\s/i,
    /^(?:Remove-Item|New-Item|Set-Content)/i,
    /^[A-Za-z]:\\[\w\\]/,
    /^\/(?:usr|home|var|etc|opt)\//,
  ];
  const LOW_TYPES = new Set(['what-changed', 'discovery', 'session-request']);

  function shouldSkip(obs: any): boolean {
    const n = obs.narrative || '';
    const firstLine = n.split('\n')[0];
    if (SKIP_PATTERNS.some((p: RegExp) => p.test(firstLine))) return true;
    if (LOW_TYPES.has(obs.type) && n.length < 200) return true;
    const specials = (n.match(/[{}()\[\]<>:;=|\\\/\-_\.@#$%^&*+~`"']/g) || []).length;
    if (specials / n.length > 0.35) return true;
    return false;
  }

  const allCandidates = all.filter((o: any) => o.narrative && o.narrative.length > 80 && o.status !== 'archived');
  const skipped = allCandidates.filter(shouldSkip);
  const candidates = allCandidates.filter((o: any) => !shouldSkip(o)).slice(0, 20);

  console.log(`\nTotal > 80 chars: ${allCandidates.length}`);
  console.log(`Smart-skipped (commands/paths/short auto-captured): ${skipped.length}`);
  console.log(`Compression candidates: ${candidates.length} (testing up to 20)\n`);

  let totalOriginal = 0;
  let totalCompressed = 0;
  let successCount = 0;

  for (let i = 0; i < candidates.length; i++) {
    const obs = candidates[i];
    const originalTokens = estimateTokens(obs.narrative);

    try {
      const compressed = await callLLM(COMPRESS_PROMPT, obs.narrative);

      if (!compressed || compressed.length >= obs.narrative.length) {
        console.log(`  ${i + 1}. ⏭️ #${obs.id} — LLM returned longer/empty, skipped`);
        totalOriginal += originalTokens;
        totalCompressed += originalTokens;
        continue;
      }

      const compressedTokens = estimateTokens(compressed);
      const reduction = ((originalTokens - compressedTokens) / originalTokens * 100).toFixed(1);

      totalOriginal += originalTokens;
      totalCompressed += compressedTokens;
      successCount++;

      console.log(`  ${i + 1}. ✅ #${obs.id} [${obs.type}] ${originalTokens}→${compressedTokens} tokens (↓${reduction}%)`);
      console.log(`     原: ${obs.narrative.substring(0, 60)}...`);
      console.log(`     压: ${compressed.substring(0, 60)}${compressed.length > 60 ? '...' : ''}`);
    } catch (err) {
      console.log(`  ${i + 1}. ❌ #${obs.id} — ${(err as Error).message}`);
      totalOriginal += originalTokens;
      totalCompressed += originalTokens;
    }
  }

  const overallReduction = ((totalOriginal - totalCompressed) / totalOriginal * 100).toFixed(1);
  console.log('\n' + '─'.repeat(60));
  console.log(`📈 Results:`);
  console.log(`   Samples tested: ${candidates.length}`);
  console.log(`   Successfully compressed: ${successCount}`);
  console.log(`   Total original tokens: ${totalOriginal}`);
  console.log(`   Total compressed tokens: ${totalCompressed}`);
  console.log(`   Overall reduction: ↓${overallReduction}%`);
  console.log('─'.repeat(60));

  return { totalOriginal, totalCompressed, reduction: parseFloat(overallReduction), samples: candidates.length, success: successCount };
}

// ── Reranking Benchmark ──────────────────────────────────────────

const RERANK_PROMPT = `You are a memory relevance ranker for a coding assistant.
Given a QUERY and CANDIDATE memories, rerank by relevance.
Output ONLY a JSON array of IDs in order of relevance (most relevant first).
Include ALL candidate IDs.`;

async function benchmarkReranking() {
  console.log('\n' + '═'.repeat(60));
  console.log('📊 RERANKING BENCHMARK');
  console.log('═'.repeat(60));

  // Test queries that have known "best" results
  const queries = [
    { query: 'JWT authentication token', expectedTop: ['jwt', 'auth', 'token'] },
    { query: 'MCP server configuration', expectedTop: ['mcp', 'server', 'config'] },
    { query: 'hooks handler bug', expectedTop: ['hook', 'handler', 'bug'] },
    { query: 'project isolation memory', expectedTop: ['project', 'isolation', 'memory'] },
    { query: 'retention decay archive', expectedTop: ['retention', 'decay', 'archive'] },
  ];

  const raw = await fs.readFile(path.join(DATA_DIR, 'observations.json'), 'utf-8');
  const all = JSON.parse(raw) as any[];
  const active = all.filter((o: any) => o.status !== 'archived');

  let totalRerankChanges = 0;
  let totalQueries = 0;

  for (const { query, expectedTop } of queries) {
    // Simulate BM25-style initial ranking (keyword match count)
    const scored = active.map((o: any) => {
      const text = `${o.title} ${o.narrative} ${(o.facts || []).join(' ')} ${(o.concepts || []).join(' ')}`.toLowerCase();
      const queryTokens = query.toLowerCase().split(/\s+/);
      const matchCount = queryTokens.filter(t => text.includes(t)).length;
      return { id: o.id, title: o.title, type: o.type, score: matchCount, narrative: o.narrative?.substring(0, 100) };
    }).filter(o => o.score > 0).sort((a, b) => b.score - a.score).slice(0, 8);

    if (scored.length < 3) {
      console.log(`\n  ⏭️ Query: "${query}" — too few matches (${scored.length}), skipped`);
      continue;
    }

    const originalOrder = scored.map(s => s.id);

    try {
      const candidateList = scored.map(c =>
        `[ID: ${c.id}] (${c.type}) ${c.title}${c.narrative ? ` — ${c.narrative}` : ''}`,
      ).join('\n');

      const response = await callLLM(RERANK_PROMPT, `QUERY: ${query}\n\nCANDIDATES:\n${candidateList}`);

      let content = response.trim();
      if (content.startsWith('```')) {
        content = content.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
      }
      const rerankedIds = JSON.parse(content) as number[];

      // Count position changes
      let positionChanges = 0;
      for (let i = 0; i < Math.min(rerankedIds.length, originalOrder.length); i++) {
        if (rerankedIds[i] !== originalOrder[i]) positionChanges++;
      }

      // Check if reranked top results are more relevant (contain expected keywords)
      const topReranked = scored.find(s => s.id === rerankedIds[0]);
      const topOriginal = scored[0];
      const topRerankedText = `${topReranked?.title} ${topReranked?.narrative}`.toLowerCase();
      const topOriginalText = `${topOriginal.title} ${topOriginal.narrative}`.toLowerCase();
      const rerankedHits = expectedTop.filter(k => topRerankedText.includes(k)).length;
      const originalHits = expectedTop.filter(k => topOriginalText.includes(k)).length;

      totalRerankChanges += positionChanges;
      totalQueries++;

      console.log(`\n  Query: "${query}"`);
      console.log(`    Original #1: "${topOriginal.title}" (keyword hits: ${originalHits}/${expectedTop.length})`);
      console.log(`    Reranked #1: "${topReranked?.title}" (keyword hits: ${rerankedHits}/${expectedTop.length})`);
      console.log(`    Position changes: ${positionChanges}/${scored.length}`);
      console.log(`    Improvement: ${rerankedHits > originalHits ? '✅ Better' : rerankedHits === originalHits ? '➡️ Same' : '❌ Worse'}`);
    } catch (err) {
      console.log(`\n  ❌ Query: "${query}" — ${(err as Error).message}`);
    }
  }

  console.log('\n' + '─'.repeat(60));
  console.log(`📈 Reranking Results:`);
  console.log(`   Queries tested: ${totalQueries}`);
  console.log(`   Avg position changes: ${totalQueries > 0 ? (totalRerankChanges / totalQueries).toFixed(1) : 'N/A'}`);
  console.log('─'.repeat(60));
}

// ── Main ─────────────────────────────────────────────────────────

// ── CJK Retrieval Benchmark ─────────────────────────────────────

const CJK_EXPANSION_PROMPT = `You rewrite coding-memory search queries for retrieval.
Rules:
- Input may be Chinese, Japanese, or Korean
- Output one short English search phrase only
- Keep the technical meaning
- Prefer wording that would match engineering notes or memory titles
- No bullets, no JSON, no explanation, no quotes
- 4 to 12 words is ideal`;

async function benchmarkCJKRetrieval() {
  console.log('\n' + '═'.repeat(60));
  console.log('📊 CJK RETRIEVAL BENCHMARK');
  console.log('═'.repeat(60));

  const raw = await fs.readFile(path.join(DATA_DIR, 'observations.json'), 'utf-8');
  const all = JSON.parse(raw) as any[];
  const active = all.filter((o: any) => o.status !== 'archived' && o.title);

  // CJK queries paired with expected English memory keywords
  const cjkQueries = [
    { zh: '语义检索为什么变弱', expect: ['semantic', 'retrieval', 'search', 'vector', 'weak'] },
    { zh: '冷启动搜索性能', expect: ['cold', 'start', 'search', 'performance', 'startup'] },
    { zh: 'CORS跨域安全', expect: ['cors', 'origin', 'security', 'header', 'access'] },
    { zh: '配置泄漏问题', expect: ['config', 'leak', 'yaml', 'project', 'startup'] },
    { zh: '内存去重策略', expect: ['dedup', 'consolidat', 'merge', 'memory', 'redundant'] },
    { zh: 'git hook自动提交', expect: ['git', 'hook', 'commit', 'auto'] },
    { zh: '嵌入向量缓存', expect: ['embedding', 'cache', 'vector', 'api'] },
  ];

  let totalRecall = 0;
  let totalExpansionMs = 0;
  let totalSearchMs = 0;
  let testedCount = 0;

  for (const { zh, expect: keywords } of cjkQueries) {
    // Step 1: Expand CJK query to English
    const t0 = Date.now();
    let expanded: string;
    try {
      expanded = await callLLM(CJK_EXPANSION_PROMPT, zh);
      expanded = expanded.trim().split('\n')[0].replace(/^[-*]\s*/, '').replace(/^["'`]+|["'`]+$/g, '');
    } catch (err) {
      console.log(`  ❌ "${zh}" — expansion failed: ${(err as Error).message}`);
      continue;
    }
    const expansionMs = Date.now() - t0;
    totalExpansionMs += expansionMs;

    // Step 2: BM25-style search with expanded query
    const t1 = Date.now();
    const searchTerms = `${zh} ${expanded}`.toLowerCase().split(/\s+/).filter(t => t.length > 1);
    const scored = active.map((o: any) => {
      const text = `${o.title} ${o.narrative || ''} ${(o.facts || []).join(' ')} ${(o.concepts || []).join(' ')}`.toLowerCase();
      let matchScore = 0;
      for (const term of searchTerms) {
        if (text.includes(term)) matchScore++;
      }
      return { id: o.id, title: o.title, score: matchScore };
    }).filter(o => o.score > 0).sort((a, b) => b.score - a.score).slice(0, 5);
    const searchMs = Date.now() - t1;
    totalSearchMs += searchMs;

    // Step 3: Check recall — do top-5 results contain expected keywords?
    const top5Text = scored.map(s => s.title).join(' ').toLowerCase();
    const hits = keywords.filter(k => top5Text.includes(k.toLowerCase()));
    const recall = hits.length / keywords.length;
    totalRecall += recall;
    testedCount++;

    const recallPct = (recall * 100).toFixed(0);
    const icon = recall >= 0.6 ? '✅' : recall >= 0.3 ? '⚠️' : '❌';
    console.log(`\n  ${icon} "${zh}" → "${expanded}"`);
    console.log(`     expansion: ${expansionMs}ms | search: ${searchMs}ms | recall: ${recallPct}% (${hits.length}/${keywords.length})`);
    if (scored.length > 0) {
      console.log(`     top-1: "${scored[0].title}"`);
    } else {
      console.log(`     ⚠️ No results found`);
    }
  }

  const avgRecall = testedCount > 0 ? (totalRecall / testedCount * 100).toFixed(1) : 'N/A';
  console.log('\n' + '─'.repeat(60));
  console.log(`📈 CJK Retrieval Results:`);
  console.log(`   Queries tested: ${testedCount}`);
  console.log(`   Avg recall@5: ${avgRecall}%`);
  console.log(`   Avg expansion latency: ${testedCount > 0 ? (totalExpansionMs / testedCount).toFixed(0) : 'N/A'}ms`);
  console.log(`   Avg search latency: ${testedCount > 0 ? (totalSearchMs / testedCount).toFixed(0) : 'N/A'}ms`);
  console.log(`   Bottleneck: ${totalExpansionMs > totalSearchMs * 10 ? 'expansion (LLM)' : 'balanced'}`);
  console.log('─'.repeat(60));

  return { avgRecall: parseFloat(avgRecall as string) || 0, testedCount };
}

async function main() {
  console.log('🔬 Memorix LLM Quality Benchmark');
  console.log(`Provider: ${provider}`);
  console.log(`Model: ${API_MODEL}`);
  console.log(`Base URL: ${API_BASE}`);
  console.log(`Data: ${DATA_DIR}`);
  console.log(`Config: initProjectRoot(${projectRoot}) + loadDotenv()`);

  const compression = await benchmarkCompression();
  await benchmarkReranking();
  const cjk = await benchmarkCJKRetrieval();

  console.log('\n' + '═'.repeat(60));
  console.log('📋 FINAL SUMMARY');
  console.log('═'.repeat(60));
  console.log(`Provider: ${API_MODEL} @ ${API_BASE}`);
  console.log(`Compression: ↓${compression.reduction}% token reduction (${compression.success}/${compression.samples} successful)`);
  console.log(`CJK recall@5: ${cjk.avgRecall}% across ${cjk.testedCount} queries`);
}

main().catch(console.error);
