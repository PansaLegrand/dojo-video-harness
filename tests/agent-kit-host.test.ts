import { describe, expect, it } from "vitest";
import { builtInSkills, toolMetadata } from "../packages/agent-kit/src/index";
import {
  createVideoToolset,
  type AgentTool,
} from "../packages/agent/src/tools";
import { runAgent } from "../packages/agent/src/loop";
import {
  createVideoProjectDocument,
  hashVideoProjectDocument,
} from "../packages/core/src/lib/video-project/document";
import {
  buildNativeAgentPrompts,
  type NativeAgentRequest,
} from "../packages/core/src/lib/video-project/agent-runtime";

async function fixture(): Promise<NativeAgentRequest> {
  const document = createVideoProjectDocument({
    width: 320,
    height: 180,
    fps: 30,
    durationInFrames: 90,
  });
  document.items.push({
    id: "title",
    name: "Title",
    trackId: "visual",
    node: { id: "title", type: "text", text: "Before", from: 0, duration: 90 },
  });
  return {
    contract: "video-project-commands",
    version: 1,
    baseRevision: 0,
    baseHash: await hashVideoProjectDocument(document),
    document,
    context: { selectedItemIds: ["title"], playheadFrame: 0 },
    instruction: "Make the title blue",
    authoring: { version: 1, scope: { kind: "selection", itemIds: ["title"] } },
  };
}
describe("local host uses the shared editor kit", () => {
  it("derives the 9/11 tool inventories from actual registered host executors", async () => {
    const request = await fixture();
    const base = createVideoToolset(request, builtInSkills());
    expect(base.inventory.tools).toHaveLength(9);
    expect(base.skills.map((skill) => skill.name)).not.toContain(
      "music-generation",
    );
    expect(
      base.skills.find((skill) => skill.name === "speech-editing")
        ?.instructions,
    ).not.toContain("use `prepare_editing_workflow`");
    const extras: AgentTool[] = (
      ["prepare_background_music", "prepare_editing_workflow"] as const
    ).map((name) => ({
      ...toolMetadata(name),
      parameters: { type: "object" },
      execute: async () => {
        throw new Error("Not authorized by inventory inspection");
      },
    }));
    const complete = createVideoToolset(request, builtInSkills(), extras);
    expect(complete.inventory.tools).toHaveLength(11);
    expect(complete.skills).toHaveLength(5);
  });
  it("builds tool-mode prompts directly while retaining legacy JSON mode", async () => {
    const request = await fixture();
    const legacy = buildNativeAgentPrompts({
      ...request,
      instruction: request.instruction!,
      document: request.document as never,
      messages: [],
    });
    expect(legacy.systemPrompt).toContain("Return ONLY JSON:");
    let seen = "";
    const result = await runAgent({
      request,
      skills: builtInSkills(),
      signal: new AbortController().signal,
      model: {
        complete: async (messages) => {
          seen = messages[0].content as string;
          return {
            text: "",
            calls: [
              {
                id: "edit",
                name: "propose_edit",
                arguments: JSON.stringify({
                  summary: "Blue title",
                  outcome: "proposal",
                  commands: [
                    {
                      type: "set",
                      target: {
                        kind: "node",
                        itemId: "title",
                        nodeId: "title",
                      },
                      path: ["style", "color"],
                      value: "#2563eb",
                    },
                  ],
                }),
              },
            ],
          };
        },
      },
    });
    expect(seen).toContain("The propose_edit tool accepts:");
    expect(seen).not.toContain("Return ONLY JSON:");
    expect(seen).toContain("prepare_text_overlay");
    expect(seen).not.toContain('"music-generation"');
    expect(result.proposal?.commands).toHaveLength(1);
  });
});
