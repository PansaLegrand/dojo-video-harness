import { useMemo, useState, type ReactNode } from "react";
import {
  Eye,
  Film,
  FolderOpen,
  ImageIcon,
  Music2,
  PanelLeftClose,
  Plus,
  Search,
  Subtitles,
  Type,
  Upload,
} from "lucide-react";
import { requiresLocalVideoProxy } from "@/lib/dojo-video-engine-browser/preview-proxy-policy";
import { EditorSourcePreview } from "./editor-source-preview";
import {
  filterEditorLibrary,
  type EditorMediaFilter,
  type EditorSourceRange,
} from "./editor-source-range";
import type { EditorAsset, EditorItem } from "@/lib/editor/document";
import type { EditorMediaPreview } from "./editor-media-previews";
import { EditorCaptionPanel } from "./editor-caption-panel";
import { EditorVisualizerLibrary } from "./editor-visualizer-presets";
import type { MusicVisualizerLayerTemplateKey } from "@/types/music-visualizer";
import { MotionTemplateGallery } from "@/components/motion-graphics/template-gallery";
import { motionCopy } from "@/lib/motion-graphics/copy";
import type { MotionTemplateId } from "@/lib/motion-graphics/catalog";
import { useTranslation } from "@/lib/i18n";
import { editorTextStyles } from "./editor-presets";
import { useNativeEditorText } from "./native-editor-copy";

export type EditorTool =
  | "media"
  | "text"
  | "captions"
  | "visualizer"
  | "graphics"
  | "project";

