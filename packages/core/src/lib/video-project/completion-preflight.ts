import {
  evaluateScene,
  layoutScene,
  compileDisplayList,
  parseColor,
  type DisplayGroup,
} from "@dojo-video-engine/core";
import type { SceneNodeInput } from "@dojo-video-engine/schema";
import {
  completionCanonical,
  completionHash,
  createCompletionReceipt,
  parseCompletionRequirements,
  validateCompletionReceipt,
  type CompletionRequirement,
  type CompletionCheck,
  type CompletionContract,
} from "../../../../agent-kit/src/index";
import {
  compileNativeAgentResult,
  type NativeAgentRequest,
  type NativeAgentResult,
} from "./agent-runtime";
import {
  executeVideoProjectCommands,
  readVideoProjectPath,
  type VideoProjectTarget,
} from "./commands";
import {
  parseVideoProjectDocument,
  hashVideoProjectDocument,
  type VideoProjectDocument,
} from "./document";
import { generatedTrackCommands } from "./agent-tracks";
import { captionSourceCommands } from "./semantic";
import { resolveSpeechAnchor, projectSourceRange } from "./source-clock";
import { compileVideoProjectDocument } from "./compilation";
import { normalizeCompletionNumber } from "./completion-number";
import { normalizeCaptionLanguage } from "./caption-pair";

const spanEnd = (document: VideoProjectDocument) =>
  Math.max(
    document.format.durationInFrames,
    ...document.items.map(
      (item) => (item.node.from ?? 0) + item.node.duration!,
    ),
  );
