/**
 * Small kernel registry for named derived-view health readers.
 *
 * The registry owns naming, replacement, and failure isolation. It does not
 * own a view's storage or lifecycle; concrete adapters remain responsible for
 * refresh, rebuild, compaction, and close.
 */
export type DerivedViewReceiptReader<Receipt> = () => Receipt;

export class DerivedViewRegistry<Receipt extends object> {
  private readonly readers = new Map<string, DerivedViewReceiptReader<Receipt>>();

  register(name: string, reader: DerivedViewReceiptReader<Receipt>): () => void {
    const normalized = name.trim();
    if (!normalized) throw new Error('Derived view name must not be empty');
    this.readers.set(normalized, reader);
    return () => {
      if (this.readers.get(normalized) === reader) this.readers.delete(normalized);
    };
  }

  snapshot(): Record<string, Receipt> {
    const result: Record<string, Receipt> = {};
    for (const [name, reader] of this.readers) {
      try {
        result[name] = reader();
      } catch {
        result[name] = { state: 'degraded', reason: 'derived view reader failed' } as Receipt;
      }
    }
    return result;
  }
}
