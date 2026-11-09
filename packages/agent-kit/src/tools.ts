import {
  editingOnlyProposalSchema,
  embedEditingSchema,
  assertEditingProposal,
} from "./editing-schema.js";
import {
  toolMetadata,
  type AgentTool,
  type Skill,
  type AgentProfile,
  usesCompletionPreflight,
  usesPagedReaders,
  usesEfficientReaders,
  usesResolvedEditSchema,
  usesStagedEditing,
} from "./catalog.js";
import {
  completionCanonical,
  completionHash,
  parseCompletionRequirements,
  validateCompletionReceipt,
  completionRequirementsSchema,
  pagedCompletionRequirementsSchema,
  type CompletionRequirement,
  type CompletionReceipt,
  type CompletionCheck,
  type CompletionContract,
  type CompletionState,
} from "./completion.js";
import { readSkill, selectSkills } from "./skills.js";
import { buildAgentInventory } from "./inventory.js";
import {
  createStagedEditorTools,
  type EditorStagePorts,
} from "./staged-tools.js";

type MaybePromise<T> = T | Promise<T>;
export type Placement = {
  itemId: string;
  trackId: string;
  name: string;
  from: number;
  duration: number;
};
export type TranscriptQuery = {
  snapshotHash: string;
  query: string;
  sourceItemIds?: string[];
  cursor?: string;
};
export type AssetQuery = {
  snapshotHash: string;
  name?: string;
  type?: "video" | "audio" | "image" | "font" | "lottie";
  usage?: "all" | "used" | "unused";
  cursor?: string;
};
export type CaptionSourceRange = { startMs: number; endMs: number };
export type CaptionCueQuery = {
  snapshotHash: string;
  sourceItemId: string;
  evidenceId: string;
  sourceRange?: CaptionSourceRange;
  cursor?: string;
};
export type CaptionTrackQuery = {
  snapshotHash: string;
  captionItemId: string;
  cursor?: string;
};
export type EditorToolPorts<T> = {
  readCaptionTrack?: (
    input: CaptionTrackQuery,
    signal: AbortSignal,
  ) => MaybePromise<unknown>;
  stages?: EditorStagePorts<T>;
  listAssets?: (args: AssetQuery, signal: AbortSignal) => MaybePromise<unknown>;
  readCaptionCues?: (
    args: CaptionCueQuery,
    signal: AbortSignal,
  ) => MaybePromise<unknown>;
  inspectProject(
    args: { itemIds?: string[] },
    signal: AbortSignal,
  ): MaybePromise<unknown>;
  inspectGraphicsSchema(signal: AbortSignal): MaybePromise<unknown>;
  searchTranscript(
    args: TranscriptQuery,
    signal: AbortSignal,
  ): MaybePromise<unknown>;
  prepareSvgGraphic(
    args: Placement & { svg: string },
    signal: AbortSignal,
  ): MaybePromise<unknown>;
  prepareThreeScene(
    args: Placement & { params: unknown },
    signal: AbortSignal,
  ): MaybePromise<unknown>;
  prepareTextOverlay?: (
    args: unknown,
    signal: AbortSignal,
  ) => MaybePromise<unknown>;
  reviewEdit?: (
    input: { requirements: CompletionRequirement[]; edit: unknown },
    signal: AbortSignal,
  ) => Promise<{ receipt?: CompletionReceipt; checks: CompletionCheck[] }>;
  prepareCaptionPair?: (
    input: unknown,
    signal: AbortSignal,
  ) => MaybePromise<unknown>;
  proposeEdit(
    args: unknown,
    signal: AbortSignal,
    completion?: CompletionContract,
  ): Promise<T>;
  askUser(args: unknown, signal: AbortSignal): Promise<T>;
};
const object = (
  properties: Record<string, unknown> = {},
  required: string[] = [],
) => ({ type: "object", properties, required, additionalProperties: false });
const string = { type: "string" };
const placement = {
  itemId: string,
  trackId: string,
  name: string,
  from: { type: "integer", minimum: 0 },
  duration: { type: "integer", minimum: 1 },
};
function record(
  value: unknown,
  keys: readonly string[],
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Tool input must be an object.");
  for (const key of Object.keys(value))
    if (!keys.includes(key)) throw new Error(`Unknown tool field: ${key}`);
  return value as Record<string, unknown>;
}
function text(
  value: unknown,
  key: string,
  minimum = 0,
  maximum = 300000,
): string {
  if (
    typeof value !== "string" ||
    value.length < minimum ||
    value.length > maximum
  )
    throw new Error(
      `${key} must be a string of ${minimum}–${maximum} characters.`,
    );
  return value;
}
function strings(value: unknown, key: string, maximum: number): string[] {
  if (!Array.isArray(value) || value.length > maximum)
    throw new Error(`${key} exceeds its item limit.`);
  return value.map((entry) => text(entry, key, 0, 191));
}
function placed(value: Record<string, unknown>): Placement {
  if (
    !Number.isInteger(value.from) ||
    (value.from as number) < 0 ||
    !Number.isInteger(value.duration) ||
    (value.duration as number) < 1
  )
    throw new Error(
      "Placement requires integer composition frames and positive duration.",
    );
  return {
    itemId: text(value.itemId, "itemId"),
    trackId: text(value.trackId, "trackId"),
    name: text(value.name, "name"),
    from: value.from as number,
    duration: value.duration as number,
  };
}
const sourceRangeParameters = object(
  {
    startMs: { type: "number", minimum: 0 },
    endMs: { type: "number", exclusiveMinimum: 0 },
  },
  ["startMs", "endMs"],
);
function sourceRange(value: unknown): CaptionSourceRange {
  const input = record(value, ["startMs", "endMs"]);
  if (
    typeof input.startMs !== "number" ||
    !Number.isFinite(input.startMs) ||
    input.startMs < 0 ||
    typeof input.endMs !== "number" ||
    !Number.isFinite(input.endMs) ||
    input.endMs <= input.startMs
  )
    throw new Error(
      "Source range requires finite increasing millisecond times.",
    );
  return { startMs: input.startMs, endMs: input.endMs };
}
const defaultClarification = object(
  {
    id: string,
    question: string,
    options: {
      type: "array",
      minItems: 2,
      maxItems: 5,
      items: object(
        {
          id: string,
          label: string,
          targetItemIds: { type: "array", items: string },
        },
        ["id", "label"],
      ),
    },
    allowText: { type: "boolean" },
  },
  ["id", "question"],
);

