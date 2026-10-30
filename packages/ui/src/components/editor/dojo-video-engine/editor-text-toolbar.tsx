"use client";

import { useEffect, useState } from "react";
import { AlignCenter, AlignLeft, AlignRight, Bold, Italic, Type, PaintBucket, Eraser } from "lucide-react";
import type { EditorItem } from "@/lib/editor/document";
import type { SceneStyle } from "@dojo-video-engine/schema";
import { editorFontWeights } from "@/lib/editor/fonts";
import { EditorFontPicker } from "./editor-font-picker";
import { EditorField } from "./editor-fields";
import { editorTextBackgroundProperty } from "./editor-presets";
import { useNativeEditorText } from "./native-editor-copy";

/** Frequently used typography controls stay beside the preview, as in v7. */
export function EditorTextToolbar({ item, disabled, onStyle, onPreviewStyle, onFont }: {
  item: EditorItem;
  disabled: boolean;
  onFont: (family: string) => void;
  onStyle: (style: Partial<SceneStyle>) => void;
  onPreviewStyle: (style: Partial<SceneStyle> | null) => void;
}) {
  const t = useNativeEditorText();
  const style = item.node.style ?? {};
  const backgroundProperty = editorTextBackgroundProperty(style);
  const background = style[backgroundProperty];
  const [backgroundDraft, setBackgroundDraft] = useState<string | null>(null);
  useEffect(() => setBackgroundDraft(null), [item.id, item.node.id]);
  const visibleBackground = backgroundDraft ?? background;
  const isTransparent = !visibleBackground || visibleBackground === "transparent";
  const weights = editorFontWeights(style.fontFamily ?? "Inter");
  const boldWeight = weights.find(weight => weight >= 700);
  return <div className="editor-text-toolbar" role="toolbar" aria-label={t("Text formatting")}>
    <EditorFontPicker compact label="Font family" value={style.fontFamily ?? "Inter"} disabled={disabled} onChange={onFont} onPreview={family => onPreviewStyle(family === null ? null : { fontFamily: family })} />
    <EditorField label="Text size" type="number" min={1} max={800} value={Number(style.fontSize ?? 48)} disabled={disabled} onPreview={value => onPreviewStyle(value === null ? null : { fontSize: Number(value) })} onCommit={value => onStyle({ fontSize: Number(value) })} />
    <button aria-label={t("Bold")} title={t("Bold")} aria-pressed={Number(style.fontWeight ?? 400) >= 700} disabled={disabled || !boldWeight} onClick={() => onStyle({ fontWeight: Number(style.fontWeight ?? 400) >= 700 ? weights[0] : boldWeight })}><Bold size={16} /></button>
    <button aria-label={t("Italic")} title={t("Italic")} aria-pressed={style.fontStyle === "italic"} disabled={disabled} onClick={() => onStyle({ fontStyle: style.fontStyle === "italic" ? "normal" : "italic" })}><Italic size={16} /></button>
    <span className="editor-toolbar-divider" />
    {([{ value: "left", label: "Align left", icon: AlignLeft }, { value: "center", label: "Align center", icon: AlignCenter }, { value: "right", label: "Align right", icon: AlignRight }] as const).map(alignment => <button key={alignment.value} aria-label={t(alignment.label)} title={t(alignment.label)} aria-pressed={style.textAlign === alignment.value} disabled={disabled} onClick={() => onStyle({ textAlign: alignment.value })}><alignment.icon size={16} /></button>)}
    <span className="editor-toolbar-divider" />
    <div className="editor-toolbar-color" title={t("Font color")}>
      <Type size={15} aria-hidden="true" />
      <EditorField label="Font color" type="color" value={style.color ?? "#ffffff"} disabled={disabled}
        onPreview={value => onPreviewStyle(value === null ? null : { color: value })}
        onCommit={value => onStyle({ color: value })} />
    </div>
    <div className="editor-toolbar-color" data-transparent={isTransparent} title={t(isTransparent ? "Transparent background" : "Background color")}>
      <PaintBucket size={15} aria-hidden="true" />
      <EditorField label="Background color" type="color" value={background ?? "#000000"} disabled={disabled}
        onPreview={value => { setBackgroundDraft(value); onPreviewStyle(value === null ? null : { [backgroundProperty]: value }); }}
        onCommit={value => onStyle({ [backgroundProperty]: value })} />
    </div>
    <button aria-label={t("Transparent background")} title={t("Transparent background")}
      disabled={disabled || isTransparent}
      onClick={() => onStyle({ backgroundColor: "transparent", textBackgroundColor: undefined })}><Eraser size={16} /></button>

  </div>;
}
