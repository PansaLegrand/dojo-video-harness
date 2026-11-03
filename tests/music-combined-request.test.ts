import { it, expect, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { runAgent } from "../packages/agent/src/loop";
import { musicTools } from "../apps/server/src/music-tools";
import type { MusicService } from "../apps/server/src/music-service";
import {
  createVideoProjectDocument,
  hashVideoProjectDocument,
} from "../packages/core/src/lib/video-project/document";
import { executeVideoProjectCommands } from "../packages/core/src/lib/video-project/commands";
it.each([false, true])(
  "music planning continuation=%s preserves its approval boundary",
  async (continueEditing) => {
    const document = createVideoProjectDocument({
      width: 720,
      height: 1280,
      fps: 30,
      durationInFrames: 600,
    });
    document.items.push({
      id: "title",
      name: "Title",
      trackId: "visual",
      node: {
        id: "title",
        type: "text",
        text: "Before",
        from: 0,
        duration: 90,
      },
    });
    const request = {
      contract: "video-project-commands" as const,
      version: 1 as const,
      baseRevision: 0,
      baseHash: await hashVideoProjectDocument(document),
      document,
      context: { selectedItemIds: [], playheadFrame: 0 },
      authoring: { version: 1 as const, scope: { kind: "project" as const } },
    };
    const propose = vi.fn(async (_projectId: string, _input: unknown) => ({
      id: randomUUID(),
      status: "awaiting_approval",
    }));
    const service = { propose, cancel: vi.fn() } as unknown as MusicService;
    const model = {
      complete: vi
        .fn()
        .mockResolvedValueOnce({
          text: "",
          calls: [
            {
              id: "music",
              name: "prepare_background_music",
              arguments: JSON.stringify({
                prompt: "Warm piano",
                title: "Background",
                trackId: "audio",
                fromFrame: 0,
                durationInFrames: 600,
                volume: 0.18,
                ...(continueEditing ? { continueEditing: true } : {}),
              }),
            },
          ],
        })
        .mockResolvedValueOnce({
          text: "",
          calls: [
            {
              id: "edit",
              name: "propose_edit",
              arguments: JSON.stringify({
                summary: "Updated title",
                commands: [
                  {
                    type: "set",
                    target: { kind: "node", itemId: "title", nodeId: "title" },
                    path: ["text"],
                    value: "After",
                  },
                ],
              }),
            },
          ],
        }),
    };
    const result = await runAgent({
      request,
      model,
      skills: [],
      signal: new AbortController().signal,
      extraTools: musicTools(service, randomUUID(), randomUUID(), request),
    });
    expect(propose).toHaveBeenCalledTimes(1);
    expect(propose.mock.calls[0]?.[1]).not.toHaveProperty("continueEditing");
    expect(document.items[0].node.text).toBe("Before");
    expect(model.complete).toHaveBeenCalledTimes(continueEditing ? 2 : 1);
    expect(result.outcome).toBe(continueEditing ? "proposal" : "answer");
    if (continueEditing) {
      expect(
        executeVideoProjectCommands(document, result.proposal!.commands)
          .document.items[0].node.text,
      ).toBe("After");
      expect(JSON.stringify(model.complete.mock.calls[1][0])).toContain(
        "awaiting_approval",
      );
    }
  },
);
