import type { EditorPropertyPreview } from "./editor-property-preview";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type {
  SceneAnimation,
  SceneNodeInput,
  SceneStyle,
} from "@dojo-video-engine/schema";
import { editorCaptionDisplayMode } from "@/lib/editor/document";
import type {
  CaptionCue,
  EditorDocument,
  EditorItem,
} from "@/lib/editor/document";
import { MotionTemplateControls } from "@/components/motion-graphics/template-controls";
import {
  motionTemplateOf,
  readMotionSettings,
  updateMotionGraphic,
} from "@/lib/motion-graphics/templates";
import { EditorFraming } from "./editor-framing-controls";
import { EditorFontPicker } from "./editor-font-picker";
import {
  EditorField,
  EditorSelect,
  EditorTextArea,
  inputColor,
} from "./editor-fields";
export { EditorField, EditorSelect, EditorTextArea } from "./editor-fields";
import { EditorCaptionContent } from "./editor-caption-content";
import { useNativeEditorText } from "./native-editor-copy";
import { useTranslation } from "@/lib/i18n";
import { VisualizerTemplatePreview } from "@/components/music-visualizer/music-visualizer-template-preview";
import { getMusicVisualizerTemplateOptions } from "@/components/music-visualizer/music-visualizer-page-config";
import { MUSIC_VISUALIZER_TEMPLATE_RENDER_CONFIG } from "@/components/music-visualizer/music-visualizer-template-config";
import { getMusicVisualizerLayerTemplate } from "@/types/music-visualizer";
import {
  applyEditorVisualizerPreset,
  editorVisualizerTemplateKey,
} from "./editor-visualizers";
import {
  editorAspectRatios,
  editorAspectRatioValue,
} from "./editor-aspect-ratio";
import { EditorExportResolutionSelect } from "./editor-export-resolution";
import type { EditorExportResolution } from "@/lib/editor/export-resolution";
import { editorCanvasDimensionError } from "@/lib/editor/canvas-format";
import {
  editorMediaFilters,
  editorTextStyles,
  editorTextStylePatch,
  updateEditorNodeStyle,
  editorTextBackgroundProperty,
} from "./editor-presets";
import { editorCaptionPresetEntries } from "./editor-caption-presets";
import { editorFontWeights } from "@/lib/editor/fonts";
import { parseShadowValue, parseColorValue } from "@dojo-video-engine/schema/values";

