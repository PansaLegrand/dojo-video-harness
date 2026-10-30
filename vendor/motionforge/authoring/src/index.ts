import type {
  Scene,
  SceneAnimation,
  SceneAsset,
  SceneAudioBus,
  SceneDucking,
  SceneEffectName,
  SceneEffectParams,
  SceneExtensionDescriptor,
  SceneMaskDescriptor,
  SceneNode,
  SceneShapeGeometry,
  SceneStyle,
  SceneTextRun,
  VolumeEnvelope,
} from "@motionforge/schema";
import {
  audio,
  composition,
  div,
  effect,
  extension,
  img,
  lottie,
  richText,
  shape,
  text,
  video,
  type AudioNodeOptions,
  type EffectNodeOptions,
  type ExtensionNodeOptions,
  type LottieNodeOptions,
  type NodeOptions,
  type VideoNodeOptions,
} from "@motionforge/core";
import {
  audioFadeEnvelope,
  audioOverlay as presetAudioOverlay,
  imageOverlay as presetImageOverlay,
  parseSrt,
  parseVtt,
  safeAreaBox,
  styledCaptions as presetStyledCaptions,
  subtitleTrack as presetSubtitleTrack,
  videoOverlay as presetVideoOverlay,
  type CaptionWord,
  type AudioOverlayOptions as PresetAudioOverlayOptions,
  type ImageOverlayOptions as PresetImageOverlayOptions,
  type StyledCaptionOptions as PresetStyledCaptionOptions,
  type SafeAreaAnchor,
  type SafeAreaInput,
  type SubtitleSegment,
  type SubtitleTrackOptions as PresetSubtitleTrackOptions,
  type VideoOverlayOptions as PresetVideoOverlayOptions,
} from "@motionforge/presets";
export {
  audioFadeEnvelope,
  audioOverlayTemplates,
  fadeUp,
  imageOverlayTemplates,
  inferSafeAreaProfile,
  parseSrt,
  parseVtt,
  popIn,
  pulse,
  resolveSafeArea,
  safeAreaBox,
  safeAreaProfiles,
  slideIn,
  subtitleTemplates,
  videoOverlayTemplates,
} from "@motionforge/presets";
export type {
  CaptionRenderMode,
  CaptionTemplateKey,
  CaptionWord,
  AudioOverlayTemplateKey,
  ImageOverlayPlacement,
  ImageOverlayTemplateKey,
  SafeAreaAnchor,
  SafeAreaBox,
  SafeAreaBoxOptions,
  SafeAreaInput,
  SafeAreaInsets,
  SafeAreaProfileKey,
  SubtitleSegment,
  SubtitleTemplateKey,
  VideoOverlayPlacement,
  VideoOverlayTemplateKey,
} from "@motionforge/presets";

export type TimeValue = {
  unit: "frames" | "seconds";
  value: number;
};

export type SceneSize =
  | "portrait"
  | "landscape"
  | "square"
  | {
      width: number;
      height: number;
    };

export type AuthorNode = {
  assets?: readonly SceneAsset[];
  toNode(fps: number, scene: ResolvedSceneOptions): ReturnType<typeof div>;
};

export type MakeSceneOptions = {
  size: SceneSize;
  fps?: number;
  duration: TimeValue;
  assets?: Record<string, SceneAsset> | SceneAsset[];
  markers?: Record<string, TimeValue>;
  audioBuses?: Record<string, SceneAudioBus>;
  children?: AuthorNode[];
};

export type AuthorTimingOptions = {
  id?: string;
  at?: TimeValue;
  duration?: TimeValue;
};

export type VisualOptions = AuthorTimingOptions & {
  style?: SceneStyle;
  enter?: SceneAnimation[];
  clip?: SceneShapeGeometry;
  mask?: SceneMaskDescriptor;
};

export type BoxOptions = VisualOptions & {
  children?: AuthorNode[];
};

export type TextOptions = VisualOptions;

