import {
  applyScenePatch,
  parseScene,
  scenePatchSchema,
  type Scene,
  type SceneNode,
  type SceneOp,
  type ScenePatch,
  type ScenePatchError,
} from "@motionforge/schema";
import {
  compileSceneCommands,
  type CommandDiagnostic,
  type CommandError,
  type CompileSceneCommandsContext,
  type SceneCommand,
} from "./commands";

/** A stable, JSON-safe leaf change between two canonical scenes. */
export type WorkspaceSemanticChange = {
  kind: "add" | "remove" | "change" | "order";
  path: Array<string | number>;
  before?: unknown;
  after?: unknown;
};

/** An id-aware semantic diff. Node arrays report order independently of content. */
export type WorkspaceSemanticDiff = {
  equal: boolean;
  summary: { added: number; removed: number; changed: number };
  changes: WorkspaceSemanticChange[];
};

export type InvertScenePatchResult =
  | {
      ok: true;
      scene: Scene;
      forwardPatch: ScenePatch;
      inversePatch: ScenePatch;
      affectedIds: string[];
      semanticDiff: WorkspaceSemanticDiff;
    }
  | { ok: false; errors: ScenePatchError[] };

export type SceneWorkspaceOptions = {
  /** Bounded in-memory undo/journal capacity. Defaults to 100. */
  historyLimit?: number;
  /** Context used while compiling commands. It is cloned at construction. */
  commandContext?: CompileSceneCommandsContext;
};

export type WorkspaceDraft = {
  baseRevision: number;
  commands: SceneCommand[];
  /** Canonical forward patch produced by command compilation. */
  patch: ScenePatch;
  /** Verified exact inverse for inspecting or externally logging the draft. */
  inversePatch: ScenePatch;
  scene: Scene;
  affectedIds: string[];
  diagnostics: CommandDiagnostic[];
  semanticDiff: WorkspaceSemanticDiff;
};

export type WorkspaceHistoryKind = "commit" | "undo" | "redo";

export type WorkspaceHistoryEntry = {
  kind: WorkspaceHistoryKind;
  revisionBefore: number;
  revisionAfter: number;
  forwardPatch: ScenePatch;
  inversePatch: ScenePatch;
  affectedIds: string[];
  semanticDiff: WorkspaceSemanticDiff;
  diagnostics: CommandDiagnostic[];
};

export type SceneWorkspaceSnapshot = {
  revision: number;
  scene: Scene;
  canUndo: boolean;
  canRedo: boolean;
  history: WorkspaceHistoryEntry[];
};

export type WorkspaceTransitionPreview =
  | {
      kind: "undo" | "redo";
      changed: false;
      revision: number;
      scene: Scene;
    }
  | {
      kind: "undo" | "redo";
      changed: true;
      revision: number;
      scene: Scene;
      history: WorkspaceHistoryEntry;
    };

export type SceneWorkspaceErrorCode =
  | "invalid_history_limit"
  | "stale_revision"
  | "command_failed"
  | "invalid_draft"
  | "patch_failed"
  | "inverse_failed";

/** Deterministic workspace failure with structured, JSON-safe detail. */
export class SceneWorkspaceError extends Error {
  constructor(
    readonly code: SceneWorkspaceErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "SceneWorkspaceError";
  }
}

type InternalCommit = {
  forwardPatch: ScenePatch;
  inversePatch: ScenePatch;
  affectedIds: string[];
  diagnostics: CommandDiagnostic[];
};

type InternalDraft = InternalCommit & {
  baseRevision: number;
  commands: SceneCommand[];
  scene: Scene;
  semanticDiff: WorkspaceSemanticDiff;
};

type MutableNode = SceneNode & { children?: MutableNode[] };

const DEFAULT_HISTORY_LIMIT = 100;

/**
 * Build a canonical patch's exact inverse without mutating either input.
 * The returned inverse is verified by applying it to the forward result and
 * comparing the restored canonical scene with the original.
 */
