/**
 * Image Loader — Vision LLM Integration
 *
 * Analyzes images via OpenAI Vision API (or compatible),
 * extracting descriptions, tags, and entities.
 */

import { getLLMApiKey, getLLMBaseUrl, getLLMModel } from '../config.js';
import {
  isLLMEnabled,
  getLLMConfig,
  normalizeOpenAICompatibleBaseUrl,
} from '../llm/provider.js';
import { sanitizeCredentials } from '../memory/secret-filter.js';
import {
  decodeBase64ImagePayload,
  MAX_VISION_IMAGE_BYTES,
  normalizeVisionImageMimeType,
} from './image-payload.js';

// Providers that use the OpenAI-compatible /chat/completions Vision endpoint
const OPENAI_COMPATIBLE_PROVIDERS = new Set(['openai', 'openrouter', 'custom']);
const MAX_VISION_PROMPT_CHARS = 12_000;
const MAX_VISION_DESCRIPTION_CHARS = 12_000;
const MAX_VISION_LABELS = 50;
const MAX_VISION_LABEL_CHARS = 256;

// ── Types ────────────────────────────────────────────────────────────

export interface ImageInput {
  /** Base64-encoded image data */
  base64: string;
  /** Image MIME type (default: image/png) */
  mimeType?: string;
  /** Original filename */
  filename?: string;
  /** Custom analysis prompt */
  prompt?: string;
}

export interface ImageAnalysisResult {
  /** Natural language description of the image */
  description: string;
  /** Relevant tags/categories */
  tags: string[];
  /** Key entities/concepts depicted */
  entities: string[];
}

// ── Internal Vision LLM Call ─────────────────────────────────────────

async function callVisionLLM(
  systemPrompt: string,
  imageBase64: string,
  mimeType: string,
): Promise<string> {
  const apiKey = getLLMApiKey();
  if (!apiKey) {
    throw new Error('No LLM API key configured for image analysis.');
  }

  const baseUrl = normalizeOpenAICompatibleBaseUrl(getLLMBaseUrl('https://api.openai.com/v1'));
  const model = getLLMModel('gpt-4o');

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: systemPrompt },
          {
            type: 'image_url',
            image_url: { url: `data:${mimeType};base64,${imageBase64}` },
          },
        ],
      }],
      temperature: 0.1,
      max_tokens: 1024,
    }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'unknown error');
    throw new Error(`Vision LLM error (${response.status}): ${sanitizeCredentials(errorText).slice(0, 1_000)}`);
  }

  const data = await response.json() as {
    choices: Array<{ message: { content: string } }>;
  };

  return data.choices[0]?.message?.content ?? '';
}

// ── Public API ───────────────────────────────────────────────────────

const DEFAULT_PROMPT =
  'Analyze this image. Return ONLY a JSON object with this exact format: ' +
  '{"description": "detailed description", "tags": ["tag1", "tag2"], "entities": ["entity1", "entity2"]}';

function normalizeText(value: unknown, fallback = ''): string {
  const text = typeof value === 'string' && value.trim() ? value.trim() : fallback;
  return sanitizeCredentials(text).slice(0, MAX_VISION_DESCRIPTION_CHARS);
}

function normalizeLabels(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const labels = new Set<string>();
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const label = sanitizeCredentials(item.trim()).slice(0, MAX_VISION_LABEL_CHARS);
    if (label) labels.add(label);
    if (labels.size >= MAX_VISION_LABELS) break;
  }
  return [...labels];
}

/**
 * Analyze an image using Vision LLM.
 *
 * @throws Error if LLM not configured.
 */
export async function analyzeImage(input: ImageInput): Promise<ImageAnalysisResult> {
  if (!isLLMEnabled()) {
    throw new Error(
      'LLM not configured for image analysis. ' +
      'Set MEMORIX_LLM_API_KEY or OPENAI_API_KEY.',
    );
  }

  const config = getLLMConfig()!;
  if (!OPENAI_COMPATIBLE_PROVIDERS.has(config.provider)) {
    throw new Error(
      `Image analysis requires an OpenAI-compatible provider (openai, openrouter, or custom). ` +
      `Current provider "${config.provider}" uses a different API shape. ` +
      `Set MEMORIX_LLM_PROVIDER=openai or configure an OpenAI-compatible base URL.`,
    );
  }

  const bytes = decodeBase64ImagePayload(input.base64, MAX_VISION_IMAGE_BYTES);
  const imageBase64 = bytes.toString('base64');
  const mimeType = normalizeVisionImageMimeType(input.mimeType);
  const prompt = (input.prompt ?? DEFAULT_PROMPT).trim();
  if (!prompt) throw new Error('Image analysis prompt must be non-empty');
  if (prompt.length > MAX_VISION_PROMPT_CHARS) {
    throw new Error(`Image analysis prompt exceeds the ${MAX_VISION_PROMPT_CHARS}-character limit`);
  }

  const response = await callVisionLLM(prompt, imageBase64, mimeType);

  // Try to parse structured JSON response
  try {
    // Extract JSON from response (may be wrapped in markdown code block)
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        description: normalizeText(parsed.description, response),
        tags: normalizeLabels(parsed.tags),
        entities: normalizeLabels(parsed.entities),
      };
    }
  } catch {
    // JSON parse failed — fall through to text extraction
  }

  // Fallback: treat entire response as description
  return {
    description: normalizeText(response),
    tags: [],
    entities: [],
  };
}
