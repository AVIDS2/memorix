import { getDocumentProxy } from 'unpdf';

import { sanitizeCredentials } from '../memory/secret-filter.js';
import { readMediaAsset } from './asset-store.js';
import { MediaStore } from './media-store.js';
import type { MediaAsset, MediaDerivation } from './types.js';

export const DEFAULT_PDF_MAX_BYTES = 20 * 1024 * 1024;
export const DEFAULT_PDF_MAX_PAGES = 100;
export const DEFAULT_PDF_MAX_CHARS = 120_000;
export const DEFAULT_PDF_CHUNK_CHARS = 8_000;

export interface PdfDerivationInput {
  dataDir: string;
  projectId: string;
  assetId: string;
  maxBytes?: number;
  maxPages?: number;
  maxChars?: number;
  chunkChars?: number;
}

export interface PdfTextChunk {
  pageStart: number;
  pageEnd: number;
  text: string;
}

export interface PdfDerivationResult {
  asset: MediaAsset;
  derivation: MediaDerivation;
  chunks: PdfTextChunk[];
}

function positiveLimit(value: number | undefined, fallback: number, label: string): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved <= 0) throw new Error(`${label} must be a positive whole number`);
  return resolved;
}

function pageText(content: { items: Array<unknown> }): string {
  return content.items
    .map((item) => item && typeof item === 'object' && 'str' in item && typeof item.str === 'string' ? item.str.trim() : '')
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function chunkPages(pages: Array<{ page: number; text: string }>, maxChars: number, chunkChars: number): PdfTextChunk[] {
  const chunks: PdfTextChunk[] = [];
  let current = '';
  let pageStart = 0;
  let pageEnd = 0;
  for (const page of pages) {
    const section = `Page ${page.page}\n${page.text || '[No extractable text on this page.]'}`;
    if (section.length > maxChars) throw new Error(`PDF page ${page.page} exceeds the configured text limit`);
    if (current && current.length + section.length + 2 > chunkChars) {
      chunks.push({ pageStart, pageEnd, text: current });
      current = '';
    }
    if (!current) pageStart = page.page;
    current = current ? `${current}\n\n${section}` : section;
    pageEnd = page.page;
    if (current.length > maxChars) throw new Error(`PDF text exceeds the configured limit of ${maxChars} characters`);
  }
  if (current) chunks.push({ pageStart, pageEnd, text: current });
  return chunks;
}

export async function derivePdfText(input: PdfDerivationInput): Promise<PdfDerivationResult> {
  const maxBytes = positiveLimit(input.maxBytes, DEFAULT_PDF_MAX_BYTES, 'maxBytes');
  const maxPages = positiveLimit(input.maxPages, DEFAULT_PDF_MAX_PAGES, 'maxPages');
  const maxChars = positiveLimit(input.maxChars, DEFAULT_PDF_MAX_CHARS, 'maxChars');
  const chunkChars = positiveLimit(input.chunkChars, DEFAULT_PDF_CHUNK_CHARS, 'chunkChars');
  if (chunkChars > maxChars) throw new Error('chunkChars cannot exceed maxChars');

  const store = new MediaStore(input.dataDir);
  const asset = store.getAsset(input.projectId, input.assetId);
  if (!asset) throw new Error(`Media asset not found: ${input.assetId}`);
  if (asset.kind !== 'document' || asset.mimeType !== 'application/pdf') {
    throw new Error(`Asset ${asset.id} is not a PDF document`);
  }

  try {
    const bytes = await readMediaAsset(input.dataDir, asset, maxBytes);
    const pdf = await getDocumentProxy(new Uint8Array(bytes), {
      useSystemFonts: true,
      maxImageSize: 16_777_216,
      stopAtErrors: true,
      verbosity: 0,
    });
    try {
      if (pdf.numPages > maxPages) throw new Error(`PDF has ${pdf.numPages} pages; limit is ${maxPages}`);
      const pages: Array<{ page: number; text: string }> = [];
      let totalChars = 0;
      for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
        const page = await pdf.getPage(pageNumber);
        const text = pageText(await page.getTextContent());
        totalChars += text.length;
        if (totalChars > maxChars) throw new Error(`PDF text exceeds the configured limit of ${maxChars} characters`);
        pages.push({ page: pageNumber, text });
      }
      const chunks = chunkPages(pages, maxChars, chunkChars);
      const content = chunks.map((chunk) => `[Pages ${chunk.pageStart}-${chunk.pageEnd}]\n${chunk.text}`).join('\n\n');
      const derivation = store.addDerivation({
        projectId: input.projectId,
        assetId: asset.id,
        kind: 'pdf-text',
        content,
        metadata: {
          extractor: 'unpdf',
          pageCount: pdf.numPages,
          processedPages: pages.length,
          chunkCount: chunks.length,
          truncated: false,
          maxPages,
          maxChars,
        },
        status: 'ready',
      });
      return { asset, derivation, chunks };
    } finally {
      await pdf.loadingTask.destroy();
    }
  } catch (error) {
    const message = sanitizeCredentials(error instanceof Error ? error.message : String(error)).slice(0, 1_000);
    store.addDerivation({
      projectId: input.projectId,
      assetId: asset.id,
      kind: 'pdf-text',
      content: '',
      metadata: { extractor: 'unpdf', maxPages, maxChars },
      status: 'failed',
      error: message,
    });
    throw new Error(`PDF text extraction failed: ${message}`);
  }
}
