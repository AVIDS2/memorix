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

/**
 * Run an operation with a deadline and an AbortSignal for cancellable work.
 * Callers should pass the signal to fetch/embedding/LLM APIs they own.
 */
export function withTimeoutSignal<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  ms: number,
  label: string,
  parentSignal?: AbortSignal,
): Promise<T> {
  const controller = new AbortController();
  const signal = parentSignal
    ? AbortSignal.any([parentSignal, controller.signal])
    : controller.signal;

  return new Promise<T>((resolve, reject) => {
    let settled = false;
    let timedOut = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const cleanup = () => {
      if (timer !== undefined) clearTimeout(timer);
      parentSignal?.removeEventListener('abort', onParentAbort);
    };
    const onParentAbort = () => {
      if (settled || timedOut) return;
      settled = true;
      cleanup();
      reject(parentSignal?.reason ?? new Error(`${label} aborted`));
    };
    parentSignal?.addEventListener('abort', onParentAbort, { once: true });

    timer = setTimeout(() => {
      if (settled) return;
      timedOut = true;
      controller.abort(new Error(`${label} timed out after ${ms}ms`));
      settled = true;
      cleanup();
      reject(new Error(`${label} timed out after ${ms}ms`));
    }, ms);

    let pending: Promise<T>;
    try {
      pending = operation(signal);
    } catch (error) {
      settled = true;
      cleanup();
      reject(error);
      return;
    }

    pending.then(
      (value) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(value);
      },
      (error: unknown) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(timedOut ? new Error(`${label} timed out after ${ms}ms`) : error);
      },
    );
  });
}
