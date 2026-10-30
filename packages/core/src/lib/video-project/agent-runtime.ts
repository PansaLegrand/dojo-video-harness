import { z } from "zod/v3";
import { sceneNodeSchema, type SceneNodeInput } from "@motionforge/schema";
import { expandVideoAgentSceneMacros } from "@/lib/video-agent/scene-macros";
import { expandAnimationPresets } from "@/lib/video-agent/animation-presets";
import { extractVideoAgentModelJson } from "@/lib/video-agent/model-json";
import { getEditorFontAssets } from "@/lib/editor/fonts";
import {
  motionTemplateOf,
  updateMotionGraphic,
} from "@/lib/motion-graphics/templates";
import { editorCommandsToVideoCommands } from "./commands";
import {
  executeVideoProjectCommands,
  type VideoProjectCommand,
} from "./commands";
import {
  parseVideoProjectDocument,
  hashVideoProjectDocument,
  type VideoProjectDocument,
} from "./document";
import { compileVideoProjectDocument } from "./compilation";
import {
  captionSourceCommands,
  speechBindingCommand,
  speechCutCommands,
} from "./semantic";
import { sourceWindow } from "./source-clock";
import { canonicalSerialize } from "./document";
import {
  agentContextSchema,
  VIDEO_PROJECT_AGENT_CONTRACT,
  VIDEO_PROJECT_AGENT_VERSION,
  type VideoProjectAgentProposal,
} from "./agent-types";
import {
  NATIVE_AGENT_CONTEXT_MAX_CHARS,
  planNativeAgentContext,
} from "./agent-context";
import { buildNativeAgentSystemPrompt } from "./agent-prompt";
import {
  NATIVE_AGENT_HOST_ONLY_OPERATIONS,
  nativeAgentModelResultSchema,
  nativeAgentPropertySchema,
  nativeGraphicSchema,
} from "./agent-schema";
import { nativeAgentDiagnosticError } from "./agent-diagnostics";
import {
  assertNativeTranscriptCoverage,
  nativeTranscriptScopedSourceItemIds,
} from "./agent-transcript-search";
import {
  nativeAuthoringSchema,
  type NativeAuthoring,
  type NativeClarification,
} from "./agent-authoring";
import { NativeAgentScopeSession } from "./agent-scope";
import {
  nativeFallbackClarification,
  validateNativeClarification,
} from "./agent-clarification";
import {
  buildEditorCapabilityCommands,
  editorCapabilityGuide,
} from "./capabilities";
import { isVideoCompositionCommand } from "./composition-commands";
import { nativeChangedItemIds } from "./agent-review";

export const nativeAgentRequestSchema = z
  .object({
    contract: z.literal(VIDEO_PROJECT_AGENT_CONTRACT),
    version: z.literal(VIDEO_PROJECT_AGENT_VERSION),
    baseRevision: z.number().int().nonnegative(),
    baseHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    visualDocumentHash: z
      .string()
      .regex(/^sha256:[a-f0-9]{64}$/)
      .optional(),
    document: z.unknown(),
    context: agentContextSchema,
    instruction: z.string().max(4000).optional(),
    authoring: nativeAuthoringSchema.optional(),
  })
  .strict();
export type NativeAgentRequest = z.infer<typeof nativeAgentRequestSchema>;
export type NativeAgentResult = {
  contract: typeof VIDEO_PROJECT_AGENT_CONTRACT;
  version: 1;
  baseRevision: number;
  baseHash: string;
  outcome: "proposal" | "answer" | "needs_input";
  summary: string;
  proposal: VideoProjectAgentProposal | null;
  clarification?: NativeClarification;
};

