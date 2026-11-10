"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "@/lib/i18n";
import { readLocalVideoSource } from "@/lib/video-project/local-assets";
import type { VideoProjectDocument } from "@/lib/video-project/document";
import {
  browserInspectionApi,
  browserInspectionSourceIsCurrent,
  browserInspectionFailureCode,
  fulfillBrowserInspection,
  type BrowserInspectionRecord,
} from "@/lib/video-project/browser-host-requests-client";
import type { BrowserInspectionRequest } from "@/lib/video-project/browser-host-requests";
import { sourceInspectionText } from "./editor-source-inspection-copy";
import "./editor-source-inspection.css";
import { useNativeEditorText } from "./native-editor-copy";

export function EditorSourceInspectionPanel({
  projectId,
  runId,
  document,
  active = false,
  enabled = active,
  refreshKey,
  onChanged,
  getOriginalSource,
  onRelinkSource,
}: {
  projectId: string;
  runId: string;
  document: VideoProjectDocument;
  active?: boolean;
  enabled?: boolean;
  refreshKey?: string;
  onChanged?: () => void;
  getOriginalSource?: (
    request: BrowserInspectionRequest,
    signal: AbortSignal,
  ) => Promise<Blob | null>;
  onRelinkSource?: (sourceId: string) => void;
}) {
  const editorText = useNativeEditorText();
  const { locale } = useTranslation(),
    t = (key: Parameters<typeof sourceInspectionText>[1]) =>
      sourceInspectionText(locale, key);
  const api = useMemo(
      () => browserInspectionApi(projectId, runId),
      [projectId, runId],
    ),
    current = useRef(document),
    activeApi = useRef(api);
  current.current = document;
  activeApi.current = api;
  const [records, setRecords] = useState<BrowserInspectionRecord[]>([]),
    [consent, setConsent] = useState<Record<string, boolean>>({}),
    [busy, setBusy] = useState<string | null>(null),
    [notice, setNotice] = useState<string | null>(null);
  const pending = useRef<AbortController | null>(null),
    buttons = useRef(new Map<string, HTMLButtonElement>()),
    mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    setRecords([]);
    setConsent({});
    setNotice(null);
    setBusy(null);
    return () => {
      mounted.current = false;
      const previous = pending.current;
      previous?.abort(new DOMException("Inspection cancelled.", "AbortError"));
      if (pending.current === previous) pending.current = null;
    };
  }, [api]);
  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    const load = async () => {
      try {
        const result = await api.list();
        if (!stopped) setRecords(result.requests);
      } catch {
        if (!stopped) setNotice(t("Inspection needs attention."));
      }
    };
    void load();
    const timer = active ? setInterval(() => void load(), 2500) : undefined;
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [api, enabled, active, refreshKey, locale]);
  const refresh = async () => {
    const result = await api.list();
    if (mounted.current && activeApi.current === api) {
      setRecords(result.requests);
      onChanged?.();
    }
  };
  const fulfill = async (record: BrowserInspectionRecord) => {
    if (pending.current || (!record.grant && !consent[record.request.id]))
      return;
    const controller = new AbortController();
    pending.current = controller;
    setBusy(record.request.id);
    setNotice(null);
    let grant = record.grant;
    try {
      if (record.status === "failed")
        await api.retry(record.request.id, crypto.randomUUID());
      if (!grant)
        grant = (await api.authorize(record.request, crypto.randomUUID()))
          .grant;
      await fulfillBrowserInspection(
        record.request,
        grant,
        {
          isCurrentSource: () =>
            activeApi.current === api &&
            browserInspectionSourceIsCurrent(record.request, current.current),
          getSource: async () =>
            getOriginalSource
              ? getOriginalSource(record.request, controller.signal)
              : ((
                  await readLocalVideoSource(
                    projectId,
                    record.request.source.sourceId,
                  )
                )?.file ?? null),
          loadSavedReceipt: () => api.receipt(record.request.id),
          submitReceipt: (receipt) => api.fulfill(record.request.id, receipt),
        },
        controller.signal,
      );
      await refresh();
    } catch (error) {
      const details = error as {
        name?: string;
        code?: string;
        reconciliationRequired?: boolean;
      };
      if (mounted.current && activeApi.current === api)
        setNotice(
          t(
            details.reconciliationRequired
              ? "Check the saved result before retrying."
              : details.code === "MISSING_LOCAL_SOURCE" && current.current.assets[record.request.source.sourceId]?.source === "local"
                ? "Relink the original file, then resume inspection."
                : "Inspection needs attention.",
          ),
        );
      if (grant && !details.reconciliationRequired)
        await api
          .fail(
            record.request.id,
            browserInspectionFailureCode(details),
            details.name === "AbortError"
              ? "Inspection cancelled before fulfillment."
              : "Browser source inspection did not complete.",
          )
          .then(() => {
            if (mounted.current && activeApi.current === api) setNotice(null);
          })
          .catch(() => undefined);
      await refresh().catch(() => undefined);
    } finally {
      if (pending.current === controller) pending.current = null;
      if (mounted.current && activeApi.current === api) {
        setBusy(null);
        requestAnimationFrame(() =>
          buttons.current.get(record.request.id)?.focus(),
        );
      }
    }
  };
  if (!records.length) return null;
  return (
    <section
      className="editor-agent-progress editor-source-inspection"
      aria-label={t("Inspect source frames")}
      data-source-inspection-panel
    >
      <h3>{t("Inspect source frames")}</h3>
      <p>
        {t("Only these source moments are sent for cloud visual analysis.")}
      </p>
      {records.map((record) => (
        <fieldset
          key={record.request.id}
          data-host-request-id={record.request.id}
          disabled={!!busy || record.status === "cancelled"}
          style={{ minWidth: 0, overflowWrap: "anywhere" }}
        >
          <legend>
            {document.assets[record.request.source.sourceId]?.name ??
              record.request.source.type}
          </legend>
          <p>
            {record.request.momentsMs
              .map(
                (time) =>
                  `${new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(time / 1000)}s`,
              )
              .join(" · ")}{" "}
            · {record.request.limits.maxDimension}px
          </p>
          {record.hasReceipt ? (
            <p role="status" data-inspection-complete>
              {t("Inspection saved")}
            </p>
          ) : (
            <>
              {!record.grant && (
                <label style={{ display: "flex", gap: 8, alignItems: "start" }}>
                  <input
                    type="checkbox"
                    checked={!!consent[record.request.id]}
                    onChange={(event) =>
                      setConsent((value) => ({
                        ...value,
                        [record.request.id]: event.target.checked,
                      }))
                    }
                  />
                  <span>{t("Allow cloud analysis of these frames.")}</span>
                </label>
              )}
              <button
                type="button"
                data-inspection-action
                ref={(button) => {
                  if (button) buttons.current.set(record.request.id, button);
                }}
                disabled={
                  !!busy || (!record.grant && !consent[record.request.id])
                }
                onClick={() => void fulfill(record)}
              >
                {t(record.grant ? "Resume inspection" : "Analyze frames")}
              </button>
            </>
          )}
          <button
            type="button"
            ref={(button) => {
              if (record.hasReceipt && button)
                buttons.current.set(record.request.id, button);
            }}
            onClick={() =>
              void refresh().catch(() =>
                setNotice(t("Inspection needs attention.")),
              )
            }
          >
            {t("Check saved result")}
          </button>
          {record.error && !busy && (
            <p role="status">
              {t(
                record.error.code === "SOURCE_MISSING" && document.assets[record.request.source.sourceId]?.source === "local"
                  ? "Relink the original file, then resume inspection."
                  : "Inspection needs attention.",
              )}
              {record.error.code === "SOURCE_MISSING" && document.assets[record.request.source.sourceId]?.source === "local" && onRelinkSource && <button type="button" onClick={() => onRelinkSource(record.request.source.sourceId)}>{editorText("Choose original file")}</button>}
            </p>
          )}
        </fieldset>
      ))}
      {busy && (
        <div role="status">
          <span>{t("Inspecting source…")}</span>
          <button
            type="button"
            onClick={() =>
              pending.current?.abort(
                new DOMException("Inspection cancelled.", "AbortError"),
              )
            }
          >
            {t("Cancel inspection")}
          </button>
        </div>
      )}
      {notice && <p role="status">{notice}</p>}
    </section>
  );
}
