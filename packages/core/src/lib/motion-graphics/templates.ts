import type {
  SceneAnimation,
  SceneNodeInput,
  SceneStyle,
} from "@dojo-video-engine/schema";
import {
  createEditorDocument,
  compileEditorDocument,
  type EditorAsset,
  type EditorDocument,
  type EditorItem,
} from "@/lib/editor/document";
import { getEditorFontAssets } from "@/lib/editor/fonts";
import type { EditorCommand } from "@/lib/editor/commands";
import {
  motionSettingsSchema,
  motionControlPatchSchema,
  motionTemplates,
  motionDimensions,
  defaultMotionSettings,
  type MotionSettings,
  type MotionTemplateId,
} from "./catalog";

export function motionTemplateOf(
  item: EditorItem | null | undefined,
): MotionTemplateId | null {
  return item?.motionGraphic?.version === 1 &&
    motionTemplates.some((entry) => entry.id === item.motionGraphic?.templateId)
    ? (item.motionGraphic!.templateId as MotionTemplateId)
    : null;
}
const walk = (node: SceneNodeInput): SceneNodeInput[] => [
  node,
  ...(node.children ?? []).flatMap(walk),
];
const role = (node: SceneNodeInput) =>
  node.id.slice(node.id.lastIndexOf(":") + 1);

/** Original native designs informed by flat-vector, Bauhaus and collage references.
 * Every visual is editable scene data; no external renderer or executable template. */