export type TextBoxPlacement = SafeAreaAnchor;
export type TextBoxSafeArea = SafeAreaInput;

export type TextBoxOptions = TextOptions & {
  placement?: TextBoxPlacement;
  safeArea?: TextBoxSafeArea;
  fit?: SceneStyle["textFit"];
  maxLines?: number;
  minFontSize?: number;
};

export type MediaOptions = VisualOptions & {
  objectFit?: SceneStyle["objectFit"];
  objectPosition?: SceneStyle["objectPosition"];
};

export type VideoClipOptions = MediaOptions & {
  trimStart?: TimeValue;
  playbackRate?: number;
  volume?: number;
  volumeEnvelope?: VolumeEnvelope;
  fadeIn?: TimeValue;
  fadeOut?: TimeValue;
  fadeInEasing?: string;
  fadeOutEasing?: string;
  audioBus?: string;
  pan?: number;
  ducks?: SceneDucking;
  endBehavior?: "hold" | "loop";
};

export type LottieClipOptions = MediaOptions & {
  playbackRate?: number;
};

export type EffectLayerOptions = VisualOptions & {
  params?: SceneEffectParams;
};

export type ExtensionLayerOptions = VisualOptions;
export type ShapeLayerOptions = VisualOptions;

export type AudioTrackOptions = AuthorTimingOptions & {
  trimStart?: TimeValue;
  volume?: number;
  volumeEnvelope?: VolumeEnvelope;
  loop?: boolean;
  fadeIn?: TimeValue;
  fadeOut?: TimeValue;
  fadeInEasing?: string;
  fadeOutEasing?: string;
  audioBus?: string;
  pan?: number;
  ducks?: SceneDucking;
};

export type AudioOverlayOptions = Omit<
  PresetAudioOverlayOptions,
  | "assetId"
  | "from"
  | "duration"
  | "trimStart"
  | "fadeInDuration"
  | "fadeOutDuration"
> &
  AuthorTimingOptions & {
    trimStart?: TimeValue;
    fadeIn?: TimeValue;
    fadeOut?: TimeValue;
  };

export type ImageOverlayOptions = Omit<
  PresetImageOverlayOptions,
  "assetId" | "from" | "duration" | "composition"
> &
  AuthorTimingOptions & {
    composition?: PresetImageOverlayOptions["composition"];
  };

export type VideoOverlayOptions = Omit<
  PresetVideoOverlayOptions,
  "assetId" | "from" | "duration" | "trimStart" | "composition"
> &
  AuthorTimingOptions & {
    trimStart?: TimeValue;
    composition?: PresetVideoOverlayOptions["composition"];
  };

export type SubtitleTrackOptions = Omit<
  PresetSubtitleTrackOptions,
  "fps" | "composition"
> & {
  composition?: PresetSubtitleTrackOptions["composition"];
};

export type CaptionTrackOptions = Omit<PresetStyledCaptionOptions, "fps">;

export type AuthorAsset<T extends SceneAsset["type"] = SceneAsset["type"]> =
  SceneAsset & {
    type: T;
  };

export type AuthorAssetOptions = Omit<SceneAsset, "id" | "type" | "src">;

export type AssetReference<T extends SceneAsset["type"]> =
  | string
  | AuthorAsset<T>;

type ResolvedSceneOptions = {
  width: number;
  height: number;
  durationFrames: number;
};

export function seconds(value: number): TimeValue {
  return { unit: "seconds", value };
}

export function frames(value: number): TimeValue {
  return { unit: "frames", value };
}

export function time(value: number, unit: "seconds" | "frames"): TimeValue {
  return { unit, value };
}

export function toFrames(value: TimeValue | undefined, fps: number): number {
  if (value === undefined) {
    return 0;
  }

  return value.unit === "seconds"
    ? Math.round(value.value * fps)
    : Math.round(value.value);
}

export function toSeconds(value: TimeValue | undefined, fps: number): number {
  if (value === undefined) {
    return 0;
  }

  return value.unit === "seconds" ? value.value : value.value / fps;
}

