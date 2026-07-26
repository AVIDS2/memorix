/**
 * Run an operation with a bounded wait without leaving its watchdog alive.
 *
 * The underlying operation is not force-cancelled because many existing
 * callers do not expose an AbortSignal. Its settlement is still observed so a
 * late rejection is handled, while the caller receives the timeout promptly.
 */
export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);

    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
