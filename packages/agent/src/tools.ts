import { sourceAudioTrackPresence } from "../../core/src/lib/video-project/source-audio";
import { importSvgGraphic } from "@dojo-video-engine/interchange/svg";
import {
  parseThreeScene,
  threeSceneSchema,
  THREE_EXTENSION,
} from "@dojo-video-engine/three/schema";
import { zodToJsonSchema } from "zod-to-json-schema";
import {
  createEditorToolset,
  type AgentTool as KitTool,
  type Skill,
  type AgentProfile,
  type CompletionState,
  usesCompletionPreflight,
  usesPagedReaders,
  usesStagedEditing,
  usesAuthoringContracts,
  usesReviewedEditReferences,
  usesPreviewRepair,
  usesInstalledGraphicsGrammar,
  usesAppendPreviewRepair,
  usesSemanticEditingGuidance,
  type PreviewRepairEvidence,
  type EditorStagePorts,
} from "../../agent-kit/src/index";
import {
  compileNativeAgentResult,
  type NativeAgentRequest,
  type NativeAgentResult,
} from "../../core/src/lib/video-project/agent-runtime";
import {
  nativeCompletionTargetHints,
  nativeAgentGraphicsSchema,
  nativeAgentResponseSchema,
} from "../../core/src/lib/video-project/agent-schema";
import {
  searchNativeTranscript,
  nativeTranscriptScopedSourceItemIds,
} from "../../core/src/lib/video-project/agent-transcript-search";
import { nativeClarificationSchema } from "../../core/src/lib/video-project/agent-authoring";
import { parseVideoProjectDocument } from "../../core/src/lib/video-project/document";
import { prepareReadableOverlay } from "../../core/src/lib/video-project/readable-overlay";
import {
  validateNativeCompletionRequirements,
  reviewNativeCompletionEdit,
  compileNativeCompletionResponse,
} from "../../core/src/lib/video-project/completion-preflight";
import { prepareCaptionPair } from "../../core/src/lib/video-project/caption-pair";
import {
  prepareCompletionCaptionCuePacket,
  prepareCaptionSourceOverview,
} from "../../core/src/lib/video-project/completion-caption-context";
import {
  listNativeAssets,
  readNativeCaptionCues,
} from "../../core/src/lib/video-project/agent-readers";
import type { LoopTool } from "../../agent-loop/src/index";
import { readNativeCaptionTrack } from "../../core/src/lib/video-project/caption-track-reader";
export type AgentTool = Omit<KitTool<NativeAgentResult>, "execute"> &
  Pick<
    LoopTool<NativeAgentResult>,
    "execute" | "replaySafe" | "compactionSafe"
  >;
export const replaySafeNativeToolNames = [
  "inspect_project",
  "read_skill",
  "search_transcript",
  "inspect_graphics_schema",
  "prepare_svg_graphic",
  "prepare_three_scene",
  "prepare_text_overlay",
  "propose_edit",
  "ask_user",
  "review_edit",
  "prepare_caption_pair",
  "list_assets",
  "read_caption_cues",
  "plan_edit_stages",
  "save_caption_batch",
  "read_edit_artifact",
  "read_caption_track",
] as const;
export type ToolOutcome = Awaited<ReturnType<AgentTool["execute"]>>;

