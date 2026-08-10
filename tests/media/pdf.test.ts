import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { importMediaBuffer } from '../../src/media/asset-store.js';
import { MediaStore } from '../../src/media/media-store.js';
import { derivePdfText } from '../../src/media/pdf.js';
import { closeDatabase } from '../../src/store/sqlite-db.js';

const roots: string[] = [];

function buildPdf(pages: string[]): Buffer {
  const pageObjectIds = pages.map((_, index) => 3 + index * 2);
  const fontObjectId = 3 + pages.length * 2;
  const objects = new Map<number, string>();
  objects.set(1, '<< /Type /Catalog /Pages 2 0 R >>');
  objects.set(2, `<< /Type /Pages /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`);
  pages.forEach((text, index) => {
    const pageId = pageObjectIds[index];
    const contentId = pageId + 1;
    const stream = `BT\n/F1 12 Tf\n72 720 Td\n(${text.replace(/[\\()]/g, '\\$&')}) Tj\nET`;
    objects.set(pageId, `<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 ${fontObjectId} 0 R >> >> /MediaBox [0 0 612 792] /Contents ${contentId} 0 R >>`);
    objects.set(contentId, `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);
  });
  objects.set(fontObjectId, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');

  let document = '%PDF-1.4\n';
  const offsets = [0];
  for (let id = 1; id <= fontObjectId; id += 1) {
    offsets[id] = Buffer.byteLength(document);
    document += `${id} 0 obj\n${objects.get(id)}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(document);
  document += `xref\n0 ${fontObjectId + 1}\n0000000000 65535 f \n`;
  for (let id = 1; id <= fontObjectId; id += 1) {
    document += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
  }
  document += `trailer\n<< /Size ${fontObjectId + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(document, 'utf8');
}

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'memorix-pdf-'));
  roots.push(root);
  return { dataDir: path.join(root, 'data'), projectId: 'test/pdf-project' };
}

afterEach(async () => {
  for (const root of roots.splice(0)) {
    closeDatabase(path.join(root, 'data'));
    await rm(root, { recursive: true, force: true });
  }
});

describe('controlled PDF text derivations', () => {
  it('extracts page-labelled chunks and durable provenance from an explicit PDF asset', async () => {
    const input = await fixture();
    const imported = await importMediaBuffer({
      ...input,
      bytes: buildPdf(['Architecture decision', 'Retry behavior']),
      filename: 'design.pdf',
      sourceKind: 'import',
    });

    const derived = await derivePdfText({ ...input, assetId: imported.asset.id, chunkChars: 30 });

    expect(imported.asset).toMatchObject({ kind: 'document', mimeType: 'application/pdf' });
    expect(derived.chunks).toHaveLength(2);
    expect(derived.derivation).toMatchObject({
      kind: 'pdf-text',
      status: 'ready',
      metadata: { extractor: 'unpdf', pageCount: 2, processedPages: 2, chunkCount: 2 },
    });
    expect(derived.derivation.content).toContain('Page 1');
    expect(derived.derivation.content).toContain('Architecture decision');
    expect(derived.derivation.content).toContain('Retry behavior');
  });

  it('records a failed derivation for malformed input without creating a text projection', async () => {
    const input = await fixture();
    const imported = await importMediaBuffer({
      ...input,
      bytes: Buffer.from('%PDF-not-a-real-document'),
      filename: 'broken.pdf',
      sourceKind: 'import',
    });

    await expect(derivePdfText({ ...input, assetId: imported.asset.id })).rejects.toThrow(/PDF text extraction failed/i);
    expect(new MediaStore(input.dataDir).listDerivations(input.projectId, imported.asset.id)).toMatchObject([
      { kind: 'pdf-text', status: 'failed', content: '' },
    ]);
  });

  it('fails closed before indexing when the PDF exceeds the caller page budget', async () => {
    const input = await fixture();
    const imported = await importMediaBuffer({
      ...input,
      bytes: buildPdf(['One', 'Two']),
      filename: 'two-pages.pdf',
      sourceKind: 'import',
    });

    await expect(derivePdfText({ ...input, assetId: imported.asset.id, maxPages: 1 })).rejects.toThrow(/2 pages; limit is 1/i);
    expect(new MediaStore(input.dataDir).listDerivations(input.projectId, imported.asset.id)[0]).toMatchObject({
      kind: 'pdf-text',
      status: 'failed',
      metadata: { maxPages: 1 },
    });
  });
});
