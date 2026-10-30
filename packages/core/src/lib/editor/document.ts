import {
  compileEditorCompositionNodes,
  type CompositionNodeOrigin,
} from "./composition-render";
import {
  editorTransitionsSchema,
  editorLinkedGroupsSchema,
} from "./composition-schema";
import { assertEditorComposition } from "./composition-validation";
import { motionTemplateIdSchema } from "@/lib/motion-graphics/catalog";
import { z } from "zod/v3";
import { bundledEditorFontMetadata } from "./fonts";
import { estimateCaptionWords } from "./caption-words";
import { isVideoAgentLottieLibraryAsset } from "@/lib/video-agent/lottie-library";
import {
  audioBusSchema,
  assetSchema,
  parseScene,
  sceneNodeSchema,
  textRunStyleSchema,
  type Scene,
  type SceneNodeInput,
  type SceneAsset,
  type SceneStyle,
  type SceneAnimation,
} from "@motionforge/schema";

/** Native authoring data. Runtime URLs and selection never enter persisted content. */
export const EDITOR_DOCUMENT_KIND = "motionforge-editor" as const;
export const EDITOR_DOCUMENT_VERSION = 1 as const;
const id = z.string().min(1).max(191);
const frame = z.number().int().min(0).max(2_592_000);
export const editorFormatSchema = z
  .object({
    width: z.number().int().min(64).max(4096),
    height: z.number().int().min(64).max(4096),
    fps: z.number().int().min(1).max(120),
    durationInFrames: frame.min(1),
    backgroundColor: z.string().max(100),
  })
  .strict();
export const editorAssetSchema = z
  .object({
    id,
    assetId: id.optional(),
    type: z.enum(["video", "audio", "image", "font", "lottie"]),
    name: z.string().max(500),
    source: z.enum(["project", "local", "static"]),
    src: z.string().max(2000).optional(),
    durationSeconds: z.number().finite().positive().optional(),
    width: z.number().int().positive().max(16384).optional(),
    height: z.number().int().positive().max(16384).optional(),
    mimeType: z.string().max(100).optional(),
    byteLength: z.number().int().positive().optional(),
    sourceMode: z.enum(["auto", "stream", "buffer"]).optional(),
    mediaMetadata: assetSchema.shape.metadata,
  })
  .strict()
  .superRefine((asset, ctx) => {
    if (asset.source === "static") {
      const catalogLottie =
        asset.src &&
        isVideoAgentLottieLibraryAsset({
          id: asset.id,
          type: asset.type,
          src: asset.src,
        });
      if (
        !catalogLottie &&
        (!asset.src ||
          !/^\/(?:fonts|lottie|assets)\//.test(asset.src) ||
          asset.src.includes("..") ||
          asset.src.includes("?"))
      ) {
        ctx.addIssue({
          code: "custom",
          message:
            "Static assets must reference a bundled font, Lottie or asset path.",
          path: ["src"],
        });
      }
    } else if (asset.src !== undefined) {
      ctx.addIssue({
        code: "custom",
        message: "Persist asset IDs, not temporary media URLs.",
        path: ["src"],
      });
    }
  });
export const editorTrackSchema = z
  .object({
    id,
    name: z.string().max(100),
    kind: z.enum(["visual", "audio"]),
    muted: z.boolean(),
    hidden: z.boolean(),
    locked: z.boolean(),
  })
  .strict();
const wordSchema = z
  .object({
    text: z.string().max(1000),
    startMs: z.number().finite().nonnegative(),
    endMs: z.number().finite().positive(),
  })
  .strict()
  .refine((w) => w.endMs > w.startMs, "Word end must follow its start.");
export const captionCueSchema = z
  .object({
    id,
    text: z.string().max(10000),
    startMs: z.number().finite().nonnegative(),
    endMs: z.number().finite().positive(),
    words: z.array(wordSchema).max(500).optional(),
  })
  .strict()
  .refine((c) => c.endMs > c.startMs, "Caption end must follow its start.");
