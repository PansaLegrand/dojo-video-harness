import { z } from "zod/v3";
import {
  animationSchema,
  assetSchema,
  audioBusSchema,
  closedShapeGeometrySchema,
  duckingSchema,
  extensionDescriptorSchema,
  maskDescriptorSchema,
  parseScene,
  sceneNodeSchema,
  sceneSchema,
  shapeGeometrySchema,
  styleSchema,
  textRunSchema,
  volumeEnvelopeSchema,
  type Scene,
  type SceneAnimation,
  type SceneAsset,
  type SceneNode,
  type SceneStyle,
} from "./index";

/**
 * Scene patch operations (RFC 0001): the edit vocabulary for agents and
 * editors. Ops address nodes by id — never by index — and apply
 * transactionally: any failing op rejects the whole patch and the input
 * scene is never mutated.
 */

const setStyleOp = z
  .object({
    op: z.literal("setStyle"),
    id: z.string().min(1),
    /** Merged into the node's style; a null value deletes that key. */
    style: z.record(z.unknown()),
  })
  .strict();

const setTextOp = z
  .object({
    op: z.literal("setText"),
    id: z.string().min(1),
    text: z.string(),
  })
  .strict();

const setNodePropsOp = z
  .object({
    op: z.literal("setNodeProps"),
    id: z.string().min(1),
    props: z
      .object({
        assetId: z.string().min(1).nullable().optional(),
        text: z.string().nullable().optional(),
        effect: z.string().min(1).nullable().optional(),
        params: z.record(z.unknown()).nullable().optional(),
        runs: z
          .array(z.lazy(() => textRunSchema))
          .min(1)
          .max(256)
          .nullable()
          .optional(),
        extension: z
          .lazy(() => extensionDescriptorSchema)
          .nullable()
          .optional(),
        shape: z
          .lazy(() => shapeGeometrySchema)
          .nullable()
          .optional(),
        clip: z
          .lazy(() => closedShapeGeometrySchema)
          .nullable()
          .optional(),
        mask: z
          .lazy(() => maskDescriptorSchema)
          .nullable()
          .optional(),
        videoStartTime: z.number().nonnegative().nullable().optional(),
        playbackRate: z
          .number()
          .min(-16)
          .max(16)
          .refine((value) => value !== 0, "playbackRate cannot be zero.")
          .nullable()
          .optional(),
        audioStartTime: z.number().nonnegative().nullable().optional(),
        volume: z.number().min(0).max(1).nullable().optional(),
        volumeEnvelope: z
          .lazy(() => volumeEnvelopeSchema)
          .nullable()
          .optional(),
        audioBus: z.string().min(1).max(64).nullable().optional(),
        pan: z.number().min(-1).max(1).nullable().optional(),
        ducks: z
          .lazy(() => duckingSchema)
          .nullable()
          .optional(),
        videoEndBehavior: z.enum(["hold", "loop"]).nullable().optional(),
        loop: z.boolean().nullable().optional(),
      })
      .strict()
      .refine((props) => Object.keys(props).length > 0, {
        message: "props must include at least one supported node field.",
      }),
  })
  .strict();

const retimeOp = z
  .object({
    op: z.literal("retime"),
    id: z.string().min(1),
    from: z.number().int().optional(),
    duration: z
      .number()
      .int()
      .positive({
        message:
          "duration must be a positive integer. To hide a node, removeNode it instead.",
      })
      .optional(),
  })
  .strict();

const setAnimationsOp = z
  .object({
    op: z.literal("setAnimations"),
    id: z.string().min(1),
    /** Replaces the node's animation list as a unit. */
    // z.lazy breaks the index<->patch ESM evaluation cycle: these schemas live
    // in index.ts, which re-exports this module.
    animations: z.array(z.lazy(() => animationSchema)),
  })
  .strict();

const optionalIdSchema = z.preprocess(
  (value) => (value === null ? undefined : value),
  z.string().min(1).optional(),
);

const insertNodeOp = z
  .object({
    op: z.literal("insertNode"),
    node: z.lazy(() => sceneNodeSchema),
    /** Omitted/null = insert at the scene root. */
    parentId: optionalIdSchema,
    /** Omitted/null = append after existing siblings. */
    beforeId: optionalIdSchema,
  })
  .strict();

const removeNodeOp = z
  .object({
    op: z.literal("removeNode"),
    id: z.string().min(1),
  })
  .strict();

const moveNodeOp = z
  .object({
    op: z.literal("moveNode"),
    id: z.string().min(1),
    parentId: optionalIdSchema,
    beforeId: optionalIdSchema,
  })
  .strict();