export function publicAsset(path: string): string {
  const trimmed = path.trim();

  if (trimmed === "") {
    throw new Error("publicAsset() requires a non-empty path.");
  }

  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed) || trimmed.startsWith("//")) {
    return trimmed;
  }

  const normalized = trimmed
    .replace(/\\/g, "/")
    .replace(/^\.\/+/, "")
    .replace(/^\/+/, "");
  const withoutPublic = normalized.startsWith("public/")
    ? normalized.slice("public/".length)
    : normalized;
  const segments = withoutPublic.split("/").filter(Boolean);

  if (segments.length === 0 || segments.includes("..")) {
    throw new Error(
      'publicAsset() paths must stay inside the project "public" directory.',
    );
  }

  return `/${segments.join("/")}`;
}

export function imageAsset(
  id: string,
  src: string,
  options: AuthorAssetOptions = {},
): AuthorAsset<"image"> {
  return makeAsset(id, "image", src, options);
}

export function videoAsset(
  id: string,
  src: string,
  options: AuthorAssetOptions = {},
): AuthorAsset<"video"> {
  return makeAsset(id, "video", src, options);
}

export function audioAsset(
  id: string,
  src: string,
  options: AuthorAssetOptions = {},
): AuthorAsset<"audio"> {
  return makeAsset(id, "audio", src, options);
}

export function fontAsset(
  id: string,
  src: string,
  options: AuthorAssetOptions = {},
): AuthorAsset<"font"> {
  return makeAsset(id, "font", src, options);
}

export function lottieAsset(
  id: string,
  src: string,
  options: AuthorAssetOptions = {},
): AuthorAsset<"lottie"> {
  return makeAsset(id, "lottie", src, options);
}

export function defineAssets(
  ...assets: SceneAsset[]
): Record<string, SceneAsset>;
export function defineAssets(
  assets: readonly SceneAsset[],
): Record<string, SceneAsset>;
export function defineAssets(
  ...assetsOrList: [readonly SceneAsset[]] | SceneAsset[]
): Record<string, SceneAsset> {
  const assets =
    assetsOrList.length === 1 && Array.isArray(assetsOrList[0])
      ? assetsOrList[0]
      : (assetsOrList as SceneAsset[]);

  return Object.fromEntries(assets.map((asset) => [asset.id, asset]));
}

export function makeScene(options: MakeSceneOptions): Scene {
  const fps = options.fps ?? 30;
  const size = resolveSceneSize(options.size);
  const durationFrames = Math.max(1, toFrames(options.duration, fps));
  const sceneOptions = { ...size, durationFrames };
  const builder = composition({
    width: size.width,
    height: size.height,
    fps,
    duration: durationFrames,
  });

  for (const asset of collectAuthorNodeAssets(options.children)) {
    builder.asset(asset);
  }

  for (const asset of normalizeAssets(options.assets)) {
    builder.asset(asset);
  }

  for (const [name, value] of Object.entries(options.markers ?? {})) {
    builder.marker(name, toFrames(value, fps));
  }

  for (const [name, bus] of Object.entries(options.audioBuses ?? {})) {
    builder.audioBus(name, bus);
  }

  builder.children(
    ...(options.children ?? []).map((child) => child.toNode(fps, sceneOptions)),
  );

  return builder.toJSON();
}

export function bg(color: string, options: Omit<BoxOptions, "style"> = {}) {
  return box({
    ...options,
    style: {
      backgroundColor: color,
      ...fullFrameStyle(),
    },
  });
}

export function box(options: BoxOptions = {}): AuthorNode {
  return {
    assets: collectAuthorNodeAssets(options.children),
    toNode(fps, scene) {
      const node = div({
        ...timedNodeOptions(options, fps),
        style: {
          ...defaultVisualStyle(scene),
          ...options.style,
        },
      });

      for (const animation of options.enter ?? []) {
        node.animate(animation);
      }

      if (options.children?.length) {
        node.children(
          ...options.children.map((child) => child.toNode(fps, scene)),
        );
      }

      return node;
    },
  };
}