export const editorCaptionSchema = z
  .object({
    cues: z.array(captionCueSchema).max(5000),
    mode: z.enum(["sentence", "word", "karaoke"]),
    highlightColor: z.string().max(100),
    direction: z.enum(["ltr", "rtl"]),
    sourceItemId: id.optional(),
    pairedItemId: id.optional(),
    highlightStyle: textRunStyleSchema.omit({ color: true }).optional(),
    motion: z.enum(["lyricPulse"]).optional(),
    language: z.string().max(64).optional(),
    role: z.enum(["original", "translation"]).optional(),
  })
  .strict()
  .superRefine((caption, ctx) => {
    if (caption.role !== "translation" && caption.mode !== "sentence")
      caption.cues.forEach((cue, index) => {
        if (
          (cue.words?.length ||
            estimateCaptionWords(
              cue.text,
              cue.startMs,
              cue.endMs,
              caption.language,
            ).length) > 125
        )
          ctx.addIssue({
            code: "custom",
            path: ["cues", index],
            message:
              "Split this caption into shorter cues before using word animation (maximum 125 words per cue).",
          });
      });
  });
export const editorItemSchema = z
  .object({
    id,
    trackId: id,
    name: z.string().max(500),
    node: sceneNodeSchema,
    motionGraphic: z
      .object({
        templateId: motionTemplateIdSchema,
        version: z.literal(1),
        intensity: z.number().finite().min(0.25).max(1.5),
      })
      .strict()
      .optional(),
    caption: editorCaptionSchema.optional(),
    visualizerSourceItemId: id.optional(),
  })
  .strict();
export const editorDocumentSchema = z
  .object({
    kind: z.literal(EDITOR_DOCUMENT_KIND),
    version: z.literal(EDITOR_DOCUMENT_VERSION),
    format: editorFormatSchema,
    assets: z.record(editorAssetSchema),
    tracks: z.array(editorTrackSchema).min(1).max(64),
    items: z.array(editorItemSchema).max(5000),
    metadata: z.record(z.unknown()),
    audioBuses: z.record(audioBusSchema).optional(),
    markers: z.record(frame).optional(),
    transitions: editorTransitionsSchema,
    linkedGroups: editorLinkedGroupsSchema,
  })
  .strict();
export type EditorDocument = z.infer<typeof editorDocumentSchema>;
export type EditorFormat = z.infer<typeof editorFormatSchema>;
export type EditorAsset = z.infer<typeof editorAssetSchema>;
export type EditorTrack = z.infer<typeof editorTrackSchema>;
export type EditorItem = z.infer<typeof editorItemSchema>;
export type CaptionCue = z.infer<typeof captionCueSchema>;
export type EditorCaption = z.infer<typeof editorCaptionSchema>;

/** Source-language word timing cannot drive a translated cue's word animation. */
export function editorCaptionDisplayMode(
  caption: Pick<EditorCaption, "mode" | "role">,
): EditorCaption["mode"] {
  return caption.role === "translation" ? "sentence" : caption.mode;
}

export function createEditorDocument(
  format: Partial<EditorFormat> = {},
): EditorDocument {
  return parseEditorDocument({
    kind: EDITOR_DOCUMENT_KIND,
    version: 1,
    format: {
      width: 1920,
      height: 1080,
      fps: 30,
      durationInFrames: 300,
      backgroundColor: "#111827",
      ...format,
    },
    assets: {},
    tracks: [
      {
        id: "visual",
        name: "Video & graphics",
        kind: "visual",
        muted: false,
        hidden: false,
        locked: false,
      },
      {
        id: "audio",
        name: "Audio",
        kind: "audio",
        muted: false,
        hidden: false,
        locked: false,
      },
    ],
    items: [],
    metadata: {},
  });
}

export function isEditorDocument(value: unknown): value is EditorDocument {
  return (
    !!value &&
    typeof value === "object" &&
    (value as { kind?: unknown }).kind === EDITOR_DOCUMENT_KIND
  );
}

function visitNodes(
  nodes: readonly SceneNodeInput[],
  visit: (node: SceneNodeInput) => void,
) {
  for (const node of nodes) {
    visit(node);
    visitNodes(node.children ?? [], visit);
  }
}

