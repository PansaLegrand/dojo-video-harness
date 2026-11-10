import { parseEditArtifactRef, type EditArtifactRef } from "./stages.js";
/** Portable completion declarations and deterministic receipts. No domain,
 * provider, persistence or rendering authority lives in this module. */
export type CompletionTarget =
  | { kind: "format" | "project" }
  | { kind: "track"; trackId: string }
  | { kind: "item" | "caption"; itemId: string }
  | { kind: "node"; itemId: string; nodeId: string }
  | { kind: "cue"; itemId: string; cueId: string };
export type AssetSequenceEntry = {
  itemId: string;
  assetId: string;
  from: number;
  duration: number;
  sourceStartSeconds?: number;
};
export type CompletionRequirement =
  | { id: string; kind: "asset_sequence"; items: AssetSequenceEntry[] }
  | {
      id: string;
      kind: "caption_pair";
      sourceItemId: string;
      evidenceId: string;
      originalItemId: string;
      translatedItemId: string;
      originalLanguage: string;
      translatedLanguage: string;
      originalColor: string;
      translatedColor: string;
    }
  | {
      id: string;
      kind: "speech_highlight" | "speech_callout";
      itemId: string;
      bindingId: string;
      sourceItemId: string;
      evidenceId: string;
      wordIds: string[];
      exactText: string;
      minReadableMs: number;
    }
  | {
      id: string;
      kind: "appended_ending";
      itemId: string;
      exactText: string;
      minDurationMs: number;
      animated: true;
    }
  | {
      id: string;
      kind: "property";
      target: CompletionTarget;
      path: string[];
      equals: unknown;
    }
  | {
      id: string;
      kind: "property_absent";
      target: CompletionTarget;
      path: string[];
    }
  | { id: string; kind: "item_present" | "item_absent"; itemId: string };
export type CompletionCheck = { id: string; passed: boolean; message: string };
export type CompletionReceipt = {
  version: 1;
  snapshotHash: string;
  requirementsHash: string;
  commandsHash: string;
  compiledCommandsHash: string;
  previewHash: string;
  checksHash: string;
  receiptHash: string;
};
export type CompletionContract = {
  requirements: CompletionRequirement[];
  receipt: CompletionReceipt;
};
export type CompletionReview = {
  version: 1;
  snapshotHash: string;
  requirements: CompletionRequirement[];
  requirementsHash: string;
  status: "passed" | "failed";
  checks: CompletionCheck[];
  receipt?: CompletionReceipt;
};
export type CompletionState = {
  version: 1;
  snapshotHash: string;
  requirements: CompletionRequirement[];
  requirementsHash: string;
  successfulReceipt?: CompletionReceipt;
  /** Small owned reference only; command JSON remains in the original review/artifact. */
  successfulReviewRef?: EditArtifactRef;
};
export const COMPLETION_LIMITS = {
  requirements: 12,
  checks: 40,
  frames: 24,
} as const;
const plain = (v: unknown): v is Record<string, unknown> =>
  !!v &&
  typeof v === "object" &&
  !Array.isArray(v) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(v));
