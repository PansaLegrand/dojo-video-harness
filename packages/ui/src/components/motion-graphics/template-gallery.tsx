import { useEffect, useMemo, useRef, useState } from "react";
import {
  MotionForgeCanvasPreview,
  type MotionForgeCanvasPreviewHandle,
} from "@/components/motionforge/motionforge-canvas-preview";
import {
  motionTemplates,
  defaultMotionSettings,
  type MotionTemplateId,
} from "@/lib/motion-graphics/catalog";
import { motionDocument } from "@/lib/motion-graphics/templates";
import { compileEditorDocument } from "@/lib/editor/document";
import { motionTemplateName } from "@/lib/motion-graphics/copy";
function Card({
  id,
  locale,
  selected,
  onSelect,
  disabled,
}: {
  id: MotionTemplateId;
  locale: string;
  selected: boolean;
  onSelect: () => void;
  disabled?: boolean;
}) {
  const player = useRef<MotionForgeCanvasPreviewHandle>(null),
    hovering = useRef(false);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!ready) return;
    const frame = requestAnimationFrame(() => player.current?.seek(30));
    return () => cancelAnimationFrame(frame);
  }, [ready]);
  const title = motionTemplateName(id, locale);
  const scene = useMemo(() => {
    const document = motionDocument(defaultMotionSettings(id));
    // Keep composition geometry consistent with the real output; CSS sizes the card.
    return compileEditorDocument(document, {});
  }, [id]);
  return (
    <button
      type="button"
      data-motion-template={id}
      aria-label={title}
      aria-pressed={selected}
      disabled={disabled}
      onClick={onSelect}
      onMouseEnter={() => {
        hovering.current = true;
        player.current?.play();
      }}
      onMouseLeave={() => {
        hovering.current = false;
        player.current?.pause();
      }}
      onFocus={() => {
        hovering.current = true;
        player.current?.play();
      }}
      onBlur={() => {
        hovering.current = false;
        player.current?.pause();
      }}
      className={`w-full overflow-hidden rounded-xl border bg-white text-left transition ${selected ? "border-violet-500 ring-2 ring-violet-200" : "border-slate-200 hover:border-violet-300"}`}
    >
      <div
        className="pointer-events-none aspect-video overflow-hidden"
        aria-hidden="true"
      >
        <MotionForgeCanvasPreview
          ref={player}
          scene={scene}
          title={title}
          compact
          showControls={false}
          onPlaybackStateChange={(state) => {
            if (state.status === "ready" && !ready) setReady(true);
            if (state.status === "ready" && !state.playing && hovering.current)
              player.current?.play();
          }}
        />
      </div>
      <span className="block px-3 py-2.5 text-sm font-semibold text-slate-900">
        {title}
      </span>
    </button>
  );
}
export function MotionTemplateGallery({
  locale,
  selected,
  onSelect,
  disabled,
}: {
  locale: string;
  selected?: MotionTemplateId;
  onSelect: (id: MotionTemplateId) => void;
  disabled?: boolean;
}) {
  return (
    <div className="grid gap-3" data-motion-gallery>
      {motionTemplates.map((template) => (
        <Card
          key={template.id}
          id={template.id}
          locale={locale}
          selected={selected === template.id}
          onSelect={() => onSelect(template.id)}
          disabled={disabled}
        />
      ))}
    </div>
  );
}
