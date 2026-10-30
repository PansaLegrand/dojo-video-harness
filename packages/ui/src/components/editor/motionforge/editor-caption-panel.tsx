import {
  Subtitles,
  Plus,
  Upload,
  ArrowDownRight,
  Languages,
} from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import type { EditorItem } from "@/lib/editor/document";
import { captionGroups, captionLanguageLabel } from "./editor-caption-workflow";
import { useNativeEditorText } from "./native-editor-copy";
export function EditorCaptionPanel({
  items,
  disabled,
  busy,
  onSelect,
  onCreate,
  onTranslate,
  onImport,
  onManual,
}: {
  items: EditorItem[];
  disabled: boolean;
  busy: boolean;
  onSelect: (id: string) => void;
  onCreate: (item: EditorItem) => void;
  onTranslate: (item: EditorItem) => void;
  onImport: () => void;
  onManual: () => void;
}) {
  const t = useNativeEditorText();
  const { locale } = useTranslation();
  const groups = captionGroups(items);
  const media = items.filter((item) =>
    ["video", "audio"].includes(item.node.type),
  );
  return (
    <div className="editor-caption-library">
      <div className="editor-section-label">
        {t("Existing captions")}
        <span>{items.filter((item) => item.caption).length}</span>
      </div>
      {!groups.length && (
        <p className="editor-muted-copy">
          {t("No captions yet. Create them from a clip or import an SRT file.")}
        </p>
      )}
      {groups.map((group) => (
        <div
          className="editor-caption-group"
          key={group.original.id}
          data-caption-group={group.original.id}
        >
          <button
            className="editor-caption-track"
            onClick={() => onSelect(group.original.id)}
          >
            <Subtitles size={18} />
            <span>
              <strong>{group.original.name}</strong>
              <small>
                {t(
                  group.original.caption?.role === "translation"
                    ? "Translation"
                    : "Original",
                )}{" "}
                ·{" "}
                {captionLanguageLabel(
                  group.original.caption?.language,
                  locale,
                ) ?? t("Language not specified")}{" "}
                · {group.original.caption!.cues.length} {t("captions")}
              </small>
            </span>
          </button>
          {group.original.caption?.sourceItemId && (
            <p className="editor-caption-source-label">
              {items.find(
                (item) => item.id === group.original.caption?.sourceItemId,
              )?.name ?? t("Source media unavailable")}
            </p>
          )}
          {group.translations.map((item) => (
            <button
              key={item.id}
              className="editor-caption-track editor-caption-translation"
              onClick={() => onSelect(item.id)}
            >
              <ArrowDownRight size={16} />
              <span>
                <strong>
                  {captionLanguageLabel(item.caption?.language, locale) ??
                    item.name}
                </strong>
                <small>
                  {t("Translation")} · {item.caption!.cues.length}{" "}
                  {t("captions")}
                </small>
              </span>
            </button>
          ))}
          <button
            className="editor-caption-translate-action"
            disabled={busy || disabled}
            onClick={() => onTranslate(group.original)}
          >
            <Languages size={14} />
            {t("Add a translation")}
          </button>
        </div>
      ))}
      <div className="editor-section-label">{t("Create captions")}</div>
      {media.map((item) => (
        <button
          className="editor-source-row"
          key={item.id}
          disabled={disabled || busy}
          onClick={() => onCreate(item)}
        >
          <Subtitles size={18} />
          <span>{item.name}</span>
          <Plus size={15} />
        </button>
      ))}
      {!media.length && (
        <p className="editor-muted-copy">
          {t("Import a video or audio clip to generate captions.")}
        </p>
      )}
      <button
        className="editor-secondary-button editor-wide-button"
        disabled={disabled || busy}
        onClick={onImport}
      >
        <Upload size={15} />
        {t("Import subtitles")}
      </button>
      <button
        className="editor-secondary-button editor-wide-button"
        disabled={disabled}
        onClick={onManual}
      >
        <Plus size={15} />
        {t("Add a caption")}
      </button>
    </div>
  );
}