const nodes = (node: SceneNodeInput): SceneNodeInput[] => [
  node,
  ...(node.children ?? []).flatMap(nodes),
];
const text = (node: SceneNodeInput) =>
  nodes(node)
    .filter((node) => node.type === "text")
    .map((node) => node.text ?? "")
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
function propertyPath(target: VideoProjectTarget, path: string[]) {
  const root =
    target.kind === "format"
      ? ["format"]
      : target.kind === "project"
        ? []
        : target.kind === "track"
          ? ["tracks", target.trackId]
          : target.kind === "node"
            ? ["items", target.itemId, "nodes", target.nodeId]
            : target.kind === "caption"
              ? ["items", target.itemId, "caption"]
              : target.kind === "cue"
                ? ["items", target.itemId, "caption", "cues", target.cueId]
                : ["items", target.itemId];
  return [...root, ...path].map((part) => encodeURIComponent(part)).join("/");
}
function declaredItems(requirements: CompletionRequirement[]) {
  return new Set(
    requirements.flatMap((requirement) =>
      requirement.kind === "asset_sequence"
        ? requirement.items.map((item) => item.itemId)
        : requirement.kind === "caption_pair"
          ? [requirement.originalItemId, requirement.translatedItemId]
          : requirement.kind === "property" ||
              requirement.kind === "property_absent"
            ? "itemId" in requirement.target
              ? [requirement.target.itemId]
              : []
            : requirement.kind === "item_absent"
              ? []
              : [requirement.itemId],
    ),
  );
}
function assertRequirement(
  before: VideoProjectDocument,
  after: VideoProjectDocument,
  requirement: CompletionRequirement,
) {
  const item = (id: string) => {
    const found = after.items.find((item) => item.id === id);
    if (!found) throw new Error(`Required item ${id} is missing.`);
    return found;
  };
  if (requirement.kind === "asset_sequence") {
    for (const expected of requirement.items) {
      const candidate = item(expected.itemId);
      if (
        !["video", "audio", "img"].includes(candidate.node.type) ||
        candidate.node.assetId !== expected.assetId ||
        (candidate.node.from ?? 0) !== expected.from ||
        candidate.node.duration !== expected.duration
      )
        throw new Error(
          `Asset placement ${expected.itemId} needs its declared media identity and composition timing.`,
        );
      if (expected.sourceStartSeconds !== undefined) {
        if (!["video", "audio"].includes(candidate.node.type))
          throw new Error("Source offsets apply to video/audio assets.");
        const actual =
          candidate.node.type === "video"
            ? (candidate.node.videoStartTime ?? 0)
            : (candidate.node.audioStartTime ?? 0);
        if (Math.abs(actual - expected.sourceStartSeconds) > 1e-9)
          throw new Error(
            `Asset placement ${expected.itemId} has the wrong source offset.`,
          );
      }
    }
    return;
  }
  if (requirement.kind === "item_present") {
    item(requirement.itemId);
    return;
  }
  if (requirement.kind === "item_absent") {
    if (after.items.some((item) => item.id === requirement.itemId))
      throw new Error(`Item ${requirement.itemId} must be absent.`);
    return;
  }
  if (
    requirement.kind === "property" ||
    requirement.kind === "property_absent"
  ) {
    if (
      readVideoProjectPath(after, propertyPath(requirement.target, [])) ===
      undefined
    )
      throw new Error("The declared property target is missing.");
    const value = readVideoProjectPath(
      after,
      propertyPath(requirement.target, requirement.path),
    );
    if (requirement.kind === "property_absent") {
      if (value !== undefined)
        throw new Error(
          "The declared property must be absent (null/presence is not absence).",
        );
      return;
    }
    if (
      completionCanonical(
        readVideoProjectPath(
          after,
          propertyPath(requirement.target, requirement.path),
        ),
      ) !== completionCanonical(requirement.equals)
    )
      throw new Error(
        "The declared property does not equal its required value.",
      );
    return;
  }
  if (requirement.kind === "caption_pair") {
    const original = item(requirement.originalItemId),
      translated = item(requirement.translatedItemId);
    const expected = captionSourceCommands(after, {
      sourceItemId: requirement.sourceItemId,
      evidenceId: requirement.evidenceId,
      itemId: "completion-cues",
      trackId: original.trackId,
      phraseSafe: true,
    }).find((command) => command.type === "addItem");
    if (expected?.type !== "addItem")
      throw new Error("Host source cues are unavailable.");
    const expectedCues = expected.item.caption!.cues;
    for (const [candidate, role, language, color, paired] of [
      [
        original,
        "original",
        requirement.originalLanguage,
        requirement.originalColor,
        translated.id,
      ],
      [
        translated,
        "translation",
        requirement.translatedLanguage,
        requirement.translatedColor,
        original.id,
      ],
    ] as const) {
      if (
        !candidate.caption ||
        candidate.caption.role !== role ||
        normalizeCaptionLanguage(candidate.caption.language ?? "") !==
          normalizeCaptionLanguage(language) ||
        candidate.caption.sourceItemId !== requirement.sourceItemId ||
        candidate.caption.pairedItemId !== paired ||
        String(candidate.node.style?.color).toLowerCase() !==
          color.toLowerCase()
      )
        throw new Error(
          `Caption ${candidate.id} needs its declared language, color, role and reciprocal pairing.`,
        );
      if (
        candidate.node.from !== expected.item.node.from ||
        candidate.node.duration !== expected.item.node.duration ||
        candidate.caption.cues.length !== expectedCues.length ||
        candidate.caption.cues.some(
          (cue, index) =>
            cue.id !== expectedCues[index]!.id ||
            Math.abs(cue.startMs - expectedCues[index]!.startMs) > 0.001 ||
            Math.abs(cue.endMs - expectedCues[index]!.endMs) > 0.001 ||
            !cue.text.trim() ||
            (role === "original" && cue.text !== expectedCues[index]!.text),
        )
      )
        throw new Error(
          `Caption ${candidate.id} must preserve every host cue ID/timing and original wording.`,
        );
    }
    return;
  }
  if (
    requirement.kind === "speech_highlight" ||
    requirement.kind === "speech_callout"
  ) {
    const candidate = item(requirement.itemId),
      binding = after.bindings[requirement.bindingId];
    const expected = resolveSpeechAnchor(after, {
      id: requirement.bindingId,
      itemId: candidate.id,
      sourceItemId: requirement.sourceItemId,
      evidenceId: requirement.evidenceId,
      wordIds: requirement.wordIds,
    });
    if (
      !binding ||
      binding.status !== "active" ||
      binding.itemId !== candidate.id ||
      binding.sourceItemId !== expected.sourceItemId ||
      binding.sourceAssetId !== expected.sourceAssetId ||
      binding.sourceRevision !== expected.sourceRevision ||
      binding.evidenceId !== expected.evidenceId ||
      completionCanonical(binding.wordIds) !==
        completionCanonical(expected.wordIds) ||
      binding.sourceStartMs !== expected.sourceStartMs ||
      binding.sourceEndMs !== expected.sourceEndMs
    )
      throw new Error(
        "Highlight must bind the declared genuine contiguous source words without fabricated timing.",
      );
    const source = item(requirement.sourceItemId),
      projected = projectSourceRange(
        source,
        after.format.fps,
        binding.sourceStartMs,
        binding.sourceEndMs,
      );
    if (
      !projected ||
      candidate.node.from !== projected.from ||
      (candidate.node.duration! * 1000) / after.format.fps + 0.001 <
        requirement.minReadableMs ||
      text(candidate.node) !== requirement.exactText
    )
      throw new Error(
        "Highlight text/start/readable duration does not meet the declaration. Use bounded holdMs without changing the genuine word range.",
      );
    const sourceWords = after.evidence[requirement.evidenceId]!.words.filter(
      (word) => requirement.wordIds.includes(word.id),
    )
      .map((word) => word.text)
      .join(" ");
    const normalizedWords = (value: string) =>
      value
        .normalize("NFKC")
        .toLowerCase()
        .match(/[\p{L}\p{N}]+/gu)
        ?.join(" ") ?? "";
    if (requirement.kind === "speech_callout") {
      if (
        !normalizedWords(sourceWords) ||
        normalizedWords(sourceWords) !== normalizedWords(requirement.exactText)
      )
        throw new Error(
          "Callout text does not match its selected genuine source words.",
        );
      return;
    }
    if (
      normalizeCompletionNumber(sourceWords) !==
      normalizeCompletionNumber(requirement.exactText)
    )
      throw new Error(
        "Highlight numbers do not match the selected source words.",
      );
    return;
  }
  if (requirement.kind !== "appended_ending")
    throw new Error("Unknown completion requirement.");
  const candidate = item(requirement.itemId),
    end = (candidate.node.from ?? 0) + candidate.node.duration!;
  if (
    (candidate.node.from ?? 0) < spanEnd(before) ||
    end !== after.format.durationInFrames ||
    (candidate.node.duration! * 1000) / after.format.fps <
      requirement.minDurationMs ||
    text(candidate.node) !== requirement.exactText ||
    !nodes(candidate.node).some((node) => node.animations?.length)
  )
    throw new Error(
      "The exact animated ending must follow the complete original timeline, remain readable, and end at the final frame without later blank padding.",
    );
}

