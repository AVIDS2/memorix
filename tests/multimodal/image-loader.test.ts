import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { analyzeImage } from '../../src/multimodal/image-loader.js';
import { resetConfigCache } from '../../src/config.js';
import { setLLMConfig } from '../../src/llm/provider.js';

describe('image-loader', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    resetConfigCache();
    setLLMConfig(null);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    delete process.env.OPENAI_API_KEY;
    delete process.env.MEMORIX_LLM_API_KEY;
    delete process.env.MEMORIX_API_KEY;
    setLLMConfig(null);
    resetConfigCache();
  });

  it('analyzes image with structured JSON response', async () => {
    process.env.OPENAI_API_KEY = 'test-key';
    setLLMConfig({ provider: 'openai', apiKey: 'test-key', model: 'gpt-4o', baseUrl: 'https://api.openai.com/v1' });
    globalThis.fetch = (async () => {
      return new Response(JSON.stringify({
        choices: [{
          message: {
            content: '{"description":"A cat sitting on a windowsill","tags":["animal","cat","indoor"],"entities":["cat","windowsill"]}',
          },
        }],
      }), { status: 200 });
    }) as typeof fetch;

    const result = await analyzeImage({ base64: 'dGVzdA==', mimeType: 'image/png' });
    expect(result.description).toBe('A cat sitting on a windowsill');
    expect(result.tags).toContain('cat');
    expect(result.tags).toContain('animal');
    expect(result.entities).toContain('cat');
  });

  it('falls back to text when JSON parse fails', async () => {
    process.env.OPENAI_API_KEY = 'test-key';
    setLLMConfig({ provider: 'openai', apiKey: 'test-key', model: 'gpt-4o', baseUrl: 'https://api.openai.com/v1' });
    globalThis.fetch = (async () => {
      return new Response(JSON.stringify({
        choices: [{
          message: { content: 'This is a beautiful mountain landscape with snow-capped peaks.' },
        }],
      }), { status: 200 });
    }) as typeof fetch;

    const result = await analyzeImage({ base64: 'dGVzdA==' });
    expect(result.description).toBe('This is a beautiful mountain landscape with snow-capped peaks.');
    expect(result.tags).toEqual([]);
    expect(result.entities).toEqual([]);
  });

  it('handles JSON wrapped in markdown code block', async () => {
    process.env.OPENAI_API_KEY = 'test-key';
    setLLMConfig({ provider: 'openai', apiKey: 'test-key', model: 'gpt-4o', baseUrl: 'https://api.openai.com/v1' });
    globalThis.fetch = (async () => {
      return new Response(JSON.stringify({
        choices: [{
          message: {
            content: '```json\n{"description":"A diagram","tags":["diagram"],"entities":["flowchart"]}\n```',
          },
        }],
      }), { status: 200 });
    }) as typeof fetch;

    const result = await analyzeImage({ base64: 'dGVzdA==' });
    expect(result.description).toBe('A diagram');
    expect(result.tags).toContain('diagram');
  });

  it('throws when LLM not configured', async () => {
    setLLMConfig(null);
    delete process.env.OPENAI_API_KEY;
    delete process.env.MEMORIX_LLM_API_KEY;
    delete process.env.MEMORIX_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENROUTER_API_KEY;

    await expect(
      analyzeImage({ base64: 'dGVzdA==' }),
    ).rejects.toThrow('LLM not configured');
  });

  it('throws when provider is not OpenAI-compatible', async () => {
    setLLMConfig({ provider: 'anthropic', apiKey: 'test-key', model: 'claude-3-5-haiku-latest', baseUrl: 'https://api.anthropic.com/v1' });

    await expect(
      analyzeImage({ base64: 'dGVzdA==' }),
    ).rejects.toThrow('OpenAI-compatible');
  });

  it('passes custom prompt to Vision LLM', async () => {
    process.env.OPENAI_API_KEY = 'test-key';
    setLLMConfig({ provider: 'openai', apiKey: 'test-key', model: 'gpt-4o', baseUrl: 'https://api.openai.com/v1' });
    let sentBody: string = '';
    globalThis.fetch = (async (_url: any, opts: any) => {
      sentBody = typeof opts?.body === 'string' ? opts.body : '';
      return new Response(JSON.stringify({
        choices: [{ message: { content: '{"description":"Custom analysis","tags":[],"entities":[]}' } }],
      }), { status: 200 });
    }) as typeof fetch;

    await analyzeImage({
      base64: 'dGVzdA==',
      prompt: 'Extract text from this screenshot',
    });

    expect(sentBody).toContain('Extract text from this screenshot');
  });

  it('sends correct Vision API format', async () => {
    process.env.OPENAI_API_KEY = 'test-key';
    setLLMConfig({ provider: 'openai', apiKey: 'test-key', model: 'gpt-4o', baseUrl: 'https://api.openai.com/v1' });
    let parsedBody: any = null;
    globalThis.fetch = (async (_url: any, opts: any) => {
      parsedBody = JSON.parse(opts?.body ?? '{}');
      return new Response(JSON.stringify({
        choices: [{ message: { content: '{"description":"test","tags":[],"entities":[]}' } }],
      }), { status: 200 });
    }) as typeof fetch;

    await analyzeImage({ base64: 'aW1hZ2VkYXRh', mimeType: 'image/jpeg' });

    expect(parsedBody).toBeTruthy();
    const content = parsedBody.messages[0].content;
    expect(content).toBeInstanceOf(Array);
    expect(content[0].type).toBe('text');
    expect(content[1].type).toBe('image_url');
    expect(content[1].image_url.url).toContain('data:image/jpeg;base64,');
  });

  it('handles Vision LLM API errors', async () => {
    process.env.OPENAI_API_KEY = 'test-key';
    setLLMConfig({ provider: 'openai', apiKey: 'test-key', model: 'gpt-4o', baseUrl: 'https://api.openai.com/v1' });
    globalThis.fetch = (async () => {
      return new Response('Model not found', { status: 404 });
    }) as typeof fetch;

    await expect(
      analyzeImage({ base64: 'dGVzdA==' }),
    ).rejects.toThrow('Vision LLM error (404)');
  });
});