export function invertScenePatch(
  sceneInput: unknown,
  patchInput: unknown,
): InvertScenePatchResult {
  const applied = applyScenePatch(sceneInput, patchInput);
  if (!applied.ok) return applied;

  const parsedPatch = scenePatchSchema.safeParse(patchInput);
  if (!parsedPatch.success) {
    // applyScenePatch already validates the same schema. This branch protects
    // the public result if those contracts ever diverge.
    return {
      ok: false,
      errors: parsedPatch.error.issues.map((issue) => ({
        opIndex: typeof issue.path[0] === "number" ? issue.path[0] : -1,
        message: `${issue.path.join(".") || "patch"}: ${issue.message}`,
      })),
    };
  }

  const before = parseScene(sceneInput);
  const forwardPatch = clone(parsedPatch.data);
  let inversePatch = deriveOperationInverse(before, forwardPatch);
  let restored = applyScenePatch(applied.scene, inversePatch);

  // A few canonical ops can create an otherwise insignificant optional
  // container (for example children: []). When an op-level inverse cannot
  // remove that container, fall back to replacing only changed root subtrees.
  if (!restored.ok || !deepEqual(restored.scene, before)) {
    inversePatch = deriveExactRestorationPatch(applied.scene, before);
    restored = applyScenePatch(applied.scene, inversePatch);
  }

  if (!restored.ok || !deepEqual(restored.scene, before)) {
    return {
      ok: false,
      errors: restored.ok
        ? [
            {
              opIndex: -1,
              message:
                "The generated inverse did not restore the canonical input scene exactly.",
            },
          ]
        : restored.errors,
    };
  }

  return {
    ok: true,
    scene: clone(applied.scene),
    forwardPatch,
    inversePatch: clone(inversePatch),
    affectedIds: affectedIdsForPatch(before, forwardPatch),
    semanticDiff: diffCanonicalScenes(before, applied.scene),
  };
}

/** Compute the same stable semantic diff exposed by drafts and history. */
export function diffSceneSemantics(
  beforeInput: unknown,
  afterInput: unknown,
): WorkspaceSemanticDiff {
  return diffCanonicalScenes(parseScene(beforeInput), parseScene(afterInput));
}

/**
 * Revisioned, process-local scene editing workspace.
 *
 * This class deliberately makes no persistence or collaboration claim. Hosts
 * that store revisions must add their own authorization and durable log.
 */
export class SceneWorkspace {
  private currentScene: Scene;
  private currentRevision = 0;
  private readonly historyLimit: number;
  private readonly commandContext: CompileSceneCommandsContext | undefined;
  private readonly draftRecords = new WeakMap<object, InternalDraft>();
  private undoStack: InternalCommit[] = [];
  private redoStack: InternalCommit[] = [];
  private journal: WorkspaceHistoryEntry[] = [];

  constructor(sceneInput: unknown, options: SceneWorkspaceOptions = {}) {
    const historyLimit = options.historyLimit ?? DEFAULT_HISTORY_LIMIT;
    if (
      !Number.isInteger(historyLimit) ||
      historyLimit < 1 ||
      historyLimit > 10_000
    ) {
      throw new SceneWorkspaceError(
        "invalid_history_limit",
        "historyLimit must be an integer from 1 through 10000.",
        { historyLimit: jsonSafeNumber(historyLimit) },
      );
    }
    this.currentScene = clone(parseScene(sceneInput));
    this.historyLimit = historyLimit;
    this.commandContext = options.commandContext
      ? clone(options.commandContext)
      : undefined;
  }

  get revision(): number {
    return this.currentRevision;
  }

