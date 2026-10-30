import {
  motionPresetDefinitions,
  type MotionPresetCategory,
} from "@motionforge/presets";
import { macroDefinitions } from "@motionforge/presets/macros";
import { zodToJsonSchema } from "zod-to-json-schema";

export const COMMAND_MANIFEST_VERSION = 1 as const;

export type CommandManifestVersion = typeof COMMAND_MANIFEST_VERSION;
export type ManifestAssetType = "image" | "video" | "audio" | "font" | "lottie";

export type RequiredAssetDescriptor = {
  /** Macro parameter containing the scene asset id. */
  parameter: string;
  /** Scene asset types accepted by that parameter. */
  allowedTypes: ManifestAssetType[];
  required: true;
  description: string;
};

export type CapabilityManifestBase = {
  manifestVersion: CommandManifestVersion;
  name: string;
  kind: "motion-preset" | "macro";
  description: string;
  /** Portable JSON Schema draft-07 for the manifest's parameters. */
  paramsSchema: Record<string, unknown>;
  /** Parsed JSON values, not documentation strings. */
  examples: Array<Record<string, unknown>>;
  requiredAssets: RequiredAssetDescriptor[];
  /** Semantic roles produced by expansion/compilation. */
  outputRoles: string[];
};

export type MotionPresetManifest = CapabilityManifestBase & {
  kind: "motion-preset";
  label: string;
  category: MotionPresetCategory;
};

export type MacroManifest = CapabilityManifestBase & {
  kind: "macro";
};

export type CapabilityManifest = MotionPresetManifest | MacroManifest;

type MacroSemantics = {
  requiredAssets: RequiredAssetDescriptor[];
  outputRoles: string[];
};

const noAssets: RequiredAssetDescriptor[] = [];

function requiredAsset(
  allowedTypes: ManifestAssetType[],
  description: string,
): RequiredAssetDescriptor[] {
  return [
    {
      parameter: "assetId",
      allowedTypes: sortedStrings(allowedTypes) as ManifestAssetType[],
      required: true,
      description,
    },
  ];
}

/**
 * Asset requirements and semantic results cannot be inferred reliably from a
 * Zod parameter shape. Keep them explicit so an agent never guesses merely
 * because a parameter happens to be named `assetId`.
 */
const macroSemantics: Readonly<Record<string, MacroSemantics>> = {
  audioOverlay: {
    requiredAssets: requiredAsset(["audio"], "Audio asset to mix."),
    outputRoles: ["audio"],
  },
  bRoll: {
    requiredAssets: requiredAsset(
      ["image", "video"],
      "Image or video used as B-roll.",
    ),
    outputRoles: ["b-roll", "visual-media"],
  },
  calloutArrow: {
    requiredAssets: noAssets,
    outputRoles: ["annotation", "text"],
  },
  captions: {
    requiredAssets: requiredAsset(
      ["audio", "video"],
      "Transcribed audio or video asset whose stored transcript is rendered.",
    ),
    outputRoles: ["captions", "text"],
  },
  cartoonBurst: {
    requiredAssets: noAssets,
    outputRoles: ["effect"],
  },
  chapterTransition: {
    requiredAssets: noAssets,
    outputRoles: ["text", "transition"],
  },
  countdown: {
    requiredAssets: noAssets,
    outputRoles: ["motion-graphic", "text"],
  },
  effectOverlay: {
    requiredAssets: noAssets,
    outputRoles: ["effect"],
  },
  emphasis: {
    requiredAssets: noAssets,
    outputRoles: ["effect", "text"],
  },
  imageOverlay: {
    requiredAssets: requiredAsset(["image"], "Image asset to display."),
    outputRoles: ["image", "visual-overlay"],
  },
  kineticText: {
    requiredAssets: noAssets,
    outputRoles: ["motion-graphic", "text"],
  },
  lottieOverlay: {
    requiredAssets: requiredAsset(
      ["lottie"],
      "Lottie animation asset to display.",
    ),
    outputRoles: ["animation", "visual-overlay"],
  },
  lowerThird: {
    requiredAssets: noAssets,
    outputRoles: ["lower-third", "text"],
  },
  progressBar: {
    requiredAssets: noAssets,
    outputRoles: ["data-graphic", "text"],
  },
  subtitles: {
    requiredAssets: noAssets,
    outputRoles: ["subtitles", "text"],
  },
  textEffect: {
    requiredAssets: noAssets,
    outputRoles: ["effect", "text"],
  },
  textOverlay: {
    requiredAssets: noAssets,
    outputRoles: ["text", "visual-overlay"],
  },
  titleCard: {
    requiredAssets: noAssets,
    outputRoles: ["text", "title-card"],
  },
  transition: {
    requiredAssets: noAssets,
    outputRoles: ["transition"],
  },
  videoOverlay: {
    requiredAssets: requiredAsset(["video"], "Video asset to display."),
    outputRoles: ["video", "visual-overlay"],
  },
};

const motionExample = parseJsonObject(
  '{"durationInFrames":24,"delay":0,"intensity":1}',
  "motion preset example",
);

function buildMotionPresetManifests(): MotionPresetManifest[] {
  return motionPresetDefinitions
    .map((definition) => {
      assertExample(
        definition.paramsSchema.safeParse(motionExample).success,
        `motion preset ${JSON.stringify(definition.name)}`,
      );

      return {
        manifestVersion: COMMAND_MANIFEST_VERSION,
        name: definition.name,
        kind: "motion-preset" as const,
        label: definition.label,
        category: definition.category,
        description: definition.description,
        paramsSchema: draft07Schema(definition.paramsSchema),
        examples: [motionExample],
        requiredAssets: [],
        outputRoles: ["animation"],
      };
    })
    .sort(compareByName);
}

