/** A local import/relink may stop without aborting the project lifetime or any
 * separately consented cloud operation that shares that lifetime. */
export function createLocalMediaOperation(parent: AbortSignal) {
  const controller = new AbortController();
  const cancel = (
    reason: unknown = new DOMException("Import cancelled.", "AbortError"),
  ) => {
    if (!controller.signal.aborted) controller.abort(reason);
  };
  const parentAborted = () => cancel(parent.reason);
  if (parent.aborted) parentAborted();
  else parent.addEventListener("abort", parentAborted, { once: true });
  return {
    signal: controller.signal,
    cancel,
    dispose: () => parent.removeEventListener("abort", parentAborted),
  };
}