export function validateNativeVisualWitness(
  document: VideoProjectDocument,
  baseHash: string,
  context: z.infer<typeof agentContextSchema>,
) {
  const witness = context.visualWitness;
  if (!witness) return;
  if (
    witness.documentHash !== baseHash ||
    witness.frame !== context.playheadFrame ||
    !context.selectedItemIds.includes(witness.itemId)
  )
    throw new Error(
      "Preview evidence belongs to another document, selection or frame.",
    );
  const item = document.items.find((item) => item.id === witness.itemId);
  if (
    !item ||
    witness.frame < (item.node.from ?? 0) ||
    witness.frame >= (item.node.from ?? 0) + item.node.duration!
  )
    throw new Error(
      "The selected item is not visible at the supplied preview frame.",
    );
  if (item.node.assetId) {
    if (
      witness.sourceId !== item.node.assetId ||
      witness.sourceRevision !== document.sources[item.node.assetId]?.revision
    )
      throw new Error(
        "Preview evidence belongs to another media source revision.",
      );
    if (["video", "audio"].includes(item.node.type)) {
      const window = sourceWindow(item, document.format.fps);
      const time =
        window.startMs +
        ((witness.frame - window.from) / document.format.fps) *
          1000 *
          window.rate;
      if (
        witness.sourceTimeMs === undefined ||
        Math.abs(witness.sourceTimeMs - time) > 1
      )
        throw new Error(
          "Preview evidence does not match the selected source clock.",
        );
    }
  } else if (
    witness.sourceId ||
    witness.sourceRevision ||
    witness.sourceTimeMs !== undefined
  )
    throw new Error(
      "Graphic preview evidence cannot claim an unrelated media source.",
    );
}
/** A proposal that interpreted pixels also depends on the content visible at that frame. */
export function nativeVisualFrameBasis(
  document: VideoProjectDocument,
  frame: number,
) {
  const visibleTracks = new Set(
    document.tracks.filter((track) => !track.hidden).map((track) => track.id),
  );
  const items = document.items.filter(
    (item) =>
      visibleTracks.has(item.trackId) &&
      item.node.type !== "audio" &&
      (item.node.from ?? 0) <= frame &&
      frame < (item.node.from ?? 0) + item.node.duration!,
  );
  return canonicalSerialize({
    format: document.format,
    items,
    tracks: document.tracks.filter((track) =>
      items.some((item) => item.trackId === track.id),
    ),
    sources: document.sources,
    bindings: Object.values(document.bindings).filter((binding) =>
      items.some((item) => item.id === binding.itemId),
    ),
  });
}

function normalizeAnimations(node: SceneNodeInput): unknown {
  return {
    ...node,
    animations: node.animations
      ? expandAnimationPresets(node.animations, {
          from: node.from ?? 0,
          duration: node.duration,
        })
      : undefined,
    children: node.children?.map(normalizeAnimations),
  };
}
function graphicCommands(
  document: VideoProjectDocument,
  input: z.infer<typeof nativeGraphicSchema>,
): VideoProjectCommand[] {
  if (["captions", "subtitles"].includes(String(input.node.macro)))
    throw new Error(
      "Use captionSource for speech, or native caption cues for supplied text. Caption timing must remain editable.",
    );
  const expanded = expandVideoAgentSceneMacros({
    ...document.format,
    duration: document.format.durationInFrames,
    assets: document.assets,
    nodes: [{ ...input.node, id: input.itemId }],
  });
  if (expanded.errors.length) throw new Error(expanded.errors.join(" "));
  const roots = (expanded.value as { nodes: SceneNodeInput[] }).nodes.map(
    (node) => sceneNodeSchema.parse(normalizeAnimations(node)),
  );
  if (!roots.length)
    throw new Error("The requested graphic produced no nodes.");
  const from = Math.min(...roots.map((node) => node.from ?? 0));
  const end = Math.max(
    ...roots.map(
      (node) =>
        (node.from ?? 0) + (node.duration ?? document.format.durationInFrames),
    ),
  );
  const node: SceneNodeInput =
    roots.length === 1 && roots[0]!.id === input.itemId
      ? { ...roots[0]!, from, duration: end - from }
      : {
          id: input.itemId,
          type: "div",
          from,
          duration: end - from,
          style: { position: "absolute", inset: 0, zIndex: 40 },
          children: roots.map((root, index) => ({
            ...root,
            id:
              root.id === input.itemId
                ? `${input.itemId}:root:${index}`
                : root.id,
            from: (root.from ?? 0) - from,
          })),
        };
  const fonts = new Set<string>();
  const visit = (entry: SceneNodeInput) => {
    if (entry.style?.fontFamily) fonts.add(entry.style.fontFamily);
    entry.children?.forEach(visit);
  };
  visit(node);
  const fontCommands: VideoProjectCommand[] = [...fonts]
    .flatMap(getEditorFontAssets)
    .filter((asset) => !document.assets[asset.id])
    .map((asset) => ({ type: "addAsset", asset }));
  return [
    ...fontCommands,
    {
      type: "addItem",
      item: {
        id: input.itemId,
        trackId: input.trackId,
        name: input.name,
        node,
      },
    },
  ];
}

