import { z } from "zod/v3";
import {
  compileNativeAgentResult,
  type NativeAgentRequest,
  type NativeAgentResult,
} from "../../core/src/lib/video-project/agent-runtime";
import { nativeAgentResponseSchema } from "../../core/src/lib/video-project/agent-schema";
import { searchNativeTranscript } from "../../core/src/lib/video-project/agent-transcript-search";
import { nativeClarificationSchema } from "../../core/src/lib/video-project/agent-authoring";
import { parseVideoProjectDocument } from "../../core/src/lib/video-project/document";
import { readSkill, type Skill } from "./skills";
import { prepareReadableOverlay } from "../../core/src/lib/video-project/readable-overlay";
import type { ToolSpec } from "./types";
export type ToolOutcome =
  | { kind: "observation"; value: unknown }
  | { kind: "terminal"; result: NativeAgentResult };
export type AgentTool = ToolSpec & {
  effect: "read" | "propose" | "ask";
  execute: (args: unknown, signal: AbortSignal) => Promise<ToolOutcome>;
};
const object = (
  properties: Record<string, unknown>,
  required: string[] = [],
) => ({ type: "object", properties, required, additionalProperties: false });
const observed = (value: unknown): ToolOutcome => ({
  kind: "observation",
  value,
});
/** Each tool owns its schema, runtime validation, and effect. A skill grants none of these. */
export function createVideoTools(
  request: NativeAgentRequest,
  skills: Skill[],
): AgentTool[] {
  const document = parseVideoProjectDocument(request.document);
  return [
    {
      name: "prepare_text_overlay",
      effect: "read",
      description:
        "Prepare an editable, bounded title, lower-third or supplied-text caption with readable responsive defaults. Returns an insertGraphic command for propose_edit; never changes the project. Use source-bound captionSource for speech transcription. Excess copy is rejected, never truncated.",
      parameters: object(
        {
          itemId: { type: "string" },
          trackId: { type: "string" },
          kind: { type: "string", enum: ["title", "lowerThird", "caption"] },
          text: { type: "string", maxLength: 240 },
          subtitle: { type: "string", maxLength: 120 },
          from: {
            type: "integer",
            minimum: 0,
            description:
              "Start in integer composition frames, using the inspected project fps.",
          },
          duration: {
            type: "integer",
            minimum: 1,
            description:
              "Length in composition frames, not seconds. Convert requested seconds using the inspected project fps.",
          },
        },
        ["itemId", "trackId", "kind", "text", "from", "duration"],
      ),
      execute: async (args) =>
        observed({
          command: prepareReadableOverlay(document, args),
          next: "Include this command in propose_edit, then compare and approve. No edit has been applied.",
        }),
    },
    {
      name: "inspect_project",
      effect: "read",
      description:
        "Read project relationships, imported asset identities (including unused logos), and up to 24 exact items. Empty input returns a bounded inventory.",
      parameters: object({
        itemIds: { type: "array", items: { type: "string" }, maxItems: 24 },
      }),
      execute: async (args) => {
        const query = z
          .object({ itemIds: z.array(z.string()).max(24).optional() })
          .strict()
          .parse(args);
        return observed({
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
                items: document.items.filter((x) =>
                  query.itemIds!.includes(x.id),
                ),
              }
            : {
                items: document.items.slice(0, 300).map((x) => ({
                  id: x.id,
                  name: x.name,
                  type: x.node.type,
                  from: x.node.from,
                  duration: x.node.duration,
                })),
                omitted: Math.max(0, document.items.length - 300),
              }),
        });
      },
    },
    {
      name: "read_skill",
      effect: "read",
      description: "Read a named editing skill from the advertised index.",
      parameters: object({ name: { type: "string" } }, ["name"]),
      execute: async (args) =>
        observed(
          readSkill(
            skills,
            z.object({ name: z.string() }).strict().parse(args).name,
          ),
        ),
    },
    {
      name: "search_transcript",
      effect: "read",
      description:
        "Find genuine source word IDs in existing evidence. Does not transcribe or upload.",
      parameters: object(
        {
          snapshotHash: { type: "string" },
          query: { type: "string" },
          sourceItemIds: { type: "array", items: { type: "string" } },
          cursor: { type: "string" },
        },
        ["snapshotHash", "query"],
      ),
      execute: async (args) =>
        observed(
          await searchNativeTranscript(
            { ...request, document },
            z
              .object({
                snapshotHash: z.string(),
                query: z.string().min(1).max(160),
                sourceItemIds: z.array(z.string()).max(24).optional(),
                cursor: z.string().max(2000).optional(),
              })
              .strict()
              .parse(args),
          ),
        ),
    },
    {
      name: "propose_edit",
      effect: "propose",
      description:
        "Validate an editing proposal. On success pause for review. Does not commit.",
      parameters: nativeAgentResponseSchema({
        clarification: true,
        composition: true,
      }),
      execute: async (args) => ({
        kind: "terminal",
        result: await compileNativeAgentResult(request, args),
      }),
    },
    {
      name: "ask_user",
      effect: "ask",
      description: "Pause for one explicit question. No document edits occur.",
      parameters: object(
        {
          id: { type: "string" },
          question: { type: "string" },
          options: {
            type: "array",
            minItems: 2,
            maxItems: 5,
            items: object(
              {
                id: { type: "string" },
                label: { type: "string" },
                targetItemIds: { type: "array", items: { type: "string" } },
              },
              ["id", "label"],
            ),
          },
          allowText: { type: "boolean" },
        },
        ["id", "question"],
      ),
      execute: async (args) => {
        const question = nativeClarificationSchema.parse(args);
        return {
          kind: "terminal",
          result: await compileNativeAgentResult(request, {
            outcome: "needs_input",
            summary: question.question,
            commands: [],
            clarification: question,
          }),
        };
      },
    },
  ];
}
