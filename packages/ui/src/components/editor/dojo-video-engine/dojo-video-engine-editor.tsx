"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import Link from "next/link";
import { useSignInGate } from "@/lib/use-sign-in-gate";
import { buildSelectionCommands, selectionActionIssue, type SelectionAction } from "@/lib/video-project/selection-commands";
import type { TimelineSelectionGesture } from "@/lib/video-project/selection";
import { workspaceSaveFailureAllowsRetry } from "@/lib/video-project/save-failure";
import { EditorSaveRecovery } from "./editor-save-recovery";
import {
  Upload,
  Shapes,
  Type,
  Subtitles,
  Plus,
  Undo2,
  Redo2,
  Scissors,
  Copy,
  Trash2,
  Download,
  Save,
  Loader2,
  Play,
  Pause,
  Settings2,
  Music2,
  Film,
  ImageIcon,
  X,
  PanelLeftClose,
  PanelLeftOpen,
  MessageSquare,
  FolderOpen,
  Activity,
  ChevronLeft,
  ChevronDown,
  ChevronUp,
  SkipBack,
  SkipForward,
  Maximize2,
} from "lucide-react";
import { useProjectContext } from "@/contexts/ProjectContext";
import { useTranslation } from "@/lib/i18n";
import { defaultMotionSettings, type MotionTemplateId } from "@/lib/motion-graphics/catalog";
import { motionInsertCommands, motionTemplateOf } from "@/lib/motion-graphics/templates";
import { motionCopy } from "@/lib/motion-graphics/copy";
import { getLocalizedHref } from "@/lib/utils";
import { type SceneNodeInput } from "@dojo-video-engine/schema";
import {
  type EditorDocument,
  type EditorItem,
  type EditorAsset,
  type CaptionCue,
} from "@/lib/editor/document";
import { type EditorCommand } from "@/lib/editor/commands";
import { getEditorFontAssets, editorFontWeights } from "@/lib/editor/fonts";
import { editorCaptionPresets } from "./editor-caption-presets";
import "./editor-workspace.css";
import { editorAspectRatios, editorAspectRatioValue, editorFormatCommands } from "./editor-aspect-ratio";
import { EditorExportResolutionSelect, useEditorExportResolution } from "./editor-export-resolution";
import { editorExportScene } from "@/lib/editor/export-resolution";
import { EDITOR_VIDEO_ENCODING, requireEditorExportSupport } from "@/lib/editor/export-capability";
import { createEditorVisualizerNode } from "./editor-visualizers";
import type { MusicVisualizerLayerTemplateKey } from "@/types/music-visualizer";
import { EditorProjectName } from "./editor-project-name";
import { type EditorStylePreview } from "./editor-style-preview";
import { EditorTextToolbar } from "./editor-text-toolbar";
import { EditorLibrary, type EditorTool } from "./editor-library";
import { editorSourceInsertion, type EditorSourceRange } from "./editor-source-range";
import { EditorTranscriptPanel } from "./editor-transcript-panel";
import { EditorQuietSections } from "./editor-quiet-sections";
import { EditorTransitionControl } from "./editor-transition-control";
import type { SourceAnalysisProject } from "@/lib/video-project/source-analysis";
import { manualSpeechRemoval } from "@/lib/video-project/manual-transcript";
import { buildEditorCapabilityCommands, type EditorCapabilityInput } from "@/lib/video-project/capabilities";
import { editorTextStyles, updateEditorNodeStyle } from "./editor-presets";
import { createEditorExportPublication } from "@/lib/editor/export-publication";
import {
  DojoVideoEngineCanvasPreview,
  type DojoVideoEngineCanvasPreviewHandle,
} from "@/components/dojo-video-engine/dojo-video-engine-canvas-preview";
import {
  startDojoVideoEngineSceneExport,
  planDojoVideoEngineExport,
  type DojoVideoEngineExportOptions,
} from "@/lib/dojo-video-engine-browser/export-client";
import {
  startDojoVideoEngineSceneFileExport,
  type DojoVideoEngineExportFileHandle,
} from "@/lib/dojo-video-engine-browser/file-export";
import { createExportOperation } from "@/lib/dojo-video-engine-browser/export-operation";
import { highResolutionInsertionIssue } from "@/lib/dojo-video-engine-browser/preview-proxy-policy";
import { useEditorPreviewDraft } from "./editor-preview-draft";
import { useCompiledEditorPreview } from "./editor-preview-compiler";
import { EditorTimeline } from "./editor-timeline";
import { editorShortcut } from "./editor-keyboard";
import { EditorPlayheadProvider, EditorPlayheadTime } from "./editor-playhead";
import { EditorInspector } from "./editor-inspector";
import {
  EDITOR_MEDIA_ACCEPT,
} from "./editor-media";
import { serializeEditorSubtitles } from "./editor-captions";
import { useEditorCaptionWorkflow } from "./use-editor-caption-workflow";
import { EditorCaptionSetup } from "./editor-caption-setup";
import { EditorCaptionProgress } from "./editor-caption-progress";
import { editorCommandsToVideoCommands, type VideoProjectCommand } from "@/lib/video-project/commands";
import { sourceWindow } from "@/lib/video-project/source-clock";
import { createBrowserWorkspaceRecoveryStore } from "@/lib/video-project/recovery-storage";
import { VideoWorkspaceController, type VideoProjectSnapshot } from "@/lib/video-project/client-controller";
import { compileVideoProjectDocument, toEditorDocument } from "@/lib/video-project/document";
import { importLocalVideoSource, relinkLocalVideoSource, uploadLocalVideoSource } from "@/lib/video-project/local-assets";
import { createLocalMediaOperation } from "@/lib/video-project/local-media-operation";
import { useLocalSourceRestore } from "./use-local-source-restore";
import { EditorChatResizer } from "./editor-chat-resizer";
import { VideoWorkspaceChat } from "./video-workspace-chat";
import { EditorInteractionProvider } from "./editor-interaction";
import { useNativeEditorText } from "./native-editor-copy";
import { useEditorMediaPreviews } from "./editor-media-previews";

type ExportPublication = ReturnType<typeof createEditorExportPublication>;
const buttonClass =
  "inline-flex items-center justify-center gap-1.5 rounded border border-[var(--editor-border)] px-2.5 py-2 text-xs text-[var(--editor-text)] hover:bg-[var(--editor-hover)] disabled:cursor-not-allowed disabled:opacity-40";
const id = () => crypto.randomUUID();
const MAX_IN_MEMORY_EXPORT_BYTES = 256 * 1024 * 1024;
const LARGE_EXPORT_MESSAGE = "This video is too large for a standard download. Shorten the project or try exporting again in a browser that supports saving directly to a file.";

