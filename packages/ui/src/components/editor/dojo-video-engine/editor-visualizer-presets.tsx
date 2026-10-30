import { useState } from "react";
import { Upload } from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import type { EditorItem } from "@/lib/editor/document";
import { getMusicVisualizerTemplateOptions } from "@/components/music-visualizer/music-visualizer-page-config";
import { VisualizerTemplatePreview } from "@/components/music-visualizer/music-visualizer-template-preview";
import {
  getMusicVisualizerLayerTemplate,
  type MusicVisualizerLayerTemplateKey,
} from "@/types/music-visualizer";
import { editorVisualizerTemplateKey } from "./editor-visualizers";
import { useNativeEditorText } from "./native-editor-copy";

export function EditorVisualizerPresets({
  disabled,
  effect,
  onChoose,
}: {
  disabled?: boolean;
  effect?: EditorItem["node"]["effect"];
  onChoose: (key: MusicVisualizerLayerTemplateKey) => void;
}) {
  const { t } = useTranslation();
  const selected = editorVisualizerTemplateKey(effect);
  return (
    <div
      className="editor-visualizer-grid"
      role="group"
      aria-label={t("application.music_visualizer.label.visualizer_template")}
    >
      {getMusicVisualizerTemplateOptions(t).map((option) => (
        <button
          key={option.value}
          type="button"
          className="editor-visualizer-card"
          data-visualizer-template={option.value}
          aria-label={option.label}
          title={option.description}
          aria-pressed={selected === option.value}
          disabled={disabled}
          onClick={() => onChoose(option.value)}
        >
          <VisualizerTemplatePreview
            template={getMusicVisualizerLayerTemplate(option.value)}
          />
          <span className="editor-visualizer-card-name">{option.label}</span>
        </button>
      ))}
    </div>
  );
}

export function EditorVisualizerLibrary({
  items,
  selectedItemId,
  disabled,
  onAdd,
  onImport,
}: {
  items: EditorItem[];
  selectedItemId: string | null;
  disabled: boolean;
  onAdd: (item: EditorItem, key: MusicVisualizerLayerTemplateKey) => void;
  onImport: () => void;
}) {
  const t = useNativeEditorText();
  const [sourceId, setSourceId] = useState<string | null>(null);
  const audio = items.filter((item) =>
    ["video", "audio"].includes(item.node.type),
  );
  const source =
    audio.find((item) => item.id === sourceId) ??
    audio.find((item) => item.id === selectedItemId) ??
    audio[0];
  return (
    <>
      {source ? (
        <label className="editor-visualizer-source">
          <span>{t("Source media")}</span>
          <select
            aria-label={t("Source media")}
            value={source.id}
            disabled={disabled}
            onChange={(event) => setSourceId(event.target.value)}
          >
            {audio.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <>
          <button
            className="editor-primary-button editor-wide-button"
            disabled={disabled}
            onClick={onImport}
          >
            <Upload size={16} />
            {t("Import media")}
          </button>
          <p className="editor-muted-copy">
            {t("Select a video or audio clip to add a music visualizer.")}
          </p>
        </>
      )}
      <p className="editor-section-label">{t("Look")}</p>
      <EditorVisualizerPresets
        disabled={disabled || !source}
        onChoose={(key) => {
          if (source) onAdd(source, key);
        }}
      />
    </>
  );
}