function EditorShadowControls({
  value,
  onChange,
  onPreview,
}: {
  value?: string;
  onChange: (value: string | undefined) => void;
  onPreview: (value: string | null) => void;
}) {
  const shadow = value ? parseShadowValue(value) : null;
  const color =
    shadow?.color.kind === "rgba"
      ? shadow.color
      : { red: 0, green: 0, blue: 0, alpha: 1 };
  const update = (
    patch: Partial<{
      x: number;
      y: number;
      blur: number;
      color: string;
      alpha: number;
    }>,
    preview = false,
  ) => {
    const nextColor = patch.color ? parseColorValue(patch.color) : color;
    const rgb = nextColor && "red" in nextColor ? nextColor : color;
    (preview ? onPreview : onChange)(
      `${patch.x ?? shadow?.offsetX ?? 0}px ${patch.y ?? shadow?.offsetY ?? 2}px ${patch.blur ?? shadow?.blur ?? 4}px rgba(${rgb.red},${rgb.green},${rgb.blue},${patch.alpha ?? color.alpha})`,
    );
  };
  return (
    <div className="grid grid-cols-2 gap-2">
      <EditorField
        label="Shadow X"
        type="number"
        value={shadow?.offsetX ?? 0}
        min={-100}
        max={100}
        onCommit={(value) => update({ x: Number(value) })}
        onPreview={(value) =>
          value === null ? onPreview(null) : update({ x: Number(value) }, true)
        }
      />
      <EditorField
        label="Shadow Y"
        type="number"
        value={shadow?.offsetY ?? 0}
        min={-100}
        max={100}
        onCommit={(value) => update({ y: Number(value) })}
        onPreview={(value) =>
          value === null ? onPreview(null) : update({ y: Number(value) }, true)
        }
      />
      <EditorField
        label="Shadow blur"
        type="number"
        value={shadow?.blur ?? 0}
        min={0}
        max={100}
        onCommit={(value) => update({ blur: Number(value) })}
        onPreview={(value) =>
          value === null
            ? onPreview(null)
            : update({ blur: Number(value) }, true)
        }
      />
      <EditorField
        label="Shadow opacity"
        type="number"
        value={shadow ? color.alpha : 0}
        min={0}
        max={1}
        step={0.05}
        onCommit={(value) => update({ alpha: Number(value) })}
        onPreview={(value) =>
          value === null
            ? onPreview(null)
            : update({ alpha: Number(value) }, true)
        }
      />
      <EditorField
        label="Shadow color"
        type="color"
        value={
          value ? inputColor(shadow?.color.source ?? "#000000") : "#000000"
        }
        onCommit={(value) => update({ color: value })}
        onPreview={(value) =>
          value === null ? onPreview(null) : update({ color: value }, true)
        }
      />
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  const t = useNativeEditorText();
  return (
    <div className="space-y-3 border-b border-[var(--editor-border)] p-4">
      <h3 className="text-xs font-medium text-[var(--editor-text)]">
        {t(title)}
      </h3>
      {children}
    </div>
  );
}

export function animationPreset(
  preset: string,
  duration: number,
  opacity: number,
  baseTransform = "",
): SceneAnimation[] {
  if (preset === "none" || duration < 3) return [];
  const easeFrames = Math.min(15, Math.floor((duration - 1) / 2));
  const points = [
    { frame: 0, value: 0 },
    { frame: easeFrames, value: opacity },
    ...(duration - 1 - easeFrames > easeFrames
      ? [{ frame: duration - 1 - easeFrames, value: opacity }]
      : []),
    { frame: duration - 1, value: 0 },
  ];
  const animations: SceneAnimation[] = [
    { kind: "keyframes", property: "opacity", frames: points },
  ];
  const transform = baseTransform === "none" ? "" : baseTransform;
  if (preset === "slide")
    animations.push({
      kind: "keyframes",
      property: "transform",
      frames: [
        { frame: 0, value: `${transform} translate(0px, 60px)`.trim() },
        {
          frame: easeFrames,
          value: `${transform} translate(0px, 0px)`.trim(),
          easing: "easeOut",
        },
      ],
    });
  if (preset === "pop")
    animations.push({
      kind: "keyframes",
      property: "transform",
      frames: [
        { frame: 0, value: `${transform} scale(0.5)`.trim() },
        {
          frame: easeFrames,
          value: `${transform} scale(1)`.trim(),
          easing: "easeOut",
        },
      ],
    });
  return animations;
}

export function EditorInspector({
  document,
  selected,
  nestedSelection = false,
  sourceTimingLocked = false,
  frame = 0,
  onSelect,
  onSeek,
  disabled,
  busyCaption,
  onUpdate,
  onFormat,
  exportResolution,
  onExportResolution,
  onTrim,
  onMove,
  onTranscribe,
  onTranslate,
  onDownloadCaptions,
  onAddVisualizer,
  onFont,
  onPreviewStyle,
  onPreviewProperty,
  onPreviewText,
  onPreviewCue,
  onApplyCaptionPreset,
  contextualControls,
}: {
  document: EditorDocument;
  selected: EditorItem | null;
  nestedSelection?: boolean;
  sourceTimingLocked?: boolean;
  frame?: number;
  onSelect: (id: string) => void;
  onSeek: (frame: number) => void;
  disabled: boolean;
  busyCaption: boolean;
  onUpdate: (id: string, patch: Partial<Omit<EditorItem, "id">>) => void;
  onFormat: (patch: Partial<EditorDocument["format"]>) => void;
  exportResolution: EditorExportResolution;
  onExportResolution: (value: EditorExportResolution) => void;
  onTrim: (id: string, from: number, duration: number) => void;
  onMove: (id: string, from: number, trackId: string) => void;
  onTranscribe: (item: EditorItem, language: string) => void;
  onTranslate: (item: EditorItem, language: string) => void;
  onDownloadCaptions: (item: EditorItem) => void;
  onAddVisualizer: (item: EditorItem) => void;
  onFont: (item: EditorItem, family: string) => void;
  onPreviewProperty: (preview: EditorPropertyPreview | null) => void;
  onPreviewStyle: (item: EditorItem, style: Partial<SceneStyle> | null) => void;
  onPreviewText: (item: EditorItem, text: string | null) => void;
  onPreviewCue: (item: EditorItem, cue: CaptionCue | null) => void;
  onApplyCaptionPreset: (item: EditorItem, preset: string) => void;
  contextualControls?: ReactNode;
}) {
  const t = useNativeEditorText();
  const { t: translate, locale } = useTranslation();
  const scrollRef = useRef<HTMLElement>(null);
  const [translation, setTranslation] = useState("en");
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [selected?.id, selected?.node.id]);
  const node = selected?.node;
  const style = node?.style ?? {};
  const visualizerKey = editorVisualizerTemplateKey(node?.effect);
  const locked =
    disabled ||
    !!document.tracks.find((track) => track.id === selected?.trackId)?.locked;
  const isText = node?.type === "text" || !!selected?.caption;
  const media = node?.type === "video" || node?.type === "audio";
  const updateNode = (patch: Partial<SceneNodeInput>) => {
    if (selected)
      onUpdate(selected.id, { node: { ...selected.node, ...patch } });
  };
  const updateStyle = (patch: Partial<SceneStyle>) => {
    if (selected)
      onUpdate(selected.id, {
        node: updateEditorNodeStyle(selected.node, patch),
      });
  };
  const previewStyle = (patch: Partial<SceneStyle> | null) => {
    if (selected) onPreviewStyle(selected, patch);
  };
  const liveStyle = (
    change: (
      value: string,
      update: (patch: Partial<SceneStyle>) => void,
    ) => void,
  ) => ({
    onCommit: (value: string) => change(value, updateStyle),
    onPreview: (value: string | null) =>
      value === null ? previewStyle(null) : change(value, previewStyle),
  });
  const liveSelect = (
    change: (
      value: string,
      update: (patch: Partial<SceneStyle>) => void,
    ) => void,
  ) => {
    const handlers = liveStyle(change);
    return { onChange: handlers.onCommit, onPreview: handlers.onPreview };
  };

  const liveNode = (
    change: (
      value: string,
      update: (
        patch: Extract<EditorPropertyPreview, { kind: "node" }>["patch"],
      ) => void,
    ) => void,
  ) => ({
    onCommit: (value: string) => change(value, updateNode),
    onPreview: (value: string | null) => {
      if (value === null) onPreviewProperty(null);
      else if (selected)
        change(value, (patch) =>
          onPreviewProperty({
            kind: "node",
            itemId: selected.id,
            nodeId: selected.node.id!,
            patch,
          }),
        );
    },
  });
  const liveCaption = (
    patch: (
      value: string,
    ) => Extract<EditorPropertyPreview, { kind: "caption" }>["patch"],
  ) => ({
    onCommit: (value: string) => {
      if (selected?.caption)
        onUpdate(selected.id, {
          caption: { ...selected.caption, ...patch(value) },
        });
    },
    onPreview: (value: string | null) =>
      onPreviewProperty(
        value === null || !selected
          ? null
          : { kind: "caption", itemId: selected.id, patch: patch(value) },
      ),
  });

  return (
    <aside
      ref={scrollRef}
      className="h-full overflow-y-auto bg-[var(--editor-panel)]"
      aria-label="Inspector"
    >
      {contextualControls}
      {!selected ? (
        <Section title="Project">
          <p className="text-xs leading-5 text-[var(--editor-muted)]">
            {t(
              "Select a clip to edit it, or add media and text from the library.",
            )}
          </p>
          <fieldset disabled={disabled} className="space-y-3">
            <EditorSelect
              label="Aspect ratio"
              value={editorAspectRatioValue(document.format)}
              options={[
                ...editorAspectRatios.map((preset) => ({
                  value: preset.value,
                  label: preset.label,
                })),
                ...(editorAspectRatioValue(document.format) === "custom"
                  ? [
                      {
                        value: "custom",
                        label: `${t("Custom")} · ${document.format.width} × ${document.format.height}`,
                      },
                    ]
                  : []),
              ]}
              onChange={(value) => {
                const preset = editorAspectRatios.find(
                  (preset) => preset.value === value,
                );
                if (preset)
                  onFormat({ width: preset.width, height: preset.height });
              }}
            />
            <EditorExportResolutionSelect
              inspector
              format={document.format}
              value={exportResolution}
              onChange={onExportResolution}
              disabled={disabled}
            />
            <div className="grid grid-cols-2 gap-2">
              <EditorField
                label="Width"
                value={document.format.width}
                type="number"
                min={64}
                max={4096}
                step={2}
                validate={(value) => editorCanvasDimensionError(Number(value))}
                onCommit={(value) => onFormat({ width: Number(value) })}
                onPreview={(value) =>
                  onPreviewProperty(
                    value === null
                      ? null
                      : { kind: "format", patch: { width: Number(value) } },
                  )
                }
              />
              <EditorField
                label="Height"
                value={document.format.height}
                type="number"
                min={64}
                max={4096}
                step={2}
                validate={(value) => editorCanvasDimensionError(Number(value))}
                onCommit={(value) => onFormat({ height: Number(value) })}
                onPreview={(value) =>
                  onPreviewProperty(
                    value === null
                      ? null
                      : { kind: "format", patch: { height: Number(value) } },
                  )
                }
              />
            </div>
            <EditorField
              label="Background"
              value={document.format.backgroundColor}
              type="color"
              onCommit={(value) => onFormat({ backgroundColor: value })}
              onPreview={(value) =>
                onPreviewProperty(
                  value === null
                    ? null
                    : { kind: "format", patch: { backgroundColor: value } },
                )
              }
            />
            <EditorField
              label="Duration (seconds)"
              value={Number(
                (
                  document.format.durationInFrames / document.format.fps
                ).toFixed(3),
              )}
              type="number"
              step={1 / document.format.fps}
              min={1 / document.format.fps}
              onCommit={(value) =>
                onFormat({
                  durationInFrames: Math.round(
                    Number(value) * document.format.fps,
                  ),
                })
              }
            />
          </fieldset>
        </Section>
      ) : (
        <fieldset disabled={locked}>
          {!nestedSelection && motionTemplateOf(selected) && (
            <div className="mb-4 rounded-lg bg-slate-50 p-3">
              <MotionTemplateControls
                locale={locale}
                settings={readMotionSettings(selected, document.format)}
                disabled={locked}
                onChange={(patch) => {
                  const next = updateMotionGraphic(
                    selected,
                    document.format,
                    patch,
                  );
                  onUpdate(selected.id, {
                    node: next.node,
                    motionGraphic: next.motionGraphic,
                  });
                }}
                images={Object.values(document.assets).filter(
                  (asset) => asset.type === "image",
                )}
                imageId={
                  selected.node.children?.find((node) =>
                    node.id.endsWith(":media-frame"),
                  )?.children?.[0]?.assetId
                }
                onImage={(id) =>
                  onUpdate(selected.id, {
                    node: updateMotionGraphic(
                      selected,
                      document.format,
                      {},
                      id ? document.assets[id] : null,
                    ).node,
                  })
                }
              />
            </div>
          )}
          {selected.caption && (
            <EditorCaptionContent
              item={selected}
              document={document}
              frame={frame}
              disabled={locked || busyCaption}
              onUpdate={onUpdate}
              onSelect={onSelect}
              onSeek={onSeek}
              onTranslate={(item) =>
                onTranslate(item, item.caption?.language === "en" ? "es" : "en")
              }
              onStyle={onApplyCaptionPreset}
              onPreviewCue={onPreviewCue}
            />
          )}
          {node?.type === "effect" && (
            <Section title="Visualizer">
              {visualizerKey && (
                <div
                  className="editor-visualizer-current"
                  data-visualizer-preview={visualizerKey}
                >
                  <VisualizerTemplatePreview
                    template={getMusicVisualizerLayerTemplate(visualizerKey)}
                  />
                </div>
              )}
              <EditorSelect
                label="Look"
                value={node.effect ?? "spectrumBars"}
                options={getMusicVisualizerTemplateOptions(translate).map(
                  (option) => ({
                    value:
                      MUSIC_VISUALIZER_TEMPLATE_RENDER_CONFIG[option.value]
                        .effect,
                    label: option.label,
                  }),
                )}
                onChange={(value) => {
                  const key = editorVisualizerTemplateKey(
                    value as SceneNodeInput["effect"],
                  );
                  if (key)
                    onUpdate(selected.id, {
                      node: applyEditorVisualizerPreset(selected.node, key),
                    });
                }}
              />
              <EditorField
                label="Accent color"
                value={node.params?.colors?.[0] ?? "#a78bfa"}
                type="color"
                {...liveNode((value, update) =>
                  update({
                    params: {
                      ...node.params,
                      colors: [
                        value,
                        ...(node.params?.colors?.slice(1) ?? ["#22d3ee"]),
                      ],
                    },
                  }),
                )}
              />
              <EditorField
                label="Sensitivity"
                value={node.params?.sensitivity ?? 1}
                type="number"
                min={0.2}
                max={10}
                step={0.1}
                {...liveNode((value, update) =>
                  update({
                    params: { ...node.params, sensitivity: Number(value) },
                  }),
                )}
              />
            </Section>
          )}
          {isText && !selected.caption && (
            <div className="editor-text-content">
              <EditorTextArea
                label="Text"
                rows={4}
                value={
                  node?.text ??
                  node?.runs?.map((run) => run.text).join("") ??
                  ""
                }
                onPreview={(value) => onPreviewText(selected, value)}
                onCommit={(value) =>
                  updateNode({ text: value, runs: undefined })
                }
              />
            </div>
          )}
          <Section title={selected.caption ? "Captions" : selected.name}>
            {locked && (
              <p className="text-xs text-amber-400">
                {t("Unlock the track to edit this item.")}
              </p>
            )}
            <EditorField
              label="Name"
              disabled={nestedSelection}
              value={selected.name}
              onCommit={(value) => onUpdate(selected.id, { name: value })}
            />
            <EditorSelect
              label="Track"
              disabled={nestedSelection || !!selected.visualizerSourceItemId}
              value={selected.trackId}
              options={document.tracks
                .filter(
                  (track) =>
                    track.kind ===
                    (node?.type === "audio" ? "audio" : "visual"),
                )
                .map((track) => ({ value: track.id, label: track.name }))}
              onChange={(value) => onMove(selected.id, node?.from ?? 0, value)}
            />
            <fieldset
              disabled={!!selected.visualizerSourceItemId || sourceTimingLocked}
              className="grid grid-cols-2 gap-2"
            >
              <EditorField
                label="Start (s)"
                type="number"
                value={Number(
                  ((node?.from ?? 0) / document.format.fps).toFixed(3),
                )}
                min={nestedSelection ? undefined : 0}
                step={1 / document.format.fps}
                onCommit={(value) =>
                  onMove(
                    selected.id,
                    Math.round(Number(value) * document.format.fps),
                    selected.trackId,
                  )
                }
              />
              <EditorField
                label="Duration (s)"
                type="number"
                value={Number(
                  ((node?.duration ?? 1) / document.format.fps).toFixed(3),
                )}
                min={1 / document.format.fps}
                step={1 / document.format.fps}
                onCommit={(value) =>
                  onTrim(
                    selected.id,
                    node?.from ?? 0,
                    Math.max(
                      1,
                      Math.round(Number(value) * document.format.fps),
                    ),
                  )
                }
              />
            </fieldset>
          </Section>
          {node?.type !== "audio" && (
            <Section title="Size & appearance">
              <p className="text-[11px] text-[var(--editor-muted)]">
                {t("Drag on the preview to reposition this item.")}
              </p>
              <div className="grid grid-cols-2 gap-2">
                <EditorField
                  label="Width"
                  value={style.width ?? document.format.width}
                  {...liveStyle((value, update) =>
                    update({ width: Number(value) }),
                  )}
                  type="number"
                  min={1}
                />
                <EditorField
                  label="Height"
                  value={style.height ?? document.format.height}
                  {...liveStyle((value, update) =>
                    update({ height: Number(value) }),
                  )}
                  type="number"
                  min={1}
                />
                <EditorField
                  label="Rotation"
                  value={Number(
                    String(style.transform ?? "").match(
                      /rotate\((-?[\d.]+)deg\)/,
                    )?.[1] ?? 0,
                  )}
                  type="number"
                  {...liveStyle((value, update) =>
                    update({ transform: `rotate(${Number(value)}deg)` }),
                  )}
                />
                <EditorField
                  label="Opacity"
                  value={style.opacity ?? 1}
                  type="number"
                  min={0}
                  max={1}
                  step={0.1}
                  {...liveStyle((value, update) =>
                    update({ opacity: Number(value) }),
                  )}
                />
              </div>
              {["video", "img"].includes(node?.type ?? "") && (
                <>
                  <EditorSelect
                    label="Fit"
                    value={style.objectFit ?? "contain"}
                    options={["contain", "cover", "fill"].map((value) => ({
                      value,
                      label: value,
                    }))}
                    {...liveSelect((value, update) =>
                      update({
                        objectFit: value as "contain" | "cover" | "fill",
                      }),
                    )}
                  />
                  <EditorFraming
                    node={node!}
                    disabled={locked}
                    onChange={updateStyle}
                    onPreview={previewStyle}
                  />
                  <EditorSelect
                    label="Filter"
                    value={style.filter ?? "none"}
                    options={[
                      ...editorMediaFilters,
                      ...(!editorMediaFilters.some(
                        (preset) => preset.value === (style.filter ?? "none"),
                      )
                        ? [{ value: style.filter!, label: "Custom" }]
                        : []),
                    ]}
                    {...liveSelect((value, update) =>
                      update({ filter: value }),
                    )}
                  />
                  <EditorField
                    label="Brightness (%)"
                    value={Math.round(
                      (() => {
                        const match = (style.filter ?? "").match(
                          /brightness\(([\d.]+)(%)?\)/,
                        );
                        return match
                          ? Number(match[1]) * (match[2] ? 1 : 100)
                          : 100;
                      })(),
                    )}
                    type="number"
                    min={0}
                    max={200}
                    step={5}
                    {...liveStyle((value, update) =>
                      update({
                        filter: `${(style.filter ?? "")
                          .replace(/brightness\([^)]*\)/g, "")
                          .replace(/none/g, "")
                          .trim()} brightness(${Number(value)}%)`.trim(),
                      }),
                    )}
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <EditorField
                      label="Corners"
                      value={style.borderRadius ?? 0}
                      type="number"
                      min={0}
                      {...liveStyle((value, update) =>
                        update({ borderRadius: Number(value) }),
                      )}
                    />
                    <EditorField
                      label="Padding"
                      value={style.padding ?? 0}
                      type="number"
                      min={0}
                      {...liveStyle((value, update) =>
                        update({ padding: Number(value) }),
                      )}
                    />
                  </div>
                  <EditorField
                    label="Background color"
                    value={style.backgroundColor ?? "#000000"}
                    type="color"
                    {...liveStyle((value, update) =>
                      update({ backgroundColor: value }),
                    )}
                  />
                </>
              )}
              <EditorSelect
                label="Animation"
                value={node?.animations?.length ? "custom" : "none"}
                options={[
                  { value: "none", label: "None" },
                  { value: "fade", label: "Fade in & out" },
                  { value: "slide", label: "Slide up" },
                  { value: "pop", label: "Pop in" },
                  { value: "custom", label: "Applied animation" },
                ]}
                onChange={(value) => {
                  if (value !== "custom")
                    updateNode({
                      animations: animationPreset(
                        value,
                        node?.duration ?? 1,
                        style.opacity ?? 1,
                        style.transform,
                      ),
                    });
                }}
              />
            </Section>
          )}
          {media && (
            <Section title="Media & sound">
              <EditorField
                label="Source offset (s)"
                value={node?.videoStartTime ?? node?.audioStartTime ?? 0}
                type="number"
                min={0}
                step={0.01}
                onCommit={(value) =>
                  updateNode(
                    node?.type === "video"
                      ? { videoStartTime: Number(value) }
                      : { audioStartTime: Number(value) },
                  )
                }
              />
              {node?.type === "video" && (
                <EditorSelect
                  label="Speed"
                  value={String(node.playbackRate ?? 1)}
                  options={[0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4].map(
                    (value) => ({ value: String(value), label: `${value}×` }),
                  )}
                  onChange={(value) =>
                    updateNode({
                      playbackRate: Number(value),
                      duration: Math.max(
                        1,
                        Math.round(
                          ((node.duration ?? 1) * (node.playbackRate ?? 1)) /
                            Number(value),
                        ),
                      ),
                    })
                  }
                />
              )}
              <div className="grid grid-cols-[1fr_auto] items-end gap-2">
                <EditorField
                  label="Volume"
                  value={node?.volume ?? 1}
                  type="number"
                  min={0}
                  max={1}
                  step={0.05}
                  {...liveNode((value, update) =>
                    update({ volume: Number(value) }),
                  )}
                />
                <button
                  className="rounded border border-[var(--editor-border)] p-2 text-xs text-[var(--editor-text)]"
                  onClick={() =>
                    updateNode({ volume: node?.volume === 0 ? 1 : 0 })
                  }
                >
                  {t(node?.volume === 0 ? "Unmute" : "Mute")}
                </button>
              </div>
              <EditorSelect
                label="Audio fade"
                value={node?.volumeEnvelope?.length ? "applied" : "none"}
                options={[
                  { value: "none", label: "None" },
                  { value: "both", label: "Fade in & out" },
                  { value: "applied", label: "Applied envelope" },
                ]}
                onChange={(value) => {
                  const duration = node?.duration ?? 1;
                  const fade = Math.min(
                    Math.round(document.format.fps / 2),
                    Math.floor((duration - 1) / 2),
                  );
                  if (value === "none")
                    updateNode({ volumeEnvelope: undefined });
                  else if (value === "both" && fade > 0)
                    updateNode({
                      volumeEnvelope: [
                        { frame: 0, value: 0 },
                        { frame: fade, value: 1 },
                        ...(duration - 1 - fade > fade
                          ? [{ frame: duration - 1 - fade, value: 1 }]
                          : []),
                        { frame: duration - 1, value: 0 },
                      ],
                    });
                }}
              />
              <button
                className="w-full rounded border border-[var(--editor-border)] py-2 text-xs text-[var(--editor-text)] hover:bg-[var(--editor-hover)]"
                onClick={() => onAddVisualizer(selected)}
              >
                {t("Add music visualizer")}
              </button>
              <button
                disabled={busyCaption}
                className="w-full rounded bg-violet-600 py-2 text-xs text-white disabled:opacity-50"
                onClick={() => onTranscribe(selected, "auto")}
              >
                {t(
                  busyCaption
                    ? "Transcribing…"
                    : "Generate captions · your ASR provider",
                )}
              </button>
            </Section>
          )}
          {isText && (
            <Section title="Text style">
              <EditorSelect
                label="Style"
                value="custom"
                options={[
                  { value: "custom", label: "Custom" },
                  ...Object.entries(editorTextStyles).map(
                    ([value, preset]) => ({ value, label: preset.label }),
                  ),
                ]}
                onChange={(value) => {
                  const preset = editorTextStyles[value];
                  if (preset && selected)
                    onUpdate(selected.id, {
                      node: updateEditorNodeStyle(
                        selected.node,
                        editorTextStylePatch(selected.node, value),
                      ),
                      ...(selected.caption
                        ? {
                            caption: {
                              ...selected.caption,
                              highlightColor: preset.captionHighlightColor,
                              highlightStyle: undefined,
                            },
                          }
                        : {}),
                    });
                }}
              />
              <EditorFontPicker
                value={style.fontFamily ?? "Inter"}
                disabled={locked}
                onChange={(family) => onFont(selected, family)}
                onPreview={(family) =>
                  previewStyle(family === null ? null : { fontFamily: family })
                }
              />
              <div className="grid grid-cols-2 gap-2">
                <EditorField
                  label="Font size"
                  value={style.fontSize ?? 48}
                  type="number"
                  min={1}
                  max={600}
                  {...liveStyle((value, update) =>
                    update({ fontSize: Number(value) }),
                  )}
                />
                <EditorSelect
                  label="Weight"
                  value={String(style.fontWeight ?? 600)}
                  options={editorFontWeights(style.fontFamily ?? "Inter").map(
                    (value) => ({
                      value: String(value),
                      label: String(value),
                    }),
                  )}
                  {...liveSelect((value, update) =>
                    update({ fontWeight: Number(value) }),
                  )}
                />
              </div>
              <EditorSelect
                label="Alignment"
                value={style.textAlign ?? "center"}
                options={["left", "center", "right"].map((value) => ({
                  value,
                  label: value,
                }))}
                {...liveSelect((value, update) =>
                  update({
                    textAlign: value as "left" | "center" | "right",
                  }),
                )}
              />
              <div className="grid grid-cols-2 gap-2">
                <EditorField
                  label="Letter spacing"
                  value={style.letterSpacing ?? 0}
                  type="number"
                  step={0.25}
                  min={-20}
                  max={100}
                  {...liveStyle((value, update) =>
                    update({ letterSpacing: Number(value) }),
                  )}
                />
                <EditorField
                  label="Line height"
                  value={style.lineHeight ?? 1.2}
                  type="number"
                  step={0.05}
                  min={0.5}
                  max={3}
                  {...liveStyle((value, update) =>
                    update({ lineHeight: Number(value) }),
                  )}
                />
              </div>
              <EditorSelect
                label="Text fit"
                value={style.textFit ?? "wrap"}
                options={[
                  { value: "wrap", label: "Keep font size" },
                  { value: "shrink", label: "Fit inside box" },
                  { value: "truncate", label: "One line with ellipsis" },
                ]}
                {...liveSelect((value, update) =>
                  update({
                    textFit: value as "wrap" | "shrink" | "truncate",
                    textOverflow: value === "truncate" ? "ellipsis" : undefined,
                  }),
                )}
              />
              {style.textFit === "shrink" && (
                <EditorField
                  label="Minimum font size"
                  value={style.minFontSize ?? 12}
                  type="number"
                  min={1}
                  max={
                    typeof style.fontSize === "number" ? style.fontSize : 600
                  }
                  {...liveStyle((value, update) =>
                    update({ minFontSize: Number(value) }),
                  )}
                />
              )}
              <EditorField
                label="Maximum lines"
                value={style.maxLines ?? 0}
                type="number"
                min={0}
                max={20}
                disabled={style.textFit === "truncate"}
                {...liveStyle((value, update) =>
                  update({ maxLines: Number(value) || undefined }),
                )}
              />
              <div className="grid grid-cols-2 gap-2">
                <EditorField
                  label="Padding"
                  value={style.padding ?? 0}
                  type="number"
                  min={0}
                  max={200}
                  {...liveStyle((value, update) =>
                    update({ padding: Number(value) }),
                  )}
                />
                <EditorField
                  label="Corners"
                  value={style.borderRadius ?? 0}
                  type="number"
                  min={0}
                  max={200}
                  {...liveStyle((value, update) =>
                    update({ borderRadius: Number(value) }),
                  )}
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <EditorField
                  label="Text color"
                  value={style.color ?? "#ffffff"}
                  type="color"
                  {...liveStyle((value, update) => update({ color: value }))}
                />
                <EditorField
                  label="Background"
                  value={
                    style[editorTextBackgroundProperty(style)] ?? "#000000"
                  }
                  type="color"
                  {...liveStyle((value, update) =>
                    update({ [editorTextBackgroundProperty(style)]: value }),
                  )}
                />
              </div>
              <button
                className="text-xs text-[var(--editor-muted)] underline"
                onClick={() =>
                  updateStyle({
                    backgroundColor: "transparent",
                    textBackgroundColor: undefined,
                  })
                }
              >
                {t("Clear background")}
              </button>
              {((style.textBackgroundColor &&
                style.textBackgroundColor !== "transparent") ||
                (selected.caption &&
                  editorCaptionDisplayMode(selected.caption) === "karaoke" &&
                  selected.caption.highlightStyle?.textBackgroundColor)) && (
                <div className="grid grid-cols-2 gap-2">
                  <EditorField
                    label="Plate padding X"
                    type="number"
                    value={style.textBackgroundPaddingX ?? 0}
                    min={0}
                    max={100}
                    {...liveStyle((value, update) =>
                      update({ textBackgroundPaddingX: Number(value) }),
                    )}
                  />
                  <EditorField
                    label="Plate padding Y"
                    type="number"
                    value={style.textBackgroundPaddingY ?? 0}
                    min={0}
                    max={100}
                    {...liveStyle((value, update) =>
                      update({ textBackgroundPaddingY: Number(value) }),
                    )}
                  />
                  <EditorField
                    label="Plate corners"
                    type="number"
                    value={style.textBackgroundRadius ?? 0}
                    min={0}
                    max={999}
                    {...liveStyle((value, update) =>
                      update({ textBackgroundRadius: Number(value) }),
                    )}
                  />
                </div>
              )}
              <div className="grid grid-cols-2 gap-2">
                <EditorField
                  label="Outline width"
                  type="number"
                  value={Number(
                    String(style.textStroke ?? "").match(/^([\d.]+)px/)?.[1] ??
                      0,
                  )}
                  min={0}
                  max={20}
                  {...liveStyle((value, update) =>
                    update({
                      textStroke:
                        Number(value) > 0
                          ? `${Number(value)}px ${String(style.textStroke ?? "").replace(/^[\d.]+px\s*/, "") || "#000000"}`
                          : undefined,
                    }),
                  )}
                />
                <EditorField
                  label="Outline color"
                  type="color"
                  value={
                    String(style.textStroke ?? "").replace(
                      /^[\d.]+px\s*/,
                      "",
                    ) || "#000000"
                  }
                  {...liveStyle((value, update) =>
                    update({
                      textStroke: `${Number(String(style.textStroke ?? "").match(/^([\d.]+)px/)?.[1] ?? 2)}px ${value}`,
                    }),
                  )}
                />
              </div>
              <EditorSelect
                label="Text shadow"
                value={style.textShadow ?? "none"}
                options={[
                  { value: "none", label: "None" },
                  { value: "2px 2px 4px #000000", label: "Soft" },
                  { value: "3px 3px 0px #000000", label: "Hard" },
                  { value: "0px 0px 8px #d946ef", label: "Neon" },
                  ...(![
                    "none",
                    "2px 2px 4px #000000",
                    "3px 3px 0px #000000",
                    "0px 0px 8px #d946ef",
                  ].includes(style.textShadow ?? "none")
                    ? [{ value: style.textShadow!, label: "Custom" }]
                    : []),
                ]}
                {...liveSelect((value, update) =>
                  update({ textShadow: value === "none" ? undefined : value }),
                )}
              />
              <EditorShadowControls
                value={style.textShadow}
                onChange={(textShadow) => updateStyle({ textShadow })}
                onPreview={(textShadow) =>
                  previewStyle(textShadow === null ? null : { textShadow })
                }
              />
              <button
                className="rounded border border-[var(--editor-border)] px-3 py-1.5 text-xs italic"
                aria-pressed={style.fontStyle === "italic"}
                onClick={() =>
                  updateStyle({
                    fontStyle:
                      style.fontStyle === "italic" ? "normal" : "italic",
                  })
                }
              >
                {t("Italic")}
              </button>
            </Section>
          )}
          {selected.caption && (
            <>
              <Section title="Subtitle settings">
                <EditorSelect
                  label="Caption preset"
                  value="custom"
                  options={[
                    { value: "custom", label: "Custom" },
                    ...editorCaptionPresetEntries(
                      selected.caption.role === "translation",
                    ).map(([value, preset]) => ({
                      value,
                      label: preset.label,
                    })),
                  ]}
                  onChange={(key) => onApplyCaptionPreset(selected, key)}
                />
                {selected.caption.role !== "translation" && (
                  <label className="flex items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      aria-label={t("Lyric Pulse")}
                      checked={selected.caption.motion === "lyricPulse"}
                      disabled={
                        disabled ||
                        editorCaptionDisplayMode(selected.caption) ===
                          "sentence"
                      }
                      onChange={(event) =>
                        onUpdate(selected.id, {
                          caption: {
                            ...selected.caption!,
                            motion: event.target.checked
                              ? "lyricPulse"
                              : undefined,
                          },
                        })
                      }
                    />
                    {t("Lyric Pulse")}
                  </label>
                )}
                <EditorSelect
                  label="Caption style"
                  value={editorCaptionDisplayMode(selected.caption)}
                  disabled={selected.caption.role === "translation"}
                  options={[
                    { value: "sentence", label: "Sentence" },
                    ...(selected.caption.role === "translation"
                      ? []
                      : [
                          { value: "word", label: "One word" },
                          { value: "karaoke", label: "Word highlight" },
                        ]),
                  ]}
                  onChange={(value) =>
                    onUpdate(selected.id, {
                      caption: {
                        ...selected.caption!,
                        mode:
                          selected.caption!.role === "translation"
                            ? "sentence"
                            : (value as "sentence" | "word" | "karaoke"),
                      },
                    })
                  }
                />
                {editorCaptionDisplayMode(selected.caption) === "karaoke" && (
                  <EditorField
                    label="Highlight"
                    value={selected.caption.highlightColor}
                    type="color"
                    {...liveCaption((value) => ({ highlightColor: value }))}
                  />
                )}
                {editorCaptionDisplayMode(selected.caption) === "karaoke" && (
                  <>
                    <EditorField
                      label="Highlight background"
                      type="color"
                      value={
                        selected.caption.highlightStyle?.textBackgroundColor ??
                        "#facc15"
                      }
                      {...liveCaption((value) => ({
                        highlightStyle: {
                          ...selected.caption!.highlightStyle,
                          textBackgroundColor: value,
                        },
                      }))}
                    />
                    <button
                      className="text-xs text-[var(--editor-muted)] underline"
                      onClick={() =>
                        onUpdate(selected.id, {
                          caption: {
                            ...selected.caption!,
                            highlightStyle: {
                              ...selected.caption!.highlightStyle,
                              textBackgroundColor: undefined,
                            },
                          },
                        })
                      }
                    >
                      {t("Clear highlight background")}
                    </button>
                  </>
                )}
                <EditorSelect
                  label="Text direction"
                  value={selected.caption.direction}
                  options={[
                    { value: "ltr", label: "Left to right" },
                    { value: "rtl", label: "Right to left" },
                  ]}
                  onChange={(value) =>
                    onUpdate(selected.id, {
                      caption: {
                        ...selected.caption!,
                        direction: value as "ltr" | "rtl",
                      },
                    })
                  }
                />
                <EditorSelect
                  label="Translate to"
                  value={translation}
                  options={[
                    { value: "en", label: "English" },
                    { value: "zh", label: "Chinese" },
                    { value: "ja", label: "Japanese" },
                    { value: "ko", label: "Korean" },
                    { value: "es", label: "Spanish" },
                    { value: "fr", label: "French" },
                    { value: "de", label: "German" },
                    { value: "ar", label: "Arabic" },
                  ]}
                  onChange={setTranslation}
                />
                <button
                  disabled={busyCaption}
                  className="w-full rounded bg-violet-600 py-2 text-xs disabled:opacity-50"
                  onClick={() => onTranslate(selected, translation)}
                >
                  {t("Add translated track · your LLM")}
                </button>
                <button
                  className="w-full rounded border border-[var(--editor-border)] py-2 text-xs"
                  onClick={() => onDownloadCaptions(selected)}
                >
                  {t("Download SRT")}
                </button>
              </Section>
            </>
          )}
        </fieldset>
      )}
    </aside>
  );
}