export function findEditorNode(node: EditorItem["node"], id: string): EditorItem["node"] | null {
  if (node.id === id) return node;
  for (const child of node.children ?? []) { const found = findEditorNode(child, id); if (found) return found; }
  return null;
}
function flattenEditorNodes(node: EditorItem["node"], depth = 0): Array<{ node: EditorItem["node"]; depth: number }> {
  return [{ node, depth }, ...(node.children ?? []).flatMap(child => flattenEditorNodes(child, depth + 1))];
}
export function replaceEditorNode(node: EditorItem["node"], id: string, replacement: EditorItem["node"]): EditorItem["node"] {
  if (node.id === id) return replacement;
  return { ...node, children: (node.children ?? []).map(child => replaceEditorNode(child, id, replacement)) };
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

export default function DojoVideoEngineEditor({
  projectId,
  chatInitiallyOpen = false,
  initialPanel,
  initialItemId,
}: {
  projectId: string;
  chatInitiallyOpen?: boolean;
  initialPanel?: "captions" | "graphics";
  initialItemId?: string;
}) {
  const t = useNativeEditorText();
  const openSignIn = useSignInGate();
  const { currentProject, selectProject, updateProject } = useProjectContext();
  const { locale } = useTranslation();
  const controller = useMemo(() => new VideoWorkspaceController(projectId, undefined, undefined, typeof window !== "undefined" ? createBrowserWorkspaceRecoveryStore(projectId) : undefined), [projectId]);
  const workspace = useSyncExternalStore(controller.subscribeContent, controller.getContentState, controller.getContentState);
  const document = useMemo(() => workspace.document ? toEditorDocument(workspace.document) : null, [workspace.document]);
  const documentRef = useRef<EditorDocument | null>(document);
  documentRef.current = document;
  const [sources, setSources] = useState<Record<string, string>>({});
  const library = useMemo(() => Object.values(document?.assets ?? {}).filter(asset => ["video", "audio", "image"].includes(asset.type)), [document?.assets]);
  const revision = String(workspace.snapshot?.revision ?? 0);
  const saveStatus = workspace.status === "loading" ? "saved" : workspace.status;
  const conflictDraft = workspace.pending.length ? workspace.document : null;
  const [error, setError] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const loading = workspace.status === "loading";
  const selectedId = workspace.selectedItemId;
  const selectedIds = workspace.selectedItemIds;
  const selectedNodeId = workspace.selectedNodeId;
  const { change: previewDraft, previewChange } = useEditorPreviewDraft(selectedId, selectedNodeId);
  const setSelectedId = useCallback((itemId: string | null) => controller.select(itemId), [controller]);
  const setFrame = useCallback((value: number) => controller.seek(value), [controller]);
  const [playing, setPlaying] = useState(false);

  const [upload, setUpload] = useState<{
    name: string;
    progress: number;
  } | null>(null);
  const [localImport, setLocalImport] = useState<{ name: string; progress: number } | null>(null);
  const [exportProgress, setExportProgress] = useState<number | null>(null);
  const [exportPhase, setExportPhase] = useState("Preparing");
  const [output, setOutput] = useState<{
    blob: Blob;
    name: string;
    publication: ExportPublication;
    savedToFile: boolean;
  } | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [published, setPublished] = useState(false);
  const [showLibrary, setShowLibrary] = useState(true);
  const [showChat, setShowChat] = useState(chatInitiallyOpen);
  const [chatWidth, setChatWidth] = useState(340);
  useEffect(() => { if (chatInitiallyOpen) setShowChat(true); }, [chatInitiallyOpen]);
  const [captionSetup, setCaptionSetup] = useState<{ itemId: string; target?: string } | null>(null);
  const relinkInputRef = useRef<HTMLInputElement>(null);
  const relinkAssetRef = useRef<EditorAsset | null>(null);
  const [showInspector, setShowInspector] = useState(false);
  const [activeTool, setActiveTool] = useState<EditorTool>("media");
  const [timelineHeight, setTimelineHeight] = useState(260);
  const [exportResolution, setExportResolution] = useEditorExportResolution(projectId);
  const [timelineOpen, setTimelineOpen] = useState(true);
  const timelineDrag = useRef<{ y: number; height: number } | null>(null);
  const previewStageRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (selectedId) { setShowInspector(true); setShowLibrary(true); } }, [selectedId]);
  function openTool(tool: EditorTool) {
    if (window.innerWidth < 900) setShowChat(false);
    setActiveTool(tool); setShowLibrary(true); setShowInspector(tool === "project");
    if (tool === "project") setSelectedId(null);
  }
  const projectName = currentProject?.id === projectId ? currentProject.name : t("Video project");
  const previewRef = useRef<DojoVideoEngineCanvasPreviewHandle>(null);
  const previewPointers = useRef(new Set<number>());
  const mediaInputRef = useRef<HTMLInputElement>(null);
  const subtitlesInputRef = useRef<HTMLInputElement>(null);
  const objectUrlsRef = useRef(new Set<string>());
  const lifetimeRef = useRef<AbortController | null>(null);
  const localMediaRef = useRef<(ReturnType<typeof createLocalMediaOperation> & { lifetime: AbortController }) | null>(null);
  const exportTaskRef = useRef<{ cancel(): void } | null>(null);
  const publicationRef = useRef<ExportPublication | null>(null);
  const publicationFinishedRef = useRef(false);
  const disabled = loading;
  const mediaPreviews = useEditorMediaPreviews(document, sources);

  useEffect(() => {
    if (window.matchMedia("(max-width: 767px)").matches) {
      setShowLibrary(false);
      setShowInspector(false);
    }
  }, []);

  const initialPanelApplied = useRef<string | null>(null);
  useEffect(() => {
    if (!document || !initialPanel || !initialItemId) return;
    const entryKey = `${projectId}:${initialItemId}`;
    if (initialPanelApplied.current === entryKey) return;
    initialPanelApplied.current = entryKey;
    const caption = document.items.find(item => item.id === initialItemId && (initialPanel === "captions" ? item.caption : motionTemplateOf(item)));
    if (!caption) return;
    controller.select(caption.id);
    setActiveTool(initialPanel);
    setShowLibrary(true);
    setShowInspector(true);
    setCaptionSetup(null);
    if (window.innerWidth < 1200) setShowChat(false);
  }, [controller, document, initialPanel, initialItemId, projectId]);

  useEffect(() => {
    const lifetime = new AbortController();
    lifetimeRef.current = lifetime;
    void selectProject(projectId);
    void controller.open().catch(cause => { const message = cause instanceof Error ? cause.message : "Project could not be loaded."; controller.setError(message); setError(message); });
    const timer = setInterval(() => void controller.refresh().catch(() => {}), 2500);
    const reconnect = () => void controller.retryAfterReconnect().catch(() => {});
    window.addEventListener("online", reconnect);
    return () => {
      window.removeEventListener("online", reconnect);
      clearInterval(timer); lifetime.abort(); controller.close(); exportTaskRef.current?.cancel();
      if (localMediaRef.current?.lifetime === lifetime) {
        localMediaRef.current.cancel(); localMediaRef.current.dispose(); localMediaRef.current = null; setLocalImport(null);
      }
      if (publicationRef.current && !publicationFinishedRef.current) void publicationRef.current.cancel().catch(() => {});
      objectUrlsRef.current.forEach(url => URL.revokeObjectURL(url)); objectUrlsRef.current.clear();
    };
    // Project context callback identities change when the project loads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controller, projectId]);

  useEffect(() => {
    if (workspace.error && workspace.error !== workspace.saveFailure?.message) setError(workspace.error);
  }, [workspace.error, workspace.saveFailure]);

  useLocalSourceRestore(projectId, workspace.document?.assets, workspace.snapshot?.sources, sources, setSources, objectUrlsRef);

  const apply = useCallback((commands: EditorCommand | EditorCommand[]) => {
    controller.dispatchEditor(commands);
    const next = controller.getState().document;
    if (next) documentRef.current = toEditorDocument(next);
  }, [controller]);

  const applyCapability = useCallback((action: EditorCapabilityInput) => {
    const before = controller.getState();
    if (!before.document || before.status === "loading") throw new Error("Wait for the project to load.");
    const commands = buildEditorCapabilityCommands(before.document, action);
    if (!commands.length) return;
    controller.dispatch(commands);
    const after = controller.getState();
    if (after.document === before.document) throw new Error(after.error ?? "The action could not be applied.");
    documentRef.current = toEditorDocument(after.document!);
  }, [controller]);

  const getAnalysisProject = useCallback((): SourceAnalysisProject => {
    const state = controller.getState();
    if (!state.document) throw new Error("Wait for the project to load.");
    return { projectId, revision: state.snapshot?.revision ?? 0, document: state.document };
  }, [controller, projectId]);
  const applyAnalysis = useCallback((commands: VideoProjectCommand[], reviewed: SourceAnalysisProject) => {
    const current = getAnalysisProject();
    if (current.projectId !== reviewed.projectId || current.revision !== reviewed.revision || current.document !== reviewed.document) throw new Error("The project changed. Analyze this clip again before applying quiet-section cuts.");
    previewRef.current?.pause(); setPlaying(false);
    controller.dispatch(commands);
    const after = controller.getState();
    if (after.document === current.document) throw new Error(after.error ?? "The cuts could not be applied.");
    documentRef.current = toEditorDocument(after.document!);
  }, [controller, getAnalysisProject]);
  const applyTransition = useCallback(async (commands: VideoProjectCommand[]) => {
    const before = controller.getState();
    if (!before.document) throw new Error("Wait for the project to load.");
    controller.dispatch(commands);
    const after = controller.getState();
    if (after.document === before.document) throw new Error(after.error ?? "The transition could not be applied.");
    documentRef.current = toEditorDocument(after.document!);
  }, [controller]);

  const applySelection = useCallback((action: SelectionAction, anchorId?: string, placement?: { from: number; trackId: string }, selectionIds?: readonly string[]) => {
    const state = controller.getState();
    if (!state.document) return;
    const ids = selectionIds ?? (anchorId && !state.selectedItemIds.includes(anchorId) ? [anchorId] : state.selectedItemIds);
    if (!ids.length) return;
    try {
      const batch = buildSelectionCommands(state.document, ids, action, { anchorId: anchorId ?? state.selectedItemId ?? undefined, ...placement, createId: id });
      controller.dispatch(batch.commands);
      const next = controller.getState();
      if (next.document === state.document) return;
      documentRef.current = toEditorDocument(next.document!);
      controller.selectItems(batch.selectedIds, batch.primaryId);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The selection could not be edited."); }
  }, [controller]);
  const save = useCallback(async (): Promise<string> => String((await controller.flush()).revision), [controller]);
  const undo = useCallback(() => { void controller.history("undo").catch(cause => setError(cause.message)); }, [controller]);
  const redo = useCallback(() => { void controller.history("redo").catch(cause => setError(cause.message)); }, [controller]);

  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (exportTaskRef.current || localMediaRef.current || upload || controller.getState().pending.length || controller.hasPendingRecovery()) { event.preventDefault(); event.returnValue = ""; }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [controller, upload]);

  const seek = useCallback((nextFrame: number) => {
    setFrame(nextFrame);
    previewRef.current?.seek(nextFrame);
  }, [setFrame]);

  useEffect(() => {
    function keydown(event: KeyboardEvent) {
      if (disabled) return;
      const action = editorShortcut(event);
      if (!action || (action === "deleteSelection" && !selectedId)) return;
      event.preventDefault();
      if (action === "undo") undo();
      else if (action === "redo") redo();
      else if (action === "save") void save().catch(() => {});
      else if (action === "togglePlayback") previewRef.current?.togglePlayback();
      else if (action === "deleteSelection" && selectedId) {
        applySelection("delete");
      }
    }
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [applySelection, selectedId, disabled, undo, redo, save]);

  const compiled = useCompiledEditorPreview(workspace.document, sources, previewDraft);
  const layerNames = useMemo(() => {
    const result = new Map<string, string>();
    const items = new Map(document?.items.map(item => [item.id, item]) ?? []);
    const authored = new Map<string, string>();
    for (const item of items.values()) {
      const visit = (node: SceneNodeInput) => { authored.set(node.id, node.text ?? item.name); node.children?.forEach(visit); };
      visit(item.node);
    }
    for (const root of compiled.scene?.nodes ?? []) {
      const owner = items.get(root.id);
      if (!owner) continue;
      const visit = (node: SceneNodeInput) => { result.set(node.id, authored.get(node.id) ?? owner.name); node.children?.forEach(visit); };
      visit(root);
    }
    return result;
  }, [document, compiled.scene]);
  const selected = document?.items.find(item => item.id === selectedId) ?? null;
  const captionFlow = useEditorCaptionWorkflow({ controller, ready: !!document, onResult: itemId => {
    setSelectedId(itemId); setActiveTool("captions"); setShowLibrary(true); setShowInspector(true); setCaptionSetup(null);
  } });
  const captionBusy = captionFlow.busy;
  const captionSetupSource = document?.items.find(item => item.id === captionSetup?.itemId);
  const openCaptionSetup = (item: EditorItem, target?: string) => setCaptionSetup({ itemId: item.id, target });

  const selectionIssues = useMemo(() => workspace.document && selectedIds.length ? {
    move: selectionActionIssue(workspace.document, selectedIds, "move"),
    delete: selectionActionIssue(workspace.document, selectedIds, "delete"),
    duplicate: selectionActionIssue(workspace.document, selectedIds, "duplicate"),
  } : { move: null, delete: null, duplicate: null }, [workspace.document, selectedIds]);
  const selectedBinding = Object.values(workspace.document?.bindings ?? {}).find(binding => binding.itemId === selectedId);
  const timingLockedIds = useMemo(() => new Set(Object.values(workspace.document?.bindings ?? {}).map(binding => binding.itemId)), [workspace.document?.bindings]);
  const selectedNestedNode = selected && selectedNodeId && selectedNodeId !== selected.id ? findEditorNode(selected.node, selectedNodeId) : null;
  const inspectorSelection = selected && selectedNestedNode ? { ...selected, node: selectedNestedNode, caption: undefined, visualizerSourceItemId: undefined } : selected;
  const selectedUpdateCommand = (itemId: string, patch: Partial<EditorItem>): EditorCommand => selectedNestedNode && selected
    ? { type: "updateItem", id: selected.id, patch: { node: replaceEditorNode(selected.node, selectedNestedNode.id!, patch.node ?? selectedNestedNode) } }
    : { type: "updateItem", id: itemId, patch };
  const previewStyle = (item: EditorItem, style: EditorStylePreview["style"] | null) => previewChange(style ? { kind: "style", value: { itemId: item.id, nodeId: item.node.id!, style } } : null);
  const updateSelected = (itemId: string, patch: Partial<EditorItem>) => {
    const current = documentRef.current, item = current?.items.find(item => item.id === itemId);
    const end = (patch.node?.from ?? item?.node.from ?? 0) + (patch.node?.duration ?? item?.node.duration ?? 0);
    const change = selectedUpdateCommand(itemId, patch);
    apply(current && motionTemplateOf(item) && end > current.format.durationInFrames ? [{ type: "updateFormat", patch: { durationInFrames: end } }, change] : change);
  };

  function ensureTrack(
    kind: "visual" | "audio",
    commands: EditorCommand[],
    forceNew = false,
  ) {
    const current = documentRef.current!;
    const selectedTrack = current.tracks.find(
      (track) =>
        track.id === selected?.trackId && track.kind === kind && !track.locked,
    );
    const existing =
      !forceNew &&
      (selectedTrack ??
        current.tracks.find((track) => track.kind === kind && !track.locked));
    if (existing) return existing.id;
    const trackId = id();
    commands.push({
      type: "addTrack",
      track: {
        id: trackId,
        name: `${kind === "audio" ? "Audio" : "Video & graphics"} ${current.tracks.length + 1}`,
        kind,
        muted: false,
        hidden: false,
        locked: false,
      },
    });
    return trackId;
  }

  function fontCommand(family: string): EditorCommand[] {
    return getEditorFontAssets(family).filter(asset => JSON.stringify(documentRef.current?.assets[asset.id]) !== JSON.stringify(asset))
      .map(asset => ({ type: "addAsset", asset }));
  }

  function changeFont(item: EditorItem, family: string) {
    try { applyCapability({ version: 1, capability: "text.font", target: { itemId: item.id, nodeId: item.node.id }, parameters: { family } }); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "The font could not be changed."); }
  }

  function addMedia(asset: EditorAsset, insertAt = controller.getPlayheadFrame(), sourceHash?: string, range?: EditorSourceRange) {
    const current = documentRef.current;
    if (!current) return;
    const admissionIssue = highResolutionInsertionIssue(current, asset);
    if (admissionIssue) { setError(admissionIssue); return; }
    const commands: EditorCommand[] = [];
    if (!current.assets[asset.id]) commands.push({ type: "addAsset", asset });
    const itemId = id();
    let insertion: ReturnType<typeof editorSourceInsertion>;
    try { insertion = editorSourceInsertion(asset, current.format.fps, range); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "The source range could not be added."); return; }
    const { duration } = insertion;
    let trackId = ensureTrack(
      asset.type === "audio" ? "audio" : "visual",
      commands,
    );
    if (
      current.items.some(
        (item) =>
          item.trackId === trackId &&
          (item.node.from ?? 0) < insertAt + duration &&
          (item.node.from ?? 0) + (item.node.duration ?? 1) > insertAt,
      )
    )
      trackId = ensureTrack(
        asset.type === "audio" ? "audio" : "visual",
        commands,
        true,
      );
    const node: SceneNodeInput = {
      id: itemId,
      type:
        asset.type === "image"
          ? "img"
          : asset.type === "audio"
            ? "audio"
            : "video",
      assetId: asset.id,
      from: insertAt,
      ...insertion,
      ...(asset.type !== "image" ? { volume: 1 } : {}),
      ...(asset.type !== "audio"
        ? {
            style: {
              position: "absolute",
              left: 0,
              top: 0,
              width: current.format.width,
              height: current.format.height,
              objectFit: "contain",
            },
          }
        : {}),
    };
    commands.push({
      type: "addItem",
      item: {
        id: itemId,
        trackId,
        name: asset.name,
        node: { ...node, animations: [], children: [] } as EditorItem["node"],
      },
    });
    if (sourceHash && controller.getState().document) {
      controller.dispatch([...editorCommandsToVideoCommands(controller.getState().document!, commands), { type: "addSource", source: { assetId: asset.id, revision: `sha256:${sourceHash}`, contentHash: sourceHash } }]);
      documentRef.current = toEditorDocument(controller.getState().document!);
    } else apply(commands);
    setSelectedId(itemId);
    setShowInspector(true);
  }

  function beginLocalMedia() {
    const lifetime = lifetimeRef.current;
    if (disabled || upload || localMediaRef.current || !documentRef.current || !lifetime || lifetime.signal.aborted) return null;
    const operation = { ...createLocalMediaOperation(lifetime.signal), lifetime };
    localMediaRef.current = operation;
    setError(null);
    return operation;
  }
  function localMediaCurrent(operation: NonNullable<typeof localMediaRef.current>) {
    return !operation.signal.aborted && operation.lifetime === lifetimeRef.current;
  }
  function finishLocalMedia(operation: NonNullable<typeof localMediaRef.current>) {
    operation.dispose();
    if (localMediaRef.current === operation) { localMediaRef.current = null; setLocalImport(null); }
  }

  async function importMedia(files: File[]) {
    if (!files.length) return;
    const operation = beginLocalMedia();
    if (!operation) return;
    try {
      let insertFrame = controller.getPlayheadFrame();
      for (const file of files) {
        operation.signal.throwIfAborted();
        setLocalImport({ name: file.name, progress: 0 });
        const result = await importLocalVideoSource(projectId, file, operation.signal, progress => { if (localMediaCurrent(operation)) setLocalImport({ name: file.name, progress }); });
        if (!localMediaCurrent(operation)) {
          URL.revokeObjectURL(result.sourceUrl);
          return;
        }
        const admissionIssue = documentRef.current && highResolutionInsertionIssue(documentRef.current, result.asset);
        if (admissionIssue) { URL.revokeObjectURL(result.sourceUrl); throw new Error(admissionIssue); }
        objectUrlsRef.current.add(result.sourceUrl);
        setSources((current) => ({
          ...current,
          [result.asset.id]: result.sourceUrl,
        }));
        addMedia(result.asset, insertFrame, result.source.fingerprint);
        insertFrame += Math.max(
          1,
          Math.round(
            (result.asset.durationSeconds ?? 5) *
              documentRef.current!.format.fps,
          ),
        );
      }
    } catch (cause) {
      if (localMediaCurrent(operation))
        setError(cause instanceof Error ? cause.message : "Upload failed.");
    } finally {
      finishLocalMedia(operation);
      if (operation.lifetime === lifetimeRef.current && mediaInputRef.current) mediaInputRef.current.value = "";
    }
  }

  async function relinkMedia(asset: EditorAsset, file: File) {
    const operation = beginLocalMedia();
    if (!operation) return;
    setLocalImport({ name: file.name, progress: 0 });
    try {
      const url = await relinkLocalVideoSource(projectId, asset.id, file, workspace.document?.sources[asset.id]?.contentHash ?? asset.id.replace("local:", ""), asset, operation.signal,
        progress => { if (localMediaCurrent(operation)) setLocalImport({ name: file.name, progress }); });
      if (!localMediaCurrent(operation)) { URL.revokeObjectURL(url); return; }
      objectUrlsRef.current.add(url); setSources(current => ({ ...current, [asset.id]: url }));
    } catch (cause) { if (localMediaCurrent(operation)) setError(cause instanceof Error ? cause.message : "Upload failed."); }
    finally { finishLocalMedia(operation); }
  }

  function addMotion(template: MotionTemplateId) {
    const current = documentRef.current;
    if (!current || disabled) return;
    const itemId = id();
    apply(motionInsertCommands(current, defaultMotionSettings(template), itemId, controller.getPlayheadFrame()));
    setSelectedId(itemId); setShowInspector(true);
  }

  function addText(preset?: string) {
    const current = documentRef.current;
    if (!current) return;
    const commands = fontCommand("Inter");
    const trackId = ensureTrack("visual", commands, true);
    const itemId = id();
    commands.push({
      type: "addItem",
      item: {
        id: itemId,
        trackId,
        name: "Text",
        node: {
          id: itemId,
          type: "text",
          text: t("Your text"),
          from: controller.getPlayheadFrame(),
          duration: current.format.fps * 5,
          animations: [],
          children: [],
          style: {
            position: "absolute",
            left: current.format.width * 0.1,
            top: current.format.height * 0.4,
            width: current.format.width * 0.8,
            height: current.format.height * 0.2,
            fontFamily: "Inter",
            fontSize: Math.round(current.format.height / 12),
            fontWeight: 700,
            color: "#ffffff",
            textAlign: "center",
            ...(preset ? editorTextStyles[preset]?.style : {}),
          },
        },
      },
    });
    apply(commands);
    setSelectedId(itemId);
    setShowInspector(true);
  }

  async function captureVisualContext(snapshot: VideoProjectSnapshot, itemId: string, captureFrame: number) {
    const item = snapshot.document.items.find(candidate => candidate.id === itemId);
    if (!item) throw new Error("Select a clip or graphic before including a preview image.");
    if (captureFrame < (item.node.from ?? 0) || captureFrame >= (item.node.from ?? 0) + (item.node.duration ?? 1)) throw new Error("Move the playhead inside the selected clip before including its preview frame.");
    const captured = await previewRef.current?.captureFrame(captureFrame);
    if (!captured || controller.getState().snapshot?.documentHash !== snapshot.documentHash) throw new Error("The project changed while capturing. Retry with the latest preview.");
    if (["video", "audio"].includes(item.node.type) && item.node.assetId) {
      const source = snapshot.document.sources[item.node.assetId];
      if (!source) throw new Error("The selected media has no stable source identity.");
      const clock = sourceWindow(item, snapshot.document.format.fps);
      return { ...captured, itemId, documentHash: snapshot.documentHash, sourceId: item.node.assetId, sourceRevision: source.revision, sourceTimeMs: clock.startMs + (captured.frame - clock.from) * 1000 / snapshot.document.format.fps * clock.rate };
    }
    return { ...captured, itemId, documentHash: snapshot.documentHash };
  }

  async function authorizeSourceUploads(assetIds: string[]) {
    for (const assetId of assetIds) {
      const asset = documentRef.current?.assets[assetId];
      if (!asset || asset.source !== "local") continue;
      setUpload({ name: asset.name, progress: 0 });
      try {
        const source = await uploadLocalVideoSource(projectId, asset.id, progress => setUpload({ name: asset.name, progress }), lifetimeRef.current?.signal);
        if (!source.assetId) throw new Error("The uploaded source could not be verified.");
        apply({ type: "addAsset", asset: { ...asset, source: "project", assetId: source.assetId } });
        await controller.flush();
      } finally { setUpload(null); }
    }
  }

  function addVisualizer(item: EditorItem, template: MusicVisualizerLayerTemplateKey = "spectrum-bars-basic") {
    const current = documentRef.current;
    if (!current || !item.node.assetId) return;
    const source = current.assets[item.node.assetId];
    if (!source) return;
    const commands: EditorCommand[] = [];
    const trackId = ensureTrack("visual", commands, true);
    const itemId = id();
    commands.push({
      type: "addItem",
      item: {
        id: itemId,
        trackId,
        name: "Music visualizer",
        visualizerSourceItemId: item.id,
        node: createEditorVisualizerNode(itemId, item, current.format, template),
      },
    });
    apply(commands);
    setSelectedId(itemId);
    setShowInspector(true);
  }

  async function exportVideo(fileHandle?: DojoVideoEngineExportFileHandle) {
    const lifetime = lifetimeRef.current;
    if (!compiled.scene || previewError || exportProgress !== null || exportTaskRef.current || !documentRef.current || !lifetime || lifetime.signal.aborted)
      return;
    const operation = createExportOperation(lifetime.signal);
    exportTaskRef.current = operation;
    previewRef.current?.pause();
    setExportProgress(0);
    setExportPhase("Saving project");
    setError(null);
    setOutput(null);
    setPublished(false);
    let publication: ExportPublication | null = null;
    try {
      const exportSnapshot = await operation.wait(controller.flush());
      const savedRevision = String(exportSnapshot.revision);
      const snapshot = toEditorDocument(exportSnapshot.document);
      const exportSources = { ...sources };
      // Stored sources are immutable; refresh their signed locators for this pinned export only.
      for (const asset of Object.values(exportSnapshot.document.assets)) {
        if (exportSources[asset.id]?.startsWith("blob:")) continue;
        const cloud = exportSnapshot.sources.find(source => source.sourceId === asset.id || source.assetId === (asset.assetId ?? asset.id));
        if (cloud?.url) exportSources[asset.id] = cloud.url;
      }
      const scene = editorExportScene(compileVideoProjectDocument(exportSnapshot.document, exportSources).scene, exportResolution);
      await operation.wait(requireEditorExportSupport(scene));
      const plan = planDojoVideoEngineExport(scene);
      if (
        !fileHandle &&
        plan.preflight.estimate.estimatedEncodedBytes > MAX_IN_MEMORY_EXPORT_BYTES
      )
        throw new Error(
          t(LARGE_EXPORT_MESSAGE),
        );
      if (publicationRef.current && !publicationFinishedRef.current)
        await operation.wait(publicationRef.current.cancel().catch(() => {}));
      operation.check();
      publication = createEditorExportPublication(projectId, {
        exportId: id(),
        documentRevision: savedRevision,
        width: scene.width,
        height: scene.height,
        resolution: exportResolution,
        fps: snapshot.format.fps,
        durationInFrames: snapshot.format.durationInFrames,
        sourceType: "editor_export",
      });
      publicationRef.current = publication;
      publicationFinishedRef.current = false;
      await operation.wait(publication.prepare(operation.signal));
      operation.check();
      const options: DojoVideoEngineExportOptions = {
        scene,
        ...EDITOR_VIDEO_ENCODING,
        onPhaseChange: (phase) =>
          !operation.signal.aborted && setExportPhase(
            phase === "preparing"
              ? "Preparing media"
              : phase === "finishing"
                ? "Finishing video"
                : "Exporting video",
          ),
        onProgress: (progress) =>
          !operation.signal.aborted && setExportProgress((progress.frameIndex + 1) / progress.totalFrames),
        verification: "sampled",
      };
      const task = fileHandle
        ? await operation.wait(startDojoVideoEngineSceneFileExport(options, fileHandle, operation.signal), late => { void late.result.catch(() => undefined); late.cancel(); })
        : startDojoVideoEngineSceneExport(options);
      operation.attach(task);
      const result = await operation.wait<Awaited<typeof task.result>>(task.result);
      const blob = fileHandle
        ? await operation.wait(fileHandle.getFile())
        : (result as { blob: Blob }).blob;
      operation.check();
      const extension = blob.type.includes("webm") ? "webm" : "mp4";
      const filename = `${projectName.replace(/[^\p{L}\p{N}._-]+/gu, "-") || "dojoclip-video"}.${extension}`;
      setOutput({
        blob,
        name: filename,
        publication,
        savedToFile: !!fileHandle,
      });
      if (!fileHandle) downloadBlob(blob, filename);
    } catch (cause) {
      if (publication) void publication.cancel().catch(() => {});
      if (
        !lifetime.signal.aborted && !operation.signal.aborted &&
        !(cause instanceof DOMException && cause.name === "AbortError")
      )
        setError(cause instanceof Error ? cause.message : "Export failed.");
    } finally {
      operation.dispose();
      if (exportTaskRef.current === operation) {
        exportTaskRef.current = null;
        setExportProgress(null);
      }
    }
  }

  function beginExport() {
    if (!compiled.scene || previewError || exportProgress !== null) return;
    try {
      const plan = planDojoVideoEngineExport(editorExportScene(compiled.scene, exportResolution));
      // Choose a destination before awaiting saves: the browser picker requires
      // this click gesture. Small exports retain the regular download workflow.
      if (plan.preflight.estimate.estimatedEncodedBytes > MAX_IN_MEMORY_EXPORT_BYTES) void exportToFile();
      else void exportVideo();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Export failed.");
    }
  }

  async function exportToFile() {
    const lifetime = lifetimeRef.current;
    const picker = (
      window as unknown as {
        showSaveFilePicker?: (
          options: unknown,
        ) => Promise<DojoVideoEngineExportFileHandle>;
      }
    ).showSaveFilePicker;
    if (typeof picker !== "function") { setError(t(LARGE_EXPORT_MESSAGE)); return; }
    try {
      // The picker must be the first async operation in this click gesture.
      const handle = await picker.call(window, {
        suggestedName: `${projectName || "dojoclip-video"}.mp4`,
        types: [
          { description: "MP4 video", accept: { "video/mp4": [".mp4"] } },
        ],
      });
      if (!lifetime || lifetime.signal.aborted || lifetime !== lifetimeRef.current) return;
      await exportVideo(handle);
    } catch (cause) {
      if (lifetime && !lifetime.signal.aborted && lifetime === lifetimeRef.current && !(cause instanceof DOMException && cause.name === "AbortError"))
        setError(
          cause instanceof Error
            ? cause.message
            : "Could not open the destination file.",
        );
    }
  }

  async function publishOutput() {
    if (!output || publishing || published) return;
    setPublishing(true);
    setError(null);
    try {
      await output.publication.publish(
        output.blob,
        lifetimeRef.current?.signal,
      );
      publicationFinishedRef.current = true;
      setPublished(true);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not save this output to your project.",
      );
    } finally {
      setPublishing(false);
    }
  }

  const move = (itemId: string, from: number, trackId: string) =>
    apply({ type: "moveItem", id: itemId, from, trackId });
  const trim = (itemId: string, from: number, duration: number) =>
    apply({ type: "trimItem", id: itemId, from, duration });
  function inspectItem(itemId: string) {
    setSelectedId(itemId); setShowInspector(true); setShowLibrary(true);
  }
  function selectTimelineItem(itemId: string, gesture?: TimelineSelectionGesture) {
    controller.selectTimelineItem(itemId, gesture); setShowInspector(true); setShowLibrary(true);
  }
  const selectLayer = (nodeId: string) => {
    const item = documentRef.current?.items.find(candidate => candidate.id === nodeId || !!findEditorNode(candidate.node, nodeId) || (!!candidate.caption && nodeId.startsWith(`${candidate.id}:`)));
    if (item) {
      controller.select(item.id, findEditorNode(item.node, nodeId)?.id ?? item.id);
      setShowInspector(true); setShowLibrary(true);
    }
  };

  if (loading || !document)
    return (
      <div className="editor-workspace items-center justify-center gap-4 p-8">
        {loading ? (
          <>
            <Loader2 className="animate-spin" />
            <p>{t("Opening project…")}</p>
          </>
        ) : (
          <>
            <p className="max-w-lg text-center">{error}</p>
            <Link
              href={getLocalizedHref("/applications/video-edit-ai", locale)}
              className={buttonClass}
            >
              {t("Back to projects")}
            </Link>
          </>
        )}
      </div>
    );

  return (
    <EditorInteractionProvider controller={controller}>
    <EditorPlayheadProvider controller={controller}>
    <div
      className="editor-workspace"
      data-testid="dojo-video-engine-editor"
    >
      <header className="editor-header">
        <div className="editor-header-project">
          <Link
            href={getLocalizedHref("/applications/video-edit-ai", locale)}
            className="text-xs text-[var(--editor-muted)] hover:text-[var(--editor-text)]"
          >
            {t("Projects")}
          </Link>
          <span className="text-[var(--editor-muted)]">/</span>
          <EditorProjectName
            name={projectName}
            disabled={currentProject?.id !== projectId}
            documentStatus={saveStatus === "saving" ? "Saving…" : workspace.pending.length > 0 ? "Unsaved changes" : saveStatus === "error" ? "Save failed" : "Saved"}
            onSave={async name => {
              const updated = await updateProject(projectId, { name });
              return updated?.id === projectId ? updated.name : null;
            }}
          />
        </div>
        <div className="editor-header-canvas">
              <label className="editor-aspect-ratio">
                <span>{t("Aspect ratio")}</span>
                <select aria-label={t("Aspect ratio")} value={editorAspectRatioValue(document.format)} disabled={disabled} onChange={event => {
                  const preset = editorAspectRatios.find(option => option.value === event.target.value);
                  if (preset) apply(editorFormatCommands(document, { width: preset.width, height: preset.height }));
                }}>
                  {editorAspectRatios.map(preset => <option key={preset.value} value={preset.value}>{t(preset.label)}</option>)}
                  {editorAspectRatioValue(document.format) === "custom" && <option value="custom">{t("Custom")} · {document.format.width} × {document.format.height}</option>}
                </select>
              </label>
          <EditorExportResolutionSelect format={document.format} value={exportResolution} onChange={setExportResolution} disabled={disabled} />
          <button
            className={`${buttonClass} editor-properties-toggle`}
            aria-label={t(showLibrary && showInspector ? "Hide inspector" : "Show inspector")}
            title={t(showLibrary && showInspector ? "Hide inspector" : "Show inspector")}
            aria-expanded={showLibrary && showInspector}
            onClick={() => {
              const opening = !showLibrary || !showInspector;
              setShowLibrary(true); setShowInspector(opening);
              if (opening && window.innerWidth < 1200) setShowChat(false);
              if (!opening && activeTool === "project") setActiveTool("media");
            }}
          >
            <Settings2 size={15} />
            <span>{t(showLibrary && showInspector ? "Hide inspector" : "Show inspector")}</span>
          </button>
        </div>
        <div className="editor-header-actions">
          <button className={buttonClass} aria-label="Toggle chat" aria-expanded={showChat} onClick={() => setShowChat(value => !value)}><MessageSquare size={15} /><span className="hidden sm:inline">{t("Chat")}</span></button>
          <button
            className={buttonClass}
            title="Undo (⌘Z)"
            aria-label="Undo"
            disabled={disabled || !workspace.snapshot?.history.canUndo || !!workspace.pending.length}
            onClick={undo}
          >
            <Undo2 size={15} />
          </button>
          <button
            className={buttonClass}
            title="Redo (⇧⌘Z)"
            aria-label="Redo"
            disabled={disabled || !workspace.snapshot?.history.canRedo || !!workspace.pending.length}
            onClick={redo}
          >
            <Redo2 size={15} />
          </button>
          <button
            className={buttonClass}
            disabled={disabled || saveStatus === "saving" || !workspaceSaveFailureAllowsRetry(workspace.saveFailure)}
            onClick={() => void save().catch(() => {})}
          >
            <Save size={14} />
            <span className="hidden sm:inline">{t("Save")}</span>
          </button>
          <button
            className="editor-export-button"
            disabled={
              disabled || exportProgress !== null || !compiled.scene || !!previewError || !document.items.length || !!upload || !!localImport
            }
            onClick={beginExport}
          >
            <Download size={14} />
            {t("Export video")}
          </button>
        </div>
      </header>
      {workspace.recoveryError && <div role="alert" className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-amber-800 bg-amber-950/20 px-4 py-2 text-xs text-amber-700 dark:text-amber-200">
        <span>{t(workspace.recoveryError)}</span>
        <button className="whitespace-nowrap underline" onClick={() => void controller.retryRecovery()}>{t("Retry browser recovery")}</button>
      </div>}
      {workspace.saveFailure && workspace.pending.length > 0 && <EditorSaveRecovery
        failure={workspace.saveFailure}
        retrying={saveStatus === "saving"}
        onRetry={() => void controller.flush().then(() => setError(null)).catch(() => {})}
        onSignIn={openSignIn}
        onDownload={() => downloadBlob(new Blob([JSON.stringify(conflictDraft ?? documentRef.current, null, 2)], { type: "application/json" }), "project-draft.json")}
        onResolve={choice => void controller.resolveConflict(choice).then(() => setError(null)).catch(cause => setError(cause.message))}
        onDiscard={() => void controller.discardRejectedChanges().then(() => setError(null)).catch(cause => setError(cause.message))}
      />}
      {((error && error !== workspace.saveFailure?.message) || previewError) && (
        <div role="alert" className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-red-900 bg-[var(--editor-danger-bg)] px-4 py-2 text-xs text-[var(--editor-danger-text)]">
          <span>{t((error !== workspace.saveFailure?.message ? error : null) || previewError || "")}</span>
          {conflictDraft && <button className="whitespace-nowrap underline" onClick={() => downloadBlob(new Blob([JSON.stringify(conflictDraft, null, 2)], { type: "application/json" }), "project-draft.json")}>{t("Download draft")}</button>}
          {error && <button aria-label="Dismiss error" onClick={() => { setError(null); controller.clearError(); }}><X size={14} /></button>}
        </div>
      )}
      {captionFlow.progress && !captionSetupSource && <EditorCaptionProgress progress={captionFlow.progress} onDismiss={captionFlow.dismiss} onOpen={itemId => { setSelectedId(itemId); setActiveTool("captions"); setShowLibrary(true); setShowInspector(true); }} onPlace={selected ? () => captionFlow.placeReady(selected) : undefined}
        onDownload={captionFlow.translationDownload ? () => downloadBlob(new Blob([serializeEditorSubtitles({ id: "translation", trackId: "translation", name: "Translation", node: { id: "translation", type: "div", from: 0, duration: document.format.durationInFrames }, caption: { cues: captionFlow.translationDownload!, mode: "sentence", highlightColor: "#fff", direction: "ltr" } }, document.format.fps)], { type: "text/plain" }), "translated-captions.srt") : undefined} />}
      {localImport && !(showLibrary && !showInspector && activeTool === "media") && <div role="status" aria-label={t("Import media")} className="flex shrink-0 items-center gap-3 border-b border-[var(--editor-border)] bg-[var(--editor-panel)] px-4 py-2 text-xs">
        <span className="min-w-0 flex-1 truncate">{t(`Importing ${localImport.name}`)}</span><progress className="w-24 shrink-0" max={1} value={localImport.progress} /><button type="button" className="shrink-0 underline" onClick={() => localMediaRef.current?.cancel()}>{t("Cancel")}</button>
      </div>}
      <div style={{ "--editor-chat-width": `${chatWidth}px` } as CSSProperties} className={`editor-body ${showLibrary ? "" : "editor-panel-collapsed"} ${showChat ? "editor-chat-open" : ""}`}>
        <nav className="editor-tool-rail" aria-label="Editor tools">
          {([{ key: "graphics", label: "Motion Graphics", icon: Shapes }, { key: "text", label: "Text", icon: Type }, { key: "captions", label: "Captions", icon: Subtitles }, { key: "visualizer", label: "Music visualizer", icon: Activity }, { key: "media", label: "Media", icon: FolderOpen }, { key: "project", label: "Project", icon: Settings2 }] as const).map(tool => <button key={tool.key} aria-label={locale === "en" ? `Open ${tool.label}` : tool.key === "graphics" ? motionCopy(locale).panel : t(tool.label)} aria-pressed={activeTool === tool.key && showLibrary} onClick={() => openTool(tool.key)}><tool.icon size={21} strokeWidth={1.5} /><span>{tool.key === "graphics" ? motionCopy(locale).panel : t(tool.label)}</span></button>)}
          <button type="button" className="editor-panel-toggle" aria-label={showLibrary ? showInspector ? "Close inspector" : "Hide library" : "Show media library"} title={t(showLibrary ? showInspector ? "Hide inspector" : "Hide library" : "Show media library")} aria-expanded={showLibrary} onClick={() => setShowLibrary(value => !value)}>
            {showLibrary ? <PanelLeftClose size={20} /> : <PanelLeftOpen size={20} />}
          </button>
        </nav>
        {showLibrary && <div className="editor-tool-panel">
        <div className="editor-panel-switch" role="group" aria-label={t("Editing panel")}>
          <button type="button" aria-label={t("Show media library")} aria-pressed={!showInspector} onClick={() => { setShowInspector(false); setActiveTool("media"); }}>{t("Media")}</button>
          <button type="button" aria-label={t("Show properties")} aria-pressed={showInspector} onClick={() => setShowInspector(true)}>{t("Properties")}</button>
        </div>
        {showInspector && (
          <div className="editor-inspector">
            <div className="editor-panel-heading"><button className="editor-back-button" onClick={() => { setShowInspector(false); if (activeTool === "project") setActiveTool("media"); }}><ChevronLeft size={16} />{t(activeTool === "project" ? "Media" : activeTool === "text" ? "Text" : activeTool === "captions" ? "Captions" : "Media")}</button><span>{t(selected ? selected.caption ? "Captions" : selected.node.type === "text" ? "Text" : "Editing layer" : "Project")}</span>

            </div>
            <div className="border-b border-[var(--editor-border)] bg-[var(--editor-panel)] p-3"><label className="text-[11px] text-[var(--editor-muted)]">{t("Editing layer")}<select aria-label={t("Editing layer")} value={selectedId ?? ""} onChange={event => controller.select(event.target.value || null)} className="mt-1 w-full rounded border border-[var(--editor-border)] bg-[var(--editor-surface)] p-2 text-xs">
              <option value="">{t("Project")}</option>
              {document.items.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select></label></div>
            {selectedIds.length > 1 && <div role="status" data-batch-selection className="space-y-1 border-b border-[var(--editor-border)] px-3 py-3 text-xs text-[var(--editor-muted)]">
              <p>{t("Selected clips")}: {selectedIds.length}</p>
              <p>{t("Batch actions affect all selected clips. The inspector edits the primary clip.")}</p>
              {[...new Set(Object.values(selectionIssues).filter((issue): issue is string => !!issue))].map(issue => <p key={issue}>{t(issue)}</p>)}
            </div>}
            {selectedBinding && <div className="space-y-2 border-b border-violet-900 bg-[var(--editor-accent-soft)] px-3 py-3 text-xs text-[var(--editor-accent-text)]" role="status">
              <p>{t(selectedBinding.status === "active" ? "Linked to speech" : "Speech anchor is outside the source clip")}</p>
              <p className="truncate text-[11px] text-[var(--editor-muted)]">{document.items.find(item => item.id === selectedBinding.sourceItemId)?.name}</p>
              <button className="underline disabled:opacity-40" disabled={disabled || document.tracks.find(track => track.id === selected?.trackId)?.locked} onClick={() => controller.dispatch([{ type: "removeBinding", id: selectedBinding.id }])}>{t("Unlink from speech")}</button>
            </div>}
            {selected && !selected.caption && (selected.node.children?.length ?? 0) > 0 && <div className="border-b border-[var(--editor-border)] bg-[var(--editor-panel)] p-3"><label className="text-[11px] text-[var(--editor-muted)]">{t("Graphic layer")}<select aria-label="Graphic layer" value={selectedNodeId ?? selected.id} onChange={event => controller.select(selected.id, event.target.value)} className="mt-1 w-full rounded border border-[var(--editor-border)] bg-[var(--editor-surface)] p-2 text-xs">
              {flattenEditorNodes(selected.node).map(({ node, depth }) => <option key={node.id} value={node.id}>{`${"  ".repeat(depth)}${node.text ?? (node.id === selected.id ? selected.name : node.id)}`}</option>)}
            </select></label></div>}
            <div className="min-h-0 flex-1"><EditorInspector
              contextualControls={selected && !selectedNestedNode && workspace.document ? <>
                {["video", "audio"].includes(selected.node.type) && <EditorQuietSections key={`quiet:${projectId}:${selected.id}`} current={{ projectId, revision: workspace.snapshot?.revision ?? 0, document: workspace.document }} itemId={selected.id}
                  disabled={disabled || !!document.tracks.find(track => track.id === selected.trackId)?.locked} getCurrent={getAnalysisProject}
                  onSeek={seek} onApply={applyAnalysis} />}
                {["video", "img"].includes(selected.node.type) && <EditorTransitionControl key={`transition:${projectId}:${selected.id}`} document={workspace.document} itemId={selected.id} disabled={disabled} onApply={applyTransition} onSeek={seek} />}
              </> : undefined}
              document={document}
              selected={inspectorSelection}
              nestedSelection={!!selectedNestedNode}
              sourceTimingLocked={!!selectedBinding && !selectedNestedNode}
              disabled={disabled}
              busyCaption={captionBusy}
              onSelect={inspectItem}
              onSeek={seek}
              onUpdate={updateSelected}
              onFormat={(patch) => apply(editorFormatCommands(document, patch))}
              exportResolution={exportResolution}
              onExportResolution={setExportResolution}
              onMove={(itemId, from, trackId) => selectedNestedNode ? updateSelected(itemId, { node: { ...selectedNestedNode, from } }) : move(itemId, from, trackId)}
              onTrim={(itemId, from, duration) => selectedNestedNode ? updateSelected(itemId, { node: { ...selectedNestedNode, from, duration } }) : trim(itemId, from, duration)}
              onTranscribe={item => openCaptionSetup(item)}
              onTranslate={(item, language) => openCaptionSetup(item, language)}
              onDownloadCaptions={(item) =>
                downloadBlob(
                  new Blob(
                    [serializeEditorSubtitles(item, document.format.fps)],
                    { type: "text/plain;charset=utf-8" },
                  ),
                  `${item.name}.srt`,
                )
              }
              onAddVisualizer={addVisualizer}
              onApplyCaptionPreset={(item, key) => {
                const preset = editorCaptionPresets[key]; if (!preset || !item.caption || (item.caption.role === "translation" && preset.mode !== "sentence")) return;
                const family = preset.style.fontFamily ?? item.node.style?.fontFamily ?? "Inter";
                apply([...fontCommand(family), { type: "updateItem", id: item.id, patch: {
                  node: updateEditorNodeStyle(item.node, preset.style),
                  caption: { ...item.caption, mode: preset.mode, highlightColor: preset.highlightColor, highlightStyle: preset.highlightStyle, motion: preset.motion },
                } }]);
              }}
              onPreviewStyle={previewStyle}
              onPreviewProperty={value => previewChange(value ? { kind: "property", value } : null)}
              onPreviewText={(item, text) => previewChange(text === null ? null : { kind: "content", value: { itemId: item.id, nodeId: item.node.id!, text } })}
              onPreviewCue={(item, cue) => previewChange(cue === null ? null : { kind: "content", value: { itemId: item.id, cue } })}
              onFont={changeFont}
            /></div>
          </div>
        )}
        <EditorLibrary hidden={showInspector}
          tool={activeTool} selectedItemId={selectedId} library={library} sources={sources} previews={mediaPreviews} disabled={disabled} upload={localImport ?? upload} onCancelImport={localImport ? () => localMediaRef.current?.cancel() : undefined}
          onImport={() => mediaInputRef.current?.click()}
          onDrop={files => void importMedia(files)} onAddMedia={(asset, range) => addMedia(asset, undefined, undefined, range)} onAddText={addText} onAddMotion={addMotion} fps={document.format.fps}
          onImportCaptions={() => subtitlesInputRef.current?.click()}
          onAddCaption={() => captionFlow.addManual([{ id: id(), text: t("Your caption"), startMs: 0, endMs: 3000 }], controller.getPlayheadFrame(), t("Captions"))}
          onCreateCaptions={item => openCaptionSetup(item)} onTranslateCaptions={item => openCaptionSetup(item)} captionBusy={captionBusy}
          items={document.items} onSelect={inspectItem} onAddVisualizer={addVisualizer}
          transcriptPanel={workspace.document && <EditorTranscriptPanel document={workspace.document} selectedItemId={selectedId} disabled={disabled} onSeek={seek} onRemove={(selection, basis) => {
            const current = controller.getState();
            if (!current.document || current.document !== basis) { setError("The project changed. Select the speech again."); return; }
            try {
              const edit = manualSpeechRemoval(current.document, selection.sourceItemId, selection.evidenceId, selection.wordIds);
              controller.dispatch(edit.commands);
              const next = controller.getState();
              if (next.document !== current.document) { documentRef.current = toEditorDocument(next.document!); seek(Math.min(edit.range.from, next.document!.format.durationInFrames - 1)); }
              else if (next.error) setError(next.error);
            } catch (cause) { setError(cause instanceof Error ? cause.message : "The speech selection could not be edited."); }
          }} />}
          onRelink={asset => { relinkAssetRef.current = asset; relinkInputRef.current?.click(); }}
        />
        </div>}
        <div className="editor-center">
        <section className="editor-preview" aria-label="Video preview">
          {inspectorSelection && (inspectorSelection.node.type === "text" || inspectorSelection.caption) && <EditorTextToolbar item={inspectorSelection} onFont={family => changeFont(inspectorSelection, family)} disabled={disabled || !!document.tracks.find(track => track.id === selected?.trackId)?.locked} onPreviewStyle={style => previewStyle(inspectorSelection, style)} onStyle={patch => updateSelected(inspectorSelection.id, { node: updateEditorNodeStyle(inspectorSelection.node, patch) })} />}
          <div className="editor-preview-stage" ref={previewStageRef} style={{ "--editor-aspect-ratio": compiled.scene ? compiled.scene.width / compiled.scene.height : document.format.width / document.format.height } as React.CSSProperties} onDragOver={event => { if (event.dataTransfer.types.includes("Files")) event.preventDefault(); }} onDrop={event => { event.preventDefault(); void importMedia(Array.from(event.dataTransfer.files)); }}>
                {compiled.scene && !document.items.length && <div className="editor-empty-preview">
                  <div className="editor-empty-icon"><Film size={28} strokeWidth={1.5} /></div>
                  <h2>{t("Your video starts here")}</h2>
                  <p>{t("Import a video, image or audio file to start editing.")}</p>
                  <button type="button" disabled={disabled || !!upload || !!localImport} className="editor-primary-button" onClick={() => mediaInputRef.current?.click()}><Plus size={16} />{t("Import media")}</button>
                </div>}

            {compiled.scene ? (
              <div className="relative isolate h-full w-full min-h-0"
                onPointerDownCapture={event => { if (event.button === 0 && !previewPointers.current.has(event.pointerId)) { previewPointers.current.add(event.pointerId); controller.beginInteraction(); } }}
                onPointerUpCapture={event => { if (previewPointers.current.delete(event.pointerId)) queueMicrotask(() => controller.endInteraction()); }}
                onPointerCancelCapture={event => { if (previewPointers.current.delete(event.pointerId)) queueMicrotask(() => controller.endInteraction()); }}
              >
                <DojoVideoEngineCanvasPreview
                  ref={previewRef}
                  scene={compiled.scene}
                  title={projectName}
                  compact
                  showControls={false}
                  labels={{
                    loading: t("Preparing preview…"),
                    play: t("Play"),
                    pause: t("Pause"),
                    selectLayer: name => `${t("Select layer")}: ${name}`,
                    moveLayer: name => `${t("Move layer")}: ${name}`,
                    resizeLayer: name => `${t("Resize layer")}: ${name}`,
                    resizeLayerHandle: (name, handle) => `${t("Resize layer")}: ${name}, ${t(({ n: "Top edge", ne: "Top right corner", e: "Right edge", se: "Bottom right corner", s: "Bottom edge", sw: "Bottom left corner", w: "Left edge", nw: "Top left corner" } as Record<string, string>)[handle] ?? handle)}`,
                    keyboardHelp: t("Use arrow keys to move or resize by one pixel. Hold Shift for ten pixels. Release the arrow keys to save. Escape cancels."),
                    advancedBounds: t("Use the inspector to edit animated or transformed dimensions."),
                    moreLayers: t("More layers are available in the inspector."),
                  }}
                  onFrame={(nextFrame) => {
                    setFrame(nextFrame);
                  }}
                  onLayerKeyboardInteraction={active => { if (active) controller.beginInteraction(); else queueMicrotask(() => controller.endInteraction()); }}
                  selectedLayerId={selectedNodeId}
                  boundsLocked={disabled || !!document.tracks.find(track => track.id === selected?.trackId)?.locked}
                  getLayerName={nodeId => layerNames.get(nodeId) ?? t("Project")}
                  isLayerSelectable={nodeId => layerNames.has(nodeId)}
                  onSelectLayer={document.items.length ? selectLayer : undefined}
                  onLayerBoundsPreview={(nodeId, bounds) => {
                    const item = documentRef.current?.items.find(candidate => !!findEditorNode(candidate.node, nodeId));
                    const node = item ? findEditorNode(item.node, nodeId) : null;
                    if (item && node) previewStyle({ ...item, node }, bounds);
                  }}
                  onLayerBoundsChange={(nodeId, bounds) => {
                    const item = documentRef.current?.items.find(candidate => !!findEditorNode(candidate.node, nodeId));
                    const node = item ? findEditorNode(item.node, nodeId) : null;
                    if (item && node && !disabled)
                      apply({
                        type: "updateItem",
                        id: item.id,
                        patch: {
                          node: replaceEditorNode(item.node, nodeId, { ...node!, style: { ...node!.style, ...bounds } }),
                        },
                      });
                  }}
                  onPlaybackStateChange={(state) => {
                    setFrame(state.frame);
                    setPlaying(state.playing);
                  }}
                  onPreviewError={setPreviewError}
                />
              </div>
            ) : (
              <div className="max-w-md p-5 text-center text-sm text-amber-700 dark:text-amber-300">
                {compiled.error}
              </div>
            )}
          </div>
          <div className="editor-transport" aria-label="Playback controls">
            <button className={buttonClass} aria-label="Go to start" onClick={() => seek(0)}><SkipBack size={15} /></button>
            <button
              className={buttonClass}
              aria-label={playing ? "Pause" : "Play"}
              disabled={!compiled.scene || disabled}
              onClick={() => previewRef.current?.togglePlayback()}
            >
              {playing ? <Pause size={16} /> : <Play size={16} />}
            </button>
            <button className={buttonClass} aria-label="Go to end" onClick={() => seek(document.format.durationInFrames - 1)}><SkipForward size={15} /></button>
            <EditorPlayheadTime fps={document.format.fps} className="w-24 text-xs tabular-nums text-[var(--editor-muted)]" />
            <button
              className={buttonClass}
              disabled={
                disabled || !selected || selectedIds.length > 1 || !!selected.visualizerSourceItemId || !!selectedBinding
              }
              onClick={() =>
                selected &&
                apply({
                  type: "splitItem",
                  id: selected.id,
                  frame: controller.getPlayheadFrame(),
                  newId: id(),
                })
              }
              title={t(selectedIds.length > 1 ? "Select one clip to split." : "Split at playhead")}
            >
              <Scissors size={14} />
            </button>
            <button
              className={buttonClass}
              disabled={disabled || !selected || !!selectionIssues.duplicate}
              onClick={() => applySelection("duplicate")}
              aria-label={t(selectedIds.length > 1 ? "Duplicate selected clips" : "Duplicate")}
              title={t(selectionIssues.duplicate ?? "Duplicate")}
            >
              <Copy size={14} />
            </button>
            <button
              className={buttonClass}
              disabled={disabled || !selected || !!selectionIssues.delete}
              onClick={() => applySelection("delete")}
              aria-label={t(selectedIds.length > 1 ? "Delete selected clips" : "Delete")}
              title={t(selectionIssues.delete ?? "Delete")}
            >
              <Trash2 size={14} />
            </button>
            <button className={buttonClass} aria-label="Fullscreen preview" onClick={() => void previewStageRef.current?.requestFullscreen?.().catch(() => {})}><Maximize2 size={15} /></button>
          </div>
        </section>        <div className="editor-timeline-panel" style={{ height: timelineOpen ? timelineHeight : 48 }}>
          <div className="editor-timeline-resizer" role="separator" aria-label={t("Resize timeline")} aria-orientation="horizontal" tabIndex={0} aria-valuenow={timelineHeight} aria-valuemin={160} aria-valuemax={520}
            onPointerDown={event => { if (event.button !== 0) return; event.currentTarget.setPointerCapture(event.pointerId); timelineDrag.current = { y: event.clientY, height: timelineOpen ? timelineHeight : 48 }; }}
            onPointerMove={event => { const drag = timelineDrag.current; if (!drag) return; const height = drag.height + drag.y - event.clientY; setTimelineOpen(height >= 100); setTimelineHeight(Math.max(160, Math.min(height, window.innerHeight * 0.6, 520))); }}
            onPointerUp={() => { timelineDrag.current = null; }} onPointerCancel={() => { timelineDrag.current = null; }}
            onKeyDown={event => { if (["ArrowUp", "ArrowDown"].includes(event.key)) { event.preventDefault(); setTimelineOpen(true); setTimelineHeight(value => Math.max(160, Math.min(520, value + (event.key === "ArrowUp" ? 20 : -20)))); } }}><span /></div>
      <div className="editor-timeline-actions"><button aria-label="Toggle timeline" className={buttonClass} onClick={() => setTimelineOpen(value => !value)}>{timelineOpen ? <ChevronDown size={14} /> : <ChevronUp size={14} />}{t("Timeline")}</button>
        <button className={buttonClass} aria-label={selectedIds.length > 1 ? t("Delete selected clips") : "Delete selected clip"} title={selectionIssues.delete ? t(selectionIssues.delete) : undefined} disabled={disabled || !selected || !!selectionIssues.delete} onClick={() => applySelection("delete")}><Trash2 size={14} />{t("Delete")}</button>
        {selectedIds.length > 1 && <span className="text-xs" aria-live="polite">{t("Selected clips")}: {selectedIds.length}</span>}
        <button
          className="flex items-center gap-1 text-[11px] text-[var(--editor-muted)]"
          disabled={disabled}
          onClick={() =>
            apply({
              type: "addTrack",
              track: {
                id: id(),
                name: `Video ${document.tracks.length + 1}`,
                kind: "visual",
                muted: false,
                hidden: false,
                locked: false,
              },
            })
          }
        >
          <Plus size={12} />
          {t("Video track")}
        </button>
        <button
          className="flex items-center gap-1 text-[11px] text-[var(--editor-muted)]"
          disabled={disabled}
          onClick={() =>
            apply({
              type: "addTrack",
              track: {
                id: id(),
                name: `Audio ${document.tracks.length + 1}`,
                kind: "audio",
                muted: false,
                hidden: false,
                locked: false,
              },
            })
          }
        >
          <Plus size={12} />
          {t("Audio track")}
        </button>
        <span className="ml-auto hidden text-[10px] text-[var(--editor-muted)] sm:block">
          {t("Drag clips to move · drag edges to trim · space to play")}
        </span>
      </div>
      <div className="editor-timeline-tracks" hidden={!timelineOpen}><EditorTimeline
        document={document}
        selectedId={selectedId}
        selectedIds={selectedIds}
        moveDisabledReason={selectedIds.length > 1 ? selectionIssues.move : null}
        deleteDisabledReason={selectedIds.length > 1 ? selectionIssues.delete : null}
        onSelectMany={(ids, primary) => controller.selectItems(ids, primary)}
        disabled={disabled}
        previews={mediaPreviews}
        timingLockedIds={timingLockedIds}
        onSelect={selectTimelineItem}
        onDeleteItem={itemId => applySelection("delete", itemId)}
        onDeleteTrack={trackId => controller.dispatch([{ type: "removeTrack", id: trackId }])}
        onSeek={seek}
        onMove={(itemId, from, trackId, ids) => applySelection("move", itemId, { from, trackId }, ids)}
        onTrim={trim}
        onUpdateTrack={(trackId, patch) =>
          apply({ type: "updateTrack", id: trackId, patch })
        }
        onRemoveGap={(trackId, atFrame) =>
          apply({ type: "removeGap", trackId, frame: atFrame })
        }
      /></div>
        </div>
        </div>
        <VideoWorkspaceChat resizeHandle={<EditorChatResizer width={chatWidth} onChange={setChatWidth} label={t("Resize chat")} />} hidden={!showChat} controller={controller} sources={sources} onAuthorizeSources={authorizeSourceUploads} onCaptureVisualContext={captureVisualContext} onClose={() => setShowChat(false)} onSeekFrame={seek} onPausePreview={() => { previewRef.current?.pause(); setPlaying(false); }} mainPreviewPlaying={playing} onCapabilityAction={applyCapability} />
      </div>
      {output && (
        <div
          role="status"
          className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-emerald-900 bg-emerald-950/40 px-4 py-2 text-xs"
        >
          <span className="text-emerald-700 dark:text-emerald-300">
            {output.savedToFile
              ? t("Video saved to your file")
              : t(
                  `Video ready · ${(output.blob.size / 1024 / 1024).toFixed(1)} MB`,
                )}
            {!published && <span className="mt-1 block text-[var(--editor-muted)]">{t("Downloads stay on your device. Upload a copy to save it to this project.")}</span>}
          </span>
          <div className="flex gap-3">
            <button
              className="underline"
              onClick={() => downloadBlob(output.blob, output.name)}
            >
              {t("Download again")}
            </button>
            <button
              className="underline disabled:opacity-50"
              disabled={publishing || published}
              onClick={() => void publishOutput()}
            >
              {t(
                published
                  ? "Saved to project"
                  : publishing
                    ? "Uploading video…"
                    : "Upload to project",
              )}
            </button>
            {published && <Link className="underline" href={getLocalizedHref(`/applications/editor/${projectId}/outputs`, locale)}>{t("View saved videos")}</Link>}
            <button
              aria-label="Dismiss completed export"
              onClick={() => {
                if (!publicationFinishedRef.current)
                  void output.publication.cancel().catch(() => {});
                publicationRef.current = null;
                setOutput(null);
              }}
            >
              <X size={14} />
            </button>
          </div>
        </div>
      )}
      {exportProgress !== null && (
        <div
          role="status"
          aria-label="Exporting video"
          className="fixed bottom-4 left-4 z-40 w-80 shadow-2xl"
        >
          <div className="w-full max-w-sm rounded-xl border border-[var(--editor-border)] bg-[var(--editor-surface)] p-6">
            <h2 className="mb-2 text-base font-medium">{t(exportPhase)}</h2>
            <p className="text-xs text-[var(--editor-muted)]">
              {t("Keep this tab open while your browser creates the video.")}
            </p>
            <progress
              className="my-5 h-2 w-full accent-violet-500"
              value={exportProgress}
              max={1}
            />
            <div className="flex items-center justify-between text-sm">
              <span>{Math.round(exportProgress * 100)}%</span>
              <button
                className={buttonClass}
                disabled={!exportTaskRef.current}
                onClick={() => exportTaskRef.current?.cancel()}
              >
                {t("Cancel")}
              </button>
            </div>
          </div>
        </div>
      )}
      {captionSetup && captionSetupSource && <EditorCaptionSetup key={captionSetup.itemId} source={captionSetupSource} document={document} initialTarget={captionSetup.target} busy={captionBusy} progress={captionFlow.progress}
        onStart={options => captionFlow.start(captionSetupSource, options)} onClose={() => setCaptionSetup(null)} onOpen={inspectItem} />}
      <input ref={relinkInputRef} type="file" accept={EDITOR_MEDIA_ACCEPT} className="hidden" onChange={event => {
        const file = event.target.files?.[0]; const asset = relinkAssetRef.current;
        if (file && asset) void relinkMedia(asset, file);
        event.target.value = "";
      }} />
      <input
        ref={mediaInputRef}
        type="file"
        accept={EDITOR_MEDIA_ACCEPT}
        multiple
        className="hidden"
        aria-label="Import media files"
        onChange={(event) =>
          void importMedia(Array.from(event.target.files ?? []))
        }
      />
      <input
        ref={subtitlesInputRef}
        type="file"
        accept=".srt,.vtt,text/vtt"
        className="hidden"
        aria-label="Import subtitles"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void captionFlow.importSubtitles(file, controller.getPlayheadFrame()).catch(cause => setError(cause.message)).finally(() => { if (subtitlesInputRef.current) subtitlesInputRef.current.value = ""; });
        }}
      />
    </div>
    </EditorPlayheadProvider>
    </EditorInteractionProvider>
  );
}