const setAssetOp = z
  .object({
    op: z.literal("setAsset"),
    asset: z.lazy(() => assetSchema),
  })
  .strict();

const removeAssetOp = z
  .object({
    op: z.literal("removeAsset"),
    id: z.string().min(1),
  })
  .strict();

const setSceneMetaOp = z
  .object({
    op: z.literal("setSceneMeta"),
    width: z.number().int().positive().optional(),
    height: z.number().int().positive().optional(),
    fps: z.number().int().positive().optional(),
    duration: z.number().int().positive().optional(),
  })
  .strict();

const setMarkerOp = z
  .object({
    op: z.literal("setMarker"),
    name: z.string().min(1),
    /** Null removes the marker. */
    frame: z.number().int().nonnegative().nullable(),
  })
  .strict();

const setAudioBusOp = z
  .object({
    op: z.literal("setAudioBus"),
    name: z.string().min(1),
    /** Null removes the bus. */
    bus: z.lazy(() => audioBusSchema).nullable(),
  })
  .strict();

export const sceneOpSchema = z.discriminatedUnion("op", [
  setStyleOp,
  setTextOp,
  setNodePropsOp,
  retimeOp,
  setAnimationsOp,
  insertNodeOp,
  removeNodeOp,
  moveNodeOp,
  setAssetOp,
  removeAssetOp,
  setSceneMetaOp,
  setMarkerOp,
  setAudioBusOp,
]);

export const scenePatchSchema = z.array(sceneOpSchema);

export type SceneOp = z.infer<typeof sceneOpSchema>;
export type ScenePatch = SceneOp[];

export type ScenePatchError = { opIndex: number; message: string };

export type ApplyScenePatchResult =
  | { ok: true; scene: Scene }
  | { ok: false; errors: ScenePatchError[] };

// ---------------------------------------------------------------------------

function formatPatchIssue(issue: z.ZodIssue): string {
  const path = issue.path.join(".") || "patch";
  const keys =
    issue.code === z.ZodIssueCode.unrecognized_keys
      ? ` Unsupported key(s): ${issue.keys.join(", ")}.`
      : "";
  return `${path}: ${issue.message}${keys}`;
}

function formatPatchedSceneIssue(issue: z.ZodIssue): string {
  const path = issue.path.join(".") || "scene";
  const keys =
    issue.code === z.ZodIssueCode.unrecognized_keys
      ? ` Unsupported key(s): ${issue.keys.join(", ")}.`
      : "";
  return `patched scene is invalid at ${path}: ${issue.message}${keys}`;
}

type MutableNode = SceneNode & { children?: MutableNode[] };

/** Deep-clones the parts of the scene the patch may touch (copy-on-write). */
function cloneScene(scene: Scene): Scene {
  return structuredClone(scene);
}

function collectNodes(
  nodes: MutableNode[],
  into: Map<string, { node: MutableNode; siblings: MutableNode[] }>,
  siblings: MutableNode[],
): void {
  for (const node of nodes) {
    into.set(node.id, { node, siblings });
    if (node.children && node.children.length > 0) {
      collectNodes(node.children, into, node.children);
    }
  }
}

function indexScene(
  scene: Scene,
): Map<string, { node: MutableNode; siblings: MutableNode[] }> {
  const map = new Map<string, { node: MutableNode; siblings: MutableNode[] }>();
  collectNodes(scene.nodes as MutableNode[], map, scene.nodes as MutableNode[]);
  return map;
}

/**
 * Closest existing ids by edit distance, for misspelled-id error hints —
 * the predicted top failure mode for LLM-authored patches.
 */
export function closestIds(
  target: string,
  ids: Iterable<string>,
  count = 3,
): string[] {
  const scored: Array<{ id: string; distance: number }> = [];

  Array.from(ids).forEach((id) => {
    scored.push({
      id,
      distance: editDistance(target.toLowerCase(), id.toLowerCase()),
    });
  });

  return scored
    .sort((a, b) => a.distance - b.distance || a.id.localeCompare(b.id))
    .slice(0, count)
    .map((entry) => entry.id);
}

function editDistance(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const dist = new Array<number>(cols).fill(0).map((_, j) => j);

  for (let i = 1; i < rows; i += 1) {
    let previousDiagonal = dist[0] ?? 0;
    dist[0] = i;

    for (let j = 1; j < cols; j += 1) {
      const insertion = (dist[j - 1] ?? 0) + 1;
      const deletion = (dist[j] ?? 0) + 1;
      const substitution = previousDiagonal + (a[i - 1] === b[j - 1] ? 0 : 1);
      previousDiagonal = dist[j] ?? 0;
      dist[j] = Math.min(insertion, deletion, substitution);
    }
  }

  return dist[cols - 1] ?? 0;
}

