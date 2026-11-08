"use client";
import { useMemo, useRef } from "react";
import { sceneNodeSchema, type Scene, type SceneNodeInput } from "@dojo-video-engine/schema";
import { MissingEditorAssetsError, type EditorItem } from "@/lib/editor/document";
import { canonicalSerialize, normalizeVideoProjectJson, type VideoProjectDocument } from "@/lib/video-project/document";
import { compileVideoProjectDocument } from "@/lib/video-project/compilation";
import { previewEditorStyle, type EditorStylePreview } from "./editor-style-preview";
import { previewEditorContent, type EditorContentPreview } from "./editor-content-preview";
import { previewEditorProperty, type EditorPropertyPreview } from "./editor-property-preview";
import { updateEditorNodeStyle } from "./editor-presets";

export type EditorPreviewChange =
  | { kind: "style"; value: EditorStylePreview }
  | { kind: "content"; value: EditorContentPreview }
  | { kind: "property"; value: EditorPropertyPreview };
export type CompiledEditorPreview = { scene: Scene | null; error: string | null; missingAssetIds?: string[] };
function previewFailure(cause: unknown): CompiledEditorPreview {
  return { scene: null, error: cause instanceof Error ? cause.message : "Preview could not be prepared.",
    ...(cause instanceof MissingEditorAssetsError ? { missingAssetIds: cause.assetIds } : {}) };
}
const EMPTY: CompiledEditorPreview = { scene: null, error: null };
const LOCAL_PAINT = new Set(["color", "backgroundColor", "opacity", "filter", "textShadow", "textStroke", "textBackgroundColor"]);

type NodeTarget = { item: EditorItem; node: SceneNodeInput };
export function applyEditorPreviewChange(document: VideoProjectDocument, change: EditorPreviewChange): VideoProjectDocument {
  return change.kind === "style" ? previewEditorStyle(document, change.value)
    : change.kind === "content" ? previewEditorContent(document, change.value)
      : previewEditorProperty(document, change.value);
}
/** Explicit undefined means clear; it must not collide with an absent draft key. */
function previewChangeKey(change: EditorPreviewChange): string {
  const seen = new Set<object>();
  const encode = (value: unknown): unknown => {
    if (value === null) return ["null"];
    if (typeof value !== "object") return [typeof value, typeof value === "number" && !Number.isFinite(value) ? String(value) : value];
    if (seen.has(value)) throw new Error("Preview changes must be acyclic.");
    seen.add(value);
    const result = Array.isArray(value) ? ["array", value.map(encode)]
      : ["object", Object.keys(value).sort().map(key => [key, encode((value as Record<string, unknown>)[key])])];
    seen.delete(value);
    return result;
  };
  return JSON.stringify(encode(change));
}
function replaceSceneNode(nodes: SceneNodeInput[], path: readonly number[], replacement: SceneNodeInput): SceneNodeInput[] {
  const result = nodes.slice(), at = path[0]!;
  result[at] = path.length === 1 ? replacement : { ...nodes[at]!, children: replaceSceneNode(nodes[at]!.children ?? [], path.slice(1), replacement) };
  return result;
}
function nodeAtPath(scene: Scene, path: readonly number[]): SceneNodeInput {
  let node = scene.nodes[path[0]!]!;
  for (let index = 1; index < path.length; index++) node = node.children![path[index]!]!;
  return node;
}

/** Editor-local cache. Persisted documents, commands and hashes remain authoritative. */
export class EditorPreviewCompiler {
  private document: VideoProjectDocument | null = null;
  private sources: Record<string, string> | null = null;
  private base: CompiledEditorPreview = EMPTY;
  private baseSignature: string | null = null;
  private last: CompiledEditorPreview = EMPTY;
  private draft: { document: VideoProjectDocument; base: Scene; key: string; result: CompiledEditorPreview } | null = null;
  private targets = new Map<string, NodeTarget>();
  private paths = new Map<string, number[]>();
  private eligibleItems = new Set<string>();
  private lockedItems = new Set<string>();
  private documentLength = 0;
  private signatures = new WeakMap<Scene, string>();
  private counts = { fullCompilations: 0, incrementalCompilations: 0, fullSerializations: 0, cacheHits: 0 };
  constructor(private readonly compileScene: typeof compileVideoProjectDocument = compileVideoProjectDocument) {}
  stats() { return { ...this.counts }; }

  compile(document: VideoProjectDocument | null, sources: Record<string, string>, change: EditorPreviewChange | null = null): CompiledEditorPreview {
    if (!document) return EMPTY;
    if (this.document !== document || this.sources !== sources) this.prepareBase(document, sources);
    if (!change || !this.base.scene) { this.last = this.base; return this.base; }
    let key: string;
    try { key = previewChangeKey(change); }
    catch (cause) { return previewFailure(cause); }
    if (this.draft?.document === document && this.draft.base === this.base.scene && this.draft.key === key) { this.counts.cacheHits++; this.last = this.draft.result; return this.draft.result; }
    let result: CompiledEditorPreview;
    try {
      const incremental = this.localScene(document, this.base.scene, change);
      if (incremental) {
        if (incremental !== this.base.scene) this.counts.incrementalCompilations++;
        result = incremental === this.base.scene ? this.base
          : this.draft?.base === this.base.scene && this.draft.key === key && this.draft.result.scene
            ? this.draft.result : { scene: incremental, error: null };
      } else {
        const preview = applyEditorPreviewChange(document, change);
        result = preview === document ? this.base : this.fullCompile(preview, sources);
      }
    } catch (cause) {
      result = previewFailure(cause);
    }
    this.draft = { document, base: this.base.scene, key, result };
    this.last = result;
    return result;
  }

