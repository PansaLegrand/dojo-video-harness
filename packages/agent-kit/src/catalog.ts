export const AGENT_KIT_VERSION = "0.2.9" as const;
export type ToolEffect = "read" | "propose" | "ask";
export type ToolSpec = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};
export type HostRequestRef = {
  kind:
    | "source-inspection"
    | "project-preview"
    | "project-export"
    | "external-approval";
  id: string;
  hash: string;
};
export type AgentTool<T> = ToolSpec & {
  effect: ToolEffect;
  execute(
    args: unknown,
    signal: AbortSignal,
  ): Promise<
    | { kind: "observation"; value: unknown; pinned?: boolean }
    | { kind: "terminal"; result: T }
    | { kind: "waiting"; requestRef: HostRequestRef }
  >;
};
export type Skill = { name: string; description: string; instructions: string };
export const toolCatalog = {
  read_caption_track: {
    effect: "read",
    owner: "portable",
    description:
      "Read current editable caption cue IDs/text/timing after manual merge, split or correction, with language/pair/source/clock metadata and snapshot/scope-bound pagination. These are DISPLAY values, not genuine ASR word evidence; never use them to replace immutable transcript words.",
  },
  plan_edit_stages: {
    effect: "read",
    owner: "portable",
    description:
      "Freeze every requested outcome and exact source/range caption pairs before staged translation. The host creates evidence, bounded caption batches, assembly and verification stages under one original budget. This saves a plan and yields to the next stage; it never applies edits or submits provider jobs.",
  },
  save_caption_batch: {
    effect: "read",
    owner: "portable",
    description:
      "Persist exactly the active caption batch, one translation per genuine cue ID. The host binds source/range/batch identity, saves a reusable artifact and continues the next stage. This never applies partial captions or changes source evidence.",
  },
  read_edit_artifact: {
    effect: "read",
    owner: "portable",
    description:
      "Read an owned immutable editing artifact through a bounded paginated view. Original intent, creative decisions, prepared commands and failures remain references. Provider/financial/binary payloads stay host-only; coverage is explicit.",
  },
  inspect_project: {
    effect: "read",
    owner: "portable",
    description:
      "Read project relationships, imported asset identities (including unused logos), and up to 24 exact items. Empty input returns a bounded inventory.",
  },
  list_assets: {
    effect: "read",
    owner: "portable",
    description:
      "List owned project assets, including unused images, with filters and snapshot-bound cursor pagination. Follow nextCursor until coverage is complete before claiming all assets were inspected. Source status describes registration; browser file access is resolved by the host.",
  },
  read_caption_cues: {
    effect: "read",
    owner: "portable",
    description:
      "Read exact host-derived caption cue IDs/text/times and genuine word IDs for one source, with snapshot/source/scope-bound pagination. Follow nextCursor for complete bilingual cue coverage. This reads existing transcript evidence.",
  },
  read_skill: {
    effect: "read",
    owner: "portable",
    description:
      "Read a named trusted editing skill from the advertised index. Skills never authorize jobs or writes.",
  },
  search_transcript: {
    effect: "read",
    owner: "portable",
    description:
      "Find genuine source word IDs in existing evidence. Does not transcribe or upload.",
  },
  inspect_graphics_schema: {
    effect: "read",
    owner: "portable",
    description:
      "Read the installed editable 3D scene schema. Parameters are data, never executable JavaScript. Use stable object/material IDs for original compositions and corrections.",
  },
  prepare_svg_graphic: {
    effect: "read",
    owner: "portable",
    description:
      "Parse bounded SVG into editable native groups/paths. Returns a command and part IDs for propose_edit; does not apply edits. Unsupported SVG fails explicitly.",
  },
  prepare_three_scene: {
    effect: "read",
    owner: "portable",
    description:
      "Validate an original editable 3D scene and prepare its timeline item. Read inspect_graphics_schema first. Returns a command for propose_edit, never applies edits.",
  },
  prepare_text_overlay: {
    effect: "read",
    owner: "portable",
    description:
      "Prepare an editable, bounded title, lower-third or supplied-text caption with readable responsive defaults. Returns an insertGraphic command for propose_edit; never changes the project. Use source-bound captionSource for speech transcription. Excess copy is rejected, never truncated.",
  },
  propose_edit: {
    effect: "propose",
    owner: "portable",
    description:
      "Validate editing commands and hand them to the host for application or review. The tool itself does not commit.",
  },
  ask_user: {
    effect: "ask",
    owner: "portable",
    description:
      "Pause for one essential clarification with stable choices. No document edits occur.",
  },
  prepare_background_music: {
    effect: "ask",
    owner: "host",
    description:
      "Prepare an instrumental background music job for user approval. Inspect tracks first. Whole-project scope required. The Music card explicitly approves provider spending and automatic insertion up to the requested duration. No music is generated by this tool itself. For a request that also needs visual edits, set continueEditing:true, then continue to propose_edit; otherwise this tool ends the turn. Music placement must fit the existing project duration.",
  },
  prepare_editing_workflow: {
    effect: "ask",
    owner: "host",
    description:
      "Prepare ONE reviewed multi-step workflow for joining existing video clips, overlaying an imported logo, generating source-bound captions, translating them, then exporting. This only creates a plan. The user explicitly approves provider/media access, then compares/applies the resulting proposal before export. Use exact existing clip/image asset IDs; never claim jobs or exports are already done.",
  },
  review_edit: {
    effect: "read",
    owner: "portable",
    description:
      "Preflight an in-memory edit against a frozen list of every requested outcome. First valid requirements become immutable. Failed checks must be repaired; a successful review authorizes only the exact reviewed commands for propose_edit. This never applies edits.",
  },
  prepare_caption_pair: {
    effect: "read",
    owner: "portable",
    description:
      "Prepare original and translated caption tracks using genuine host cue IDs, exact complete cue coverage/timing and explicit non-overlapping colored bounds. Supply one translation per host cue ID; no provider call or edit is performed.",
  },
} as const;
export type CatalogToolName = keyof typeof toolCatalog;
export function toolMetadata(name: CatalogToolName) {
  const { description, effect } = toolCatalog[name];
  return { name, description, effect };
}
export const skillRequirements = {
  "generated-media": ["prepare_generated_media"],
  "visual-inspection": ["inspect_image", "sample_video_frames"],
  "staged-editing": [
    "plan_edit_stages",
    "save_caption_batch",
    "read_edit_artifact",
    "review_edit",
    "propose_edit",
  ],
  "precise-editing": ["inspect_project", "propose_edit"],
  "motion-design": [
    "inspect_project",
    "prepare_svg_graphic",
    "prepare_three_scene",
    "inspect_graphics_schema",
    "propose_edit",
  ],
  "speech-editing": ["search_transcript", "propose_edit"],
  "basic-editing-workflow": ["inspect_project", "prepare_editing_workflow"],
  "music-generation": ["inspect_project", "prepare_background_music"],
  "completion-preflight": ["review_edit", "propose_edit"],
  "multi-asset-editing": [
    "list_assets",
    "read_caption_cues",
    "review_edit",
    "propose_edit",
  ],
} as const;
export type BuiltinSkillName = keyof typeof skillRequirements;
export type AgentProfile =
  | "local-editor-v1"
  | "commercial-editing-v2"
  | "local-editor-v2"
  | "commercial-editing-v3"
  | "local-editor-v3"
  | "commercial-editing-v4"
  | "local-editor-v4"
  | "commercial-editing-v5"
  | "local-editor-v5"
  | "commercial-editing-v6"
  | "local-editor-v6"
  | "commercial-editing-v7"
  | "local-editor-v7"
  | "commercial-editing-v8"
  | "local-editor-v8"
  | "commercial-editing-v9"
  | "local-editor-v9"
  | "commercial-editing-v10"
  | "local-editor-v10"
  | "commercial-editing-v11"
  | "local-editor-v11"
  | "commercial-editing-v12"
  | "local-editor-v12"
  | "commercial-editing-v13"
  | "local-editor-v13"
  | "commercial-editing-v14"
  | "local-editor-v14"
  | "commercial-editing-v15";