/** The original editor's tool browser. Selected-clip controls replace this panel. */
export function EditorLibrary({
  tool,
  selectedItemId,
  library,
  sources,
  previews,
  items,
  fps = 30,
  hidden = false,
  transcriptPanel,
  disabled,
  upload,
  onCancelImport,
  onClose,
  onImport,
  onDrop,
  onAddMedia,
  onAddText,
  onAddMotion,
  onImportCaptions,
  onAddCaption,
  onCreateCaptions,
  onTranslateCaptions,
  captionBusy,
  onSelect,
  onAddVisualizer,
  onRelink,
}: {
  tool: EditorTool;
  selectedItemId: string | null;
  library: EditorAsset[];
  sources: Record<string, string>;
  previews: Record<string, EditorMediaPreview>;
  items: EditorItem[];
  fps?: number;
  hidden?: boolean;
  transcriptPanel?: ReactNode;
  disabled: boolean;
  upload: { name: string; progress: number } | null;
  onCancelImport?: () => void;
  onClose: () => void;
  onImport: () => void;
  onDrop: (files: File[]) => void;
  onAddMedia: (asset: EditorAsset, range?: EditorSourceRange) => void;
  onAddText: (preset?: string) => void;
  onAddMotion: (id: MotionTemplateId) => void;
  onImportCaptions: () => void;
  onAddCaption: () => void;
  onCreateCaptions: (item: EditorItem) => void;
  onTranslateCaptions: (item: EditorItem) => void;
  captionBusy: boolean;
  onSelect: (id: string) => void;
  onAddVisualizer: (
    item: EditorItem,
    key?: MusicVisualizerLayerTemplateKey,
  ) => void;
  onRelink: (asset: EditorAsset) => void;
}) {
  const t = useNativeEditorText();
  const { locale } = useTranslation();
  const graphicsCopy = motionCopy(locale);
  const [search, setSearch] = useState(""),
    [mediaType, setMediaType] = useState<EditorMediaFilter>("all");
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [captionMode, setCaptionMode] = useState<"captions" | "speech">(
    "captions",
  );
  const visible = useMemo(
    () => filterEditorLibrary(library, search, mediaType),
    [library, search, mediaType],
  );
  const previewAsset = library.find((asset) => asset.id === previewId);
  const needsRelink = (asset: EditorAsset) =>
    !sources[asset.id] ||
    (requiresLocalVideoProxy(asset) && !sources[asset.id]?.startsWith("blob:"));
  const title =
    tool === "graphics"
      ? graphicsCopy.panel
      : tool === "text"
        ? "Text"
        : tool === "captions"
          ? "Captions"
          : tool === "visualizer"
            ? "Music visualizer"
            : "Media";
  if (hidden) return null;
  return (
    <aside
      className="editor-library"
      hidden={hidden}
      aria-label="Media library"
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes("Files")) event.preventDefault();
      }}
      onDrop={(event) => {
        event.preventDefault();
        onDrop(Array.from(event.dataTransfer.files));
      }}
    >
      <div className="editor-panel-heading">
        <h2>{t(title)}</h2>
        <button aria-label="Hide library" onClick={onClose}>
          <PanelLeftClose size={17} />
        </button>
      </div>
      <div className="editor-library-content">
        {tool === "graphics" ? (
          <>
            <p className="editor-section-label">{graphicsCopy.insert}</p>
            <MotionTemplateGallery
              locale={locale}
              onSelect={onAddMotion}
              disabled={disabled}
            />
          </>
        ) : tool === "text" ? (
          <>
            <button
              className="editor-primary-button editor-wide-button"
              disabled={disabled}
              onClick={() => onAddText()}
            >
              <Plus size={17} />
              {t("Add text")}
            </button>
            <p className="editor-section-label">{t("Text style")}</p>
            <div className="editor-preset-grid">
              {Object.entries(editorTextStyles).map(([key, preset]) => (
                <button
                  key={key}
                  className="editor-text-preset"
                  disabled={disabled}
                  onClick={() => onAddText(key)}
                >
                  <span
                    className={`editor-preset-sample editor-preset-${key}`}
                    style={{
                      color: preset.style.color,
                      fontWeight: preset.style.fontWeight as number,
                      fontStyle: preset.style.fontStyle,
                      textShadow: preset.style.textShadow,
                    }}
                  >
                    {t(preset.label)}
                  </span>
                  <span>{t(preset.label)}</span>
                </button>
              ))}
            </div>
          </>
        ) : tool === "captions" ? (
          <>
            {transcriptPanel && (
              <div
                className="editor-panel-switch"
                role="group"
                aria-label={t("Caption editing mode")}
              >
                <button
                  aria-pressed={captionMode === "captions"}
                  onClick={() => setCaptionMode("captions")}
                >
                  {t("Captions")}
                </button>
                <button
                  aria-pressed={captionMode === "speech"}
                  onClick={() => setCaptionMode("speech")}
                >
                  {t("Edit speech")}
                </button>
              </div>
            )}
            {captionMode === "speech" && transcriptPanel ? (
              transcriptPanel
            ) : (
              <EditorCaptionPanel
                items={items}
                disabled={disabled}
                busy={captionBusy}
                onSelect={onSelect}
                onCreate={onCreateCaptions}
                onTranslate={onTranslateCaptions}
                onImport={onImportCaptions}
                onManual={onAddCaption}
              />
            )}
          </>
        ) : tool === "visualizer" ? (
          <>
            <EditorVisualizerLibrary
              items={items}
              selectedItemId={selectedItemId}
              disabled={disabled}
              onAdd={onAddVisualizer}
              onImport={onImport}
            />
          </>
        ) : (
          <>
            <button
              className="editor-import-zone"
              disabled={disabled || !!upload}
              onClick={onImport}
            >
              <span className="editor-import-icon">
                <Upload size={23} strokeWidth={1.5} />
              </span>
              <strong>{t("Import media")}</strong>
              <span>
                {t("Drop video, audio or images here. Up to 250 MB per file.")}
              </span>
            </button>
            {upload && (
              <div
                role="status"
                aria-label={onCancelImport ? t("Import media") : undefined}
                className="editor-upload-status"
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="min-w-0 truncate">
                    {t(`Importing ${upload.name}`)}
                  </p>
                  {onCancelImport && (
                    <button
                      type="button"
                      className="shrink-0 underline"
                      onClick={onCancelImport}
                    >
                      {t("Cancel")}
                    </button>
                  )}
                </div>
                <progress max={1} value={upload.progress} />
              </div>
            )}
            <div className="editor-quick-add">
              <button onClick={() => onAddText()} disabled={disabled}>
                <Type size={16} />
                {t("Text")}
              </button>
              <button onClick={onImportCaptions} disabled={disabled}>
                <Subtitles size={16} />
                {t("SRT")}
              </button>
              <button onClick={onAddCaption} disabled={disabled}>
                <Plus size={16} />
                {t("Add a caption")}
              </button>
            </div>
            <div className="editor-section-label">
              {t("Media library")}
              <span>{library.length}</span>
            </div>
            {!!library.length && (
              <div className="editor-library-search">
                <label>
                  <Search size={14} />
                  <input
                    aria-label={t("Search media")}
                    placeholder={t("Search media")}
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                  />
                </label>
                <select
                  aria-label={t("Media type")}
                  value={mediaType}
                  onChange={(event) =>
                    setMediaType(event.target.value as EditorMediaFilter)
                  }
                >
                  {(["all", "video", "audio", "image"] as const).map((type) => (
                    <option key={type} value={type}>
                      {t(
                        type === "all"
                          ? "All media"
                          : type === "video"
                            ? "Video"
                            : type === "audio"
                              ? "Audio"
                              : "Image",
                      )}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {previewAsset && !hidden && !needsRelink(previewAsset) && (
              <EditorSourcePreview
                key={`${previewAsset.id}:${sources[previewAsset.id]}`}
                asset={previewAsset}
                source={sources[previewAsset.id]!}
                poster={previews[previewAsset.id]?.frames?.[0]?.src}
                fps={fps}
                disabled={disabled}
                onClose={() => setPreviewId(null)}
                onAdd={(range) => onAddMedia(previewAsset, range)}
              />
            )}
            {!library.length && (
              <div className="editor-library-empty">
                <FolderOpen size={29} strokeWidth={1.3} />
                <p>{t("Your imported media will appear here.")}</p>
              </div>
            )}
            {!!library.length && !visible.length && (
              <p className="editor-library-empty" role="status">
                {t("No media matches your search.")}
              </p>
            )}
            <div className="editor-asset-grid">
              {visible.map((asset) => (
                <div key={asset.id}>
                  <button
                    className="editor-asset-card"
                    disabled={disabled || needsRelink(asset)}
                    onClick={() => onAddMedia(asset)}
                    title={`Add ${asset.name} at playhead`}
                  >
                    <span className="editor-asset-thumbnail">
                      {previews[asset.id]?.frames?.[0]?.src ||
                      (asset.type === "image" && sources[asset.id]) ? (
                        <img
                          src={
                            previews[asset.id]?.frames?.[0]?.src ??
                            sources[asset.id]
                          }
                          alt=""
                        />
                      ) : asset.type === "video" ? (
                        <Film size={26} />
                      ) : asset.type === "audio" ? (
                        <Music2 size={26} />
                      ) : (
                        <ImageIcon size={26} />
                      )}
                      <span className="editor-asset-add">
                        <Plus size={14} />
                      </span>
                    </span>
                    <span className="editor-asset-name">{asset.name}</span>
                    <span className="editor-asset-status">
                      {t(
                        needsRelink(asset)
                          ? "Media unavailable"
                          : asset.source === "local"
                            ? "On this device"
                            : "Cloud available",
                      )}
                      {asset.durationSeconds
                        ? ` · ${asset.durationSeconds.toFixed(1)}s`
                        : ""}
                    </span>
                  </button>
                  {!needsRelink(asset) && (
                    <button
                      className="editor-relink inline-flex items-center gap-1"
                      aria-label={`${t("Preview media")}: ${asset.name}`}
                      onClick={() => setPreviewId(asset.id)}
                      disabled={disabled}
                    >
                      <Eye size={13} />
                      {t("Preview media")}
                    </button>
                  )}
                  {previews[asset.id]?.error && sources[asset.id] && (
                    <button
                      className="editor-relink"
                      title={previews[asset.id].error}
                      onClick={previews[asset.id].retry}
                      disabled={disabled}
                    >
                      {t("Retry")}
                    </button>
                  )}
                  {needsRelink(asset) && asset.source !== "static" && (
                    <button
                      className="editor-relink"
                      onClick={() => onRelink(asset)}
                    >
                      {t("Relink original file")}
                    </button>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </aside>
  );
}
