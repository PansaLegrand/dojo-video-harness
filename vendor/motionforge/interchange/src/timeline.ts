import { z } from "zod/v3";
import {
  sceneSchema,
  validateScene,
  type SceneAsset,
  type SceneNode,
  type SceneStyle,
} from "@motionforge/schema";
import {
  INTERCHANGE_VERSION,
  budgetsOf,
  caughtFailure,
  checkSceneBudgets,
  coordinateSchema,
  detachedJsonSchema,
  dimensionSchema,
  durationTickSchema,
  failure,
  framesToTicks,
  idSchema,
  interchangeDiagnosticSchema,
  interchangeFailureSchema,
  markerIdSchema,
  pushDiagnostic,
  rationalSchema,
  secondsToTicks,
  sizeSchema,
  tickSchema,
  ticksToFrames,
  ticksToSeconds,
  zodFailure,
  type InterchangeBudgets,
  type InterchangeDiagnostic,
  type InterchangeFailure,
  type Rational,
} from "./common";

const safeCssTokenSchema = z
  .string()
  .regex(
    /^(?![\s\S]*[;{}@])(?![\s\S]*(?:[uU][rR][lL]|[vV][aA][rR]|[cC][aA][lL][cC]|[eE][xX][pP][rR][eE][sS][sS][iI][oO][nN])\s*\()[\s\S]{1,256}$/,
    "CSS tokens cannot contain declarations, dynamic functions, URLs, variables, or at-rules.",
  );
const portableAssetUriSchema = z
  .string()
  .regex(
    /^(?!\s*(?:[jJ][aA][vV][aA][sS][cC][rR][iI][pP][tT]|[vV][bB][sS][cC][rR][iI][pP][tT])\s*:)[\s\S]{1,4096}$/,
    "Asset URI must be non-empty and cannot use an executable script scheme.",
  );

export const timelineBoxSchema = z
  .object({
    x: coordinateSchema,
    y: coordinateSchema,
    width: sizeSchema,
    height: sizeSchema,
  })
  .strict();

export const timelineTextStyleSchema = z
  .object({
    color: safeCssTokenSchema.optional(),
    backgroundColor: safeCssTokenSchema.optional(),
    fontFamily: safeCssTokenSchema.optional(),
    fontSize: z.number().finite().positive().max(4_096).optional(),
    fontWeight: z
      .union([
        z.number().finite().min(1).max(1_000),
        z.enum(["normal", "bold", "bolder", "lighter"]),
      ])
      .optional(),
    textAlign: z.enum(["left", "center", "right"]).optional(),
    direction: z.enum(["ltr", "rtl", "inherit"]).optional(),
  })
  .strict();

export const timelineAssetSchema = z
  .object({
    id: idSchema,
    kind: z.enum(["video", "audio", "image"]),
    uri: portableAssetUriSchema,
    durationTicks: durationTickSchema.optional(),
    width: dimensionSchema.optional(),
    height: dimensionSchema.optional(),
  })
  .strict();

const clipBase = {
  id: idSchema,
  startTick: tickSchema,
  durationTicks: durationTickSchema,
};

const videoClipSchema = z
  .object({
    ...clipBase,
    kind: z.literal("video"),
    assetId: idSchema,
    sourceStartTicks: tickSchema.optional(),
    box: timelineBoxSchema.optional(),
    opacity: z.number().finite().min(0).max(1).optional(),
    fit: z.enum(["contain", "cover", "fill", "none", "scale-down"]).optional(),
    volume: z.number().finite().min(0).max(1).optional(),
    pan: z.number().finite().min(-1).max(1).optional(),
  })
  .strict();

const audioClipSchema = z
  .object({
    ...clipBase,
    kind: z.literal("audio"),
    assetId: idSchema,
    sourceStartTicks: tickSchema.optional(),
    volume: z.number().finite().min(0).max(1).optional(),
    pan: z.number().finite().min(-1).max(1).optional(),
  })
  .strict();

const imageClipSchema = z
  .object({
    ...clipBase,
    kind: z.literal("image"),
    assetId: idSchema,
    box: timelineBoxSchema.optional(),
    opacity: z.number().finite().min(0).max(1).optional(),
    fit: z.enum(["contain", "cover", "fill", "none", "scale-down"]).optional(),
  })
  .strict();

const textClipSchema = z
  .object({
    ...clipBase,
    kind: z.literal("text"),
    text: z.string().max(100_000),
    box: timelineBoxSchema.optional(),
    opacity: z.number().finite().min(0).max(1).optional(),
    textStyle: timelineTextStyleSchema.optional(),
  })
  .strict();

export const timelineClipSchema = z.discriminatedUnion("kind", [
  videoClipSchema,
  audioClipSchema,
  imageClipSchema,
  textClipSchema,
]);

export const timelineTrackSchema = z
  .object({
    id: idSchema,
    kind: z.enum(["video", "audio", "overlay"]),
    clips: z.array(timelineClipSchema).max(2_048),
  })
  .strict();

export const timelineInterchangeV1Schema = z
  .object({
    interchangeVersion: z.literal(INTERCHANGE_VERSION),
    width: dimensionSchema,
    height: dimensionSchema,
    timebase: rationalSchema,
    durationTicks: durationTickSchema,
    assets: z.array(timelineAssetSchema).max(1_024),
    tracks: z.array(timelineTrackSchema).max(128),
    markers: z
      .array(
        z
          .object({
            id: markerIdSchema,
            tick: tickSchema,
            label: z.string().max(512).optional(),
          })
          .strict(),
      )
      .max(1_024)
      .optional(),
  })
  .strict();

export type TimelineInterchangeV1 = z.infer<typeof timelineInterchangeV1Schema>;
export type TimelineClip = z.infer<typeof timelineClipSchema>;

const timelineImportSuccessSchema = z
  .object({
    ok: z.literal(true),
    kind: z.literal("motionforge.timeline-import"),
    version: z.literal(INTERCHANGE_VERSION),
    scene: sceneSchema,
    diagnostics: z.array(interchangeDiagnosticSchema).max(8_192),
  })
  .strict();

const timelineExportSuccessSchema = z
  .object({
    ok: z.literal(true),
    kind: z.literal("motionforge.timeline-export"),
    version: z.literal(INTERCHANGE_VERSION),
    timeline: timelineInterchangeV1Schema,
    diagnostics: z.array(interchangeDiagnosticSchema).max(8_192),
  })
  .strict();

export type TimelineImportResult =
  | z.infer<typeof timelineImportSuccessSchema>
  | InterchangeFailure;
export type TimelineExportResult =
  | z.infer<typeof timelineExportSuccessSchema>
  | InterchangeFailure;

export function timelineInterchangeV1JsonSchema(): Record<string, unknown> {
  return detachedJsonSchema(timelineInterchangeV1Schema);
}

export function timelineImportResultJsonSchema(): Record<string, unknown> {
  return detachedJsonSchema(
    z.union([timelineImportSuccessSchema, interchangeFailureSchema]),
  );
}

export function timelineExportResultJsonSchema(): Record<string, unknown> {
  return detachedJsonSchema(
    z.union([timelineExportSuccessSchema, interchangeFailureSchema]),
  );
}

/** Import a strict, bounded flat timeline into canonical Scene v1. */
export function importTimelineV1(
  input: unknown,
  options: {
    sceneFps?: number;
    budgets?: Partial<InterchangeBudgets>;
  } = {},
): TimelineImportResult {
  try {
    const parsed = timelineInterchangeV1Schema.safeParse(input);
    if (!parsed.success) return zodFailure(parsed.error);
    const budgetResult = budgetsOf(options.budgets);
    if (!budgetResult.ok) return budgetResult;
    const budgets = budgetResult.budgets;
    const budgetFailure = checkTimelineBudgets(parsed.data, budgets);
    if (budgetFailure) return budgetFailure;
    const semanticFailure = checkTimelineSemantics(parsed.data);
    if (semanticFailure) return semanticFailure;

    const fps =
      options.sceneFps ??
      Math.max(
        1,
        Math.round(
          parsed.data.timebase.numerator / parsed.data.timebase.denominator,
        ),
      );
    if (!Number.isInteger(fps) || fps < 1 || fps > 1_000) {
      return failure(
        "invalid_input",
        ["sceneFps"],
        "sceneFps must be an integer in [1,1000].",
      );
    }

    const convertedSceneDuration = ticksToFrames(
      parsed.data.durationTicks,
      fps,
      parsed.data.timebase,
    );
    if (!convertedSceneDuration) {
      return failure(
        "budget_exceeded",
        ["durationTicks"],
        "Timeline duration exceeds the safe integer frame range.",
      );
    }
    const sceneDuration = Math.max(1, convertedSceneDuration.value);

    const diagnostics: InterchangeDiagnostic[] = [];
    const assets: Record<string, SceneAsset> = {};
    for (const [assetIndex, asset] of parsed.data.assets.entries()) {
      if (asset.durationTicks !== undefined) {
        const seconds = ticksToSeconds(
          asset.durationTicks,
          parsed.data.timebase,
        );
        if (!Number.isFinite(seconds) || seconds <= 0) {
          return failure(
            "invalid_input",
            ["assets", assetIndex, "durationTicks"],
            "Asset duration cannot be represented as finite seconds.",
          );
        }
      }
      assets[asset.id] = {
        id: asset.id,
        type: asset.kind,
        src: asset.uri,
        ...(asset.width || asset.height || asset.durationTicks
          ? {
              metadata: {
                ...(asset.width ? { width: asset.width } : {}),
                ...(asset.height ? { height: asset.height } : {}),
                ...(asset.durationTicks
                  ? {
                      duration: ticksToSeconds(
                        asset.durationTicks,
                        parsed.data.timebase,
                      ),
                    }
                  : {}),
              },
            }
          : {}),
      } as SceneAsset;
    }

    const nodes: SceneNode[] = [];
    let quantized = !convertedSceneDuration.exact;
    parsed.data.tracks.forEach((track, trackIndex) => {
      track.clips.forEach((clip, clipIndex) => {
        const start = ticksToFrames(clip.startTick, fps, parsed.data.timebase);
        const duration = ticksToFrames(
          clip.durationTicks,
          fps,
          parsed.data.timebase,
        );
        if (!start || !duration) {
          throw new Error(
            `Clip ${trackIndex}.${clipIndex} timing exceeds the safe frame range.`,
          );
        }
        quantized ||= !start.exact || !duration.exact;
        const style: SceneStyle = {
          ...(clip.kind !== "audio" && clip.box
            ? {
                position: "absolute",
                left: clip.box.x,
                top: clip.box.y,
                width: clip.box.width,
                height: clip.box.height,
              }
            : {}),
          ...(clip.kind !== "audio" && clip.opacity !== undefined
            ? { opacity: clip.opacity }
            : {}),
          ...((clip.kind === "video" || clip.kind === "image") && clip.fit
            ? { objectFit: clip.fit }
            : {}),
          ...(clip.kind === "text" && clip.textStyle ? clip.textStyle : {}),
        };
        const base = {
          id: clip.id,
          from: Math.min(sceneDuration - 1, start.value),
          duration: Math.max(
            1,
            Math.min(
              sceneDuration - Math.min(sceneDuration - 1, start.value),
              duration.value,
            ),
          ),
          ...(Object.keys(style).length ? { style } : {}),
        };
        if (clip.kind === "text") {
          nodes.push({ ...base, type: "text", text: clip.text });
        } else if (clip.kind === "image") {
          nodes.push({ ...base, type: "img", assetId: clip.assetId });
        } else if (clip.kind === "video") {
          nodes.push({
            ...base,
            type: "video",
            assetId: clip.assetId,
            ...(clip.sourceStartTicks === undefined
              ? {}
              : {
                  videoStartTime: ticksToSeconds(
                    clip.sourceStartTicks,
                    parsed.data.timebase,
                  ),
                }),
            ...(clip.volume === undefined ? {} : { volume: clip.volume }),
            ...(clip.pan === undefined ? {} : { pan: clip.pan }),
          });
        } else {
          nodes.push({
            id: base.id,
            from: base.from,
            duration: base.duration,
            type: "audio",
            assetId: clip.assetId,
            ...(clip.sourceStartTicks === undefined
              ? {}
              : {
                  audioStartTime: ticksToSeconds(
                    clip.sourceStartTicks,
                    parsed.data.timebase,
                  ),
                }),
            ...(clip.volume === undefined ? {} : { volume: clip.volume }),
            ...(clip.pan === undefined ? {} : { pan: clip.pan }),
          });
        }
      });
      if (track.clips.length) {
        pushDiagnostic(diagnostics, budgets, {
          severity: "info",
          code: "track_structure_flattened",
          path: ["tracks", trackIndex],
          message: `Track ${track.id} was flattened into Scene root order.`,
        });
      }
    });

    const markers: Record<string, number> = {};
    for (const [markerIndex, marker] of (parsed.data.markers ?? []).entries()) {
      const converted = ticksToFrames(marker.tick, fps, parsed.data.timebase);
      if (!converted) {
        return failure(
          "budget_exceeded",
          ["markers", markerIndex, "tick"],
          "Marker timing exceeds the safe integer frame range.",
        );
      }
      quantized ||= !converted.exact;
      markers[marker.id] = Math.min(
        Math.max(0, sceneDuration - 1),
        converted.value,
      );
      if (marker.label !== undefined) {
        pushDiagnostic(diagnostics, budgets, {
          severity: "warning",
          code: "marker_label_dropped",
          path: ["markers", markerIndex, "label"],
          message:
            "Scene v1 markers do not carry labels; id and timing were preserved.",
        });
      }
    }
    if (quantized) {
      pushDiagnostic(diagnostics, budgets, {
        severity: "warning",
        code: "timebase_quantized",
        path: ["timebase"],
        message:
          "Rational timeline ticks were quantized to integer Scene frames.",
      });
    }

    const validation = validateScene({
      schemaVersion: 1,
      width: parsed.data.width,
      height: parsed.data.height,
      fps,
      duration: sceneDuration,
      assets,
      nodes,
      ...(Object.keys(markers).length ? { markers } : {}),
    });
    if (!validation.ok) {
      return failure("invalid_input", ["scene"], validation.errors.join(" "));
    }
    return {
      ok: true,
      kind: "motionforge.timeline-import",
      version: 1,
      scene: validation.scene,
      diagnostics: structuredClone(diagnostics),
    };
  } catch (error) {
    return caughtFailure(error);
  }
}

/** Export supported Scene v1 media/text into a strict, flat timeline. */
export function exportTimelineV1(
  input: unknown,
  options: {
    timebase?: Rational;
    budgets?: Partial<InterchangeBudgets>;
  } = {},
): TimelineExportResult {
  try {
    const validation = validateScene(input);
    if (!validation.ok) {
      return failure("invalid_input", ["scene"], validation.errors.join(" "));
    }
    const scene = validation.scene;
    const budgetResult = budgetsOf(options.budgets);
    if (!budgetResult.ok) return budgetResult;
    const budgets = budgetResult.budgets;
    const sceneBudgetFailure = checkSceneBudgets(scene, budgets);
    if (sceneBudgetFailure) return sceneBudgetFailure;
    const timebaseResult = rationalSchema.safeParse(
      options.timebase ?? { numerator: scene.fps, denominator: 1 },
    );
    if (!timebaseResult.success) {
      return zodFailure(timebaseResult.error, ["timebase"]);
    }
    const timebase = timebaseResult.data;
    const diagnostics: InterchangeDiagnostic[] = [];
    const assets: TimelineInterchangeV1["assets"] = [];
    const supportedAssets = new Set<string>();
    const sceneDuration = framesToTicks(scene.duration, scene.fps, timebase);
    if (!sceneDuration) {
      return failure(
        "budget_exceeded",
        ["scene", "duration"],
        "Scene duration exceeds the safe integer tick range.",
      );
    }
    const durationTicks = Math.max(1, sceneDuration.value);
    let quantized = !sceneDuration.exact;

    for (const [assetKey, asset] of Object.entries(scene.assets)) {
      if (
        asset.type !== "video" &&
        asset.type !== "audio" &&
        asset.type !== "image"
      ) {
        pushDiagnostic(diagnostics, budgets, {
          severity: "warning",
          code: "unsupported_asset_dropped",
          path: ["scene", "assets", assetKey],
          message: `${asset.type} asset ${asset.id} is outside flat timeline v1 and was dropped.`,
        });
        continue;
      }
      const duration =
        asset.metadata?.duration === undefined
          ? undefined
          : secondsToTicks(asset.metadata.duration, timebase);
      if (asset.metadata?.duration !== undefined && !duration) {
        return failure(
          "budget_exceeded",
          ["scene", "assets", assetKey, "metadata", "duration"],
          "Asset duration exceeds the timeline tick range.",
        );
      }
      quantized ||= duration != null && !duration.exact;
      assets.push({
        id: asset.id,
        kind: asset.type,
        uri: asset.src,
        ...(duration ? { durationTicks: Math.max(1, duration.value) } : {}),
        ...(asset.metadata?.width ? { width: asset.metadata.width } : {}),
        ...(asset.metadata?.height ? { height: asset.metadata.height } : {}),
      });
      supportedAssets.add(asset.id);
      const extendedMetadata = Object.keys(asset.metadata ?? {}).filter(
        (key) => !["duration", "width", "height"].includes(key),
      );
      if (asset.sourceMode || asset.proxy || extendedMetadata.length) {
        pushDiagnostic(diagnostics, budgets, {
          severity: "warning",
          code: "asset_metadata_reduced",
          path: ["scene", "assets", assetKey],
          message:
            "Source mode, proxy, or extended asset metadata is outside flat timeline v1 and was omitted.",
        });
      }
    }

    const videoClips: TimelineClip[] = [];
    const audioClips: TimelineClip[] = [];
    const overlayClips: TimelineClip[] = [];
    type WorkItem = {
      node: SceneNode;
      path: Array<string | number>;
      parentOrigin: number;
      parentActiveStart: number;
      parentActiveEnd: number;
      offsetX: number;
      offsetY: number;
      nested: boolean;
    };
    const work: WorkItem[] = [];
    for (let index = scene.nodes.length - 1; index >= 0; index -= 1) {
      const node = scene.nodes[index];
      if (node) {
        work.push({
          node,
          path: ["scene", "nodes", index],
          parentOrigin: 0,
          parentActiveStart: 0,
          parentActiveEnd: scene.duration,
          offsetX: 0,
          offsetY: 0,
          nested: false,
        });
      }
    }

    while (work.length) {
      const item = work.pop()!;
      const { node } = item;
      const origin = item.parentOrigin + (node.from ?? 0);
      const ownEnd =
        node.duration === undefined
          ? item.parentActiveEnd
          : origin + node.duration;
      const activeStart = Math.max(0, item.parentActiveStart, origin);
      const activeEnd = Math.min(scene.duration, item.parentActiveEnd, ownEnd);
      const x = item.offsetX + (numericStyle(node.style?.left) ?? 0);
      const y = item.offsetY + (numericStyle(node.style?.top) ?? 0);
      const children = node.children ?? [];
      for (let index = children.length - 1; index >= 0; index -= 1) {
        const child = children[index];
        if (child) {
          work.push({
            node: child,
            path: [...item.path, "children", index],
            parentOrigin: origin,
            parentActiveStart: activeStart,
            parentActiveEnd: activeEnd,
            offsetX: x,
            offsetY: y,
            nested: true,
          });
        }
      }
      if (item.nested) {
        pushDiagnostic(diagnostics, budgets, {
          severity: "info",
          code: "hierarchy_flattened",
          path: item.path,
          message: `Nested node ${node.id} was flattened to an absolute timeline clip.`,
        });
      }
      if (activeEnd <= activeStart) {
        pushDiagnostic(diagnostics, budgets, {
          severity: "warning",
          code: "unsupported_node_dropped",
          path: item.path,
          message: `Node ${node.id} has no active frames after clipping and was dropped.`,
        });
        continue;
      }
      if (!["video", "audio", "img", "text"].includes(node.type)) {
        pushDiagnostic(diagnostics, budgets, {
          severity: "warning",
          code: "unsupported_node_dropped",
          path: item.path,
          message: `${node.type} node ${node.id} is outside flat timeline v1; supported children were still visited.`,
        });
        continue;
      }
      if (
        node.type !== "text" &&
        (!node.assetId || !supportedAssets.has(node.assetId))
      ) {
        pushDiagnostic(diagnostics, budgets, {
          severity: "warning",
          code: "unsupported_node_dropped",
          path: item.path,
          message: `Node ${node.id} references an unavailable or unsupported asset and was dropped.`,
        });
        continue;
      }

      const startTick = framesToTicks(activeStart, scene.fps, timebase);
      const durationTick = framesToTicks(
        activeEnd - activeStart,
        scene.fps,
        timebase,
      );
      if (!startTick || !durationTick) {
        return failure(
          "budget_exceeded",
          item.path,
          "Node timing exceeds the safe integer tick range.",
        );
      }
      quantized ||= !startTick.exact || !durationTick.exact;
      const common = {
        id: node.id,
        startTick: Math.min(durationTicks - 1, startTick.value),
        durationTicks: Math.max(
          1,
          Math.min(
            durationTicks - Math.min(durationTicks - 1, startTick.value),
            durationTick.value,
          ),
        ),
      };
      const box = extractTimelineBox(node.style, x, y);
      const opacity = node.style?.opacity;
      const clippedSourceSeconds =
        Math.max(0, activeStart - origin) / scene.fps;

      if (node.type === "video") {
        const source = secondsToTicks(
          (node.videoStartTime ?? 0) + clippedSourceSeconds,
          timebase,
        );
        if (!source) {
          return failure(
            "budget_exceeded",
            item.path,
            "Video source offset exceeds the timeline tick range.",
          );
        }
        quantized ||= !source.exact;
        videoClips.push({
          ...common,
          kind: "video",
          assetId: node.assetId!,
          ...(source.value ? { sourceStartTicks: source.value } : {}),
          ...(box ? { box } : {}),
          ...(opacity === undefined ? {} : { opacity }),
          ...(node.style?.objectFit ? { fit: node.style.objectFit } : {}),
          ...(node.volume === undefined ? {} : { volume: node.volume }),
          ...(node.pan === undefined ? {} : { pan: node.pan }),
        });
      } else if (node.type === "audio") {
        const source = secondsToTicks(
          (node.audioStartTime ?? 0) + clippedSourceSeconds,
          timebase,
        );
        if (!source) {
          return failure(
            "budget_exceeded",
            item.path,
            "Audio source offset exceeds the timeline tick range.",
          );
        }
        quantized ||= !source.exact;
        audioClips.push({
          ...common,
          kind: "audio",
          assetId: node.assetId!,
          ...(source.value ? { sourceStartTicks: source.value } : {}),
          ...(node.volume === undefined ? {} : { volume: node.volume }),
          ...(node.pan === undefined ? {} : { pan: node.pan }),
        });
      } else if (node.type === "img") {
        overlayClips.push({
          ...common,
          kind: "image",
          assetId: node.assetId!,
          ...(box ? { box } : {}),
          ...(opacity === undefined ? {} : { opacity }),
          ...(node.style?.objectFit ? { fit: node.style.objectFit } : {}),
        });
      } else {
        const text =
          node.text ?? node.runs?.map((run) => run.text).join("") ?? "";
        const textStyle = extractTimelineTextStyle(node.style);
        overlayClips.push({
          ...common,
          kind: "text",
          text,
          ...(box ? { box } : {}),
          ...(opacity === undefined ? {} : { opacity }),
          ...(textStyle ? { textStyle } : {}),
        });
        if (node.runs) {
          pushDiagnostic(diagnostics, budgets, {
            severity: "warning",
            code: "style_reduced",
            path: [...item.path, "runs"],
            message: "Inline text-run styles were flattened to plain text.",
          });
        }
      }
      reportNodeLosses(node, item.path, diagnostics, budgets);
    }

    if (scene.audioBuses && Object.keys(scene.audioBuses).length) {
      pushDiagnostic(diagnostics, budgets, {
        severity: "warning",
        code: "audio_mix_reduced",
        path: ["scene", "audioBuses"],
        message:
          "Scene audio buses are outside flat timeline v1 and were omitted.",
      });
    }
    const markers: NonNullable<TimelineInterchangeV1["markers"]> = [];
    for (const [markerId, frame] of Object.entries(scene.markers ?? {})) {
      const markerTick = framesToTicks(frame, scene.fps, timebase);
      if (!markerTick) {
        return failure(
          "budget_exceeded",
          ["scene", "markers", markerId],
          "Marker timing exceeds the safe integer tick range.",
        );
      }
      quantized ||= !markerTick.exact;
      markers.push({
        id: markerId,
        tick: Math.min(durationTicks - 1, markerTick.value),
      });
    }
    if (quantized) {
      pushDiagnostic(diagnostics, budgets, {
        severity: "warning",
        code: "timebase_quantized",
        path: ["timebase"],
        message:
          "Scene frames or source seconds were quantized to rational timeline ticks.",
      });
    }
    const tracks: TimelineInterchangeV1["tracks"] = [];
    if (videoClips.length) {
      tracks.push({ id: "video-1", kind: "video", clips: videoClips });
    }
    if (audioClips.length) {
      tracks.push({ id: "audio-1", kind: "audio", clips: audioClips });
    }
    if (overlayClips.length) {
      tracks.push({ id: "overlay-1", kind: "overlay", clips: overlayClips });
    }
    if (tracks.length) {
      pushDiagnostic(diagnostics, budgets, {
        severity: "info",
        code: "track_structure_flattened",
        path: ["scene", "nodes"],
        message:
          "Scene root order was grouped into video, audio, and overlay timeline tracks.",
      });
    }
    const timeline: TimelineInterchangeV1 = {
      interchangeVersion: 1,
      width: scene.width,
      height: scene.height,
      timebase,
      durationTicks,
      assets,
      tracks,
      ...(markers.length ? { markers } : {}),
    };
    const finalBudgetFailure = checkTimelineBudgets(timeline, budgets);
    if (finalBudgetFailure) return finalBudgetFailure;
    const finalSemanticFailure = checkTimelineSemantics(timeline);
    if (finalSemanticFailure) return finalSemanticFailure;
    const output = timelineInterchangeV1Schema.safeParse(timeline);
    if (!output.success) return zodFailure(output.error, ["timeline"]);
    return {
      ok: true,
      kind: "motionforge.timeline-export",
      version: 1,
      timeline: structuredClone(output.data),
      diagnostics: structuredClone(diagnostics),
    };
  } catch (error) {
    return caughtFailure(error);
  }
}

function reportNodeLosses(
  node: SceneNode,
  path: Array<string | number>,
  diagnostics: InterchangeDiagnostic[],
  budgets: InterchangeBudgets,
): void {
  const preserved = new Set([
    "position",
    "left",
    "top",
    "width",
    "height",
    "opacity",
    "objectFit",
    "color",
    "backgroundColor",
    "fontFamily",
    "fontSize",
    "fontWeight",
    "textAlign",
    "direction",
  ]);
  const lostKeys = Object.keys(node.style ?? {}).filter(
    (key) => !preserved.has(key),
  );
  const unresolvedBox =
    [
      node.style?.left,
      node.style?.top,
      node.style?.width,
      node.style?.height,
    ].some((value) => value !== undefined && typeof value !== "number") ||
    node.style?.right !== undefined ||
    node.style?.bottom !== undefined ||
    node.style?.inset !== undefined;
  if (lostKeys.length || unresolvedBox || node.clip || node.mask) {
    pushDiagnostic(diagnostics, budgets, {
      severity: "warning",
      code: "style_reduced",
      path: [...path, "style"],
      message:
        "Layout, paint, clipping, masking, or style fields outside the flat timeline subset were omitted.",
    });
  }
  if ((node.animations?.length ?? 0) > 0) {
    pushDiagnostic(diagnostics, budgets, {
      severity: "warning",
      code: "style_reduced",
      path: [...path, "animations"],
      message:
        "Per-frame Scene animations are outside flat timeline v1 and were omitted.",
    });
  }
  if (
    node.playbackRate !== undefined ||
    node.videoEndBehavior !== undefined ||
    node.loop !== undefined
  ) {
    pushDiagnostic(diagnostics, budgets, {
      severity: "warning",
      code: "playback_reduced",
      path,
      message:
        "Playback rate, looping, or end behavior is outside flat timeline v1 and was omitted.",
    });
  }
  if (node.volumeEnvelope || node.audioBus || node.ducks) {
    pushDiagnostic(diagnostics, budgets, {
      severity: "warning",
      code: "audio_mix_reduced",
      path,
      message:
        "Volume envelopes, buses, or ducking are outside flat timeline v1 and were omitted.",
    });
  }
}

function extractTimelineBox(
  style: SceneStyle | undefined,
  x: number,
  y: number,
): z.infer<typeof timelineBoxSchema> | undefined {
  const width = numericStyle(style?.width);
  const height = numericStyle(style?.height);
  if (
    width === undefined ||
    height === undefined ||
    width <= 0 ||
    height <= 0
  ) {
    return undefined;
  }
  const result = timelineBoxSchema.safeParse({ x, y, width, height });
  return result.success ? result.data : undefined;
}

function extractTimelineTextStyle(
  style: SceneStyle | undefined,
): z.infer<typeof timelineTextStyleSchema> | undefined {
  if (!style) return undefined;
  const candidate = {
    ...(style.color ? { color: style.color } : {}),
    ...(style.backgroundColor
      ? { backgroundColor: style.backgroundColor }
      : {}),
    ...(style.fontFamily ? { fontFamily: style.fontFamily } : {}),
    ...(typeof style.fontSize === "number" ? { fontSize: style.fontSize } : {}),
    ...(style.fontWeight !== undefined ? { fontWeight: style.fontWeight } : {}),
    ...(style.textAlign ? { textAlign: style.textAlign } : {}),
    ...(style.direction ? { direction: style.direction } : {}),
  };
  if (!Object.keys(candidate).length) return undefined;
  const parsed = timelineTextStyleSchema.safeParse(candidate);
  return parsed.success ? parsed.data : undefined;
}

function numericStyle(
  value: SceneStyle[keyof SceneStyle] | undefined,
): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function checkTimelineSemantics(
  timeline: TimelineInterchangeV1,
): InterchangeFailure | null {
  const assets = new Map<
    string,
    TimelineInterchangeV1["assets"][number]["kind"]
  >();
  for (const [index, asset] of timeline.assets.entries()) {
    if (assets.has(asset.id)) {
      return failure(
        "invalid_input",
        ["assets", index, "id"],
        `Duplicate asset id ${asset.id}.`,
      );
    }
    assets.set(asset.id, asset.kind);
  }
  const trackIds = new Set<string>();
  const clipIds = new Set<string>();
  for (const [trackIndex, track] of timeline.tracks.entries()) {
    if (trackIds.has(track.id)) {
      return failure(
        "invalid_input",
        ["tracks", trackIndex, "id"],
        `Duplicate track id ${track.id}.`,
      );
    }
    trackIds.add(track.id);
    for (const [clipIndex, clip] of track.clips.entries()) {
      const path = ["tracks", trackIndex, "clips", clipIndex] as Array<
        string | number
      >;
      if (clipIds.has(clip.id)) {
        return failure(
          "invalid_input",
          [...path, "id"],
          `Duplicate clip id ${clip.id}.`,
        );
      }
      clipIds.add(clip.id);
      if (clip.startTick + clip.durationTicks > timeline.durationTicks) {
        return failure(
          "invalid_input",
          path,
          `Clip ${clip.id} extends beyond the timeline duration.`,
        );
      }
      if (clip.kind !== "text") {
        const assetKind = assets.get(clip.assetId);
        if (!assetKind) {
          return failure(
            "invalid_input",
            [...path, "assetId"],
            `Clip ${clip.id} references missing asset ${clip.assetId}.`,
          );
        }
        if (assetKind !== clip.kind) {
          return failure(
            "invalid_input",
            [...path, "assetId"],
            `Clip ${clip.id} requires a ${clip.kind} asset, not ${assetKind}.`,
          );
        }
      }
    }
  }
  const markerIds = new Set<string>();
  for (const [index, marker] of (timeline.markers ?? []).entries()) {
    if (markerIds.has(marker.id)) {
      return failure(
        "invalid_input",
        ["markers", index, "id"],
        `Duplicate marker id ${marker.id}.`,
      );
    }
    markerIds.add(marker.id);
    if (marker.tick >= timeline.durationTicks) {
      return failure(
        "invalid_input",
        ["markers", index, "tick"],
        `Marker ${marker.id} must be inside the timeline duration.`,
      );
    }
  }
  return null;
}

function checkTimelineBudgets(
  timeline: TimelineInterchangeV1,
  budgets: InterchangeBudgets,
): InterchangeFailure | null {
  if (timeline.assets.length > budgets.maxAssets) {
    return failure(
      "budget_exceeded",
      ["assets"],
      `Asset count exceeds ${budgets.maxAssets}.`,
    );
  }
  if (timeline.tracks.length > budgets.maxTracks) {
    return failure(
      "budget_exceeded",
      ["tracks"],
      `Track count exceeds ${budgets.maxTracks}.`,
    );
  }
  const clips = timeline.tracks.reduce(
    (total, track) => total + track.clips.length,
    0,
  );
  if (clips > budgets.maxClips) {
    return failure(
      "budget_exceeded",
      ["tracks"],
      `Clip count exceeds ${budgets.maxClips}.`,
    );
  }
  if ((timeline.markers?.length ?? 0) > budgets.maxMarkers) {
    return failure(
      "budget_exceeded",
      ["markers"],
      `Marker count exceeds ${budgets.maxMarkers}.`,
    );
  }
  const characters = timeline.tracks.reduce(
    (total, track) =>
      total +
      track.clips.reduce(
        (subtotal, clip) =>
          subtotal + (clip.kind === "text" ? clip.text.length : 0),
        0,
      ),
    0,
  );
  if (characters > budgets.maxTextCharacters) {
    return failure(
      "budget_exceeded",
      ["tracks"],
      `Text character count exceeds ${budgets.maxTextCharacters}.`,
    );
  }
  const duration = ticksToSeconds(timeline.durationTicks, timeline.timebase);
  if (!Number.isFinite(duration) || duration > budgets.maxDurationSeconds) {
    return failure(
      "budget_exceeded",
      ["durationTicks"],
      `Timeline duration exceeds ${budgets.maxDurationSeconds} seconds.`,
    );
  }
  return null;
}