/** One compatibility table owns capability selection. These wrappers remain public
 * so consumers need not duplicate profile lists or understand version ordering. */
export type ProfileCapability =
  | "completionPreflight"
  | "pagedReaders"
  | "efficientReaders"
  | "resolvedEditSchema"
  | "stagedEditing"
  | "authoringContracts"
  | "reviewedEditReferences"
  | "phaseScopedTools"
  | "previewRepair"
  | "installedGraphicsGrammar"
  | "appendPreviewRepair"
  | "semanticEditingGuidance"
  | "derivedCaptionPlan"
  | "compactReviewedProposals";
type ProfileDefinition = Readonly<{
  kitVersion: string;
  capabilities: readonly ProfileCapability[];
}>;
const extendProfile = (
  previous: ProfileDefinition,
  kitVersion: string,
  capability: ProfileCapability,
): ProfileDefinition =>
  Object.freeze({
    kitVersion,
    capabilities: Object.freeze([...previous.capabilities, capability]),
  });
const legacy: ProfileDefinition = Object.freeze({
  kitVersion: "0.1.1",
  capabilities: Object.freeze([]),
});
const completionPreflight = extendProfile(
  legacy,
  "0.1.2",
  "completionPreflight",
);
const pagedReaders = extendProfile(
  completionPreflight,
  "0.1.3",
  "pagedReaders",
);
const efficientReaders = extendProfile(
  pagedReaders,
  "0.1.4",
  "efficientReaders",
);
const resolvedEditSchema = extendProfile(
  efficientReaders,
  "0.1.5",
  "resolvedEditSchema",
);
const stagedEditing = extendProfile(
  resolvedEditSchema,
  "0.2.0",
  "stagedEditing",
);
const authoringContracts = extendProfile(
  stagedEditing,
  "0.2.1",
  "authoringContracts",
);
const reviewedEditReferences = extendProfile(
  authoringContracts,
  "0.2.2",
  "reviewedEditReferences",
);
const phaseScopedTools = extendProfile(
  reviewedEditReferences,
  "0.2.3",
  "phaseScopedTools",
);
const previewRepair = extendProfile(phaseScopedTools, "0.2.4", "previewRepair");
const installedGraphicsGrammar = extendProfile(
  previewRepair,
  "0.2.5",
  "installedGraphicsGrammar",
);
const appendPreviewRepair = extendProfile(
  installedGraphicsGrammar,
  "0.2.6",
  "appendPreviewRepair",
);
const semanticEditingGuidance = extendProfile(
  appendPreviewRepair,
  "0.2.7",
  "semanticEditingGuidance",
);
const derivedCaptionPlan = extendProfile(
  semanticEditingGuidance,
  AGENT_KIT_VERSION,
  "derivedCaptionPlan",
);
const compactReviewedProposals = extendProfile(
  derivedCaptionPlan,
  AGENT_KIT_VERSION,
  "compactReviewedProposals",
);
export const profileCapabilities = Object.freeze({
  "local-editor-v1": legacy,
  "commercial-editing-v2": legacy,
  "local-editor-v2": completionPreflight,
  "commercial-editing-v3": completionPreflight,
  "local-editor-v3": pagedReaders,
  "commercial-editing-v4": pagedReaders,
  "local-editor-v4": efficientReaders,
  "commercial-editing-v5": efficientReaders,
  "local-editor-v5": resolvedEditSchema,
  "commercial-editing-v6": resolvedEditSchema,
  "local-editor-v6": stagedEditing,
  "commercial-editing-v7": stagedEditing,
  "local-editor-v7": authoringContracts,
  "commercial-editing-v8": authoringContracts,
  "local-editor-v8": reviewedEditReferences,
  "commercial-editing-v9": reviewedEditReferences,
  "local-editor-v9": phaseScopedTools,
  "commercial-editing-v10": phaseScopedTools,
  "local-editor-v10": previewRepair,
  "commercial-editing-v11": previewRepair,
  "local-editor-v11": installedGraphicsGrammar,
  "commercial-editing-v12": installedGraphicsGrammar,
  "local-editor-v12": appendPreviewRepair,
  "commercial-editing-v13": appendPreviewRepair,
  "local-editor-v13": semanticEditingGuidance,
  "commercial-editing-v14": semanticEditingGuidance,
  "local-editor-v14": compactReviewedProposals,
  "commercial-editing-v15": compactReviewedProposals,
} satisfies Record<AgentProfile, ProfileDefinition>);
const hasCapability = (
  profile: AgentProfile,
  capability: ProfileCapability,
): boolean =>
  (
    profileCapabilities[profile] as ProfileDefinition | undefined
  )?.capabilities.includes(capability) ?? false;
