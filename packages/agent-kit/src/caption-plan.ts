import {
  completionHash,
  parseCompletionRequirements,
  type CompletionRequirement,
} from "./completion.js";
import type { StageCaptionPair } from "./staged-coordinator.js";

type PairRequirement = Extract<CompletionRequirement, { kind: "caption_pair" }>;
export function captionPairMatchesRequirement(
  pair: StageCaptionPair,
  requirement: CompletionRequirement,
): boolean {
  return (
    requirement.kind === "caption_pair" &&
    requirement.sourceItemId === pair.sourceItemId &&
    requirement.evidenceId === pair.evidenceId &&
    requirement.originalItemId === pair.originalItemId &&
    requirement.translatedItemId === pair.translatedItemId &&
    requirement.originalLanguage === pair.originalLanguage &&
    requirement.translatedLanguage === pair.translatedLanguage &&
    requirement.originalColor.toLowerCase() ===
      pair.originalColor.toLowerCase() &&
    requirement.translatedColor.toLowerCase() ===
      pair.translatedColor.toLowerCase()
  );
}

/** Native pair/source/manifest validation remains the coordinator's authority. */
export async function deriveCaptionPlanRequirements(
  supplied: CompletionRequirement[],
  pairs: readonly StageCaptionPair[],
): Promise<CompletionRequirement[]> {
  const declarations = pairs.map((pair) => {
    const [requirement] = parseCompletionRequirements([
      {
        id: "caption-pair",
        kind: "caption_pair",
        sourceItemId: pair.sourceItemId,
        evidenceId: pair.evidenceId,
        originalItemId: pair.originalItemId,
        translatedItemId: pair.translatedItemId,
        originalLanguage: pair.originalLanguage,
        translatedLanguage: pair.translatedLanguage,
        originalColor: pair.originalColor,
        translatedColor: pair.translatedColor,
      },
    ]);
    return requirement as PairRequirement;
  });
  const explicit = supplied.filter((value) => value.kind === "caption_pair");
  if (
    explicit.some(
      (requirement) =>
        pairs.filter((pair) => captionPairMatchesRequirement(pair, requirement))
          .length !== 1,
    )
  )
    throw new Error(
      "Every explicit caption_pair check must match exactly one declared caption pair, including source, evidence, item IDs, languages and colors.",
    );
  const requirements = [...supplied];
  for (const [index, pair] of pairs.entries()) {
    const matches = explicit.filter((requirement) =>
      captionPairMatchesRequirement(pair, requirement),
    );
    if (matches.length > 1)
      throw new Error("Declare each caption_pair check exactly once.");
    if (!matches.length) {
      const { id: _id, ...fields } = declarations[index];
      const hash = await completionHash(fields);
      requirements.push({ id: `caption-pair:${hash.slice(7)}`, ...fields });
    }
  }
  return parseCompletionRequirements(requirements, {
    assetSequence: true,
    speechCallout: true,
  });
}