export function title(value: string, options: TextOptions = {}): AuthorNode {
  return {
    toNode(fps, scene) {
      return textNode(value, {
        ...options,
        style: {
          ...centeredTextStyle(scene),
          top: Math.round(scene.height * 0.375),
          fontSize: Math.max(40, Math.round(scene.height * 0.046)),
          fontWeight: 900,
          ...options.style,
        },
      }).toNode(fps, scene);
    },
  };
}

export function textBlock(
  value: string,
  options: TextOptions = {},
): AuthorNode {
  return {
    toNode(fps, scene) {
      return textNode(value, {
        ...options,
        style: {
          ...centeredTextStyle(scene),
          top: Math.round(scene.height * 0.49),
          fontSize: Math.max(24, Math.round(scene.height * 0.022)),
          fontWeight: 700,
          lineHeight: 1.18,
          color: "rgba(255,255,255,0.82)",
          ...options.style,
        },
      }).toNode(fps, scene);
    },
  };
}

export function textBox(
  value: string,
  options: TextBoxOptions = {},
): AuthorNode {
  return {
    toNode(fps, scene) {
      return textNode(value, {
        ...options,
        style: {
          ...textBoxStyle(scene, options),
          ...options.style,
        },
      }).toNode(fps, scene);
    },
  };
}

export function textNode(value: string, options: TextOptions = {}): AuthorNode {
  return {
    toNode(fps) {
      const node = text(value, {
        ...timedNodeOptions(options, fps),
        style: options.style,
      });

      for (const animation of options.enter ?? []) {
        node.animate(animation);
      }

      return node;
    },
  };
}

export function richTextNode(
  runs: SceneTextRun[],
  options: TextOptions = {},
): AuthorNode {
  return {
    toNode(fps) {
      const node = richText(runs, {
        ...timedNodeOptions(options, fps),
        style: options.style,
      });
      for (const animation of options.enter ?? []) {
        node.animate(animation);
      }
      return node;
    },
  };
}

export function richTextBlock(
  runs: SceneTextRun[],
  options: TextOptions = {},
): AuthorNode {
  return {
    toNode(fps, scene) {
      return richTextNode(runs, {
        ...options,
        style: {
          ...centeredTextStyle(scene),
          top: Math.round(scene.height * 0.49),
          fontSize: Math.max(24, Math.round(scene.height * 0.022)),
          fontWeight: 700,
          lineHeight: 1.18,
          color: "rgba(255,255,255,0.82)",
          ...options.style,
        },
      }).toNode(fps, scene);
    },
  };
}

export function image(
  asset: AssetReference<"image">,
  options: MediaOptions = {},
): AuthorNode {
  return {
    assets: assetsFromReference(asset),
    toNode(fps, scene) {
      const node = img(assetIdFromReference(asset), {
        ...timedNodeOptions(options, fps),
        style: mediaStyle(scene, options),
      });

      for (const animation of options.enter ?? []) {
        node.animate(animation);
      }

      return node;
    },
  };
}

export function videoClip(
  asset: AssetReference<"video">,
  options: VideoClipOptions = {},
): AuthorNode {
  return {
    assets: assetsFromReference(asset),
    toNode(fps, scene) {
      const timing = timedNodeOptions(options, fps);
      const nodeOptions: VideoNodeOptions = {
        ...timing,
        style: mediaStyle(scene, options),
        videoStartTime: toSeconds(options.trimStart, fps),
        playbackRate: options.playbackRate,
        audioBus: options.audioBus,
        pan: options.pan,
        ducks: options.ducks,
        videoEndBehavior: options.endBehavior,
        volumeEnvelope:
          options.volumeEnvelope ??
          audioFadeEnvelope({
            duration: timing.duration,
            fadeInDuration: toOptionalFrames(options.fadeIn, fps),
            fadeOutDuration: toOptionalFrames(options.fadeOut, fps),
            fadeInEasing: options.fadeInEasing,
            fadeOutEasing: options.fadeOutEasing,
          }),
      };
      const node = video(assetIdFromReference(asset), {
        ...nodeOptions,
        volume: options.volume,
      });

      for (const animation of options.enter ?? []) {
        node.animate(animation);
      }

      return node;
    },
  };
}