  /** A defensive clone of the bounded chronological transaction journal. */
  get history(): WorkspaceHistoryEntry[] {
    return clone(this.journal);
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /** Returns a fresh canonical clone on every call. */
  read(): Scene {
    return clone(this.currentScene);
  }

  /** Atomically reads scene, revision, history, and undo state. */
  snapshot(): SceneWorkspaceSnapshot {
    return {
      revision: this.currentRevision,
      scene: this.read(),
      canUndo: this.canUndo,
      canRedo: this.canRedo,
      history: this.history,
    };
  }

  /** Compile and validate commands without changing scene or revision. */
  draft(
    commandsInput: readonly SceneCommand[],
    expectedRevision = this.currentRevision,
  ): WorkspaceDraft {
    this.assertRevision(expectedRevision);
    const commands = clone(Array.from(commandsInput));
    const compiled = compileSceneCommands(
      this.currentScene,
      commands,
      this.commandContext,
    );
    if (!compiled.ok) {
      throw new SceneWorkspaceError(
        "command_failed",
        formatCommandErrors(compiled.errors),
        clone(compiled),
      );
    }

    const inverse = invertScenePatch(this.currentScene, compiled.patch);
    if (!inverse.ok) {
      throw new SceneWorkspaceError(
        "patch_failed",
        formatPatchErrors(inverse.errors),
        clone(inverse.errors),
      );
    }

    const internal: InternalDraft = {
      baseRevision: this.currentRevision,
      commands,
      scene: inverse.scene,
      forwardPatch: inverse.forwardPatch,
      inversePatch: inverse.inversePatch,
      affectedIds: stableUnique(compiled.affectedIds),
      diagnostics: clone(compiled.diagnostics),
      semanticDiff: inverse.semanticDiff,
    };
    const draft: WorkspaceDraft = {
      baseRevision: internal.baseRevision,
      commands: clone(internal.commands),
      patch: clone(internal.forwardPatch),
      inversePatch: clone(internal.inversePatch),
      scene: clone(internal.scene),
      affectedIds: clone(internal.affectedIds),
      diagnostics: clone(internal.diagnostics),
      semanticDiff: clone(internal.semanticDiff),
    };
    deepFreeze(draft);
    this.draftRecords.set(draft, internal);
    return draft;
  }

  /** Commit a workspace-created draft, or compile and commit commands directly. */
  commit(
    input: WorkspaceDraft | readonly SceneCommand[],
    expectedRevision?: number,
  ): WorkspaceHistoryEntry {
    if (Array.isArray(input)) {
      const draft = this.draft(input, expectedRevision ?? this.currentRevision);
      return this.commit(draft, expectedRevision);
    }

    const internal = this.draftRecords.get(input as object);
    if (!internal) {
      throw new SceneWorkspaceError(
        "invalid_draft",
        "commit() accepts commands or an unmodified draft created by this workspace.",
      );
    }
    const requiredRevision = expectedRevision ?? internal.baseRevision;
    if (requiredRevision !== internal.baseRevision) {
      throw new SceneWorkspaceError(
        "stale_revision",
        `Draft revision ${internal.baseRevision} does not match expected revision ${requiredRevision}.`,
        {
          expectedRevision: requiredRevision,
          draftRevision: internal.baseRevision,
          actualRevision: this.currentRevision,
        },
      );
    }
    this.assertRevision(requiredRevision);

    const before = this.currentScene;
    const applied = applyScenePatch(before, internal.forwardPatch);
    if (!applied.ok) {
      throw new SceneWorkspaceError(
        "patch_failed",
        formatPatchErrors(applied.errors),
        clone(applied.errors),
      );
    }
    if (!deepEqual(applied.scene, internal.scene)) {
      throw new SceneWorkspaceError(
        "patch_failed",
        "The draft patch no longer matches its validated draft scene.",
      );
    }

    this.currentScene = clone(applied.scene);
    const commit: InternalCommit = {
      forwardPatch: clone(internal.forwardPatch),
      inversePatch: clone(internal.inversePatch),
      affectedIds: clone(internal.affectedIds),
      diagnostics: clone(internal.diagnostics),
    };
    this.undoStack.push(commit);
    this.trim(this.undoStack);
    this.redoStack = [];
    return this.record("commit", before, this.currentScene, commit);
  }

  /** Preview the exact undo candidate without mutating workspace state. */
  previewUndo(
    expectedRevision = this.currentRevision,
  ): WorkspaceTransitionPreview {
    this.assertRevision(expectedRevision);
    const commit = this.undoStack.at(-1);
    return this.previewTransition("undo", commit && reverseCommit(commit));
  }

  /** Redo candidate without changing stacks, Scene, history, or revision. */
  previewRedo(
    expectedRevision = this.currentRevision,
  ): WorkspaceTransitionPreview {
    this.assertRevision(expectedRevision);
    return this.previewTransition("redo", this.redoStack.at(-1));
  }

  /** Undo the latest committed edit. Returns null when there is nothing to undo. */
  undo(expectedRevision = this.currentRevision): WorkspaceHistoryEntry | null {
    this.assertRevision(expectedRevision);
    const commit = this.undoStack.at(-1);
    if (!commit) return null;

    const before = this.currentScene;
    const applied = applyScenePatch(before, commit.inversePatch);
    if (!applied.ok) {
      throw new SceneWorkspaceError(
        "inverse_failed",
        formatPatchErrors(applied.errors),
        clone(applied.errors),
      );
    }

    this.undoStack.pop();
    this.redoStack.push(commit);
    this.trim(this.redoStack);
    this.currentScene = clone(applied.scene);
    return this.record(
      "undo",
      before,
      this.currentScene,
      reverseCommit(commit),
    );
  }

  /** Redo the latest undone edit. Returns null when there is nothing to redo. */
  redo(expectedRevision = this.currentRevision): WorkspaceHistoryEntry | null {
    this.assertRevision(expectedRevision);
    const commit = this.redoStack.at(-1);
    if (!commit) return null;

    const before = this.currentScene;
    const applied = applyScenePatch(before, commit.forwardPatch);
    if (!applied.ok) {
      throw new SceneWorkspaceError(
        "patch_failed",
        formatPatchErrors(applied.errors),
        clone(applied.errors),
      );
    }

    this.redoStack.pop();
    this.undoStack.push(commit);
    this.trim(this.undoStack);
    this.currentScene = clone(applied.scene);
    return this.record("redo", before, this.currentScene, commit);
  }

  private assertRevision(expectedRevision: number): void {
    if (!Number.isInteger(expectedRevision) || expectedRevision < 0) {
      throw new SceneWorkspaceError(
        "stale_revision",
        `Expected revision must be a non-negative integer; received ${String(expectedRevision)}.`,
        {
          expectedRevision: jsonSafeNumber(expectedRevision),
          actualRevision: this.currentRevision,
        },
      );
    }
    if (expectedRevision !== this.currentRevision) {
      throw new SceneWorkspaceError(
        "stale_revision",
        `Stale scene revision: expected ${expectedRevision}, current revision is ${this.currentRevision}.`,
        { expectedRevision, actualRevision: this.currentRevision },
      );
    }
  }

  private previewTransition(
    kind: "undo" | "redo",
    commit: InternalCommit | undefined,
  ): WorkspaceTransitionPreview {
    if (!commit) {
      return {
        kind,
        changed: false,
        revision: this.currentRevision,
        scene: this.read(),
      };
    }
    const before = this.currentScene;
    const applied = applyScenePatch(before, commit.forwardPatch);
    if (!applied.ok) {
      throw new SceneWorkspaceError(
        kind === "undo" ? "inverse_failed" : "patch_failed",
        formatPatchErrors(applied.errors),
        clone(applied.errors),
      );
    }
    const history: WorkspaceHistoryEntry = {
      kind,
      revisionBefore: this.currentRevision,
      revisionAfter: this.currentRevision + 1,
      forwardPatch: clone(commit.forwardPatch),
      inversePatch: clone(commit.inversePatch),
      affectedIds: clone(commit.affectedIds),
      semanticDiff: diffCanonicalScenes(before, applied.scene),
      diagnostics: clone(commit.diagnostics),
    };
    return {
      kind,
      changed: true,
      revision: this.currentRevision,
      scene: clone(applied.scene),
      history,
    };
  }

  private record(
    kind: WorkspaceHistoryKind,
    before: Scene,
    after: Scene,
    commit: InternalCommit,
  ): WorkspaceHistoryEntry {
    const revisionBefore = this.currentRevision;
    this.currentRevision += 1;
    const entry: WorkspaceHistoryEntry = {
      kind,
      revisionBefore,
      revisionAfter: this.currentRevision,
      forwardPatch: clone(commit.forwardPatch),
      inversePatch: clone(commit.inversePatch),
      affectedIds: clone(commit.affectedIds),
      semanticDiff: diffCanonicalScenes(before, after),
      diagnostics: clone(commit.diagnostics),
    };
    this.journal.push(entry);
    this.trim(this.journal);
    return clone(entry);
  }

  private trim<T>(entries: T[]): void {
    if (entries.length > this.historyLimit) {
      entries.splice(0, entries.length - this.historyLimit);
    }
  }
}

export function createSceneWorkspace(
  sceneInput: unknown,
  options?: SceneWorkspaceOptions,
): SceneWorkspace {
  return new SceneWorkspace(sceneInput, options);
}

function reverseCommit(commit: InternalCommit): InternalCommit {
  return {
    forwardPatch: clone(commit.inversePatch),
    inversePatch: clone(commit.forwardPatch),
    affectedIds: clone(commit.affectedIds),
    diagnostics: clone(commit.diagnostics),
  };
}

function deriveOperationInverse(before: Scene, patch: ScenePatch): ScenePatch {
  const draft = clone(before);
  const groups: ScenePatch[] = [];
  for (const op of patch) {
    groups.unshift(inverseForOp(draft, op));
    simulateOp(draft, op);
  }
  return groups.flat();
}

function inverseForOp(scene: Scene, op: SceneOp): ScenePatch {
  switch (op.op) {
    case "setStyle": {
      const node = requireNode(scene, op.id).node;
      if (node.style === undefined) return replaceNodePatch(scene, node.id);
      const style: Record<string, unknown> = {};
      for (const key of Object.keys(op.style)) {
        style[key] = Object.hasOwn(node.style, key)
          ? clone((node.style as Record<string, unknown>)[key])
          : null;
      }
      return [{ op: "setStyle", id: op.id, style }];
    }
    case "setText": {
      const node = requireNode(scene, op.id).node;
      return node.text === undefined
        ? [{ op: "setNodeProps", id: op.id, props: { text: null } }]
        : [{ op: "setText", id: op.id, text: node.text }];
    }
    case "setNodeProps": {
      const node = requireNode(scene, op.id).node as Record<string, unknown>;
      const props: Record<string, unknown> = {};
      for (const key of Object.keys(op.props)) {
        props[key] = Object.hasOwn(node, key) ? clone(node[key]) : null;
      }
      return [
        {
          op: "setNodeProps",
          id: op.id,
          props: props as Extract<SceneOp, { op: "setNodeProps" }>["props"],
        },
      ];
    }
    case "retime": {
      const node = requireNode(scene, op.id).node;
      if (
        (op.from !== undefined && node.from === undefined) ||
        (op.duration !== undefined && node.duration === undefined)
      ) {
        return replaceNodePatch(scene, node.id);
      }
      return [
        {
          op: "retime",
          id: op.id,
          ...(op.from === undefined ? {} : { from: node.from }),
          ...(op.duration === undefined ? {} : { duration: node.duration }),
        },
      ];
    }
    case "setAnimations": {
      const node = requireNode(scene, op.id).node;
      return node.animations === undefined
        ? replaceNodePatch(scene, node.id)
        : [
            {
              op: "setAnimations",
              id: op.id,
              animations: clone(node.animations),
            },
          ];
    }
    case "insertNode":
      return [{ op: "removeNode", id: op.node.id }];
    case "removeNode": {
      const location = requireNode(scene, op.id);
      return [insertAtLocation(location)];
    }
    case "moveNode": {
      const location = requireNode(scene, op.id);
      return [
        {
          op: "moveNode",
          id: op.id,
          ...(location.parentId === undefined
            ? {}
            : { parentId: location.parentId }),
          ...(location.beforeId === undefined
            ? {}
            : { beforeId: location.beforeId }),
        },
      ];
    }
    case "setAsset": {
      const old = scene.assets[op.asset.id];
      return old
        ? [{ op: "setAsset", asset: clone(old) }]
        : [{ op: "removeAsset", id: op.asset.id }];
    }
    case "removeAsset":
      return [{ op: "setAsset", asset: clone(scene.assets[op.id]!) }];
    case "setSceneMeta":
      return [
        {
          op: "setSceneMeta",
          ...(op.width === undefined ? {} : { width: scene.width }),
          ...(op.height === undefined ? {} : { height: scene.height }),
          ...(op.fps === undefined ? {} : { fps: scene.fps }),
          ...(op.duration === undefined ? {} : { duration: scene.duration }),
        },
      ];
    case "setMarker":
      return [
        {
          op: "setMarker",
          name: op.name,
          frame: Object.hasOwn(scene.markers ?? {}, op.name)
            ? scene.markers![op.name]!
            : null,
        },
      ];
    case "setAudioBus":
      return [
        {
          op: "setAudioBus",
          name: op.name,
          bus: Object.hasOwn(scene.audioBuses ?? {}, op.name)
            ? clone(scene.audioBuses![op.name]!)
            : null,
        },
      ];
  }
}

function simulateOp(scene: Scene, op: SceneOp): void {
  const index = indexNodes(scene);
  switch (op.op) {
    case "setStyle": {
      const node = index.get(op.id)!.node;
      const style = { ...(node.style ?? {}) } as Record<string, unknown>;
      for (const [key, value] of Object.entries(op.style)) {
        if (value === null) delete style[key];
        else style[key] = clone(value);
      }
      node.style = style as SceneNode["style"];
      return;
    }
    case "setText":
      index.get(op.id)!.node.text = op.text;
      return;
    case "setNodeProps": {
      const node = index.get(op.id)!.node as Record<string, unknown>;
      for (const [key, value] of Object.entries(op.props)) {
        if (value === null) delete node[key];
        else node[key] = clone(value);
      }
      return;
    }
    case "retime": {
      const node = index.get(op.id)!.node;
      if (op.from !== undefined) node.from = op.from;
      if (op.duration !== undefined) node.duration = op.duration;
      return;
    }
    case "setAnimations":
      index.get(op.id)!.node.animations = clone(op.animations);
      return;
    case "insertNode": {
      const siblings = op.parentId
        ? ((index.get(op.parentId)!.node.children ??= []) as MutableNode[])
        : (scene.nodes as MutableNode[]);
      const position = op.beforeId
        ? siblings.findIndex((node) => node.id === op.beforeId)
        : siblings.length;
      siblings.splice(position, 0, clone(op.node) as MutableNode);
      return;
    }
    case "removeNode": {
      const entry = index.get(op.id)!;
      entry.siblings.splice(entry.siblings.indexOf(entry.node), 1);
      return;
    }
    case "moveNode": {
      const entry = index.get(op.id)!;
      const target = op.parentId
        ? ((index.get(op.parentId)!.node.children ??= []) as MutableNode[])
        : (scene.nodes as MutableNode[]);
      entry.siblings.splice(entry.siblings.indexOf(entry.node), 1);
      const position = op.beforeId
        ? target.findIndex((node) => node.id === op.beforeId)
        : target.length;
      target.splice(position, 0, entry.node);
      return;
    }
    case "setAsset":
      scene.assets[op.asset.id] = clone(op.asset);
      return;
    case "removeAsset":
      delete scene.assets[op.id];
      return;
    case "setSceneMeta":
      if (op.width !== undefined) scene.width = op.width;
      if (op.height !== undefined) scene.height = op.height;
      if (op.fps !== undefined) scene.fps = op.fps;
      if (op.duration !== undefined) scene.duration = op.duration;
      return;
    case "setMarker":
      scene.markers ??= {};
      if (op.frame === null) delete scene.markers[op.name];
      else scene.markers[op.name] = op.frame;
      if (Object.keys(scene.markers).length === 0) delete scene.markers;
      return;
    case "setAudioBus":
      scene.audioBuses ??= {};
      if (op.bus === null) delete scene.audioBuses[op.name];
      else scene.audioBuses[op.name] = clone(op.bus);
      if (Object.keys(scene.audioBuses).length === 0) delete scene.audioBuses;
  }
}

function replaceNodePatch(scene: Scene, id: string): ScenePatch {
  const location = requireNode(scene, id);
  return [{ op: "removeNode", id }, insertAtLocation(location)];
}

function insertAtLocation(location: NodeLocation): SceneOp {
  return {
    op: "insertNode",
    node: clone(location.node),
    ...(location.parentId === undefined ? {} : { parentId: location.parentId }),
    ...(location.beforeId === undefined ? {} : { beforeId: location.beforeId }),
  };
}

type NodeLocation = {
  node: MutableNode;
  siblings: MutableNode[];
  parentId?: string;
  beforeId?: string;
};

function indexNodes(scene: Scene): Map<string, NodeLocation> {
  const result = new Map<string, NodeLocation>();
  const visit = (nodes: MutableNode[], parentId: string | undefined): void => {
    nodes.forEach((node, index) => {
      result.set(node.id, {
        node,
        siblings: nodes,
        ...(parentId === undefined ? {} : { parentId }),
        ...(nodes[index + 1] ? { beforeId: nodes[index + 1]!.id } : {}),
      });
      visit(node.children ?? [], node.id);
    });
  };
  visit(scene.nodes as MutableNode[], undefined);
  return result;
}

function requireNode(scene: Scene, id: string): NodeLocation {
  const location = indexNodes(scene).get(id);
  if (!location)
    throw new Error(`Invariant: node ${JSON.stringify(id)} is missing.`);
  return location;
}

/** Exact restoration fallback using changed root subtrees as atomic units. */
function deriveExactRestorationPatch(
  current: Scene,
  target: Scene,
): ScenePatch {
  const patch: ScenePatch = [];
  const currentRoots = current.nodes as MutableNode[];
  const targetRoots = target.nodes as MutableNode[];
  const currentOrder = currentRoots.map((node) => node.id);
  const targetOrder = targetRoots.map((node) => node.id);
  const orderChanged = !deepEqual(currentOrder, targetOrder);
  const currentById = new Map(currentRoots.map((node) => [node.id, node]));
  const targetById = new Map(targetRoots.map((node) => [node.id, node]));
  const replace = new Set<string>();

  if (orderChanged) {
    currentOrder.forEach((id) => replace.add(id));
    targetOrder.forEach((id) => replace.add(id));
  } else {
    for (const id of new Set([...currentOrder, ...targetOrder])) {
      if (!deepEqual(currentById.get(id), targetById.get(id))) replace.add(id);
    }
  }

  for (const node of currentRoots) {
    if (replace.has(node.id)) patch.push({ op: "removeNode", id: node.id });
  }

  for (const [id, asset] of Object.entries(target.assets).sort(([a], [b]) =>
    compareCodeUnits(a, b),
  )) {
    if (!deepEqual(current.assets[id], asset)) {
      patch.push({ op: "setAsset", asset: clone(asset) });
    }
  }
  for (const [name, bus] of Object.entries(target.audioBuses ?? {}).sort(
    ([a], [b]) => compareCodeUnits(a, b),
  )) {
    if (!deepEqual(current.audioBuses?.[name], bus)) {
      patch.push({ op: "setAudioBus", name, bus: clone(bus) });
    }
  }

  const meta: Extract<SceneOp, { op: "setSceneMeta" }> = {
    op: "setSceneMeta",
  };
  if (current.width !== target.width) meta.width = target.width;
  if (current.height !== target.height) meta.height = target.height;
  if (current.fps !== target.fps) meta.fps = target.fps;
  if (current.duration !== target.duration) meta.duration = target.duration;
  if (Object.keys(meta).length > 1) patch.push(meta);

  for (const name of Array.from(
    new Set([
      ...Object.keys(current.markers ?? {}),
      ...Object.keys(target.markers ?? {}),
    ]),
  ).sort(compareCodeUnits)) {
    const before = current.markers?.[name];
    const after = target.markers?.[name];
    if (before !== after) {
      patch.push({ op: "setMarker", name, frame: after ?? null });
    }
  }

  let beforeId: string | undefined;
  for (let index = targetRoots.length - 1; index >= 0; index -= 1) {
    const node = targetRoots[index]!;
    if (replace.has(node.id)) {
      patch.push({
        op: "insertNode",
        node: clone(node),
        ...(beforeId === undefined ? {} : { beforeId }),
      });
    }
    beforeId = node.id;
  }

  for (const id of Object.keys(current.assets).sort(compareCodeUnits)) {
    if (!Object.hasOwn(target.assets, id))
      patch.push({ op: "removeAsset", id });
  }
  for (const name of Object.keys(current.audioBuses ?? {}).sort(
    compareCodeUnits,
  )) {
    if (!Object.hasOwn(target.audioBuses ?? {}, name)) {
      patch.push({ op: "setAudioBus", name, bus: null });
    }
  }
  return patch;
}

function affectedIdsForPatch(before: Scene, patch: ScenePatch): string[] {
  const ids: string[] = [];
  const addNode = (node: SceneNode): void => {
    ids.push(node.id);
    node.children?.forEach(addNode);
  };
  const draft = clone(before);
  for (const op of patch) {
    if ("id" in op) ids.push(op.id);
    if (op.op === "insertNode") {
      addNode(op.node);
      if (op.parentId) ids.push(op.parentId);
    }
    if (op.op === "removeNode" || op.op === "moveNode") {
      const source = requireNode(draft, op.id);
      if (source.parentId) ids.push(source.parentId);
      if (op.op === "removeNode") addNode(source.node);
      if (op.op === "moveNode" && op.parentId) ids.push(op.parentId);
    }
    if (op.op === "setAsset") ids.push(op.asset.id);
    if (op.op === "setMarker" || op.op === "setAudioBus") ids.push(op.name);
    simulateOp(draft, op);
  }
  return stableUnique(ids);
}

function diffCanonicalScenes(
  before: Scene,
  after: Scene,
): WorkspaceSemanticDiff {
  const changes: WorkspaceSemanticChange[] = [];
  diffValue(before, after, [], changes);
  return {
    equal: changes.length === 0,
    summary: {
      added: changes.filter((change) => change.kind === "add").length,
      removed: changes.filter((change) => change.kind === "remove").length,
      changed: changes.filter(
        (change) => change.kind === "change" || change.kind === "order",
      ).length,
    },
    changes,
  };
}

function diffValue(
  before: unknown,
  after: unknown,
  path: Array<string | number>,
  changes: WorkspaceSemanticChange[],
): void {
  if (deepEqual(before, after)) return;
  if (Array.isArray(before) && Array.isArray(after)) {
    if (isIdArray(before) && isIdArray(after)) {
      const beforeOrder = before.map((value) => value.id);
      const afterOrder = after.map((value) => value.id);
      if (!deepEqual(beforeOrder, afterOrder)) {
        changes.push({
          kind: "order",
          path: [...path],
          before: beforeOrder,
          after: afterOrder,
        });
      }
      const beforeMap = new Map(before.map((value) => [value.id, value]));
      const afterMap = new Map(after.map((value) => [value.id, value]));
      for (const id of Array.from(
        new Set([...beforeMap.keys(), ...afterMap.keys()]),
      ).sort(compareCodeUnits)) {
        diffOptional(
          beforeMap.get(id),
          afterMap.get(id),
          [...path, id],
          changes,
        );
      }
      return;
    }
    const length = Math.max(before.length, after.length);
    for (let index = 0; index < length; index += 1) {
      diffOptional(before[index], after[index], [...path, index], changes);
    }
    return;
  }
  if (isRecord(before) && isRecord(after)) {
    const keys = Array.from(
      new Set([...Object.keys(before), ...Object.keys(after)]),
    ).sort(compareCodeUnits);
    for (const key of keys) {
      diffOptional(before[key], after[key], [...path, key], changes);
    }
    return;
  }
  changes.push({
    kind: "change",
    path,
    before: clone(before),
    after: clone(after),
  });
}

function diffOptional(
  before: unknown,
  after: unknown,
  path: Array<string | number>,
  changes: WorkspaceSemanticChange[],
): void {
  if (before === undefined && after !== undefined) {
    changes.push({ kind: "add", path, after: clone(after) });
  } else if (before !== undefined && after === undefined) {
    changes.push({ kind: "remove", path, before: clone(before) });
  } else {
    diffValue(before, after, path, changes);
  }
}

function isIdArray(
  value: unknown[],
): value is Array<Record<string, unknown> & { id: string }> {
  if (
    !value.every((entry) => isRecord(entry) && typeof entry.id === "string")
  ) {
    return false;
  }
  const ids = value.map(
    (entry) => (entry as Record<string, unknown> & { id: string }).id,
  );
  return new Set(ids).size === ids.length;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function deepEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) && Array.isArray(right)) {
    return (
      left.length === right.length &&
      left.every((value, index) => deepEqual(value, right[index]))
    );
  }
  if (isRecord(left) && isRecord(right)) {
    const leftKeys = Object.keys(left).sort(compareCodeUnits);
    const rightKeys = Object.keys(right).sort(compareCodeUnits);
    return (
      deepEqual(leftKeys, rightKeys) &&
      leftKeys.every((key) => deepEqual(left[key], right[key]))
    );
  }
  return false;
}

function stableUnique(values: readonly string[]): string[] {
  return Array.from(new Set(values)).sort(compareCodeUnits);
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function jsonSafeNumber(value: number): number | string {
  return Number.isFinite(value) ? value : String(value);
}

function formatCommandErrors(errors: CommandError[]): string {
  return errors
    .map(
      (error) =>
        `command ${error.commandIndex} (${error.kind}) ${error.path}: ${error.message}`,
    )
    .join("\n");
}

function formatPatchErrors(errors: ScenePatchError[]): string {
  return errors
    .map((error) => `patch op ${error.opIndex}: ${error.message}`)
    .join("\n");
}

function clone<T>(value: T): T {
  return value === undefined ? value : structuredClone(value);
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return value;
  }
  Object.freeze(value);
  for (const child of Object.values(value as Record<string, unknown>)) {
    deepFreeze(child);
  }
  return value;
}