export function referencedEditorAssetIds(document: EditorDocument): string[] {
  const result = new Set<string>();
  visitNodes(
    document.items.map((i) => i.node),
    (node) => {
      if (node.assetId) result.add(node.assetId);
      for (const key of ["audioAssetId", "coverAssetId"] as const) {
        const value = node.params?.[key];
        if (typeof value === "string") result.add(value);
      }
    },
  );
  // Font declarations are implicit dependencies of text styles.
  for (const asset of Object.values(document.assets))
    if (asset.type === "font") result.add(asset.id);
  return [...result];
}

export function parseEditorDocument(input: unknown): EditorDocument {
  const document = editorDocumentSchema.parse(input);
  assertEditorDocumentStructure(document);
  return document;
}

/** Shared semantic checks after either native document schema has parsed its fields. */
export function assertEditorDocumentStructure(document: EditorDocument): void {
  if (JSON.stringify(document).length > 4_000_000)
    throw new Error("The editing document exceeds 4 MB.");
  const tracks = new Set(document.tracks.map((t) => t.id));
  if (tracks.size !== document.tracks.length)
    throw new Error("Track IDs must be unique.");
  const nodes = new Set<string>();
  const itemsById = new Map(document.items.map((item) => [item.id, item]));
  for (const item of document.items) {
    if (!tracks.has(item.trackId))
      throw new Error(`Track ${item.trackId} does not exist.`);
    if (item.node.id !== item.id)
      throw new Error("Item and native node IDs must match.");
    if (
      !Number.isInteger(item.node.from ?? 0) ||
      (item.node.from ?? 0) < 0 ||
      !Number.isInteger(item.node.duration) ||
      !item.node.duration ||
      item.node.duration < 1
    ) {
      throw new Error(
        "Every editing item requires a nonnegative start and positive frame duration.",
      );
    }
    if (
      (item.node.from ?? 0) + item.node.duration >
      document.format.durationInFrames
    )
      throw new Error("An item extends past the project duration.");
    if (
      item.caption &&
      (item.node.type !== "div" || (item.node.children?.length ?? 0) > 0)
    )
      throw new Error(
        "Caption children are derived from cues, not separately editable nodes.",
      );
    if (item.visualizerSourceItemId) {
      const source = itemsById.get(item.visualizerSourceItemId);
      if (
        item.node.type !== "effect" ||
        !source ||
        !["video", "audio"].includes(source.node.type)
      )
        throw new Error(
          "A linked visualizer requires an existing video or audio source clip.",
        );
      if (
        item.node.from !== source.node.from ||
        item.node.duration !== source.node.duration
      )
        throw new Error(
          "A linked visualizer must follow its source clip timing. Unlink it to edit timing independently.",
        );
    }
  }
  visitNodes(
    document.items.map((i) => i.node),
    (node) => {
      if (nodes.has(node.id)) throw new Error(`Duplicate node ID: ${node.id}`);
      nodes.add(node.id);
    },
  );
  for (const [key, asset] of Object.entries(document.assets))
    if (key !== asset.id) throw new Error("Asset key and ID must match.");
  for (const assetId of referencedEditorAssetIds(document))
    if (!document.assets[assetId])
      throw new Error(`Missing asset declaration: ${assetId}`);
  assertEditorComposition(document);
}

export class MissingEditorAssetsError extends Error {
  constructor(readonly assetIds: string[]) {
    super(
      `Media unavailable: ${assetIds.join(", ")}. Reload or relink these files before exporting.`,
    );
    this.name = "MissingEditorAssetsError";
  }
}

const captionContainerStyleKeys = new Set([
  "position",
  "left",
  "top",
  "right",
  "bottom",
  "inset",
  "width",
  "height",
  "minWidth",
  "maxWidth",
  "minHeight",
  "maxHeight",
  "aspectRatio",
  "transform",
  "transformOrigin",
  "opacity",
  "zIndex",
  "display",
  "overflow",
  "filter",
]);