/** Worker and host both replay this pure function. A worker can propose commands, never replace state. */
export async function compileNativeAgentResult(
  requestInput: unknown,
  modelOutput: unknown,
): Promise<NativeAgentResult> {
  const request = nativeAgentRequestSchema.parse(requestInput);
  const base = parseVideoProjectDocument(request.document);
  if ((await hashVideoProjectDocument(base)) !== request.baseHash)
    throw new Error("Native agent snapshot hash mismatch.");
  validateNativeVisualWitness(
    base,
    request.visualDocumentHash ?? request.baseHash,
    request.context,
  );
  let rawOutput: unknown;
  try {
    rawOutput =
      typeof modelOutput === "string"
        ? extractVideoAgentModelJson(modelOutput)
        : modelOutput;
  } catch (cause) {
    throw nativeAgentDiagnosticError(cause, { json: true });
  }
  const checked = nativeAgentModelResultSchema.safeParse(rawOutput);
  if (!checked.success)
    throw nativeAgentDiagnosticError(checked.error, { modelOutput: rawOutput });
  const parsed = checked.data;
  assertNativeTranscriptCoverage({ ...request, document: base }, parsed);
  const scope = new NativeAgentScopeSession(base, request.authoring?.scope);
  const clarification = parsed.clarification
    ? validateNativeClarification(base, parsed.clarification)
    : request.authoring && parsed.outcome === "needs_input"
      ? nativeFallbackClarification(parsed.summary)
      : undefined;
  if (parsed.outcome !== "proposal")
    return {
      contract: VIDEO_PROJECT_AGENT_CONTRACT,
      version: 1,
      baseRevision: request.baseRevision,
      baseHash: request.baseHash,
      outcome: parsed.outcome,
      summary: parsed.summary,
      proposal: null,
      ...(clarification ? { clarification } : {}),
    };
  let document = base;
  const commands: VideoProjectCommand[] = [];
  for (const [commandIndex, candidate] of parsed.commands.entries()) {
    try {
      if (candidate.type === "applyCapability" && !request.authoring)
        throw new Error(
          "This action requires the current explicit authoring contract. Use ordinary native commands for legacy requests.",
        );
      if (
        isVideoCompositionCommand(candidate) &&
        !request.authoring &&
        !base.transitions &&
        !base.linkedGroups
      )
        throw new Error(
          "Composition actions require the current explicit authoring contract.",
        );
      if (candidate.type === "set") {
        const property = nativeAgentPropertySchema(
          candidate.target.kind,
          candidate.path,
        );
        const value = property?.safeParse(candidate.value);
        if (value && !value.success)
          throw new z.ZodError(
            value.error.issues.map((issue) => ({
              ...issue,
              path: [...candidate.path, ...issue.path],
            })),
          );
      }
      if (candidate.type === "updateMotionGraphic") {
        const item = document.items.find(
          (item) => item.id === candidate.itemId,
        );
        if (!item || !motionTemplateOf(item))
          throw new Error("Select an existing motion graphics template.");
        const media =
          candidate.imageAssetId === null
            ? null
            : candidate.imageAssetId
              ? document.assets[candidate.imageAssetId]
              : undefined;
        if (
          (media && media.type !== "image") ||
          (candidate.imageAssetId && !media)
        )
          throw new Error("Choose an existing image asset.");
        const changed = updateMotionGraphic(
          item,
          document.format,
          candidate.patch,
          media,
        );
        const end = (changed.node.from ?? 0) + changed.node.duration!;
        const edits = editorCommandsToVideoCommands(document, [
          ...(end > document.format.durationInFrames
            ? [
                {
                  type: "updateFormat" as const,
                  patch: { durationInFrames: end },
                },
              ]
            : []),
          {
            type: "updateItem",
            id: item.id,
            patch: { node: changed.node, motionGraphic: changed.motionGraphic },
          },
        ]);
        const execution = executeVideoProjectCommands(document, edits);
        scope.check(candidate, document, execution);
        document = execution.document;
        commands.push(...edits);
        continue;
      }
      // Models cannot fabricate evidence, immutable identity, or bypass source-word resolution.
      if (
        (NATIVE_AGENT_HOST_ONLY_OPERATIONS as readonly string[]).includes(
          candidate.type,
        )
      )
        throw new Error(
          "Evidence and source bindings must come from host-resolved sources and words.",
        );
      if (
        /\b(spoken|speech|says?|said|fillers?|silences?)\b|说到|说出|说的|口癖|停顿/i.test(
          request.instruction ?? "",
        ) &&
        (["trimItem", "splitItem", "removeTimelineRange"].includes(
          candidate.type,
        ) ||
          (candidate.type === "set" &&
            ["from", "duration", "videoStartTime", "audioStartTime"].includes(
              candidate.path[0]!,
            )))
      )
        throw new Error(
          "Speech timing edits must identify source word IDs through cutSpeech or anchorSpeech, not model-authored timestamps.",
        );
      const next =
        candidate.type === "insertGraphic"
          ? graphicCommands(document, candidate)
          : candidate.type === "captionSource"
            ? captionSourceCommands(document, candidate)
            : candidate.type === "cutSpeech"
              ? speechCutCommands(document, candidate)
              : candidate.type === "anchorSpeech"
                ? [speechBindingCommand(document, candidate)]
                : candidate.type === "applyCapability"
                  ? buildEditorCapabilityCommands(document, candidate.action)
                  : [candidate as VideoProjectCommand];
      const execution = executeVideoProjectCommands(document, next);
      scope.check(candidate, document, execution);
      document = execution.document;
      commands.push(...next);
    } catch (cause) {
      throw nativeAgentDiagnosticError(cause, {
        commandIndex,
        command: candidate,
      });
    }
  }
  scope.finish(document);
  const normalizedCommands = JSON.parse(
    canonicalSerialize(commands),
  ) as VideoProjectCommand[];
  const execution = executeVideoProjectCommands(base, normalizedCommands);
  if ((await hashVideoProjectDocument(execution.document)) === request.baseHash)
    throw new Error("The proposed commands did not change the project.");
  compileVideoProjectDocument(
    execution.document,
    Object.fromEntries(
      Object.keys(base.assets).map((key) => [key, `asset:${key}`]),
    ),
  );
  return {
    contract: VIDEO_PROJECT_AGENT_CONTRACT,
    version: 1,
    baseRevision: request.baseRevision,
    baseHash: request.baseHash,
    outcome: "proposal",
    summary: parsed.summary,
    proposal: {
      commands: normalizedCommands,
      summary: parsed.summary,
      changedItemIds: nativeChangedItemIds(
        base,
        execution.document,
        execution.changedItemIds,
      ),
      impact: scope.propagatedItemIds.size ? "review" : execution.impact,
      previewHash: await hashVideoProjectDocument(execution.document),
      ...(request.authoring?.scope
        ? { propagatedItemIds: [...scope.propagatedItemIds] }
        : {}),
    },
  };
}