export function lottieClip(
  asset: AssetReference<"lottie">,
  options: LottieClipOptions = {},
): AuthorNode {
  return {
    assets: assetsFromReference(asset),
    toNode(fps, scene) {
      const node = lottie(assetIdFromReference(asset), {
        ...timedNodeOptions(options, fps),
        playbackRate: options.playbackRate,
        style: mediaStyle(scene, options),
      });

      for (const animation of options.enter ?? []) {
        node.animate(animation);
      }

      return node;
    },
  };
}

export function effectLayer(
  name: SceneEffectName,
  options: EffectLayerOptions = {},
): AuthorNode {
  return {
    toNode(fps, scene) {
      const node = effect(name, {
        ...timedNodeOptions(options, fps),
        params: options.params,
        style: {
          ...defaultVisualStyle(scene),
          ...options.style,
        },
      });

      for (const animation of options.enter ?? []) {
        node.animate(animation);
      }

      return node;
    },
  };
}

export function extensionLayer(
  descriptor: SceneExtensionDescriptor,
  options: ExtensionLayerOptions = {},
): AuthorNode {
  return {
    toNode(fps, scene) {
      const node = extension({
        ...timedNodeOptions(options, fps),
        extension: descriptor,
        style: {
          ...defaultVisualStyle(scene),
          ...options.style,
        },
      });

      for (const animation of options.enter ?? []) {
        node.animate(animation);
      }

      return node;
    },
  };
}

export function shapeLayer(
  geometry: SceneShapeGeometry,
  options: ShapeLayerOptions = {},
): AuthorNode {
  return {
    toNode(fps, scene) {
      const node = shape(geometry, {
        ...timedNodeOptions(options, fps),
        style: {
          ...defaultVisualStyle(scene),
          ...options.style,
        },
      });

      for (const animation of options.enter ?? []) {
        node.animate(animation);
      }

      return node;
    },
  };
}

export function audioTrack(
  asset: AssetReference<"audio">,
  options: AudioTrackOptions = {},
): AuthorNode {
  return {
    assets: assetsFromReference(asset),
    toNode(fps) {
      const timing = timedNodeOptions(options, fps);
      const nodeOptions: AudioNodeOptions = {
        ...timing,
        audioStartTime: toSeconds(options.trimStart, fps),
        volume: options.volume,
        loop: options.loop,
        audioBus: options.audioBus,
        pan: options.pan,
        ducks: options.ducks,
        volumeEnvelope:
          options.volumeEnvelope ??
          audioFadeEnvelope({
            duration: timing.duration,
            fadeInDuration: toOptionalFrames(options.fadeIn, fps),
            fadeOutDuration: toOptionalFrames(options.fadeOut, fps),
            fadeInEasing: options.fadeInEasing,
            fadeOutEasing: options.fadeOutEasing,
          }),
      };

      return audio(assetIdFromReference(asset), nodeOptions);
    },
  };
}

export function audioOverlay(
  asset: AssetReference<"audio">,
  options: AudioOverlayOptions = {},
): AuthorNode {
  return {
    assets: assetsFromReference(asset),
    toNode(fps) {
      const { at, duration, trimStart, fadeIn, fadeOut, ...presetOptions } =
        options;

      return builderFromSceneNode(
        presetAudioOverlay({
          ...presetOptions,
          assetId: assetIdFromReference(asset),
          from: toFrames(at, fps),
          duration:
            duration === undefined ? undefined : toFrames(duration, fps),
          fadeInDuration: toOptionalFrames(fadeIn, fps),
          fadeOutDuration: toOptionalFrames(fadeOut, fps),
          ...(trimStart === undefined
            ? {}
            : { trimStart: toSeconds(trimStart, fps) }),
        }),
      );
    },
  };
}