function captionContainerStyle(style: SceneStyle = {}): SceneStyle {
  return Object.fromEntries(
    Object.entries(style).filter(([key]) => captionContainerStyleKeys.has(key)),
  ) as SceneStyle;
}

function isCaptionContainerAnimation(animation: SceneAnimation) {
  return (
    captionContainerStyleKeys.has(animation.property) ||
    animation.property.startsWith("mask.")
  );
}

function captionNodes(item: EditorItem, fps: number): SceneNodeInput[] {
  const caption = item.caption!;
  const mode = editorCaptionDisplayMode(caption);
  const duration = item.node.duration!;
  const result: SceneNodeInput[] = [];
  const paintStyle = Object.fromEntries(
    Object.entries(item.node.style ?? {}).filter(
      ([key]) => !captionContainerStyleKeys.has(key),
    ),
  );
  const textStyle: SceneStyle = {
    ...paintStyle,
    position: "absolute",
    left: 0,
    top: 0,
    width: "100%",
    height: "100%",
    direction: caption.direction,
  };
  const textAnimations = (item.node.animations ?? []).filter(
    (animation) => !isCaptionContainerAnimation(animation),
  );
  const append = (node: SceneNodeInput) => {
    if (!textAnimations.length) {
      result.push(node);
      return;
    }
    // The cue window clips visibility while the inner text keeps the caption
    // track's animation clock, including repeats and eased keyframes.
    const from = node.from ?? 0;
    result.push({
      id: `${node.id}:window`,
      type: "div",
      from,
      duration: node.duration,
      style: { position: "absolute", inset: 0 },
      children: [
        {
          ...node,
          from: -from,
          duration,
          animations: structuredClone(textAnimations),
        },
      ],
    });
  };
  for (const cue of caption.cues) {
    const start = Math.max(0, Math.round((cue.startMs * fps) / 1000));
    const end = Math.min(duration, Math.round((cue.endMs * fps) / 1000));
    if (end <= start) continue;
    const words =
      mode === "sentence"
        ? []
        : cue.words?.length
          ? cue.words
          : estimateCaptionWords(
              cue.text,
              cue.startMs,
              cue.endMs,
              caption.language,
            );
    if (mode === "sentence" || !words.length) {
      append({
        id: `${item.id}:cue:${cue.id}`,
        type: "text",
        text: cue.text,
        from: start,
        duration: end - start,
        style: structuredClone(textStyle),
      });
      continue;
    }
    // Each interval has identical text metrics; only the active word's paint changes.
    const quantizedWords = words.map((word) => ({
      start: Math.max(start, Math.round((word.startMs * fps) / 1000)),
      end: Math.min(end, Math.round((word.endMs * fps) / 1000)),
    }));
    const boundaries = [
      ...new Set([
        start,
        end,
        ...quantizedWords.flatMap((word) => [
          Math.min(end, word.start),
          Math.max(start, word.end),
        ]),
      ]),
    ].sort((a, b) => a - b);
    const cueNodeStart = result.length;
    const pulses: Array<{ start: number; end: number }> = [];
    let previousActive = -1;
    for (let index = 0; index + 1 < boundaries.length; index++) {
      const from = boundaries[index]!;
      const until = boundaries[index + 1]!;
      const active = quantizedWords.findIndex(
        (word) => word.start <= from && word.end > from,
      );
      if (active >= 0 && active !== previousActive)
        pulses.push({ start: from, end: quantizedWords[active]!.end });
      previousActive = active;
      append({
        id: `${item.id}:cue:${cue.id}:${index}`,
        type: "text",
        from,
        duration: until - from,
        ...(mode === "word"
          ? { text: active >= 0 ? words[active]!.text : "" }
          : { runs: captionRuns(cue.text, words, active, caption) }),
        style: structuredClone(textStyle),
      });
    }
    if (caption.motion === "lyricPulse") {
      // Animate a shared phrase wrapper, not font metrics or individual runs.
      // All highlight intervals share one clock, including overlaps and gaps.
      const frames: SceneAnimation["frames"] = [
        { frame: 0, value: "translate(0px, 0px) scale(1)" },
      ];
      const fontSize =
        typeof textStyle.fontSize === "number"
          ? textStyle.fontSize
          : typeof textStyle.fontSize === "string" &&
              textStyle.fontSize.endsWith("px")
            ? Number.parseFloat(textStyle.fontSize)
            : 64;
      const lift = Math.min(8, Math.max(1, fontSize * 0.06));
      for (const [index, pulse] of pulses.entries()) {
        const settle = Math.min(
          pulse.end - 1,
          (pulses[index + 1]?.start ?? end) - 1,
          pulse.start + Math.max(2, Math.round(fps * 0.24)),
        );
        if (settle - pulse.start < 2) continue;
        const peak =
          pulse.start +
          Math.min(
            settle - pulse.start - 1,
            Math.max(1, Math.round(fps * 0.07)),
          );
        if (frames.at(-1)!.frame < pulse.start - start)
          frames.push({
            frame: pulse.start - start,
            value: "translate(0px, 0px) scale(1)",
          });
        frames.push(
          {
            frame: peak - start,
            value: `translate(0px, -${lift}px) scale(1.035)`,
            easing: "easeOut",
          },
          {
            frame: settle - start,
            value: "translate(0px, 0px) scale(1)",
            easing: "easeInOut",
          },
        );
      }
      if (frames.length > 1)
        result.push({
          id: `${item.id}:cue:${cue.id}:motion`,
          type: "div",
          from: start,
          duration: end - start,
          style: { position: "absolute", inset: 0, transformOrigin: "50% 50%" },
          animations: [{ kind: "keyframes", property: "transform", frames }],
          children: result
            .splice(cueNodeStart)
            .map((node) => ({ ...node, from: (node.from ?? 0) - start })),
        });
    }
  }
  return result;
}

