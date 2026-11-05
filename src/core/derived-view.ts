export interface DerivedViewStatus {
  state: 'ready' | 'missing' | 'stale' | 'degraded' | 'rebuilding' | 'unavailable';
  generation?: number;
  rowCount?: number;
  reason?: string;
}

/** A derived index can fail or be rebuilt without changing canonical records. */
export interface DerivedView<RefreshInput> {
  status(): Promise<DerivedViewStatus>;
  refresh(input: RefreshInput): Promise<void>;
  rebuild(): Promise<boolean>;
  compact(): Promise<void>;
  close(): Promise<void>;
}