export function buildMotionGraphic(
  settingsInput: MotionSettings,
  format: EditorDocument["format"],
  id: string,
  trackId: string,
  from = 0,
  media?: EditorAsset,
): EditorItem {
  const s = motionSettingsSchema.parse(settingsInput),
    { width: w, height: h, fps } = format;
  if (media && media.type !== "image")
    throw new Error("Choose an image for this template.");
  const duration = Math.round(s.duration * fps),
    portrait = w / h < 1,
    u = Math.min(w, h),
    m = u * 0.075;
  const nodes: SceneNodeInput[] = [];
  const enter = (delay: number, distance = 36): SceneAnimation[] => {
    const start = Math.round(delay * fps),
      end = start + Math.max(1, Math.round(0.55 * fps));
    return [
      {
        kind: "keyframes",
        property: "opacity",
        frames: [
          { frame: start, value: 0 },
          { frame: end, value: 1, easing: "easeOut" },
        ],
      },
      {
        kind: "keyframes",
        property: "transform",
        frames: [
          {
            frame: start,
            value: `translate(0px, ${((distance * u) / 720) * s.intensity}px)`,
          },
          { frame: end, value: "translate(0px, 0px)", easing: "easeOut" },
        ],
      },
    ];
  };
  const box = (
    key: string,
    x: number,
    y: number,
    width: number,
    height: number,
    background: string,
    extra: SceneStyle = {},
    delay = 0,
  ) => {
    const node: SceneNodeInput = {
      id: `${id}:${key}`,
      type: "div",
      from: 0,
      duration,
      style: {
        position: "absolute",
        left: x,
        top: y,
        width,
        height,
        backgroundColor: background,
        ...extra,
      },
      animations: key === "background" ? [] : enter(delay),
    };
    if (extra.transform && extra.transform !== "none")
      node.animations
        ?.filter((animation) => animation.property === "transform")
        .forEach((animation) => {
          animation.frames = animation.frames.map((point) => ({
            ...point,
            value: `${extra.transform} ${point.value}`,
          }));
        });
    nodes.push(node);
    return node;
  };
  const text = (
    key: string,
    value: string,
    x: number,
    y: number,
    width: number,
    height: number,
    size: number,
    delay: number,
    extra: SceneStyle = {},
  ) => {
    nodes.push({
      id: `${id}:${key}`,
      type: "text",
      text: value || " ",
      from: 0,
      duration,
      style: {
        position: "absolute",
        left: x,
        top: y,
        width,
        height,
        fontFamily: "Inter",
        fontSize: size,
        fontWeight: 700,
        color: s.foreground,
        lineHeight: 1.05,
        textFit: "shrink",
        minFontSize: Math.max(8, u * 0.018),
        maxLines: key === "headline" ? 4 : 3,
        ...extra,
      },
      animations: enter(delay),
    });
  };
  box("background", 0, 0, w, h, s.background);
  if (s.template === "geometric-title") {
    const shapeX = portrait ? w * 0.52 : w * 0.68,
      shapeY = portrait ? h * 0.56 : h * 0.22,
      shapeSize = u * 0.34;
    box(
      "accent-disc",
      shapeX,
      shapeY,
      shapeSize,
      shapeSize,
      s.accent,
      { borderRadius: shapeSize },
      0.05,
    );
    box(
      "accent-block",
      shapeX - u * 0.13,
      shapeY + shapeSize * 0.6,
      shapeSize * 0.65,
      shapeSize * 0.65,
      s.foreground,
      {},
      0.18,
    );
    box(
      "accent-line",
      m,
      h - m * 1.3,
      w - 2 * m,
      Math.max(2, u * 0.006),
      s.accent,
      {},
      0.4,
    );
    text(
      "headline",
      s.headline,
      m,
      h * 0.2,
      portrait ? w - 2 * m : w * 0.56,
      h * 0.34,
      u * 0.13,
      0.1,
      { fontWeight: 800, letterSpacing: -u * 0.004 },
    );
    text(
      "subtitle",
      s.subtitle,
      m,
      portrait ? h * 0.48 : h * 0.67,
      portrait ? w * 0.7 : w * 0.53,
      h * 0.12,
      u * 0.033,
      0.3,
      { fontWeight: 400, lineHeight: 1.35 },
    );
    text("cta", s.cta, m, m, w - 2 * m, h * 0.07, u * 0.022, 0, {
      letterSpacing: u * 0.003,
    });
  } else {
    const collage = s.template === "editorial-collage";
    const x = portrait ? m : w * 0.56,
      y = portrait ? h * 0.48 : h * 0.15;
    const pw = portrait ? w - 2 * m : w * 0.36,
      ph = portrait ? h * 0.35 : h * 0.68;
    box(
      "accent-panel",
      x - u * 0.025,
      y + u * 0.025,
      pw + u * 0.05,
      ph + u * 0.025,
      s.accent,
      {
        transform: collage ? "rotate(-4deg)" : "none",
        borderRadius: collage ? 0 : u * 0.045,
      },
      0.1,
    );
    const frame = box(
      "media-frame",
      x,
      y,
      pw,
      ph,
      collage ? "#faf7ef" : "#29403c",
      { borderRadius: collage ? 0 : u * 0.03, overflow: "hidden" },
      0.15,
    );
    const pad = collage ? u * 0.018 : 0;
    frame.children = [
      media
        ? {
            id: `${id}:media`,
            type: "img",
            assetId: media.id,
            from: 0,
            duration,
            style: {
              position: "absolute",
              left: pad,
              top: pad,
              width: pw - 2 * pad,
              height: ph - 2 * pad,
              objectFit: "contain",
            },
          }
        : {
            id: `${id}:media`,
            type: "div",
            from: 0,
            duration,
            style: {
              position: "absolute",
              inset: pad,
              backgroundColor: collage ? "#d6cfc1" : "#29403c",
            },
            children: [
              {
                id: `${id}:placeholder-disc`,
                type: "div",
                from: 0,
                duration,
                style: {
                  position: "absolute",
                  left: "20%",
                  top: "18%",
                  width: "60%",
                  height: "60%",
                  borderRadius: 999,
                  backgroundColor: s.accent,
                },
              },
              {
                id: `${id}:placeholder-card`,
                type: "div",
                from: 0,
                duration,
                style: {
                  position: "absolute",
                  left: "30%",
                  top: "35%",
                  width: "40%",
                  height: "48%",
                  borderRadius: u * 0.015,
                  backgroundColor: s.background,
                  transform: "rotate(12deg)",
                },
              },
            ],
          },
    ];
    text("cta", s.cta, m, m, w - 2 * m, h * 0.07, u * 0.021, 0, {
      letterSpacing: u * 0.002,
    });
    text(
      "headline",
      s.headline,
      m,
      h * 0.19,
      portrait ? w - 2 * m : w * 0.44,
      portrait ? h * 0.21 : h * 0.4,
      u * (collage ? 0.105 : 0.095),
      0.15,
      { fontWeight: 800, letterSpacing: -u * 0.003 },
    );
    text(
      "subtitle",
      s.subtitle,
      m,
      portrait ? h * 0.4 : h * 0.64,
      portrait ? w - 2 * m : w * 0.41,
      portrait ? h * 0.07 : h * 0.14,
      u * 0.031,
      0.3,
      { fontWeight: 400, lineHeight: 1.3 },
    );
    box(
      "accent-footer",
      m,
      h - m,
      collage ? w * 0.32 : u * 0.13,
      Math.max(3, u * 0.012),
      s.accent,
      {},
      0.4,
    );
  }
  return {
    id,
    trackId,
    name: motionTemplates.find((entry) => entry.id === s.template)!.name,
    motionGraphic: {
      templateId: s.template,
      version: 1,
      intensity: s.intensity,
    },
    node: {
      id,
      type: "div",
      from,
      duration,
      style: {
        position: "absolute",
        left: 0,
        top: 0,
        width: w,
        height: h,
        overflow: "hidden",
      },
      children: nodes,
    },
  };
}

