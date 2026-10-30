"use client";

import { useEffect, useRef, useState } from "react";
import { editorItemSchema, type CaptionCue, type EditorItem } from "@/lib/editor/document";
import { toEditorDocument } from "@/lib/video-project/document";
import { type VideoWorkspaceController } from "@/lib/video-project/client-controller";
import { editorCommandsToVideoCommands, type VideoProjectCommand } from "@/lib/video-project/commands";
import { transcriptEvidenceFromAsr } from "@/lib/video-project/semantic";
import { uploadLocalVideoSource } from "@/lib/video-project/local-assets";
import { editorCuesFromAsr, getEditorTranscription, parseEditorSubtitles, recoverEditorTranslation, startEditorTranscription, translateEditorCaptions } from "./editor-captions";
import { alignTranslatedCues, buildCaptionTrack, type CaptionProgress, type CaptionSetupOptions } from "./editor-caption-workflow";
import { editorCaptionPresets } from "./editor-caption-presets";

type Job = {
  id: string; clip: EditorItem; fps: number; options: CaptionSetupOptions;
  captionId: string; trackId: string; translatedId: string; translatedTrackId: string;
  taskId?: string; submissionStarted?: boolean; originalPlaced?: boolean;
  sourceCaption?: EditorItem; translationStarted?: boolean; translationTaskId?: string; translatedCues?: CaptionCue[];
  phase: CaptionProgress["phase"]; sourceRevision?: string; uncertain?: boolean;
};
const uuid = () => crypto.randomUUID();
const wait = (ms: number, signal: AbortSignal) => new Promise<void>((resolve, reject) => {
  const abort = () => { clearTimeout(timer); reject(signal.reason); };
  const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, ms);
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) abort();
});

