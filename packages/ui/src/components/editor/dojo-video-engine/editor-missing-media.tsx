"use client";

import { FileQuestion } from "lucide-react";
import type { EditorAsset } from "@/lib/editor/document";
import { useNativeEditorText } from "./native-editor-copy";

/** Keep source identifiers in diagnostics; show filenames and recovery in the UI. */
export function EditorMissingMedia({ assetIds, assets, disabled, onRelink, onRetry }: {
  assetIds: readonly string[];
  assets: Record<string, EditorAsset>;
  disabled: boolean;
  onRelink(asset: EditorAsset): void;
  onRetry(): void;
}) {
  const t = useNativeEditorText();
  const missing = [...new Set(assetIds)].map(id => ({ id, asset: assets[id] }));
  const isLocal = (asset: EditorAsset | undefined) => !!asset && (asset.source === "local" || asset.id.startsWith("local:"));
  const hasLocal = missing.some(({ asset }) => isLocal(asset));
  const hasRemote = missing.some(({ asset }) => !isLocal(asset));
  const title = t(hasRemote ? "Some media could not be loaded" : "Original files needed");
  return <div className="editor-missing-media" role="region" aria-label={title}>
    <FileQuestion size={28} aria-hidden="true" className="mx-auto text-[var(--editor-muted)]" />
    <h2>{title}</h2>
    {hasLocal && <>
      <p>{t("This browser cannot access the original files. They may be stored in another browser or device, or browser storage may have been cleared.")}</p>
      <p>{t("Your edits are still in this project. Choose the original files to restore preview and export.")}</p>
    </>}
    {hasRemote && <p>{t("Some project files are unavailable. Check your connection and try loading them again.")}</p>}
    <ul>
      {missing.map(({ id, asset }) => <li key={id}>
        <span className="min-w-0 break-words">{asset?.name || t("Unnamed media file")}</span>
        {isLocal(asset) && <button type="button" className="editor-primary-button" disabled={disabled} onClick={() => onRelink(asset!)}>
          {t("Choose original file")}
        </button>}
      </li>)}
    </ul>
    {hasRemote && <button type="button" className="editor-primary-button" disabled={disabled} onClick={onRetry}>{t("Retry loading files")}</button>}
  </div>;
}