  private serialize(scene: Scene): string {
    const cached = this.signatures.get(scene);
    if (cached !== undefined) return cached;
    this.counts.fullSerializations++;
    const signature = canonicalSerialize(scene);
    this.signatures.set(scene, signature);
    return signature;
  }
  private fullCompile(document: VideoProjectDocument, sources: Record<string, string>): CompiledEditorPreview {
    this.counts.fullCompilations++;
    const scene = this.compileScene(document, sources, { sourceMap: false }).scene;
    const signature = this.serialize(scene);
    if (this.base.scene && signature === this.baseSignature) return this.base;
    if (this.last.scene && signature === this.serialize(this.last.scene)) return this.last;
    return { scene, error: null };
  }
  private prepareBase(document: VideoProjectDocument, sources: Record<string, string>) {
    this.document = document; this.sources = sources;
    try {
      const result = this.fullCompile(document, sources);
      this.base = result;
      this.baseSignature = result.scene ? this.serialize(result.scene) : null;
      this.documentLength = JSON.stringify(document).length;
      this.targets.clear(); this.paths.clear(); this.eligibleItems.clear(); this.lockedItems.clear();
      const linked = new Set<string>();
      Object.values(document.transitions ?? {}).forEach(transition => { linked.add(transition.fromItemId); linked.add(transition.toItemId); });
      Object.values(document.bindings).forEach(binding => { linked.add(binding.itemId); linked.add(binding.sourceItemId); });
      document.items.forEach(item => {
        const source = item.caption?.sourceItemId ?? item.visualizerSourceItemId;
        if (source) { linked.add(item.id); linked.add(source); }
      });
      const tracks = new Map(document.tracks.map(track => [track.id, track]));
      document.items.forEach(item => {
        let ordinary = !item.caption && !item.visualizerSourceItemId && !linked.has(item.id);
        const visit = (node: SceneNodeInput) => {
          this.targets.set(node.id, { item, node });
          if (["effect", "extension", "lottie"].includes(node.type)) ordinary = false;
          node.children?.forEach(visit);
        };
        visit(item.node);
        if (tracks.get(item.trackId)?.locked) this.lockedItems.add(item.id);
        if (ordinary) this.eligibleItems.add(item.id);
      });
      const visit = (nodes: SceneNodeInput[], path: number[]) => nodes.forEach((node, index) => {
        const at = [...path, index]; this.paths.set(node.id, at); visit(node.children ?? [], at);
      });
      if (result.scene) visit(result.scene.nodes, []);
    } catch (cause) {
      this.base = previewFailure(cause);
      this.baseSignature = null; this.draft = null;
    }
  }

  private localScene(document: VideoProjectDocument, scene: Scene, change: EditorPreviewChange): Scene | null {
    if (change.kind === "property" || (change.kind === "content" && "cue" in change.value)) return null;
    const value = change.value as EditorStylePreview | (EditorContentPreview & { nodeId: string; text: string });
    const target = this.targets.get(value.nodeId);
    if (!target || target.item.id !== value.itemId || this.lockedItems.has(value.itemId)) return scene;
    if (!this.eligibleItems.has(value.itemId)) return null;
    const path = this.paths.get(value.nodeId);
    if (!path) return null;
    let changed: SceneNodeInput;
    if (change.kind === "style") {
      if (Object.keys(change.value.style).some(key => !LOCAL_PAINT.has(key))) return null;
      changed = updateEditorNodeStyle(target.node, change.value.style);
      const style = { ...changed.style };
      for (const [key, value] of Object.entries(change.value.style)) if (value === undefined) delete style[key as keyof typeof style];
      changed = { ...changed, style };
    } else {
      if (target.node.type !== "text") return scene;
      changed = { ...target.node, text: (change.value as { text: string }).text };
      delete changed.runs;
    }
    changed = sceneNodeSchema.parse(normalizeVideoProjectJson(changed));
    if (canonicalSerialize(changed) === canonicalSerialize(target.node)) return scene;
    // The full command path enforces the document ceiling too. Fall back for
    // the same rejection if a local draft could cross it.
    if (this.documentLength + JSON.stringify(changed).length - JSON.stringify(target.node).length > 4_000_000) return null;
    const existing = nodeAtPath(scene, path);
    const replacement = change.kind === "style"
      ? { ...existing, style: changed.style, animations: changed.animations }
      : { ...existing, text: changed.text };
    if (change.kind === "content") delete replacement.runs;
    return { ...scene, nodes: replaceSceneNode(scene.nodes, path, replacement) };
  }
}

export function useCompiledEditorPreview(document: VideoProjectDocument | null, sources: Record<string, string>, change: EditorPreviewChange | null, suppliedCompiler?: EditorPreviewCompiler): CompiledEditorPreview {
  const compiler = useRef<EditorPreviewCompiler | null>(null);
  compiler.current ??= suppliedCompiler ?? new EditorPreviewCompiler();
  return useMemo(() => compiler.current!.compile(document, sources, change), [document, sources, change]);
}
