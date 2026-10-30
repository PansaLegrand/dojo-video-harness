export const LOCAL_NATIVE_HASH_MAX_BYTES = 1024 * 1024;

export function throttledHashProgress(callback?: (fraction: number) => void) {
  let previous = -1,
    reportedAt = -Infinity;
  return (fraction: number) => {
    const now = performance.now();
    if (
      fraction === previous ||
      (fraction !== 0 && fraction !== 1 && now - reportedAt < 80)
    )
      return;
    previous = fraction;
    reportedAt = now;
    callback?.(fraction);
  };
}

export function abortableLocalRead<T>(
  pending: Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  if (!signal) return pending;
  return new Promise((resolve, reject) => {
    const abort = () => {
      signal.removeEventListener("abort", abort);
      reject(
        signal.reason ?? new DOMException("Import cancelled.", "AbortError"),
      );
    };
    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });
    pending.then(
      (value) => {
        signal.removeEventListener("abort", abort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", abort);
        reject(error);
      },
    );
  });
}
