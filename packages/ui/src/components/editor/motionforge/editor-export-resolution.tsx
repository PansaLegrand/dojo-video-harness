import { useEffect, useState } from "react";
import {
  editorExportDimensions,
  editorExportResolutions,
  isEditorExportResolution,
  type EditorExportResolution,
} from "@/lib/editor/export-resolution";
import { useNativeEditorText } from "./native-editor-copy";

export function useEditorExportResolution(projectId: string) {
  const [preference, setPreference] = useState<{
    projectId: string;
    value: EditorExportResolution;
  } | null>(null);
  const key = `dojoclip:export-resolution:${projectId}`;
  useEffect(() => {
    let value: EditorExportResolution = "source";
    try {
      const stored = localStorage.getItem(key);
      if (isEditorExportResolution(stored)) value = stored;
    } catch {
      /* Storage is optional. */
    }
    setPreference({ projectId, value });
  }, [projectId, key]);
  return [
    preference?.projectId === projectId ? preference.value : "source",
    (value: EditorExportResolution) => {
      setPreference({ projectId, value });
      try {
        localStorage.setItem(key, value);
      } catch {
        /* The current export can still use this choice. */
      }
    },
  ] as const;
}

export function EditorExportResolutionSelect({
  format,
  value,
  onChange,
  disabled,
  inspector = false,
}: {
  format: { width: number; height: number };
  value: EditorExportResolution;
  onChange: (value: EditorExportResolution) => void;
  disabled: boolean;
  inspector?: boolean;
}) {
  const t = useNativeEditorText();
  return (
    <label
      className={
        inspector
          ? "editor-export-resolution-field"
          : "editor-aspect-ratio editor-export-resolution"
      }
    >
      <span>{t("Export resolution")}</span>
      <select
        aria-label={t("Export resolution")}
        value={value}
        disabled={disabled}
        onChange={(event) => {
          if (isEditorExportResolution(event.target.value))
            onChange(event.target.value);
        }}
      >
        {editorExportResolutions.map((option) => {
          let dimensions: ReturnType<typeof editorExportDimensions> | null =
            null;
          try {
            dimensions = editorExportDimensions(format, option.value);
          } catch {
            /* Extreme custom ratios can exceed encoder dimensions. */
          }
          return (
            <option
              key={option.value}
              value={option.value}
              disabled={!dimensions}
            >
              {t(option.label)}
              {dimensions
                ? ` · ${dimensions.width} × ${dimensions.height}`
                : ""}
            </option>
          );
        })}
      </select>
      {inspector && (
        <span className="text-xs text-[var(--editor-muted)]">
          {t("Keeps your aspect ratio and layout. Saved on this device.")}
        </span>
      )}
    </label>
  );
}