function captionRuns(
  text: string,
  words: Array<{ text: string }>,
  active: number,
  caption: EditorCaption,
) {
  const runs: Array<{
    text: string;
    style?: z.infer<typeof textRunStyleSchema>;
  }> = [];
  let cursor = 0;
  for (const [index, word] of words.entries()) {
    const at = text.indexOf(word.text, cursor);
    if (at < 0) continue;
    if (at > cursor) runs.push({ text: text.slice(cursor, at) });
    if (word.text)
      runs.push({
        text: word.text,
        ...(index === active
          ? {
              style: {
                ...caption.highlightStyle,
                color: caption.highlightColor,
              },
            }
          : {}),
      });
    cursor = at + word.text.length;
  }
  if (cursor < text.length) runs.push({ text: text.slice(cursor) });
  return runs.length ? runs : [{ text: text || " " }];
}

function muteNode(node: SceneNodeInput): SceneNodeInput {
  return {
    ...node,
    ...(["video", "audio"].includes(node.type) ? { volume: 0 } : {}),
    children: node.children?.map(muteNode),
  };
}

export function compileEditorDocument(
  input: EditorDocument,
  sources: Record<string, string>,
): Scene {
  const document = parseEditorDocument(input);
  return compileParsedEditorDocument(document, sources);
}

