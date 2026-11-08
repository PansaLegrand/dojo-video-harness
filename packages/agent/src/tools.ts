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
} from "../../agent-kit/src/index";
import {
  compileNativeAgentResult,
  type NativeAgentRequest,
  type NativeAgentResult,
} from "../../core/src/lib/video-project/agent-runtime";
import { nativeAgentResponseSchema } from "../../core/src/lib/video-project/agent-schema";
import { searchNativeTranscript } from "../../core/src/lib/video-project/agent-transcript-search";
import { nativeClarificationSchema } from "../../core/src/lib/video-project/agent-authoring";
import { parseVideoProjectDocument } from "../../core/src/lib/video-project/document";
import { prepareReadableOverlay } from "../../core/src/lib/video-project/readable-overlay";
import type { LoopTool } from "../../agent-loop/src/index";
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
] as const;
export type ToolOutcome = Awaited<ReturnType<AgentTool["execute"]>>;

/** Local kernel ports. Tool definitions, effects, input bounds and skill gating live in agent-kit. */
export function createVideoToolset(
  request: NativeAgentRequest,
  skills: Skill[],
  extraTools: AgentTool[] = [],
) {
  const document = parseVideoProjectDocument(request.document);
  const toolset = createEditorToolset<NativeAgentResult>({
    skills,
    profile: "local-editor-v1",
    extraTools,
    proposalSchema: nativeAgentResponseSchema({
      clarification: true,
      composition: true,
    }),
    ports: {
      inspectGraphicsSchema: () => ({
        three: zodToJsonSchema(threeSceneSchema, { $refStrategy: "none" }),
        extension: THREE_EXTENSION,
      }),
      inspectProject: (query) => ({
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
      proposeEdit: (args) => compileNativeAgentResult(request, args),
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
    tools: toolset.tools.map(
      (tool): AgentTool => ({
        ...tool,
        replaySafe: (replaySafeNativeToolNames as readonly string[]).includes(
          tool.name,
        ),
        compactionSafe: ["inspect_project", "read_skill"].includes(tool.name),
      }),
    ),
  };
}
export function createVideoTools(
  request: NativeAgentRequest,
  skills: Skill[],
): AgentTool[] {
  return createVideoToolset(request, skills).tools;
}
