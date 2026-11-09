import { expect, it, vi } from "vitest";
import {
  createEditorToolset,
  completionHash,
  builtInSkills,
  type CompletionRequirement,
} from "../packages/agent-kit/src/index";
const snapshotHash = "sha256:" + "a".repeat(64),
  requirements: CompletionRequirement[] = [
    { id: "retain-title", kind: "item_present", itemId: "title" },
  ];
async function fixture(restore = false) {
  const noop = async () => ({}),
    plan = vi.fn(async () => "yield"),
    set = createEditorToolset({
      profile: "local-editor-v6",
      snapshotHash,
      skills: builtInSkills(),
      proposalSchema: {
        type: "object",
        properties: { commands: { type: "array" } },
        required: ["commands"],
      },
      ...(restore
        ? {
            initialCompletionState: {
              version: 1 as const,
              snapshotHash,
              requirements,
              requirementsHash: await completionHash(requirements),
            },
          }
        : {}),
      ports: {
        inspectProject: noop,
        inspectGraphicsSchema: noop,
        searchTranscript: noop,
        prepareSvgGraphic: noop,
        prepareThreeScene: noop,
        prepareTextOverlay: noop,
        prepareCaptionPair: noop,
        listAssets: noop,
        readCaptionCues: noop,
        proposeEdit: async () => "proposal",
        askUser: async () => "question",
        reviewEdit: async () => ({
          checks: [
            {
              id: "retain-title",
              passed: false,
              message: "Repair the proposed commands.",
            },
          ],
        }),
        stages: {
          preparedCommands: false,
          planEditStages: plan,
          saveCaptionBatch: async () => "yield",
          readEditArtifact: noop,
          resolvePreparedEdit: async (raw) => raw,
        },
      },
    });
  const execute = (name: string, args: unknown) =>
    set.tools
      .find((tool) => tool.name === name)!
      .execute(args, new AbortController().signal);
  return { plan, execute };
}
it.each([false, true])(
  "staged planning retains first valid requirements across %s restored question state",
  async (restored) => {
    const f = await fixture(restored);
    if (!restored)
      await f.execute("review_edit", {
        requirements,
        edit: {
          outcome: "proposal",
          summary: "A candidate needs repair",
          commands: [
            {
              type: "set",
              target: { kind: "format" },
              path: ["backgroundColor"],
              value: "#ffffff",
            },
          ],
        },
      });
    await expect(
      f.execute("plan_edit_stages", {
        requirements: [
          { id: "different", kind: "item_present", itemId: "another" },
        ],
        captionPairs: [],
      }),
    ).rejects.toThrow(/preserve.*frozen/);
    expect(f.plan).not.toHaveBeenCalled();
    await expect(
      f.execute("plan_edit_stages", { requirements, captionPairs: [] }),
    ).resolves.toEqual({ kind: "terminal", result: "yield" });
    expect(f.plan).toHaveBeenCalledTimes(1);
  },
);
