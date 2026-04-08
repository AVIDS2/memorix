import { callLLM, initLLM, isLLMEnabled } from '../llm/provider.js';

const CJK_PATTERN = /[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]/g;
const COMMAND_LIKE_QUERY = /\b(git|npm|npx|pnpm|yarn|node|bash|powershell|curl|memorix)\b/i;

const QUERY_EXPANSION_PROMPT = `You rewrite coding-memory search queries for retrieval.

Rules:
- Input may be Chinese, Japanese, or Korean
- Output one short English search phrase only
- Keep the technical meaning
- Prefer wording that would match engineering notes or memory titles
- No bullets, no JSON, no explanation, no quotes
- 4 to 12 words is ideal`;

function isCjkHeavy(query: string): boolean {
  const cjkCount = (query.match(CJK_PATTERN) || []).length;
  return query.length > 0 && cjkCount / query.length > 0.3;
}

function normalizeExpansion(text: string): string {
  return text
    .trim()
    .replace(/^[-*]\s*/, '')
    .replace(/^["'`]+|["'`]+$/g, '')
    .split(/\r?\n/)[0]
    .trim();
}

export async function maybeExpandSearchQuery(query: string): Promise<string> {
  if (!query || !isCjkHeavy(query) || COMMAND_LIKE_QUERY.test(query)) {
    return query;
  }

  if (!isLLMEnabled()) {
    initLLM();
  }

  if (!isLLMEnabled()) {
    return query;
  }

  try {
    const response = await callLLM(QUERY_EXPANSION_PROMPT, query);
    const expanded = normalizeExpansion(response.content);
    if (!expanded) return query;
    if (expanded.toLowerCase() === query.toLowerCase()) return query;
    return `${query} ${expanded}`.slice(0, 500);
  } catch {
    return query;
  }
}
