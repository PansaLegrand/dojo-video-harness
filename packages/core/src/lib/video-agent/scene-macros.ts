import {
  expandMacroNodeInput,
  expandMacroNodes,
  type MacroContext,
} from "@motionforge/presets/macros";
import type { Scene } from "@motionforge/schema";

export type VideoAgentMacroTranscripts = NonNullable<
  MacroContext["transcripts"]
>;

/**
 * Glue between raw model output and @motionforge/presets/macros: expands
 * macro nodes and layout intents (place/textRole/look/layout) before the
 * normalize -> repair -> patch pipeline runs, so validation only ever sees
 * plain scene nodes. Errors are written for the model retry loop: every
 * problem is reported, with usage examples and closest-match hints.
 */

export type VideoAgentMacroExpansion = {
  value: unknown;
  diagnostics: string[];
  errors: string[];
};

const DEFAULT_SCENE = { width: 1080, height: 1920, fps: 30, duration: 150 };

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function readPositiveInt(value: unknown, fallback: number): number {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number.parseFloat(value)
        : NaN;

  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : fallback;
}

function collectSceneNodeIds(nodes: Scene["nodes"], into: Set<string>): void {
  for (const node of nodes) {
    into.add(node.id);
    collectSceneNodeIds(node.children ?? [], into);
  }
}

function readAssetTypes(input: unknown): Record<string, { type: string }> {
  const assets: Record<string, { type: string }> = {};

  if (!isRecord(input)) {
    return assets;
  }

  for (const [id, asset] of Object.entries(input)) {
    if (isRecord(asset) && typeof asset.type === "string") {
      assets[id] = { type: asset.type };
    }
  }

  return assets;
}

/**
 * Expands macros and intents inside a complete model scene. The input should
 * already be shaped by normalizeModelScene (assets as a map); meta fields
 * fall back to video-agent defaults when the model omitted them, since the
 * scene will fail validation on those fields anyway.
 */
export function expandVideoAgentSceneMacros(
  sceneInput: unknown,
  options: { transcripts?: VideoAgentMacroTranscripts } = {},
): VideoAgentMacroExpansion {
  if (!isRecord(sceneInput) || !Array.isArray(sceneInput.nodes)) {
    return { value: sceneInput, diagnostics: [], errors: [] };
  }

  const ctx: MacroContext = {
    width: readPositiveInt(sceneInput.width, DEFAULT_SCENE.width),
    height: readPositiveInt(sceneInput.height, DEFAULT_SCENE.height),
    fps: readPositiveInt(sceneInput.fps, DEFAULT_SCENE.fps),
    duration: readPositiveInt(sceneInput.duration, DEFAULT_SCENE.duration),
    assets: readAssetTypes(sceneInput.assets),
    transcripts: options.transcripts,
  };

  const result = expandMacroNodes(sceneInput.nodes, ctx);

  if (!result.ok) {
    return { value: sceneInput, diagnostics: [], errors: result.errors };
  }

  return {
    value: {
      ...sceneInput,
      nodes: result.nodes.map((node) =>
        applyDefaultOverlayZIndex(node, true, ctx),
      ),
    },
    diagnostics: result.diagnostics,
    errors: [],
  };
}

/**
 * Expands macros and intents inside a model patch against the current scene.
 * Ops are processed in order so expansion sees the same world each op would:
 * setSceneMeta updates the composition context, setAsset registers assets for
 * reference checks, and removeNode frees ids for reuse.
 */