function missingNodeMessage(
  op: string,
  id: string,
  index: Map<string, unknown>,
): string {
  const hints = closestIds(id, index.keys());
  const hintText =
    hints.length > 0
      ? ` Closest existing ids: ${hints.map((h) => `"${h}"`).join(", ")}.`
      : " The scene has no nodes.";
  return `(${op} "${id}"): No node with id "${id}".${hintText} Node ids are case-sensitive.`;
}

// ---------------------------------------------------------------------------

/**
 * Applies a patch to a scene. Pure and transactional: the input is never
 * mutated; on any error the result lists every failing op (validation
 * errors for all ops are reported together; semantic errors stop at the
 * first failure since later ops may depend on earlier ones).
 */
export function applyScenePatch(
  sceneInput: unknown,
  patchInput: unknown,
): ApplyScenePatchResult {
  let scene: Scene;

  try {
    scene = parseScene(sceneInput);
  } catch (error) {
    return {
      ok: false,
      errors: [
        {
          opIndex: -1,
          message: `The input scene is invalid before patching: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
    };
  }

  const parsedPatch = scenePatchSchema.safeParse(patchInput);

  if (!parsedPatch.success) {
    return {
      ok: false,
      errors: parsedPatch.error.issues.map((issue) => ({
        opIndex: typeof issue.path[0] === "number" ? issue.path[0] : -1,
        message: formatPatchIssue(issue),
      })),
    };
  }

  const patch = parsedPatch.data;
  const draft = cloneScene(scene);

  for (let opIndex = 0; opIndex < patch.length; opIndex += 1) {
    const op = patch[opIndex] as SceneOp;
    const error = applyOp(draft, op);

    if (error) {
      return {
        ok: false,
        errors: [{ opIndex, message: `op ${opIndex} ${error}` }],
      };
    }
  }

  // The whole document revalidates so cross-field invariants (unique ids,
  // asset references, node-type field rules) hold after every patch.
  const final = sceneSchema.safeParse(draft);

  if (!final.success) {
    return {
      ok: false,
      errors: final.error.issues.map((issue) => ({
        opIndex: -1,
        message: formatPatchedSceneIssue(issue),
      })),
    };
  }

  return { ok: true, scene: parseScene(final.data) };
}

function applyOp(draft: Scene, op: SceneOp): string | null {
  const index = indexScene(draft);

  switch (op.op) {
    case "setStyle": {
      const entry = index.get(op.id);
      if (!entry) return missingNodeMessage("setStyle", op.id, index);

      const style: Record<string, unknown> = { ...(entry.node.style ?? {}) };

      for (const [key, value] of Object.entries(op.style)) {
        if (value === null) {
          delete style[key];
        } else {
          style[key] = value;
        }
      }

      const checked = styleSchema.safeParse(style);
      if (!checked.success) {
        const issue = checked.error.issues[0];
        return `(setStyle "${op.id}"): ${issue?.path.join(".") ?? "style"}: ${issue?.message ?? "invalid style"}`;
      }

      entry.node.style = checked.data as SceneStyle;
      return null;
    }

    case "setText": {
      const entry = index.get(op.id);
      if (!entry) return missingNodeMessage("setText", op.id, index);
      if (entry.node.type !== "text") {
        return `(setText "${op.id}"): node is a ${entry.node.type}, not a text node. Only text nodes carry text.`;
      }
      entry.node.text = op.text;
      return null;
    }

    case "setNodeProps": {
      const entry = index.get(op.id);
      if (!entry) return missingNodeMessage("setNodeProps", op.id, index);

      for (const [key, value] of Object.entries(op.props)) {
        if (value === null) {
          delete entry.node[key as keyof MutableNode];
        } else {
          (entry.node as Record<string, unknown>)[key] = value;
        }
      }

      return null;
    }

    case "retime": {
      const entry = index.get(op.id);
      if (!entry) return missingNodeMessage("retime", op.id, index);
      if (op.from === undefined && op.duration === undefined) {
        return `(retime "${op.id}"): needs \`from\`, \`duration\`, or both.`;
      }
      if (op.from !== undefined) entry.node.from = op.from;
      if (op.duration !== undefined) entry.node.duration = op.duration;
      return null;
    }

    case "setAnimations": {
      const entry = index.get(op.id);
      if (!entry) return missingNodeMessage("setAnimations", op.id, index);
      entry.node.animations = op.animations as SceneAnimation[];
      return null;
    }

    case "insertNode": {
      if (index.has(op.node.id)) {
        return `(insertNode): Node id "${op.node.id}" already exists. Choose a unique id.`;
      }

      let siblings: MutableNode[];

      if (op.parentId === undefined) {
        siblings = draft.nodes as MutableNode[];
      } else {
        const parent = index.get(op.parentId);
        if (!parent)
          return missingNodeMessage("insertNode parentId", op.parentId, index);
        parent.node.children = parent.node.children ?? [];
        siblings = parent.node.children as MutableNode[];
      }

      let position = siblings.length;

      if (op.beforeId !== undefined) {
        position = siblings.findIndex((node) => node.id === op.beforeId);
        if (position === -1) {
          return `(insertNode): beforeId "${op.beforeId}" is not a child of ${op.parentId ? `"${op.parentId}"` : "the scene root"}.`;
        }
      }

      siblings.splice(position, 0, structuredClone(op.node) as MutableNode);
      return null;
    }

    case "removeNode": {
      const entry = index.get(op.id);
      if (!entry) return missingNodeMessage("removeNode", op.id, index);
      entry.siblings.splice(entry.siblings.indexOf(entry.node), 1);
      return null;
    }

    case "moveNode": {
      const entry = index.get(op.id);
      if (!entry) return missingNodeMessage("moveNode", op.id, index);

      let targetSiblings: MutableNode[];

      if (op.parentId === undefined) {
        targetSiblings = draft.nodes as MutableNode[];
      } else {
        if (op.parentId === op.id || isDescendant(entry.node, op.parentId)) {
          return `(moveNode "${op.id}"): cannot move a node into itself or its own subtree.`;
        }
        const parent = index.get(op.parentId);
        if (!parent)
          return missingNodeMessage("moveNode parentId", op.parentId, index);
        parent.node.children = parent.node.children ?? [];
        targetSiblings = parent.node.children as MutableNode[];
      }

      entry.siblings.splice(entry.siblings.indexOf(entry.node), 1);

      let position = targetSiblings.length;

      if (op.beforeId !== undefined) {
        position = targetSiblings.findIndex((node) => node.id === op.beforeId);
        if (position === -1) {
          return `(moveNode "${op.id}"): beforeId "${op.beforeId}" is not a child of the target parent.`;
        }
      }

      targetSiblings.splice(position, 0, entry.node);
      return null;
    }

    case "setAsset": {
      draft.assets[op.asset.id] = structuredClone(op.asset) as SceneAsset;
      return null;
    }

    case "removeAsset": {
      if (!(op.id in draft.assets)) {
        const hints = closestIds(op.id, Object.keys(draft.assets));
        return `(removeAsset "${op.id}"): No asset with id "${op.id}".${hints.length ? ` Closest existing ids: ${hints.map((h) => `"${h}"`).join(", ")}.` : ""}`;
      }

      const referencing: string[] = [];
      index.forEach((entry, id) => {
        if (entry.node.assetId === op.id) referencing.push(id);
      });

      if (referencing.length > 0) {
        return `(removeAsset "${op.id}"): nodes ${referencing.map((id) => `"${id}"`).join(", ")} still reference it. Remove or repoint those nodes first.`;
      }

      delete draft.assets[op.id];
      return null;
    }

    case "setSceneMeta": {
      if (
        op.width === undefined &&
        op.height === undefined &&
        op.fps === undefined &&
        op.duration === undefined
      ) {
        return "(setSceneMeta): needs at least one of width/height/fps/duration.";
      }
      if (op.width !== undefined) draft.width = op.width;
      if (op.height !== undefined) draft.height = op.height;
      if (op.fps !== undefined) draft.fps = op.fps;
      if (op.duration !== undefined) draft.duration = op.duration;
      return null;
    }

    case "setMarker": {
      draft.markers = draft.markers ?? {};
      if (op.frame === null) {
        delete draft.markers[op.name];
      } else {
        draft.markers[op.name] = op.frame;
      }
      if (Object.keys(draft.markers).length === 0) {
        delete draft.markers;
      }
      return null;
    }

    case "setAudioBus": {
      draft.audioBuses = draft.audioBuses ?? {};
      if (op.bus === null) {
        delete draft.audioBuses[op.name];
      } else {
        draft.audioBuses[op.name] = op.bus;
      }
      if (Object.keys(draft.audioBuses).length === 0) {
        delete draft.audioBuses;
      }
      return null;
    }
  }

  return null;
}

function isDescendant(node: MutableNode, id: string): boolean {
  for (const child of node.children ?? []) {
    if (child.id === id || isDescendant(child, id)) {
      return true;
    }
  }
  return false;
}
