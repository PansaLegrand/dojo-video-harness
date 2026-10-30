import type { CompositionNodeOrigin } from "@/lib/editor/composition-render";
import type { SceneNodeInput } from "@motionforge/schema";
import {
  compileParsedEditorDocument,
  MissingEditorAssetsError,
  type EditorDocument,
} from "@/lib/editor/document";
import { sourceWindow } from "./source-clock";
import {
  parseVideoProjectDocument,
  type VideoProjectDocument,
} from "./document";

export type VideoProjectSourceMapEntry = {
  itemId: string;
  nodeId: string;
  trackId: string;
  cueId?: string;
  derived: boolean;
  from: number;
  duration: number;
  sourceAssetId?: string;
  sourceStartMs?: number;
  sourceEndMs?: number;
  bindingId?: string;
  evidenceId?: string;
  transitionId?: string;
};
export type VideoProjectSourceMap = Record<string, VideoProjectSourceMapEntry>;
export function compileVideoProjectDocument(
  input: VideoProjectDocument,
  sources: Record<string, string> = {},
  options: { sourceMap?: boolean } = {},
) {
  return compileParsedVideoProjectDocument(
    parseVideoProjectDocument(input),
    sources,
    options,
  );
}

/** @internal Only schema-parsed host transaction documents enter here. Never mutates its input. */
export function compileParsedVideoProjectDocument(
  document: VideoProjectDocument,
  sources: Record<string, string> = {},
  options: { sourceMap?: boolean } = {},
) {
  const {
    sources: _sources,
    evidence: _evidence,
    bindings: _bindings,
    creativeContext: _context,
    ...editorFields
  } = document;
  const native: EditorDocument = {
    ...editorFields,
    assets: { ...editorFields.assets },
    kind: "motionforge-editor",
  };
  const unresolved = new Set(
    Object.values(document.bindings)
      .filter((binding) => binding.status === "unresolved")
      .map((binding) => binding.itemId),
  );
  native.items = native.items.filter((item) => !unresolved.has(item.id));
  delete native.linkedGroups;
  if (native.transitions) {
    const visible = new Set(native.items.map((item) => item.id));
    const transitions = Object.fromEntries(
      Object.entries(native.transitions).filter(
        ([, transition]) =>
          visible.has(transition.fromItemId) &&
          visible.has(transition.toItemId),
      ),
    );
    if (Object.keys(transitions).length) native.transitions = transitions;
    else delete native.transitions;
  }
  // A visualizer can read the audio stream of a canonical video source without
  // inventing a second persisted/uploaded asset identity.
  const renderSources = { ...sources };
  const assetSourceMap: Record<string, string> = Object.fromEntries(
    Object.keys(document.assets).map((id) => [id, id]),
  );
  const aliases = new Map<string, string>();
  const aliasAudio = (input: SceneNodeInput): SceneNodeInput => {
    let node = input;
    const originalId =
      typeof node.params?.audioAssetId === "string"
        ? node.params.audioAssetId
        : undefined;
    const asset = originalId ? native.assets[originalId] : undefined;
    if (asset?.type === "video") {
      let alias = aliases.get(asset.id);
      if (!alias) {
        const prefix = `__video_audio:${asset.id.slice(0, 150)}`;
        alias = prefix;
        let suffix = 1;
        while (native.assets[alias]) alias = `${prefix}:${suffix++}`;
        aliases.set(asset.id, alias);
        native.assets[alias] = { ...asset, id: alias, type: "audio" };
        const src = sources[asset.id] ?? sources[asset.assetId ?? asset.id];
        if (src) renderSources[alias] = src;
        assetSourceMap[alias] = asset.id;
      }
      node = { ...node, params: { ...node.params, audioAssetId: alias } };
    }
    if (node.children) {
      const children = node.children.map(aliasAudio);
      if (children.some((child, index) => child !== node.children![index]))
        node = { ...node, children };
    }
    return node;
  };
  const nativeItemsById = new Map(native.items.map((item) => [item.id, item]));
  native.items = native.items.map((item) => {
    let node = item.node;
    if (item.visualizerSourceItemId) {
      const source = nativeItemsById.get(item.visualizerSourceItemId);
      if (source?.node.assetId)
        node = {
          ...node,
          params: { ...node.params, audioAssetId: source.node.assetId },
        };
    }
    node = aliasAudio(node);
    return node === item.node ? item : { ...item, node };
  });
  const compositionOrigins = new Map<string, CompositionNodeOrigin>();
  let scene: ReturnType<typeof compileParsedEditorDocument>;
  try {
    scene = compileParsedEditorDocument(native, renderSources, {
      onDerivedNode: (id, origin) => compositionOrigins.set(id, origin),
    });
  } catch (error) {
    if (error instanceof MissingEditorAssetsError)
      throw new MissingEditorAssetsError([
        ...new Set(error.assetIds.map((id) => assetSourceMap[id] ?? id)),
      ]);
    throw error;
  }
  const sourceMap: VideoProjectSourceMap = {};
  const compiledById = new Map(scene.nodes.map((node) => [node.id, node]));
  const itemsById = new Map(document.items.map((item) => [item.id, item]));
  const bindingsByItem = new Map(
    Object.values(document.bindings).map((binding) => [
      binding.itemId,
      binding,
    ]),
  );
  for (const item of native.items) {
    const compiled = compiledById.get(item.id);
    if (!compiled) continue;
    const binding = bindingsByItem.get(item.id);
    const sourceItem = itemsById.get(
      binding?.sourceItemId ??
        item.caption?.sourceItemId ??
        item.visualizerSourceItemId ??
        item.id,
    );
    const mediaSource =
      sourceItem && ["video", "audio"].includes(sourceItem.node.type)
        ? sourceItem
        : undefined;
    const clock = mediaSource
      ? sourceWindow(mediaSource, document.format.fps)
      : undefined;
    // Preserve source-clock validation even when a render-only caller does not
    // need node/evidence mappings. Scene and asset ownership remain identical.
    if (options.sourceMap === false) continue;
    const canonicalIds = new Set<string>();
    const collect = (node: SceneNodeInput) => {
      canonicalIds.add(node.id);
      node.children?.forEach(collect);
    };
    collect(item.node);
    const cues = new Map(item.caption?.cues.map((cue) => [cue.id, cue]));
    const cuePrefix = `${item.id}:cue:`;
    const cueForNode = (nodeId: string) => {
      if (!nodeId.startsWith(cuePrefix)) return undefined;
      let candidate = nodeId.slice(cuePrefix.length);
      for (;;) {
        const cue = cues.get(candidate);
        if (cue) return cue;
        const separator = candidate.lastIndexOf(":");
        if (separator < 0) return undefined;
        candidate = candidate.slice(0, separator);
      }
    };
    const visit = (
      node: SceneNodeInput,
      parentClock: number,
      parentStart: number,
      parentEnd: number,
      composition?: CompositionNodeOrigin,
    ) => {
      const nodeClock = parentClock + (node.from ?? 0);
      const from = Math.max(parentStart, nodeClock);
      const end = Math.min(
        parentEnd,
        nodeClock + (node.duration ?? item.node.duration!),
      );
      const cue = cueForNode(node.id);
      sourceMap[node.id] = {
        itemId: item.id,
        nodeId: canonicalIds.has(node.id) ? node.id : item.id,
        trackId: item.trackId,
        ...(cue ? { cueId: cue.id } : {}),
        derived: !canonicalIds.has(node.id),
        from,
        duration: Math.max(0, end - from),
        ...(clock && mediaSource && composition?.media !== false
          ? {
              sourceAssetId: mediaSource.node.assetId,
              sourceStartMs:
                clock.startMs +
                (((from - clock.from) * 1000) / document.format.fps) *
                  clock.rate,
              sourceEndMs:
                clock.startMs +
                (((end - clock.from) * 1000) / document.format.fps) *
                  clock.rate,
            }
          : {}),
        ...(binding && composition?.media !== false
          ? { bindingId: binding.id, evidenceId: binding.evidenceId }
          : {}),
        ...(composition ? { transitionId: composition.transitionId } : {}),
      };
      node.children?.forEach((child) => visit(child, nodeClock, from, end));
    };
    visit(compiled, 0, 0, document.format.durationInFrames);
    compositionOrigins.forEach((origin, id) => {
      if (origin.itemId === item.id) {
        const node = compiledById.get(id);
        if (node) visit(node, 0, 0, document.format.durationInFrames, origin);
      }
    });
  }
  return { scene, sourceMap, assetSourceMap };
}
