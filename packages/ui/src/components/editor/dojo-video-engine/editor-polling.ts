/** Serial polling pauses in background tabs and refreshes when the editor regains focus. */
export function startEditorPolling(refresh: () => Promise<unknown>, intervalMs: number, onError?: (cause: unknown) => void) {
  let stopped = false;
  let running = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const visible = () => document.visibilityState !== "hidden";
  async function poll() {
    clearTimeout(timer);
    if (stopped || running || !visible()) return;
    running = true;
    let failed = false;
    try { await refresh(); }
    catch (cause) { failed = true; if (!stopped) onError?.(cause); }
    finally {
      running = false;
      if (!stopped && visible()) timer = setTimeout(poll, failed ? Math.max(intervalMs, 30_000) : intervalMs);
    }
  }
  const wake = () => { void poll(); };
  document.addEventListener("visibilitychange", wake);
  window.addEventListener("focus", wake);
  wake();
  return () => {
    stopped = true;
    clearTimeout(timer);
    document.removeEventListener("visibilitychange", wake);
    window.removeEventListener("focus", wake);
  };
}
