import { toolMetadata, type AgentTool } from "./catalog.js";
import {
  pagedCompletionRequirementsSchema,
  type CompletionState,
  type CompletionCheck,
  type CompletionReceipt,
  type CompletionRequirement,
} from "./completion.js";
import type { EditArtifactRef } from "./stages.js";
import type { CaptionCueQuery } from "./tools.js";
export type EditorStagePorts<T> = {
  /** New profiles may plan monolingual/creative edits without a translation pair. */
  generalEditing?: boolean;
  planEditStages(input: unknown, signal: AbortSignal): Promise<T>;
  saveCaptionBatch(input: unknown, signal: AbortSignal): Promise<T>;
  readEditArtifact(
    input: { artifactId: string; field?: string; cursor?: string },
    signal: AbortSignal,
  ): Promise<unknown>;
  /** Host-bound prepared commands are fixed before the assembly checkpoint starts. */
  resolvePreparedEdit(input: unknown, signal: AbortSignal): Promise<unknown>;
  preparedCommands: boolean;
  completionState?: CompletionState;
  readCaptionCues?(
    input: CaptionCueQuery,
    signal: AbortSignal,
  ): Promise<unknown>;
  recordReview?(
    input: {
      requirements: CompletionRequirement[];
      edit: unknown;
      checks: CompletionCheck[];
      receipt?: CompletionReceipt;
    },
    signal: AbortSignal,
  ): Promise<void | { reviewRef: EditArtifactRef }>;
  completeEditing?(result: T, signal: AbortSignal): Promise<T>;
};
const id = { type: "string", minLength: 1, maxLength: 191 },
  language = { type: "string", pattern: "^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$" },
  color = { type: "string", pattern: "^#[a-fA-F0-9]{6}$" };
const object = (properties: Record<string, unknown>, required: string[]) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});
const pair = object(
  {
    sourceItemId: id,
    evidenceId: id,
    originalItemId: id,
    translatedItemId: id,
    trackId: id,
    originalLanguage: language,
    translatedLanguage: language,
    originalColor: color,
    translatedColor: color,
    sourceRange: object(
      {
        startMs: { type: "number", minimum: 0 },
        endMs: { type: "number", exclusiveMinimum: 0 },
      },
      ["startMs", "endMs"],
    ),
  },
  [
    "sourceItemId",
    "evidenceId",
    "originalItemId",
    "translatedItemId",
    "trackId",
    "originalLanguage",
    "translatedLanguage",
    "originalColor",
    "translatedColor",
  ],
);
function input(raw: unknown, keys: string[]) {
  if (
    !raw ||
    typeof raw !== "object" ||
    Array.isArray(raw) ||
    Object.keys(raw).some((key) => !keys.includes(key))
  )
    throw new Error("Unknown staged-tool input field.");
  return raw as Record<string, unknown>;
}
export function createStagedEditorTools<T>(
  ports: EditorStagePorts<T>,
  options?: {
    requirementsSchema?: Record<string, unknown>;
    description?: string;
  },
): AgentTool<T>[] {
  return [
    {
      ...toolMetadata("plan_edit_stages"),
      ...(options?.description ? { description: options.description } : {}),
      parameters: object(
        {
          requirements:
            options?.requirementsSchema ?? pagedCompletionRequirementsSchema,
          captionPairs: {
            type: "array",
            minItems: ports.generalEditing ? 0 : 1,
            maxItems: 12,
            items: pair,
          },
        },
        ["requirements", "captionPairs"],
      ),
      execute: async (raw, signal) => {
        input(raw, ["requirements", "captionPairs"]);
        return {
          kind: "terminal",
          result: await ports.planEditStages(raw, signal),
        };
      },
    },
    {
      ...toolMetadata("save_caption_batch"),
      parameters: object(
        {
          translations: {
            type: "array",
            minItems: 1,
            maxItems: 500,
            items: object(
              {
                cueId: id,
                text: { type: "string", minLength: 1, maxLength: 1000 },
              },
              ["cueId", "text"],
            ),
          },
        },
        ["translations"],
      ),
      execute: async (raw, signal) => {
        input(raw, ["translations"]);
        return {
          kind: "terminal",
          result: await ports.saveCaptionBatch(raw, signal),
        };
      },
    },
    {
      ...toolMetadata("read_edit_artifact"),
      parameters: object(
        {
          artifactId: id,
          field: {
            type: "string",
            enum: [
              "default",
              "summary",
              "translations",
              "commands",
              "cues",
              "words",
              "checks",
              "decisions",
            ],
          },
          cursor: { type: "string", minLength: 1, maxLength: 1000 },
        },
        ["artifactId"],
      ),
      execute: async (raw, signal) => {
        const v = input(raw, ["artifactId", "field", "cursor"]);
        if (
          typeof v.artifactId !== "string" ||
          !v.artifactId ||
          v.artifactId.length > 191 ||
          (v.field !== undefined && typeof v.field !== "string") ||
          (v.cursor !== undefined &&
            (typeof v.cursor !== "string" || v.cursor.length > 1000))
        )
          throw new Error("Invalid owned artifact reader input.");
        return {
          kind: "observation",
          pinned: true,
          value: await ports.readEditArtifact(
            v as { artifactId: string; field?: string; cursor?: string },
            signal,
          ),
        };
      },
    },
  ];
}