export const usesCompletionPreflight = (profile: AgentProfile) =>
  hasCapability(profile, "completionPreflight");
export const usesPagedReaders = (profile: AgentProfile) =>
  hasCapability(profile, "pagedReaders");
export const usesEfficientReaders = (profile: AgentProfile) =>
  hasCapability(profile, "efficientReaders");
export const usesResolvedEditSchema = (profile: AgentProfile) =>
  hasCapability(profile, "resolvedEditSchema");
export const usesStagedEditing = (profile: AgentProfile) =>
  hasCapability(profile, "stagedEditing");
export const usesAuthoringContracts = (profile: AgentProfile) =>
  hasCapability(profile, "authoringContracts");
export const usesReviewedEditReferences = (profile: AgentProfile) =>
  hasCapability(profile, "reviewedEditReferences");
export const usesPhaseScopedTools = (profile: AgentProfile) =>
  hasCapability(profile, "phaseScopedTools");
export const usesPreviewRepair = (profile: AgentProfile) =>
  hasCapability(profile, "previewRepair");
export const usesInstalledGraphicsGrammar = (profile: AgentProfile) =>
  hasCapability(profile, "installedGraphicsGrammar");
export const usesAppendPreviewRepair = (profile: AgentProfile) =>
  hasCapability(profile, "appendPreviewRepair");