export function imageOverlay(
  asset: AssetReference<"image">,
  options: ImageOverlayOptions = {},
): AuthorNode {
  return {
    assets: assetsFromReference(asset),
    toNode(fps, scene) {
      const {
        at,
        duration,
        composition: requestedComposition,
        ...presetOptions
      } = options;

      return builderFromSceneNode(
        presetImageOverlay({
          ...presetOptions,
          assetId: assetIdFromReference(asset),
          from: toFrames(at, fps),
          duration:
            duration === undefined ? undefined : toFrames(duration, fps),
          composition: requestedComposition ?? scene,
        }),
      );
    },
  };
}

export function videoOverlay(
  asset: AssetReference<"video">,
  options: VideoOverlayOptions = {},
): AuthorNode {
  return {
    assets: assetsFromReference(asset),
    toNode(fps, scene) {
      const {
        at,
        duration,
        trimStart,
        composition: requestedComposition,
        ...presetOptions
      } = options;

      return builderFromSceneNode(
        presetVideoOverlay({
          ...presetOptions,
          assetId: assetIdFromReference(asset),
          from: toFrames(at, fps),
          duration:
            duration === undefined ? undefined : toFrames(duration, fps),
          ...(trimStart === undefined
            ? {}
            : { trimStart: toSeconds(trimStart, fps) }),
          composition: requestedComposition ?? scene,
        }),
      );
    },
  };
}

export function subtitleTrack(
  segments: SubtitleSegment[],
  options: SubtitleTrackOptions = {},
): AuthorNode {
  return {
    toNode(fps, scene) {
      const { composition: requestedComposition, ...presetOptions } = options;

      return builderFromSceneNode(
        presetSubtitleTrack(segments, {
          ...presetOptions,
          fps,
          composition: requestedComposition ?? scene,
        }),
      );
    },
  };
}

export const subtitles = subtitleTrack;

export function captionTrack(
  words: CaptionWord[],
  options: CaptionTrackOptions = {},
): AuthorNode {
  return {
    toNode(fps) {
      return builderFromSceneNode(
        presetStyledCaptions(words, {
          ...options,
          fps,
        }),
      );
    },
  };
}

export const captions = captionTrack;

function makeAsset<T extends SceneAsset["type"]>(
  id: string,
  type: T,
  src: string,
  options: AuthorAssetOptions = {},
): AuthorAsset<T> {
  return { ...options, id, type, src } as AuthorAsset<T>;
}

function assetIdFromReference(asset: AssetReference<SceneAsset["type"]>) {
  return typeof asset === "string" ? asset : asset.id;
}

function assetsFromReference(
  asset: AssetReference<SceneAsset["type"]>,
): readonly SceneAsset[] {
  return typeof asset === "string" ? [] : [asset];
}

