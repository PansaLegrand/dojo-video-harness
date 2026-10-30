import { z } from "zod/v3";
import { zodToJsonSchema } from "zod-to-json-schema";
import {
  styleSchema,
  type SceneNodeInput,
  type SceneStyle,
} from "@motionforge/schema";
import {
  editorMediaFilters,
  editorTextStyles,
  editorTextStylePatch,
  updateEditorNodeStyle,
} from "@/lib/editor/presets";
import {
  editorFontFamilies,
  editorFontStyle,
  getEditorFontAssets,
} from "@/lib/editor/fonts";
import {
  editorCommandsToVideoCommands,
  type VideoProjectCommand,
} from "./commands";
import type { VideoProjectDocument } from "./document";

const targetSchema = z
  .object({
    itemId: z.string().min(1).max(191),
    nodeId: z.string().min(1).max(191),
  })
  .strict();
export const EDITOR_CAPABILITY_VERSION = 1;
export const editorLookId = (label: string) =>
  label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
const definitions = {
  "text.color": {
    label: "Text color",
    targets: ["text", "caption"],
    effect: "appearance",
    schema: z.object({ color: styleSchema.shape.color.unwrap() }).strict(),
  },
  "text.font": {
    label: "Font",
    targets: ["text", "caption"],
    effect: "appearance",
    schema: z
      .object({
        family: z
          .string()
          .refine(
            (value) => editorFontFamilies.includes(value),
            "Choose a bundled font.",
          ),
      })
      .strict(),
  },
  "text.style": {
    label: "Text style",
    targets: ["text", "caption"],
    effect: "appearance",
    schema: z
      .object({
        preset: z
          .string()
          .refine(
            (value) => Object.hasOwn(editorTextStyles, value),
            "Choose an existing text style.",
          ),
      })
      .strict(),
  },
  "layer.opacity": {
    label: "Opacity",
    targets: ["text", "caption", "div", "img", "video", "effect"],
    effect: "appearance",
    schema: z.object({ percent: z.number().finite().min(0).max(100) }).strict(),
  },
  "layer.center": {
    label: "Center on canvas",
    targets: ["text", "div", "img", "video"],
    effect: "layout",
    schema: z
      .object({
        axis: z.enum(["horizontal", "vertical", "both"]).default("both"),
      })
      .strict(),
  },
  "media.fit": {
    label: "Fit in frame",
    targets: ["img", "video"],
    effect: "appearance",
    schema: z.object({ fit: z.enum(["contain", "cover", "fill"]) }).strict(),
  },
  "media.look": {
    label: "Video look",
    targets: ["img", "video"],
    effect: "appearance",
    schema: z
      .object({
        preset: z
          .string()
          .refine(
            (value) =>
              editorMediaFilters.some(
                (filter) => editorLookId(filter.label) === value,
              ),
            "Choose an existing video look.",
          ),
      })
      .strict(),
  },
  "audio.volume": {
    label: "Volume",
    targets: ["video", "audio"],
    effect: "audio",
    schema: z.object({ percent: z.number().finite().min(0).max(100) }).strict(),
  },
} as const;
export type EditorCapabilityId = keyof typeof definitions;
export const editorCapabilityIds = Object.freeze(
  Object.keys(definitions) as EditorCapabilityId[],
);
export const editorCapabilityInputSchema = z
  .object({
    version: z.literal(EDITOR_CAPABILITY_VERSION),
    capability: z.enum(
      editorCapabilityIds as [EditorCapabilityId, ...EditorCapabilityId[]],
    ),
    target: targetSchema,
    parameters: z.record(z.unknown()),
  })
  .strict();
export type EditorCapabilityInput = z.infer<typeof editorCapabilityInputSchema>;

function findNode(
  node: SceneNodeInput,
  id: string,
): SceneNodeInput | undefined {
  if (node.id === id) return node;
  for (const child of node.children ?? []) {
    const found = findNode(child, id);
    if (found) return found;
  }
}
function resolve(
  document: VideoProjectDocument,
  target: z.infer<typeof targetSchema>,
) {
  const item = document.items.find((value) => value.id === target.itemId);
  const node = item && findNode(item.node, target.nodeId);
  if (!item || !node) throw new Error("Choose an existing editable layer.");
  if (document.tracks.find((track) => track.id === item.trackId)?.locked)
    throw new Error("Unlock this track before editing it.");
  return {
    item,
    node,
    kind: item.caption && node.id === item.id ? "caption" : node.type,
  };
}

export function editorCapabilityDescriptors() {
  return editorCapabilityIds.map((id) => {
    const definition = definitions[id];
    const { $schema: _schema, ...parameters } = zodToJsonSchema(
      definition.schema,
      { $refStrategy: "none" },
    );
    return {
      id,
      version: EDITOR_CAPABILITY_VERSION,
      label: definition.label,
      targets: [...definition.targets],
      effect: definition.effect,
      execution: "native-command" as const,
      modelRequired: false,
      mediaUpload: false,
      reversible: true,
      parameters,
      ...(id === "text.font"
        ? { choices: editorFontFamilies }
        : id === "text.style"
          ? { choices: Object.keys(editorTextStyles) }
          : id === "media.look"
            ? {
                choices: editorMediaFilters.map((filter) =>
                  editorLookId(filter.label),
                ),
              }
            : {}),
    };
  });
}