function buildMacroManifests(): MacroManifest[] {
  const registeredDefinitions = macroDefinitions();
  const registeredNames = new Set(
    registeredDefinitions.map(({ name }) => name),
  );
  const staleSemantics = Object.keys(macroSemantics).filter(
    (name) => !registeredNames.has(name),
  );
  if (staleSemantics.length > 0) {
    throw new Error(
      `Manifest semantics reference unregistered macros: ${sortedStrings(
        staleSemantics,
      )
        .map((name) => JSON.stringify(name))
        .join(", ")}.`,
    );
  }

  const definitionsByName = new Map(
    registeredDefinitions.map((definition) => [definition.name, definition]),
  );
  return Object.keys(macroSemantics)
    .map((name) => {
      const definition = definitionsByName.get(name)!;
      const semantics = macroSemantics[name]!;

      const examples = parseMacroUsage(definition.name, definition.usage);
      for (const example of examples) {
        assertExample(
          definition.params.safeParse(example).success,
          `macro ${JSON.stringify(definition.name)}`,
        );
      }

      return {
        manifestVersion: COMMAND_MANIFEST_VERSION,
        name: definition.name,
        kind: "macro" as const,
        description: definition.description,
        paramsSchema: draft07Schema(definition.params),
        examples,
        requiredAssets: semantics.requiredAssets
          .map((descriptor) => ({
            ...descriptor,
            allowedTypes: sortedStrings(
              descriptor.allowedTypes,
            ) as ManifestAssetType[],
          }))
          .sort((a, b) => compareCodeUnits(a.parameter, b.parameter)),
        outputRoles: sortedStrings(semantics.outputRoles),
      };
    })
    .sort(compareByName);
}

const motionPresetManifestSource = buildMotionPresetManifests();
const macroManifestSource = buildMacroManifests();
const capabilityManifestSource: CapabilityManifest[] = [
  ...motionPresetManifestSource,
  ...macroManifestSource,
].sort(compareByName);

/** Deterministic, detached manifests for every built-in motion preset. */
export function motionPresetManifests(): MotionPresetManifest[] {
  return cloneJson(motionPresetManifestSource);
}

/**
 * Deterministic, detached manifests for the built-in macro registry snapshot.
 * Runtime macros registered by an application need their own host manifest,
 * because MotionForge cannot infer asset requirements or output semantics.
 */
export function macroManifests(): MacroManifest[] {
  return cloneJson(macroManifestSource);
}

/** All preset and macro manifests in deterministic code-unit name order. */
export function capabilityManifests(): CapabilityManifest[] {
  return cloneJson(capabilityManifestSource);
}

export function getMotionPresetManifest(name: string): MotionPresetManifest {
  const manifest = motionPresetManifestSource.find(
    (candidate) => candidate.name === name,
  );
  if (!manifest) {
    throw unknownManifestError(
      "motion preset",
      name,
      motionPresetManifestSource.map((candidate) => candidate.name),
    );
  }
  return cloneJson(manifest);
}

export function getMacroManifest(name: string): MacroManifest {
  const manifest = macroManifestSource.find(
    (candidate) => candidate.name === name,
  );
  if (!manifest) {
    throw unknownManifestError(
      "macro",
      name,
      macroManifestSource.map((candidate) => candidate.name),
    );
  }
  return cloneJson(manifest);
}

function draft07Schema(schema: Parameters<typeof zodToJsonSchema>[0]) {
  return {
    $schema: "http://json-schema.org/draft-07/schema#",
    ...(zodToJsonSchema(schema, {
      target: "jsonSchema7",
      $refStrategy: "none",
    }) as Record<string, unknown>),
  };
}

function parseMacroUsage(
  expectedName: string,
  usage: string,
): Array<Record<string, unknown>> {
  const invocations = usage
    .split(" or ")
    .map((value, index) =>
      parseJsonObject(
        value,
        `usage example ${index + 1} for macro ${JSON.stringify(expectedName)}`,
      ),
    );

  return invocations.map((invocation) => {
    if (invocation.macro !== expectedName) {
      throw new Error(
        `Usage example for macro ${JSON.stringify(expectedName)} must contain {"macro":${JSON.stringify(expectedName)}}.`,
      );
    }
    const { macro: _macro, ...params } = invocation;
    return params;
  });
}

function parseJsonObject(
  value: string,
  label: string,
): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch (error) {
    throw new Error(
      `Invalid JSON in ${label}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${label} must be a JSON object.`);
  }
  return parsed as Record<string, unknown>;
}

function assertExample(success: boolean, label: string): void {
  if (!success) {
    throw new Error(
      `The published example for ${label} does not satisfy its parameter schema.`,
    );
  }
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareByName<T extends { name: string }>(left: T, right: T): number {
  return compareCodeUnits(left.name, right.name);
}

function sortedStrings<T extends string>(values: readonly T[]): T[] {
  return [...values].sort(compareCodeUnits);
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function unknownManifestError(
  kind: string,
  name: string,
  available: string[],
): Error {
  return new Error(
    `Unknown ${kind} manifest ${JSON.stringify(name)}. Available ${kind}s: ${available.map((entry) => JSON.stringify(entry)).join(", ")}.`,
  );
}
