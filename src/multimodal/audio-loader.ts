/**
 * Audio Loader — Whisper API Integration
 *
 * Transcribes audio files via OpenAI Whisper or Groq Whisper API,
 * then stores the transcript as a Memorix observation.
 *
 * Supports: mp3, wav, m4a, webm, mp4, ogg, flac
 * Providers: OpenAI (whisper-1), Groq (whisper-large-v3)
 */

import { getLLMApiKey } from '../config.js';

// ── Types ────────────────────────────────────────────────────────────

export interface AudioInput {
  /** Base64-encoded audio data */
  base64: string;
  /** Audio MIME type (default: audio/mp3) */
  mimeType?: string;
  /** Original filename */
  filename?: string;
  /** ISO language code for transcription hint */
  language?: string;
  /** Whisper provider: openai or groq */
  provider?: 'openai' | 'groq';
}

export interface TranscriptionResult {
  /** Transcribed text */
  text: string;
  /** Audio duration in seconds */
  duration?: number;
  /** Detected language */
  language?: string;
  /** Provider used */
  provider: string;
}

// ── Provider Config ──────────────────────────────────────────────────

const PROVIDERS = {
  openai: {
    baseUrl: 'https://api.openai.com/v1',
    model: 'whisper-1',
  },
  groq: {
    baseUrl: 'https://api.groq.com/openai/v1',
    model: 'whisper-large-v3',
  },
} as const;

// ── Core Functions ───────────────────────────────────────────────────

/**
 * Transcribe audio via Whisper API.
 *
 * @throws Error if no API key configured or API returns error.
 */
export async function transcribeAudio(input: AudioInput): Promise<TranscriptionResult> {
  const apiKey = getLLMApiKey();
  if (!apiKey) {
    throw new Error(
      'No API key configured for audio transcription. ' +
      'Set MEMORIX_LLM_API_KEY, MEMORIX_API_KEY, or OPENAI_API_KEY.',
    );
  }

  const providerName = input.provider
    ?? (process.env.MEMORIX_AUDIO_PROVIDER as 'openai' | 'groq' | undefined)
    ?? 'openai';
  const config = PROVIDERS[providerName] ?? PROVIDERS.openai;

  // Build multipart form
  const audioBuffer = Buffer.from(input.base64, 'base64');
  const blob = new Blob([audioBuffer], { type: input.mimeType ?? 'audio/mp3' });
  const form = new FormData();
  form.append('file', blob, input.filename ?? 'audio.mp3');
  form.append('model', config.model);
  form.append('response_format', 'json');
  if (input.language) {
    form.append('language', input.language);
  }

  const response = await fetch(`${config.baseUrl}/audio/transcriptions`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}` },
    body: form,
    signal: AbortSignal.timeout(120_000), // 2 min timeout for large files
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'unknown error');
    throw new Error(`Whisper API error (${response.status}): ${errorText}`);
  }

  const data = await response.json() as {
    text: string;
    duration?: number;
    language?: string;
  };

  return {
    text: data.text,
    duration: data.duration,
    language: data.language,
    provider: providerName,
  };
}

/**
 * Transcribe audio and store as a Memorix observation.
 */
export async function ingestAudio(
  input: AudioInput,
  storeFn: (obs: {
    entityName: string;
    type: string;
    title: string;
    narrative: string;
    concepts: string[];
    projectId: string;
  }) => Promise<{ observation: { id: number }; upserted: boolean }>,
  projectId: string,
): Promise<{ observationId: number; text: string; duration?: number }> {
  const result = await transcribeAudio(input);

  const entityName = input.filename
    ? input.filename.replace(/\.[^.]+$/, '')
    : `audio-${Date.now()}`;

  const { observation } = await storeFn({
    entityName,
    type: 'discovery',
    title: `Audio transcript: ${entityName}`,
    narrative: result.text,
    concepts: ['audio', 'transcript', ...(result.language ? [result.language] : [])],
    projectId,
  });

  return {
    observationId: observation.id,
    text: result.text,
    duration: result.duration,
  };
}
