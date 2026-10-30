import React from "react";
import type { WorkspaceSaveFailure } from "@/lib/video-project/save-failure";
import { useNativeEditorText } from "./native-editor-copy";

export const saveRecoveryMessages = {
  offline: "You're offline. Your pending edits are kept in this browser.",
  retryable: "Save interrupted. Retry will safely check the same edit.",
  authentication:
    "Sign in again to save. Your pending edits are kept in this browser.",
  permission:
    "You no longer have access to save this project. Your pending edits are kept in this browser.",
  validation:
    "The server rejected a pending edit. Download your draft before discarding unsaved changes.",
  conflict:
    "This edit conflicts with a newer change. Choose which version to keep.",
} as const;

export function EditorSaveRecovery({
  failure,
  retrying,
  onRetry,
  onSignIn,
  onDownload,
  onResolve,
  onDiscard,
}: {
  failure: WorkspaceSaveFailure;
  retrying: boolean;
  onRetry(): void;
  onSignIn(): void;
  onDownload(): void;
  onResolve(choice: "saved" | "pending"): void;
  onDiscard(): void;
}) {
  const t = useNativeEditorText();
  const button = "whitespace-nowrap underline disabled:opacity-50";
  return (
    <div
      role="alert"
      data-save-failure={failure.kind}
      aria-busy={retrying}
      className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-amber-700 bg-amber-950 px-4 py-2 text-xs text-amber-100"
    >
      <div className="min-w-0">
        <p>{t(saveRecoveryMessages[failure.kind])}</p>
        <p className="mt-1 opacity-80">{t(failure.message)}</p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        {failure.kind === "authentication" && (
          <button className={button} disabled={retrying} onClick={onSignIn}>
            {t("Sign in again")}
          </button>
        )}
        {["offline", "retryable", "authentication", "permission"].includes(
          failure.kind,
        ) && (
          <button className={button} disabled={retrying} onClick={onRetry}>
            {t(retrying ? "Retrying save…" : "Retry save")}
          </button>
        )}
        <button className={button} onClick={onDownload}>
          {t("Download draft")}
        </button>
        {failure.kind === "conflict" && (
          <>
            <button
              className={button}
              disabled={retrying}
              onClick={() => onResolve("saved")}
            >
              {t("Use saved version")}
            </button>
            <button
              className={button}
              disabled={retrying}
              onClick={() => onResolve("pending")}
            >
              {t("Apply my pending changes")}
            </button>
          </>
        )}
        {failure.kind === "validation" && (
          <button className={button} disabled={retrying} onClick={onDiscard}>
            {t("Discard unsaved changes")}
          </button>
        )}
      </div>
    </div>
  );
}
