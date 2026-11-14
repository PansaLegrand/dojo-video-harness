import { describe, expect, it } from "vitest";
import {
  validateNativeCompletionRequirements,
  reviewNativeCompletionEdit,
} from "../packages/core/src/lib/video-project/completion-preflight";
import {
  createVideoProjectDocument,
  hashVideoProjectDocument,
} from "../packages/core/src/lib/video-project/document";
import type { CompletionRequirement } from "../packages/agent-kit/src/index";

const property = (
  id: string,
  target: any,
  path: string[],
  equals: unknown,
): CompletionRequirement => ({ id, kind: "property", target, path, equals });
const absent = (
  id: string,
  target: any,
  path: string[],
): CompletionRequirement => ({ id, kind: "property_absent", target, path });

describe("native completion target paths before declaration", () => {
  it("rejects the actual item.duration plan mistake with a concrete native-path repair hint", () => {
    const input = [
      property(
        "audio-duration",
        { kind: "item", itemId: "narration" },
        ["duration"],
        9439,
      ),
    ];
    const before = JSON.stringify(input);
    expect(() => validateNativeCompletionRequirements(input)).toThrow(
      /invalid item property path/,
    );
    expect(() => validateNativeCompletionRequirements(input)).toThrow(
      /node target.*narration.*\["node","duration"\]/,
    );
    expect(() => validateNativeCompletionRequirements(input)).toThrow(/actual nodeId from inspect_project.nodeTarget/);
    expect(JSON.stringify(input)).toBe(before);
  });
  it("accepts real roots, source properties and future graphics without resolving current entities or values", () => {
    const requirements = [
      property(
        "node-duration",
        { kind: "node", itemId: "narration", nodeId: "narration" },
        ["duration"],
        9439,
      ),
      property(
        "item-node-duration",
        { kind: "item", itemId: "narration" },
        ["node", "duration"],
        9439,
      ),
      property(
        "future-text",
        { kind: "node", itemId: "not-created-yet", nodeId: "future-heading" },
        ["text"],
        "Future heading",
      ),
      property(
        "future-child",
        { kind: "item", itemId: "future-chart" },
        ["node", "children", "future-label", "style", "color"],
        "#ffffff",
      ),
      property("format", { kind: "format" }, ["fps"], 30),
      property(
        "track",
        { kind: "track", trackId: "future-visual" },
        ["kind"],
        "visual",
      ),
      property(
        "caption",
        { kind: "caption", itemId: "future-captions" },
        ["sourceItemId"],
        "narration",
      ),
      property(
        "cue",
        { kind: "cue", itemId: "future-captions", cueId: "future-cue" },
        ["startMs"],
        1000,
      ),
      property(
        "project-source",
        { kind: "project" },
        ["sources", "future-source", "revision"],
        "source-revision",
      ),
      property(
        "project-item",
        { kind: "project" },
        ["items", "future-item", "node", "duration"],
        90,
      ),
      property(
        "opaque-metadata",
        { kind: "project" },
        ["metadata", "hostData", "version"],
        1,
      ),
      property(
        "opaque-native-params",
        { kind: "node", itemId: "future", nodeId: "future" },
        ["extension", "params", "objects", "box", "width"],
        10,
      ),
    ];
    expect(validateNativeCompletionRequirements(requirements)).toEqual(
      requirements,
    );
  });
  it("accepts optional property_absent paths but rejects nonexistent fields even for absence", () => {
    const valid = [
      absent(
        "filter",
        { kind: "node", itemId: "future-graphic", nodeId: "future-graphic" },
        ["style", "filter"],
      ),
      absent("pair", { kind: "caption", itemId: "future-captions" }, [
        "pairedItemId",
      ]),
      absent(
        "words",
        { kind: "cue", itemId: "future-captions", cueId: "future-cue" },
        ["words"],
      ),
    ];
    expect(validateNativeCompletionRequirements(valid)).toEqual(valid);
    for (const requirement of [
      absent("wrong-item", { kind: "item", itemId: "narration" }, ["duration"]),
      absent(
        "wrong-style",
        { kind: "node", itemId: "future", nodeId: "future" },
        ["style", "colour"],
      ),
      absent("wrong-format", { kind: "format" }, ["duration"]),
      absent("wrong-track", { kind: "track", trackId: "visual" }, ["volume"]),
      absent(
        "scalar-traversal",
        { kind: "node", itemId: "future", nodeId: "future" },
        ["duration", "value"],
      ),
      absent("unkeyed-array", { kind: "cue", itemId: "future", cueId: "cue" }, [
        "words",
        "0",
        "text",
      ]),
    ])
      expect(() => validateNativeCompletionRequirements([requirement])).toThrow(
        /invalid .* property path/,
      );
  });
  it("reviews corrected source-preservation and future-graphic requirements through the actual native kernel", async () => {
    const document = createVideoProjectDocument({
      width: 640,
      height: 360,
      fps: 30,
      durationInFrames: 360,
    });
    document.assets.recording = {
      id: "recording",
      type: "audio",
      source: "local",
      name: "Synthetic recording",
      durationSeconds: 12,
    };
    document.sources.recording = { assetId: "recording", revision: "original" };
    document.items.push({
      id: "narration",
      name: "Narration",
      trackId: "audio",
      node: {
        id: "narration",
        type: "audio",
        assetId: "recording",
        from: 0,
        duration: 360,
        audioStartTime: 0,
        volume: 1,
      },
    });
    const before = JSON.stringify(document),
      request = {
        contract: "video-project-commands" as const,
        version: 1 as const,
        baseRevision: 1,
        baseHash: await hashVideoProjectDocument(document),
        document,
        context: { selectedItemIds: [], playheadFrame: 0 },
      };
    const requirements = validateNativeCompletionRequirements([
      property(
        "duration",
        { kind: "node", itemId: "narration", nodeId: "narration" },
        ["duration"],
        360,
      ),
      property(
        "nested-duration",
        { kind: "item", itemId: "narration" },
        ["node", "duration"],
        360,
      ),
      property(
        "heading",
        { kind: "node", itemId: "future-heading", nodeId: "future-heading" },
        ["text"],
        "Quarterly overview",
      ),
      property("future-item-duration", { kind: "item", itemId: "future-heading" }, ["node", "duration"], 360),
      absent(
        "no-filter",
        { kind: "node", itemId: "future-heading", nodeId: "future-heading" },
        ["style", "filter"],
      ),
    ]);
    const edit = {
      outcome: "proposal",
      summary: "Add a future heading and preserve narration",
      commands: [
        {
          type: "insertGraphic",
          itemId: "future-heading",
          trackId: "visual",
          name: "Heading",
          node: {
            type: "text",
            text: "Quarterly overview",
            from: 0,
            duration: 360,
            style: {
              position: "absolute",
              left: 40,
              top: 40,
              width: 560,
              height: 80,
              fontSize: 32,
              color: "#ffffff",
            },
          },
        },
      ],
    };
    const reviewed = await reviewNativeCompletionEdit(request, {
      requirements,
      edit,
    });
    expect(reviewed.checks.every((check) => check.passed)).toBe(true);
    expect(reviewed.receipt).toBeDefined();
    expect(JSON.stringify(document)).toBe(before);
    // Old contracts retain their original absence semantics when no new
    // validation callback is supplied; accepted receipts are not rewritten.
    const legacy = await reviewNativeCompletionEdit(request, {
      requirements: [
        absent("old-absence", { kind: "item", itemId: "narration" }, [
          "duration",
        ]),
      ],
      edit,
    });
    expect(legacy.receipt).toBeDefined();
    expect(() =>
      validateNativeCompletionRequirements([
        absent("old-absence", { kind: "item", itemId: "narration" }, [
          "duration",
        ]),
      ]),
    ).toThrow(/invalid item/);
  });
  it("allows sourceStartSeconds:0 on image assets while rejecting non-zero image offsets and mismatched speech wordIds before freezing", () => {
    const document = createVideoProjectDocument({
      width: 640,
      height: 360,
      fps: 30,
      durationInFrames: 300,
    });
    document.assets.photo = {
      id: "photo",
      type: "image",
      source: "local",
      name: "Photo",
    };
    document.assets.speech = {
      id: "speech",
      type: "video",
      source: "local",
      name: "Speech",
      durationSeconds: 10,
    };
    document.sources.speech = { assetId: "speech", revision: "rev" };
    document.items.push({
      id: "clip",
      name: "Speech",
      trackId: "visual",
      node: {
        id: "clip",
        type: "video",
        assetId: "speech",
        from: 0,
        duration: 300,
      },
    });
    document.evidence.asr = {
      id: "asr",
      sourceAssetId: "speech",
      sourceRevision: "rev",
      transcriptHash: "hash",
      language: "en",
      text: "uh computer science professor",
      words: [
        { id: "w0", text: "uh,", startMs: 1000, endMs: 1200 },
        { id: "w1", text: "computer", startMs: 1200, endMs: 1500 },
        { id: "w2", text: "science", startMs: 1500, endMs: 1800 },
        { id: "w3", text: "professor", startMs: 1800, endMs: 2200 },
      ],
    };
    expect(
      validateNativeCompletionRequirements(
        [
          {
            id: "images",
            kind: "asset_sequence",
            items: [
              {
                itemId: "card",
                assetId: "photo",
                from: 0,
                duration: 60,
                sourceStartSeconds: 0,
              },
            ],
          },
          {
            id: "quote",
            kind: "speech_callout",
            itemId: "callout",
            bindingId: "bind",
            sourceItemId: "clip",
            evidenceId: "asr",
            wordIds: ["w1", "w2", "w3"],
            exactText: "computer science professor",
            minReadableMs: 1200,
          },
        ],
        document,
      ),
    ).toHaveLength(2);
    expect(() =>
      validateNativeCompletionRequirements(
        [
          {
            id: "bad-image",
            kind: "asset_sequence",
            items: [
              {
                itemId: "card",
                assetId: "photo",
                from: 0,
                duration: 60,
                sourceStartSeconds: 2,
              },
            ],
          },
        ],
        document,
      ),
    ).toThrow(/Source offsets apply only to video\/audio assets/);
    expect(() =>
      validateNativeCompletionRequirements(
        [
          {
            id: "bad-quote",
            kind: "speech_callout",
            itemId: "callout",
            bindingId: "bind",
            sourceItemId: "clip",
            evidenceId: "asr",
            wordIds: ["w0", "w1", "w2"],
            exactText: "computer science professor",
            minReadableMs: 1200,
          },
        ],
        document,
      ),
    ).toThrow(/wordIds resolve to "uh, computer science".*search_transcript/);
  });
});