export function readMotionSettings(
  item: EditorItem,
  format: EditorDocument["format"],
): MotionSettings {
  const template = motionTemplateOf(item);
  if (!template) throw new Error("Select a motion graphics template.");
  const nodes = walk(item.node),
    find = (key: string) => nodes.find((node) => role(node) === key);
  return {
    template,
    headline: find("headline")?.text ?? "Title",
    subtitle: find("subtitle")?.text?.trim() ?? "",
    cta: find("cta")?.text?.trim() ?? "",
    background: String(find("background")?.style?.backgroundColor ?? "#111827"),
    foreground: String(find("headline")?.style?.color ?? "#ffffff"),
    accent: String(
      nodes.find((node) => role(node).startsWith("accent-"))?.style
        ?.backgroundColor ?? "#ff5a36",
    ),
    duration: item.node.duration! / format.fps,
    intensity: Number(item.motionGraphic?.intensity ?? 1),
    aspect:
      format.width / format.height > 1.2
        ? "16:9"
        : format.width / format.height < 0.9
          ? "9:16"
          : "1:1",
  };
}

/** Patch only requested bindings. Unrelated nested edits remain intact. */
export function updateMotionGraphic(
  item: EditorItem,
  format: EditorDocument["format"],
  patch: Partial<MotionSettings>,
  media?: EditorAsset | null,
): EditorItem {
  const previous = readMotionSettings(item, format);
  // A manually trimmed/resized group may lie outside the insertion defaults.
  // Validate only requested controls, preserving accepted native edits elsewhere.
  const s = { ...previous, ...motionControlPatchSchema.parse(patch) };
  const next = structuredClone(item),
    ratio = s.duration / previous.duration;
  const intensity = s.intensity / previous.intensity;
  const visit = (node: SceneNodeInput, root = false) => {
    const key = role(node);
    for (const field of ["headline", "subtitle", "cta"] as const)
      if (key === field && patch[field] !== undefined)
        node.text = s[field] || " ";
    if (node.style) {
      if (patch.background && ["background", "placeholder-card"].includes(key))
        node.style.backgroundColor = s.background;
      if (
        patch.foreground &&
        (node.type === "text" || key === "accent-block")
      ) {
        if (node.type === "text") node.style.color = s.foreground;
        else node.style.backgroundColor = s.foreground;
      }
      if (
        patch.accent &&
        ((key.startsWith("accent-") && key !== "accent-block") ||
          key === "placeholder-disc")
      )
        node.style.backgroundColor = s.accent;
    }
    if (patch.duration !== undefined) {
      if (!root && node.from !== undefined)
        node.from = Math.round(node.from * ratio);
      if (node.duration !== undefined)
        node.duration = Math.max(1, Math.round(node.duration * ratio));
    }
    node.animations?.forEach((animation) => {
      if (patch.duration !== undefined) {
        const frames = new Map(
          animation.frames.map((point) => [
            Math.round(point.frame * ratio),
            { ...point, frame: Math.round(point.frame * ratio) },
          ]),
        );
        animation.frames = [...frames.values()].sort(
          (a, b) => a.frame - b.frame,
        );
      }
      if (patch.intensity !== undefined && animation.property === "transform")
        animation.frames = animation.frames.map((point) => ({
          ...point,
          value: String(point.value).replace(
            /translate\((-?[\d.]+)px,\s*(-?[\d.]+)px\)/g,
            (_, x, y) =>
              `translate(${Number(x) * intensity}px, ${Number(y) * intensity}px)`,
          ),
        }));
    });
    node.children?.forEach((child) => visit(child));
  };
  visit(next.node, true);
  next.motionGraphic = {
    templateId: s.template,
    version: 1,
    intensity: s.intensity,
  };
  if (media !== undefined && s.template !== "geometric-title") {
    const fresh = buildMotionGraphic(
      {
        ...defaultMotionSettings(s.template),
        duration: Math.max(3, Math.min(20, s.duration)),
      },
      format,
      item.id,
      item.trackId,
      item.node.from,
      media ?? undefined,
    );
    const source = walk(fresh.node).find((node) => role(node) === "media")!;
    walk(source).forEach((node) => {
      node.duration = next.node.duration;
      if (node.style && role(node) === "placeholder-disc")
        node.style.backgroundColor = s.accent;
      if (node.style && role(node) === "placeholder-card")
        node.style.backgroundColor = s.background;
    });
    const frame = walk(next.node).find((node) => role(node) === "media-frame");
    if (frame)
      frame.children = [
        media && frame.children?.[0]?.type === "img"
          ? { ...frame.children[0], assetId: media.id }
          : source,
      ];
  }
  return next;
}