/** Local kernel ports. Tool definitions, effects, input bounds and skill gating live in agent-kit. */
export function createVideoToolset(
  request: NativeAgentRequest,
  skills: Skill[],
  extraTools: AgentTool[] = [],
  options: {
    profile?: AgentProfile;
    initialCompletionState?: CompletionState;
    stages?: EditorStagePorts<NativeAgentResult>;
    previewEvidence?: (
      requestId: string,
      signal: AbortSignal,
    ) => Promise<PreviewRepairEvidence>;
  } = {},
) {
  const document = parseVideoProjectDocument(request.document);
  const scopedSources = nativeTranscriptScopedSourceItemIds({
    ...request,
    document,
  });
  const audioAssets = Object.values(document.assets).filter((asset) =>
    ["video", "audio"].includes(asset.type),
  );
  const toolset = createEditorToolset<NativeAgentResult>({
    skills,
    profile: options.profile ?? "local-editor-v1",
    snapshotHash: request.baseHash,
    ...(usesPreviewRepair(options.profile ?? "local-editor-v1")
      ? { previewSnapshotHash: request.visualDocumentHash ?? request.baseHash }
      : {}),
    initialCompletionState: options.initialCompletionState,
    extraTools,
    proposalSchema: nativeAgentResponseSchema({
      clarification: true,
      composition: true,
      anchorHold: usesCompletionPreflight(options.profile ?? "local-editor-v1"),
    }),
    ports: {
      ...(usesPreviewRepair(options.profile ?? "local-editor-v1") &&
      options.previewEvidence
        ? { previewEvidence: options.previewEvidence }
        : {}),
      ...(usesReviewedEditReferences(options.profile ?? "local-editor-v1")
        ? {
            validateRequirements: (raw: unknown) => {
              validateNativeCompletionRequirements(raw);
            },
          }
        : {}),
      ...(usesStagedEditing(options.profile ?? "local-editor-v1")
        ? {
            readCaptionTrack: (
              args: import("../../agent-kit/src/tools").CaptionTrackQuery,
            ) => readNativeCaptionTrack(request, args),
          }
        : {}),
      ...(options.stages ? { stages: options.stages } : {}),
      ...(usesPagedReaders(options.profile ?? "local-editor-v1")
        ? {
            listAssets: (args: unknown) => listNativeAssets(request, args),
            readCaptionCues: (args: unknown, signal: AbortSignal) =>
              options.stages?.readCaptionCues
                ? options.stages.readCaptionCues(
                    args as import("../../agent-kit/src/tools").CaptionCueQuery,
                    signal,
                  )
                : readNativeCaptionCues(request, args),
          }
        : {}),
      inspectGraphicsSchema: (_signal, query) =>
        usesAuthoringContracts(options.profile ?? "local-editor-v1") &&
        query?.kind !== "three"
          ? nativeAgentGraphicsSchema(
              query as { kind?: "native" | "macro"; macro?: string },
              usesInstalledGraphicsGrammar(options.profile ?? "local-editor-v1")
                ? { installedGrammar: true }
                : {},
            )
          : {
              three: zodToJsonSchema(threeSceneSchema, {
                $refStrategy: "none",
              }),
              extension: THREE_EXTENSION,
            },
      inspectProject: (query) => ({
        ...(usesPreviewRepair(options.profile ?? "local-editor-v1")
          ? {
              sourceAudio: {
                sources: audioAssets.slice(0, 50).map((asset) => ({
                  sourceId: asset.id,
                  audioTrack: sourceAudioTrackPresence(document, asset.id),
                })),
                omitted: Math.max(0, audioAssets.length - 50),
                coverage: "listed-sources-only",
              },
            }
          : {}),
        ...(usesReviewedEditReferences(options.profile ?? "local-editor-v1")
          ? { completionTargets: nativeCompletionTargetHints(document.items) }
          : {}),
        ...(usesCompletionPreflight(options.profile ?? "local-editor-v1")
          ? {
              completionCaptionSources: usesStagedEditing(
                options.profile ?? "local-editor-v1",
              )
                ? prepareCaptionSourceOverview(
                    document,
                    scopedSources === null
                      ? query.itemIds
                      : query.itemIds === undefined
                        ? scopedSources
                        : query.itemIds.filter((id) =>
                            scopedSources.includes(id),
                          ),
                    { referenceOnly: true },
                  )
                : prepareCompletionCaptionCuePacket(
                    document,
                    scopedSources === null
                      ? query.itemIds
                      : query.itemIds === undefined
                        ? scopedSources
                        : query.itemIds.filter((id) =>
                            scopedSources.includes(id),
                          ),
                    {
                      pagedReaders: usesPagedReaders(
                        options.profile ?? "local-editor-v1",
                      ),
                    },
                  ),
            }
          : {}),
        snapshotHash: request.baseHash,
        format: document.format,
        assets: Object.values(document.assets)
          .slice(0, 50)
          .map((asset) => ({
            id: asset.id,
            name: asset.name,
            type: asset.type,
            width: asset.width,
            height: asset.height,
            durationSeconds: asset.durationSeconds,
          })),
        omittedAssets: Math.max(0, Object.keys(document.assets).length - 50),
        tracks: document.tracks,
        transitions: document.transitions ?? {},
        linkedGroups: document.linkedGroups ?? {},
        ...(query.itemIds
          ? {
              items: document.items.filter((item) =>
                query.itemIds!.includes(item.id),
              ),
            }
          : {
              items: document.items.slice(0, 300).map((item) => ({
                id: item.id,
                name: item.name,
                type: item.node.type,
                from: item.node.from,
                duration: item.node.duration,
              })),
              omitted: Math.max(0, document.items.length - 300),
            }),
      }),
      searchTranscript: (args) =>
        searchNativeTranscript({ ...request, document }, args),
      prepareSvgGraphic: (input) => {
        const graphic = importSvgGraphic(input.svg, {
          id: input.itemId,
          from: input.from,
          duration: input.duration,
        });
        return {
          command: {
            type: "insertGraphic",
            itemId: input.itemId,
            trackId: input.trackId,
            name: input.name,
            node: graphic.node,
          },
          ids: graphic.ids,
          next: "Include the command in propose_edit; use these stable part IDs for animation or corrections.",
        };
      },
      prepareThreeScene: (input) => ({
        command: {
          type: "insertGraphic",
          itemId: input.itemId,
          trackId: input.trackId,
          name: input.name,
          node: {
            type: "extension",
            from: input.from,
            duration: input.duration,
            style: { position: "absolute", inset: 0 },
            extension: {
              ...THREE_EXTENSION,
              params: parseThreeScene(input.params),
            },
          },
        },
        next: "Include this command in propose_edit.",
      }),
      prepareTextOverlay: (args) => ({
        command: prepareReadableOverlay(document, args),
        next: "Include this command in propose_edit. The host handles application; preparation has not applied an edit.",
      }),
      reviewEdit: (input) =>
        reviewNativeCompletionEdit(request, input, {
          ...(usesAppendPreviewRepair(options.profile ?? "local-editor-v1")
            ? { preserveAuthoredPaintOrder: true }
            : {}),
          ...(usesSemanticEditingGuidance(options.profile ?? "local-editor-v1")
            ? { preciseSpeechDiagnostics: true }
            : {}),
        }),
      prepareCaptionPair: (input) =>
        prepareCaptionPair(document, input, {
          sourceRange: usesPagedReaders(options.profile ?? "local-editor-v1"),
        }),
      proposeEdit: (args, _signal, completion) => {
        if (
          !usesCompletionPreflight(options.profile ?? "local-editor-v1") &&
          (args as { commands?: Array<{ holdMs?: unknown }> })?.commands?.some(
            (command) => Object.hasOwn(command, "holdMs"),
          )
        )
          throw new Error("holdMs requires the completion-preflight profile.");
        return completion
          ? compileNativeCompletionResponse(
              request,
              {
                ...(args as object),
                completion,
              },
              {
                ...(usesAppendPreviewRepair(
                  options.profile ?? "local-editor-v1",
                )
                  ? { preserveAuthoredPaintOrder: true }
                  : {}),
                ...(usesSemanticEditingGuidance(
                  options.profile ?? "local-editor-v1",
                )
                  ? { preciseSpeechDiagnostics: true }
                  : {}),
              },
            )
          : compileNativeAgentResult(request, args);
      },
      askUser: (args) => {
        const clarification = nativeClarificationSchema.parse(args);
        return compileNativeAgentResult(request, {
          outcome: "needs_input",
          summary: clarification.question,
          commands: [],
          clarification,
        });
      },
    },
  });
  return {
    ...toolset,
    tools: toolset.tools.map((tool): AgentTool => {
      const host =
        (options.profile === "local-editor-v10" ||
          options.profile === "local-editor-v11" ||
          options.profile === "local-editor-v12" ||
          options.profile === "local-editor-v13") &&
        [
          "inspect_image",
          "sample_video_frames",
          "request_project_preview",
          "request_project_export",
        ].includes(tool.name)
          ? extraTools?.find((extra) => extra.name === tool.name)
          : undefined;
      return {
        ...tool,
        replaySafe:
          (replaySafeNativeToolNames as readonly string[]).includes(
            tool.name,
          ) || host?.replaySafe === true,
        compactionSafe:
          ["inspect_project", "read_skill"].includes(tool.name) ||
          host?.compactionSafe === true,
      };
    }),
  };
}
export function createVideoTools(
  request: NativeAgentRequest,
  skills: Skill[],
): AgentTool[] {
  return createVideoToolset(request, skills).tools;
}