/** @internal The caller owns a schema-parsed document; aliases still undergo structural and Scene validation. */
export function compileParsedEditorDocument(
  document: EditorDocument,
  sources: Record<string, string>,
  options: {
    onDerivedNode?: (id: string, origin: CompositionNodeOrigin) => void;
  } = {},
): Scene {
  assertEditorDocumentStructure(document);
  const missing: string[] = [];
  const assets: Record<string, SceneAsset> = {};
  for (const assetId of referencedEditorAssetIds(document)) {
    const asset = document.assets[assetId]!;
    const src =
      asset.source === "static"
        ? asset.src
        : (sources[asset.id] ?? sources[asset.assetId ?? asset.id]);
    if (!src) {
      missing.push(asset.id);
      continue;
    }
    assets[asset.id] = {
      id: asset.id,
      type: asset.type,
      src,
      sourceMode: asset.sourceMode,
      metadata: {
        ...(asset.type === "font" ? bundledEditorFontMetadata(asset.src) : {}),
        ...asset.mediaMetadata,
        ...(asset.byteLength !== undefined
          ? { byteLength: asset.byteLength }
          : {}),
        ...(asset.width ? { width: asset.width } : {}),
        ...(asset.height ? { height: asset.height } : {}),
      },
    };
  }
  if (missing.length) throw new MissingEditorAssetsError(missing);
  let backgroundId = "__editor_background";
  const existingIds = new Set<string>();
  visitNodes(
    document.items.map((i) => i.node),
    (n) => existingIds.add(n.id),
  );
  while (existingIds.has(backgroundId)) backgroundId += "_";
  const nodes: SceneNodeInput[] = [
    {
      id: backgroundId,
      type: "div",
      duration: document.format.durationInFrames,
      style: {
        position: "absolute",
        inset: 0,
        backgroundColor: document.format.backgroundColor,
      },
    },
  ];
  const itemsById = new Map(document.items.map((item) => [item.id, item]));
  const trackItems = new Map<string, EditorItem[]>();
  for (const item of document.items) {
    const items = trackItems.get(item.trackId) ?? [];
    items.push(item);
    trackItems.set(item.trackId, items);
  }
  for (const track of document.tracks) {
    if (track.hidden) continue;
    for (const item of trackItems.get(track.id) ?? []) {
      const node = {
        ...item.node,
        ...(item.caption
          ? {
              style: captionContainerStyle(item.node.style),
              animations: item.node.animations?.filter(
                isCaptionContainerAnimation,
              ),
              children: captionNodes(item, document.format.fps),
            }
          : {}),
      };
      if (item.visualizerSourceItemId) {
        const source = itemsById.get(item.visualizerSourceItemId)!.node;
        node.params = {
          ...node.params,
          audioStartTime:
            source.type === "video"
              ? (source.videoStartTime ?? 0)
              : (source.audioStartTime ?? 0),
          audioPlaybackRate:
            source.type === "video" ? (source.playbackRate ?? 1) : 1,
        };
      }
      nodes.push(track.muted ? muteNode(node) : node);
    }
  }
  const composition = compileEditorCompositionNodes(document, nodes);
  composition.origins.forEach((origin, id) =>
    options.onDerivedNode?.(id, origin),
  );
  return parseScene({
    schemaVersion: 1,
    width: document.format.width,
    height: document.format.height,
    fps: document.format.fps,
    duration: document.format.durationInFrames,
    assets,
    nodes: composition.nodes,
    audioBuses: document.audioBuses,
    markers: document.markers,
  });
}

/** Import a newly produced native Scene, never an old editor composition. */
export function createEditorDocumentFromScene(
  scene: Scene,
  bindings: Record<string, { assetId: string; name?: string }>,
  metadata: Record<string, unknown> = {},
): EditorDocument {
  const document = createEditorDocument({
    width: scene.width,
    height: scene.height,
    fps: scene.fps,
    durationInFrames: scene.duration,
    backgroundColor: "#000000",
  });
  for (const asset of Object.values(scene.assets)) {
    const binding = bindings[asset.id];
    if (!binding && asset.type === "font" && asset.src.startsWith("/fonts/")) {
      document.assets[asset.id] = {
        id: asset.id,
        name: asset.id,
        type: "font",
        source: "static",
        src: asset.src,
      };
      continue;
    }
    if (!binding) throw new Error(`Missing owned asset binding: ${asset.id}`);
    document.assets[asset.id] = {
      id: asset.id,
      assetId: binding.assetId,
      name: binding.name ?? asset.id,
      type: asset.type,
      source: "project",
      sourceMode: asset.sourceMode,
      mediaMetadata: asset.metadata,
    };
  }
  document.items = scene.nodes.map((node) => ({
    id: node.id,
    trackId: node.type === "audio" ? "audio" : "visual",
    name: node.text ?? node.id,
    node: {
      ...node,
      from: node.from ?? 0,
      duration: node.duration ?? Math.max(1, scene.duration - (node.from ?? 0)),
    },
  }));
  document.metadata = metadata;
  document.audioBuses = scene.audioBuses;
  document.markers = scene.markers;
  return parseEditorDocument(document);
}
