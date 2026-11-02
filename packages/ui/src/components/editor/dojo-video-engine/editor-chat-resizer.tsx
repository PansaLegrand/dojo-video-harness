"use client";
import { useEffect, useRef, useState } from "react";

/** Workspace-only layout state; resizing never writes project commands/history. */
export function EditorChatResizer({ width, onChange, label }: { width: number; onChange: (width: number) => void; label: string }) {
  const [maximum, setMaximum] = useState(340);
  const drag = useRef<{ x: number; width: number } | null>(null);
  const clamp = (value: number) => Math.max(280, Math.min(window.innerWidth / 2, value));
  useEffect(() => {
    const resized = () => {
      setMaximum(Math.max(280, window.innerWidth / 2));
      if (window.innerWidth >= 900) onChange(clamp(width));
    };
    resized(); window.addEventListener("resize", resized);
    return () => window.removeEventListener("resize", resized);
  }, [width, onChange]);
  return <div className="editor-chat-resizer" role="separator" aria-label={label} aria-orientation="vertical" tabIndex={0}
    aria-valuemin={280} aria-valuemax={maximum} aria-valuenow={Math.min(width, maximum)}
    onPointerDown={event => { if (event.button !== 0) return; event.preventDefault(); event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId); drag.current = { x: event.clientX, width }; }}
    onPointerMove={event => { if (drag.current) onChange(clamp(drag.current.width + drag.current.x - event.clientX)); }}
    onPointerUp={event => { drag.current = null; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
    onPointerCancel={() => { if (drag.current) onChange(clamp(drag.current.width)); drag.current = null; }}
    onLostPointerCapture={() => { drag.current = null; }}
    onKeyDown={event => {
      if (event.key === "Escape" && drag.current) { onChange(clamp(drag.current.width)); drag.current = null; event.preventDefault(); }
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      onChange(clamp(event.key === "Home" ? 280 : event.key === "End" ? maximum : width + (event.key === "ArrowLeft" ? 1 : -1) * (event.shiftKey ? 40 : 10)));
    }}><span /></div>;
}
