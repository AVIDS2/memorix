/**
 * Image Loader — Vision LLM Integration
 *
 * Analyzes images via OpenAI Vision API (or compatible),
 * extracting descriptions, tags, and entities.
 */

import { getLLMApiKey, getLLMBaseUrl, getLLMModel } from '../config.js';
import { isLLMEnabled, getLLMConfig } from '../llm/provider.js';

// Providers that use the OpenAI-compatible /chat/completions Vision endpoint
const OPENAI_COMPATIBLE_PROVIDERS = new Set(['openai', 'openrouter', 'custom']);

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

  let baseUrl = getLLMBaseUrl('https://api.openai.com/v1').replace(/\/+$/, '');
  if (!baseUrl.endsWith('/v1')) baseUrl += '/v1';
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
    throw new Error(`Vision LLM error (${response.status}): ${errorText}`);
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

  const mimeType = input.mimeType ?? 'image/png';
  const prompt = input.prompt ?? DEFAULT_PROMPT;

  const response = await callVisionLLM(prompt, input.base64, mimeType);

  // Try to parse structured JSON response
  try {
    // Extract JSON from response (may be wrapped in markdown code block)
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        description: parsed.description ?? response,
        tags: Array.isArray(parsed.tags) ? parsed.tags : [],
        entities: Array.isArray(parsed.entities) ? parsed.entities : [],
      };
    }
  } catch {
    // JSON parse failed — fall through to text extraction
  }

  // Fallback: treat entire response as description
  return {
    description: response,
    tags: [],
    entities: [],
  };
}
