import { expect, it } from "vitest";
import { runAgent } from "../packages/agent/src/loop";
import {
  createVideoProjectDocument,
  hashVideoProjectDocument,
} from "../packages/core/src/lib/video-project/document";
import { builtInSkills } from "../packages/agent-kit/src/index";
it.each(["local-editor-v3", "local-editor-v4"] as const)(
  "freezes the intended default model-step policy for %s",
  async (profile) => {
    const document = createVideoProjectDocument({
      width: 640,
      height: 360,
      fps: 30,
      durationInFrames: 90,
    });
    const request = {
      contract: "video-project-commands" as const,
      version: 1 as const,
      baseRevision: 1,
      baseHash: await hashVideoProjectDocument(document),
      document,
      context: { selectedItemIds: [], playheadFrame: 0 },
    };
    let calls = 0;
    const result = runAgent({
      request,
      profile,
      skills: builtInSkills(),
      signal: new AbortController().signal,
      maxOutputTokens: 16000,
      model: {
        identity: "budget-regression",
        complete: async () => {
          calls++;
          return calls <= 9
            ? {
                text: "",
                calls: [
                  {
                    id: `inspect-${calls}`,
                    name: "inspect_project",
                    arguments: "{}",
                  },
                ],
                usage: { inputTokens: 1, outputTokens: 1 },
              }
            : {
                text: "The project has no imported assets.",
                calls: [],
                usage: { inputTokens: 1, outputTokens: 1 },
              };
        },
      },
    });
    if (profile === "local-editor-v3") {
      await expect(result).rejects.toThrow(/Model-step budget/);
      expect(calls).toBe(8);
    } else {
      expect((await result).outcome).toBe("answer");
      expect(calls).toBe(10);
    }
  },
);