export function motionInsertCommands(
  document: EditorDocument,
  settings: MotionSettings,
  id: string,
  from = 0,
  media?: EditorAsset,
): EditorCommand[] {
  const trackId = `${id}:track`,
    item = buildMotionGraphic(
      settings,
      document.format,
      id,
      trackId,
      from,
      media,
    );
  const commands: EditorCommand[] = getEditorFontAssets("Inter")
    .filter((asset) => !document.assets[asset.id])
    .map((asset) => ({ type: "addAsset", asset }));
  if (media && !document.assets[media.id])
    commands.push({ type: "addAsset", asset: media });
  const end = from + item.node.duration!;
  if (end > document.format.durationInFrames)
    commands.push({ type: "updateFormat", patch: { durationInFrames: end } });
  commands.push(
    {
      type: "addTrack",
      track: {
        id: trackId,
        name: item.name,
        kind: "visual",
        hidden: false,
        muted: false,
        locked: false,
      },
    },
    { type: "addItem", item },
  );
  return commands;
}
export function motionDocument(
  settings: MotionSettings,
  media?: EditorAsset,
): EditorDocument {
  const format = {
    ...motionDimensions[settings.aspect],
    fps: 30,
    durationInFrames: Math.round(settings.duration * 30),
    backgroundColor: settings.background,
  };
  const document = createEditorDocument(format);
  for (const asset of getEditorFontAssets("Inter"))
    document.assets[asset.id] = asset;
  if (media) document.assets[media.id] = media;
  document.items = [
    buildMotionGraphic(
      settings,
      document.format,
      "motion-graphic",
      "visual",
      0,
      media,
    ),
  ];
  return document;
}
export function motionScene(
  settings: MotionSettings,
  media?: EditorAsset,
  url?: string,
) {
  return compileEditorDocument(
    motionDocument(settings, media),
    media && url ? { [media.id]: url } : {},
  );
}
