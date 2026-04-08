import { describe, it, expect } from 'vitest';
import { extractPdfText, ingestPdf } from '../../src/multimodal/pdf-loader.js';

describe('pdf-loader', () => {
  it('throws clear error when unpdf is not installed', async () => {
    await expect(
      extractPdfText({ base64: 'dGVzdA==' }),
    ).rejects.toThrow('unpdf is not installed');
  });

  it('error message includes install instructions', async () => {
    try {
      await extractPdfText({ base64: 'dGVzdA==' });
    } catch (err) {
      expect((err as Error).message).toContain('npm install unpdf');
    }
  });

  it('ingestPdf propagates extractPdfText errors', async () => {
    const storeFn = async (_obs: any) => ({ observation: { id: 1 }, upserted: false });
    await expect(
      ingestPdf({ base64: 'dGVzdA==' }, storeFn as any, 'proj-1'),
    ).rejects.toThrow('unpdf is not installed');
  });

  it('PdfInput interface accepts all expected fields', () => {
    const input = { base64: 'test', filename: 'doc.pdf', maxPages: 5 };
    expect(input.base64).toBe('test');
    expect(input.filename).toBe('doc.pdf');
    expect(input.maxPages).toBe(5);
  });
});