export function expandVideoAgentPatchMacros(
  patchInput: unknown,
  scene: Scene,
  options: { transcripts?: VideoAgentMacroTranscripts } = {},
): VideoAgentMacroExpansion {
  if (!Array.isArray(patchInput)) {
    return { value: patchInput, diagnostics: [], errors: [] };
  }

  const meta = {
    width: scene.width,
    height: scene.height,
    fps: scene.fps,
    duration: scene.duration,
  };
  const usedIds = new Set<string>();
  collectSceneNodeIds(scene.nodes, usedIds);
  const assets = readAssetTypes(scene.assets);
  const diagnostics: string[] = [];
  const errors: string[] = [];

  const value = patchInput.map((opInput, opIndex) => {
    if (!isRecord(opInput)) {
      return opInput;
    }

    switch (opInput.op) {
      case "setSceneMeta": {
        meta.width = readPositiveInt(opInput.width, meta.width);
        meta.height = readPositiveInt(opInput.height, meta.height);
        meta.fps = readPositiveInt(opInput.fps, meta.fps);
        meta.duration = readPositiveInt(opInput.duration, meta.duration);
        return opInput;
      }

      case "setAsset": {
        const asset = opInput.asset;

        if (
          isRecord(asset) &&
          typeof asset.id === "string" &&
          typeof asset.type === "string"
        ) {
          assets[asset.id] = { type: asset.type };
        }

        return opInput;
      }

      case "removeNode": {
        if (typeof opInput.id === "string") {
          usedIds.delete(opInput.id);
        }

        return opInput;
      }

      case "insertNode": {
        const atRoot =
          opInput.parentId === undefined || opInput.parentId === null;
        const result = expandMacroNodeInput(
          opInput.node,
          {
            ...meta,
            existingIds: usedIds,
            assets,
            transcripts: options.transcripts,
          },
          { atRoot },
        );

        if (!result.ok) {
          errors.push(
            ...result.errors.map((error) => `op ${opIndex} ${error}`),
          );
          return opInput;
        }

        diagnostics.push(...result.diagnostics);
        const node = applyDefaultOverlayZIndex(result.nodes[0], atRoot, meta);

        // Reserve the inserted subtree's ids for later ops in this patch.
        collectInputIds(node, usedIds);
        return { ...opInput, node };
      }

      default:
        return opInput;
    }
  });

  return { value, diagnostics, errors };
}

// The renderer sorts root siblings by zIndex. Classify raw model nodes by
// their rendered role so a text wrapper cannot be buried by a media sibling.
// Macro-generated nodes already carry an explicit band and are preserved.
const BASE_MEDIA_DEFAULT_Z_INDEX = 0;
const RAW_OVERLAY_DEFAULT_Z_INDEX = 20;
const TEXT_OVERLAY_DEFAULT_Z_INDEX = 40;
const RAW_OVERLAY_NODE_TYPES = new Set(["img", "lottie", "effect"]);

function applyDefaultOverlayZIndex(
  input: unknown,
  atRoot: boolean,
  dimensions: { width: number; height: number },
): unknown {
  if (!atRoot || !isRecord(input)) {
    return input;
  }

  const style = isRecord(input.style) ? input.style : undefined;
  if (style && style.zIndex !== undefined) {
    return input;
  }

  let zIndex: number | null = null;

  if (containsTextNode(input)) {
    zIndex = TEXT_OVERLAY_DEFAULT_Z_INDEX;
  } else if (isFullFrameMediaNode(input, dimensions)) {
    zIndex = BASE_MEDIA_DEFAULT_Z_INDEX;
  } else if (
    typeof input.type === "string" &&
    RAW_OVERLAY_NODE_TYPES.has(input.type)
  ) {
    zIndex = RAW_OVERLAY_DEFAULT_Z_INDEX;
  }

  if (zIndex === null) {
    return input;
  }

  return {
    ...input,
    style: {
      ...(style ?? {}),
      zIndex,
    },
  };
}

function containsTextNode(input: unknown): boolean {
  if (!isRecord(input)) {
    return false;
  }

  if (input.type === "text") {
    return true;
  }

  return Array.isArray(input.children) && input.children.some(containsTextNode);
}

function isFullFrameMediaNode(
  input: Record<string, unknown>,
  dimensions: { width: number; height: number },
): boolean {
  if (input.type !== "img" && input.type !== "video") {
    return false;
  }

  const style = isRecord(input.style) ? input.style : undefined;
  if (!style) {
    return false;
  }

  const inset = style.inset;
  if (inset === 0 || inset === "0" || inset === "0px") {
    return true;
  }

  return (
    coversDimension(style.width, dimensions.width) &&
    coversDimension(style.height, dimensions.height)
  );
}

function coversDimension(value: unknown, sceneSize: number): boolean {
  if (typeof value === "number") {
    return value >= sceneSize;
  }

  return typeof value === "string" && value.trim() === "100%";
}

function collectInputIds(input: unknown, into: Set<string>): void {
  if (!isRecord(input)) {
    return;
  }

  if (typeof input.id === "string" && input.id.length > 0) {
    into.add(input.id);
  }

  if (Array.isArray(input.children)) {
    for (const child of input.children) {
      collectInputIds(child, into);
    }
  }
}
