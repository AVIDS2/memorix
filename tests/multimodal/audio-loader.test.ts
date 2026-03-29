import { describe, it, expect, afterEach, beforeEach } from 'bun:test';
import { transcribeAudio, ingestAudio } from '../../src/multimodal/audio-loader.js';
import { resetConfigCache } from '../../src/config.js';

describe('audio-loader', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    resetConfigCache();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    // Clean up env vars
    delete process.env.OPENAI_API_KEY;
    delete process.env.MEMORIX_LLM_API_KEY;
    delete process.env.MEMORIX_API_KEY;
    delete process.env.MEMORIX_AUDIO_PROVIDER;
    resetConfigCache();
  });

  it('calls OpenAI Whisper endpoint by default', async () => {
    let calledUrl = '';
    let calledHeaders: Record<string, string> = {};
    globalThis.fetch = (async (url: any, opts: any) => {
      calledUrl = String(url);
      calledHeaders = opts?.headers ?? {};
      return new Response(JSON.stringify({ text: 'hello world', duration: 5.2 }), { status: 200 });
    }) as typeof fetch;

    process.env.OPENAI_API_KEY = 'test-key-123';
    const result = await transcribeAudio({
      base64: Buffer.from('fake audio data').toString('base64'),
    });

    expect(calledUrl).toContain('api.openai.com');
    expect(calledUrl).toContain('/audio/transcriptions');
    expect(calledHeaders['Authorization']).toBe('Bearer test-key-123');
    expect(result.text).toBe('hello world');
    expect(result.duration).toBe(5.2);
    expect(result.provider).toBe('openai');
  });

  it('calls Groq endpoint when provider=groq', async () => {
    let calledUrl = '';
    globalThis.fetch = (async (url: any) => {
      calledUrl = String(url);
      return new Response(JSON.stringify({ text: 'groq result' }), { status: 200 });
    }) as typeof fetch;

    process.env.OPENAI_API_KEY = 'test-key';
    const result = await transcribeAudio({
      base64: Buffer.from('fake').toString('base64'),
      provider: 'groq',
    });

    expect(calledUrl).toContain('api.groq.com');
    expect(result.provider).toBe('groq');
  });

  it('uses MEMORIX_AUDIO_PROVIDER env var', async () => {
    let calledUrl = '';
    globalThis.fetch = (async (url: any) => {
      calledUrl = String(url);
      return new Response(JSON.stringify({ text: 'env result' }), { status: 200 });
    }) as typeof fetch;

    process.env.OPENAI_API_KEY = 'test-key';
    process.env.MEMORIX_AUDIO_PROVIDER = 'groq';
    const result = await transcribeAudio({
      base64: Buffer.from('fake').toString('base64'),
    });

    expect(calledUrl).toContain('api.groq.com');
    expect(result.provider).toBe('groq');
  });

  it('throws when no API key configured', async () => {
    // Ensure no API keys are set
    delete process.env.OPENAI_API_KEY;
    delete process.env.MEMORIX_LLM_API_KEY;
    delete process.env.MEMORIX_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENROUTER_API_KEY;

    await expect(
      transcribeAudio({ base64: 'dGVzdA==' }),
    ).rejects.toThrow('No API key configured');
  });

  it('throws on API error response', async () => {
    globalThis.fetch = (async () => {
      return new Response('Rate limit exceeded', { status: 429 });
    }) as typeof fetch;

    process.env.OPENAI_API_KEY = 'test-key';
    await expect(
      transcribeAudio({ base64: Buffer.from('audio').toString('base64') }),
    ).rejects.toThrow('Whisper API error (429)');
  });

  it('passes language parameter', async () => {
    let formData: FormData | null = null;
    globalThis.fetch = (async (_url: any, opts: any) => {
      formData = opts?.body;
      return new Response(JSON.stringify({ text: 'bonjour', language: 'fr' }), { status: 200 });
    }) as typeof fetch;

    process.env.OPENAI_API_KEY = 'test-key';
    const result = await transcribeAudio({
      base64: Buffer.from('french audio').toString('base64'),
      language: 'fr',
    });

    expect(result.text).toBe('bonjour');
    expect(result.language).toBe('fr');
    // FormData should have language field
    expect(formData).toBeTruthy();
  });

  it('ingestAudio stores observation with correct fields', async () => {
    globalThis.fetch = (async () => {
      return new Response(JSON.stringify({ text: 'transcribed content', duration: 30 }), { status: 200 });
    }) as typeof fetch;

    process.env.OPENAI_API_KEY = 'test-key';

    let storedObs: Record<string, unknown> | null = null;
    const storeFn = async (obs: Record<string, unknown>) => {
      storedObs = obs;
      return { observation: { id: 42 }, upserted: false };
    };

    const result = await ingestAudio(
      { base64: Buffer.from('audio data').toString('base64'), filename: 'meeting-notes.mp3' },
      storeFn as any,
      'project-123',
    );

    expect(result.observationId).toBe(42);
    expect(result.text).toBe('transcribed content');
    expect(result.duration).toBe(30);
    expect(storedObs).toBeTruthy();
    expect(storedObs!.entityName).toBe('meeting-notes');
    expect(storedObs!.type).toBe('discovery');
    expect(storedObs!.projectId).toBe('project-123');
    expect((storedObs!.concepts as string[])).toContain('audio');
    expect((storedObs!.concepts as string[])).toContain('transcript');
  });

  it('ingestAudio uses timestamp for unnamed files', async () => {
    globalThis.fetch = (async () => {
      return new Response(JSON.stringify({ text: 'text' }), { status: 200 });
    }) as typeof fetch;

    process.env.OPENAI_API_KEY = 'test-key';

    let storedObs: Record<string, unknown> | null = null;
    const storeFn = async (obs: Record<string, unknown>) => {
      storedObs = obs;
      return { observation: { id: 1 }, upserted: false };
    };

    await ingestAudio(
      { base64: Buffer.from('data').toString('base64') },
      storeFn as any,
      'proj',
    );

    expect(storedObs).toBeTruthy();
    expect((storedObs!.entityName as string)).toMatch(/^audio-\d+$/);
  });
});
