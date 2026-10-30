type ExportTask = { result: Promise<unknown>; cancel(): void };
const cancelled = () => new DOMException("Export cancelled.", "AbortError");

/** Cancels the wait without pretending the underlying platform promise can be
 * cancelled. A late resource is handed back for cleanup, never used for output. */
export function waitForExportStep<T>(
  pending: Promise<T>,
  signal: AbortSignal,
  abandon?: (value: T) => void,
): Promise<T> {
  return new Promise((resolve, reject) => {
    let finished = false;
    const abort = () => {
      if (!finished) {
        finished = true;
        signal.removeEventListener("abort", abort);
        reject(signal.reason ?? cancelled());
      }
    };
    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });
    pending.then(
      (value) => {
        if (finished) {
          try {
            void Promise.resolve(abandon?.(value)).catch(() => undefined);
          } catch {
            /* Preserve the settled cancellation. */
          }
          return;
        }
        finished = true;
        signal.removeEventListener("abort", abort);
        resolve(value);
      },
      (error) => {
        if (finished) return;
        finished = true;
        signal.removeEventListener("abort", abort);
        reject(error);
      },
    );
  });
}

/** Owns cancellation from the first setup await through the final readback. */
export function createExportOperation(parent?: AbortSignal) {
  const controller = new AbortController();
  let task: ExportTask | undefined;
  const cancel = (reason: unknown = cancelled()) => {
    if (controller.signal.aborted) return;
    controller.abort(reason);
    task?.cancel();
  };
  const parentAborted = () => cancel(parent?.reason ?? cancelled());
  if (parent?.aborted) parentAborted();
  else parent?.addEventListener("abort", parentAborted, { once: true });
  const check = () => {
    if (controller.signal.aborted)
      throw controller.signal.reason ?? cancelled();
  };
  return {
    signal: controller.signal,
    check,
    cancel,
    wait<T>(pending: Promise<T>, abandon?: (value: T) => void) {
      return waitForExportStep(pending, controller.signal, abandon);
    },
    attach<T extends ExportTask>(next: T): T {
      if (controller.signal.aborted) {
        void next.result.catch(() => undefined);
        next.cancel();
        check();
      }
      task = next;
      return next;
    },
    dispose() {
      parent?.removeEventListener("abort", parentAborted);
      task = undefined;
    },
  };
}