export const usesSemanticEditingGuidance = (profile: AgentProfile) =>
  hasCapability(profile, "semanticEditingGuidance");
export const usesDerivedCaptionPlan = (profile: AgentProfile) =>
  hasCapability(profile, "derivedCaptionPlan");
export const usesCompactReviewedProposals = (profile: AgentProfile) =>
  hasCapability(profile, "compactReviewedProposals");
export const profileKitVersion = (profile: AgentProfile) =>
  profileCapabilities[profile]?.kitVersion ?? "0.1.1";
export const profileSkills: Record<
  AgentProfile,
  readonly BuiltinSkillName[] | null
> = {
  "local-editor-v1": null,
  "commercial-editing-v2": ["precise-editing", "motion-design"],
  "local-editor-v2": null,
  "local-editor-v3": null,
  "local-editor-v4": null,
  "local-editor-v5": null,
  "local-editor-v6": null,
  "local-editor-v7": null,
  "local-editor-v8": null,
  "local-editor-v9": null,
  "local-editor-v10": null,
  "local-editor-v11": null,
  "local-editor-v12": null,
  "local-editor-v13": null,
  "local-editor-v14": null,
  "commercial-editing-v15": [
    "precise-editing",
    "motion-design",
    "speech-editing",
    "completion-preflight",
    "multi-asset-editing",
    "staged-editing",
    "generated-media",
    "visual-inspection",
  ],
  "commercial-editing-v14": [
    "precise-editing",
    "motion-design",
    "speech-editing",
    "completion-preflight",
    "multi-asset-editing",
    "staged-editing",
    "generated-media",
    "visual-inspection",
  ],
  "commercial-editing-v13": [
    "precise-editing",
    "motion-design",
    "speech-editing",
    "completion-preflight",
    "multi-asset-editing",
    "staged-editing",
    "generated-media",
    "visual-inspection",
  ],
  "commercial-editing-v12": [
    "precise-editing",
    "motion-design",
    "speech-editing",
    "completion-preflight",
    "multi-asset-editing",
    "staged-editing",
    "generated-media",
    "visual-inspection",
  ],
  "commercial-editing-v11": [
    "precise-editing",
    "motion-design",
    "speech-editing",
    "completion-preflight",
    "multi-asset-editing",
    "staged-editing",
    "generated-media",
    "visual-inspection",
  ],
  "commercial-editing-v10": [
    "precise-editing",
    "motion-design",
    "speech-editing",
    "completion-preflight",
    "multi-asset-editing",
    "staged-editing",
    "generated-media",
    "visual-inspection",
  ],
  "commercial-editing-v9": [
    "precise-editing",
    "motion-design",
    "speech-editing",
    "completion-preflight",
    "multi-asset-editing",
    "staged-editing",
    "generated-media",
    "visual-inspection",
  ],
  "commercial-editing-v8": [
    "precise-editing",
    "motion-design",
    "speech-editing",
    "completion-preflight",
    "multi-asset-editing",
    "staged-editing",
    "generated-media",
    "visual-inspection",
  ],
  "commercial-editing-v7": [
    "precise-editing",
    "motion-design",
    "speech-editing",
    "completion-preflight",
    "multi-asset-editing",
    "staged-editing",
    "generated-media",
    "visual-inspection",
  ],
  "commercial-editing-v6": [
    "precise-editing",
    "motion-design",
    "speech-editing",
    "completion-preflight",
    "multi-asset-editing",
  ],
  "commercial-editing-v5": [
    "precise-editing",
    "motion-design",
    "speech-editing",
    "completion-preflight",
    "multi-asset-editing",
  ],
  "commercial-editing-v4": [
    "precise-editing",
    "motion-design",
    "speech-editing",
    "completion-preflight",
    "multi-asset-editing",
  ],
  "commercial-editing-v3": [
    "precise-editing",
    "motion-design",
    "speech-editing",
    "completion-preflight",
  ],
};