export function buildNativeAgentPrompts(input: {
  instruction: string;
  baseHash?: string;
  authoring?: NativeAuthoring;
  document: VideoProjectDocument;
  context: z.infer<typeof agentContextSchema>;
  messages: Array<{ role: string; text: string }>;
}) {
  const { visualWitness, ...context } = input.context;
  const conversation: Array<{ role: string; text: string }> = [];
  let conversationChars = 0;
  for (const message of input.messages.slice(-12).reverse()) {
    const excerpt = { role: message.role, text: message.text.slice(0, 2000) };
    const size = JSON.stringify(excerpt).length + 1;
    if (conversationChars + size > 24_000) break;
    conversation.unshift(excerpt);
    conversationChars += size;
  }
  const envelope = {
    instruction: input.instruction,
    snapshotHash: input.baseHash,
    ...(input.authoring ? { authoring: input.authoring } : {}),
    context: {
      ...context,
      ...(visualWitness
        ? {
            visualWitness: {
              ...visualWitness,
              imageDataUrl: undefined,
              evidenceType: "user-captured-preview-frame",
            },
          }
        : {}),
    },
    conversation,
  };
  const availableChars = Math.min(
    NATIVE_AGENT_CONTEXT_MAX_CHARS,
    240_000 - JSON.stringify(envelope).length - 1024,
  );
  const scopedSources = nativeTranscriptScopedSourceItemIds({
    ...input,
    baseHash: input.baseHash ?? "",
  });
  const scopedAssets =
    scopedSources === null
      ? null
      : new Set(
          input.document.items
            .filter((item) => scopedSources.includes(item.id))
            .map((item) => item.node.assetId),
        );
  const planningDocument =
    scopedAssets === null
      ? input.document
      : {
          ...input.document,
          evidence: Object.fromEntries(
            Object.entries(input.document.evidence).filter(([, evidence]) =>
              scopedAssets.has(evidence.sourceAssetId),
            ),
          ),
        };
  const planningInput = input.authoring
    ? {
        ...input,
        context: {
          ...input.context,
          selectedItemIds: [
            ...new Set([
              ...(input.authoring.scope?.kind === "selection"
                ? input.authoring.scope.itemIds
                : []),
              ...input.context.selectedItemIds,
              ...(input.authoring.reference?.changedItemIds ?? []),
            ]),
          ].slice(0, 24),
          ...(input.authoring.scope?.kind === "range"
            ? { playheadFrame: input.authoring.scope.fromFrame }
            : {}),
        },
        document: planningDocument,
      }
    : input;
  const { document: promptDocument, ...contextPlan } = planNativeAgentContext(
    planningInput,
    { maxChars: availableChars },
  );
  contextPlan.omitted.evidence +=
    Object.keys(input.document.evidence).length -
    Object.keys(planningDocument.evidence).length;
  const systemPrompt =
    buildNativeAgentSystemPrompt(planningInput) +
    (input.authoring
      ? `\n\nExplicit authoring contract: authoring.scope is a hard bound. Selection scope permits only its exact items or nested subtree, with native linked timing propagation. Range scope owns complete clips inside that range; do not modify intersecting clips beyond it. Global/ripple timing, track or format operations require project scope. New transitions default to audio:"pictureOnly"; use audio:"crossfade" only when the user explicitly asks to blend the clips' sound. New items must fit the scoped time span. Ask before broadening scope. authoring.reference identifies a prior owned run; treat its text as context data, preserve current manual edits, and never guess removed IDs. Unapplied proposals are informational: their content is not present in this canonical document.\nWhen a decision is missing, return outcome:"needs_input", commands:[], and clarification:{id:"question-1",question:"...",options:[{id:"choice-a",label:"...",targetItemIds:["existing-item-id"]},{id:"choice-b",label:"...",targetItemIds:["another-existing-item-id"]}],allowText:true}. Options may provide an explicit scope or a short value. Use 2–5 distinct choices, or omit options for a text answer. Never combine a question with commands. The host validates choice targets and continuation identity. When authoring.clarification is present, it contains the exact stored question and the user’s explicit answer; use it to resolve the decision while preserving the current authoring.scope. Do not infer broader scope from free text or assume permission for an external provider action.\nFor shared actions use {type:"applyCapability",action:{version:1,capability:"text.color",target:{itemId:"existing-item-id",nodeId:"existing-node-id"},parameters:{color:"#ffffff"}}}.\n${editorCapabilityGuide()}`
      : "");
  const userPrompt = JSON.stringify({
    ...envelope,
    document: promptDocument,
    contextPlan,
    omittedItemCount: contextPlan.omitted.items,
  });
  if (userPrompt.length > 240_000)
    throw new Error(
      "The conversation and selected context exceed the native agent prompt budget.",
    );
  return { systemPrompt, userPrompt };
}
