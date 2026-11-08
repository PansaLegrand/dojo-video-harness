import {
  toolMetadata,
  type AgentTool,
  type Skill,
  type AgentProfile,
} from "./catalog.js";
import { readSkill, selectSkills } from "./skills.js";
import { buildAgentInventory } from "./inventory.js";

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
export type EditorToolPorts<T> = {
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
  proposeEdit(args: unknown, signal: AbortSignal): Promise<T>;
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
}) {
  const { ports } = input;
  let skills: Skill[] = [];
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
  tools.push(
    {
      ...toolMetadata("propose_edit"),
      parameters: input.proposalSchema,
      execute: async (args, signal) => ({
        kind: "terminal",
        result: await ports.proposeEdit(args, signal),
      }),
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
  };
}