export function useEditorCaptionWorkflow({ controller, ready, onResult }: {
  controller: VideoWorkspaceController; ready: boolean; onResult: (id: string) => void;
}) {
  const [progress, setProgress] = useState<CaptionProgress | null>(null);
  const jobRef = useRef<Job | null>(null);
  const busy = useRef(false);
  const signalRef = useRef<AbortController | null>(null);
  const loaded = useRef(false);
  const onResultRef = useRef(onResult); onResultRef.current = onResult;
  const storageKey = `dojoclip-native-editor-asr:${controller.projectId}`;
  useEffect(() => { const abort = new AbortController(); signalRef.current = abort; return () => abort.abort(); }, [controller]);
  const current = () => { const value = controller.getState().document; if (!value) throw new Error("Project has not loaded."); return toEditorDocument(value); };
  function persist(job: Job, required = false) {
    jobRef.current = job;
    try { localStorage.setItem(storageKey, JSON.stringify(job)); }
    catch {
      // The owned translation receipt can be fetched again without another model call.
      try { localStorage.setItem(storageKey, JSON.stringify({ ...job, translatedCues: undefined })); }
      catch { if (required) throw new Error("Browser recovery storage is full. Free some space before creating captions."); }
    }
  }
  function report(job: Job, phase: CaptionProgress["phase"], extra: Partial<CaptionProgress> = {}) {
    job.phase = phase; persist(job);
    if (!signalRef.current?.signal.aborted) setProgress({ phase, sourceName: job.clip.name, translation: !!job.options.translationLanguage, translationOnly: !!job.clip.caption, ...extra });
  }
  async function insert(job: Job, cues: CaptionCue[], paired?: EditorItem, evidence: VideoProjectCommand[] = []) {
    const document = current();
    const itemId = paired ? job.translatedId : job.captionId;
    const existing = document.items.find(item => item.id === itemId);
    if (existing) {
      if (!existing.caption || (paired ? existing.caption.pairedItemId !== paired.id : existing.caption.sourceItemId !== job.clip.id)) throw new Error("The saved caption target no longer matches this request.");
      await controller.flush(); return itemId;
    }
    if (!paired && job.originalPlaced) throw new Error("The completed caption track was removed. Its transcription has not been repeated.");
    const built = buildCaptionTrack(document, {
      id: itemId, trackId: paired ? job.translatedTrackId : job.trackId, cues,
      from: paired?.node.from ?? job.clip.node.from ?? 0,
      name: paired ? `${paired.name} · ${job.options.translationLanguage}` : `${job.clip.name} captions`,
      language: paired ? job.options.translationLanguage : job.options.language,
      sourceItemId: paired ? paired.caption?.sourceItemId : job.clip.id,
      paired, preset: paired ? job.options.translationPreset ?? job.options.preset : job.options.preset,
    });
    const native = controller.getState().document!;
    controller.dispatch([...evidence, ...editorCommandsToVideoCommands(native, built.commands)]);
    if (!controller.getState().document?.items.some(item => item.id === itemId)) throw new Error(controller.getState().error ?? "The captions could not be placed.");
    report(job, "saving"); await controller.flush();
    if (!current().items.some(item => item.id === itemId)) throw new Error("The caption track was removed while it was being saved.");
    return itemId;
  }
  async function execute(job: Job) {
    if (busy.current) return;
    busy.current = true;
    const signal = signalRef.current!.signal;
    try {
      let original: EditorItem;
      if (job.clip.caption) {
        original = current().items.find(item => item.id === job.clip.id && item.caption)!;
        if (!original) throw new Error("The source captions are no longer available.");
        if (job.options.language !== "auto" && original.caption!.language !== job.options.language && !current().tracks.find(track => track.id === original.trackId)?.locked) {
          controller.dispatchEditor({ type: "updateItem", id: original.id, patch: { caption: { ...original.caption!, language: job.options.language } } });
          await controller.flush();
          original = current().items.find(item => item.id === original.id)!;
        }
        job.captionId = original.id; job.originalPlaced = true;
      } else {
        if (!job.taskId) {
          if (job.submissionStarted) { job.uncertain = true; throw new Error("The transcription request was interrupted before its task could be confirmed. No new request has been started."); }
          let document = current();
          let clip = document.items.find(item => item.id === job.clip.id && item.node.assetId === job.clip.node.assetId);
          if (!clip?.node.assetId) throw new Error("The source clip is no longer available.");
          let asset = document.assets[clip.node.assetId];
          if (asset.source === "local") {
            if (!job.options.cloudConsent) throw new Error("Cloud transcription needs your upload consent.");
            report(job, "uploading", { percent: 0 });
            const uploaded = await uploadLocalVideoSource(controller.projectId, asset.id, amount => report(job, "uploading", { percent: amount * 100 }), signal);
            if (!uploaded.assetId) throw new Error("The uploaded source could not be verified.");
            controller.dispatchEditor({ type: "addAsset", asset: { ...asset, source: "project", assetId: uploaded.assetId } });
            await controller.flush();
          }
          document = current(); clip = document.items.find(item => item.id === job.clip.id && item.node.assetId === job.clip.node.assetId);
          if (!clip?.node.assetId) throw new Error("The source clip changed before transcription started.");
          asset = document.assets[clip.node.assetId];
          job.submissionStarted = true; job.phase = "transcribing"; persist(job, true);
          report(job, "transcribing");
          const result = await startEditorTranscription(controller.projectId, asset.assetId ?? asset.id, job.options.language, signal);
          job.taskId = result.task_id; persist(job);
        }
        let raw: unknown;
        while (!signal.aborted) {
          try {
            const result = await getEditorTranscription(job.taskId!, signal);
            if (result.status === "failed") throw Object.assign(new Error(result.error_message ?? "Transcription failed."), { terminal: true });
            if (result.status === "completed" && result.raw_asr_result) { raw = result.raw_asr_result; break; }
            report(job, "transcribing", { percent: result.progress == null ? undefined : Math.max(0, Math.min(100, result.progress)) });
            await wait(3000, signal);
          } catch (cause) {
            if (signal.aborted || (cause && typeof cause === "object" && "terminal" in cause)) throw cause;
            report(job, "transcribing", { message: "Connection interrupted. Checking the same transcription task…" });
            await wait(10000, signal);
          }
        }
        if (signal.aborted) return;
        const native = controller.getState().document!;
        const clip = native.items.find(item => item.id === job.clip.id && item.node.assetId === job.clip.node.assetId);
        if (!clip) { report(job, "ready", { message: "Transcription is ready. Select a clip from the same source to place its captions." }); return; }
        report(job, "styling");
        const evidence = await transcriptEvidenceFromAsr(native, clip.node.assetId!, raw, job.taskId);
        const latest = controller.getState().document!;
        const target = latest.items.find(item => item.id === clip.id && item.node.assetId === clip.node.assetId);
        if (!target || latest.sources[evidence.sourceAssetId]?.revision !== evidence.sourceRevision) throw new Error("The source clip changed while preparing captions.");
        job.clip = structuredClone(target); job.fps = latest.format.fps;
        if (job.options.language === "auto") job.options.language = evidence.language ?? "auto";
        await insert(job, editorCuesFromAsr(raw, target, latest.format.fps), undefined, [{ type: "addEvidence", evidence }]);
        job.originalPlaced = true; persist(job);
        original = current().items.find(item => item.id === job.captionId)!;
      }
      const ids = [original.id];
      if (job.options.translationLanguage) {
        job.sourceCaption ??= structuredClone(original);
        const sourceCues = job.sourceCaption.caption!.cues;
        let translated = job.translatedCues;
        if (!translated && job.translationTaskId) {
          report(job, "translating", { message: "Recovering the completed translation…" });
          translated = await recoverEditorTranslation(controller.projectId, job.translationTaskId, sourceCues, job.options.translationLanguage, signal);
        }
        if (!translated) {
          if (job.translationStarted) { job.uncertain = true; throw new Error("The translation result is not confirmed. Your original captions are saved; no replacement translation has been started."); }
          job.translationStarted = true; job.phase = "translating"; persist(job, true);
          report(job, "translating");
          const result = await translateEditorCaptions(controller.projectId, sourceCues, job.options.translationLanguage, signal, job.options.language);
          job.translationTaskId = result.taskId; persist(job);
          translated = result.cues;
        }
        job.translatedCues = translated; persist(job);
        const latest = current().items.find(item => item.id === original.id && item.caption);
        if (!latest) throw new Error("The source captions were removed during translation. The translated result is preserved for download.");
        const aligned = alignTranslatedCues(translated, job.sourceCaption, latest);
        ids.push(await insert(job, aligned, latest));
      }
      if (signal.aborted) return;
      report(job, "complete", { resultIds: ids });
      localStorage.removeItem(storageKey); jobRef.current = null;
      onResultRef.current(ids[0]);
    } catch (cause) {
      const status = cause && typeof cause === "object" && "status" in cause ? Number(cause.status) : 0;
      if (![400, 401, 402, 403, 404, 413, 422].includes(status) && ((job.submissionStarted && !job.taskId) || (job.translationStarted && !job.translationTaskId && !job.translatedCues))) job.uncertain = true;
      persist(job);
      if (!signal.aborted) report(job, "error", { message: cause instanceof Error ? cause.message : "Caption creation failed. Your completed work is preserved.", resultIds: current().items.some(item => item.id === job.captionId) ? [job.captionId] : [] });
    } finally { busy.current = false; }
  }
  useEffect(() => {
    if (!ready || loaded.current) return;
    loaded.current = true;
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) ?? "null");
      if (!saved || !editorItemSchema.safeParse(saved.clip).success || (!saved.taskId && (!saved.id || !saved.options))) return;
      const options = saved.options ?? { language: saved.language ?? "auto", preset: "karaoke", cloudConsent: true };
      if (!editorCaptionPresets[options.preset]) options.preset = "karaoke";
      const job: Job = { ...saved, id: saved.id ?? uuid(), options, captionId: saved.captionId ?? uuid(), trackId: saved.trackId ?? uuid(), translatedId: saved.translatedId ?? uuid(), translatedTrackId: saved.translatedTrackId ?? uuid(), phase: saved.phase ?? "transcribing" };
      persist(job); void execute(job);
    } catch { /* Invalid local recovery data cannot authorize a new paid request. */ }
    // Recovery is tied to this project and runs once after its document has opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, controller]);

  async function start(item: EditorItem, options: CaptionSetupOptions) {
    if (busy.current) return;
    if (item.caption && !item.caption.cues.some(cue => cue.text.trim())) throw new Error("Add caption text before translating.");
    if (jobRef.current?.uncertain) { report(jobRef.current, "error", { message: "The previous caption request is not confirmed. No new paid request has been started." }); return; }
    busy.current = true;
    setProgress({ phase: "preparing", sourceName: item.name, translation: !!options.translationLanguage, translationOnly: !!item.caption });
    let job: Job;
    try {
      const snapshot = await controller.flush();
      const clip = snapshot.document.items.find(candidate => candidate.id === item.id);
      if (!clip) throw new Error("The source clip is no longer available.");
      job = { id: uuid(), clip: structuredClone(clip), fps: snapshot.document.format.fps, options: { ...options }, captionId: clip.caption ? clip.id : uuid(), trackId: uuid(), translatedId: uuid(), translatedTrackId: uuid(), phase: clip.caption ? "translating" : "uploading" };
      persist(job, true);
    } catch (cause) {
      setProgress({ phase: "error", sourceName: item.name, message: cause instanceof Error ? cause.message : "Caption creation could not start." });
      throw cause;
    } finally { busy.current = false; }
    await execute(job!);
  }

  function addManual(cues: CaptionCue[], from: number, name: string, preset?: string) {
    const document = current();
    const built = buildCaptionTrack(document, { id: uuid(), trackId: uuid(), cues, from, name, preset });
    controller.dispatchEditor(built.commands); onResultRef.current(built.item.id);
    return built.item.id;
  }
  async function importSubtitles(file: File, from: number) {
    if (file.size > 2_000_000) throw new Error("Subtitle files must be smaller than 2 MB.");
    return addManual(parseEditorSubtitles(await file.text()), from, file.name);
  }
  function placeReady(item: EditorItem) {
    const job = jobRef.current;
    if (!job?.taskId || item.node.assetId !== job.clip.node.assetId) return;
    job.clip = structuredClone(item); persist(job); void execute(job);
  }
  return { progress, busy: !!progress && !["error", "complete", "ready"].includes(progress.phase), start, addManual, importSubtitles, placeReady,
    dismiss: () => setProgress(null), translationDownload: jobRef.current?.translatedCues,
    originalId: jobRef.current?.captionId };
}