const safe = (v: unknown, max = 191): string => {
  if (
    typeof v !== "string" ||
    !v.length ||
    v.length > max ||
    ["__proto__", "prototype", "constructor"].includes(v)
  )
    throw new Error("Invalid bounded completion identity/text.");
  return v;
};
function object(v: unknown, fields: string[]) {
  if (!plain(v) || Object.keys(v).some((key) => !fields.includes(key)))
    throw new Error("Unknown completion requirement field.");
  return v;
}
function json(v: unknown, depth = 0): unknown {
  if (depth > 128) throw new Error("Completion JSON exceeds depth budget.");
  if (
    v === null ||
    typeof v === "string" ||
    typeof v === "boolean" ||
    (typeof v === "number" && Number.isFinite(v))
  )
    return v;
  if (Array.isArray(v)) return v.map((x) => json(x, depth + 1));
  if (!plain(v)) throw new Error("Completion values must be plain JSON.");
  return Object.fromEntries(
    Object.entries(v)
      .filter(([, x]) => x !== undefined)
      .map(([k, x]) => [safe(k), json(x, depth + 1)]),
  );
}
export function completionCanonical(value: unknown): string {
  const v = json(value);
  const emit = (x: unknown): string =>
    x === null || typeof x !== "object"
      ? JSON.stringify(x)
      : Array.isArray(x)
        ? `[${x.map(emit).join(",")}]`
        : `{${Object.entries(x)
            .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
            .map(([k, y]) => `${JSON.stringify(k)}:${emit(y)}`)
            .join(",")}}`;
  return emit(v);
}
export async function completionHash(value: unknown): Promise<string> {
  return (
    "sha256:" +
    Array.from(
      new Uint8Array(
        await crypto.subtle.digest(
          "SHA-256",
          new TextEncoder().encode(completionCanonical(value)),
        ),
      ),
    )
      .map((x) => x.toString(16).padStart(2, "0"))
      .join("")
  );
}
export function parseCompletionRequirements(
  raw: unknown,
  options: { assetSequence?: boolean; speechCallout?: boolean } = {},
): CompletionRequirement[] {
  if (
    !Array.isArray(raw) ||
    !raw.length ||
    raw.length > COMPLETION_LIMITS.requirements
  )
    throw new Error("Declare 1–12 completion requirements.");
  const requirements = raw.map((value) => {
    if (!plain(value))
      throw new Error("Completion requirement must be an object.");
    const kind = value.kind;
    const fields =
      kind === "asset_sequence" && options.assetSequence
        ? ["items"]
        : kind === "caption_pair"
          ? [
              "sourceItemId",
              "evidenceId",
              "originalItemId",
              "translatedItemId",
              "originalLanguage",
              "translatedLanguage",
              "originalColor",
              "translatedColor",
            ]
          : kind === "speech_highlight" ||
              (kind === "speech_callout" && options.speechCallout)
            ? [
                "itemId",
                "bindingId",
                "sourceItemId",
                "evidenceId",
                "wordIds",
                "exactText",
                "minReadableMs",
              ]
            : kind === "appended_ending"
              ? ["itemId", "exactText", "minDurationMs", "animated"]
              : kind === "property"
                ? ["target", "path", "equals"]
                : kind === "property_absent"
                  ? ["target", "path"]
                  : kind === "item_present" || kind === "item_absent"
                    ? ["itemId"]
                    : undefined;
    if (!fields) throw new Error("Unknown completion requirement kind.");
    object(value, ["id", "kind", ...fields]);
    safe(value.id);
    for (const field of fields.filter((field) => /Id$/.test(field)))
      safe(value[field]);
    if (kind === "asset_sequence") {
      if (
        !Array.isArray(value.items) ||
        !value.items.length ||
        value.items.length > 100
      )
        throw new Error("Declare 1–100 exact asset placements.");
      const ids = new Set<string>();
      for (const rawItem of value.items) {
        const item = object(rawItem, [
          "itemId",
          "assetId",
          "from",
          "duration",
          "sourceStartSeconds",
        ]);
        const itemId = safe(item.itemId);
        safe(item.assetId);
        if (ids.has(itemId))
          throw new Error("Asset sequence item IDs must be unique.");
        ids.add(itemId);
        if (
          !Number.isInteger(item.from) ||
          Number(item.from) < 0 ||
          Number(item.from) > 2592000 ||
          !Number.isInteger(item.duration) ||
          Number(item.duration) < 1 ||
          Number(item.duration) > 2592000
        )
          throw new Error("Asset placement uses bounded composition frames.");
        if (
          item.sourceStartSeconds !== undefined &&
          (typeof item.sourceStartSeconds !== "number" ||
            !Number.isFinite(item.sourceStartSeconds) ||
            item.sourceStartSeconds < 0)
        )
          throw new Error("Source offset requires finite nonnegative seconds.");
      }
    }
    if (kind === "caption_pair") {
      for (const key of ["originalLanguage", "translatedLanguage"])
        if (!/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(safe(value[key], 64)))
          throw new Error("Use language tags such as en or zh.");
      for (const key of ["originalColor", "translatedColor"])
        if (!/^#[a-f0-9]{6}$/i.test(safe(value[key], 7)))
          throw new Error("Declare an exact six-digit caption color.");
      if (
        value.originalItemId === value.translatedItemId ||
        value.originalLanguage === value.translatedLanguage
      )
        throw new Error("Caption pair requires distinct items and languages.");
    }
    if (kind === "speech_highlight" || kind === "speech_callout") {
      if (
        !Array.isArray(value.wordIds) ||
        !value.wordIds.length ||
        value.wordIds.length > 100 ||
        new Set(value.wordIds).size !== value.wordIds.length
      )
        throw new Error("Select 1–100 unique genuine word IDs.");
      value.wordIds.forEach((id) => safe(id));
      safe(value.exactText, 240);
      if (
        !Number.isInteger(value.minReadableMs) ||
        Number(value.minReadableMs) < 500 ||
        Number(value.minReadableMs) > 3000
      )
        throw new Error("Highlight readability must be 500–3000ms.");
    }
    if (kind === "appended_ending") {
      safe(value.exactText, 240);
      if (
        value.animated !== true ||
        !Number.isInteger(value.minDurationMs) ||
        Number(value.minDurationMs) < 500 ||
        Number(value.minDurationMs) > 10000
      )
        throw new Error("Ending requires animation and 500–10000ms duration.");
    }
    if (kind === "property" || kind === "property_absent") {
      if (!plain(value.target))
        throw new Error("Property requires a native target.");
      const target = value.target;
      const keys =
        target.kind === "format" || target.kind === "project"
          ? []
          : target.kind === "track"
            ? ["trackId"]
            : target.kind === "item" || target.kind === "caption"
              ? ["itemId"]
              : target.kind === "node"
                ? ["itemId", "nodeId"]
                : target.kind === "cue"
                  ? ["itemId", "cueId"]
                  : undefined;
      if (!keys) throw new Error("Unknown native completion target.");
      object(target, ["kind", ...keys]);
      keys.forEach((key) => safe(target[key]));
      if (
        !Array.isArray(value.path) ||
        !value.path.length ||
        value.path.length > 8
      )
        throw new Error("Property path requires 1–8 components.");
      value.path.forEach((key) => safe(key));
      if (
        kind === "property" &&
        (!Object.hasOwn(value, "equals") ||
          completionCanonical(value.equals).length > 16000)
      )
        throw new Error("Property comparison exceeds budget.");
    }
    return json(value) as CompletionRequirement;
  });
  if (new Set(requirements.map((r) => r.id)).size !== requirements.length)
    throw new Error("Completion requirement IDs must be unique.");
  return requirements;
}
export async function createCompletionReceipt(
  fields: Omit<CompletionReceipt, "version" | "receiptHash">,
): Promise<CompletionReceipt> {
  return {
    version: 1,
    ...fields,
    receiptHash: await completionHash({ version: 1, ...fields }),
  };
}
export async function validateCompletionReceipt(
  raw: unknown,
): Promise<CompletionReceipt> {
  const value = object(raw, [
    "version",
    "snapshotHash",
    "requirementsHash",
    "commandsHash",
    "compiledCommandsHash",
    "previewHash",
    "checksHash",
    "receiptHash",
  ]);
  if (value.version !== 1) throw new Error("Unsupported completion receipt.");
  for (const [key, item] of Object.entries(value))
    if (
      key !== "version" &&
      (typeof item !== "string" || !/^sha256:[a-f0-9]{64}$/.test(item))
    )
      throw new Error("Invalid completion receipt hash.");
  const { receiptHash, ...fields } = value;
  if (
    Object.keys(value).length !== 8 ||
    receiptHash !== (await completionHash(fields))
  )
    throw new Error("Completion receipt failed integrity validation.");
  return value as CompletionReceipt;
}
export async function restoreCompletionStateFromMessages(
  messages: readonly unknown[],
  snapshotHash: string,
  options: {
    resolvePreparedEdit?: (edit: unknown) => Promise<unknown>;
    reviewReferences?: true;
  } = {},
): Promise<CompletionState | undefined> {
  let state: CompletionState | undefined;
  const calls = new Map<string, { name: string; arguments: string }>();
  for (const message of messages) {
    if (!plain(message)) continue;
    if (message.role === "assistant" && Array.isArray(message.tool_calls))
      for (const call of message.tool_calls)
        if (
          plain(call) &&
          plain(call.function) &&
          typeof call.id === "string" &&
          typeof call.function.name === "string" &&
          typeof call.function.arguments === "string"
        )
          calls.set(call.id, {
            name: call.function.name,
            arguments: call.function.arguments,
          });
    if (
      message.role !== "tool" ||
      typeof message.tool_call_id !== "string" ||
      typeof message.content !== "string" ||
      calls.get(message.tool_call_id)?.name !== "review_edit"
    )
      continue;
    // Latest failed/error review invalidates the compact proposal path. Never
    // silently use an earlier successful edit after an unsuccessful repair.
    if (options.reviewReferences && state) {
      delete state.successfulReceipt;
      delete state.successfulReviewRef;
    }
    const value = JSON.parse(message.content);
    if (!plain(value) || !plain(value.completionPreflight)) continue;
    const review = value.completionPreflight;
    if (review.version !== 1 || review.snapshotHash !== snapshotHash)
      throw new Error("Completion restore snapshot changed.");
    const requirements = parseCompletionRequirements(review.requirements, {
      assetSequence: true,
      speechCallout: true,
    });
    const requirementsHash = await completionHash(requirements);
    if (
      review.requirementsHash !== requirementsHash ||
      (state && state.requirementsHash !== requirementsHash)
    )
      throw new Error("Frozen completion requirements changed.");
    state ??= { version: 1, snapshotHash, requirements, requirementsHash };
    if (review.status === "passed") {
      const receipt = await validateCompletionReceipt(review.receipt);
      const args = JSON.parse(calls.get(message.tool_call_id)!.arguments);
      const edit = options.resolvePreparedEdit
        ? await options.resolvePreparedEdit(args.edit)
        : args.edit;
      if (
        receipt.snapshotHash !== snapshotHash ||
        receipt.requirementsHash !== requirementsHash ||
        receipt.commandsHash !==
          (await completionHash((edit as { commands?: unknown }).commands)) ||
        receipt.checksHash !== (await completionHash(review.checks))
      )
        throw new Error(
          "Restored completion review does not match its tool call.",
        );
      state.successfulReceipt = receipt;
      if (options.reviewReferences && review.reviewRef !== undefined) {
        const ref = parseEditArtifactRef(review.reviewRef);
        if (ref.kind !== "verification")
          throw new Error(
            "A successful review requires a verification artifact.",
          );
        state.successfulReviewRef = ref;
      }
    } else if (review.status !== "failed")
      throw new Error("Invalid completion review status.");
  }
  return state;
}

const str = { type: "string", minLength: 1, maxLength: 191 };
const obj = (properties: Record<string, unknown>) => ({
  type: "object",
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});
export const completionRequirementsSchema = {
  type: "array",
  minItems: 1,
  maxItems: 12,
  items: {
    oneOf: [
      obj({
        id: str,
        kind: { const: "caption_pair" },
        sourceItemId: str,
        evidenceId: str,
        originalItemId: str,
        translatedItemId: str,
        originalLanguage: str,
        translatedLanguage: str,
        originalColor: str,
        translatedColor: str,
      }),
      obj({
        id: str,
        kind: { const: "speech_highlight" },
        itemId: str,
        bindingId: str,
        sourceItemId: str,
        evidenceId: str,
        wordIds: { type: "array", minItems: 1, maxItems: 100, items: str },
        exactText: { type: "string", maxLength: 240 },
        minReadableMs: { type: "integer", minimum: 500, maximum: 3000 },
      }),
      obj({
        id: str,
        kind: { const: "appended_ending" },
        itemId: str,
        exactText: { type: "string", maxLength: 240 },
        minDurationMs: { type: "integer", minimum: 500, maximum: 10000 },
        animated: { const: true },
      }),
      obj({
        id: str,
        kind: { const: "property" },
        target: { type: "object" },
        path: { type: "array", minItems: 1, maxItems: 8, items: str },
        equals: {},
      }),
      obj({
        id: str,
        kind: { enum: ["item_present", "item_absent"] },
        itemId: str,
      }),
      obj({
        id: str,
        kind: { const: "property_absent" },
        target: { type: "object" },
        path: { type: "array", minItems: 1, maxItems: 8, items: str },
      }),
    ],
  },
};

/** Additive schema used only by paged-reader profiles; legacy schemas remain frozen. */
export const pagedCompletionRequirementsSchema = {
  ...completionRequirementsSchema,
  items: {
    oneOf: [
      ...completionRequirementsSchema.items.oneOf,
      obj({
        id: str,
        kind: { const: "speech_callout" },
        itemId: str,
        bindingId: str,
        sourceItemId: str,
        evidenceId: str,
        wordIds: { type: "array", minItems: 1, maxItems: 100, items: str },
        exactText: { type: "string", maxLength: 240 },
        minReadableMs: { type: "integer", minimum: 500, maximum: 3000 },
      }),
      obj({
        id: str,
        kind: { const: "asset_sequence" },
        items: {
          type: "array",
          minItems: 1,
          maxItems: 100,
          items: {
            type: "object",
            properties: {
              itemId: str,
              assetId: str,
              from: { type: "integer", minimum: 0, maximum: 2592000 },
              duration: { type: "integer", minimum: 1, maximum: 2592000 },
              sourceStartSeconds: { type: "number", minimum: 0 },
            },
            required: ["itemId", "assetId", "from", "duration"],
            additionalProperties: false,
          },
        },
      }),
    ],
  },
};

/** The existing parser's kinds and targets, made explicit for new authoring profiles.
 * Legacy schema objects remain unchanged because accepted tool inventories are hashed. */
export const authoringCompletionRequirementsSchema = {
  ...pagedCompletionRequirementsSchema,
  description:
    'Declare 1–12 concrete checks with unique id and kind (never type). Supported kinds are item_present, item_absent, property, property_absent, caption_pair, speech_highlight, speech_callout, appended_ending and asset_sequence. Use item/property checks for original-language captions and graphics; caption_pair requires two distinct languages. Example: [{"id":"captions","kind":"item_present","itemId":"captions-en"},{"id":"width","kind":"property","target":{"kind":"format"},"path":["width"],"equals":1280}]. An ending inside existing narration uses item/property checks, not appended_ending. Do not invent semantic kinds such as animated_chapters or financial_accuracy; retain those user outcomes in the edit and verify them with supported concrete checks and visual inspection.',
  items: {
    oneOf: pagedCompletionRequirementsSchema.items.oneOf.map((branch) => {
      const properties = branch.properties as Record<
        string,
        Record<string, unknown>
      >;
      return {
        ...branch,
        properties: {
          ...properties,
          kind: { type: "string", ...properties.kind },
          ...(properties.target
            ? {
                target: {
                  description:
                    "Exact native property target; use stable IDs from the project or the proposed edit.",
                  oneOf: [
                    obj({
                      kind: { type: "string", enum: ["format", "project"] },
                    }),
                    obj({
                      kind: { type: "string", const: "track" },
                      trackId: str,
                    }),
                    obj({
                      kind: { type: "string", enum: ["item", "caption"] },
                      itemId: str,
                    }),
                    obj({
                      kind: { type: "string", const: "node" },
                      itemId: str,
                      nodeId: str,
                    }),
                    obj({
                      kind: { type: "string", const: "cue" },
                      itemId: str,
                      cueId: str,
                    }),
                  ],
                },
              }
            : {}),
          ...(properties.wordIds
            ? { wordIds: { ...properties.wordIds, uniqueItems: true } }
            : {}),
          ...(properties.exactText
            ? { exactText: { ...properties.exactText, minLength: 1 } }
            : {}),
          ...(properties.originalLanguage
            ? {
                originalLanguage: {
                  ...properties.originalLanguage,
                  maxLength: 64,
                  pattern: "^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$",
                },
                translatedLanguage: {
                  ...properties.translatedLanguage,
                  maxLength: 64,
                  pattern: "^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$",
                },
                originalColor: {
                  ...properties.originalColor,
                  minLength: 7,
                  maxLength: 7,
                  pattern: "^#[a-fA-F0-9]{6}$",
                },
                translatedColor: {
                  ...properties.translatedColor,
                  minLength: 7,
                  maxLength: 7,
                  pattern: "^#[a-fA-F0-9]{6}$",
                },
              }
            : {}),
        },
      };
    }),
  },
};