/** Only trusted host ports can supply executors. Skills and model output never register tools. */
export function createEditorToolset<T>(input: {
  ports: EditorToolPorts<T>;
  skills: readonly Skill[];
  profile: AgentProfile;
  proposalSchema: Record<string, unknown>;
  clarificationSchema?: Record<string, unknown>;
  extraTools?: readonly AgentTool<T>[];
  snapshotHash?: string;
  initialCompletionState?: CompletionState;
}) {
  const { ports } = input;
  const completion = usesCompletionPreflight(input.profile);
  const stages = usesStagedEditing(input.profile) ? ports.stages : undefined;
  if (usesStagedEditing(input.profile) && !stages)
    throw new Error("Staged profiles require their durable host ports.");
  if (completion && (!ports.reviewEdit || !input.snapshotHash))
    throw new Error(
      "Completion profiles require a preflight port and snapshot identity.",
    );
  if (
    usesPagedReaders(input.profile) &&
    (!ports.listAssets || !ports.readCaptionCues)
  )
    throw new Error("Paged-reader profiles require both reader executors.");
  const initialState = input.initialCompletionState ?? stages?.completionState;
  let state = initialState ? structuredClone(initialState) : undefined;
  const checkedState = async () => {
    if (state) {
      if (
        state.snapshotHash !== input.snapshotHash ||
        state.version !== 1 ||
        (await completionHash(
          parseCompletionRequirements(state.requirements, {
            assetSequence: usesPagedReaders(input.profile),
            speechCallout: usesPagedReaders(input.profile),
          }),
        )) !== state.requirementsHash
      )
        throw new Error(
          "Completion state changed or belongs to another snapshot.",
        );
      if (state.successfulReceipt) {
        const receipt = await validateCompletionReceipt(
          state.successfulReceipt,
        );
        if (
          receipt.snapshotHash !== state.snapshotHash ||
          receipt.requirementsHash !== state.requirementsHash
        )
          throw new Error("Completion review binding changed.");
      }
    }
    return state;
  };
  let skills: Skill[] = [];
  const readerSnapshotHash = (value: unknown) => {
    if (value === undefined && usesEfficientReaders(input.profile))
      return input.snapshotHash!;
    const supplied = text(value, "snapshotHash", 1, 80);
    if (usesEfficientReaders(input.profile) && supplied !== input.snapshotHash)
      throw new Error("Reader snapshot differs from the frozen host snapshot.");
    return supplied;
  };
  const observed = (value: unknown) => ({
    kind: "observation" as const,
    value,
  });
  const tools: AgentTool<T>[] = [
    {
      ...toolMetadata("inspect_project"),
      parameters: object({
        itemIds: { type: "array", items: string, maxItems: 24 },
      }),
      execute: async (args, signal) => {
        const value = record(args, ["itemIds"]);
        return observed(
          await ports.inspectProject(
            value.itemIds === undefined
              ? {}
              : { itemIds: strings(value.itemIds, "itemIds", 24) },
            signal,
          ),
        );
      },
    },
    {
      ...toolMetadata("read_skill"),
      parameters: object({ name: string }, ["name"]),
      execute: async (args) => {
        const value = record(args, ["name"]);
        return observed(readSkill(skills, text(value.name, "name")));
      },
    },
    {
      ...toolMetadata("search_transcript"),
      parameters: object(
        {
          snapshotHash: string,
          query: string,
          sourceItemIds: { type: "array", items: string, maxItems: 24 },
          cursor: string,
        },
        ["snapshotHash", "query"],
      ),
      execute: async (args, signal) => {
        const value = record(args, [
          "snapshotHash",
          "query",
          "sourceItemIds",
          "cursor",
        ]);
        return observed(
          await ports.searchTranscript(
            {
              snapshotHash: text(value.snapshotHash, "snapshotHash"),
              query: text(value.query, "query", 1, 160),
              ...(value.sourceItemIds === undefined
                ? {}
                : {
                    sourceItemIds: strings(
                      value.sourceItemIds,
                      "sourceItemIds",
                      24,
                    ),
                  }),
              ...(value.cursor === undefined
                ? {}
                : { cursor: text(value.cursor, "cursor", 0, 2000) }),
            },
            signal,
          ),
        );
      },
    },
    {
      ...toolMetadata("inspect_graphics_schema"),
      parameters: object(),
      execute: async (args, signal) => {
        record(args, []);
        return observed(await ports.inspectGraphicsSchema(signal));
      },
    },
    {
      ...toolMetadata("prepare_svg_graphic"),
      parameters: object(
        { ...placement, svg: { type: "string", maxLength: 128000 } },
        [...Object.keys(placement), "svg"],
      ),
      execute: async (args, signal) => {
        const value = record(args, [...Object.keys(placement), "svg"]);
        return observed(
          await ports.prepareSvgGraphic(
            { ...placed(value), svg: text(value.svg, "svg", 0, 128000) },
            signal,
          ),
        );
      },
    },
    {
      ...toolMetadata("prepare_three_scene"),
      parameters: object(
        {
          ...placement,
          params: {
            type: "object",
            description:
              "Installed 3D scene schema from inspect_graphics_schema.",
          },
        },
        [...Object.keys(placement), "params"],
      ),
      execute: async (args, signal) => {
        const value = record(args, [...Object.keys(placement), "params"]);
        if (!Object.hasOwn(value, "params"))
          throw new Error("params is required.");
        return observed(
          await ports.prepareThreeScene(
            { ...placed(value), params: value.params },
            signal,
          ),
        );
      },
    },
  ];
  if (ports.prepareTextOverlay)
    tools.push({
      ...toolMetadata("prepare_text_overlay"),
      parameters: object(
        {
          itemId: string,
          trackId: string,
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
            description: "Length in composition frames, not seconds.",
          },
        },
        ["itemId", "trackId", "kind", "text", "from", "duration"],
      ),
      execute: async (args, signal) =>
        observed(await ports.prepareTextOverlay!(args, signal)),
    });
  if (completion) {
    tools.push({
      ...toolMetadata("review_edit"),
      parameters: object(
        {
          requirements: usesPagedReaders(input.profile)
            ? pagedCompletionRequirementsSchema
            : completionRequirementsSchema,
          edit: usesResolvedEditSchema(input.profile)
            ? embedEditingSchema(input.proposalSchema, {
                preparedCommands: stages?.preparedCommands,
              })
            : input.proposalSchema,
        },
        ["edit"],
      ),
      execute: async (args, signal) => {
        const value = record(args, ["requirements", "edit"]);
        await checkedState();
        const declared =
          value.requirements === undefined
            ? state?.requirements
            : parseCompletionRequirements(value.requirements, {
                assetSequence: usesPagedReaders(input.profile),
                speechCallout: usesPagedReaders(input.profile),
              });
        if (!declared)
          throw new Error(
            "Declare all requested outcomes in requirements before the first review.",
          );
        const requirementsHash = await completionHash(declared);
        state ??= {
          version: 1,
          snapshotHash: input.snapshotHash!,
          requirements: declared,
          requirementsHash,
        };
        let checks: CompletionCheck[];
        let receipt: CompletionReceipt | undefined;
        let edit = value.edit;
        try {
          if (stages) edit = await stages.resolvePreparedEdit(edit, signal);
          if (usesResolvedEditSchema(input.profile))
            assertEditingProposal(edit);
          if (requirementsHash !== state.requirementsHash)
            throw new Error(
              "The first valid requirements are frozen. Repair the edit instead of weakening or replacing the checklist.",
            );
          const reviewed = await ports.reviewEdit!(
            { requirements: state.requirements, edit },
            signal,
          );
          checks = reviewed.checks;
          if (!checks.length || checks.length > 40)
            throw new Error("Invalid bounded preflight checks.");
          if (checks.every((check) => check.passed)) {
            const checked = await validateCompletionReceipt(reviewed.receipt);
            if (
              checked.snapshotHash !== state.snapshotHash ||
              checked.requirementsHash !== state.requirementsHash ||
              checked.commandsHash !==
                (await completionHash(
                  (edit as { commands?: unknown })?.commands,
                )) ||
              checked.checksHash !== (await completionHash(reviewed.checks))
            )
              throw new Error(
                "The host preflight receipt does not match the declared edit.",
              );
            receipt = checked;
          }
          await stages?.recordReview?.(
            {
              requirements: state.requirements,
              edit,
              checks,
              ...(receipt ? { receipt } : {}),
            },
            signal,
          );
          if (receipt) state.successfulReceipt = receipt;
        } catch (error) {
          receipt = undefined;
          checks = [
            {
              id: "preflight",
              passed: false,
              message: (error instanceof Error
                ? error.message
                : "Preflight failed"
              ).slice(0, 2000),
            },
          ];
        }
        return {
          kind: "observation",
          pinned: true,
          value: {
            completionPreflight: {
              version: 1,
              snapshotHash: state.snapshotHash,
              requirements: state.requirements,
              requirementsHash: state.requirementsHash,
              status: receipt ? "passed" : "failed",
              checks,
              ...(receipt ? { receipt } : {}),
            },
          },
        };
      },
    });
    if (ports.prepareCaptionPair)
      tools.push({
        ...toolMetadata("prepare_caption_pair"),
        parameters: object(
          {
            sourceItemId: string,
            evidenceId: string,
            originalItemId: string,
            translatedItemId: string,
            trackId: string,
            originalLanguage: string,
            translatedLanguage: string,
            originalColor: string,
            translatedColor: string,
            ...(usesPagedReaders(input.profile)
              ? { sourceRange: sourceRangeParameters }
              : {}),
            translations: {
              type: "array",
              maxItems: 500,
              items: object(
                {
                  cueId: string,
                  text: { type: "string", minLength: 1, maxLength: 1000 },
                },
                ["cueId", "text"],
              ),
            },
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
            "translations",
          ],
        ),
        execute: async (args, signal) => ({
          kind: "observation",
          pinned: true,
          value: await ports.prepareCaptionPair!(args, signal),
        }),
      });
  }
  if (usesPagedReaders(input.profile)) {
    tools.push(
      {
        ...toolMetadata("list_assets"),
        parameters: object(
          {
            ...(usesResolvedEditSchema(input.profile)
              ? {}
              : { snapshotHash: string }),
            name: { type: "string", maxLength: 128 },
            type: { enum: ["video", "audio", "image", "font", "lottie"] },
            usage: { enum: ["all", "used", "unused"] },
            cursor: { type: "string", maxLength: 160 },
          },
          usesEfficientReaders(input.profile) ? [] : ["snapshotHash"],
        ),
        execute: async (args, signal) => {
          const value = record(args, [
            ...(usesResolvedEditSchema(input.profile) ? [] : ["snapshotHash"]),
            "name",
            "type",
            "usage",
            "cursor",
          ]);
          if (
            value.type !== undefined &&
            !["video", "audio", "image", "font", "lottie"].includes(
              String(value.type),
            )
          )
            throw new Error("Unknown asset type.");
          if (
            value.usage !== undefined &&
            !["all", "used", "unused"].includes(String(value.usage))
          )
            throw new Error("Unknown asset usage filter.");
          return {
            kind: "observation",
            pinned: true,
            value: await ports.listAssets!(
              {
                snapshotHash: readerSnapshotHash(value.snapshotHash),
                ...(value.name === undefined
                  ? {}
                  : { name: text(value.name, "name", 0, 128) }),
                ...(value.type === undefined
                  ? {}
                  : { type: value.type as AssetQuery["type"] }),
                ...(value.usage === undefined
                  ? {}
                  : { usage: value.usage as AssetQuery["usage"] }),
                ...(value.cursor === undefined
                  ? {}
                  : { cursor: text(value.cursor, "cursor", 1, 160) }),
              },
              signal,
            ),
          };
        },
      },
      {
        ...toolMetadata("read_caption_cues"),
        parameters: object(
          {
            ...(usesResolvedEditSchema(input.profile)
              ? {}
              : { snapshotHash: string }),
            sourceItemId: { type: "string", minLength: 1, maxLength: 191 },
            evidenceId: { type: "string", minLength: 1, maxLength: 191 },
            sourceRange: sourceRangeParameters,
            cursor: { type: "string", maxLength: 160 },
          },
          usesEfficientReaders(input.profile)
            ? ["sourceItemId", "evidenceId"]
            : ["snapshotHash", "sourceItemId", "evidenceId"],
        ),
        execute: async (args, signal) => {
          const value = record(args, [
            ...(usesResolvedEditSchema(input.profile) ? [] : ["snapshotHash"]),
            "sourceItemId",
            "evidenceId",
            "sourceRange",
            "cursor",
          ]);
          return {
            kind: "observation",
            pinned: true,
            value: await ports.readCaptionCues!(
              {
                snapshotHash: readerSnapshotHash(value.snapshotHash),
                sourceItemId: text(value.sourceItemId, "sourceItemId", 1, 191),
                evidenceId: text(value.evidenceId, "evidenceId", 1, 191),
                ...(value.sourceRange === undefined
                  ? {}
                  : { sourceRange: sourceRange(value.sourceRange) }),
                ...(value.cursor === undefined
                  ? {}
                  : { cursor: text(value.cursor, "cursor", 1, 160) }),
              },
              signal,
            ),
          };
        },
      },
    );
  }
  if (stages) tools.push(...createStagedEditorTools(stages));
  if (stages && ports.readCaptionTrack)
    tools.push({
      ...toolMetadata("read_caption_track"),
      parameters: object(
        {
          captionItemId: { type: "string", minLength: 1, maxLength: 191 },
          cursor: { type: "string", maxLength: 160 },
        },
        ["captionItemId"],
      ),
      execute: async (raw, signal) => {
        const value = record(raw, ["captionItemId", "cursor"]);
        return {
          kind: "observation",
          pinned: true,
          value: await ports.readCaptionTrack!(
            {
              snapshotHash: input.snapshotHash!,
              captionItemId: text(value.captionItemId, "captionItemId", 1, 191),
              ...(value.cursor === undefined
                ? {}
                : { cursor: text(value.cursor, "cursor", 1, 160) }),
            },
            signal,
          ),
        };
      },
    });
  tools.push(
    {
      ...toolMetadata("propose_edit"),
      parameters: usesResolvedEditSchema(input.profile)
        ? editingOnlyProposalSchema(input.proposalSchema, {
            preparedCommands: stages?.preparedCommands,
          })
        : input.proposalSchema,
      execute: async (args, signal) => {
        if (stages) args = await stages.resolvePreparedEdit(args, signal);
        if (usesResolvedEditSchema(input.profile)) assertEditingProposal(args);
        if (!completion)
          return {
            kind: "terminal",
            result: await ports.proposeEdit(args, signal),
          };
        if (
          args &&
          typeof args === "object" &&
          Object.hasOwn(args, "completion")
        )
          throw new Error(
            "Completion metadata is host-owned; do not supply it in propose_edit.",
          );
        await checkedState();
        if (
          !state?.successfulReceipt ||
          state.successfulReceipt.commandsHash !==
            (await completionHash((args as { commands?: unknown })?.commands))
        )
          throw new Error(
            "Run review_edit successfully for these exact commands before propose_edit. Do not omit or weaken requirements.",
          );
        const result = await ports.proposeEdit(args, signal, {
          requirements: state.requirements,
          receipt: state.successfulReceipt,
        });
        return {
          kind: "terminal",
          result: stages?.completeEditing
            ? await stages.completeEditing(result, signal)
            : result,
        };
      },
    },
    {
      ...toolMetadata("ask_user"),
      parameters: input.clarificationSchema ?? defaultClarification,
      execute: async (args, signal) => ({
        kind: "terminal",
        result: await ports.askUser(args, signal),
      }),
    },
    ...(input.extraTools ?? []),
  );
  if (new Set(tools.map((tool) => tool.name)).size !== tools.length)
    throw new Error("Tool names must be unique.");
  skills = selectSkills(
    input.skills,
    tools.map((tool) => tool.name),
    input.profile,
  );
  // Cancellation is checked before calling any host code, including read-only helpers.
  for (const tool of tools) {
    const execute = tool.execute;
    tool.execute = async (args, signal) => {
      signal.throwIfAborted();
      return execute(args, signal);
    };
  }
  return {
    tools,
    skills,
    inventory: buildAgentInventory({ profile: input.profile, tools, skills }),
    restoreCompletionState: (restored: CompletionState | undefined) => {
      if (
        state &&
        restored &&
        state.requirementsHash !== restored.requirementsHash
      )
        throw new Error(
          "Cannot replace frozen completion requirements during restore.",
        );
      state = restored ? structuredClone(restored) : state;
    },
  };
}