function builderFromSceneNode(node: SceneNode): ReturnType<typeof div> {
  const baseOptions = {
    id: node.id,
    from: node.from,
    duration: node.duration,
    style: node.style,
    clip: node.clip,
    mask: node.mask,
  };
  let builder: ReturnType<typeof div>;

  switch (node.type) {
    case "div":
      builder = div(baseOptions);
      break;
    case "text":
      builder = node.runs
        ? richText(node.runs, baseOptions)
        : text(node.text ?? "", baseOptions);
      break;
    case "img":
      builder = img(requiredAssetId(node), baseOptions);
      break;
    case "video":
      builder = video(requiredAssetId(node), {
        ...baseOptions,
        videoStartTime: node.videoStartTime,
        playbackRate: node.playbackRate,
        volume: node.volume,
        volumeEnvelope: node.volumeEnvelope,
        audioBus: node.audioBus,
        pan: node.pan,
        ducks: node.ducks,
        videoEndBehavior: node.videoEndBehavior,
      });
      break;
    case "audio":
      builder = audio(requiredAssetId(node), {
        id: node.id,
        from: node.from,
        duration: node.duration,
        audioStartTime: node.audioStartTime,
        volume: node.volume,
        volumeEnvelope: node.volumeEnvelope,
        loop: node.loop,
        audioBus: node.audioBus,
        pan: node.pan,
        ducks: node.ducks,
      });
      break;
    case "lottie":
      builder = lottie(requiredAssetId(node), {
        ...baseOptions,
        playbackRate: node.playbackRate,
      } as LottieNodeOptions);
      break;
    case "effect":
      builder = effect(requiredEffectName(node), {
        ...baseOptions,
        params: node.params,
      } as EffectNodeOptions);
      break;
    case "extension":
      builder = extension({
        ...baseOptions,
        extension: requiredExtensionDescriptor(node),
      } as ExtensionNodeOptions);
      break;
    case "shape":
      builder = shape(requiredShapeGeometry(node), baseOptions);
      break;
    default:
      throw new Error(
        `Unsupported scene node type: ${node.type satisfies never}`,
      );
  }

  for (const animation of node.animations ?? []) {
    builder.animate(animation);
  }

  if (node.children?.length) {
    builder.children(...node.children.map(builderFromSceneNode));
  }

  return builder;
}

function requiredAssetId(node: SceneNode): string {
  if (!node.assetId) {
    throw new Error(
      `Cannot author ${node.type} node "${node.id}" without assetId.`,
    );
  }

  return node.assetId;
}

function requiredEffectName(node: SceneNode): NonNullable<SceneNode["effect"]> {
  if (!node.effect) {
    throw new Error(`Effect node "${node.id}" is missing effect.`);
  }

  return node.effect;
}

function requiredExtensionDescriptor(
  node: SceneNode,
): SceneExtensionDescriptor {
  if (!node.extension) {
    throw new Error(`Extension node "${node.id}" is missing extension.`);
  }

  return node.extension;
}

function requiredShapeGeometry(node: SceneNode): SceneShapeGeometry {
  if (!node.shape) {
    throw new Error(`Shape node "${node.id}" is missing shape geometry.`);
  }

  return node.shape;
}

function collectAuthorNodeAssets(nodes: readonly AuthorNode[] = []) {
  return nodes.flatMap((node) => node.assets ?? []);
}

function timedNodeOptions(
  options: AuthorTimingOptions & {
    clip?: SceneShapeGeometry;
    mask?: SceneMaskDescriptor;
  },
  fps: number,
): Pick<NodeOptions, "id" | "from" | "duration" | "clip" | "mask"> {
  return {
    id: options.id,
    from: toFrames(options.at, fps),
    duration:
      options.duration === undefined
        ? undefined
        : toFrames(options.duration, fps),
    clip: options.clip,
    mask: options.mask,
  };
}

function toOptionalFrames(value: TimeValue | undefined, fps: number) {
  return value === undefined ? undefined : toFrames(value, fps);
}

function mediaStyle(scene: ResolvedSceneOptions, options: MediaOptions) {
  return {
    ...defaultVisualStyle(scene),
    objectFit: options.objectFit ?? "cover",
    objectPosition: options.objectPosition ?? "center center",
    ...options.style,
  };
}

function defaultVisualStyle(scene: ResolvedSceneOptions): SceneStyle {
  return {
    position: "absolute",
    left: 0,
    top: 0,
    width: scene.width,
    height: scene.height,
  };
}

function fullFrameStyle(): SceneStyle {
  return {
    position: "absolute",
    left: 0,
    top: 0,
    width: "100%",
    height: "100%",
  };
}

function centeredTextStyle(scene: ResolvedSceneOptions): SceneStyle {
  const inset = Math.round(scene.width * 0.067);

  return {
    position: "absolute",
    left: inset,
    right: inset,
    color: "#ffffff",
    textAlign: "center",
  };
}

