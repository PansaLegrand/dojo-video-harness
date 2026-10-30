"use client";
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import type { EditorPreviewChange } from "./editor-preview-compiler";

/** One latest value per animation frame; cancellation invalidates queued callbacks. */
export class LatestFrameDraft<Value> {
  private handle: number | null = null;
  private pending: Value | null = null;
  private generation = 0;
  constructor(
    private readonly publish: (value: Value) => void,
    private readonly request = (callback: FrameRequestCallback) => requestAnimationFrame(callback),
    private readonly cancelFrame = (handle: number) => cancelAnimationFrame(handle),
  ) {}
  push(value: Value) {
    this.pending = value;
    if (this.handle !== null) return;
    const generation = this.generation;
    this.handle = this.request(() => {
      if (generation !== this.generation) return;
      this.handle = null;
      const latest = this.pending;
      this.pending = null;
      if (latest !== null) this.publish(latest);
    });
  }
  cancel() {
    this.generation++;
    if (this.handle !== null) this.cancelFrame(this.handle);
    this.handle = null;
    this.pending = null;
  }
}

type ScopedPreviewDraft = { selectionId: string | null; nodeId: string | null; change: EditorPreviewChange };

export function useEditorPreviewDraft(selectionId: string | null, nodeId: string | null) {
  const [draft, setDraft] = useState<ScopedPreviewDraft | null>(null);
  const selection = useRef({ selectionId, nodeId });
  selection.current = { selectionId, nodeId };
  const queue = useRef<LatestFrameDraft<ScopedPreviewDraft> | null>(null);
  queue.current ??= new LatestFrameDraft(value => {
    if (value.selectionId === selection.current.selectionId && value.nodeId === selection.current.nodeId) setDraft(value);
  });
  useLayoutEffect(() => {
    queue.current!.cancel();
    setDraft(null);
    return () => queue.current!.cancel();
  }, [selectionId, nodeId]);
  const previewChange = useCallback((change: EditorPreviewChange | null) => {
    if (!change) { queue.current!.cancel(); setDraft(null); return; }
    queue.current!.push({ selectionId, nodeId, change });
  }, [selectionId, nodeId]);
  const change = draft?.selectionId === selectionId && draft.nodeId === nodeId ? draft.change : null;
  return { change, previewChange };
}