/** UI and model actions use identical applicability and parameter contracts. */
export function editorCapabilityAvailability(
  document: VideoProjectDocument,
  target: z.infer<typeof targetSchema>,
) {
  return editorCapabilityIds.map((id) => {
    try {
      const resolved = resolve(document, target);
      if (
        !(definitions[id].targets as readonly string[]).includes(resolved.kind)
      )
        throw new Error("This action does not apply to the selected layer.");
      if (id === "layer.center")
        assertCenterable(resolved.item.id, resolved.node);
      return { id, available: true as const, reason: null };
    } catch (cause) {
      return {
        id,
        available: false as const,
        reason:
          cause instanceof Error
            ? cause.message
            : "This action is unavailable.",
      };
    }
  });
}
function assertCenterable(itemId: string, node: SceneNodeInput) {
  if (
    node.id !== itemId ||
    node.style?.position !== "absolute" ||
    typeof node.style?.width !== "number" ||
    typeof node.style?.height !== "number" ||
    node.style.right !== undefined ||
    node.style.bottom !== undefined ||
    node.style.inset !== undefined ||
    (node.style?.transform && node.style.transform !== "none") ||
    node.animations?.some((animation) =>
      [
        "left",
        "top",
        "right",
        "bottom",
        "inset",
        "width",
        "height",
        "transform",
      ].includes(animation.property),
    )
  ) {
    throw new Error(
      "Use the position controls for nested, automatically sized or animated layers.",
    );
  }
}

/** Builds ordinary validated command transactions. No model, upload or state write occurs here. */
export function buildEditorCapabilityCommands(
  document: VideoProjectDocument,
  input: unknown,
): VideoProjectCommand[] {
  const action = editorCapabilityInputSchema.parse(input);
  const definition = definitions[action.capability];
  const { item, node, kind } = resolve(document, action.target);
  if (!(definition.targets as readonly string[]).includes(kind))
    throw new Error("This action does not apply to the selected layer.");
  const parameters = definition.schema.parse(action.parameters) as Record<
    string,
    unknown
  >;
  const target = { kind: "node" as const, ...action.target };
  let style: Partial<SceneStyle> = {};
  switch (action.capability) {
    case "text.color":
      style = { color: parameters.color as string };
      break;
    case "text.font":
      style = editorFontStyle(node.style, parameters.family as string);
      break;
    case "text.style":
      style = editorTextStylePatch(node, parameters.preset as string);
      break;
    case "layer.opacity":
      style = { opacity: (parameters.percent as number) / 100 };
      break;
    case "media.fit":
      style = { objectFit: parameters.fit as "contain" | "cover" | "fill" };
      break;
    case "media.look":
      style = {
        filter: editorMediaFilters.find(
          (filter) => editorLookId(filter.label) === parameters.preset,
        )!.value,
      };
      break;
    case "audio.volume":
      return [
        {
          type: "set",
          target,
          path: ["volume"],
          value: (parameters.percent as number) / 100,
        },
      ];
    case "layer.center": {
      assertCenterable(item.id, node);
      const commands: VideoProjectCommand[] = [];
      if (parameters.axis !== "vertical")
        commands.push({
          type: "set",
          target,
          path: ["style", "left"],
          value: (document.format.width - (node.style!.width as number)) / 2,
        });
      if (parameters.axis !== "horizontal")
        commands.push({
          type: "set",
          target,
          path: ["style", "top"],
          value: (document.format.height - (node.style!.height as number)) / 2,
        });
      return commands;
    }
  }
  const family = style.fontFamily;
  const faces = family ? getEditorFontAssets(family) : [];
  for (const face of faces) {
    const existing = document.assets[face.id];
    if (
      existing &&
      (existing.type !== "font" ||
        existing.src !== face.src ||
        (existing.mediaMetadata?.fontFamily !== undefined &&
          existing.mediaMetadata.fontFamily !==
            face.mediaMetadata?.fontFamily) ||
        (existing.mediaMetadata?.fontWeight !== undefined &&
          existing.mediaMetadata.fontWeight !== face.mediaMetadata?.fontWeight))
    )
      throw new Error(
        "A project asset conflicts with this bundled font. Choose another font.",
      );
  }
  const assets = faces
    .filter((asset) => !document.assets[asset.id])
    .map((asset) => ({ type: "addAsset" as const, asset }));
  const replace = (value: SceneNodeInput): SceneNodeInput =>
    value.id === node.id
      ? updateEditorNodeStyle(value, style)
      : { ...value, children: value.children?.map(replace) };
  return editorCommandsToVideoCommands(document, [
    ...assets,
    { type: "updateItem", id: item.id, patch: { node: replace(item.node) } },
  ]);
}

export function editorCapabilityGuide(): string {
  return (
    "These commands execute locally. Model-assisted chat uses the configured provider.\n" +
    editorCapabilityDescriptors()
      .map(
        (entry) =>
          `${entry.id}: ${entry.label}; targets=${entry.targets.join(",")}; parameters=${JSON.stringify(entry.parameters)}${"choices" in entry ? `; choices=${entry.choices?.join(",")}` : ""}`,
      )
      .join("\n")
  );
}