type TextBoxPlacementDefaults = {
  box: Required<Pick<SceneStyle, "left" | "top" | "width" | "height">>;
  textAlign: NonNullable<SceneStyle["textAlign"]>;
  fontSize: number;
  fontWeight: NonNullable<SceneStyle["fontWeight"]>;
  lineHeight: NonNullable<SceneStyle["lineHeight"]>;
  maxLines: number;
};

function textBoxStyle(
  scene: ResolvedSceneOptions,
  options: TextBoxOptions,
): SceneStyle {
  const placement = options.placement ?? "center";
  const placementDefaults = textBoxPlacementDefaults(
    scene,
    placement,
    options.safeArea,
  );
  const fontSize = placementDefaults.fontSize;

  return {
    position: "absolute",
    color: "#ffffff",
    overflow: "hidden",
    textFit: options.fit ?? "shrink",
    textOverflow: "ellipsis",
    minFontSize:
      options.minFontSize ?? Math.max(14, Math.round(fontSize * 0.55)),
    maxLines: options.maxLines ?? placementDefaults.maxLines,
    ...placementDefaults.box,
    textAlign: placementDefaults.textAlign,
    fontSize,
    fontWeight: placementDefaults.fontWeight,
    lineHeight: placementDefaults.lineHeight,
  };
}

function textBoxPlacementDefaults(
  scene: ResolvedSceneOptions,
  placement: TextBoxPlacement,
  safeArea: TextBoxSafeArea | undefined,
): TextBoxPlacementDefaults {
  switch (placement) {
    case "title":
      return {
        box: safeAreaBox(scene, "title", { safeArea }),
        textAlign: "center",
        fontSize: Math.max(36, Math.round(scene.height * 0.052)),
        fontWeight: 900,
        lineHeight: 1.06,
        maxLines: 2,
      };
    case "subtitle":
      return {
        box: safeAreaBox(scene, "subtitle", { safeArea }),
        textAlign: "center",
        fontSize: Math.max(24, Math.round(scene.height * 0.028)),
        fontWeight: 700,
        lineHeight: 1.18,
        maxLines: 2,
      };
    case "lowerThird":
      return {
        box: safeAreaBox(scene, "lowerThird", { safeArea }),
        textAlign: "left",
        fontSize: Math.max(28, Math.round(scene.height * 0.036)),
        fontWeight: 800,
        lineHeight: 1.12,
        maxLines: 2,
      };
    case "statCallout":
      return {
        box: safeAreaBox(scene, "statCallout", { safeArea }),
        textAlign: "left",
        fontSize: Math.max(42, Math.round(scene.height * 0.06)),
        fontWeight: 900,
        lineHeight: 0.96,
        maxLines: 2,
      };
    case "top":
      return {
        box: safeAreaBox(scene, "top", { safeArea }),
        textAlign: "center",
        fontSize: Math.max(32, Math.round(scene.height * 0.04)),
        fontWeight: 800,
        lineHeight: 1.12,
        maxLines: 3,
      };
    case "bottom":
      return {
        box: safeAreaBox(scene, "bottom", { safeArea }),
        textAlign: "center",
        fontSize: Math.max(24, Math.round(scene.height * 0.03)),
        fontWeight: 700,
        lineHeight: 1.16,
        maxLines: 2,
      };
    case "center":
      return {
        box: safeAreaBox(scene, "center", { safeArea }),
        textAlign: "center",
        fontSize: Math.max(32, Math.round(scene.height * 0.044)),
        fontWeight: 800,
        lineHeight: 1.08,
        maxLines: 3,
      };
  }
}

function resolveSceneSize(size: SceneSize): { width: number; height: number } {
  if (typeof size === "object") {
    return size;
  }

  switch (size) {
    case "landscape":
      return { width: 1920, height: 1080 };
    case "square":
      return { width: 1080, height: 1080 };
    case "portrait":
      return { width: 1080, height: 1920 };
  }
}

function normalizeAssets(assets: MakeSceneOptions["assets"]): SceneAsset[] {
  if (!assets) {
    return [];
  }

  return Array.isArray(assets) ? assets : Object.values(assets);
}