/** Pure bounded layout checks, targeting declared/changed outputs. Existing
 * unrelated bad geometry is not itself a failure. Sampled checks are not a
 * substitute for human visual/audio acceptance. */
function layoutChecks(
  before: VideoProjectDocument,
  after: VideoProjectDocument,
  requirements: CompletionRequirement[],
) {
  const required = declaredItems(requirements);
  const changed = new Set(
    after.items
      .filter(
        (item) =>
          !before.items.some(
            (old) =>
              old.id === item.id &&
              completionCanonical(old) === completionCanonical(item),
          ),
      )
      .map((item) => item.id),
  );
  const targets = new Set([...required, ...changed]);
  const frames = new Set<number>();
  for (const item of after.items.filter((item) => targets.has(item.id))) {
    const from = item.node.from ?? 0,
      duration = item.node.duration!;
    frames.add(
      from +
        Math.min(Math.floor(after.format.fps / 3), Math.floor(duration / 4)),
    );
    frames.add(from + Math.floor(duration / 2));
    frames.add(from + Math.max(0, duration - 2));
    if (item.caption) {
      const cues = item.caption.cues;
      for (const cue of [
        cues[0],
        cues[Math.floor(cues.length / 2)],
        cues.at(-1),
        [...cues].sort((a, b) => b.text.length - a.text.length)[0],
      ])
        if (cue)
          frames.add(
            from +
              Math.floor(((cue.startMs + cue.endMs) * after.format.fps) / 2000),
          );
    }
  }
  const sorted = [...frames]
    .filter((frame) => frame >= 0 && frame < after.format.durationInFrames)
    .sort((a, b) => a - b);
  const selected =
    sorted.length <= 24
      ? sorted
      : Array.from(
          { length: 24 },
          (_, index) => sorted[Math.round((index * (sorted.length - 1)) / 23)]!,
        );
  const scene = compileVideoProjectDocument(
    after,
    Object.fromEntries(
      Object.keys(after.assets).map((id) => [id, `asset:${id}`]),
    ),
  ).scene;
  const owner = new Map<string, string>();
  after.items.forEach((item) =>
    nodes(item.node).forEach((node) => owner.set(node.id, item.id)),
  );
  // Caption compiler-derived node IDs retain the item prefix.
  const itemFor = (id: string) =>
    owner.get(id) ??
    after.items.find((item) => id.startsWith(item.id + ":"))?.id;
  const captionIds = new Set(
    after.items.filter((item) => item.caption).map((item) => item.id),
  );
  const observed = new Set<string>();
  for (const frame of selected) {
    const boxes: Array<{
      box: { id: string; x: number; y: number; width: number; height: number };
      itemId: string;
    }> = [];
    const minimumFont = Math.max(
      8,
      Math.min(16, Math.min(after.format.width, after.format.height) / 18),
    );
    const visit = (group: DisplayGroup, ancestorOpacity = 1) => {
      const opacity = ancestorOpacity * group.composite.opacity;
      const itemId = itemFor(group.nodeId),
        content = group.content;
      if (itemId && content?.kind === "text" && content.value.trim()) {
        const alpha =
          content.fill.trim().toLowerCase() === "transparent"
            ? 0
            : (parseColor(content.fill)?.a ?? 1);
        const visible = opacity * alpha > 0.15;
        if (visible) {
          const box = { id: group.nodeId, ...group.transformedBounds };
          boxes.push({ box, itemId });
          if (targets.has(itemId)) {
            observed.add(itemId);
            if (
              box.width <= 0 ||
              box.height <= 0 ||
              !Number.isFinite(box.width + box.height + box.x + box.y) ||
              box.x < -1 ||
              box.y < -1 ||
              box.x + box.width > after.format.width + 1 ||
              box.y + box.height > after.format.height + 1
            )
              throw new Error(
                `Text ${group.nodeId} has zero/off-canvas layout at frame ${frame}.`,
              );
            const m = group.worldTransform;
            const size =
              content.font.size *
              Math.min(Math.hypot(m.a, m.b), Math.hypot(m.c, m.d));
            if (
              required.has(itemId) &&
              (!Number.isFinite(size) || size < minimumFont - 0.01)
            )
              throw new Error(
                `Required text ${group.nodeId} renders at ${size.toFixed(2)}px, below the ${minimumFont.toFixed(2)}px readable floor at frame ${frame}.`,
              );
          }
        }
      }
      group.children.forEach((child) => visit(child, opacity));
    };
    compileDisplayList(layoutScene(evaluateScene(scene, frame))).groups.forEach(
      (group) => visit(group),
    );
    for (let i = 0; i < boxes.length; i++)
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i]!,
          b = boxes[j]!;
        if (
          (!targets.has(a.itemId) && !targets.has(b.itemId)) ||
          (a.itemId === b.itemId && captionIds.has(a.itemId))
        )
          continue;
        const overlapX =
            Math.min(a.box.x + a.box.width, b.box.x + b.box.width) -
            Math.max(a.box.x, b.box.x),
          overlapY =
            Math.min(a.box.y + a.box.height, b.box.y + b.box.height) -
            Math.max(a.box.y, b.box.y);
        if (
          overlapX > 2 &&
          overlapY > 2 &&
          overlapX * overlapY >
            Math.min(a.box.width * a.box.height, b.box.width * b.box.height) *
              0.02
        )
          throw new Error(
            `Text ${a.box.id} overlaps ${b.box.id} at frame ${frame}.`,
          );
      }
  }
  for (const id of required) {
    const candidate = after.items.find((item) => item.id === id);
    if (
      candidate &&
      (candidate.caption ||
        nodes(candidate.node).some(
          (node) => node.type === "text" && node.text?.trim(),
        )) &&
      !observed.has(id)
    )
      throw new Error(
        `Required text ${id} was not visible in bounded layout samples.`,
      );
  }
  return `Checked ${selected.length} bounded layout frames: ${selected.join(",")}.`;
}
export function checkNativeCompletionRequirements(
  beforeInput: VideoProjectDocument,
  afterInput: VideoProjectDocument,
  raw: unknown,
): CompletionCheck[] {
  const before = parseVideoProjectDocument(beforeInput),
    after = parseVideoProjectDocument(afterInput),
    requirements = parseCompletionRequirements(raw, {
      assetSequence: true,
      speechCallout: true,
    });
  const checks = requirements.map((requirement) => {
    try {
      assertRequirement(before, after, requirement);
      return {
        id: requirement.id,
        passed: true,
        message: "Declared requirement satisfied.",
      };
    } catch (error) {
      return {
        id: requirement.id,
        passed: false,
        message: (error instanceof Error
          ? error.message
          : "Requirement failed"
        ).slice(0, 2000),
      };
    }
  });
  try {
    checks.push({
      id: "layout",
      passed: true,
      message: layoutChecks(before, after, requirements),
    });
  } catch (error) {
    checks.push({
      id: "layout",
      passed: false,
      message: (error instanceof Error ? error.message : "Layout failed").slice(
        0,
        2000,
      ),
    });
  }
  return checks;
}
export async function reviewNativeCompletionEdit(
  request: NativeAgentRequest,
  input: { requirements: unknown; edit: unknown },
) {
  const requirements = parseCompletionRequirements(input.requirements, {
      assetSequence: true,
      speechCallout: true,
    }),
    base = parseVideoProjectDocument(request.document);
  const compiled = await compileNativeAgentResult(request, input.edit);
  if (!compiled.proposal)
    throw new Error("Completion preflight requires an editing proposal.");
  const rawCommands = (input.edit as { commands: unknown }).commands;
  const first = executeVideoProjectCommands(base, compiled.proposal.commands);
  const placement = generatedTrackCommands(base, first.document);
  const commands = [...compiled.proposal.commands, ...placement];
  const executed = placement.length
    ? executeVideoProjectCommands(base, commands)
    : first;
  const result: NativeAgentResult = {
    ...compiled,
    proposal: {
      ...compiled.proposal,
      commands,
      previewHash: await hashVideoProjectDocument(executed.document),
      changedItemIds: executed.changedItemIds,
    },
  };
  const checks = checkNativeCompletionRequirements(
    base,
    executed.document,
    requirements,
  );
  const receipt = checks.every((check) => check.passed)
    ? await createCompletionReceipt({
        snapshotHash: request.baseHash,
        requirementsHash: await completionHash(requirements),
        commandsHash: await completionHash(rawCommands),
        compiledCommandsHash: await completionHash(commands),
        previewHash: result.proposal!.previewHash,
        checksHash: await completionHash(checks),
      })
    : undefined;
  return { result, checks, ...(receipt ? { receipt } : {}) };
}
/** Host-only replay. Completion metadata is never a model proposal-schema field. */
export async function compileNativeCompletionResponse(
  request: NativeAgentRequest,
  raw: unknown,
): Promise<NativeAgentResult> {
  if (typeof raw === "string") {
    if (raw.length > 4_000_000)
      throw new Error(
        "Completion response exceeds the bounded JSON transport.",
      );
    try {
      raw = JSON.parse(raw);
    } catch {
      throw new Error("Completion response is not valid JSON.");
    }
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new Error("Completion response must be an object.");
  const { completion, ...edit } = raw as Record<string, unknown>;
  if (completion === undefined) {
    const result = await compileNativeAgentResult(request, edit);
    if (result.outcome === "proposal")
      throw new Error(
        "A reviewed completion contract is required for an editing proposal.",
      );
    return result;
  }
  if (edit.outcome === "answer" || edit.outcome === "needs_input")
    throw new Error("Completion metadata belongs only to editing proposals.");
  if (
    !completion ||
    typeof completion !== "object" ||
    Array.isArray(completion)
  )
    throw new Error("A reviewed completion contract is required.");
  const contract = completion as CompletionContract,
    receipt = await validateCompletionReceipt(contract.receipt);
  const reviewed = await reviewNativeCompletionEdit(request, {
    requirements: contract.requirements,
    edit,
  });
  if (
    !reviewed.receipt ||
    completionCanonical(reviewed.receipt) !== completionCanonical(receipt)
  )
    throw new Error(
      "Completion receipt differs from independent native replay.",
    );
  return {
    ...reviewed.result,
    completion: {
      requirements: parseCompletionRequirements(contract.requirements, {
        assetSequence: true,
        speechCallout: true,
      }),
      receipt,
    },
  };
}
