/**
 * PDF Loader — unpdf Integration
 *
 * Extracts text from PDFs using unpdf (pure JS, optional dependency).
 * Creates per-page observations for searchable memory storage.
 */

// ── Types ────────────────────────────────────────────────────────────

export interface PdfInput {
  base64: string;
  filename?: string;
  maxPages?: number;
}

export interface PdfPage {
  pageNumber: number;
  text: string;
  charCount: number;
}

export interface PdfExtractionResult {
  pages: PdfPage[];
  totalPages: number;
  extractionMethod: 'unpdf';
}

// ── Core Functions ───────────────────────────────────────────────────

/**
 * Extract text from a PDF document page-by-page.
 *
 * @throws Error if unpdf is not installed (it's an optional dependency).
 */
export async function extractPdfText(input: PdfInput): Promise<PdfExtractionResult> {
  // Dynamic import — unpdf is optional
  const unpdf = await import('unpdf').catch(() => null) as {
    extractText: (data: Uint8Array, options?: { mergePages?: boolean }) => Promise<{ totalPages: number; text: string; pages?: string[] }>;
  } | null;

  if (!unpdf) {
    throw new Error(
      'unpdf is not installed. To enable PDF ingestion, run:\n' +
      '  npm install unpdf\n' +
      'or: bun add unpdf',
    );
  }

  const buffer = Buffer.from(input.base64, 'base64');
  const maxPages = input.maxPages ?? 100;

  const result = await unpdf.extractText(new Uint8Array(buffer), { mergePages: false });

  // unpdf returns pages as array when mergePages: false
  const rawPages = result.pages ?? result.text.split('\f');

  const pages: PdfPage[] = [];
  const limit = Math.min(rawPages.length, maxPages);

  for (let i = 0; i < limit; i++) {
    const text = String(rawPages[i] ?? '').trim();
    if (text.length >= 10) {
      pages.push({
        pageNumber: i + 1,
        text,
        charCount: text.length,
      });
    }
  }

  return {
    pages,
    totalPages: rawPages.length,
    extractionMethod: 'unpdf',
  };
}

/**
 * Extract PDF text and store each page as a Memorix observation.
 */
export async function ingestPdf(
  input: PdfInput,
  storeFn: (obs: {
    entityName: string;
    type: string;
    title: string;
    narrative: string;
    concepts: string[];
    projectId: string;
  }) => Promise<{ observation: { id: number }; upserted: boolean }>,
  projectId: string,
): Promise<{ observationIds: number[]; pagesProcessed: number; totalChars: number }> {
  const extraction = await extractPdfText(input);

  const entityName = input.filename
    ? input.filename.replace(/\.[^.]+$/, '')
    : `pdf-${Date.now()}`;

  const observationIds: number[] = [];
  let totalChars = 0;

  for (const page of extraction.pages) {
    const narrative = page.text.length > 5000
      ? page.text.slice(0, 5000) + '…'
      : page.text;

    const { observation } = await storeFn({
      entityName,
      type: 'discovery',
      title: `${entityName} — Page ${page.pageNumber}`,
      narrative,
      concepts: ['pdf', 'document', entityName],
      projectId,
    });

    observationIds.push(observation.id);
    totalChars += page.charCount;
  }

  return {
    observationIds,
    pagesProcessed: extraction.pages.length,
    totalChars,
  };
}
